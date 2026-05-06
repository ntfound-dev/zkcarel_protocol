use starknet::ContractAddress;

/// @notice Defines fee collection and configuration entrypoints.
/// @dev Used by swap/bridge modules to route protocol fees.
#[starknet::interface]
pub trait IFeeCollector<TContractState> {
    /// @notice Collects a swap fee and splits it between the LP and treasury.
    /// @param token Address of the token in which the fee is denominated.
    /// @param amount Gross swap amount (fee is calculated internally).
    /// @param lp_address Address of the liquidity provider receiving the LP share.
    fn collect_swap_fee(
        ref self: TContractState,
        token: ContractAddress,
        amount: u256,
        lp_address: ContractAddress
    );

    /// @notice Collects a bridge fee and splits it between provider and dev fund.
    /// @param token Address of the token in which the fee is denominated.
    /// @param amount Gross bridge amount (fee is calculated internally).
    /// @param provider Address of the bridge provider receiving the provider share.
    fn collect_bridge_fee(
        ref self: TContractState,
        token: ContractAddress,
        amount: u256,
        provider: ContractAddress
    );

    /// @notice Collects an MEV fee and routes the full amount to the treasury.
    /// @param token Address of the token in which the fee is denominated.
    /// @param amount Gross amount subject to the MEV fee.
    /// @param user_enabled Whether the caller has opted in to MEV fee collection.
    fn collect_mev_fee(
        ref self: TContractState,
        token: ContractAddress,
        amount: u256,
        user_enabled: bool
    );

    /// @notice Updates swap, bridge, and MEV fee rates.
    /// @dev `lp_share + treasury_share` must be <= `swap_rate`.
    /// @param swap_rate New swap fee rate in basis points.
    /// @param bridge_rate New bridge fee rate in basis points.
    /// @param mev_rate New MEV fee rate in basis points.
    /// @param lp_share LP portion of the swap fee in basis points.
    /// @param treasury_share Treasury portion of the swap fee in basis points.
    fn update_fee_rates(
        ref self: TContractState,
        swap_rate: u256,
        bridge_rate: u256,
        mev_rate: u256,
        lp_share: u256,
        treasury_share: u256
    );

    /// @notice Authorises or revokes a router to call collect_* functions.
    /// @dev Emits RouterUpdated. Only callable by owner.
    /// @param router Address of the router contract.
    /// @param authorized Whether the router is authorised.
    fn set_authorized_router(ref self: TContractState, router: ContractAddress, authorized: bool);

    /// @notice Updates bridge fee split between provider and dev fund.
    /// @param provider_share_bps Provider portion in basis points.
    /// @param dev_share_bps Developer fund portion in basis points.
    /// @param dev_fund Address of the developer fund.
    fn set_bridge_fee_split(
        ref self: TContractState,
        provider_share_bps: u256,
        dev_share_bps: u256,
        dev_fund: ContractAddress
    );

    /// @notice Returns the configured treasury address.
    /// @return Address of the treasury contract.
    fn get_treasury_address(self: @TContractState) -> ContractAddress;

    /// @notice Returns accumulated LP fees for a given LP and token pair.
    /// @param lp LP provider address.
    /// @param token Token address.
    /// @return Accumulated fee balance for the (lp, token) pair.
    fn get_lp_fees(self: @TContractState, lp: ContractAddress, token: ContractAddress) -> u256;

    /// @notice Sets the CAREL token address used for buyback and burn.
    /// @dev Emits CarelTokenUpdated. Only callable by owner.
    /// @param token Address of the CAREL token contract.
    fn set_carel_token(ref self: TContractState, token: ContractAddress);

