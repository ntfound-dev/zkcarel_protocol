use starknet::ContractAddress;

#[starknet::interface]
pub trait ITreasury<TContractState> {
    fn receive_fee(ref self: TContractState, amount: u256);
    fn burn_excess(ref self: TContractState, amount: u256);
    fn fund_rewards(ref self: TContractState, recipient: ContractAddress, amount: u256);
    fn withdraw_emergency(ref self: TContractState, amount: u256);
    fn add_fee_collector(ref self: TContractState, collector: ContractAddress);
    fn get_treasury_balance(self: @TContractState) -> u256;
}

#[starknet::interface]
pub trait ICarelToken<TContractState> {
    fn burn(ref self: TContractState, amount: u256);
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
}

#[starknet::contract]
pub mod Treasury {
    use starknet::ContractAddress;
    use starknet::get_block_timestamp;
    use starknet::get_caller_address;
    use starknet::get_contract_address;
    use starknet::storage::*;
    
    // Corrected OpenZeppelin import path
    use openzeppelin::access::ownable::OwnableComponent;
    use super::{ICarelTokenDispatcher, ICarelTokenDispatcherTrait};

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    const EPOCH_DURATION: u64 = 2592000;

    #[storage]
    pub struct Storage {
        pub carel_token: ContractAddress,
        pub collected_fees: u256,
        pub distributed_rewards: u256,
        pub burned_amount: u256,
        pub burned_this_epoch: u256,
        pub max_burn_per_epoch: u256,
        pub last_burn_epoch: u64,
        pub fee_collectors: Map<ContractAddress, bool>,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        FeeReceived: FeeReceived,
        TokensBurned: TokensBurned,
        RewardsFunded: RewardsFunded,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct FeeReceived {
        pub from: ContractAddress,
        pub amount: u256
    }

    #[derive(Drop, starknet::Event)]
    pub struct TokensBurned {
        pub amount: u256,
        pub epoch: u64
    }

    #[derive(Drop, starknet::Event)]
    pub struct RewardsFunded {
        pub recipient: ContractAddress,
        pub amount: u256
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        multisig_admin: ContractAddress,
        token: ContractAddress
    ) {
        self.ownable.initializer(multisig_admin);
        self.carel_token.write(token);
        self.max_burn_per_epoch.write(5000000000000000000000000_u256);
    }

    #[abi(embed_v0)]
    impl TreasuryImpl of super::ITreasury<ContractState> {
        fn receive_fee(ref self: ContractState, amount: u256) {
            let caller = get_caller_address();
            assert!(self.fee_collectors.entry(caller).read(), "Not an authorized collector");
            
            self.collected_fees.write(self.collected_fees.read() + amount);
            // Fix: Wrap struct in Event variant
            self.emit(Event::FeeReceived(FeeReceived { from: caller, amount }));
        }

        fn burn_excess(ref self: ContractState, amount: u256) {
            self.ownable.assert_only_owner();
            
            let current_timestamp = get_block_timestamp();
            let current_epoch = current_timestamp / EPOCH_DURATION;
            
            if (self.last_burn_epoch.read() != current_epoch) {
                self.burned_this_epoch.write(0);
                self.last_burn_epoch.write(current_epoch);
            }

            let already_burned = self.burned_this_epoch.read();
            let max_allowed = self.max_burn_per_epoch.read();
            
            assert!(already_burned + amount <= max_allowed, "Epoch burn quota exceeded");

            self.burned_this_epoch.write(already_burned + amount);
            self.burned_amount.write(self.burned_amount.read() + amount);

            let token_dispatcher = ICarelTokenDispatcher { contract_address: self.carel_token.read() };
            token_dispatcher.burn(amount);

            self.emit(Event::TokensBurned(TokensBurned { amount, epoch: current_epoch }));
        }

        fn fund_rewards(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            self.ownable.assert_only_owner();
            self.distributed_rewards.write(self.distributed_rewards.read() + amount);
            self.emit(Event::RewardsFunded(RewardsFunded { recipient, amount }));
        }

        fn withdraw_emergency(ref self: ContractState, amount: u256) {
            self.ownable.assert_only_owner();
            let _owner = self.ownable.owner();
            // Implement transfer logic here
        }

        fn add_fee_collector(ref self: ContractState, collector: ContractAddress) {
            self.ownable.assert_only_owner();
            self.fee_collectors.entry(collector).write(true);
        }

        fn get_treasury_balance(self: @ContractState) -> u256 {
            let token_dispatcher = ICarelTokenDispatcher { contract_address: self.carel_token.read() };
            token_dispatcher.balance_of(get_contract_address())
        }
    }
}