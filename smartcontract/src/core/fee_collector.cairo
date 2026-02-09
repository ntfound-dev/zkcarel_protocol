use starknet::ContractAddress;

/// @title Fee Collector Interface
/// @author CAREL Team
/// @notice Defines fee collection and configuration entrypoints.
/// @dev Used by swap/bridge modules to route protocol fees.
#[starknet::interface]
pub trait IFeeCollector<TContractState> {
    /// @notice Collects swap fee and routes LP/treasury shares.
    /// @dev Calculates fee using configured swap rate.
    /// @param amount Swap amount subject to fees.
    /// @param lp_address LP recipient address.
    fn collect_swap_fee(ref self: TContractState, amount: u256, lp_address: ContractAddress);
    /// @notice Collects bridge fee and records provider/dev shares.
    /// @dev Tracks provider fees for later settlement.
    /// @param amount Bridged amount subject to fees.
    /// @param provider Bridge provider address.
    fn collect_bridge_fee(ref self: TContractState, amount: u256, provider: ContractAddress);
    /// @notice Collects MEV protection fee when enabled.
    /// @dev Skips fee when user opts out.
    /// @param amount Amount subject to fee.
    /// @param user_enabled Whether MEV protection is enabled.
    fn collect_mev_fee(ref self: TContractState, amount: u256, user_enabled: bool);
    /// @notice Updates fee rates and swap share splits.
    /// @dev Owner-only to prevent unauthorized fee changes.
    /// @param swap_rate Swap fee rate in bps.
    /// @param bridge_rate Bridge fee rate in bps.
    /// @param mev_rate MEV fee rate in bps.
    /// @param lp_share LP share of swap fee in bps.
    /// @param treasury_share Treasury share of swap fee in bps.
    fn update_fee_rates(
        ref self: TContractState, 
        swap_rate: u256, 
        bridge_rate: u256, 
        mev_rate: u256,
        lp_share: u256,
        treasury_share: u256
    );
    /// @notice Sets bridge fee split and dev fund address.
    /// @dev Owner-only to keep bridge economics consistent.
    /// @param provider_share_bps Provider share in bps.
    /// @param dev_share_bps Dev fund share in bps.
    /// @param dev_fund Dev fund address.
    fn set_bridge_fee_split(
        ref self: TContractState,
        provider_share_bps: u256,
        dev_share_bps: u256,
        dev_fund: ContractAddress
    );
    /// @notice Returns the treasury address used for fee routing.
    /// @dev Read-only helper for integrations.
    /// @return treasury Treasury address.
    fn get_treasury_address(self: @TContractState) -> ContractAddress;
    /// @notice Returns accumulated LP fees for an address.
    /// @dev Read-only helper for off-chain settlement.
    /// @param lp LP address.
    /// @return amount Accumulated LP fee amount.
    fn get_lp_fees(self: @TContractState, lp: ContractAddress) -> u256;
}

/// @title Fee Collector Privacy Interface
/// @author CAREL Team
/// @notice ZK privacy entrypoints for fee actions.
#[starknet::interface]
pub trait IFeeCollectorPrivacy<TContractState> {
    /// @notice Sets privacy router address.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    /// @notice Submits a private fee action proof.
    fn submit_private_fee_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

/// @title Treasury Interface
/// @author CAREL Team
/// @notice Minimal treasury interface used by fee collector.
/// @dev Keeps dependency surface small for fee routing.
#[starknet::interface]
pub trait ITreasury<TContractState> {
    /// @notice Receives a fee transfer from the fee collector.
    /// @dev Called after calculating fee splits.
    /// @param amount Fee amount to record.
    fn receive_fee(ref self: TContractState, amount: u256);
}

/// @title Fee Collector Contract
/// @author CAREL Team
/// @notice Calculates and routes protocol fees for swaps and bridges.
/// @dev Stores fee configuration and provider accounting.
#[starknet::contract]
pub mod FeeCollector {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use core::num::traits::Zero;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_FEE;
    
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
        pub dev_fund_address: ContractAddress,
        pub swap_fee_rate: u256,
        pub bridge_fee_rate: u256,
        pub mev_fee_rate: u256,
        pub lp_share_swap: u256,
        pub treasury_share_swap: u256,
        pub bridge_provider_share: u256,
        pub bridge_dev_share: u256,
        pub lp_fees: Map<ContractAddress, u256>,
        pub bridge_provider_fees: Map<ContractAddress, u256>,
        pub bridge_dev_fees: u256,
        pub privacy_router: ContractAddress,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        FeeCollected: FeeCollected,
        RatesUpdated: RatesUpdated,
        BridgeFeeSplit: BridgeFeeSplit,
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

    #[derive(Drop, starknet::Event)]
    pub struct BridgeFeeSplit {
        pub provider: ContractAddress,
        pub provider_fee: u256,
        pub dev_fee: u256
    }

    /// @notice Initializes the fee collector.
    /// @dev Sets admin, treasury, and default fee rates.
    /// @param admin Owner/admin address.
    /// @param treasury Treasury contract address.
    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        treasury: ContractAddress
    ) {
        self.ownable.initializer(admin);
        self.treasury_address.write(treasury);
        self.dev_fund_address.write(treasury);

        // Default fee configurations
        self.swap_fee_rate.write(30);
        self.bridge_fee_rate.write(40);
        self.mev_fee_rate.write(15);
        self.lp_share_swap.write(20);
        self.treasury_share_swap.write(10);
        self.bridge_provider_share.write(30);
        self.bridge_dev_share.write(10);
    }

