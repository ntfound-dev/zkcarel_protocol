use starknet::ContractAddress;

/// @title IReferralSystem
/// @notice Referral graph and bonus point accrual API.
#[starknet::interface]
pub trait IReferralSystem<TContractState> {
    /// @notice Registers a referral edge from `referrer` to `referee`.
    /// @dev Caller must be the referee. Each address may only have one referrer.
    ///      Circular one-hop loops are rejected. Referrer must meet minimum activity floor.
    /// @param referrer The referring address.
    /// @param referee The new user being referred (must be the caller).
    fn register_referral(ref self: TContractState, referrer: ContractAddress, referee: ContractAddress);

    /// @notice Returns all referees currently associated with `referrer`.
    /// @param referrer The referrer to query.
    /// @return Array of referee addresses.
    fn get_referrals(self: @TContractState, referrer: ContractAddress) -> Array<ContractAddress>;

    /// @notice Returns the referrer registered for `referee`.
    /// @param referee The address to query.
    /// @return Referrer address, or zero if not registered.
    fn get_referrer(self: @TContractState, referee: ContractAddress) -> ContractAddress;

    /// @notice Returns whether referee activity in `epoch` meets the minimum threshold.
    /// @param referee The referee to check.
    /// @param epoch The epoch to check.
    /// @return true if referee points >= `min_referee_activity`.
    fn is_valid_referral(self: @TContractState, referee: ContractAddress, epoch: u64) -> bool;

    /// @notice Computes referral bonus points from referee points using the current bonus rate.
    /// @param referee_points Referee point balance.
    /// @return Bonus points for the referrer.
    fn calculate_referral_bonus(self: @TContractState, referee_points: u256) -> u256;

    /// @notice Records referee points for an epoch and accrues bonus to the referrer.
    /// @dev Callable only by the backend signer. Incremental — only the delta from last
    ///      recorded value is bonused to avoid double-counting.
    /// @param epoch The epoch to record for.
    /// @param referee The referee whose activity is being recorded.
    /// @param points New absolute referee point total for the epoch.
    fn record_referee_points(ref self: TContractState, epoch: u64, referee: ContractAddress, points: u256);

    /// @notice Claims accrued referral bonus for the caller into PointStorage.
    /// @dev Clears local balance on success. Reverts if no points are available.
    /// @param epoch The epoch to claim for.
    /// @return Amount of points credited.
    fn claim_referral_bonus(ref self: TContractState, epoch: u64) -> u256;
}

/// @title IReferralSystemPrivacy
/// @notice Hide Mode hooks for referral actions through the privacy router.
#[starknet::interface]
pub trait IReferralSystemPrivacy<TContractState> {
    /// @notice Sets the privacy router for private referral actions.
    /// @dev Callable only by the contract owner. Emits `PrivacyRouterUpdated`.
    /// @param router New privacy router address (must be non-zero).
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);

    /// @notice Forwards a nullifier/commitment-bound referral proof to the router.
    /// @dev Nullifiers are replay-protected: each may only be consumed once.
    /// @param old_root Previous Merkle tree root.
    /// @param new_root Updated Merkle tree root after commitments.
    /// @param nullifiers Nullifiers for inputs being spent.
    /// @param commitments New Merkle commitments.
    /// @param public_inputs ZK circuit public inputs.
    /// @param proof Serialized ZK proof.
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

/// @title IReferralAdmin
/// @notice Owner-only configuration for referral dependencies and thresholds.
#[starknet::interface]
pub trait IReferralAdmin<TContractState> {
    /// @notice Replaces the backend signer authorized to record referee activity.
    /// @param signer New backend signer address.
    fn set_backend_signer(ref self: TContractState, signer: ContractAddress);

    /// @notice Replaces the PointStorage contract where bonus points are credited.
    /// @param point_storage New PointStorage address.
    fn set_point_storage(ref self: TContractState, point_storage: ContractAddress);

    /// @notice Sets the minimum referee points required before bonus accrual starts.
    /// @param min_points Minimum activity threshold.
    fn set_min_referee_activity(ref self: TContractState, min_points: u256);

    /// @notice Sets the referral bonus rate in basis points.
    /// @param bps Basis points (e.g. 1000 = 10%).
    fn set_referral_bonus_rate(ref self: TContractState, bps: u256);

