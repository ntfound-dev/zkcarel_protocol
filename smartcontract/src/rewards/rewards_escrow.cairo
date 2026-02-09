use starknet::ContractAddress;

#[derive(Copy, Clone, Drop, Serde, starknet::Store)]
pub struct Escrow {
    pub user: ContractAddress,
    pub total_amount: u256,
    pub released_amount: u256,
    pub start_time: u64,
    pub vesting_duration: u64,
}

/// @title Rewards Escrow Interface
/// @author CAREL Team
/// @notice Defines vesting escrow entrypoints for rewards.
/// @dev Supports linear vesting and emergency release.
#[starknet::interface]
pub trait IRewardsEscrow<TContractState> {
    /// @notice Creates a new escrow for a user.
    /// @dev Owner-only and requires escrow enabled.
    /// @param user User address.
    /// @param amount Total escrow amount.
    fn create_escrow(ref self: TContractState, user: ContractAddress, amount: u256);
    /// @notice Releases vested tokens for a user.
    /// @dev Callable by user or owner when enabled.
    /// @param user User address.
    fn release_vested(ref self: TContractState, user: ContractAddress);
    /// @notice Returns releasable amount for a user.
    /// @dev Read-only helper for UI.
    /// @param user User address.
    /// @return amount Releasable amount.
    fn get_releasable(self: @TContractState, user: ContractAddress) -> u256;
    /// @notice Emergency release with penalty.
    /// @dev Owner-only to handle exceptional cases.
    /// @param user User address.
    /// @return payout Amount released to user.
    fn emergency_release(ref self: TContractState, user: ContractAddress) -> u256;
}

/// @title Rewards Escrow Admin Interface
/// @author CAREL Team
/// @notice Administrative controls for escrow enablement.
/// @dev Owner-only to toggle escrow usage.
#[starknet::interface]
pub trait IRewardsEscrowAdmin<TContractState> {
    /// @notice Enables or disables escrow functionality.
    /// @dev Owner-only to park or activate escrow.
    /// @param enabled Enable flag.
    fn set_enabled(ref self: TContractState, enabled: bool);
}

/// @title Rewards Escrow Privacy Interface
/// @author CAREL Team
/// @notice ZK privacy hooks for rewards escrow.
#[starknet::interface]
pub trait IRewardsEscrowPrivacy<TContractState> {
    /// @notice Sets privacy router address.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    /// @notice Submits a private rewards escrow action proof.
    fn submit_private_rewards_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

/// @title ERC20 Minimal Interface
/// @author CAREL Team
/// @notice Minimal ERC20 transfer interface for escrow payouts.
/// @dev Used to transfer vested tokens.
#[starknet::interface]
pub trait IERC20<TContractState> {
    /// @notice Transfers tokens to a recipient.
    /// @dev Used for vested and emergency payouts.
    /// @param recipient Recipient address.
    /// @param amount Amount to transfer.
    /// @return success True if transfer succeeded.
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
}

/// @title Rewards Escrow Contract
/// @author CAREL Team
/// @notice Holds reward escrows with linear vesting.
/// @dev Can be parked via admin toggle.
#[starknet::contract]
pub mod RewardsEscrow {
    use starknet::ContractAddress;
    use starknet::storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess, StoragePathEntry};
    use starknet::{get_block_timestamp, get_caller_address};
    use super::Escrow;
    use openzeppelin::access::ownable::OwnableComponent;
    use super::{IERC20Dispatcher, IERC20DispatcherTrait};
    use core::num::traits::Zero;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_REWARDS;

