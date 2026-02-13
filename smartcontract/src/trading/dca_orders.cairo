use starknet::ContractAddress;

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct KeeperStats {
    pub total_executions: u256,
    pub successful: u256,
    pub failed: u256,
    pub earnings: u256,
}

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

/// @title Keeper Network Interface
/// @author CAREL Team
/// @notice Defines keeper registration and execution entrypoints.
/// @dev Tracks keeper performance and earnings.
#[starknet::interface]
pub trait IKeeperNetwork<TContractState> {
    /// @notice Creates a new on-chain limit order.
    /// @param order_id Client-generated felt id.
    /// @param from_token Token sold.
    /// @param to_token Token bought.
    /// @param amount Amount sold.
    /// @param target_price Target execution price.
    /// @param expiry Expiry timestamp in seconds.
    /// @return created_order_id Stored order id.
    fn create_limit_order(
        ref self: TContractState,
        order_id: felt252,
        from_token: ContractAddress,
        to_token: ContractAddress,
        amount: u256,
        target_price: u256,
        expiry: u64
    ) -> felt252;
    /// @notice Cancels an active on-chain limit order.
    /// @param order_id Order id to cancel.
    fn cancel_limit_order(ref self: TContractState, order_id: felt252);
    /// @notice Registers the caller as a keeper.
    /// @dev Initializes keeper stats.
    fn register_keeper(ref self: TContractState);
    /// @notice Unregisters the caller as a keeper.
    /// @dev Stops keeper from executing jobs.
    fn unregister_keeper(ref self: TContractState);
    /// @notice Executes a limit order job.
    /// @dev Rewards keeper based on order value.
    /// @param order_id Limit order id.
    /// @param order_value Order value used for fee calculation.
    fn execute_limit_order(ref self: TContractState, order_id: felt252, order_value: u256);
    /// @notice Executes a DCA job.
    /// @dev Rewards keeper based on execution value.
    /// @param dca_id DCA order id.
    /// @param execution_value Execution value used for fee calculation.
    fn execute_dca(ref self: TContractState, dca_id: u64, execution_value: u256);
    /// @notice Claims accumulated keeper earnings.
    /// @dev Resets earnings after claim.
    /// @return amount Claimed earnings.
    fn claim_earnings(ref self: TContractState) -> u256;
    /// @notice Slashes a keeper.
    /// @dev Owner-only to remove misbehaving keepers.
    /// @param keeper Keeper address to slash.
    fn slash_keeper(ref self: TContractState, keeper: ContractAddress);
    /// @notice Returns keeper performance stats.
    /// @dev Read-only helper for dashboards.
    /// @param keeper Keeper address.
    /// @return stats Keeper stats.
    fn get_keeper_stats(self: @TContractState, keeper: ContractAddress) -> KeeperStats;
    /// @notice Checks if an address is a registered keeper.
    /// @dev Read-only helper for gating.
    /// @param keeper Keeper address.
    /// @return is_keeper True if registered.
    fn is_keeper(self: @TContractState, keeper: ContractAddress) -> bool;
}

/// @title Keeper Network Privacy Interface
/// @author CAREL Team
/// @notice ZK privacy hooks for keeper execution.
#[starknet::interface]
pub trait IKeeperNetworkPrivacy<TContractState> {
    /// @notice Sets privacy router address.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    /// @notice Submits a private keeper action proof.
    fn submit_private_keeper_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

/// @title Keeper Network Contract
/// @author CAREL Team
/// @notice Manages keeper registration and execution rewards.
/// @dev Tracks executions and earnings per keeper.
#[starknet::contract]
pub mod KeeperNetwork {
    use starknet::ContractAddress;
    use starknet::{get_caller_address, get_block_timestamp};
    // Selalu gunakan wildcard import untuk storage sesuai panduan dokumentasi
    use starknet::storage::*;
    use super::{KeeperStats, LimitOrderState};
    use core::num::traits::Zero;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_DCA;

