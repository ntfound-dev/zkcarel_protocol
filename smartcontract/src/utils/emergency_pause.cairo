use starknet::ContractAddress;

#[starknet::interface]
pub trait IEmergencyPause<TContractState> {
    fn pause_all(ref self: TContractState, reason: ByteArray);
    fn unpause_all(ref self: TContractState);
    fn is_paused(self: @TContractState) -> bool;
    fn add_pausable_contract(ref self: TContractState, address: ContractAddress);
    fn remove_pausable_contract(ref self: TContractState, address: ContractAddress);
    fn get_pausable_contracts(self: @TContractState) -> Array<ContractAddress>;
}

#[starknet::contract]
pub mod EmergencyPause {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::get_block_timestamp;
    
    use openzeppelin::access::accesscontrol::AccessControlComponent;
    use openzeppelin::introspection::src5::SRC5Component;

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
        fn pause_all(ref self: ContractState, reason: ByteArray) {
            self.access_control.assert_only_role(GUARDIAN_ROLE);
            assert!(!self.paused.read(), "System already paused");

            let now = get_block_timestamp();
            self.paused.write(true);
            self.pause_reason.write(reason.clone());
            self.paused_at.write(now);

            self.emit(Event::EmergencyPaused(EmergencyPaused { reason, paused_at: now }));
        }

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

        fn is_paused(self: @ContractState) -> bool {
            self.paused.read()
        }

        fn add_pausable_contract(ref self: ContractState, address: ContractAddress) {
            self.access_control.assert_only_role(DEFAULT_ADMIN_ROLE);
            self.contracts_to_pause.push(address);
            self.emit(Event::ContractAdded(ContractAdded { address }));
        }

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

        fn get_pausable_contracts(self: @ContractState) -> Array<ContractAddress> {
            let mut contracts = array![];
            for i in 0..self.contracts_to_pause.len() {
                contracts.append(self.contracts_to_pause.at(i).read());
            };
            contracts
        }
    }
}