    /// @notice Sets the minimum activity required for a referrer to be eligible.
    /// @param min_points Minimum referrer activity threshold.
    fn set_min_referrer_activity(ref self: TContractState, min_points: u256);
}

/// @notice Minimal PointStorage interface for bonus crediting.
#[starknet::interface]
pub trait IPointStorage<TContractState> {
    fn add_points(ref self: TContractState, epoch: u64, user: ContractAddress, points: u256);
}

/// @title ReferralSystem
/// @notice Tracks the referral graph and accrues bonus points from referee activity.
///         Bonus points are claimed into PointStorage on demand.
#[starknet::contract]
pub mod ReferralSystem {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::get_caller_address;
    use core::num::traits::Zero;
    use openzeppelin::access::ownable::OwnableComponent;
    use super::{IPointStorageDispatcher, IPointStorageDispatcherTrait};
    use crate::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy_action_types::ACTION_REFERRAL;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableTwoStepImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub referral_list: Map<(ContractAddress, u64), ContractAddress>,
        pub referral_count: Map<ContractAddress, u64>,
        pub referrer_of: Map<ContractAddress, ContractAddress>,
        pub referral_points: Map<(ContractAddress, u64), u256>,
        pub referee_points: Map<(ContractAddress, u64), u256>,
        pub referee_bonus_awarded: Map<(ContractAddress, u64), u256>,
        pub referee_total_points: Map<ContractAddress, u256>,
        pub min_referee_activity: u256,
        pub min_referrer_activity: u256,
        pub referral_bonus_rate: u256,
        pub backend_signer: ContractAddress,
        pub point_storage: ContractAddress,
        pub privacy_router: ContractAddress,
        pub used_nullifiers: Map<felt252, bool>,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        ReferralRegistered: ReferralRegistered,
        ReferralPointsRecorded: ReferralPointsRecorded,
        BonusClaimed: BonusClaimed,
        PrivacyRouterUpdated: PrivacyRouterUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    /// @notice Emitted when a new referral relationship is registered.
    #[derive(Drop, starknet::Event)]
    pub struct ReferralRegistered {
        pub referrer: ContractAddress,
        pub referee: ContractAddress,
    }

    /// @notice Emitted when referee points are recorded and bonus is accrued.
    #[derive(Drop, starknet::Event)]
    pub struct ReferralPointsRecorded {
        pub referee: ContractAddress,
        pub referrer: ContractAddress,
        pub epoch: u64,
        pub referee_points: u256,
        pub bonus_points: u256,
    }

    /// @notice Emitted when a referrer claims their accrued bonus points.
    #[derive(Drop, starknet::Event)]
    pub struct BonusClaimed {
        pub referrer: ContractAddress,
        pub amount: u256,
        pub epoch: u64,
    }

    /// @notice Emitted when the privacy router address is updated.
    #[derive(Drop, starknet::Event)]
    pub struct PrivacyRouterUpdated {
        pub router: ContractAddress,
    }

