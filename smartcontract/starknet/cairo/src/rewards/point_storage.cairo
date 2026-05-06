use starknet::ContractAddress;

/// @title IPointStorage
/// @notice Point ledger API for epoch-based reward accounting.
///         Values are tracked per epoch and locked after finalization.
#[starknet::interface]
pub trait IPointStorage<TContractState> {
    /// @notice Sets the exact point balance for a user in an epoch.
    /// @dev Callable only by the backend signer. Reverts if epoch is finalized.
    /// @param epoch The target epoch.
    /// @param user The user whose balance to set.
    /// @param points New absolute point balance.
    fn submit_points(ref self: TContractState, epoch: u64, user: ContractAddress, points: u256);

    /// @notice Adds points to a user's existing balance in an epoch.
    /// @dev Callable by backend signer or authorized producers. Reverts if epoch is finalized.
    /// @param epoch The target epoch.
    /// @param user The user to credit.
    /// @param points Points to add.
    fn add_points(ref self: TContractState, epoch: u64, user: ContractAddress, points: u256);

    /// @notice Deducts points from a user's balance. Reverts on insufficient balance.
    /// @dev Callable by backend signer or authorized consumers. Reverts if epoch is finalized.
    /// @param epoch The target epoch.
    /// @param user The user to debit.
    /// @param amount Points to consume.
    fn consume_points(ref self: TContractState, epoch: u64, user: ContractAddress, amount: u256);

    /// @notice Finalizes an epoch and stores the global points total for proportional conversion.
    /// @dev Callable only by the backend signer. Once finalized, the epoch is immutable.
    /// @param epoch The epoch to finalize.
    /// @param total_points Global points total at finalization time.
    fn finalize_epoch(ref self: TContractState, epoch: u64, total_points: u256);

    /// @notice Returns points assigned to `user` in `epoch`.
    /// @param epoch The epoch to query.
    /// @param user The user to query.
    /// @return Point balance.
    fn get_user_points(self: @TContractState, epoch: u64, user: ContractAddress) -> u256;

    /// @notice Returns the finalized global points total for `epoch`.
    /// @param epoch The epoch to query.
    /// @return Global points total (0 if not finalized).
    fn get_global_points(self: @TContractState, epoch: u64) -> u256;

    /// @notice Returns true when the epoch is locked against further mutations.
    /// @param epoch The epoch to query.
    /// @return true if finalized.
    fn is_epoch_finalized(self: @TContractState, epoch: u64) -> bool;

    /// @notice Converts user points into a CAREL allocation using finalized epoch totals.
    /// @dev Returns 0 if epoch is not finalized or global total is zero.
    /// @param epoch The epoch to convert for.
    /// @param user_points User's point balance for the epoch.
    /// @param total_distribution Total CAREL available for distribution.
    /// @return Proportional CAREL allocation.
    fn convert_points_to_carel(
        self: @TContractState,
        epoch: u64,
        user_points: u256,
        total_distribution: u256
    ) -> u256;
}

/// @title IPointStoragePrivacy
/// @notice Hide Mode hooks for points actions routed through the privacy layer.
#[starknet::interface]
pub trait IPointStoragePrivacy<TContractState> {
    /// @notice Sets the privacy router used to relay private points actions.
    /// @dev Callable only by the contract owner. Emits `PrivacyRouterUpdated`.
    /// @param router New privacy router address (must be non-zero).
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);

    /// @notice Forwards a nullifier/commitment-bound points proof to the privacy router.
    /// @dev Nullifiers are replay-protected: each may only be consumed once.
    /// @param old_root Previous Merkle tree root.
    /// @param new_root Updated Merkle tree root after commitments.
    /// @param nullifiers Nullifiers for inputs being spent.
    /// @param commitments New Merkle commitments.
    /// @param public_inputs ZK circuit public inputs.
    /// @param proof Serialized ZK proof.
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

/// @title IPointStorageAdmin
/// @notice Owner-only role management for producers and consumers.
#[starknet::interface]
pub trait IPointStorageAdmin<TContractState> {
    /// @notice Grants the consumer role to an address.
    /// @dev Callable only by the contract owner. Emits `ConsumerUpdated`.
    /// @param consumer Address to authorize for point consumption.
    fn add_consumer(ref self: TContractState, consumer: ContractAddress);

    /// @notice Revokes the consumer role from an address.
    /// @dev Callable only by the contract owner. Emits `ConsumerUpdated`.
    /// @param consumer Address to deauthorize.
    fn remove_consumer(ref self: TContractState, consumer: ContractAddress);

