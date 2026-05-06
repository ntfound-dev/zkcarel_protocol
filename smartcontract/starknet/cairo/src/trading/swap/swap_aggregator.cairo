use starknet::ContractAddress;

/// @notice Best-route descriptor returned by route selection.
#[derive(Drop, Serde, starknet::Store)]
pub struct Route {
    pub dex_id: felt252,
    pub expected_amount_out: u256,
    pub min_amount_out: u256,
}

/// @notice Minimal router interface for quote and swap operations.
#[starknet::interface]
pub trait IDEXRouter<TContractState> {
    /// @notice Returns a swap quote without mutating state.
    fn get_quote(self: @TContractState, from_token: ContractAddress, to_token: ContractAddress, amount: u256) -> u256;
    /// @notice Executes a swap on the DEX.
    fn swap(ref self: TContractState, from_token: ContractAddress, to_token: ContractAddress, amount: u256, min_amount_out: u256);
}

/// @title ISwapAggregator
/// @notice Best-route selection and swap execution with protocol fee splits and optional MEV protection.
#[starknet::interface]
pub trait ISwapAggregator<TContractState> {
    /// @notice Returns the best swap route by polling all registered DEXes.
    /// @param from_token Input token address.
    /// @param to_token Output token address.
    /// @param amount Input amount.
    /// @return Best route descriptor with expected and minimum output.
    fn get_best_swap_route(self: @TContractState, from_token: ContractAddress, to_token: ContractAddress, amount: u256) -> Route;

    /// @notice Executes a swap along the selected route.
    /// @param route Route descriptor from `get_best_swap_route`.
    /// @param from_token Input token address.
    /// @param to_token Output token address.
    /// @param amount Input amount.
    /// @param mev_protected If true, MEV fee is applied for front-run protection.
    fn execute_swap(ref self: TContractState, route: Route, from_token: ContractAddress, to_token: ContractAddress, amount: u256, mev_protected: bool);

    /// @notice Returns an oracle-derived quote for a swap pair.
    /// @param from_token Input token address.
    /// @param to_token Output token address.
    /// @param amount Input amount.
    /// @return Estimated output amount.
    fn get_oracle_quote(self: @TContractState, from_token: ContractAddress, to_token: ContractAddress, amount: u256) -> u256;

    /// @notice Registers a DEX router in the aggregator.
    /// @dev Callable only by the contract owner. Emits `DexRegistered`.
    /// @param dex_id Identifier for the DEX.
    /// @param router_address Router contract address.
    fn register_dex_router(ref self: TContractState, dex_id: felt252, router_address: ContractAddress);

    /// @notice Updates protocol fee configuration.
    /// @dev Callable only by the contract owner. Emits `FeeConfigUpdated`.
    /// @param lp_fee_bps LP fee in basis points.
    /// @param dev_fee_bps Dev fee in basis points.
    /// @param mev_fee_bps MEV protection fee in basis points.
    fn set_fee_config(ref self: TContractState, lp_fee_bps: u256, dev_fee_bps: u256, mev_fee_bps: u256);

    /// @notice Updates fee recipient addresses.
    /// @dev Callable only by the contract owner.
    /// @param dev_fund Dev fund recipient.
    /// @param fee_recipient LP/MEV fee recipient.
    fn set_fee_recipients(ref self: TContractState, dev_fund: ContractAddress, fee_recipient: ContractAddress);

    /// @notice Sets the price oracle used for fallback quotes.
    /// @dev Callable only by the contract owner.
    /// @param oracle Oracle contract address.
    fn set_price_oracle(ref self: TContractState, oracle: ContractAddress);

    /// @notice Configures oracle asset ID and decimals for a token.
    /// @dev Callable only by the contract owner.
    /// @param token Token address.
    /// @param asset_id Pragma feed ID.
    /// @param decimals Token decimals.
    fn set_token_oracle_config(ref self: TContractState, token: ContractAddress, asset_id: felt252, decimals: u32);