    /// @notice Initializes owner, backend signer, and PointStorage dependency.
    /// @param admin Initial contract owner (two-step transfer via OZ OwnableComponent).
    /// @param signer Backend signer authorized to record referee activity.
    /// @param point_storage PointStorage contract for bonus crediting.
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
        self.min_referrer_activity.write(100_u256);
        self.referral_bonus_rate.write(1000_u256); // 10%
    }

    #[abi(embed_v0)]
    pub impl ReferralSystemImpl of super::IReferralSystem<ContractState> {
        /// @inheritdoc IReferralSystem
        fn register_referral(ref self: ContractState, referrer: ContractAddress, referee: ContractAddress) {
            let caller = get_caller_address();
            assert!(caller == referee, "Referee must be caller");
            assert!(referrer != referee, "Cannot refer yourself");
            assert!(!referrer.is_zero(), "Invalid referrer");
            assert!(self.referrer_of.entry(referee).read().is_zero(), "Referee already has a referrer");
            let referrer_referrer = self.referrer_of.entry(referrer).read();
            assert!(referrer_referrer != referee, "Circular referral");
            let min_referrer = self.min_referrer_activity.read();
            if min_referrer > 0 {
                let activity = self.referee_total_points.entry(referrer).read();
                assert!(activity >= min_referrer, "Referrer activity too low");
            }

            self.referrer_of.entry(referee).write(referrer);
            let count = self.referral_count.entry(referrer).read();
            self.referral_list.entry((referrer, count)).write(referee);
            self.referral_count.entry(referrer).write(count + 1);
            self.emit(Event::ReferralRegistered(ReferralRegistered { referrer, referee }));
        }

        /// @inheritdoc IReferralSystem
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

        /// @inheritdoc IReferralSystem
        fn get_referrer(self: @ContractState, referee: ContractAddress) -> ContractAddress {
            self.referrer_of.entry(referee).read()
        }

        /// @inheritdoc IReferralSystem
        fn is_valid_referral(self: @ContractState, referee: ContractAddress, epoch: u64) -> bool {
            let points = self.referee_points.entry((referee, epoch)).read();
            points >= self.min_referee_activity.read()
        }

        /// @inheritdoc IReferralSystem
        fn calculate_referral_bonus(self: @ContractState, referee_points: u256) -> u256 {
            (referee_points * self.referral_bonus_rate.read()) / 10000
        }

        /// @inheritdoc IReferralSystem
        fn record_referee_points(ref self: ContractState, epoch: u64, referee: ContractAddress, points: u256) {
            assert!(get_caller_address() == self.backend_signer.read(), "Caller is not authorized");
            let current = self.referee_points.entry((referee, epoch)).read();
            if points <= current {
                return;
            }
            let delta = points - current;
            self.referee_points.entry((referee, epoch)).write(points);
            let lifetime = self.referee_total_points.entry(referee).read();
            self.referee_total_points.entry(referee).write(lifetime + delta);

            let referrer = self.referrer_of.entry(referee).read();
            if referrer.is_zero() {
                return;
            }

            let min_activity = self.min_referee_activity.read();
            let eligible_points = if points >= min_activity { points } else { 0_u256 };
            let total_bonus = self.calculate_referral_bonus(eligible_points);
            let awarded = self.referee_bonus_awarded.entry((referee, epoch)).read();

            let mut bonus: u256 = 0;
            if total_bonus > awarded {
                bonus = total_bonus - awarded;
                self.referee_bonus_awarded.entry((referee, epoch)).write(total_bonus);
                let current_bonus = self.referral_points.entry((referrer, epoch)).read();
                self.referral_points.entry((referrer, epoch)).write(current_bonus + bonus);
            }

            self.emit(Event::ReferralPointsRecorded(ReferralPointsRecorded {
                referee,
                referrer,
                epoch,
                referee_points: points,
                bonus_points: bonus,
            }));
        }

        /// @inheritdoc IReferralSystem
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
        /// @inheritdoc IReferralAdmin
        fn set_backend_signer(ref self: ContractState, signer: ContractAddress) {
            self.ownable.assert_only_owner();
            self.backend_signer.write(signer);
        }

        /// @inheritdoc IReferralAdmin
        fn set_point_storage(ref self: ContractState, point_storage: ContractAddress) {
            self.ownable.assert_only_owner();
            self.point_storage.write(point_storage);
        }

        /// @inheritdoc IReferralAdmin
        fn set_min_referee_activity(ref self: ContractState, min_points: u256) {
            self.ownable.assert_only_owner();
            self.min_referee_activity.write(min_points);
        }

        /// @inheritdoc IReferralAdmin
        fn set_referral_bonus_rate(ref self: ContractState, bps: u256) {
            self.ownable.assert_only_owner();
            self.referral_bonus_rate.write(bps);
        }

        /// @inheritdoc IReferralAdmin
        fn set_min_referrer_activity(ref self: ContractState, min_points: u256) {
            self.ownable.assert_only_owner();
            self.min_referrer_activity.write(min_points);
        }
    }

    #[abi(embed_v0)]
    impl ReferralSystemPrivacyImpl of super::IReferralSystemPrivacy<ContractState> {
        /// @inheritdoc IReferralSystemPrivacy
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
            self.emit(Event::PrivacyRouterUpdated(PrivacyRouterUpdated { router }));
        }

        /// @inheritdoc IReferralSystemPrivacy
        fn submit_private_referral_action(
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
