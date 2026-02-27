use starknet::ContractAddress;

#[derive(Drop, Serde, starknet::Store)]
pub struct Route {
    pub dex_id: felt252,
    pub expected_amount_out: u256,
    pub min_amount_out: u256,
}

// Defines minimal router quote and swap entrypoints.
// Used by the swap aggregator to query and execute swaps.
#[starknet::interface]
pub trait IDEXRouter<TContractState> {
    // Returns get quote from state without mutating storage.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn get_quote(self: @TContractState, from_token: ContractAddress, to_token: ContractAddress, amount: u256) -> u256;
    // Implements swap logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn swap(ref self: TContractState, from_token: ContractAddress, to_token: ContractAddress, amount: u256, min_amount_out: u256);
}

// Defines best-route selection and swap execution.
// Applies protocol fees and optional MEV protection.
#[starknet::interface]
pub trait ISwapAggregator<TContractState> {
    // Returns get best swap route from state without mutating storage.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn get_best_swap_route(self: @TContractState, from_token: ContractAddress, to_token: ContractAddress, amount: u256) -> Route;
    // Applies execute swap after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn execute_swap(ref self: TContractState, route: Route, from_token: ContractAddress, to_token: ContractAddress, amount: u256, mev_protected: bool);
    // Returns get oracle quote from state without mutating storage.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn get_oracle_quote(self: @TContractState, from_token: ContractAddress, to_token: ContractAddress, amount: u256) -> u256;
    // Applies register dex router after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn register_dex_router(ref self: TContractState, dex_id: felt252, router_address: ContractAddress);
    // Updates fee config configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_fee_config(ref self: TContractState, lp_fee_bps: u256, dev_fee_bps: u256, mev_fee_bps: u256);
    // Updates fee recipients configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_fee_recipients(ref self: TContractState, dev_fund: ContractAddress, fee_recipient: ContractAddress);
    // Updates price oracle configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_price_oracle(ref self: TContractState, oracle: ContractAddress);
    // Updates token oracle config configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_token_oracle_config(ref self: TContractState, token: ContractAddress, asset_id: felt252, decimals: u32);
    // Updates max dexes configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_max_dexes(ref self: TContractState, max_dexes: u64);
}

// Minimal token interface used for settlement and fees.
// Keeps swap aggregator dependency surface small.
#[starknet::interface]
pub trait IERC20<TContractState> {
    // Implements balance of logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    // Applies transfer after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    // Applies transfer from after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn transfer_from(
        ref self: TContractState,
        sender: ContractAddress,
        recipient: ContractAddress,
        amount: u256
    ) -> bool;
    // Applies approve after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
}

// ZK privacy hooks for swap aggregation.
#[starknet::interface]
pub trait ISwapAggregatorPrivacy<TContractState> {
    // Updates privacy router configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    // Applies submit private swap agg action after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
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

// Aggregates swap routes and applies protocol fees.
// Maintains DEX registry and slippage configuration.
#[starknet::contract]
pub mod SwapAggregator {
    // Imports address helpers used in route execution and permission checks.
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    // Required for Vec and Map storage access traits.
    use starknet::storage::*;
    use core::num::traits::Zero;
    use super::{
        Route, ISwapAggregator, IDEXRouterDispatcher, IDEXRouterDispatcherTrait, IERC20Dispatcher,
        IERC20DispatcherTrait
    };
    use crate::utils::price_oracle::{IPriceOracleDispatcher, IPriceOracleDispatcherTrait};
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_SWAP_AGG;

    const BASIS_POINTS: u256 = 10000;
    const DEFAULT_SLIPPAGE: u256 = 100; // 1%

    #[storage]
    pub struct Storage {
        pub dex_ids: Vec<felt252>,
        pub dex_routers: Map<felt252, ContractAddress>,
        pub active_dexes: Map<ContractAddress, bool>,
        pub slippage_tolerance: u256,
        pub owner: ContractAddress,
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
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        FeeCharged: FeeCharged,
    }

    #[derive(Drop, starknet::Event)]
    pub struct FeeCharged {
        pub user: ContractAddress,
        pub lp_fee: u256,
        pub dev_fee: u256,
        pub mev_fee: u256,
    }

    // Initializes the swap aggregator with owner and default fee settings.
    // `owner` is used for admin updates and initial fee recipient wiring.
    #[constructor]
    // Initializes storage and role configuration during deployment.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.owner.write(owner);
        self.slippage_tolerance.write(DEFAULT_SLIPPAGE);
        self.dev_fund.write(owner);
        self.fee_recipient.write(owner);
        self.lp_fee_bps.write(20); // 0.2%
        self.dev_fee_bps.write(10); // 0.1%
        self.mev_fee_bps.write(15); // 0.15%
        self.max_dexes.write(50);
        let zero: ContractAddress = 0.try_into().unwrap();
        self.price_oracle.write(zero);
    }

    #[abi(embed_v0)]
    impl SwapAggregatorImpl of ISwapAggregator<ContractState> {
        // Returns get best swap route from state without mutating storage.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn get_best_swap_route(self: @ContractState, from_token: ContractAddress, to_token: ContractAddress, amount: u256) -> Route {
            let mut best_dex_id: felt252 = 0;
            let mut highest_out: u256 = 0;

