use starknet::ContractAddress;

#[derive(Drop, Serde, starknet::Store)]
pub struct Route {
    pub dex_id: felt252,
    pub expected_amount_out: u256,
    pub min_amount_out: u256,
}

/// @title DEX Router Interface
/// @author CAREL Team
/// @notice Defines minimal router quote and swap entrypoints.
/// @dev Used by the swap aggregator to query and execute swaps.
#[starknet::interface]
pub trait IDEXRouter<TContractState> {
    /// @notice Returns a quote for a swap.
    /// @dev Read-only helper used for route selection.
    /// @param from_token Input token address.
    /// @param to_token Output token address.
    /// @param amount Input amount.
    /// @return quote Expected output amount.
    fn get_quote(self: @TContractState, from_token: ContractAddress, to_token: ContractAddress, amount: u256) -> u256;
    /// @notice Executes a swap.
    /// @dev Called by aggregator after fee adjustments.
    /// @param from_token Input token address.
    /// @param to_token Output token address.
    /// @param amount Input amount after fees.
    /// @param min_amount_out Minimum acceptable output.
    fn swap(ref self: TContractState, from_token: ContractAddress, to_token: ContractAddress, amount: u256, min_amount_out: u256);
}

/// @title Swap Aggregator Interface
/// @author CAREL Team
/// @notice Defines best-route selection and swap execution.
/// @dev Applies protocol fees and optional MEV protection.
#[starknet::interface]
pub trait ISwapAggregator<TContractState> {
    /// @notice Returns the best swap route across registered DEXes.
    /// @dev Selects route by best quote and applies slippage tolerance.
    /// @param from_token Input token address.
    /// @param to_token Output token address.
    /// @param amount Input amount.
    /// @return route Best route metadata.
    fn get_best_swap_route(self: @TContractState, from_token: ContractAddress, to_token: ContractAddress, amount: u256) -> Route;
    /// @notice Executes a swap using a selected route.
    /// @dev Charges protocol and optional MEV fees.
    /// @param route Selected route.
    /// @param from_token Input token address.
    /// @param to_token Output token address.
    /// @param amount Input amount.
    /// @param mev_protected Whether MEV protection fee is applied.
    fn execute_swap(ref self: TContractState, route: Route, from_token: ContractAddress, to_token: ContractAddress, amount: u256, mev_protected: bool);
    /// @notice Returns an oracle-based quote for a swap.
    /// @dev Uses on-chain price oracle for rate calculation.
    /// @param from_token Input token address.
    /// @param to_token Output token address.
    /// @param amount Input amount.
    /// @return amount_out Estimated output amount.
    fn get_oracle_quote(self: @TContractState, from_token: ContractAddress, to_token: ContractAddress, amount: u256) -> u256;
    /// @notice Registers a DEX router.
    /// @dev Owner-only to control active DEX list.
    /// @param dex_id DEX identifier.
    /// @param router_address Router contract address.
    fn register_dex_router(ref self: TContractState, dex_id: felt252, router_address: ContractAddress);
    /// @notice Updates fee configuration for swaps.
    /// @dev Owner-only to prevent unauthorized fee changes.
    /// @param lp_fee_bps LP fee in bps.
    /// @param dev_fee_bps Dev fee in bps.
    /// @param mev_fee_bps MEV fee in bps.
    fn set_fee_config(ref self: TContractState, lp_fee_bps: u256, dev_fee_bps: u256, mev_fee_bps: u256);
    /// @notice Updates fee recipient addresses.
    /// @dev Owner-only to secure fee routing.
    /// @param dev_fund Dev fund address.
    /// @param fee_recipient LP fee recipient address.
    fn set_fee_recipients(ref self: TContractState, dev_fund: ContractAddress, fee_recipient: ContractAddress);
    /// @notice Sets the price oracle contract address.
    /// @dev Owner-only to keep oracle trust boundaries.
    /// @param oracle Price oracle address.
    fn set_price_oracle(ref self: TContractState, oracle: ContractAddress);
    /// @notice Sets oracle metadata for a token.
    /// @dev Owner-only to map token to oracle asset id and decimals.
    /// @param token Token address.
    /// @param asset_id Oracle asset id.
    /// @param decimals Token decimals.
    fn set_token_oracle_config(ref self: TContractState, token: ContractAddress, asset_id: felt252, decimals: u32);
    /// @notice Sets the maximum number of registered DEXes.
    /// @dev Owner-only to cap iteration cost.
    /// @param max_dexes Maximum DEX count.
    fn set_max_dexes(ref self: TContractState, max_dexes: u64);
}

/// @title ERC20 Minimal Interface
/// @author CAREL Team
/// @notice Minimal token interface used for settlement and fees.
/// @dev Keeps swap aggregator dependency surface small.
#[starknet::interface]
pub trait IERC20<TContractState> {
    /// @notice Returns token balance of an account.
    /// @param account Account address.
    /// @return balance Account token balance.
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    /// @notice Transfers tokens from caller to recipient.
    /// @param recipient Recipient address.
    /// @param amount Transfer amount.
    /// @return success True if transfer succeeds.
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    /// @notice Transfers tokens between two addresses using allowance.
    /// @param sender Token source address.
    /// @param recipient Token destination address.
    /// @param amount Transfer amount.
    /// @return success True if transfer succeeds.
    fn transfer_from(
        ref self: TContractState,
        sender: ContractAddress,
        recipient: ContractAddress,
        amount: u256
    ) -> bool;
    /// @notice Approves spender to spend caller tokens.
    /// @param spender Spender address.
    /// @param amount Allowance amount.
    /// @return success True if approve succeeds.
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
}

