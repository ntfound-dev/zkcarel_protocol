use starknet::ContractAddress;

// Referral API for linking users and accruing bonus points by epoch.
// Bonus points are later claimed into PointStorage.
#[starknet::interface]
pub trait IReferralSystem<TContractState> {
    // Binds a referee to a referrer once.
    fn register_referral(ref self: TContractState, referrer: ContractAddress, referee: ContractAddress);
    // Returns all referees currently associated with `referrer`.
    fn get_referrals(self: @TContractState, referrer: ContractAddress) -> Array<ContractAddress>;
    // Returns the referrer registered for `referee`.
    fn get_referrer(self: @TContractState, referee: ContractAddress) -> ContractAddress;
    // Returns whether referee activity in `epoch` meets the minimum threshold.
    fn is_valid_referral(self: @TContractState, referee: ContractAddress, epoch: u64) -> bool;
    // Computes referral bonus points from referee activity using current bonus rate.
    fn calculate_referral_bonus(self: @TContractState, referee_points: u256) -> u256;
    // Records referee points and accrues bonus points for the mapped referrer.
    fn record_referee_points(ref self: TContractState, epoch: u64, referee: ContractAddress, points: u256);
    // Claims accrued referral points for caller into PointStorage.
    fn claim_referral_bonus(ref self: TContractState, epoch: u64) -> u256;
}