    /// @notice Triggers a governance buyback: swaps non-CAREL tokens to CAREL and burns them.
    /// @param token Address of the token to spend.
    /// @param amount Amount of `token` to spend.
    /// @param min_carel_out Minimum CAREL tokens expected from the swap.
    /// @param dex_router Address of the DEX router executing the swap.
    fn buyback_and_burn(
        ref self: TContractState,
        token: ContractAddress,
        amount: u256,
        min_carel_out: u256,
        dex_router: ContractAddress
    );

    /// @notice Collects an AI execution fee using the hybrid 3-component model (v6).
    /// @dev Component ①: flat CAREL burn. ② USD-target in CAREL → treasury. ③ 25% of ② → buyback fund.
    /// @dev User must have pre-approved this contract to spend the required CAREL amount.
    /// @param is_l3 True for L3 (cross-chain) execution, false for L2.
    /// @param user Address paying the fee (must have approved this contract).
    fn collect_ai_fee(ref self: TContractState, is_l3: bool, user: ContractAddress);

    /// @notice Updates AI fee parameters.
    /// @param flat_burn_l2 Flat CAREL burned per L2 AI tx (18-decimal).
    /// @param flat_burn_l3 Flat CAREL burned per L3 AI tx (18-decimal).
    /// @param usd_target_l2 USD-denominated target for L2 component ② in 6-decimal (e.g. 300000 = $0.30).
    /// @param usd_target_l3 USD-denominated target for L3 component ② in 6-decimal (e.g. 500000 = $0.50).
    /// @param oracle Address of the Pragma price oracle.
    /// @param buyback_share_bps BPS of component ② allocated to epoch buyback fund (default 2500 = 25%).
    /// @param epoch_seconds Duration of one buyback epoch in seconds (default 604800 = 1 week).
    fn set_ai_fee_config(
        ref self: TContractState,
        flat_burn_l2: u256,
        flat_burn_l3: u256,
        usd_target_l2: u256,
        usd_target_l3: u256,
        oracle: ContractAddress,
        buyback_share_bps: u256,
        epoch_seconds: u64
    );

    /// @notice Executes the epoch buy-back-burn using accumulated component ③ funds.
    /// @dev Callable by owner or keeper once per epoch. Swaps accumulated CAREL and burns output.
    /// @param min_carel_out Slippage guard: minimum CAREL to receive from the swap.
    /// @param dex_router DEX router address for the swap.
    fn execute_ai_buyback_epoch(
        ref self: TContractState,
        min_carel_out: u256,
        dex_router: ContractAddress
    );

    /// @notice Returns CAREL accumulated in the epoch buyback fund.
    fn get_ai_epoch_buyback_fund(self: @TContractState) -> u256;
}

/// @notice ZK privacy entrypoints for fee actions.
#[starknet::interface]
pub trait IFeeCollectorPrivacy<TContractState> {
    /// @notice Sets the privacy router contract address.
    /// @param router Address of the deployed privacy router.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);

    /// @notice Submits a ZK-proven private fee action to the privacy router.
    /// @param old_root Merkle root before this action.
    /// @param new_root Merkle root after this action.
    /// @param nullifiers Span of nullifiers preventing double-spend.
    /// @param commitments Span of new Pedersen commitments.
    /// @param public_inputs Public inputs consumed by the ZK verifier.
    /// @param proof Serialised ZK proof bytes.
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

/// @notice Minimal treasury interface used by fee collector.
/// @dev Keeps dependency surface small for fee routing.
#[starknet::interface]
pub trait ITreasury<TContractState> {
    /// @notice Routes a collected fee to the treasury.
    fn receive_fee(ref self: TContractState, token: ContractAddress, amount: u256);

    /// @notice Emergency withdrawal hook for governance buyback flow.
    fn withdraw_emergency(ref self: TContractState, token: ContractAddress, amount: u256);
}

/// @notice Minimal ERC20 interface for approvals and balance checks during buyback.
#[starknet::interface]
pub trait IERC20<TContractState> {
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TContractState,
        sender: ContractAddress,
        recipient: ContractAddress,
        amount: u256
    ) -> bool;
    fn burn(ref self: TContractState, amount: u256);
}