    /// @notice Updates the maximum number of registered DEXes.
    /// @dev Callable only by the contract owner.
    /// @param max_dexes New limit.
    fn set_max_dexes(ref self: TContractState, max_dexes: u64);
}

/// @notice Minimal ERC20 interface for settlement and fee transfers.
#[starknet::interface]
pub trait IERC20<TContractState> {
    /// @notice Returns the token balance for `account`.
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    /// @notice Transfers tokens from this contract to `recipient`.
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    /// @notice Transfers tokens from `sender` to `recipient` using allowance.
    fn transfer_from(ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256) -> bool;
    /// @notice Approves `spender` to transfer up to `amount` on behalf of caller.
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
}

/// @title ISwapAggregatorPrivacy
/// @notice Hide Mode hooks for swap aggregation through the privacy router.
#[starknet::interface]
pub trait ISwapAggregatorPrivacy<TContractState> {
    /// @notice Sets the privacy router address.
    /// @dev Callable only by the contract owner. Emits `PrivacyRouterUpdated`.
    /// @param router New privacy router address (must be non-zero).
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);

    /// @notice Forwards a nullifier/commitment-bound swap payload to the privacy router.
    /// @dev Nullifiers are replay-protected: each may only be consumed once.
    /// @param old_root Previous Merkle tree root.
    /// @param new_root Updated Merkle tree root after commitments.
    /// @param nullifiers Nullifiers for inputs being spent.
    /// @param commitments New Merkle commitments.
    /// @param public_inputs ZK circuit public inputs.
    /// @param proof Serialized ZK proof.
    fn submit_private_swap_agg_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

/// @title SwapAggregator
/// @notice Aggregates swap routes across registered DEXes and applies protocol fees.
///         Falls back to oracle pricing when no live DEX route is available.
#[starknet::contract]
pub mod SwapAggregator {
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use starknet::storage::*;
    use core::num::traits::Zero;
    use openzeppelin::access::ownable::OwnableComponent;
    use super::{
        Route, ISwapAggregator, IDEXRouterDispatcher, IDEXRouterDispatcherTrait, IERC20Dispatcher,
        IERC20DispatcherTrait
    };
    use crate::utils::price_oracle::{IPriceOracleDispatcher, IPriceOracleDispatcherTrait};
    use crate::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy_action_types::ACTION_SWAP_AGG;

    const BASIS_POINTS: u256 = 10000;
    const DEFAULT_SLIPPAGE: u256 = 100; // 1%

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableTwoStepImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub dex_ids: Vec<felt252>,
        pub dex_routers: Map<felt252, ContractAddress>,
        pub active_dexes: Map<ContractAddress, bool>,
        pub slippage_tolerance: u256,
        pub dev_fund: ContractAddress,
        pub fee_recipient: ContractAddress,
        pub lp_fee_bps: u256,
        pub dev_fee_bps: u256,
        pub mev_fee_bps: u256,
        pub max_dexes: u64,
        pub price_oracle: ContractAddress,
        pub oracle_asset_ids: Map<ContractAddress, felt252>,
        pub oracle_decimals: Map<ContractAddress, u32>,
        pub privacy_router: ContractAddress,
        pub used_nullifiers: Map<felt252, bool>,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        FeeCharged: FeeCharged,
        DexRegistered: DexRegistered,
        FeeConfigUpdated: FeeConfigUpdated,
        PrivacyRouterUpdated: PrivacyRouterUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    /// @notice Emitted when protocol fees are collected on a swap.
    #[derive(Drop, starknet::Event)]
    pub struct FeeCharged {
        pub user: ContractAddress,
        pub lp_fee: u256,
        pub dev_fee: u256,
        pub mev_fee: u256,
    }

    /// @notice Emitted when a new DEX router is registered.
    #[derive(Drop, starknet::Event)]
    pub struct DexRegistered {
        pub dex_id: felt252,
        pub router_address: ContractAddress,
    }

