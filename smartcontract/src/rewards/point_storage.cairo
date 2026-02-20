use starknet::ContractAddress;

// Point ledger API used by rewards, referrals, and discounts.
// Values are tracked per epoch and can be locked after finalization.
#[starknet::interface]
pub trait IPointStorage<TContractState> {
    // Sets the exact point balance for a user in an epoch.
    fn submit_points(ref self: TContractState, epoch: u64, user: ContractAddress, points: u256);
    // Adds points to an existing user balance for an epoch.
    fn add_points(ref self: TContractState, epoch: u64, user: ContractAddress, points: u256);
    // Deducts points from a user balance, reverting on insufficient points.
    fn consume_points(ref self: TContractState, epoch: u64, user: ContractAddress, amount: u256);
    // Finalizes an epoch and stores the global points total for conversion.
    fn finalize_epoch(ref self: TContractState, epoch: u64, total_points: u256);
    // Returns points assigned to `user` in `epoch`.
    fn get_user_points(self: @TContractState, epoch: u64, user: ContractAddress) -> u256;
    // Returns the finalized global points total for `epoch`.
    fn get_global_points(self: @TContractState, epoch: u64) -> u256;
    // Returns true when the epoch is locked against further mutations.
    fn is_epoch_finalized(self: @TContractState, epoch: u64) -> bool;
    // Converts points into a CAREL allocation using finalized epoch totals.
    fn convert_points_to_carel(
        self: @TContractState,
        epoch: u64,
        user_points: u256,
        total_distribution: u256
    ) -> u256;
}

// Hide Mode hooks for points actions routed through the privacy layer.
#[starknet::interface]
pub trait IPointStoragePrivacy<TContractState> {
    // Sets the privacy router used to relay private points actions.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    // Forwards a nullifier/commitment-bound points proof to the privacy router.
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

// Role management for services that can add or consume points.
#[starknet::interface]
pub trait IPointStorageAdmin<TContractState> {
    // Grants permission to consume points.
    fn add_consumer(ref self: TContractState, consumer: ContractAddress);
    // Grants permission to add points.
    fn add_producer(ref self: TContractState, producer: ContractAddress);
}

// On-chain point storage with backend/role-based write access.
// Used as the source of truth for epoch rewards distribution.
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

    // Initializes the contract and sets the initial backend signer authority.
    #[constructor]
    fn constructor(ref self: ContractState, signer: ContractAddress) {
        self.backend_signer.write(signer);
    }

    #[abi(embed_v0)]
    impl PointStorageImpl of super::IPointStorage<ContractState> {
        // Writes an absolute point value for `(epoch, user)`.
        // Only the backend signer can call this entrypoint.
        fn submit_points(ref self: ContractState, epoch: u64, user: ContractAddress, points: u256) {
            assert!(get_caller_address() == self.backend_signer.read(), "Caller is not authorized");
            assert!(!self.epoch_finalized.entry(epoch).read(), "Epoch already finalized");

            self.points.entry(epoch).entry(user).write(points);
            self.emit(Event::PointsUpdated(PointsUpdated { epoch, user, points }));
        }

        // Increases points for `(epoch, user)`.
        // Callable by backend signer or authorized producer contracts.
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

        // Decreases points for `(epoch, user)` after balance checks.
        // Callable by backend signer or authorized consumer contracts.
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

        // Locks an epoch and stores `total_points` for proportional conversions.
        fn finalize_epoch(ref self: ContractState, epoch: u64, total_points: u256) {
            assert!(get_caller_address() == self.backend_signer.read(), "Caller is not authorized");
            assert!(!self.epoch_finalized.entry(epoch).read(), "Epoch already finalized");

            self.global_points.entry(epoch).write(total_points);
            self.epoch_finalized.entry(epoch).write(true);
            self.emit(Event::EpochFinalized(EpochFinalized { epoch, total_points }));
        }

        // Returns points currently recorded for `(epoch, user)`.
        fn get_user_points(self: @ContractState, epoch: u64, user: ContractAddress) -> u256 {
            self.points.entry(epoch).entry(user).read()
        }

        // Returns the global points total recorded at finalization.
        fn get_global_points(self: @ContractState, epoch: u64) -> u256 {
            self.global_points.entry(epoch).read()
        }

        // Returns true when the epoch is finalized and immutable.
        fn is_epoch_finalized(self: @ContractState, epoch: u64) -> bool {
            self.epoch_finalized.entry(epoch).read()
        }

        // Converts user points into CAREL allocation for a finalized epoch.
        // Returns 0 when epoch is not finalized or has zero total points.
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
        // Adds a contract/address to the consumer allowlist.
        fn add_consumer(ref self: ContractState, consumer: ContractAddress) {
            assert!(get_caller_address() == self.backend_signer.read(), "Caller is not authorized");
            self.authorized_consumers.entry(consumer).write(true);
        }

        // Adds a contract/address to the producer allowlist.
        fn add_producer(ref self: ContractState, producer: ContractAddress) {
            assert!(get_caller_address() == self.backend_signer.read(), "Caller is not authorized");
            self.authorized_producers.entry(producer).write(true);
        }
    }

    #[abi(embed_v0)]
    impl PointStoragePrivacyImpl of super::IPointStoragePrivacy<ContractState> {
        // Configures the privacy router used for Hide Mode points actions.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            assert!(get_caller_address() == self.backend_signer.read(), "Caller is not authorized");
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        // Submits a private points action to the router.
        // The proof payload is expected to bind `nullifiers` and `commitments`.
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