    /// @notice Grants the producer role to an address.
    /// @dev Callable only by the contract owner. Emits `ProducerUpdated`.
    /// @param producer Address to authorize for point addition.
    fn add_producer(ref self: TContractState, producer: ContractAddress);

    /// @notice Revokes the producer role from an address.
    /// @dev Callable only by the contract owner. Emits `ProducerUpdated`.
    /// @param producer Address to deauthorize.
    fn remove_producer(ref self: TContractState, producer: ContractAddress);

    /// @notice Replaces the backend signer address.
    /// @dev Callable only by the contract owner. Emits `BackendSignerUpdated`.
    /// @param signer New backend signer address (must be non-zero).
    fn set_backend_signer(ref self: TContractState, signer: ContractAddress);
}

/// @title PointStorage
/// @notice On-chain point ledger with backend/role-based write access.
///         Used as the source of truth for epoch rewards distribution.
#[starknet::contract]
pub mod PointStorage {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::storage::*;
    use core::num::traits::Zero;
    use openzeppelin::access::ownable::OwnableComponent;
    use crate::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy_action_types::ACTION_POINTS;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableTwoStepImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub points: Map<u64, Map<ContractAddress, u256>>,
        pub global_points: Map<u64, u256>,
        pub epoch_finalized: Map<u64, bool>,
        pub backend_signer: ContractAddress,
        pub authorized_consumers: Map<ContractAddress, bool>,
        pub authorized_producers: Map<ContractAddress, bool>,
        pub privacy_router: ContractAddress,
        pub used_nullifiers: Map<felt252, bool>,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PointsUpdated: PointsUpdated,
        EpochFinalized: EpochFinalized,
        ConsumerUpdated: ConsumerUpdated,
        ProducerUpdated: ProducerUpdated,
        BackendSignerUpdated: BackendSignerUpdated,
        PrivacyRouterUpdated: PrivacyRouterUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    /// @notice Emitted when a user's point balance changes in an epoch.
    #[derive(Drop, starknet::Event)]
    pub struct PointsUpdated {
        pub epoch: u64,
        pub user: ContractAddress,
        pub points: u256,
    }

    /// @notice Emitted when an epoch is finalized.
    #[derive(Drop, starknet::Event)]
    pub struct EpochFinalized {
        pub epoch: u64,
        pub total_points: u256,
    }

    /// @notice Emitted when a consumer address is granted or revoked.
    #[derive(Drop, starknet::Event)]
    pub struct ConsumerUpdated {
        pub consumer: ContractAddress,
        pub authorized: bool,
    }

    /// @notice Emitted when a producer address is granted or revoked.
    #[derive(Drop, starknet::Event)]
    pub struct ProducerUpdated {
        pub producer: ContractAddress,
        pub authorized: bool,
    }

    /// @notice Emitted when the backend signer address is updated.
    #[derive(Drop, starknet::Event)]
    pub struct BackendSignerUpdated {
        pub signer: ContractAddress,
    }

    /// @notice Emitted when the privacy router address is updated.
    #[derive(Drop, starknet::Event)]
    pub struct PrivacyRouterUpdated {
        pub router: ContractAddress,
    }

