use starknet::ContractAddress;

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct LimitOrderState {
    pub owner: ContractAddress,
    pub from_token: ContractAddress,
    pub to_token: ContractAddress,
    pub amount: u256,
    pub target_price: u256,
    pub expiry: u64,
    pub status: u8, // 1=active, 2=filled, 3=cancelled
}

const BASIS_POINTS: u256 = 10000;
const PRICE_SCALE: u256 = 100000000;

// Limit order book API for normal (public) order management.
// Keepers/executors are not modeled here.
#[starknet::interface]
pub trait ILimitOrderBook<TContractState> {
    // Creates a limit order and stores it as active state.
    fn create_limit_order(
        ref self: TContractState,
        order_id: felt252,
        from_token: ContractAddress,
        to_token: ContractAddress,
        amount: u256,
        target_price: u256,
        expiry: u64
    ) -> felt252;
    // Cancels an active limit order owned by caller.
    fn cancel_limit_order(ref self: TContractState, order_id: felt252);
    // Executes an active limit order and marks it filled.
    fn execute_limit_order(ref self: TContractState, order_id: felt252, order_value: u256);
    // Updates protocol and executor fee configuration.
    fn set_fee_config(
        ref self: TContractState,
        protocol_fee_bps: u256,
        executor_fee_bps: u256,
        fee_recipient: ContractAddress
    );
    // Returns current fee configuration.
    fn get_fee_config(self: @TContractState) -> (u256, u256, ContractAddress);
    // Sets oracle address for on-chain price checks.
    fn set_price_oracle(ref self: TContractState, oracle: ContractAddress);
    // Sets oracle asset id for a token.
    fn set_token_asset_id(ref self: TContractState, token: ContractAddress, asset_id: felt252);
    // Authorizes or revokes a keeper to execute limit orders.
    fn set_authorized_keeper(ref self: TContractState, keeper: ContractAddress, authorized: bool);
}

// Minimal ERC20 interface for token transfers.
#[starknet::interface]
pub trait IERC20<TContractState> {
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256
    ) -> bool;
}

// On-chain limit order book for normal (public) limit orders.
#[starknet::contract]
pub mod LimitOrderBook {
    use starknet::ContractAddress;
    use starknet::{get_caller_address, get_block_timestamp, get_contract_address};
    // Uses wildcard storage import for storage access traits.
    use starknet::storage::*;
    use super::LimitOrderState;
    use super::BASIS_POINTS;
    use super::PRICE_SCALE;
    use core::traits::TryInto;
    use core::num::traits::Zero;
    use crate::utils::price_oracle::{IPriceOracleDispatcher, IPriceOracleDispatcherTrait};
    use super::{IERC20Dispatcher, IERC20DispatcherTrait};

