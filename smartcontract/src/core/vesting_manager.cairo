use starknet::ContractAddress;

// Definisi kategori vesting dengan default variant untuk Storage
#[derive(Drop, Serde, Copy, starknet::Store, PartialEq)]
pub enum VestingCategory {
    #[default]
    Investor,
    Tim,
    Marketing,
    Listing,
    EarlyAccess,
    Ecosystem,
    Treasury
}

#[derive(Drop, Serde, Copy, starknet::Store)]
pub struct VestingSchedule {
    pub total_amount: u256,
    pub released_amount: u256,
    pub start_time: u64,
    pub cliff_duration: u64,
    pub vesting_duration: u64,
    pub category: VestingCategory,
    pub is_paused: bool,
}

/// @title Vesting Manager Interface
/// @author CAREL Team
/// @notice Defines vesting lifecycle entrypoints for token allocations.
/// @dev Supports linear vesting with cliffs and pausing.
#[starknet::interface]
pub trait IVestingManager<TContractState> {
    /// @notice Creates a new vesting schedule.
    /// @dev Owner-only to prevent unauthorized allocations.
    /// @param beneficiary Address receiving vested tokens.
    /// @param amount Total amount to vest.
    /// @param category Vesting category identifier.
    /// @param cliff_duration Cliff duration in seconds.
    /// @param vesting_duration Total vesting duration in seconds.
    fn create_vesting(
        ref self: TContractState,
        beneficiary: ContractAddress,
        amount: u256,
        category: VestingCategory,
        cliff_duration: u64,
        vesting_duration: u64
    );
    /// @notice Releases vested tokens for a beneficiary.
    /// @dev Mints tokens based on releasable amount.
    /// @param beneficiary Beneficiary address.
    fn release(ref self: TContractState, beneficiary: ContractAddress);
    /// @notice Pauses or unpauses a beneficiary vesting schedule.
    /// @dev Owner-only to allow incident control.
    /// @param beneficiary Beneficiary address.
    /// @param paused Pause flag.
    fn pause_vesting(ref self: TContractState, beneficiary: ContractAddress, paused: bool);
    /// @notice Calculates releasable tokens for a beneficiary.
    /// @dev Read-only helper for UI and backend.
    /// @param beneficiary Beneficiary address.
    /// @return amount Releasable token amount.
    fn calculate_releasable(self: @TContractState, beneficiary: ContractAddress) -> u256;
    /// @notice Returns vesting schedule details for a beneficiary.
    /// @dev Read-only helper for audits.
    /// @param beneficiary Beneficiary address.
    /// @return schedule Vesting schedule data.
    fn get_vesting_info(self: @TContractState, beneficiary: ContractAddress) -> VestingSchedule;
}

/// @title Vesting Admin Interface
/// @author CAREL Team
/// @notice Administrative entrypoints for tokenomics configuration.
/// @dev Used to set defaults and bootstrap allocations.
#[starknet::interface]
pub trait IVestingAdmin<TContractState> {
    /// @notice Sets default vesting config for a category.
    /// @dev Owner-only to keep tokenomics consistent.
    /// @param category Vesting category identifier.
    /// @param cliff_duration Cliff duration in seconds.
    /// @param vesting_duration Total vesting duration in seconds.
    fn set_default_vesting_config(
        ref self: TContractState,
        category: VestingCategory,
        cliff_duration: u64,
        vesting_duration: u64
    );
    /// @notice Initializes tokenomics vesting schedules.
    /// @dev Owner-only and callable once to prevent reconfiguration.
    /// @param investor Investor beneficiary address.
    /// @param early_access Early access beneficiary address.
    /// @param team Team beneficiary address.
    /// @param marketing Marketing beneficiary address.
    /// @param listing Listing beneficiary address.
    /// @param ecosystem Ecosystem beneficiary address.
    /// @param treasury Treasury beneficiary address.
    /// @param release_immediate Whether to release zero-duration categories.
    fn setup_tokenomics(
        ref self: TContractState,
        investor: ContractAddress,
        early_access: ContractAddress,
        team: ContractAddress,
        marketing: ContractAddress,
        listing: ContractAddress,
        ecosystem: ContractAddress,
        treasury: ContractAddress,
        release_immediate: bool
    );
}

