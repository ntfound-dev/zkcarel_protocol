use starknet::ContractAddress;

/// @title Point Storage Interface
/// @author CAREL Team
/// @notice Defines point tracking entrypoints by epoch.
/// @dev Supports backend-submitted points and controlled consumption.
#[starknet::interface]
pub trait IPointStorage<TContractState> {
    /// @notice Submits points for a user in an epoch.
    /// @dev Backend-only to prevent unauthorized updates.
    /// @param epoch Epoch identifier.
    /// @param user User address.
    /// @param points Point amount to set.
    fn submit_points(ref self: TContractState, epoch: u64, user: ContractAddress, points: u256);
    /// @notice Adds points to a user in an epoch.
    /// @dev Authorized producers only.
    /// @param epoch Epoch identifier.
    /// @param user User address.
    /// @param points Points to add.
    fn add_points(ref self: TContractState, epoch: u64, user: ContractAddress, points: u256);
    /// @notice Consumes points from a user in an epoch.
    /// @dev Authorized consumers only.
    /// @param epoch Epoch identifier.
    /// @param user User address.
    /// @param amount Points to consume.
    fn consume_points(ref self: TContractState, epoch: u64, user: ContractAddress, amount: u256);
    /// @notice Finalizes an epoch with total points.
    /// @dev Prevents further edits after finalization.
    /// @param epoch Epoch identifier.
    /// @param total_points Total points in the epoch.
    fn finalize_epoch(ref self: TContractState, epoch: u64, total_points: u256);
    /// @notice Returns user points for an epoch.
    /// @dev Read-only helper for UIs.
    /// @param epoch Epoch identifier.
    /// @param user User address.
    /// @return points User points.
    fn get_user_points(self: @TContractState, epoch: u64, user: ContractAddress) -> u256;
    /// @notice Returns global points for an epoch.
    /// @dev Read-only helper for reward calculations.
    /// @param epoch Epoch identifier.
    /// @return points Global points.
    fn get_global_points(self: @TContractState, epoch: u64) -> u256;
    /// @notice Returns whether an epoch is finalized.
    /// @dev Read-only helper for backend logic.
    /// @param epoch Epoch identifier.
    /// @return finalized True if finalized.
    fn is_epoch_finalized(self: @TContractState, epoch: u64) -> bool;
}

/// @title Point Storage Privacy Interface
/// @author CAREL Team
/// @notice ZK privacy entrypoints for points actions.
#[starknet::interface]
pub trait IPointStoragePrivacy<TContractState> {
    /// @notice Sets privacy router address.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    /// @notice Submits a private points action proof.
    fn submit_private_points_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

/// @title Point Storage Admin Interface
/// @author CAREL Team
/// @notice Administrative controls for producers/consumers.
/// @dev Backend-only to manage authorized actors.
#[starknet::interface]
pub trait IPointStorageAdmin<TContractState> {
    /// @notice Authorizes a points consumer.
    /// @dev Backend-only to keep consumption trusted.
    /// @param consumer Consumer address.
    fn add_consumer(ref self: TContractState, consumer: ContractAddress);
    /// @notice Authorizes a points producer.
    /// @dev Backend-only to keep submissions trusted.
    /// @param producer Producer address.
    fn add_producer(ref self: TContractState, producer: ContractAddress);
}

/// @title Point Storage Contract
/// @author CAREL Team
/// @notice Stores user points by epoch for rewards and discounts.
/// @dev Enforces backend authorization and epoch finalization.
#[starknet::contract]
pub mod PointStorage {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::storage::*;
    use core::num::traits::Zero;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_POINTS;

    #[storage]
    pub struct Storage {
        pub points: Map<u64, Map<ContractAddress, u256>>,
        pub global_points: Map<u64, u256>,
        pub epoch_finalized: Map<u64, bool>,
        pub backend_signer: ContractAddress,
        pub authorized_consumers: Map<ContractAddress, bool>,
        pub authorized_producers: Map<ContractAddress, bool>,
        pub privacy_router: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PointsUpdated: PointsUpdated,
        EpochFinalized: EpochFinalized,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PointsUpdated {
        pub epoch: u64,
        pub user: ContractAddress,
        pub points: u256
    }

    #[derive(Drop, starknet::Event)]
    pub struct EpochFinalized {
        pub epoch: u64,
        pub total_points: u256
    }

    /// @notice Initializes the point storage.
    /// @dev Sets backend signer as the initial authority.
    /// @param signer Backend signer address.
    #[constructor]
    fn constructor(ref self: ContractState, signer: ContractAddress) {
        self.backend_signer.write(signer);
    }

