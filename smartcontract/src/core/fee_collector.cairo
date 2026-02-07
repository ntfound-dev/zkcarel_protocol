use starknet::ContractAddress;

#[starknet::interface]
pub trait IFeeCollector<TContractState> {
    fn collect_swap_fee(ref self: TContractState, amount: u256, lp_address: ContractAddress);
    fn collect_bridge_fee(ref self: TContractState, amount: u256, provider: ContractAddress);
    fn collect_mev_fee(ref self: TContractState, amount: u256, user_enabled: bool);
    fn update_fee_rates(
        ref self: TContractState, 
        swap_rate: u256, 
        bridge_rate: u256, 
        mev_rate: u256,
        lp_share: u256,
        treasury_share: u256
    );
    fn get_treasury_address(self: @TContractState) -> ContractAddress;
}

#[starknet::interface]
pub trait ITreasury<TContractState> {
    fn receive_fee(ref self: TContractState, amount: u256);
}

#[starknet::contract]
pub mod FeeCollector {
    use starknet::ContractAddress;
    use starknet::storage::*;
    
    // OpenZeppelin component for ownership management
    use openzeppelin::access::ownable::OwnableComponent;
    use super::{ITreasuryDispatcher, ITreasuryDispatcherTrait};

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    const BPS_DENOMINATOR: u256 = 10000;

    #[storage]
    pub struct Storage {
        pub treasury_address: ContractAddress,
        pub swap_fee_rate: u256,
        pub bridge_fee_rate: u256,
        pub mev_fee_rate: u256,
        pub lp_share_swap: u256,
        pub treasury_share_swap: u256,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        FeeCollected: FeeCollected,
        RatesUpdated: RatesUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct FeeCollected {
        pub category: felt252,
        pub total_amount: u256,
        pub treasury_part: u256
    }

    #[derive(Drop, starknet::Event)]
    pub struct RatesUpdated {
        pub swap_rate: u256,
        pub bridge_rate: u256
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        treasury: ContractAddress
    ) {
        self.ownable.initializer(admin);
        self.treasury_address.write(treasury);

        // Default fee configurations
        self.swap_fee_rate.write(30);
        self.bridge_fee_rate.write(40);
        self.mev_fee_rate.write(15);
        self.lp_share_swap.write(20);
        self.treasury_share_swap.write(10);
    }

    #[abi(embed_v0)]
    impl FeeCollectorImpl of super::IFeeCollector<ContractState> {
        fn collect_swap_fee(ref self: ContractState, amount: u256, lp_address: ContractAddress) {
            let total_fee = (amount * self.swap_fee_rate.read()) / BPS_DENOMINATOR;
            let lp_part = (total_fee * self.lp_share_swap.read()) / (self.lp_share_swap.read() + self.treasury_share_swap.read());
            let treasury_part = total_fee - lp_part;

            let treasury = ITreasuryDispatcher { contract_address: self.treasury_address.read() };
            treasury.receive_fee(treasury_part);
            
            self.emit(Event::FeeCollected(FeeCollected { category: 'SWAP', total_amount: total_fee, treasury_part }));
        }

        fn collect_bridge_fee(ref self: ContractState, amount: u256, provider: ContractAddress) {
            let total_fee = (amount * self.bridge_fee_rate.read()) / BPS_DENOMINATOR;
            
            let treasury = ITreasuryDispatcher { contract_address: self.treasury_address.read() };
            treasury.receive_fee(total_fee);

            self.emit(Event::FeeCollected(FeeCollected { category: 'BRIDGE', total_amount: total_fee, treasury_part: total_fee }));
        }

        fn collect_mev_fee(ref self: ContractState, amount: u256, user_enabled: bool) {
            if !user_enabled { return; }
            
            let total_fee = (amount * self.mev_fee_rate.read()) / BPS_DENOMINATOR;
            
            let treasury = ITreasuryDispatcher { contract_address: self.treasury_address.read() };
            treasury.receive_fee(total_fee);

            self.emit(Event::FeeCollected(FeeCollected { category: 'MEV', total_amount: total_fee, treasury_part: total_fee }));
        }

        fn update_fee_rates(
            ref self: ContractState, 
            swap_rate: u256, 
            bridge_rate: u256, 
            mev_rate: u256,
            lp_share: u256,
            treasury_share: u256
        ) {
            self.ownable.assert_only_owner();
            
            self.swap_fee_rate.write(swap_rate);
            self.bridge_fee_rate.write(bridge_rate);
            self.mev_fee_rate.write(mev_rate);
            self.lp_share_swap.write(lp_share);
            self.treasury_share_swap.write(treasury_share);

            self.emit(Event::RatesUpdated(RatesUpdated { swap_rate, bridge_rate }));
        }

        fn get_treasury_address(self: @ContractState) -> ContractAddress {
            self.treasury_address.read()
        }
    }
}