/// @title Vesting Privacy Interface
/// @author CAREL Team
/// @notice ZK privacy hooks for vesting actions.
#[starknet::interface]
pub trait IVestingPrivacy<TContractState> {
    /// @notice Sets privacy router address.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    /// @notice Submits a private vesting action proof.
    fn submit_private_vesting_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

/// @title CAREL Token Minimal Interface
/// @author CAREL Team
/// @notice Minimal mint interface used by vesting manager.
/// @dev Keeps vesting contract dependency surface small.
#[starknet::interface]
pub trait ICarelToken<TContractState> {
    /// @notice Mints CAREL to a recipient.
    /// @dev Used by vesting manager to release tokens.
    /// @param recipient Address receiving minted tokens.
    /// @param amount Amount to mint.
    fn mint(ref self: TContractState, recipient: ContractAddress, amount: u256);
}

/// @title Vesting Manager Contract
/// @author CAREL Team
/// @notice Manages vesting schedules and tokenomics distributions.
/// @dev Mints CAREL via token dispatcher on release.
#[starknet::contract]
pub mod VestingManager {
    use super::{VestingSchedule, VestingCategory, ICarelTokenDispatcher, ICarelTokenDispatcherTrait};
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::get_block_timestamp;
    use core::num::traits::Zero;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_VESTING;
    
    // Perbaikan path import OpenZeppelin
    use openzeppelin::access::ownable::OwnableComponent;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    const ONE_TOKEN: u256 = 1_000_000_000_000_000_000_u256;
    const TOTAL_SUPPLY_CAP: u256 = 1_000_000_000_u256 * ONE_TOKEN; // 1B CAREL
    const BPS_DENOM: u256 = 10000;
    const MONTH_SECONDS: u64 = 2592000;
    const INVESTOR_BPS: u256 = 1500; // 15%
    const EARLY_ACCESS_BPS: u256 = 300; // 3%
    const TEAM_BPS: u256 = 1500; // 15%
    const MARKETING_BPS: u256 = 700; // 7%
    const LISTING_BPS: u256 = 1000; // 10%
    const ECOSYSTEM_BPS: u256 = 4000; // 40%
    const TREASURY_BPS: u256 = 1000; // 10%
    const ECOSYSTEM_MONTHLY_RELEASE: u256 = 6_000_000_u256 * ONE_TOKEN;
    const ECOSYSTEM_MONTHS: u64 = 66;

