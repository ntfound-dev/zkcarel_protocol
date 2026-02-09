use starknet::ContractAddress;

/// @title Referral System Interface
/// @author CAREL Team
/// @notice Defines referral registration and bonus accounting.
/// @dev Tracks referrers and credits bonus points by epoch.
#[starknet::interface]
pub trait IReferralSystem<TContractState> {
    /// @notice Registers a referral relationship.
    /// @dev Referee must call to prevent spoofing.
    /// @param referrer Referrer address.
    /// @param referee Referee address.
    fn register_referral(ref self: TContractState, referrer: ContractAddress, referee: ContractAddress);
    /// @notice Returns the list of referrals for a referrer.
    /// @dev Read-only helper for UIs.
    /// @param referrer Referrer address.
    /// @return referrals Array of referees.
    fn get_referrals(self: @TContractState, referrer: ContractAddress) -> Array<ContractAddress>;
    /// @notice Returns the referrer for a referee.
    /// @dev Read-only helper for UIs.
    /// @param referee Referee address.
    /// @return referrer Referrer address.
    fn get_referrer(self: @TContractState, referee: ContractAddress) -> ContractAddress;
    /// @notice Checks whether a referral is valid for an epoch.
    /// @dev Uses referee activity threshold.
    /// @param referee Referee address.
    /// @param epoch Epoch identifier.
    /// @return valid True if valid.
    fn is_valid_referral(self: @TContractState, referee: ContractAddress, epoch: u64) -> bool;
    /// @notice Calculates referral bonus from referee points.
    /// @dev Uses configured bonus rate.
    /// @param referee_points Points earned by referee.
    /// @return bonus Bonus points to award.
    fn calculate_referral_bonus(self: @TContractState, referee_points: u256) -> u256;
    /// @notice Records referee points and credits referrer bonus.
    /// @dev Backend-only to prevent spoofed activity.
    /// @param epoch Epoch identifier.
    /// @param referee Referee address.
    /// @param points Referee points value.
    fn record_referee_points(ref self: TContractState, epoch: u64, referee: ContractAddress, points: u256);
    /// @notice Claims referral bonus points for the caller.
    /// @dev Mints points in PointStorage and zeroes balance.
    /// @param epoch Epoch identifier.
    /// @return claimed Points claimed.
    fn claim_referral_bonus(ref self: TContractState, epoch: u64) -> u256;
}

/// @title Referral System Privacy Interface
/// @author CAREL Team
/// @notice ZK privacy entrypoints for referral actions.
#[starknet::interface]
pub trait IReferralSystemPrivacy<TContractState> {
    /// @notice Sets privacy router address.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    /// @notice Submits a private referral action proof.
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

/// @title Referral Admin Interface
/// @author CAREL Team
/// @notice Administrative controls for referral parameters.
/// @dev Owner-only configuration for backend and rates.
#[starknet::interface]
pub trait IReferralAdmin<TContractState> {
    /// @notice Sets the backend signer address.
    /// @dev Owner-only to secure updates.
    /// @param signer Backend signer address.
    fn set_backend_signer(ref self: TContractState, signer: ContractAddress);
    /// @notice Sets the PointStorage contract address.
    /// @dev Owner-only to secure reward minting.
    /// @param point_storage PointStorage contract address.
    fn set_point_storage(ref self: TContractState, point_storage: ContractAddress);
    /// @notice Sets minimum referee activity threshold.
    /// @dev Owner-only to control referral quality.
    /// @param min_points Minimum referee points required.
    fn set_min_referee_activity(ref self: TContractState, min_points: u256);
    /// @notice Sets referral bonus rate in bps.
    /// @dev Owner-only to control economics.
    /// @param bps Bonus rate in basis points.
    fn set_referral_bonus_rate(ref self: TContractState, bps: u256);
}

/// @title Point Storage Interface
/// @author CAREL Team
/// @notice Minimal interface for adding points.
/// @dev Used to credit referral bonuses.
#[starknet::interface]
pub trait IPointStorage<TContractState> {
    /// @notice Adds points for a user in an epoch.
    /// @dev Called when claiming referral bonuses.
    /// @param epoch Epoch identifier.
    /// @param user User address.
    /// @param points Points to add.
    fn add_points(ref self: TContractState, epoch: u64, user: ContractAddress, points: u256);
}

/// @title Referral System Contract
/// @author CAREL Team
/// @notice Tracks referrals and awards bonus points.
/// @dev Backend-driven point updates with on-chain claiming.
#[starknet::contract]
pub mod ReferralSystem {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::get_caller_address;
    // Impor trait Zero untuk mengaktifkan metode .is_zero() pada ContractAddress
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