/// @notice Minimal Pragma-compatible price oracle interface.
/// @dev Returns CAREL/USD price as (price, decimals) — e.g. (20_000_000, 8) = $0.20.
#[starknet::interface]
pub trait IPriceOracle<TContractState> {
    fn get_carel_usd(self: @TContractState) -> (u128, u32);
}

/// @notice Minimal DEX router interface for buyback swaps.
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

/// @notice Calculates and routes protocol fees for swaps and bridges.
/// @dev Stores fee configuration and provider accounting.
#[starknet::contract]
pub mod FeeCollector {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;
    use starknet::storage::*;
    use core::num::traits::Zero;
    use core::traits::TryInto;
    use crate::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy_action_types::ACTION_FEE;

    use openzeppelin::access::ownable::OwnableComponent;
    use super::{
        ITreasuryDispatcher, ITreasuryDispatcherTrait, IERC20Dispatcher, IERC20DispatcherTrait,
        IDEXRouterDispatcher, IDEXRouterDispatcherTrait,
        IPriceOracleDispatcher, IPriceOracleDispatcherTrait
    };

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableTwoStepImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    const BPS_DENOMINATOR: u256 = 10000;
    const ONE_TOKEN: u256 = 1_000_000_000_000_000_000_u256;
    // USD values stored with 6 decimal places (e.g. 300_000 = $0.30)
    const USD_DECIMALS: u32 = 6;

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
        // AI fee hybrid model (v6)
        pub ai_flat_burn_l2: u256,
        pub ai_flat_burn_l3: u256,
        pub ai_usd_target_l2: u256,
        pub ai_usd_target_l3: u256,
        pub ai_oracle: ContractAddress,
        pub ai_buyback_share_bps: u256,
        pub ai_epoch_seconds: u64,
        pub ai_epoch_start: u64,
        pub ai_buyback_fund: u256,
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
        RouterUpdated: RouterUpdated,
        CarelTokenUpdated: CarelTokenUpdated,
        AiFeeCollected: AiFeeCollected,
        AiBuybackExecuted: AiBuybackExecuted,
        AiFeeConfigUpdated: AiFeeConfigUpdated,
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

    #[derive(Drop, starknet::Event)]
    pub struct RouterUpdated {
        pub router: ContractAddress,
        pub authorized: bool
    }

    #[derive(Drop, starknet::Event)]
    pub struct CarelTokenUpdated {
        pub token: ContractAddress
    }

    #[derive(Drop, starknet::Event)]
    pub struct AiFeeCollected {
        pub user: ContractAddress,
        pub is_l3: bool,
        pub flat_burned: u256,
        pub usd_target_carel: u256,
        pub buyback_allocated: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AiBuybackExecuted {
        pub epoch_start: u64,
        pub carel_input: u256,
        pub carel_burned: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AiFeeConfigUpdated {
        pub flat_burn_l2: u256,
        pub flat_burn_l3: u256,
        pub usd_target_l2: u256,
        pub usd_target_l3: u256,
        pub buyback_share_bps: u256,
    }

    /// @notice Initializes the fee collector.
    /// @dev Sets admin, treasury, and default fee rates.
    /// @param admin Address that becomes owner.
    /// @param treasury Address of the treasury contract receiving protocol fees.
    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        treasury: ContractAddress
    ) {
        self.ownable.initializer(admin);
        self.treasury_address.write(treasury);
        self.carel_token.write(0.try_into().unwrap());
        self.dev_fund_address.write(treasury);

        self.swap_fee_rate.write(30);
        self.bridge_fee_rate.write(40);
        self.mev_fee_rate.write(15);
        self.lp_share_swap.write(20);
        self.treasury_share_swap.write(10);
        self.bridge_provider_share.write(30);
        self.bridge_dev_share.write(10);

        // AI hybrid fee defaults (v6)
        self.ai_flat_burn_l2.write(2 * ONE_TOKEN);       // 2 CAREL flat burn, L2
        self.ai_flat_burn_l3.write(3 * ONE_TOKEN);       // 3 CAREL flat burn, L3
        self.ai_usd_target_l2.write(300_000_u256);       // $0.30 in 6-decimal
        self.ai_usd_target_l3.write(500_000_u256);       // $0.50 in 6-decimal
        self.ai_buyback_share_bps.write(2500_u256);      // 25% of component ② → buyback
        self.ai_epoch_seconds.write(604800_u64);          // 1 week epoch
        self.ai_epoch_start.write(starknet::get_block_timestamp());
        self.ai_buyback_fund.write(0_u256);
    }

