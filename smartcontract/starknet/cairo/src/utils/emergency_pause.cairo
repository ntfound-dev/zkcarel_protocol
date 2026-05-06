use starknet::ContractAddress;

/// @title IEmergencyPause
/// @notice Protocol-wide pause coordinator for incident response.
#[starknet::interface]
pub trait IEmergencyPause<TContractState> {
    /// @notice Pauses all registered pausable contracts.
    /// @dev Callable only by addresses holding GUARDIAN_ROLE.
    /// @param reason Human-readable reason for the emergency pause.
    fn pause_all(ref self: TContractState, reason: ByteArray);

    /// @notice Unpauses all registered pausable contracts.
    /// @dev Callable only by addresses holding DEFAULT_ADMIN_ROLE.
    fn unpause_all(ref self: TContractState);

    /// @notice Returns whether the system is currently paused.
    /// @return true if paused.
    fn is_paused(self: @TContractState) -> bool;

    /// @notice Registers a contract address as a pause target.
    /// @dev Callable only by DEFAULT_ADMIN_ROLE.
    /// @param address Contract to add to the managed pause list.
    fn add_pausable_contract(ref self: TContractState, address: ContractAddress);

    /// @notice Removes a contract address from the pause target list.
    /// @dev Callable only by DEFAULT_ADMIN_ROLE.
    /// @param address Contract to remove from the managed pause list.
    fn remove_pausable_contract(ref self: TContractState, address: ContractAddress);

    /// @notice Returns the full list of registered pausable contracts.
    /// @return Array of managed contract addresses.
    fn get_pausable_contracts(self: @TContractState) -> Array<ContractAddress>;
}

/// @notice Minimal pausable interface for externally managed contracts.
#[starknet::interface]
pub trait IPausable<TContractState> {
    fn pause(ref self: TContractState);
    fn unpause(ref self: TContractState);
}

/// @title IEmergencyPausePrivacy
/// @notice Hide Mode hooks for emergency-control actions through the privacy router.
#[starknet::interface]
pub trait IEmergencyPausePrivacy<TContractState> {
    /// @notice Sets the privacy router for private emergency actions.
    /// @dev Callable only by DEFAULT_ADMIN_ROLE. Emits `PrivacyRouterUpdated`.
    /// @param router New privacy router address (must be non-zero).
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);

    /// @notice Forwards a nullifier/commitment-bound emergency payload to the privacy router.
    /// @dev Nullifiers are replay-protected: each may only be consumed once.
    /// @param old_root Previous Merkle tree root.
    /// @param new_root Updated Merkle tree root after commitments.
    /// @param nullifiers Nullifiers for inputs being spent.
    /// @param commitments New Merkle commitments.
    /// @param public_inputs ZK circuit public inputs.
    /// @param proof Serialized ZK proof.
    fn submit_private_emergency_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

/// @title EmergencyPause
/// @notice Centralized pause coordinator using a guardian/admin role split.
///         GUARDIAN_ROLE triggers pause; DEFAULT_ADMIN_ROLE restores operation.
#[starknet::contract]
pub mod EmergencyPause {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::get_block_timestamp;
    use core::num::traits::Zero;
    use openzeppelin::access::accesscontrol::AccessControlComponent;
    use openzeppelin::introspection::src5::SRC5Component;
    use crate::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy_action_types::ACTION_EMERGENCY;
    use super::{IPausableDispatcher, IPausableDispatcherTrait};

    use AccessControlComponent::InternalTrait as AccessControlInternalTrait;

    component!(path: AccessControlComponent, storage: access_control, event: AccessControlEvent);
    component!(path: SRC5Component, storage: src5, event: SRC5Event);

    #[abi(embed_v0)]
    impl AccessControlImpl = AccessControlComponent::AccessControlImpl<ContractState>;
    #[abi(embed_v0)]
    impl SRC5Impl = SRC5Component::SRC5Impl<ContractState>;

    pub const DEFAULT_ADMIN_ROLE: felt252 = 0;
    pub const GUARDIAN_ROLE: felt252 = selector!("GUARDIAN_ROLE");

    #[storage]
    pub struct Storage {
        pub paused: bool,
        pub pause_reason: ByteArray,
        pub paused_at: u64,
        pub pause_duration: u64,
        pub contracts_to_pause: Vec<ContractAddress>,
        pub privacy_router: ContractAddress,
        pub used_nullifiers: Map<felt252, bool>,
        #[substorage(v0)]
        pub access_control: AccessControlComponent::Storage,
        #[substorage(v0)]
        pub src5: SRC5Component::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        EmergencyPaused: EmergencyPaused,
        EmergencyUnpaused: EmergencyUnpaused,
        ContractAdded: ContractAdded,
        ContractRemoved: ContractRemoved,
        PrivacyRouterUpdated: PrivacyRouterUpdated,
        #[flat]
        AccessControlEvent: AccessControlComponent::Event,
        #[flat]
        SRC5Event: SRC5Component::Event,
    }

    /// @notice Emitted when the system is emergency-paused.
    #[derive(Drop, starknet::Event)]
    pub struct EmergencyPaused {
        pub reason: ByteArray,
        pub paused_at: u64,
    }