    /// @notice Initializes the referral system.
    /// @dev Sets admin, backend signer, and point storage.
    /// @param admin Owner/admin address.
    /// @param signer Backend signer address.
    /// @param point_storage PointStorage contract address.
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
        /// @notice Registers a referral relationship.
        /// @dev Referee must call to prevent spoofing.
        /// @param referrer Referrer address.
        /// @param referee Referee address.
        fn register_referral(ref self: ContractState, referrer: ContractAddress, referee: ContractAddress) {
            let caller = get_caller_address();
            assert!(caller == referee, "Referee must be caller");
            // Penggunaan .is_zero() sekarang valid karena trait Zero telah diimpor
            assert!(self.referrer_of.entry(referee).read().is_zero(), "Referee already has a referrer");
            assert!(referrer != referee, "Cannot refer yourself");
            assert!(!referrer.is_zero(), "Invalid referrer");

            self.referrer_of.entry(referee).write(referrer);
            
            let count = self.referral_count.entry(referrer).read();
            self.referral_list.entry((referrer, count)).write(referee);
            self.referral_count.entry(referrer).write(count + 1);

            self.emit(Event::ReferralRegistered(ReferralRegistered { referrer, referee }));
        }

        /// @notice Returns the list of referrals for a referrer.
        /// @dev Read-only helper for UIs.
        /// @param referrer Referrer address.
        /// @return referrals Array of referees.
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

        /// @notice Returns the referrer for a referee.
        /// @dev Read-only helper for UIs.
        /// @param referee Referee address.
        /// @return referrer Referrer address.
        fn get_referrer(self: @ContractState, referee: ContractAddress) -> ContractAddress {
            self.referrer_of.entry(referee).read()
        }

        /// @notice Checks whether a referral is valid for an epoch.
        /// @dev Uses referee activity threshold.
        /// @param referee Referee address.
        /// @param epoch Epoch identifier.
        /// @return valid True if valid.
        fn is_valid_referral(self: @ContractState, referee: ContractAddress, epoch: u64) -> bool {
            let points = self.referee_points.entry((referee, epoch)).read();
            points >= self.min_referee_activity.read()
        }

        /// @notice Calculates referral bonus from referee points.
        /// @dev Uses configured bonus rate.
        /// @param referee_points Points earned by referee.
        /// @return bonus Bonus points to award.
        fn calculate_referral_bonus(self: @ContractState, referee_points: u256) -> u256 {
            (referee_points * self.referral_bonus_rate.read()) / 10000
        }

        /// @notice Records referee points and credits referrer bonus.
        /// @dev Backend-only to prevent spoofed activity.
        /// @param epoch Epoch identifier.
        /// @param referee Referee address.
        /// @param points Referee points value.
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

        /// @notice Claims referral bonus points for the caller.
        /// @dev Mints points in PointStorage and zeroes balance.
        /// @param epoch Epoch identifier.
        /// @return claimed Points claimed.
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
        /// @notice Sets the backend signer address.
        /// @dev Owner-only to secure updates.
        /// @param signer Backend signer address.
        fn set_backend_signer(ref self: ContractState, signer: ContractAddress) {
            self.ownable.assert_only_owner();
            self.backend_signer.write(signer);
        }

        /// @notice Sets the PointStorage contract address.
        /// @dev Owner-only to secure reward minting.
        /// @param point_storage PointStorage contract address.
        fn set_point_storage(ref self: ContractState, point_storage: ContractAddress) {
            self.ownable.assert_only_owner();
            self.point_storage.write(point_storage);
        }

        /// @notice Sets minimum referee activity threshold.
        /// @dev Owner-only to control referral quality.
        /// @param min_points Minimum referee points required.
        fn set_min_referee_activity(ref self: ContractState, min_points: u256) {
            self.ownable.assert_only_owner();
            self.min_referee_activity.write(min_points);
        }

        /// @notice Sets referral bonus rate in bps.
        /// @dev Owner-only to control economics.
        /// @param bps Bonus rate in basis points.
        fn set_referral_bonus_rate(ref self: ContractState, bps: u256) {
            self.ownable.assert_only_owner();
            self.referral_bonus_rate.write(bps);
        }
    }

    #[abi(embed_v0)]
    impl ReferralSystemPrivacyImpl of super::IReferralSystemPrivacy<ContractState> {
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

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
