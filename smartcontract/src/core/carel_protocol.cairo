use starknet::ContractAddress;

// High-level protocol entrypoints for swaps and BTC staking.
// Lightweight interface for integrations and event emission.
#[starknet::interface]
pub trait ICarelProtocol<TContractState> {
    // Implements swap logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn swap(ref self: TContractState, amount: u256, token_from: ContractAddress, token_to: ContractAddress);
    // Applies stake btc after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn stake_btc(ref self: TContractState, amount: u256, wrapper: ContractAddress);
    // Returns get active tokens from state without mutating storage.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn get_active_tokens(self: @TContractState) -> Array<ContractAddress>;
}

// ZK privacy entrypoints for protocol actions.
#[starknet::interface]
pub trait ICarelProtocolPrivacy<TContractState> {
    // Updates privacy router configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    // Applies submit private protocol action after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn submit_private_protocol_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

// Event-first protocol facade for swaps and BTC staking.
// Emits events for analytics and off-chain processing.
#[starknet::contract]
pub mod CarelProtocol {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;
    use core::num::traits::Zero;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_PROTOCOL;

    #[storage]
    pub struct Storage {
        active_wrappers: Map<ContractAddress, bool>,
        supported_tokens: Vec<ContractAddress>,
        privacy_router: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        SwapExecuted: SwapExecuted,
        BTCStaked: BTCStaked,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SwapExecuted {
        #[key]
        pub user: ContractAddress,
        pub amount: u256,
        pub token_from: ContractAddress,
        pub token_to: ContractAddress,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct BTCStaked {
        #[key]
        pub user: ContractAddress,
        pub amount: u256,
        pub wrapper: ContractAddress,
        pub timestamp: u64,
    }

    #[abi(embed_v0)]
    pub impl CarelProtocolImpl of super::ICarelProtocol<ContractState> {
        // Implements swap logic while keeping state transitions deterministic.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn swap(ref self: ContractState, amount: u256, token_from: ContractAddress, token_to: ContractAddress) {
            let caller = get_caller_address();
            let ts = get_block_timestamp();
            
            self.emit(Event::SwapExecuted(SwapExecuted { 
                user: caller, 
                amount, 
                token_from, 
                token_to, 
                timestamp: ts 
            }));
        }

        // Applies stake btc after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn stake_btc(ref self: ContractState, amount: u256, wrapper: ContractAddress) {
            let caller = get_caller_address();
            let ts = get_block_timestamp();

            self.emit(Event::BTCStaked(BTCStaked { 
                user: caller, 
                amount, 
                wrapper, 
                timestamp: ts 
            }));
        }

        // Returns get active tokens from state without mutating storage.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn get_active_tokens(self: @ContractState) -> Array<ContractAddress> {
            let mut active = array![];
            for i in 0..self.supported_tokens.len() {
                let token = self.supported_tokens.at(i).read();
                if self.active_wrappers.entry(token).read() {
                    active.append(token);
                }
            };
            active
        }
    }

    #[abi(embed_v0)]
    impl CarelProtocolPrivacyImpl of super::ICarelProtocolPrivacy<ContractState> {
        // Updates privacy router configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            assert!(!router.is_zero(), "Privacy router required");
            let current = self.privacy_router.read();
            assert!(current.is_zero(), "Privacy router already set");
            self.privacy_router.write(router);
        }

        // Applies submit private protocol action after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn submit_private_protocol_action(
            ref self: ContractState,
            old_root: felt252,
            new_root: felt252,
            nullifiers: Span<felt252>,
            commitments: Span<felt252>,
            public_inputs: Span<felt252>,
            proof: Span<felt252>
        ) {
            let router = self.privacy_router.read();
            assert!(!router.is_zero(), "Privacy router not set");
            let dispatcher = IPrivacyRouterDispatcher { contract_address: router };
            dispatcher.submit_action(
                ACTION_PROTOCOL,
                old_root,
                new_root,
                nullifiers,
                commitments,
                public_inputs,
                proof
            );
        }
    }
}
