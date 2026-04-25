use starknet::ContractAddress;

// Defines fee collection and configuration entrypoints.
// Used by swap/bridge modules to route protocol fees.
#[starknet::interface]
pub trait IFeeCollector<TContractState> {
    // Implements collect swap fee logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn collect_swap_fee(
        ref self: TContractState,
        token: ContractAddress,
        amount: u256,
        lp_address: ContractAddress
    );
    // Implements collect bridge fee logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn collect_bridge_fee(
        ref self: TContractState,
        token: ContractAddress,
        amount: u256,
        provider: ContractAddress
    );
    // Implements collect mev fee logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn collect_mev_fee(
        ref self: TContractState,
        token: ContractAddress,
        amount: u256,
        user_enabled: bool
    );
    // Updates fee rates configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn update_fee_rates(
        ref self: TContractState, 
        swap_rate: u256, 
        bridge_rate: u256, 
        mev_rate: u256,
        lp_share: u256,
        treasury_share: u256
    );
    // Authorizes or revokes a router to call collect_* functions.
    fn set_authorized_router(ref self: TContractState, router: ContractAddress, authorized: bool);
    // Updates bridge fee split configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_bridge_fee_split(
        ref self: TContractState,
        provider_share_bps: u256,
        dev_share_bps: u256,
        dev_fund: ContractAddress
    );
    // Returns get treasury address from state without mutating storage.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn get_treasury_address(self: @TContractState) -> ContractAddress;
    // Returns get lp fees from state without mutating storage.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn get_lp_fees(self: @TContractState, lp: ContractAddress, token: ContractAddress) -> u256;
    // Sets CAREL token address used for buyback & burn.
    fn set_carel_token(ref self: TContractState, token: ContractAddress);
    // Governance buyback: swap non-CAREL to CAREL and burn.
    fn buyback_and_burn(
        ref self: TContractState,
        token: ContractAddress,
        amount: u256,
        min_carel_out: u256,
        dex_router: ContractAddress
    );
}

// ZK privacy entrypoints for fee actions.
#[starknet::interface]
pub trait IFeeCollectorPrivacy<TContractState> {
    // Updates privacy router configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    // Applies submit private fee action after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
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

// Minimal treasury interface used by fee collector.
// Keeps dependency surface small for fee routing.
#[starknet::interface]
pub trait ITreasury<TContractState> {
    // Implements receive fee logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn receive_fee(ref self: TContractState, token: ContractAddress, amount: u256);
    // Emergency withdrawal hook for governance buyback flow.
    fn withdraw_emergency(ref self: TContractState, token: ContractAddress, amount: u256);
}

// Minimal ERC20 for approvals and balance checks during buyback.
#[starknet::interface]
pub trait IERC20<TContractState> {
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
    fn burn(ref self: TContractState, amount: u256);
}

// Minimal DEX router interface for buyback swaps.
#[starknet::interface]
pub trait IDEXRouter<TContractState> {
    fn swap(
        ref self: TContractState,
        from_token: ContractAddress,
        to_token: ContractAddress,
        amount: u256,
        min_amount_out: u256
    );
}

// Calculates and routes protocol fees for swaps and bridges.
// Stores fee configuration and provider accounting.
#[starknet::contract]
pub mod FeeCollector {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::storage::*;
    use core::num::traits::Zero;
    use crate::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy_action_types::ACTION_FEE;
    
    // OpenZeppelin component for ownership management
    use openzeppelin::access::ownable::OwnableComponent;
    use super::{
        ITreasuryDispatcher, ITreasuryDispatcherTrait, IERC20Dispatcher, IERC20DispatcherTrait,
        IDEXRouterDispatcher, IDEXRouterDispatcherTrait
    };

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    const BPS_DENOMINATOR: u256 = 10000;

    #[storage]
    pub struct Storage {
        pub treasury_address: ContractAddress,
        pub carel_token: ContractAddress,
        pub dev_fund_address: ContractAddress,
        pub swap_fee_rate: u256,
        pub bridge_fee_rate: u256,
        pub mev_fee_rate: u256,
        pub lp_share_swap: u256,
        pub treasury_share_swap: u256,
        pub bridge_provider_share: u256,
        pub bridge_dev_share: u256,
        pub authorized_routers: Map<ContractAddress, bool>,
        pub lp_fees: Map<(ContractAddress, ContractAddress), u256>,
        pub bridge_provider_fees: Map<(ContractAddress, ContractAddress), u256>,
        pub bridge_dev_fees: Map<ContractAddress, u256>,
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
        BuybackAndBurn: BuybackAndBurn,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct FeeCollected {
        pub category: felt252,
        pub token: ContractAddress,
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
        pub token: ContractAddress,
        pub provider: ContractAddress,
        pub provider_fee: u256,
        pub dev_fee: u256
    }

    #[derive(Drop, starknet::Event)]
    pub struct BuybackAndBurn {
        pub token_in: ContractAddress,
        pub amount_in: u256,
        pub carel_burned: u256
    }

