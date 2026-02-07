use starknet::ContractAddress;

#[derive(Copy, Drop, Serde, starknet::Store)]
pub enum ActionType {
    #[default]
    Swap,
    Bridge,
    Stake,
    ClaimReward,
    MintNFT,
    MultiStep,
}

#[derive(Copy, Drop, Serde, starknet::Store)]
pub enum Status {
    #[default]
    Pending,
    Executed,
    Failed,
    Cancelled,
}

#[derive(Drop, Serde, starknet::Store)]
pub struct AIAction {
    pub user: ContractAddress,
    pub action_type: ActionType,
    pub params: ByteArray,
    pub timestamp: u64,
    pub status: Status,
    pub fee_paid: u256,
}

#[starknet::interface]
pub trait IAIExecutor<TContractState> {
    fn submit_action(
        ref self: TContractState, 
        action_type: ActionType, 
        params: ByteArray, 
        user_signature: Span<felt252>
    ) -> u64;
    fn execute_action(ref self: TContractState, action_id: u64, backend_signature: Span<felt252>);
    fn cancel_action(ref self: TContractState, action_id: u64);
    fn get_pending_actions(self: @TContractState, user: ContractAddress) -> Array<u64>;
    fn check_rate_limit(self: @TContractState, user: ContractAddress) -> bool;
}

#[starknet::contract]
pub mod AIExecutor {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::{get_caller_address, get_block_timestamp};
    use super::{AIAction, ActionType, Status, IAIExecutor};

    #[storage]
    pub struct Storage {
        pub carel_token: ContractAddress,
        pub ai_backend_signer: ContractAddress,
        pub action_count: u64,
        pub pending_actions: Map<u64, AIAction>,
        pub action_signatures: Map<(u64, u64), felt252>,
        pub action_signature_len: Map<u64, u64>,
        pub user_action_count: Map<(ContractAddress, u64), u256>,
        pub rate_limit: u256,
        pub level_2_price: u256,
        pub level_3_price: u256,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState, 
        carel_token: ContractAddress, 
        backend_signer: ContractAddress
    ) {
        self.carel_token.write(carel_token);
        self.ai_backend_signer.write(backend_signer);
        self.rate_limit.write(10);
        self.level_2_price.write(1_000_000_000_000_000_000); 
        self.level_3_price.write(2_000_000_000_000_000_000); 
    }

    #[abi(embed_v0)]
    impl AIExecutorImpl of IAIExecutor<ContractState> {
        fn submit_action(
            ref self: ContractState, 
            action_type: ActionType, 
            params: ByteArray, 
            user_signature: Span<felt252>
        ) -> u64 {
            let caller = get_caller_address();
            assert!(self.check_rate_limit(caller), "Rate limit exceeded");

            let fee = match action_type {
                ActionType::MultiStep => self.level_3_price.read(),
                _ => self.level_2_price.read(),
            };

            let day = get_block_timestamp() / 86400;
            let current_count = self.user_action_count.entry((caller, day)).read();
            self.user_action_count.entry((caller, day)).write(current_count + 1);

            let action_id = self.action_count.read() + 1;
            
            // Store signature in separate storage map
            let sig_len = user_signature.len().into();
            self.action_signature_len.entry(action_id).write(sig_len);
            
            let mut i: u64 = 0;
            for val in user_signature {
                self.action_signatures.entry((action_id, i)).write(*val);
                i += 1;
            };

            let new_action = AIAction {
                user: caller,
                action_type,
                params,
                timestamp: get_block_timestamp(),
                status: Status::Pending,
                fee_paid: fee,
            };

            self.pending_actions.entry(action_id).write(new_action);
            self.action_count.write(action_id);
            action_id
        }

        fn execute_action(ref self: ContractState, action_id: u64, backend_signature: Span<felt252>) {
            let caller = get_caller_address();
            assert!(caller == self.ai_backend_signer.read(), "Unauthorized backend signer");

            let mut action = self.pending_actions.entry(action_id).read();
            if let Status::Pending = action.status {
                action.status = Status::Executed;
                self.pending_actions.entry(action_id).write(action);
            } else {
                panic!("Action not pending");
            }
        }

        fn cancel_action(ref self: ContractState, action_id: u64) {
            let mut action = self.pending_actions.entry(action_id).read();
            assert!(get_caller_address() == action.user, "Only user can cancel");
            
            if let Status::Pending = action.status {
                action.status = Status::Cancelled;
                self.pending_actions.entry(action_id).write(action);
            } else {
                panic!("Cannot cancel");
            }
        }

        fn get_pending_actions(self: @ContractState, user: ContractAddress) -> Array<u64> {
            let mut result = array![];
            let count = self.action_count.read();
            for i in 1..count + 1 {
                let action = self.pending_actions.entry(i).read();
                if action.user == user {
                    if let Status::Pending = action.status {
                        result.append(i);
                    }
                }
            };
            result
        }

        fn check_rate_limit(self: @ContractState, user: ContractAddress) -> bool {
            let day = get_block_timestamp() / 86400;
            self.user_action_count.entry((user, day)).read() < self.rate_limit.read()
        }
    }
}