/// @title Swap Aggregator Privacy Interface
/// @author CAREL Team
/// @notice ZK privacy hooks for swap aggregation.
#[starknet::interface]
pub trait ISwapAggregatorPrivacy<TContractState> {
    /// @notice Sets privacy router address.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    /// @notice Submits a private swap-aggregator action proof.
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

/// @title Swap Aggregator Contract
/// @author CAREL Team
/// @notice Aggregates swap routes and applies protocol fees.
/// @dev Maintains DEX registry and slippage configuration.
#[starknet::contract]
pub mod SwapAggregator {
    // Menghapus get_contract_address karena tidak digunakan
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    // Wajib untuk akses storage Vec dan Map
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

    /// @notice Initializes the swap aggregator.
    /// @dev Sets owner and default fee configuration.
    /// @param owner Owner/admin address.
    #[constructor]
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
        /// @notice Returns the best swap route across registered DEXes.
        /// @dev Selects route by best quote and applies slippage tolerance.
        /// @param from_token Input token address.
        /// @param to_token Output token address.
        /// @param amount Input amount.
        /// @return route Best route metadata.
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

        /// @notice Executes a swap using a selected route.
        /// @dev Charges protocol and optional MEV fees.
        /// @param route Selected route.
        /// @param from_token Input token address.
        /// @param to_token Output token address.
        /// @param amount Input amount.
        /// @param mev_protected Whether MEV protection fee is applied.
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
            let payout_ok = to_token_dispatcher.transfer(user, amount_out);
            assert!(payout_ok, "Output token transfer failed");

            self.emit(Event::FeeCharged(FeeCharged {
                user,
                lp_fee,
                dev_fee,
                mev_fee,
            }));
        }

        /// @notice Returns an oracle-based quote for a swap.
        /// @dev Uses on-chain price oracle for rate calculation.
        /// @param from_token Input token address.
        /// @param to_token Output token address.
        /// @param amount Input amount.
        /// @return amount_out Estimated output amount.
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

        /// @notice Registers a DEX router.
        /// @dev Owner-only to control active DEX list.
        /// @param dex_id DEX identifier.
        /// @param router_address Router contract address.
        fn register_dex_router(ref self: ContractState, dex_id: felt252, router_address: ContractAddress) {
            assert!(get_caller_address() == self.owner.read(), "Only owner");
            let current: u64 = self.dex_ids.len().into();
            assert!(current < self.max_dexes.read(), "DEX limit reached");
            assert!(!router_address.is_zero(), "Router required");
            self.dex_routers.entry(dex_id).write(router_address);
            self.active_dexes.entry(router_address).write(true);
            
            // Menggunakan push() menggantikan append().write() untuk menghindari warning
            self.dex_ids.push(dex_id);
        }

        /// @notice Updates fee configuration for swaps.
        /// @dev Owner-only to prevent unauthorized fee changes.
        /// @param lp_fee_bps LP fee in bps.
        /// @param dev_fee_bps Dev fee in bps.
        /// @param mev_fee_bps MEV fee in bps.
        fn set_fee_config(ref self: ContractState, lp_fee_bps: u256, dev_fee_bps: u256, mev_fee_bps: u256) {
            assert!(get_caller_address() == self.owner.read(), "Only owner");
            assert!(lp_fee_bps + dev_fee_bps <= 1000, "Swap fee too high");
            assert!(mev_fee_bps <= 500, "MEV fee too high");
            self.lp_fee_bps.write(lp_fee_bps);
            self.dev_fee_bps.write(dev_fee_bps);
            self.mev_fee_bps.write(mev_fee_bps);
        }

        /// @notice Updates fee recipient addresses.
        /// @dev Owner-only to secure fee routing.
        /// @param dev_fund Dev fund address.
        /// @param fee_recipient LP fee recipient address.
        fn set_fee_recipients(ref self: ContractState, dev_fund: ContractAddress, fee_recipient: ContractAddress) {
            assert!(get_caller_address() == self.owner.read(), "Only owner");
            assert!(!dev_fund.is_zero(), "Dev fund required");
            assert!(!fee_recipient.is_zero(), "Fee recipient required");
            self.dev_fund.write(dev_fund);
            self.fee_recipient.write(fee_recipient);
        }

        /// @notice Sets the price oracle contract address.
        /// @dev Owner-only to keep oracle trust boundaries.
        /// @param oracle Price oracle address.
        fn set_price_oracle(ref self: ContractState, oracle: ContractAddress) {
            assert!(get_caller_address() == self.owner.read(), "Only owner");
            assert!(!oracle.is_zero(), "Oracle required");
            self.price_oracle.write(oracle);
        }

        /// @notice Sets oracle metadata for a token.
        /// @dev Owner-only to map token to oracle asset id and decimals.
        /// @param token Token address.
        /// @param asset_id Oracle asset id.
        /// @param decimals Token decimals.
        fn set_token_oracle_config(ref self: ContractState, token: ContractAddress, asset_id: felt252, decimals: u32) {
            assert!(get_caller_address() == self.owner.read(), "Only owner");
            assert!(decimals > 0, "Invalid decimals");
            self.oracle_asset_ids.entry(token).write(asset_id);
            self.oracle_decimals.entry(token).write(decimals);
        }

        fn set_max_dexes(ref self: ContractState, max_dexes: u64) {
            assert!(get_caller_address() == self.owner.read(), "Only owner");
            assert!(max_dexes > 0, "Max DEXes required");
            self.max_dexes.write(max_dexes);
        }
    }

    #[abi(embed_v0)]
    impl SwapAggregatorPrivacyImpl of super::ISwapAggregatorPrivacy<ContractState> {
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            assert!(get_caller_address() == self.owner.read(), "Only owner");
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

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