    #[storage]
    pub struct Storage {
        pub token_address: ContractAddress,
        pub privacy_router: ContractAddress,
        pub vesting_schedules: Map<ContractAddress, VestingSchedule>,
        pub total_allocated: u256,
        pub start_time: u64,
        pub default_cliff: Map<felt252, u64>,
        pub default_duration: Map<felt252, u64>,
        pub tokenomics_initialized: bool,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    fn category_key(category: VestingCategory) -> felt252 {
        match category {
            VestingCategory::Investor => 0,
            VestingCategory::Tim => 1,
            VestingCategory::Marketing => 2,
            VestingCategory::Listing => 3,
            VestingCategory::EarlyAccess => 4,
            VestingCategory::Ecosystem => 5,
            VestingCategory::Treasury => 6,
        }
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        VestingCreated: VestingCreated,
        TokensReleased: TokensReleased,
        VestingPaused: VestingPaused,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct VestingCreated {
        pub beneficiary: ContractAddress,
        pub amount: u256,
        pub category: VestingCategory
    }

    #[derive(Drop, starknet::Event)]
    pub struct TokensReleased {
        pub beneficiary: ContractAddress,
        pub amount: u256
    }

    #[derive(Drop, starknet::Event)]
    pub struct VestingPaused {
        pub beneficiary: ContractAddress,
        pub paused: bool
    }

    /// @notice Initializes the vesting manager.
    /// @dev Sets admin, token address, and default vesting configs.
    /// @param admin Owner/admin address.
    /// @param token CAREL token address.
    /// @param protocol_start Protocol start timestamp.
    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        token: ContractAddress,
        protocol_start: u64
    ) {
        self.ownable.initializer(admin);
        self.token_address.write(token);
        self.start_time.write(protocol_start);
        self.tokenomics_initialized.write(false);

        // Default vesting config (can be updated by admin)
        self.default_cliff.entry(category_key(VestingCategory::Investor)).write(0);
        self.default_duration.entry(category_key(VestingCategory::Investor)).write(36 * MONTH_SECONDS);

        self.default_cliff.entry(category_key(VestingCategory::Tim)).write(6 * MONTH_SECONDS);
        self.default_duration.entry(category_key(VestingCategory::Tim)).write(36 * MONTH_SECONDS);

        self.default_cliff.entry(category_key(VestingCategory::Marketing)).write(0);
        self.default_duration.entry(category_key(VestingCategory::Marketing)).write(24 * MONTH_SECONDS);

        self.default_cliff.entry(category_key(VestingCategory::Listing)).write(0);
        self.default_duration.entry(category_key(VestingCategory::Listing)).write(0);

        self.default_cliff.entry(category_key(VestingCategory::EarlyAccess)).write(0);
        self.default_duration.entry(category_key(VestingCategory::EarlyAccess)).write(0);

        self.default_cliff.entry(category_key(VestingCategory::Ecosystem)).write(0);
        self.default_duration.entry(category_key(VestingCategory::Ecosystem)).write(66 * MONTH_SECONDS);

        self.default_cliff.entry(category_key(VestingCategory::Treasury)).write(0);
        self.default_duration.entry(category_key(VestingCategory::Treasury)).write(0);
    }

    #[abi(embed_v0)]
    impl VestingManagerImpl of super::IVestingManager<ContractState> {
        /// @notice Creates a new vesting schedule.
        /// @dev Owner-only to prevent unauthorized allocations.
        /// @param beneficiary Address receiving vested tokens.
        /// @param amount Total amount to vest.
        /// @param category Vesting category identifier.
        /// @param cliff_duration Cliff duration in seconds.
        /// @param vesting_duration Total vesting duration in seconds.
        fn create_vesting(
            ref self: ContractState,
            beneficiary: ContractAddress,
            amount: u256,
            category: VestingCategory,
            cliff_duration: u64,
            vesting_duration: u64
        ) {
            self.ownable.assert_only_owner();
            let next_total = self.total_allocated.read() + amount;
            assert!(next_total <= TOTAL_SUPPLY_CAP, "Allocation exceeds cap");
            
            let schedule = VestingSchedule {
                total_amount: amount,
                released_amount: 0,
                start_time: self.start_time.read(),
                cliff_duration,
                vesting_duration,
                category,
                is_paused: false,
            };

            self.vesting_schedules.entry(beneficiary).write(schedule);
            self.total_allocated.write(next_total);

            // Perbaikan emisi event: Bungkus struct dalam varian enum
            self.emit(Event::VestingCreated(VestingCreated { beneficiary, amount, category }));
        }

        /// @notice Releases vested tokens for a beneficiary.
        /// @dev Mints tokens based on releasable amount.
        /// @param beneficiary Beneficiary address.
        fn release(ref self: ContractState, beneficiary: ContractAddress) {
            let mut schedule = self.vesting_schedules.entry(beneficiary).read();
            assert!(!schedule.is_paused, "Vesting is paused");
            
            let releasable = self.calculate_releasable(beneficiary);
            assert!(releasable > 0, "Nothing to release");

            schedule.released_amount += releasable;
            self.vesting_schedules.entry(beneficiary).write(schedule);

            let token_dispatcher = ICarelTokenDispatcher { contract_address: self.token_address.read() };
            token_dispatcher.mint(beneficiary, releasable);

            self.emit(Event::TokensReleased(TokensReleased { beneficiary, amount: releasable }));
        }