            for i in 0..self.dex_ids.len() {
                let d_id = self.dex_ids.at(i).read();
                let router_addr = self.dex_routers.entry(d_id).read();
                
                if self.active_dexes.entry(router_addr).read() {
                    let quote = IDEXRouterDispatcher { contract_address: router_addr }.get_quote(from_token, to_token, amount);
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

        // Applies execute swap after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
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

            // Pull input tokens from user (wallet must approve swap aggregator first).
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
                assert!(
                    oracle_amount_out >= route.min_amount_out, "Insufficient output amount"
                );
                oracle_amount_out
            } else {
                let router_addr = self.dex_routers.entry(route.dex_id).read();
                assert!(self.active_dexes.entry(router_addr).read(), "DEX not active");

                let approve_ok = from_token_dispatcher.approve(router_addr, final_amount);
                assert!(approve_ok, "Router approve failed");

                let to_token_dispatcher = IERC20Dispatcher { contract_address: to_token };
                let out_before = to_token_dispatcher.balance_of(get_contract_address());
                IDEXRouterDispatcher { contract_address: router_addr }.swap(
                    from_token, to_token, final_amount, route.min_amount_out
                );
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

            self.emit(Event::FeeCharged(FeeCharged {
                user,
                lp_fee,
                dev_fee,
                mev_fee,
            }));
        }

        // Returns get oracle quote from state without mutating storage.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
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

        // Applies register dex router after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn register_dex_router(ref self: ContractState, dex_id: felt252, router_address: ContractAddress) {
            assert!(get_caller_address() == self.owner.read(), "Only owner");
            let current: u64 = self.dex_ids.len();
            assert!(current < self.max_dexes.read(), "DEX limit reached");
            assert!(!router_address.is_zero(), "Router required");
            self.dex_routers.entry(dex_id).write(router_address);
            self.active_dexes.entry(router_address).write(true);
            
            // Uses `push()` to avoid deprecated append/write pattern warnings.
            self.dex_ids.push(dex_id);
        }

        // Updates fee config configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_fee_config(ref self: ContractState, lp_fee_bps: u256, dev_fee_bps: u256, mev_fee_bps: u256) {
            assert!(get_caller_address() == self.owner.read(), "Only owner");
            assert!(lp_fee_bps + dev_fee_bps <= 1000, "Swap fee too high");
            assert!(mev_fee_bps <= 500, "MEV fee too high");
            self.lp_fee_bps.write(lp_fee_bps);
            self.dev_fee_bps.write(dev_fee_bps);
            self.mev_fee_bps.write(mev_fee_bps);
        }

        // Updates fee recipients configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_fee_recipients(ref self: ContractState, dev_fund: ContractAddress, fee_recipient: ContractAddress) {
            assert!(get_caller_address() == self.owner.read(), "Only owner");
            assert!(!dev_fund.is_zero(), "Dev fund required");
            assert!(!fee_recipient.is_zero(), "Fee recipient required");
            self.dev_fund.write(dev_fund);
            self.fee_recipient.write(fee_recipient);
        }

        // Updates price oracle configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_price_oracle(ref self: ContractState, oracle: ContractAddress) {
            assert!(get_caller_address() == self.owner.read(), "Only owner");
            assert!(!oracle.is_zero(), "Oracle required");
            self.price_oracle.write(oracle);
        }

        // Updates token oracle config configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_token_oracle_config(ref self: ContractState, token: ContractAddress, asset_id: felt252, decimals: u32) {
            assert!(get_caller_address() == self.owner.read(), "Only owner");
            assert!(decimals > 0, "Invalid decimals");
            self.oracle_asset_ids.entry(token).write(asset_id);
            self.oracle_decimals.entry(token).write(decimals);
        }

        // Updates max dexes configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_max_dexes(ref self: ContractState, max_dexes: u64) {
            assert!(get_caller_address() == self.owner.read(), "Only owner");
            assert!(max_dexes > 0, "Max DEXes required");
            self.max_dexes.write(max_dexes);
        }
    }

    #[abi(embed_v0)]
    impl SwapAggregatorPrivacyImpl of super::ISwapAggregatorPrivacy<ContractState> {
        // Updates privacy router configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            assert!(get_caller_address() == self.owner.read(), "Only owner");
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        // Applies submit private swap agg action after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn submit_private_swap_agg_action(
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

    // Implements oracle quote logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn _oracle_quote(
        self: @ContractState,
        from_token: ContractAddress,
        to_token: ContractAddress,
        amount: u256
    ) -> u256 {
        let oracle_address = self.price_oracle.read();
        if oracle_address.is_zero() {
            return 0;
        }

        let from_asset_id = self.oracle_asset_ids.entry(from_token).read();
        let to_asset_id = self.oracle_asset_ids.entry(to_token).read();
        if from_asset_id == 0 || to_asset_id == 0 {
            return 0;
        }

        let from_decimals = self.oracle_decimals.entry(from_token).read();
        let to_decimals = self.oracle_decimals.entry(to_token).read();

        let oracle = IPriceOracleDispatcher { contract_address: oracle_address };
        let value_usd = oracle.get_price_usd(from_token, from_asset_id, amount, from_decimals);
        if value_usd == 0 {
            return 0;
        }

        let to_price = oracle.get_price(to_token, to_asset_id);
        if to_price == 0 {
            return 0;
        }

        let scale = _pow10(to_decimals);
        (value_usd * scale) / to_price
    }

    // Implements pow10 logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
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