    #[storage]
    pub struct Storage {
        pub registered_keepers: Map<ContractAddress, bool>,
        pub keeper_performance: Map<ContractAddress, KeeperStats>,
        pub limit_orders: Map<felt252, LimitOrderState>,
        pub limit_order_owner: Map<felt252, ContractAddress>,
        pub execution_fee_rate: u256,
        pub owner: ContractAddress,
        pub privacy_router: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        LimitOrderCreated: LimitOrderCreated,
        LimitOrderCancelled: LimitOrderCancelled,
        KeeperRegistered: KeeperRegistered,
        KeeperUnregistered: KeeperUnregistered,
        ExecutionProcessed: ExecutionProcessed,
        KeeperSlashed: KeeperSlashed,
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
    pub struct KeeperRegistered {
        pub keeper: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct KeeperUnregistered {
        pub keeper: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ExecutionProcessed {
        pub keeper: ContractAddress,
        pub id: felt252,
        pub fee_earned: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct KeeperSlashed {
        pub keeper: ContractAddress,
    }

    /// @notice Initializes the keeper network.
    /// @dev Sets owner and default execution fee rate.
    /// @param owner Owner/admin address.
    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.owner.write(owner);
        self.execution_fee_rate.write(10_u256); // 0.1%
    }

    #[abi(embed_v0)]
    impl KeeperNetworkImpl of super::IKeeperNetwork<ContractState> {
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

        fn cancel_limit_order(ref self: ContractState, order_id: felt252) {
            let caller = get_caller_address();
            let owner = self.limit_order_owner.entry(order_id).read();
            assert!(owner == caller, "Not order owner");

            let mut order = self.limit_orders.entry(order_id).read();
            assert!(order.status == 1_u8, "Order not active");
            order.status = 3_u8;
            self.limit_orders.entry(order_id).write(order);
            self.emit(Event::LimitOrderCancelled(LimitOrderCancelled { order_id, owner: caller }));
        }

        /// @notice Registers the caller as a keeper.
        /// @dev Initializes keeper stats.
        fn register_keeper(ref self: ContractState) {
            let caller = get_caller_address();
            assert!(!self.registered_keepers.entry(caller).read(), "Already registered");
            self.registered_keepers.entry(caller).write(true);
            
            let initial_stats = KeeperStats {
                total_executions: 0,
                successful: 0,
                failed: 0,
                earnings: 0,
            };
            self.keeper_performance.entry(caller).write(initial_stats);
            self.emit(Event::KeeperRegistered(KeeperRegistered { keeper: caller }));
        }

        /// @notice Unregisters the caller as a keeper.
        /// @dev Stops keeper from executing jobs.
        fn unregister_keeper(ref self: ContractState) {
            let caller = get_caller_address();
            assert!(self.registered_keepers.entry(caller).read(), "Not a registered keeper");
            self.registered_keepers.entry(caller).write(false);
            self.emit(Event::KeeperUnregistered(KeeperUnregistered { keeper: caller }));
        }

        /// @notice Executes a limit order job.
        /// @dev Rewards keeper based on order value.
        /// @param order_id Limit order id.
        /// @param order_value Order value used for fee calculation.
        fn execute_limit_order(ref self: ContractState, order_id: felt252, order_value: u256) {
            let caller = get_caller_address();
            assert!(self.registered_keepers.entry(caller).read(), "Unauthorized keeper");
            let mut order = self.limit_orders.entry(order_id).read();
            let owner = self.limit_order_owner.entry(order_id).read();
            assert!(!owner.is_zero(), "Order not found");
            assert!(order.status == 1_u8, "Order not active");
            assert!(order.expiry > get_block_timestamp(), "Order expired");

            let mut stats = self.keeper_performance.entry(caller).read();
            let fee = (order_value * self.execution_fee_rate.read()) / 10000_u256;

            stats.total_executions += 1;
            stats.successful += 1;
            stats.earnings += fee;

            self.keeper_performance.entry(caller).write(stats);
            order.status = 2_u8;
            self.limit_orders.entry(order_id).write(order);
            self.emit(Event::ExecutionProcessed(ExecutionProcessed { keeper: caller, id: order_id, fee_earned: fee }));
        }

        /// @notice Executes a DCA job.
        /// @dev Rewards keeper based on execution value.
        /// @param dca_id DCA order id.
        /// @param execution_value Execution value used for fee calculation.
        fn execute_dca(ref self: ContractState, dca_id: u64, execution_value: u256) {
            let caller = get_caller_address();
            assert!(self.registered_keepers.entry(caller).read(), "Unauthorized keeper");

            let mut stats = self.keeper_performance.entry(caller).read();
            let fee = (execution_value * self.execution_fee_rate.read()) / 10000_u256;

            stats.total_executions += 1;
            stats.successful += 1;
            stats.earnings += fee;

            self.keeper_performance.entry(caller).write(stats);
            self.emit(Event::ExecutionProcessed(ExecutionProcessed { keeper: caller, id: dca_id.into(), fee_earned: fee }));
        }

        /// @notice Claims accumulated keeper earnings.
        /// @dev Resets earnings after claim.
        /// @return amount Claimed earnings.
        fn claim_earnings(ref self: ContractState) -> u256 {
            let caller = get_caller_address();
            let mut stats = self.keeper_performance.entry(caller).read();
            let amount = stats.earnings;
            assert!(amount > 0, "No earnings to claim");
            stats.earnings = 0;
            self.keeper_performance.entry(caller).write(stats);
            amount
        }

        /// @notice Slashes a keeper.
        /// @dev Owner-only to remove misbehaving keepers.
        /// @param keeper Keeper address to slash.
        fn slash_keeper(ref self: ContractState, keeper: ContractAddress) {
            let caller = get_caller_address();
            assert!(caller == self.owner.read(), "Only owner can slash");
            self.registered_keepers.entry(keeper).write(false);
            self.emit(Event::KeeperSlashed(KeeperSlashed { keeper }));
        }

        /// @notice Returns keeper performance stats.
        /// @dev Read-only helper for dashboards.
        /// @param keeper Keeper address.
        /// @return stats Keeper stats.
        fn get_keeper_stats(self: @ContractState, keeper: ContractAddress) -> KeeperStats {
            self.keeper_performance.entry(keeper).read()
        }

        // Perbaikan: Gunakan @ContractState agar compiler dapat mengakses Storage
        /// @notice Checks if an address is a registered keeper.
        /// @dev Read-only helper for gating.
        /// @param keeper Keeper address.
        /// @return is_keeper True if registered.
        fn is_keeper(self: @ContractState, keeper: ContractAddress) -> bool {
            self.registered_keepers.entry(keeper).read()
        }
    }

    #[abi(embed_v0)]
    impl KeeperNetworkPrivacyImpl of super::IKeeperNetworkPrivacy<ContractState> {
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            assert!(get_caller_address() == self.owner.read(), "Only owner");
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        fn submit_private_keeper_action(
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
                ACTION_DCA,
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