    #[abi(embed_v0)]
    impl FeeCollectorImpl of super::IFeeCollector<ContractState> {
        /// @notice Collects swap fee and routes LP/treasury shares.
        /// @dev Calculates fee using configured swap rate.
        /// @param amount Swap amount subject to fees.
        /// @param lp_address LP recipient address.
        fn collect_swap_fee(ref self: ContractState, amount: u256, lp_address: ContractAddress) {
            let total_fee = (amount * self.swap_fee_rate.read()) / BPS_DENOMINATOR;
            let lp_part = (total_fee * self.lp_share_swap.read()) / (self.lp_share_swap.read() + self.treasury_share_swap.read());
            let treasury_part = total_fee - lp_part;

            let treasury = ITreasuryDispatcher { contract_address: self.treasury_address.read() };
            treasury.receive_fee(treasury_part);

            let current_lp = self.lp_fees.entry(lp_address).read();
            self.lp_fees.entry(lp_address).write(current_lp + lp_part);
            
            self.emit(Event::FeeCollected(FeeCollected { category: 'SWAP', total_amount: total_fee, treasury_part }));
        }

        /// @notice Collects bridge fee and records provider/dev shares.
        /// @dev Tracks provider fees for later settlement.
        /// @param amount Bridged amount subject to fees.
        /// @param provider Bridge provider address.
        fn collect_bridge_fee(ref self: ContractState, amount: u256, provider: ContractAddress) {
            let total_fee = (amount * self.bridge_fee_rate.read()) / BPS_DENOMINATOR;
            let provider_fee = (amount * self.bridge_provider_share.read()) / BPS_DENOMINATOR;
            let dev_fee = total_fee - provider_fee;

            let current = self.bridge_provider_fees.entry(provider).read();
            self.bridge_provider_fees.entry(provider).write(current + provider_fee);
            self.bridge_dev_fees.write(self.bridge_dev_fees.read() + dev_fee);

            self.emit(Event::FeeCollected(FeeCollected { category: 'BRIDGE', total_amount: total_fee, treasury_part: dev_fee }));
            self.emit(Event::BridgeFeeSplit(BridgeFeeSplit { provider, provider_fee, dev_fee }));
        }

        /// @notice Collects MEV protection fee when enabled.
        /// @dev Skips fee when user opts out.
        /// @param amount Amount subject to fee.
        /// @param user_enabled Whether MEV protection is enabled.
        fn collect_mev_fee(ref self: ContractState, amount: u256, user_enabled: bool) {
            if !user_enabled { return; }
            
            let total_fee = (amount * self.mev_fee_rate.read()) / BPS_DENOMINATOR;
            
            let treasury = ITreasuryDispatcher { contract_address: self.treasury_address.read() };
            treasury.receive_fee(total_fee);

            self.emit(Event::FeeCollected(FeeCollected { category: 'MEV', total_amount: total_fee, treasury_part: total_fee }));
        }

        /// @notice Updates fee rates and swap share splits.
        /// @dev Owner-only to prevent unauthorized fee changes.
        /// @param swap_rate Swap fee rate in bps.
        /// @param bridge_rate Bridge fee rate in bps.
        /// @param mev_rate MEV fee rate in bps.
        /// @param lp_share LP share of swap fee in bps.
        /// @param treasury_share Treasury share of swap fee in bps.
        fn update_fee_rates(
            ref self: ContractState, 
            swap_rate: u256, 
            bridge_rate: u256, 
            mev_rate: u256,
            lp_share: u256,
            treasury_share: u256
        ) {
            self.ownable.assert_only_owner();
            assert!(swap_rate <= 10000, "Swap fee too high");
            assert!(bridge_rate <= 10000, "Bridge fee too high");
            assert!(mev_rate <= 10000, "MEV fee too high");
            assert!(lp_share + treasury_share == swap_rate, "Invalid swap split");
            
            self.swap_fee_rate.write(swap_rate);
            self.bridge_fee_rate.write(bridge_rate);
            self.mev_fee_rate.write(mev_rate);
            self.lp_share_swap.write(lp_share);
            self.treasury_share_swap.write(treasury_share);

            self.emit(Event::RatesUpdated(RatesUpdated { swap_rate, bridge_rate }));
        }

        /// @notice Sets bridge fee split and dev fund address.
        /// @dev Owner-only to keep bridge economics consistent.
        /// @param provider_share_bps Provider share in bps.
        /// @param dev_share_bps Dev fund share in bps.
        /// @param dev_fund Dev fund address.
        fn set_bridge_fee_split(
            ref self: ContractState,
            provider_share_bps: u256,
            dev_share_bps: u256,
            dev_fund: ContractAddress
        ) {
            self.ownable.assert_only_owner();
            assert!(!dev_fund.is_zero(), "Dev fund required");
            assert!(provider_share_bps + dev_share_bps == self.bridge_fee_rate.read(), "Invalid bridge split");
            self.bridge_provider_share.write(provider_share_bps);
            self.bridge_dev_share.write(dev_share_bps);
            self.dev_fund_address.write(dev_fund);
        }

        /// @notice Returns the treasury address used for fee routing.
        /// @dev Read-only helper for integrations.
        /// @return treasury Treasury address.
        fn get_treasury_address(self: @ContractState) -> ContractAddress {
            self.treasury_address.read()
        }

        /// @notice Returns accumulated LP fees for an address.
        /// @dev Read-only helper for off-chain settlement.
        /// @param lp LP address.
        /// @return amount Accumulated LP fee amount.
        fn get_lp_fees(self: @ContractState, lp: ContractAddress) -> u256 {
            self.lp_fees.entry(lp).read()
        }
    }

    #[abi(embed_v0)]
    impl FeeCollectorPrivacyImpl of super::IFeeCollectorPrivacy<ContractState> {
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        fn submit_private_fee_action(
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
                ACTION_FEE,
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