    const THIRTY_DAYS: u64 = 2592000;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub escrows: Map<ContractAddress, Escrow>,
        pub token_address: ContractAddress,
        pub enabled: bool,
        pub privacy_router: ContractAddress,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        EscrowCreated: EscrowCreated,
        Released: Released,
        EmergencyReleased: EmergencyReleased,
        EnabledUpdated: EnabledUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct EscrowCreated {
        pub user: ContractAddress,
        pub amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Released {
        pub user: ContractAddress,
        pub amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct EmergencyReleased {
        pub user: ContractAddress,
        pub payout: u256,
        pub penalty: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct EnabledUpdated {
        pub enabled: bool,
    }

    /// @notice Initializes the rewards escrow.
    /// @dev Sets admin, token address, and disabled state.
    /// @param admin Owner/admin address.
    /// @param token ERC20 token address for payouts.
    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress, token: ContractAddress) {
        self.ownable.initializer(admin);
        self.token_address.write(token);
        self.enabled.write(false); // parked by default
    }

    #[abi(embed_v0)]
    impl RewardsEscrowImpl of super::IRewardsEscrow<ContractState> {
        /// @notice Creates a new escrow for a user.
        /// @dev Owner-only and requires escrow enabled.
        /// @param user User address.
        /// @param amount Total escrow amount.
        fn create_escrow(ref self: ContractState, user: ContractAddress, amount: u256) {
            assert!(self.enabled.read(), "Escrow not enabled");
            self.ownable.assert_only_owner();
            let existing = self.escrows.entry(user).read();
            assert!(existing.total_amount == 0, "Escrow already exists");

            let start_time = get_block_timestamp();
            let new_escrow = Escrow {
                user,
                total_amount: amount,
                released_amount: 0,
                start_time,
                vesting_duration: THIRTY_DAYS,
            };
            self.escrows.entry(user).write(new_escrow);
            self.emit(Event::EscrowCreated(EscrowCreated { user, amount }));
        }

        /// @notice Returns releasable amount for a user.
        /// @dev Read-only helper for UI.
        /// @param user User address.
        /// @return amount Releasable amount.
        fn get_releasable(self: @ContractState, user: ContractAddress) -> u256 {
            let escrow = self.escrows.entry(user).read();
            if escrow.total_amount == 0 {
                return 0;
            }

            let current_time = get_block_timestamp();
            let end_time = escrow.start_time + escrow.vesting_duration;

            let vested_amount = if current_time >= end_time {
                escrow.total_amount
            } else if current_time <= escrow.start_time {
                0
            } else {
                (escrow.total_amount * (current_time - escrow.start_time).into()) 
                / escrow.vesting_duration.into()
            };

            vested_amount - escrow.released_amount
        }

        /// @notice Releases vested tokens for a user.
        /// @dev Callable by user or owner when enabled.
        /// @param user User address.
        fn release_vested(ref self: ContractState, user: ContractAddress) {
            assert!(self.enabled.read(), "Escrow not enabled");
            let caller = get_caller_address();
            let is_owner = caller == self.ownable.owner();
            assert!(caller == user || is_owner, "Unauthorized");

            let mut escrow = self.escrows.entry(user).read();
            let releasable = self.get_releasable(user);
            
            assert!(releasable > 0, "No tokens to release");

            escrow.released_amount += releasable;
            self.escrows.entry(user).write(escrow);

            let token = IERC20Dispatcher { contract_address: self.token_address.read() };
            let success = token.transfer(user, releasable);
            assert!(success, "Token transfer failed");

            self.emit(Event::Released(Released { user, amount: releasable }));
        }

        /// @notice Emergency release with penalty.
        /// @dev Owner-only to handle exceptional cases.
        /// @param user User address.
        /// @return payout Amount released to user.
        fn emergency_release(ref self: ContractState, user: ContractAddress) -> u256 {
            assert!(self.enabled.read(), "Escrow not enabled");
            self.ownable.assert_only_owner();

            let mut escrow = self.escrows.entry(user).read();
            assert!(escrow.total_amount > 0, "No active escrow");

            let remaining_balance = escrow.total_amount - escrow.released_amount;
            let penalty = (remaining_balance * 10) / 100;
            let payout = remaining_balance - penalty;

            // Bersihkan state escrow setelah penarikan darurat
            let cleared_escrow = Escrow {
                user: escrow.user,
                total_amount: 0,
                released_amount: 0,
                start_time: 0,
                vesting_duration: 0,
            };
            self.escrows.entry(user).write(cleared_escrow);

            let token = IERC20Dispatcher { contract_address: self.token_address.read() };
            let success = token.transfer(user, payout);
            assert!(success, "Token transfer failed");

            self.emit(Event::EmergencyReleased(EmergencyReleased { user, payout, penalty }));
            payout
        }
    }

    #[abi(embed_v0)]
    impl RewardsEscrowPrivacyImpl of super::IRewardsEscrowPrivacy<ContractState> {
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        fn submit_private_rewards_action(
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
                ACTION_REWARDS,
                old_root,
                new_root,
                nullifiers,
                commitments,
                public_inputs,
                proof
            );
        }
    }

    #[abi(embed_v0)]
    impl RewardsEscrowAdminImpl of super::IRewardsEscrowAdmin<ContractState> {
        /// @notice Enables or disables escrow functionality.
        /// @dev Owner-only to park or activate escrow.
        /// @param enabled Enable flag.
        fn set_enabled(ref self: ContractState, enabled: bool) {
            self.ownable.assert_only_owner();
            self.enabled.write(enabled);
            self.emit(Event::EnabledUpdated(EnabledUpdated { enabled }));
        }
    }
}
