use starknet::ContractAddress;

// Defines protocol-wide pause controls for incident response.
// Exposes minimal pause controls to reduce operational risk.
#[starknet::interface]
pub trait IEmergencyPause<TContractState> {
    // Pauses all registered pausable contracts.
    fn pause_all(ref self: TContractState, reason: ByteArray);
    // Unpauses all registered pausable contracts.
    fn unpause_all(ref self: TContractState);
    // Returns whether the contract is currently paused.
    fn is_paused(self: @TContractState) -> bool;
    // Registers a contract address to be managed by emergency pause flow (admin only).
    fn add_pausable_contract(ref self: TContractState, address: ContractAddress);
    // Removes a contract address from emergency pause target list (admin only).
    fn remove_pausable_contract(ref self: TContractState, address: ContractAddress);
    // Returns full list of registered pausable contracts.
    fn get_pausable_contracts(self: @TContractState) -> Array<ContractAddress>;
}

// Hide Mode hooks for emergency-control actions.
#[starknet::interface]
pub trait IEmergencyPausePrivacy<TContractState> {
    // Sets privacy router used for Hide Mode actions.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    // Forwards private emergency payload to privacy router.
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

// Centralized pause coordinator for protocol incident response.
// Uses guardian/admin role split for staged emergency handling.
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

    // Initializes access roles and default unpaused state.
    // admin/guardian: operational roles for unpause and pause workflows.
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
        // Pauses all registered pausable contracts.
        fn pause_all(ref self: ContractState, reason: ByteArray) {
            self.access_control.assert_only_role(GUARDIAN_ROLE);
            assert!(!self.paused.read(), "System already paused");

            let now = get_block_timestamp();
            self.paused.write(true);
            self.pause_reason.write(reason.clone());
            self.paused_at.write(now);

            self.emit(Event::EmergencyPaused(EmergencyPaused { reason, paused_at: now }));
        }

        // Unpauses all registered pausable contracts.
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

        // Returns whether the contract is currently paused.
        fn is_paused(self: @ContractState) -> bool {
            self.paused.read()
        }

        // Registers a pausable contract target managed by emergency controls.
        fn add_pausable_contract(ref self: ContractState, address: ContractAddress) {
            self.access_control.assert_only_role(DEFAULT_ADMIN_ROLE);
            self.contracts_to_pause.push(address);
            self.emit(Event::ContractAdded(ContractAdded { address }));
        }

        // Removes a pausable contract target from emergency controls if present.
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
                // Keep felt252 literal in `expect` message for Cairo type compatibility.
                self.contracts_to_pause.pop().expect('Vec should not be empty');
                self.emit(Event::ContractRemoved(ContractRemoved { address }));
            }
        }

        // Returns full list of registered pausable contracts.
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
        // Sets privacy router used for Hide Mode emergency actions.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.access_control.assert_only_role(DEFAULT_ADMIN_ROLE);
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        // Relays private emergency payload for proof verification and execution.
        // `nullifiers` prevent replay and `commitments` bind intended emergency action.
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
