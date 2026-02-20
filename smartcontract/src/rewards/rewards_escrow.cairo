use starknet::ContractAddress;

#[derive(Copy, Clone, Drop, Serde, starknet::Store)]
pub struct Escrow {
    pub user: ContractAddress,
    pub total_amount: u256,
    pub released_amount: u256,
    pub start_time: u64,
    pub vesting_duration: u64,
}

// Escrow API for vested reward payouts.
// Supports normal linear release and owner-triggered emergency release.
#[starknet::interface]
pub trait IRewardsEscrow<TContractState> {
    // Creates a vesting position for `user` with `amount`.
    fn create_escrow(ref self: TContractState, user: ContractAddress, amount: u256);
    // Releases currently vested tokens for `user`.
    fn release_vested(ref self: TContractState, user: ContractAddress);
    // Returns the amount currently releasable for `user`.
    fn get_releasable(self: @TContractState, user: ContractAddress) -> u256;
    // Releases remaining escrow with penalty and clears position state.
    fn emergency_release(ref self: TContractState, user: ContractAddress) -> u256;
}

// Owner-only operational controls.
#[starknet::interface]
pub trait IRewardsEscrowAdmin<TContractState> {
    // Enables or disables escrow actions.
    fn set_enabled(ref self: TContractState, enabled: bool);
}

// Hide Mode hooks for rewards actions through the privacy router.
#[starknet::interface]
pub trait IRewardsEscrowPrivacy<TContractState> {
    // Sets the privacy router used for private rewards actions.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    // Forwards a nullifier/commitment-bound rewards payload to the router.
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

// Minimal ERC20 transfer interface for escrow payouts.
// Used to transfer vested tokens.
#[starknet::interface]
pub trait IERC20<TContractState> {
    // Transfers tokens from this contract to a recipient.
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
}

// Holds reward escrows and handles vesting-based token release.
// Contract starts disabled and is enabled by owner when configured.
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

    // Initializes owner and payout token, with escrow disabled by default.
    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress, token: ContractAddress) {
        self.ownable.initializer(admin);
        self.token_address.write(token);
        self.enabled.write(false); // parked by default
    }

    #[abi(embed_v0)]
    impl RewardsEscrowImpl of super::IRewardsEscrow<ContractState> {
        // Creates one escrow position per user with a fixed 30-day vesting period.
        // Only owner can create and contract must be enabled.
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

        // Computes vested-but-unreleased amount using linear vesting over time.
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

        // Releases currently vested tokens to `user`.
        // Callable by the user or owner for operational recovery.
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

        // Owner emergency path: release remaining escrow with a 10% penalty.
        // Escrow state is zeroed after payout.
        fn emergency_release(ref self: ContractState, user: ContractAddress) -> u256 {
            assert!(self.enabled.read(), "Escrow not enabled");
            self.ownable.assert_only_owner();

            let mut escrow = self.escrows.entry(user).read();
            assert!(escrow.total_amount > 0, "No active escrow");

            let remaining_balance = escrow.total_amount - escrow.released_amount;
            let penalty = (remaining_balance * 10) / 100;
            let payout = remaining_balance - penalty;

            // Clear escrow so the position cannot be released again.
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
        // Configures the privacy router for Hide Mode rewards actions.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        // Sends private rewards payload to privacy router for proof verification and execution.
        // `nullifiers` enforce one-time use and `commitments` bind intended action data.
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
        // Toggles escrow functionality without redeploying the contract.
        fn set_enabled(ref self: ContractState, enabled: bool) {
            self.ownable.assert_only_owner();
            self.enabled.write(enabled);
            self.emit(Event::EnabledUpdated(EnabledUpdated { enabled }));
        }
    }
}
