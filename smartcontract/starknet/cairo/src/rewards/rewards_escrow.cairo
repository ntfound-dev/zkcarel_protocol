use starknet::ContractAddress;

/// @notice Vesting position for a single user's reward allocation.
#[derive(Copy, Clone, Drop, Serde, starknet::Store)]
pub struct Escrow {
    pub user: ContractAddress,
    pub total_amount: u256,
    pub released_amount: u256,
    pub start_time: u64,
    pub vesting_duration: u64,
}

/// @title IRewardsEscrow
/// @notice Linear vesting escrow for reward payouts with optional emergency release.
#[starknet::interface]
pub trait IRewardsEscrow<TContractState> {
    /// @notice Creates a vesting position for `user` with a 30-day linear vesting schedule.
    /// @dev Callable only by the contract owner. Escrow must be enabled. One position per user.
    /// @param user Beneficiary address.
    /// @param amount Total tokens to vest.
    fn create_escrow(ref self: TContractState, user: ContractAddress, amount: u256);

    /// @notice Releases currently vested tokens to `user`.
    /// @dev Callable by the user or the contract owner. Escrow must be enabled.
    /// @param user Beneficiary address.
    fn release_vested(ref self: TContractState, user: ContractAddress);

    /// @notice Returns the amount currently releasable for `user`.
    /// @param user Beneficiary address.
    /// @return Releasable token amount.
    fn get_releasable(self: @TContractState, user: ContractAddress) -> u256;

    /// @notice Releases the remaining locked balance with a 10% penalty, then clears the position.
    /// @dev Callable only by the contract owner. Escrow must be enabled.
    /// @param user Beneficiary whose escrow is being force-released.
    /// @return Net payout after penalty.
    fn emergency_release(ref self: TContractState, user: ContractAddress) -> u256;
}

/// @title IRewardsEscrowAdmin
/// @notice Owner-only operational controls.
#[starknet::interface]
pub trait IRewardsEscrowAdmin<TContractState> {
    /// @notice Enables or disables escrow operations without redeploying.
    /// @dev Callable only by the contract owner. Emits `EnabledUpdated`.
    /// @param enabled true to enable, false to disable.
    fn set_enabled(ref self: TContractState, enabled: bool);
}

/// @title IRewardsEscrowPrivacy
/// @notice Hide Mode hooks for rewards actions through the privacy router.
#[starknet::interface]
pub trait IRewardsEscrowPrivacy<TContractState> {
    /// @notice Sets the privacy router for private rewards actions.
    /// @dev Callable only by the contract owner. Emits `PrivacyRouterUpdated`.
    /// @param router New privacy router address (must be non-zero).
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);

    /// @notice Forwards a nullifier/commitment-bound rewards payload to the router.
    /// @dev Nullifiers are replay-protected: each may only be consumed once.
    /// @param old_root Previous Merkle tree root.
    /// @param new_root Updated Merkle tree root after commitments.
    /// @param nullifiers Nullifiers for inputs being spent.
    /// @param commitments New Merkle commitments.
    /// @param public_inputs ZK circuit public inputs.
    /// @param proof Serialized ZK proof.
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

/// @notice Minimal ERC20 transfer interface for escrow token payouts.
#[starknet::interface]
pub trait IERC20<TContractState> {
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
}

/// @title RewardsEscrow
/// @notice Holds reward escrows with 30-day linear vesting and owner-triggered emergency release.
///         Contract starts disabled; owner must call `set_enabled(true)` after funding.
#[starknet::contract]
pub mod RewardsEscrow {
    use starknet::ContractAddress;
    use starknet::storage::{Map, StoragePointerReadAccess, StoragePointerWriteAccess, StoragePathEntry};
    use starknet::{get_block_timestamp, get_caller_address};
    use super::Escrow;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::security::reentrancyguard::ReentrancyGuardComponent;
    use super::{IERC20Dispatcher, IERC20DispatcherTrait};
    use core::num::traits::Zero;
    use crate::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy_action_types::ACTION_REWARDS;

    const THIRTY_DAYS: u64 = 2592000;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    component!(path: ReentrancyGuardComponent, storage: reentrancy_guard, event: ReentrancyGuardEvent);