// Hide Mode hooks for referral actions through the privacy router.
#[starknet::interface]
pub trait IReferralSystemPrivacy<TContractState> {
    // Sets the privacy router used for private referral actions.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    // Forwards nullifier/commitment-bound referral proofs to the router.
    fn submit_private_referral_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

// Owner-only configuration for referral dependencies and thresholds.
#[starknet::interface]
pub trait IReferralAdmin<TContractState> {
    // Sets the backend signer allowed to record referee activity.
    fn set_backend_signer(ref self: TContractState, signer: ContractAddress);
    // Sets the PointStorage contract where bonus points are credited.
    fn set_point_storage(ref self: TContractState, point_storage: ContractAddress);
    // Sets minimum referee points required before bonus accrual starts.
    fn set_min_referee_activity(ref self: TContractState, min_points: u256);
    // Sets referral bonus rate in basis points.
    fn set_referral_bonus_rate(ref self: TContractState, bps: u256);
}

// Minimal interface for adding points.
// Used to credit referral bonuses.
#[starknet::interface]
pub trait IPointStorage<TContractState> {
    // Credits points to a user for a given epoch.
    fn add_points(ref self: TContractState, epoch: u64, user: ContractAddress, points: u256);
}

// Tracks referral graph and bonus points earned from referee activity.
// Bonus points are claimed into PointStorage on demand.
#[starknet::contract]
pub mod ReferralSystem {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::get_caller_address;
    // Enables `.is_zero()` checks on contract addresses.
    use core::num::traits::Zero;
    use openzeppelin::access::ownable::OwnableComponent;
    use super::{IPointStorageDispatcher, IPointStorageDispatcherTrait};
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_REFERRAL;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub referral_list: Map<(ContractAddress, u64), ContractAddress>,
        pub referral_count: Map<ContractAddress, u64>,
        pub referrer_of: Map<ContractAddress, ContractAddress>,
        pub referral_points: Map<(ContractAddress, u64), u256>,
        pub referee_points: Map<(ContractAddress, u64), u256>,
        pub min_referee_activity: u256,
        pub referral_bonus_rate: u256,
        pub backend_signer: ContractAddress,
        pub point_storage: ContractAddress,
        pub privacy_router: ContractAddress,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        ReferralRegistered: ReferralRegistered,
        ReferralPointsRecorded: ReferralPointsRecorded,
        BonusClaimed: BonusClaimed,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ReferralRegistered {
        pub referrer: ContractAddress,
        pub referee: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct BonusClaimed {
        pub referrer: ContractAddress,
        pub amount: u256,
        pub epoch: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ReferralPointsRecorded {
        pub referee: ContractAddress,
        pub referrer: ContractAddress,
        pub epoch: u64,
        pub referee_points: u256,
        pub bonus_points: u256,
    }

    // Initializes owner, backend signer, and point storage dependencies.
    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        signer: ContractAddress,
        point_storage: ContractAddress
    ) {
        self.ownable.initializer(admin);
        self.backend_signer.write(signer);
        self.point_storage.write(point_storage);
        self.min_referee_activity.write(100_u256);
        self.referral_bonus_rate.write(1000_u256); // 10%
    }

    #[abi(embed_v0)]
    pub impl ReferralSystemImpl of super::IReferralSystem<ContractState> {
        // Registers one referral edge (`referrer -> referee`).
        // The referee must self-register and can only be linked once.
        fn register_referral(ref self: ContractState, referrer: ContractAddress, referee: ContractAddress) {
            let caller = get_caller_address();
            assert!(caller == referee, "Referee must be caller");
            // Reject duplicate mappings so a referee cannot change referrer later.
            assert!(self.referrer_of.entry(referee).read().is_zero(), "Referee already has a referrer");
            assert!(referrer != referee, "Cannot refer yourself");
            assert!(!referrer.is_zero(), "Invalid referrer");

            self.referrer_of.entry(referee).write(referrer);
            
            let count = self.referral_count.entry(referrer).read();
            self.referral_list.entry((referrer, count)).write(referee);
            self.referral_count.entry(referrer).write(count + 1);

            self.emit(Event::ReferralRegistered(ReferralRegistered { referrer, referee }));
        }

        // Returns the stored referral list for `referrer`.
        fn get_referrals(self: @ContractState, referrer: ContractAddress) -> Array<ContractAddress> {
            let count = self.referral_count.entry(referrer).read();
            let mut referrals = array![];
            let mut i: u64 = 0;
            while i < count {
                referrals.append(self.referral_list.entry((referrer, i)).read());
                i += 1;
            };
            referrals
        }

        // Returns the referrer currently mapped to `referee`.
        fn get_referrer(self: @ContractState, referee: ContractAddress) -> ContractAddress {
            self.referrer_of.entry(referee).read()
        }

        // Checks if referee points in `epoch` pass the configured activity floor.
        fn is_valid_referral(self: @ContractState, referee: ContractAddress, epoch: u64) -> bool {
            let points = self.referee_points.entry((referee, epoch)).read();
            points >= self.min_referee_activity.read()
        }

        // Computes bonus points using basis points over referee points.
        fn calculate_referral_bonus(self: @ContractState, referee_points: u256) -> u256 {
            (referee_points * self.referral_bonus_rate.read()) / 10000
        }

        // Updates referee points for an epoch and accrues only the delta as new bonus.
        // This prevents double-counting when backend reports cumulative totals.
        fn record_referee_points(ref self: ContractState, epoch: u64, referee: ContractAddress, points: u256) {
            assert!(get_caller_address() == self.backend_signer.read(), "Caller is not authorized");
            let referrer = self.referrer_of.entry(referee).read();
            if referrer.is_zero() {
                return;
            }

            let current = self.referee_points.entry((referee, epoch)).read();
            if points <= current {
                return;
            }
            let delta = points - current;
            let updated = points;
            self.referee_points.entry((referee, epoch)).write(updated);

            let mut bonus: u256 = 0;
            if updated >= self.min_referee_activity.read() {
                bonus = self.calculate_referral_bonus(delta);
                let current_bonus = self.referral_points.entry((referrer, epoch)).read();
                self.referral_points.entry((referrer, epoch)).write(current_bonus + bonus);
            }

            self.emit(Event::ReferralPointsRecorded(ReferralPointsRecorded {
                referee,
                referrer,
                epoch,
                referee_points: updated,
                bonus_points: bonus
            }));
        }

        // Moves caller's accrued referral bonus into PointStorage and clears local balance.
        fn claim_referral_bonus(ref self: ContractState, epoch: u64) -> u256 {
            let caller = get_caller_address();
            let available_points = self.referral_points.entry((caller, epoch)).read();
            assert!(available_points > 0, "No points to claim");

            let point_storage = self.point_storage.read();
            assert!(!point_storage.is_zero(), "Point storage not set");
            let dispatcher = IPointStorageDispatcher { contract_address: point_storage };
            dispatcher.add_points(epoch, caller, available_points);

            self.referral_points.entry((caller, epoch)).write(0);

            self.emit(Event::BonusClaimed(BonusClaimed { referrer: caller, amount: available_points, epoch }));
            available_points
        }
    }

    #[abi(embed_v0)]
    pub impl ReferralAdminImpl of super::IReferralAdmin<ContractState> {
        // Updates the backend signer used by `record_referee_points`.
        fn set_backend_signer(ref self: ContractState, signer: ContractAddress) {
            self.ownable.assert_only_owner();
            self.backend_signer.write(signer);
        }

        // Updates the PointStorage dependency for bonus crediting.
        fn set_point_storage(ref self: ContractState, point_storage: ContractAddress) {
            self.ownable.assert_only_owner();
            self.point_storage.write(point_storage);
        }

        // Updates minimum referee activity required for bonus accrual.
        fn set_min_referee_activity(ref self: ContractState, min_points: u256) {
            self.ownable.assert_only_owner();
            self.min_referee_activity.write(min_points);
        }

        // Updates referral bonus rate in basis points.
        fn set_referral_bonus_rate(ref self: ContractState, bps: u256) {
            self.ownable.assert_only_owner();
            self.referral_bonus_rate.write(bps);
        }
    }

    #[abi(embed_v0)]
    impl ReferralSystemPrivacyImpl of super::IReferralSystemPrivacy<ContractState> {
        // Configures the privacy router for Hide Mode referral actions.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        // Forwards private referral payload to privacy router for proof verification and execution.
        // `nullifiers` prevent replay and `commitments` bind the intended state transition.
        fn submit_private_referral_action(
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
                ACTION_REFERRAL,
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