        /// @notice Pauses or unpauses a beneficiary vesting schedule.
        /// @dev Owner-only to allow incident control.
        /// @param beneficiary Beneficiary address.
        /// @param paused Pause flag.
        fn pause_vesting(ref self: ContractState, beneficiary: ContractAddress, paused: bool) {
            self.ownable.assert_only_owner();
            let mut schedule = self.vesting_schedules.entry(beneficiary).read();
            schedule.is_paused = paused;
            self.vesting_schedules.entry(beneficiary).write(schedule);
            
            self.emit(Event::VestingPaused(VestingPaused { beneficiary, paused }));
        }

        /// @notice Calculates releasable tokens for a beneficiary.
        /// @dev Read-only helper for UI and backend.
        /// @param beneficiary Beneficiary address.
        /// @return amount Releasable token amount.
        fn calculate_releasable(self: @ContractState, beneficiary: ContractAddress) -> u256 {
            let schedule = self.vesting_schedules.entry(beneficiary).read();
            let current_time = get_block_timestamp();

            if current_time < schedule.start_time + schedule.cliff_duration {
                return 0;
            }

            if schedule.vesting_duration == 0 {
                return schedule.total_amount - schedule.released_amount;
            }

            if schedule.category == VestingCategory::Ecosystem {
                let elapsed = current_time - schedule.start_time;
                let mut months_elapsed = elapsed / MONTH_SECONDS;
                if months_elapsed > ECOSYSTEM_MONTHS {
                    months_elapsed = ECOSYSTEM_MONTHS;
                }
                let mut vested = ECOSYSTEM_MONTHLY_RELEASE * months_elapsed.into();
                if months_elapsed >= ECOSYSTEM_MONTHS {
                    vested = schedule.total_amount;
                }
                if vested <= schedule.released_amount {
                    return 0;
                }
                return vested - schedule.released_amount;
            }

            if current_time >= schedule.start_time + schedule.vesting_duration {
                return schedule.total_amount - schedule.released_amount;
            }

            let elapsed = current_time - schedule.start_time;
            let vested = (schedule.total_amount * elapsed.into()) / schedule.vesting_duration.into();
            
            vested - schedule.released_amount
        }

        /// @notice Returns vesting schedule details for a beneficiary.
        /// @dev Read-only helper for audits.
        /// @param beneficiary Beneficiary address.
        /// @return schedule Vesting schedule data.
        fn get_vesting_info(self: @ContractState, beneficiary: ContractAddress) -> VestingSchedule {
            self.vesting_schedules.entry(beneficiary).read()
        }
    }

    #[abi(embed_v0)]
    impl VestingAdminImpl of super::IVestingAdmin<ContractState> {
        /// @notice Sets default vesting config for a category.
        /// @dev Owner-only to keep tokenomics consistent.
        /// @param category Vesting category identifier.
        /// @param cliff_duration Cliff duration in seconds.
        /// @param vesting_duration Total vesting duration in seconds.
        fn set_default_vesting_config(
            ref self: ContractState,
            category: VestingCategory,
            cliff_duration: u64,
            vesting_duration: u64
        ) {
            self.ownable.assert_only_owner();
            let key = category_key(category);
            self.default_cliff.entry(key).write(cliff_duration);
            self.default_duration.entry(key).write(vesting_duration);
        }