    #[abi(embed_v0)]
    impl OwnableTwoStepImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;
    impl ReentrancyGuardInternalImpl = ReentrancyGuardComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub escrows: Map<ContractAddress, Escrow>,
        pub token_address: ContractAddress,
        pub enabled: bool,
        pub privacy_router: ContractAddress,
        pub used_nullifiers: Map<felt252, bool>,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
        #[substorage(v0)]
        pub reentrancy_guard: ReentrancyGuardComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        EscrowCreated: EscrowCreated,
        Released: Released,
        EmergencyReleased: EmergencyReleased,
        EnabledUpdated: EnabledUpdated,
        PrivacyRouterUpdated: PrivacyRouterUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
    }

    /// @notice Emitted when a new escrow position is created.
    #[derive(Drop, starknet::Event)]
    pub struct EscrowCreated {
        pub user: ContractAddress,
        pub amount: u256,
    }

    /// @notice Emitted when vested tokens are released to a user.
    #[derive(Drop, starknet::Event)]
    pub struct Released {
        pub user: ContractAddress,
        pub amount: u256,
    }

    /// @notice Emitted when the owner force-releases an escrow with penalty.
    #[derive(Drop, starknet::Event)]
    pub struct EmergencyReleased {
        pub user: ContractAddress,
        pub payout: u256,
        pub penalty: u256,
    }

    /// @notice Emitted when the escrow enabled state changes.
    #[derive(Drop, starknet::Event)]
    pub struct EnabledUpdated {
        pub enabled: bool,
    }

    /// @notice Emitted when the privacy router address is updated.
    #[derive(Drop, starknet::Event)]
    pub struct PrivacyRouterUpdated {
        pub router: ContractAddress,
    }

    /// @notice Initializes owner and payout token. Escrow is disabled by default.
    /// @param admin Initial contract owner (two-step transfer via OZ OwnableComponent).
    /// @param token ERC20 token address used for vested payouts.
    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress, token: ContractAddress) {
        self.ownable.initializer(admin);
        self.token_address.write(token);
        self.enabled.write(false);
    }

    #[abi(embed_v0)]
    impl RewardsEscrowImpl of super::IRewardsEscrow<ContractState> {
        /// @inheritdoc IRewardsEscrow
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

        /// @inheritdoc IRewardsEscrow
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

        /// @inheritdoc IRewardsEscrow
        fn release_vested(ref self: ContractState, user: ContractAddress) {
            assert!(self.enabled.read(), "Escrow not enabled");
            let caller = get_caller_address();
            let is_owner = caller == self.ownable.owner();
            assert!(caller == user || is_owner, "Unauthorized");

            self.reentrancy_guard.start();
            let mut escrow = self.escrows.entry(user).read();
            let releasable = self.get_releasable(user);
            assert!(releasable > 0, "No tokens to release");
            escrow.released_amount += releasable;
            self.escrows.entry(user).write(escrow);
            let token = IERC20Dispatcher { contract_address: self.token_address.read() };
            let success = token.transfer(user, releasable);
            assert!(success, "Token transfer failed");
            self.reentrancy_guard.end();

            self.emit(Event::Released(Released { user, amount: releasable }));
        }

        /// @inheritdoc IRewardsEscrow
        fn emergency_release(ref self: ContractState, user: ContractAddress) -> u256 {
            assert!(self.enabled.read(), "Escrow not enabled");
            self.ownable.assert_only_owner();

            self.reentrancy_guard.start();
            let mut escrow = self.escrows.entry(user).read();
            assert!(escrow.total_amount > 0, "No active escrow");
            let remaining_balance = escrow.total_amount - escrow.released_amount;
            let penalty = (remaining_balance * 10) / 100;
            let payout = remaining_balance - penalty;
            self.escrows.entry(user).write(Escrow {
                user: escrow.user,
                total_amount: 0,
                released_amount: 0,
                start_time: 0,
                vesting_duration: 0,
            });
            let token = IERC20Dispatcher { contract_address: self.token_address.read() };
            let success = token.transfer(user, payout);
            assert!(success, "Token transfer failed");
            self.reentrancy_guard.end();

            self.emit(Event::EmergencyReleased(EmergencyReleased { user, payout, penalty }));
            payout
        }
    }

    #[abi(embed_v0)]
    impl RewardsEscrowPrivacyImpl of super::IRewardsEscrowPrivacy<ContractState> {
        /// @inheritdoc IRewardsEscrowPrivacy
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
            self.emit(Event::PrivacyRouterUpdated(PrivacyRouterUpdated { router }));
        }

        /// @inheritdoc IRewardsEscrowPrivacy
        fn submit_private_rewards_action(
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
        /// @inheritdoc IRewardsEscrowAdmin
        fn set_enabled(ref self: ContractState, enabled: bool) {
            self.ownable.assert_only_owner();
            self.enabled.write(enabled);
            self.emit(Event::EnabledUpdated(EnabledUpdated { enabled }));
        }
    }
}