    #[abi(embed_v0)]
    impl FeeCollectorImpl of super::IFeeCollector<ContractState> {
        /// @notice Collects a swap fee and splits it between the LP and treasury.
        /// @dev Caller must be an authorised router.
        /// @param token Address of the fee token.
        /// @param amount Gross swap amount.
        /// @param lp_address LP provider address for the LP share.
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

        /// @notice Collects a bridge fee and splits it between provider and dev fund.
        /// @dev Caller must be an authorised router.
        /// @param token Address of the fee token.
        /// @param amount Gross bridge amount.
        /// @param provider Bridge provider address.
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

        /// @notice Collects an MEV fee and routes the full amount to the treasury.
        /// @dev No-op if `user_enabled` is false. Caller must be an authorised router.
        /// @param token Address of the fee token.
        /// @param amount Gross amount subject to the MEV fee.
        /// @param user_enabled Whether the caller has opted in.
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

        /// @notice Updates swap, bridge, and MEV fee rates.
        /// @dev `lp_share + treasury_share` must be <= `swap_rate`. Only callable by owner.
        /// @param swap_rate New swap fee rate in basis points.
        /// @param bridge_rate New bridge fee rate in basis points.
        /// @param mev_rate New MEV fee rate in basis points.
        /// @param lp_share LP portion of the swap fee in basis points.
        /// @param treasury_share Treasury portion of the swap fee in basis points.
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
            assert!(lp_share + treasury_share <= swap_rate, "Invalid swap split");
            assert!(self.bridge_provider_share.read() + self.bridge_dev_share.read() == bridge_rate, "Invalid bridge split");

            self.swap_fee_rate.write(swap_rate);
            self.bridge_fee_rate.write(bridge_rate);
            self.mev_fee_rate.write(mev_rate);
            self.lp_share_swap.write(lp_share);
            self.treasury_share_swap.write(treasury_share);

            self.emit(Event::RatesUpdated(RatesUpdated { swap_rate, bridge_rate }));
        }

        /// @notice Updates bridge fee split between provider and dev fund.
        /// @param provider_share_bps Provider portion in basis points.
        /// @param dev_share_bps Developer fund portion in basis points.
        /// @param dev_fund Address of the developer fund (must be non-zero).
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

        /// @notice Authorises or revokes a router to call collect_* functions.
        /// @dev Emits RouterUpdated. Only callable by owner.
        /// @param router Address of the router contract (must be non-zero).
        /// @param authorized Whether the router is authorised.
        fn set_authorized_router(ref self: ContractState, router: ContractAddress, authorized: bool) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Router required");
            self.authorized_routers.entry(router).write(authorized);
            self.emit(Event::RouterUpdated(RouterUpdated { router, authorized }));
        }

        /// @notice Returns the configured treasury address.
        /// @return Address of the treasury contract.
        fn get_treasury_address(self: @ContractState) -> ContractAddress {
            self.treasury_address.read()
        }

        /// @notice Returns accumulated LP fees for a given LP and token pair.
        /// @param lp LP provider address.
        /// @param token Token address.
        /// @return Accumulated fee balance for the (lp, token) pair.
        fn get_lp_fees(self: @ContractState, lp: ContractAddress, token: ContractAddress) -> u256 {
            self.lp_fees.entry((lp, token)).read()
        }