    #[storage]
    pub struct Storage {
        pub limit_orders: Map<felt252, LimitOrderState>,
        pub limit_order_owner: Map<felt252, ContractAddress>,
        pub owner: ContractAddress,
        pub protocol_fee_bps: u256,
        pub executor_fee_bps: u256,
        pub fee_recipient: ContractAddress,
        pub price_oracle: ContractAddress,
        pub token_asset_ids: Map<ContractAddress, felt252>,
        pub authorized_keepers: Map<ContractAddress, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        LimitOrderCreated: LimitOrderCreated,
        LimitOrderCancelled: LimitOrderCancelled,
        LimitOrderExecuted: LimitOrderExecuted,
        LimitOrderFeesCalculated: LimitOrderFeesCalculated,
        FeeConfigUpdated: FeeConfigUpdated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct LimitOrderCreated {
        pub order_id: felt252,
        pub owner: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct LimitOrderCancelled {
        pub order_id: felt252,
        pub owner: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct LimitOrderExecuted {
        pub order_id: felt252,
        pub executor: ContractAddress,
        pub order_value: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct LimitOrderFeesCalculated {
        pub order_id: felt252,
        pub executor: ContractAddress,
        pub order_value: u256,
        pub protocol_fee: u256,
        pub executor_fee: u256,
        pub fee_recipient: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct FeeConfigUpdated {
        pub protocol_fee_bps: u256,
        pub executor_fee_bps: u256,
        pub fee_recipient: ContractAddress,
    }

    // Initializes owner authority for the limit order book.
    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.owner.write(owner);
        self.fee_recipient.write(owner);
        self.protocol_fee_bps.write(0);
        self.executor_fee_bps.write(0);
        let zero: ContractAddress = 0.try_into().unwrap();
        self.price_oracle.write(zero);
    }

    #[abi(embed_v0)]
    impl LimitOrderBookImpl of super::ILimitOrderBook<ContractState> {
        // Creates a limit order and stores it as active state.
        fn create_limit_order(
            ref self: ContractState,
            order_id: felt252,
            from_token: ContractAddress,
            to_token: ContractAddress,
            amount: u256,
            target_price: u256,
            expiry: u64
        ) -> felt252 {
            let caller = get_caller_address();
            assert!(!caller.is_zero(), "Invalid caller");
            assert!(amount > 0_u256, "Amount required");
            assert!(expiry > get_block_timestamp(), "Expiry must be in future");
            let existing_owner = self.limit_order_owner.entry(order_id).read();
            assert!(existing_owner.is_zero(), "Order already exists");

            let from_token_dispatcher = IERC20Dispatcher { contract_address: from_token };
            let locked = from_token_dispatcher.transfer_from(caller, get_contract_address(), amount);
            assert!(locked, "Token transfer_from failed");

            let order = LimitOrderState {
                owner: caller,
                from_token,
                to_token,
                amount,
                target_price,
                expiry,
                status: 1_u8,
            };
            self.limit_orders.entry(order_id).write(order);
            self.limit_order_owner.entry(order_id).write(caller);
            self.emit(Event::LimitOrderCreated(LimitOrderCreated { order_id, owner: caller }));
            order_id
        }

        // Cancels an active limit order owned by caller.
        fn cancel_limit_order(ref self: ContractState, order_id: felt252) {
            let caller = get_caller_address();
            let owner = self.limit_order_owner.entry(order_id).read();
            assert!(owner == caller, "Not order owner");

            let mut order = self.limit_orders.entry(order_id).read();
            assert!(order.status == 1_u8, "Order not active");
            order.status = 3_u8;
            self.limit_orders.entry(order_id).write(order);
            let from_token_dispatcher = IERC20Dispatcher { contract_address: order.from_token };
            let refunded = from_token_dispatcher.transfer(owner, order.amount);
            assert!(refunded, "Refund failed");
            self.emit(Event::LimitOrderCancelled(LimitOrderCancelled { order_id, owner: caller }));
        }

        // Executes an active limit order and marks it filled.
        fn execute_limit_order(ref self: ContractState, order_id: felt252, order_value: u256) {
            let caller = get_caller_address();
            assert!(
                caller == self.owner.read() || self.authorized_keepers.entry(caller).read(),
                "Unauthorized executor"
            );
            let mut order = self.limit_orders.entry(order_id).read();
            let owner = self.limit_order_owner.entry(order_id).read();
            assert!(!owner.is_zero(), "Order not found");
            assert!(order.status == 1_u8, "Order not active");
            assert!(order.expiry > get_block_timestamp(), "Order expired");

            let oracle = self.price_oracle.read();
            assert!(!oracle.is_zero(), "Price oracle not set");
            let from_asset_id = self.token_asset_ids.entry(order.from_token).read();
            assert!(from_asset_id != 0, "From asset id not set");
            let to_asset_id = self.token_asset_ids.entry(order.to_token).read();
            let oracle_dispatcher = IPriceOracleDispatcher { contract_address: oracle };
            let from_price = oracle_dispatcher.get_price(order.from_token, from_asset_id);
            assert!(from_price > 0, "Oracle price unavailable");
            let mut current_price = from_price;
            if to_asset_id != 0 {
                let to_price = oracle_dispatcher.get_price(order.to_token, to_asset_id);
                assert!(to_price > 0, "Oracle price unavailable");
                current_price = (from_price * PRICE_SCALE) / to_price;
            }
            assert!(current_price <= order.target_price, "Target price not reached");

            order.status = 2_u8;
            self.limit_orders.entry(order_id).write(order);
            self.emit(Event::LimitOrderExecuted(LimitOrderExecuted {
                order_id,
                executor: caller,
                order_value,
            }));

            assert!(order_value > 0, "Order value required");
            let protocol_fee = (order_value * self.protocol_fee_bps.read()) / BASIS_POINTS;
            let executor_fee = (order_value * self.executor_fee_bps.read()) / BASIS_POINTS;
            assert!(order_value > protocol_fee + executor_fee, "Order value too small");
            let net_out = order_value - protocol_fee - executor_fee;

            let to_token_dispatcher = IERC20Dispatcher { contract_address: order.to_token };
            let paid_in = to_token_dispatcher.transfer_from(caller, get_contract_address(), order_value);
            assert!(paid_in, "Output transfer_from failed");

            let payout_ok = to_token_dispatcher.transfer(owner, net_out);
            assert!(payout_ok, "Payout transfer failed");
            if protocol_fee > 0 {
                let fee_ok = to_token_dispatcher.transfer(self.fee_recipient.read(), protocol_fee);
                assert!(fee_ok, "Protocol fee transfer failed");
            }
            if executor_fee > 0 {
                let exec_ok = to_token_dispatcher.transfer(caller, executor_fee);
                assert!(exec_ok, "Executor fee transfer failed");
            }

            let from_token_dispatcher = IERC20Dispatcher { contract_address: order.from_token };
            let release_ok = from_token_dispatcher.transfer(caller, order.amount);
            assert!(release_ok, "Release transfer failed");

            if protocol_fee + executor_fee > 0 {
                self.emit(
                    Event::LimitOrderFeesCalculated(
                        LimitOrderFeesCalculated {
                            order_id,
                            executor: caller,
                            order_value,
                            protocol_fee,
                            executor_fee,
                            fee_recipient: self.fee_recipient.read(),
                        }
                    )
                );
            }
        }

        // Updates protocol and executor fee configuration.
        fn set_fee_config(
            ref self: ContractState,
            protocol_fee_bps: u256,
            executor_fee_bps: u256,
            fee_recipient: ContractAddress
        ) {
            let caller = get_caller_address();
            assert!(caller == self.owner.read(), "Unauthorized");
            assert!(protocol_fee_bps + executor_fee_bps <= BASIS_POINTS, "Fee too high");
            assert!(!fee_recipient.is_zero(), "Fee recipient required");
            self.protocol_fee_bps.write(protocol_fee_bps);
            self.executor_fee_bps.write(executor_fee_bps);
            self.fee_recipient.write(fee_recipient);
            self.emit(
                Event::FeeConfigUpdated(
                    FeeConfigUpdated { protocol_fee_bps, executor_fee_bps, fee_recipient }
                )
            );
        }

        // Returns current fee configuration.
        fn get_fee_config(self: @ContractState) -> (u256, u256, ContractAddress) {
            (
                self.protocol_fee_bps.read(),
                self.executor_fee_bps.read(),
                self.fee_recipient.read()
            )
        }

        // Sets oracle address for on-chain price checks.
        fn set_price_oracle(ref self: ContractState, oracle: ContractAddress) {
            let caller = get_caller_address();
            assert!(caller == self.owner.read(), "Unauthorized");
            assert!(!oracle.is_zero(), "Oracle required");
            self.price_oracle.write(oracle);
        }

        // Sets oracle asset id for a token.
        fn set_token_asset_id(ref self: ContractState, token: ContractAddress, asset_id: felt252) {
            let caller = get_caller_address();
            assert!(caller == self.owner.read(), "Unauthorized");
            assert!(!token.is_zero(), "Token required");
            self.token_asset_ids.entry(token).write(asset_id);
        }

        // Authorizes or revokes a keeper to execute limit orders.
        fn set_authorized_keeper(ref self: ContractState, keeper: ContractAddress, authorized: bool) {
            let caller = get_caller_address();
            assert!(caller == self.owner.read(), "Unauthorized");
            assert!(!keeper.is_zero(), "Invalid keeper");
            self.authorized_keepers.entry(keeper).write(authorized);
        }
    }
}