    /// @notice Initializes the contract owner and backend signer.
    /// @param admin Initial contract owner (two-step transfer via OZ OwnableComponent).
    /// @param signer Backend signer authorized for data write operations.
    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress, signer: ContractAddress) {
        self.ownable.initializer(admin);
        self.backend_signer.write(signer);
    }

    #[abi(embed_v0)]
    impl PointStorageImpl of super::IPointStorage<ContractState> {
        /// @inheritdoc IPointStorage
        fn submit_points(ref self: ContractState, epoch: u64, user: ContractAddress, points: u256) {
            assert!(get_caller_address() == self.backend_signer.read(), "Caller is not authorized");
            assert!(!self.epoch_finalized.entry(epoch).read(), "Epoch already finalized");
            self.points.entry(epoch).entry(user).write(points);
            self.emit(Event::PointsUpdated(PointsUpdated { epoch, user, points }));
        }

        /// @inheritdoc IPointStorage
        fn add_points(ref self: ContractState, epoch: u64, user: ContractAddress, points: u256) {
            let caller = get_caller_address();
            let is_authorized = caller == self.backend_signer.read()
                || self.authorized_producers.entry(caller).read();
            assert!(is_authorized, "Caller is not authorized");
            assert!(!self.epoch_finalized.entry(epoch).read(), "Epoch already finalized");
            let current = self.points.entry(epoch).entry(user).read();
            let updated = current + points;
            self.points.entry(epoch).entry(user).write(updated);
            self.emit(Event::PointsUpdated(PointsUpdated { epoch, user, points: updated }));
        }

        /// @inheritdoc IPointStorage
        fn consume_points(ref self: ContractState, epoch: u64, user: ContractAddress, amount: u256) {
            let caller = get_caller_address();
            let is_authorized = caller == self.backend_signer.read()
                || self.authorized_consumers.entry(caller).read();
            assert!(is_authorized, "Caller is not authorized");
            assert!(!self.epoch_finalized.entry(epoch).read(), "Epoch already finalized");
            let current = self.points.entry(epoch).entry(user).read();
            assert!(current >= amount, "Insufficient points");
            self.points.entry(epoch).entry(user).write(current - amount);
            self.emit(Event::PointsUpdated(PointsUpdated { epoch, user, points: current - amount }));
        }

        /// @inheritdoc IPointStorage
        fn finalize_epoch(ref self: ContractState, epoch: u64, total_points: u256) {
            assert!(get_caller_address() == self.backend_signer.read(), "Caller is not authorized");
            assert!(!self.epoch_finalized.entry(epoch).read(), "Epoch already finalized");
            self.global_points.entry(epoch).write(total_points);
            self.epoch_finalized.entry(epoch).write(true);
            self.emit(Event::EpochFinalized(EpochFinalized { epoch, total_points }));
        }

        /// @inheritdoc IPointStorage
        fn get_user_points(self: @ContractState, epoch: u64, user: ContractAddress) -> u256 {
            self.points.entry(epoch).entry(user).read()
        }

        /// @inheritdoc IPointStorage
        fn get_global_points(self: @ContractState, epoch: u64) -> u256 {
            self.global_points.entry(epoch).read()
        }

        /// @inheritdoc IPointStorage
        fn is_epoch_finalized(self: @ContractState, epoch: u64) -> bool {
            self.epoch_finalized.entry(epoch).read()
        }

        /// @inheritdoc IPointStorage
        fn convert_points_to_carel(
            self: @ContractState,
            epoch: u64,
            user_points: u256,
            total_distribution: u256
        ) -> u256 {
            if !self.epoch_finalized.entry(epoch).read() {
                return 0;
            }
            let total_points = self.global_points.entry(epoch).read();
            if total_points == 0 {
                return 0;
            }
            (user_points * total_distribution) / total_points
        }
    }

    #[abi(embed_v0)]
    impl PointStorageAdminImpl of super::IPointStorageAdmin<ContractState> {
        /// @inheritdoc IPointStorageAdmin
        fn add_consumer(ref self: ContractState, consumer: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!consumer.is_zero(), "Consumer required");
            self.authorized_consumers.entry(consumer).write(true);
            self.emit(Event::ConsumerUpdated(ConsumerUpdated { consumer, authorized: true }));
        }

        /// @inheritdoc IPointStorageAdmin
        fn remove_consumer(ref self: ContractState, consumer: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!consumer.is_zero(), "Consumer required");
            self.authorized_consumers.entry(consumer).write(false);
            self.emit(Event::ConsumerUpdated(ConsumerUpdated { consumer, authorized: false }));
        }

        /// @inheritdoc IPointStorageAdmin
        fn add_producer(ref self: ContractState, producer: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!producer.is_zero(), "Producer required");
            self.authorized_producers.entry(producer).write(true);
            self.emit(Event::ProducerUpdated(ProducerUpdated { producer, authorized: true }));
        }

        /// @inheritdoc IPointStorageAdmin
        fn remove_producer(ref self: ContractState, producer: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!producer.is_zero(), "Producer required");
            self.authorized_producers.entry(producer).write(false);
            self.emit(Event::ProducerUpdated(ProducerUpdated { producer, authorized: false }));
        }

        /// @inheritdoc IPointStorageAdmin
        fn set_backend_signer(ref self: ContractState, signer: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!signer.is_zero(), "Signer required");
            self.backend_signer.write(signer);
            self.emit(Event::BackendSignerUpdated(BackendSignerUpdated { signer }));
        }
    }

    #[abi(embed_v0)]
    impl PointStoragePrivacyImpl of super::IPointStoragePrivacy<ContractState> {
        /// @inheritdoc IPointStoragePrivacy
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
            self.emit(Event::PrivacyRouterUpdated(PrivacyRouterUpdated { router }));
        }

        /// @inheritdoc IPointStoragePrivacy
        fn submit_private_points_action(
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