        /// @notice Sets the CAREL token address used for buyback and burn.
        /// @dev Emits CarelTokenUpdated. Only callable by owner.
        /// @param token Address of the CAREL token contract (must be non-zero).
        fn set_carel_token(ref self: ContractState, token: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!token.is_zero(), "Token required");
            self.carel_token.write(token);
            self.emit(Event::CarelTokenUpdated(CarelTokenUpdated { token }));
        }

        /// @notice Triggers a governance buyback: swaps non-CAREL tokens to CAREL and burns them.
        /// @dev Only callable by owner. Pulls tokens via treasury emergency withdrawal then swaps.
        /// @param token Address of the token to spend.
        /// @param amount Amount of `token` to spend.
        /// @param min_carel_out Minimum CAREL tokens expected from the swap (slippage guard).
        /// @param dex_router Address of the DEX router executing the swap.
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

        /// @notice Collects an AI execution fee: hybrid 3-component model (v6).
        /// @dev ① flat CAREL burned directly. ② USD-target CAREL sent to treasury. ③ 25% of ② → buyback fund.
        /// @dev User must have pre-approved this contract for at least flat_burn + usd_target_carel amount.
        fn collect_ai_fee(ref self: ContractState, is_l3: bool, user: ContractAddress) {
            let caller = get_caller_address();
            assert!(self.authorized_routers.entry(caller).read(), "Not authorized");

            let carel_token = self.carel_token.read();
            assert!(!carel_token.is_zero(), "CAREL token not set");

            let oracle_addr = self.ai_oracle.read();
            assert!(!oracle_addr.is_zero(), "Oracle not set");

            // Component ①: flat burn
            let flat_burn = if is_l3 {
                self.ai_flat_burn_l3.read()
            } else {
                self.ai_flat_burn_l2.read()
            };

            // Component ②: USD-target converted to CAREL via oracle
            let usd_target = if is_l3 {
                self.ai_usd_target_l3.read()
            } else {
                self.ai_usd_target_l2.read()
            };

            let oracle = IPriceOracleDispatcher { contract_address: oracle_addr };
            let (price, oracle_decimals) = oracle.get_carel_usd();
            assert!(price > 0, "Oracle price zero");

            // carel_amount = usd_target * 10^(oracle_decimals - USD_DECIMALS) * ONE_TOKEN / price
            let decimal_shift: u256 = pow10(oracle_decimals - USD_DECIMALS);
            let usd_target_carel = (usd_target * decimal_shift * ONE_TOKEN) / price.into();

            let carel_disp = IERC20Dispatcher { contract_address: carel_token };
            let this = starknet::get_contract_address();

            // Pull flat burn from user and burn immediately
            let ok1 = carel_disp.transfer_from(user, this, flat_burn);
            assert!(ok1, "Transfer flat burn failed");
            carel_disp.burn(flat_burn);

            // Pull USD-target component from user
            let ok2 = carel_disp.transfer_from(user, this, usd_target_carel);
            assert!(ok2, "Transfer usd-target failed");

            // Split: buyback_share goes to fund, rest goes to treasury
            let buyback_alloc = (usd_target_carel * self.ai_buyback_share_bps.read()) / BPS_DENOMINATOR;
            let treasury_part = usd_target_carel - buyback_alloc;

            let current_fund = self.ai_buyback_fund.read();
            self.ai_buyback_fund.write(current_fund + buyback_alloc);

            // Notify treasury for accounting (tokens held in fee_collector, matching existing pattern)
            let treasury = ITreasuryDispatcher { contract_address: self.treasury_address.read() };
            treasury.receive_fee(carel_token, treasury_part);

            self.emit(Event::AiFeeCollected(AiFeeCollected {
                user,
                is_l3,
                flat_burned: flat_burn,
                usd_target_carel,
                buyback_allocated: buyback_alloc,
            }));
        }

        /// @notice Updates AI fee parameters. Only callable by owner.
        fn set_ai_fee_config(
            ref self: ContractState,
            flat_burn_l2: u256,
            flat_burn_l3: u256,
            usd_target_l2: u256,
            usd_target_l3: u256,
            oracle: ContractAddress,
            buyback_share_bps: u256,
            epoch_seconds: u64
        ) {
            self.ownable.assert_only_owner();
            assert!(buyback_share_bps <= BPS_DENOMINATOR, "Invalid buyback share");
            assert!(!oracle.is_zero(), "Oracle required");
            assert!(epoch_seconds > 0, "Epoch too short");

            self.ai_flat_burn_l2.write(flat_burn_l2);
            self.ai_flat_burn_l3.write(flat_burn_l3);
            self.ai_usd_target_l2.write(usd_target_l2);
            self.ai_usd_target_l3.write(usd_target_l3);
            self.ai_oracle.write(oracle);
            self.ai_buyback_share_bps.write(buyback_share_bps);
            self.ai_epoch_seconds.write(epoch_seconds);

            self.emit(Event::AiFeeConfigUpdated(AiFeeConfigUpdated {
                flat_burn_l2,
                flat_burn_l3,
                usd_target_l2,
                usd_target_l3,
                buyback_share_bps,
            }));
        }

        /// @notice Executes epoch buyback-burn using accumulated component ③ fund.
        /// @dev Once per epoch. Burns all accumulated CAREL directly (already in contract).
        fn execute_ai_buyback_epoch(
            ref self: ContractState,
            min_carel_out: u256,
            dex_router: ContractAddress
        ) {
            self.ownable.assert_only_owner();
            let now = get_block_timestamp();
            let epoch_start = self.ai_epoch_start.read();
            let epoch_len = self.ai_epoch_seconds.read();
            assert!(now >= epoch_start + epoch_len, "Epoch not finished");

            let fund = self.ai_buyback_fund.read();
            assert!(fund > 0, "No buyback fund");
            assert!(fund >= min_carel_out, "Fund below minimum");

            let carel_token = self.carel_token.read();
            let carel_disp = IERC20Dispatcher { contract_address: carel_token };

            // Fund is already CAREL held in this contract — burn directly
            carel_disp.burn(fund);

            self.ai_buyback_fund.write(0);
            self.ai_epoch_start.write(now);

            self.emit(Event::AiBuybackExecuted(AiBuybackExecuted {
                epoch_start,
                carel_input: fund,
                carel_burned: fund,
            }));
        }

        /// @notice Returns CAREL accumulated in the epoch buyback fund.
        fn get_ai_epoch_buyback_fund(self: @ContractState) -> u256 {
            self.ai_buyback_fund.read()
        }
    }

    // Internal helper: compute 10^exp as u256
    fn pow10(exp: u32) -> u256 {
        let mut result: u256 = 1;
        let mut i: u32 = 0;
        loop {
            if i >= exp { break; }
            result *= 10;
            i += 1;
        };
        result
    }

    #[abi(embed_v0)]
    impl FeeCollectorPrivacyImpl of super::IFeeCollectorPrivacy<ContractState> {
        /// @notice Sets the privacy router contract address.
        /// @dev Only callable by owner. Router must be non-zero.
        /// @param router Address of the deployed privacy router.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        /// @notice Submits a ZK-proven private fee action to the privacy router.
        /// @param old_root Merkle root before this action.
        /// @param new_root Merkle root after this action.
        /// @param nullifiers Span of nullifiers preventing double-spend.
        /// @param commitments Span of new Pedersen commitments.
        /// @param public_inputs Public inputs consumed by the ZK verifier.
        /// @param proof Serialised ZK proof bytes.
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
