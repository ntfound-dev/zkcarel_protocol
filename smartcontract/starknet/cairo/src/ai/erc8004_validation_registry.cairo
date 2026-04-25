use starknet::ContractAddress;

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct ValidationRecord {
    pub active: bool,
    pub proof_hash: felt252,
    pub expires_at: u64,
    pub updated_at: u64,
}

// ERC-8004 Validation Registry (Starknet adaptation).
// Stores validator attestations for agent identities.
#[starknet::interface]
pub trait IERC8004ValidationRegistry<TContractState> {
    // Enables or disables a validator.
    fn set_validator(ref self: TContractState, validator: ContractAddress, allowed: bool);
    // Submits or updates validation record for a given agent id.
    fn submit_validation(
        ref self: TContractState,
        agent_id: felt252,
        proof_uri: ByteArray,
        proof_hash: felt252,
        expires_at: u64
    );
    // Revokes validation for a given agent id.
    fn revoke_validation(ref self: TContractState, agent_id: felt252);
    // Revokes validation for a given agent id and validator (admin).
    fn revoke_validation_by_validator(
        ref self: TContractState,
        agent_id: felt252,
        validator: ContractAddress
    );
    // Returns validation record for a given agent id and validator.
    fn get_validation(
        self: @TContractState,
        agent_id: felt252,
        validator: ContractAddress
    ) -> (ValidationRecord, ByteArray);
    // Returns true if agent has any active validations.
    fn is_validated(self: @TContractState, agent_id: felt252) -> bool;
    // Returns active validator count for a given agent id.
    fn get_active_validation_count(self: @TContractState, agent_id: felt252) -> u64;
}

#[starknet::contract]
pub mod ERC8004ValidationRegistry {
    use super::{IERC8004ValidationRegistry, ValidationRecord};
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::{get_block_timestamp, get_caller_address};
    use openzeppelin::access::ownable::OwnableComponent;
    use core::num::traits::Zero;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub validators: Map<ContractAddress, bool>,
        pub validations: Map<(felt252, ContractAddress), ValidationRecord>,
        pub validation_uri: Map<(felt252, ContractAddress), ByteArray>,
        pub active_counts: Map<felt252, u64>,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        ValidatorUpdated: ValidatorUpdated,
        ValidationSubmitted: ValidationSubmitted,
        ValidationRevoked: ValidationRevoked,
        ValidationRevokedByAdmin: ValidationRevokedByAdmin,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ValidatorUpdated {
        pub validator: ContractAddress,
        pub allowed: bool,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ValidationSubmitted {
        pub agent_id: felt252,
        pub validator: ContractAddress,
        pub proof_hash: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ValidationRevoked {
        pub agent_id: felt252,
        pub validator: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ValidationRevokedByAdmin {
        pub agent_id: felt252,
        pub validator: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress) {
        self.ownable.initializer(admin);
    }

    fn assert_validator(self: @ContractState) -> ContractAddress {
        let caller = get_caller_address();
        let allowed = self.validators.entry(caller).read();
        assert!(allowed, "Validator not allowed");
        caller
    }

    #[abi(embed_v0)]
    impl ValidationRegistryImpl of IERC8004ValidationRegistry<ContractState> {
        fn set_validator(ref self: ContractState, validator: ContractAddress, allowed: bool) {
            self.ownable.assert_only_owner();
            assert!(!validator.is_zero(), "Validator required");
            self.validators.entry(validator).write(allowed);
            self.emit(Event::ValidatorUpdated(ValidatorUpdated { validator, allowed }));
        }

        fn submit_validation(
            ref self: ContractState,
            agent_id: felt252,
            proof_uri: ByteArray,
            proof_hash: felt252,
            expires_at: u64
        ) {
            assert!(agent_id != 0, "Agent id required");
            assert!(proof_hash != 0, "Proof hash required");
            let validator = assert_validator(@self);
            let now = get_block_timestamp();
            let key = (agent_id, validator);
            let mut record = self.validations.entry(key).read();
            let was_active = record.active;
            record.active = true;
            record.proof_hash = proof_hash;
            record.expires_at = expires_at;
            record.updated_at = now;
            self.validations.entry(key).write(record);
            self.validation_uri.entry(key).write(proof_uri);
            if !was_active {
                let count = self.active_counts.entry(agent_id).read();
                self.active_counts.entry(agent_id).write(count + 1);
            }
            self.emit(Event::ValidationSubmitted(ValidationSubmitted { agent_id, validator, proof_hash }));
        }

        fn revoke_validation(ref self: ContractState, agent_id: felt252) {
            assert!(agent_id != 0, "Agent id required");
            let caller = get_caller_address();
            let allowed = self.validators.entry(caller).read();
            if !allowed {
                self.ownable.assert_only_owner();
            }
            let key = (agent_id, caller);
            let mut record = self.validations.entry(key).read();
            if record.active {
                record.active = false;
                record.updated_at = get_block_timestamp();
                self.validations.entry(key).write(record);
                let count = self.active_counts.entry(agent_id).read();
                if count > 0 {
                    self.active_counts.entry(agent_id).write(count - 1);
                }
            }
            self.emit(Event::ValidationRevoked(ValidationRevoked { agent_id, validator: caller }));
        }

        fn revoke_validation_by_validator(
            ref self: ContractState,
            agent_id: felt252,
            validator: ContractAddress
        ) {
            self.ownable.assert_only_owner();
            assert!(agent_id != 0, "Agent id required");
            assert!(!validator.is_zero(), "Validator required");
            let key = (agent_id, validator);
            let mut record = self.validations.entry(key).read();
            if record.active {
                record.active = false;
                record.updated_at = get_block_timestamp();
                self.validations.entry(key).write(record);
                let count = self.active_counts.entry(agent_id).read();
                if count > 0 {
                    self.active_counts.entry(agent_id).write(count - 1);
                }
            }
            self.emit(Event::ValidationRevokedByAdmin(ValidationRevokedByAdmin { agent_id, validator }));
        }

        fn get_validation(
            self: @ContractState,
            agent_id: felt252,
            validator: ContractAddress
        ) -> (ValidationRecord, ByteArray) {
            let key = (agent_id, validator);
            (self.validations.entry(key).read(), self.validation_uri.entry(key).read())
        }

        fn is_validated(self: @ContractState, agent_id: felt252) -> bool {
            self.active_counts.entry(agent_id).read() > 0
        }

        fn get_active_validation_count(self: @ContractState, agent_id: felt252) -> u64 {
            self.active_counts.entry(agent_id).read()
        }
    }
}