    /// @notice Emitted when the system is unpaused.
    #[derive(Drop, starknet::Event)]
    pub struct EmergencyUnpaused {
        pub unpaused_at: u64,
        pub duration: u64,
    }

    /// @notice Emitted when a pausable contract is registered.
    #[derive(Drop, starknet::Event)]
    pub struct ContractAdded {
        pub address: ContractAddress,
    }

    /// @notice Emitted when a pausable contract is removed from the managed list.
    #[derive(Drop, starknet::Event)]
    pub struct ContractRemoved {
        pub address: ContractAddress,
    }

    /// @notice Emitted when the privacy router address is updated.
    #[derive(Drop, starknet::Event)]
    pub struct PrivacyRouterUpdated {
        pub router: ContractAddress,
    }

    /// @notice Initializes access roles and default unpaused state.
    /// @param admin Address granted DEFAULT_ADMIN_ROLE (can unpause and manage contracts).
    /// @param guardian Address granted GUARDIAN_ROLE (can trigger emergency pause).
    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        guardian: ContractAddress
    ) {
        self.access_control.initializer();
        self.access_control._grant_role(DEFAULT_ADMIN_ROLE, admin);
        self.access_control._grant_role(GUARDIAN_ROLE, guardian);
        self.paused.write(false);
    }

    #[abi(embed_v0)]
    pub impl EmergencyPauseImpl of super::IEmergencyPause<ContractState> {
        /// @inheritdoc IEmergencyPause
        fn pause_all(ref self: ContractState, reason: ByteArray) {
            self.access_control.assert_only_role(GUARDIAN_ROLE);
            assert!(!self.paused.read(), "System already paused");
            let now = get_block_timestamp();
            self.paused.write(true);
            self.pause_reason.write(reason.clone());
            self.paused_at.write(now);
            let len = self.contracts_to_pause.len();
            let mut i: u64 = 0;
            while i < len {
                let addr = self.contracts_to_pause.at(i).read();
                let dispatcher = IPausableDispatcher { contract_address: addr };
                dispatcher.pause();
                i += 1;
            }
            self.emit(Event::EmergencyPaused(EmergencyPaused { reason, paused_at: now }));
        }

        /// @inheritdoc IEmergencyPause
        fn unpause_all(ref self: ContractState) {
            self.access_control.assert_only_role(DEFAULT_ADMIN_ROLE);
            assert!(self.paused.read(), "System not paused");
            let now = get_block_timestamp();
            let start_time = self.paused_at.read();
            let duration = now - start_time;
            self.paused.write(false);
            self.pause_duration.write(duration);
            let len = self.contracts_to_pause.len();
            let mut i: u64 = 0;
            while i < len {
                let addr = self.contracts_to_pause.at(i).read();
                let dispatcher = IPausableDispatcher { contract_address: addr };
                dispatcher.unpause();
                i += 1;
            }
            self.emit(Event::EmergencyUnpaused(EmergencyUnpaused { unpaused_at: now, duration }));
        }

        /// @inheritdoc IEmergencyPause
        fn is_paused(self: @ContractState) -> bool {
            self.paused.read()
        }

        /// @inheritdoc IEmergencyPause
        fn add_pausable_contract(ref self: ContractState, address: ContractAddress) {
            self.access_control.assert_only_role(DEFAULT_ADMIN_ROLE);
            self.contracts_to_pause.push(address);
            self.emit(Event::ContractAdded(ContractAdded { address }));
        }

        /// @inheritdoc IEmergencyPause
        fn remove_pausable_contract(ref self: ContractState, address: ContractAddress) {
            self.access_control.assert_only_role(DEFAULT_ADMIN_ROLE);
            let mut found_index: Option<u64> = Option::None;
            let len = self.contracts_to_pause.len();
            let mut i: u64 = 0;
            while i < len {
                if self.contracts_to_pause.at(i).read() == address {
                    found_index = Option::Some(i);
                    break;
                }
                i += 1;
            }
            if let Option::Some(index) = found_index {
                let last_index = self.contracts_to_pause.len() - 1;
                let last_element = self.contracts_to_pause.at(last_index).read();
                self.contracts_to_pause.at(index).write(last_element);
                self.contracts_to_pause.pop().expect('Vec should not be empty');
                self.emit(Event::ContractRemoved(ContractRemoved { address }));
            }
        }

        /// @inheritdoc IEmergencyPause
        fn get_pausable_contracts(self: @ContractState) -> Array<ContractAddress> {
            let mut contracts = array![];
            for i in 0..self.contracts_to_pause.len() {
                contracts.append(self.contracts_to_pause.at(i).read());
            };
            contracts
        }
    }

    #[abi(embed_v0)]
    impl EmergencyPausePrivacyImpl of super::IEmergencyPausePrivacy<ContractState> {
        /// @inheritdoc IEmergencyPausePrivacy
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.access_control.assert_only_role(DEFAULT_ADMIN_ROLE);
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
            self.emit(Event::PrivacyRouterUpdated(PrivacyRouterUpdated { router }));
        }

        /// @inheritdoc IEmergencyPausePrivacy
        fn submit_private_emergency_action(
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
                ACTION_EMERGENCY,
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