    // Initializes the fee collector.
    // Sets admin, treasury, and default fee rates.
    // `admin` becomes owner and `treasury` receives collected protocol fees.
    #[constructor]
    // Initializes storage and role configuration during deployment.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        treasury: ContractAddress
    ) {
        self.ownable.initializer(admin);
        self.treasury_address.write(treasury);
        self.carel_token.write(0.try_into().unwrap());
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
        // Implements collect swap fee logic while keeping state transitions deterministic.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn collect_swap_fee(
            ref self: ContractState,
            token: ContractAddress,
            amount: u256,
            lp_address: ContractAddress
        ) {
            let caller = get_caller_address();
            assert!(self.authorized_routers.entry(caller).read(), "Not authorized");
            let total_fee = (amount * self.swap_fee_rate.read()) / BPS_DENOMINATOR;
            let lp_part = (total_fee * self.lp_share_swap.read()) / (self.lp_share_swap.read() + self.treasury_share_swap.read());
            let treasury_part = total_fee - lp_part;

            let treasury = ITreasuryDispatcher { contract_address: self.treasury_address.read() };
            treasury.receive_fee(token, treasury_part);

            let current_lp = self.lp_fees.entry((lp_address, token)).read();
            self.lp_fees.entry((lp_address, token)).write(current_lp + lp_part);
            
            self.emit(Event::FeeCollected(FeeCollected { category: 'SWAP', token, total_amount: total_fee, treasury_part }));
        }

        // Implements collect bridge fee logic while keeping state transitions deterministic.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn collect_bridge_fee(
            ref self: ContractState,
            token: ContractAddress,
            amount: u256,
            provider: ContractAddress
        ) {
            let caller = get_caller_address();
            assert!(self.authorized_routers.entry(caller).read(), "Not authorized");
            let total_fee = (amount * self.bridge_fee_rate.read()) / BPS_DENOMINATOR;
            let provider_share = self.bridge_provider_share.read();
            assert!(provider_share <= self.bridge_fee_rate.read(), "Invalid bridge split");
            let provider_fee = (total_fee * provider_share) / self.bridge_fee_rate.read();
            let dev_fee = total_fee - provider_fee;

            let current = self.bridge_provider_fees.entry((provider, token)).read();
            self.bridge_provider_fees.entry((provider, token)).write(current + provider_fee);
            let current_dev = self.bridge_dev_fees.entry(token).read();
            self.bridge_dev_fees.entry(token).write(current_dev + dev_fee);

            self.emit(Event::FeeCollected(FeeCollected { category: 'BRIDGE', token, total_amount: total_fee, treasury_part: dev_fee }));
            self.emit(Event::BridgeFeeSplit(BridgeFeeSplit { token, provider, provider_fee, dev_fee }));
        }

        // Implements collect mev fee logic while keeping state transitions deterministic.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn collect_mev_fee(
            ref self: ContractState,
            token: ContractAddress,
            amount: u256,
            user_enabled: bool
        ) {
            if !user_enabled { return; }
            let caller = get_caller_address();
            assert!(self.authorized_routers.entry(caller).read(), "Not authorized");
            
            let total_fee = (amount * self.mev_fee_rate.read()) / BPS_DENOMINATOR;
            
            let treasury = ITreasuryDispatcher { contract_address: self.treasury_address.read() };
            treasury.receive_fee(token, total_fee);

            self.emit(Event::FeeCollected(FeeCollected { category: 'MEV', token, total_amount: total_fee, treasury_part: total_fee }));
        }

        // Updates fee rates configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
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
            assert!(self.bridge_provider_share.read() + self.bridge_dev_share.read() == bridge_rate, "Invalid bridge split");
            
            self.swap_fee_rate.write(swap_rate);
            self.bridge_fee_rate.write(bridge_rate);
            self.mev_fee_rate.write(mev_rate);
            self.lp_share_swap.write(lp_share);
            self.treasury_share_swap.write(treasury_share);

            self.emit(Event::RatesUpdated(RatesUpdated { swap_rate, bridge_rate }));
        }

        // Updates bridge fee split configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
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

        // Authorizes or revokes a router to call collect_* functions.
        fn set_authorized_router(ref self: ContractState, router: ContractAddress, authorized: bool) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Router required");
            self.authorized_routers.entry(router).write(authorized);
        }

        // Returns get treasury address from state without mutating storage.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn get_treasury_address(self: @ContractState) -> ContractAddress {
            self.treasury_address.read()
        }

        // Returns get lp fees from state without mutating storage.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn get_lp_fees(self: @ContractState, lp: ContractAddress, token: ContractAddress) -> u256 {
            self.lp_fees.entry((lp, token)).read()
        }

        fn set_carel_token(ref self: ContractState, token: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!token.is_zero(), "Token required");
            self.carel_token.write(token);
        }

        fn buyback_and_burn(
            ref self: ContractState,
            token: ContractAddress,
            amount: u256,
            min_carel_out: u256,
            dex_router: ContractAddress
        ) {
            self.ownable.assert_only_owner();
            let carel_token = self.carel_token.read();
            assert!(!carel_token.is_zero(), "CAREL token not set");
            assert!(token != carel_token, "Use burn_excess for CAREL");
            assert!(!dex_router.is_zero(), "Router required");

            let treasury = ITreasuryDispatcher { contract_address: self.treasury_address.read() };
            treasury.withdraw_emergency(token, amount);

            let token_disp = IERC20Dispatcher { contract_address: token };
            let ok = token_disp.approve(dex_router, amount);
            assert!(ok, "Approve failed");

            let carel_disp = IERC20Dispatcher { contract_address: carel_token };
            let before = carel_disp.balance_of(starknet::get_contract_address());
            let router = IDEXRouterDispatcher { contract_address: dex_router };
            router.swap(token, carel_token, amount, min_carel_out);
            let after = carel_disp.balance_of(starknet::get_contract_address());
            let received = after - before;
            assert!(received >= min_carel_out, "Insufficient CAREL out");
            carel_disp.burn(received);

            self.emit(Event::BuybackAndBurn(BuybackAndBurn {
                token_in: token,
                amount_in: amount,
                carel_burned: received
            }));
        }
    }

    #[abi(embed_v0)]
    impl FeeCollectorPrivacyImpl of super::IFeeCollectorPrivacy<ContractState> {
        // Updates privacy router configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        // Applies submit private fee action after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
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