    #[abi(embed_v0)]
    impl PointStorageImpl of super::IPointStorage<ContractState> {
        /// @notice Submits points for a user in an epoch.
        /// @dev Backend-only to prevent unauthorized updates.
        /// @param epoch Epoch identifier.
        /// @param user User address.
        /// @param points Point amount to set.
        fn submit_points(ref self: ContractState, epoch: u64, user: ContractAddress, points: u256) {
            assert!(get_caller_address() == self.backend_signer.read(), "Caller is not authorized");
            assert!(!self.epoch_finalized.entry(epoch).read(), "Epoch already finalized");

            self.points.entry(epoch).entry(user).write(points);
            self.emit(Event::PointsUpdated(PointsUpdated { epoch, user, points }));
        }

        /// @notice Adds points to a user in an epoch.
        /// @dev Authorized producers only.
        /// @param epoch Epoch identifier.
        /// @param user User address.
        /// @param points Points to add.
        fn add_points(ref self: ContractState, epoch: u64, user: ContractAddress, points: u256) {
            let caller = get_caller_address();
            let is_authorized = caller == self.backend_signer.read() || self.authorized_producers.entry(caller).read();
            assert!(is_authorized, "Caller is not authorized");
            assert!(!self.epoch_finalized.entry(epoch).read(), "Epoch already finalized");

            let current = self.points.entry(epoch).entry(user).read();
            let updated = current + points;
            self.points.entry(epoch).entry(user).write(updated);
            self.emit(Event::PointsUpdated(PointsUpdated { epoch, user, points: updated }));
        }

        /// @notice Consumes points from a user in an epoch.
        /// @dev Authorized consumers only.
        /// @param epoch Epoch identifier.
        /// @param user User address.
        /// @param amount Points to consume.
        fn consume_points(ref self: ContractState, epoch: u64, user: ContractAddress, amount: u256) {
            let caller = get_caller_address();
            let is_authorized = caller == self.backend_signer.read() || self.authorized_consumers.entry(caller).read();
            assert!(is_authorized, "Caller is not authorized");
            assert!(!self.epoch_finalized.entry(epoch).read(), "Epoch already finalized");

            let current = self.points.entry(epoch).entry(user).read();
            assert!(current >= amount, "Insufficient points");
            self.points.entry(epoch).entry(user).write(current - amount);
            self.emit(Event::PointsUpdated(PointsUpdated { epoch, user, points: current - amount }));
        }

        /// @notice Finalizes an epoch with total points.
        /// @dev Prevents further edits after finalization.
        /// @param epoch Epoch identifier.
        /// @param total_points Total points in the epoch.
        fn finalize_epoch(ref self: ContractState, epoch: u64, total_points: u256) {
            assert!(get_caller_address() == self.backend_signer.read(), "Caller is not authorized");
            assert!(!self.epoch_finalized.entry(epoch).read(), "Epoch already finalized");

            self.global_points.entry(epoch).write(total_points);
            self.epoch_finalized.entry(epoch).write(true);
            self.emit(Event::EpochFinalized(EpochFinalized { epoch, total_points }));
        }

        /// @notice Returns user points for an epoch.
        /// @dev Read-only helper for UIs.
        /// @param epoch Epoch identifier.
        /// @param user User address.
        /// @return points User points.
        fn get_user_points(self: @ContractState, epoch: u64, user: ContractAddress) -> u256 {
            self.points.entry(epoch).entry(user).read()
        }

        /// @notice Returns global points for an epoch.
        /// @dev Read-only helper for reward calculations.
        /// @param epoch Epoch identifier.
        /// @return points Global points.
        fn get_global_points(self: @ContractState, epoch: u64) -> u256 {
            self.global_points.entry(epoch).read()
        }

        /// @notice Returns whether an epoch is finalized.
        /// @dev Read-only helper for backend logic.
        /// @param epoch Epoch identifier.
        /// @return finalized True if finalized.
        fn is_epoch_finalized(self: @ContractState, epoch: u64) -> bool {
            self.epoch_finalized.entry(epoch).read()
        }
    }

    #[abi(embed_v0)]
    impl PointStorageAdminImpl of super::IPointStorageAdmin<ContractState> {
        /// @notice Authorizes a points consumer.
        /// @dev Backend-only to keep consumption trusted.
        /// @param consumer Consumer address.
        fn add_consumer(ref self: ContractState, consumer: ContractAddress) {
            assert!(get_caller_address() == self.backend_signer.read(), "Caller is not authorized");
            self.authorized_consumers.entry(consumer).write(true);
        }

        /// @notice Authorizes a points producer.
        /// @dev Backend-only to keep submissions trusted.
        /// @param producer Producer address.
        fn add_producer(ref self: ContractState, producer: ContractAddress) {
            assert!(get_caller_address() == self.backend_signer.read(), "Caller is not authorized");
            self.authorized_producers.entry(producer).write(true);
        }
    }

    #[abi(embed_v0)]
    impl PointStoragePrivacyImpl of super::IPointStoragePrivacy<ContractState> {
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            assert!(get_caller_address() == self.backend_signer.read(), "Caller is not authorized");
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        fn submit_private_points_action(
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
                ACTION_POINTS,
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
