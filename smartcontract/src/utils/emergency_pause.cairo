use starknet::ContractAddress;

/// @title Emergency Pause Interface
/// @author CAREL Team
/// @notice Defines protocol-wide pause controls for incident response.
/// @dev Exposes minimal pause controls to reduce operational risk.
#[starknet::interface]
pub trait IEmergencyPause<TContractState> {
    /// @notice Pauses the protocol and records a reason.
    /// @dev Restricted to guardians for rapid response.
    /// @param reason Human-readable reason for the pause.
    fn pause_all(ref self: TContractState, reason: ByteArray);
    /// @notice Unpauses the protocol after an incident.
    /// @dev Restricted to admins to ensure controlled recovery.
    fn unpause_all(ref self: TContractState);
    /// @notice Returns whether the protocol is paused.
    /// @dev Read-only helper for UI and monitoring.
    /// @return paused True if the protocol is paused.
    fn is_paused(self: @TContractState) -> bool;
    /// @notice Adds a contract address to the pausable set.
    /// @dev Allows admins to expand the pause scope safely.
    /// @param address Contract address to add.
    fn add_pausable_contract(ref self: TContractState, address: ContractAddress);
    /// @notice Removes a contract address from the pausable set.
    /// @dev Allows admins to shrink the pause scope safely.
    /// @param address Contract address to remove.
    fn remove_pausable_contract(ref self: TContractState, address: ContractAddress);
    /// @notice Returns the current list of pausable contracts.
    /// @dev Read-only helper for tooling and audits.
    /// @return contracts Array of pausable contract addresses.
    fn get_pausable_contracts(self: @TContractState) -> Array<ContractAddress>;
}

/// @title Emergency Pause Privacy Interface
/// @author CAREL Team
/// @notice ZK privacy hooks for emergency controls.
#[starknet::interface]
pub trait IEmergencyPausePrivacy<TContractState> {
    /// @notice Sets privacy router address.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    /// @notice Submits a private emergency action proof.
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

/// @title Emergency Pause Contract
/// @author CAREL Team
/// @notice Central pause switch for CAREL protocol contracts.
/// @dev Uses role-based access control for guardian/admin separation.
#[starknet::contract]
pub mod EmergencyPause {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::get_block_timestamp;
    use core::num::traits::Zero;
    
    use openzeppelin::access::accesscontrol::AccessControlComponent;
    use openzeppelin::introspection::src5::SRC5Component;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_EMERGENCY;

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
        paused: bool,
        pause_reason: ByteArray,
        paused_at: u64,
        pause_duration: u64,
        contracts_to_pause: Vec<ContractAddress>,
        privacy_router: ContractAddress,
        #[substorage(v0)]
        access_control: AccessControlComponent::Storage,
        #[substorage(v0)]
        src5: SRC5Component::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        EmergencyPaused: EmergencyPaused,
        EmergencyUnpaused: EmergencyUnpaused,
        ContractAdded: ContractAdded,
        ContractRemoved: ContractRemoved,
        #[flat]
        AccessControlEvent: AccessControlComponent::Event,
        #[flat]
        SRC5Event: SRC5Component::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct EmergencyPaused {
        pub reason: ByteArray,
        pub paused_at: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct EmergencyUnpaused {
        pub unpaused_at: u64,
        pub duration: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ContractAdded {
        pub address: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ContractRemoved {
        pub address: ContractAddress,
    }

    /// @notice Initializes the emergency pause contract.
    /// @dev Sets admin and guardian roles for staged incident response.
    /// @param admin Address with admin privileges.
    /// @param guardian Address with guardian privileges.
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
        /// @notice Pauses the protocol and records a reason.
        /// @dev Guardian-only to minimize delay during incidents.
        /// @param reason Human-readable reason for the pause.
        fn pause_all(ref self: ContractState, reason: ByteArray) {
            self.access_control.assert_only_role(GUARDIAN_ROLE);
            assert!(!self.paused.read(), "System already paused");

            let now = get_block_timestamp();
            self.paused.write(true);
            self.pause_reason.write(reason.clone());
            self.paused_at.write(now);

            self.emit(Event::EmergencyPaused(EmergencyPaused { reason, paused_at: now }));
        }

        /// @notice Unpauses the protocol after an incident.
        /// @dev Admin-only to ensure controlled recovery.
        fn unpause_all(ref self: ContractState) {
            self.access_control.assert_only_role(DEFAULT_ADMIN_ROLE);
            assert!(self.paused.read(), "System not paused");

            let now = get_block_timestamp();
            let start_time = self.paused_at.read();
            let duration = now - start_time;

            self.paused.write(false);
            self.pause_duration.write(duration);

            self.emit(Event::EmergencyUnpaused(EmergencyUnpaused { unpaused_at: now, duration }));
        }

        /// @notice Returns whether the protocol is paused.
        /// @dev Read-only helper for UI and monitoring.
        /// @return paused True if the protocol is paused.
        fn is_paused(self: @ContractState) -> bool {
            self.paused.read()
        }

        /// @notice Adds a contract address to the pausable set.
        /// @dev Admin-only to prevent unauthorized scope changes.
        /// @param address Contract address to add.
        fn add_pausable_contract(ref self: ContractState, address: ContractAddress) {
            self.access_control.assert_only_role(DEFAULT_ADMIN_ROLE);
            self.contracts_to_pause.push(address);
            self.emit(Event::ContractAdded(ContractAdded { address }));
        }

        /// @notice Removes a contract address from the pausable set.
        /// @dev Admin-only to prevent unauthorized scope changes.
        /// @param address Contract address to remove.
        fn remove_pausable_contract(ref self: ContractState, address: ContractAddress) {
            self.access_control.assert_only_role(DEFAULT_ADMIN_ROLE);
            
            let mut found_index: Option<u64> = Option::None;
            let len = self.contracts_to_pause.len();
            
            let mut i: u64 = 0;
            loop {
                if i >= len {
                    break;
                }
                if self.contracts_to_pause.at(i).read() == address {
                    found_index = Option::Some(i);
                    break;
                }
                i += 1;
            };

            if let Option::Some(index) = found_index {
                let last_index = self.contracts_to_pause.len() - 1;
                let last_element = self.contracts_to_pause.at(last_index).read();
                self.contracts_to_pause.at(index).write(last_element);
                // FIXED: Changed double quotes to single quotes to pass a felt252 to .expect()
                self.contracts_to_pause.pop().expect('Vec should not be empty');
                self.emit(Event::ContractRemoved(ContractRemoved { address }));
            }
        }

        /// @notice Returns the current list of pausable contracts.
        /// @dev Read-only helper for tooling and audits.
        /// @return contracts Array of pausable contract addresses.
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
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.access_control.assert_only_role(DEFAULT_ADMIN_ROLE);
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        fn submit_private_emergency_action(
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