        /// @notice Initializes tokenomics vesting schedules.
        /// @dev Owner-only and callable once to prevent reconfiguration.
        /// @param investor Investor beneficiary address.
        /// @param early_access Early access beneficiary address.
        /// @param team Team beneficiary address.
        /// @param marketing Marketing beneficiary address.
        /// @param listing Listing beneficiary address.
        /// @param ecosystem Ecosystem beneficiary address.
        /// @param treasury Treasury beneficiary address.
        /// @param release_immediate Whether to release zero-duration categories.
        fn setup_tokenomics(
            ref self: ContractState,
            investor: ContractAddress,
            early_access: ContractAddress,
            team: ContractAddress,
            marketing: ContractAddress,
            listing: ContractAddress,
            ecosystem: ContractAddress,
            treasury: ContractAddress,
            release_immediate: bool
        ) {
            self.ownable.assert_only_owner();
            assert!(!self.tokenomics_initialized.read(), "Tokenomics already initialized");

            let investor_amount = (TOTAL_SUPPLY_CAP * INVESTOR_BPS) / BPS_DENOM;
            let early_access_amount = (TOTAL_SUPPLY_CAP * EARLY_ACCESS_BPS) / BPS_DENOM;
            let team_amount = (TOTAL_SUPPLY_CAP * TEAM_BPS) / BPS_DENOM;
            let marketing_amount = (TOTAL_SUPPLY_CAP * MARKETING_BPS) / BPS_DENOM;
            let listing_amount = (TOTAL_SUPPLY_CAP * LISTING_BPS) / BPS_DENOM;
            let ecosystem_amount = (TOTAL_SUPPLY_CAP * ECOSYSTEM_BPS) / BPS_DENOM;
            let mut treasury_amount = (TOTAL_SUPPLY_CAP * TREASURY_BPS) / BPS_DENOM;

            let allocated = investor_amount + early_access_amount + team_amount
                + marketing_amount + listing_amount + ecosystem_amount + treasury_amount;
            if allocated < TOTAL_SUPPLY_CAP {
                treasury_amount += TOTAL_SUPPLY_CAP - allocated;
            }

            // Create vesting schedules
            self.create_vesting(
                investor,
                investor_amount,
                VestingCategory::Investor,
                self.default_cliff.entry(category_key(VestingCategory::Investor)).read(),
                self.default_duration.entry(category_key(VestingCategory::Investor)).read()
            );
            self.create_vesting(
                early_access,
                early_access_amount,
                VestingCategory::EarlyAccess,
                self.default_cliff.entry(category_key(VestingCategory::EarlyAccess)).read(),
                self.default_duration.entry(category_key(VestingCategory::EarlyAccess)).read()
            );
            self.create_vesting(
                team,
                team_amount,
                VestingCategory::Tim,
                self.default_cliff.entry(category_key(VestingCategory::Tim)).read(),
                self.default_duration.entry(category_key(VestingCategory::Tim)).read()
            );
            self.create_vesting(
                marketing,
                marketing_amount,
                VestingCategory::Marketing,
                self.default_cliff.entry(category_key(VestingCategory::Marketing)).read(),
                self.default_duration.entry(category_key(VestingCategory::Marketing)).read()
            );
            self.create_vesting(
                listing,
                listing_amount,
                VestingCategory::Listing,
                self.default_cliff.entry(category_key(VestingCategory::Listing)).read(),
                self.default_duration.entry(category_key(VestingCategory::Listing)).read()
            );
            self.create_vesting(
                ecosystem,
                ecosystem_amount,
                VestingCategory::Ecosystem,
                self.default_cliff.entry(category_key(VestingCategory::Ecosystem)).read(),
                self.default_duration.entry(category_key(VestingCategory::Ecosystem)).read()
            );
            self.create_vesting(
                treasury,
                treasury_amount,
                VestingCategory::Treasury,
                self.default_cliff.entry(category_key(VestingCategory::Treasury)).read(),
                self.default_duration.entry(category_key(VestingCategory::Treasury)).read()
            );

            if release_immediate {
                // Only auto-release categories intended for immediate distribution
                let early_duration = self.default_duration.entry(category_key(VestingCategory::EarlyAccess)).read();
                let treasury_duration = self.default_duration.entry(category_key(VestingCategory::Treasury)).read();

                if early_duration == 0 { self.release(early_access); }
                if treasury_duration == 0 { self.release(treasury); }
            }

            self.tokenomics_initialized.write(true);
        }
    }

    #[abi(embed_v0)]
    impl VestingPrivacyImpl of super::IVestingPrivacy<ContractState> {
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        fn submit_private_vesting_action(
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
                ACTION_VESTING,
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