    /// @notice Emitted when fee configuration is updated.
    #[derive(Drop, starknet::Event)]
    pub struct FeeConfigUpdated {
        pub lp_fee_bps: u256,
        pub dev_fee_bps: u256,
        pub mev_fee_bps: u256,
    }

    /// @notice Emitted when the privacy router address is updated.
    #[derive(Drop, starknet::Event)]
    pub struct PrivacyRouterUpdated {
        pub router: ContractAddress,
    }

    /// @notice Initializes the aggregator with owner, default slippage, and fee settings.
    /// @param owner Initial contract owner (two-step transfer via OZ OwnableComponent).
    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.ownable.initializer(owner);
        self.slippage_tolerance.write(DEFAULT_SLIPPAGE);
        self.dev_fund.write(owner);
        self.fee_recipient.write(owner);
        self.lp_fee_bps.write(20);   // 0.2%
        self.dev_fee_bps.write(10);  // 0.1%
        self.mev_fee_bps.write(15);  // 0.15%
        self.max_dexes.write(50);
        let zero: ContractAddress = 0.try_into().unwrap();
        self.price_oracle.write(zero);
    }

    #[abi(embed_v0)]
    impl SwapAggregatorImpl of ISwapAggregator<ContractState> {
        /// @inheritdoc ISwapAggregator
        fn get_best_swap_route(self: @ContractState, from_token: ContractAddress, to_token: ContractAddress, amount: u256) -> Route {
            let mut best_dex_id: felt252 = 0;
            let mut highest_out: u256 = 0;

            for i in 0..self.dex_ids.len() {
                let d_id = self.dex_ids.at(i).read();
                let router_addr = self.dex_routers.entry(d_id).read();
                if self.active_dexes.entry(router_addr).read() {
                    let quote = IDEXRouterDispatcher { contract_address: router_addr }
                        .get_quote(from_token, to_token, amount);
                    if quote > highest_out {
                        highest_out = quote;
                        best_dex_id = d_id;
                    }
                }
            };

            if best_dex_id == 0 {
                let oracle_quote = _oracle_quote(self, from_token, to_token, amount);
                assert!(oracle_quote > 0, "No active DEX found");
                let slippage = self.slippage_tolerance.read();
                let min_out = (oracle_quote * (BASIS_POINTS - slippage)) / BASIS_POINTS;
                return Route { dex_id: 'ORCL', expected_amount_out: oracle_quote, min_amount_out: min_out };
            }

            let slippage = self.slippage_tolerance.read();
            let min_out = (highest_out * (BASIS_POINTS - slippage)) / BASIS_POINTS;
            Route { dex_id: best_dex_id, expected_amount_out: highest_out, min_amount_out: min_out }
        }

        /// @inheritdoc ISwapAggregator
        fn execute_swap(
            ref self: ContractState,
            route: Route,
            from_token: ContractAddress,
            to_token: ContractAddress,
            amount: u256,
            mev_protected: bool
        ) {
            assert!(amount > 0, "Amount required");
            let user = get_caller_address();

            let from_token_dispatcher = IERC20Dispatcher { contract_address: from_token };
            let pulled = from_token_dispatcher.transfer_from(user, get_contract_address(), amount);
            assert!(pulled, "Token transfer_from failed");

            let swap_fee_bps = self.lp_fee_bps.read() + self.dev_fee_bps.read();
            let swap_fee = (amount * swap_fee_bps) / BASIS_POINTS;
            let mev_fee = if mev_protected {
                (amount * self.mev_fee_bps.read()) / BASIS_POINTS
            } else {
                0
            };

            let dev_fee = (amount * self.dev_fee_bps.read()) / BASIS_POINTS;
            let lp_fee = swap_fee - dev_fee;
            let total_fee = swap_fee + mev_fee;
            assert!(amount > total_fee, "Amount too small");
            let final_amount = amount - total_fee;

            if dev_fee > 0 {
                let dev_fee_ok = from_token_dispatcher.transfer(self.dev_fund.read(), dev_fee);
                assert!(dev_fee_ok, "Dev fee transfer failed");
            }
            let protocol_fee = lp_fee + mev_fee;
            if protocol_fee > 0 {
                let protocol_fee_ok =
                    from_token_dispatcher.transfer(self.fee_recipient.read(), protocol_fee);
                assert!(protocol_fee_ok, "Protocol fee transfer failed");
            }

            let amount_out = if from_token == to_token {
                final_amount
            } else if route.dex_id == 'ORCL' {
                let oracle_amount_out = _oracle_quote(@self, from_token, to_token, final_amount);
                assert!(oracle_amount_out > 0, "Oracle quote unavailable");
                assert!(oracle_amount_out >= route.min_amount_out, "Insufficient output amount");
                oracle_amount_out
            } else {
                let router_addr = self.dex_routers.entry(route.dex_id).read();
                assert!(self.active_dexes.entry(router_addr).read(), "DEX not active");
                let approve_ok = from_token_dispatcher.approve(router_addr, final_amount);
                assert!(approve_ok, "Router approve failed");
                let to_token_dispatcher = IERC20Dispatcher { contract_address: to_token };
                let out_before = to_token_dispatcher.balance_of(get_contract_address());
                IDEXRouterDispatcher { contract_address: router_addr }
                    .swap(from_token, to_token, final_amount, route.min_amount_out);
                let out_after = to_token_dispatcher.balance_of(get_contract_address());
                assert!(out_after > out_before, "DEX swap produced zero output");
                let dex_amount_out = out_after - out_before;
                assert!(dex_amount_out >= route.min_amount_out, "Insufficient output amount");
                dex_amount_out
            };

            let to_token_dispatcher = IERC20Dispatcher { contract_address: to_token };
            let available_out = to_token_dispatcher.balance_of(get_contract_address());
            assert!(available_out >= amount_out, "Insufficient aggregator output liquidity");
            let payout_ok = to_token_dispatcher.transfer(user, amount_out);
            assert!(payout_ok, "Output token transfer failed");

            self.emit(Event::FeeCharged(FeeCharged { user, lp_fee, dev_fee, mev_fee }));
        }

        /// @inheritdoc ISwapAggregator
        fn get_oracle_quote(
            self: @ContractState,
            from_token: ContractAddress,
            to_token: ContractAddress,
            amount: u256
        ) -> u256 {
            let quote = _oracle_quote(self, from_token, to_token, amount);
            assert!(quote > 0, "Oracle quote unavailable");
            quote
        }

        /// @inheritdoc ISwapAggregator
        fn register_dex_router(ref self: ContractState, dex_id: felt252, router_address: ContractAddress) {
            self.ownable.assert_only_owner();
            let current: u64 = self.dex_ids.len();
            assert!(current < self.max_dexes.read(), "DEX limit reached");
            assert!(!router_address.is_zero(), "Router required");
            self.dex_routers.entry(dex_id).write(router_address);
            self.active_dexes.entry(router_address).write(true);
            self.dex_ids.push(dex_id);
            self.emit(Event::DexRegistered(DexRegistered { dex_id, router_address }));
        }

        /// @inheritdoc ISwapAggregator
        fn set_fee_config(ref self: ContractState, lp_fee_bps: u256, dev_fee_bps: u256, mev_fee_bps: u256) {
            self.ownable.assert_only_owner();
            assert!(lp_fee_bps + dev_fee_bps <= 1000, "Swap fee too high");
            assert!(mev_fee_bps <= 500, "MEV fee too high");
            self.lp_fee_bps.write(lp_fee_bps);
            self.dev_fee_bps.write(dev_fee_bps);
            self.mev_fee_bps.write(mev_fee_bps);
            self.emit(Event::FeeConfigUpdated(FeeConfigUpdated { lp_fee_bps, dev_fee_bps, mev_fee_bps }));
        }

        /// @inheritdoc ISwapAggregator
        fn set_fee_recipients(ref self: ContractState, dev_fund: ContractAddress, fee_recipient: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!dev_fund.is_zero(), "Dev fund required");
            assert!(!fee_recipient.is_zero(), "Fee recipient required");
            self.dev_fund.write(dev_fund);
            self.fee_recipient.write(fee_recipient);
        }

        /// @inheritdoc ISwapAggregator
        fn set_price_oracle(ref self: ContractState, oracle: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!oracle.is_zero(), "Oracle required");
            self.price_oracle.write(oracle);
        }

        /// @inheritdoc ISwapAggregator
        fn set_token_oracle_config(ref self: ContractState, token: ContractAddress, asset_id: felt252, decimals: u32) {
            self.ownable.assert_only_owner();
            assert!(decimals > 0, "Invalid decimals");
            self.oracle_asset_ids.entry(token).write(asset_id);
            self.oracle_decimals.entry(token).write(decimals);
        }

        /// @inheritdoc ISwapAggregator
        fn set_max_dexes(ref self: ContractState, max_dexes: u64) {
            self.ownable.assert_only_owner();
            assert!(max_dexes > 0, "Max DEXes required");
            self.max_dexes.write(max_dexes);
        }
    }

    #[abi(embed_v0)]
    impl SwapAggregatorPrivacyImpl of super::ISwapAggregatorPrivacy<ContractState> {
        /// @inheritdoc ISwapAggregatorPrivacy
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
            self.emit(Event::PrivacyRouterUpdated(PrivacyRouterUpdated { router }));
        }

        /// @inheritdoc ISwapAggregatorPrivacy
        fn submit_private_swap_agg_action(
            ref self: ContractState,
            old_root: felt252,
            new_root: felt252,
            nullifiers: Span<felt252>,
            commitments: Span<felt252>,
            public_inputs: Span<felt252>,
            proof: Span<felt252>
        ) {
            let total: u64 = nullifiers.len().into();
            let mut i: u64 = 0;
            while i < total {
                let idx: u32 = i.try_into().unwrap();
                let nf = *nullifiers.at(idx);
                assert!(!self.used_nullifiers.entry(nf).read(), "Nullifier already used");
                self.used_nullifiers.entry(nf).write(true);
                i += 1;
            };
            let router = self.privacy_router.read();
            assert!(!router.is_zero(), "Privacy router not set");
            let dispatcher = IPrivacyRouterDispatcher { contract_address: router };
            dispatcher.submit_action(
                ACTION_SWAP_AGG,
                old_root,
                new_root,
                nullifiers,
                commitments,
                public_inputs,
                proof
            );
        }
    }

    /// @notice Computes an oracle-derived output amount for a token swap.
    fn _oracle_quote(
        self: @ContractState,
        from_token: ContractAddress,
        to_token: ContractAddress,
        amount: u256
    ) -> u256 {
        let oracle_address = self.price_oracle.read();
        if oracle_address.is_zero() { return 0; }
        let from_asset_id = self.oracle_asset_ids.entry(from_token).read();
        let to_asset_id = self.oracle_asset_ids.entry(to_token).read();
        if from_asset_id == 0 || to_asset_id == 0 { return 0; }
        let from_decimals = self.oracle_decimals.entry(from_token).read();
        let to_decimals = self.oracle_decimals.entry(to_token).read();
        let oracle = IPriceOracleDispatcher { contract_address: oracle_address };
        let value_usd = oracle.get_price_usd(from_token, from_asset_id, amount, from_decimals);
        if value_usd == 0 { return 0; }
        let to_price = oracle.get_price(to_token, to_asset_id);
        if to_price == 0 { return 0; }
        let scale = _pow10(to_decimals);
        (value_usd * scale) / to_price
    }

    /// @notice Returns 10^decimals as a u256 scaling factor.
    fn _pow10(decimals: u32) -> u256 {
        let mut value: u256 = 1;
        let mut i: u32 = 0;
        while i < decimals {
            value *= 10;
            i += 1;
        };
        value
    }
}
