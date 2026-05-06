use starknet::ContractAddress;

/// @notice Stores one validator's attestation record for a given agent.
#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct ValidationRecord {
    pub active: bool,
    pub proof_hash: felt252,
    pub expires_at: u64,
    pub updated_at: u64,
}

/// @title IERC8004ValidationRegistry
/// @notice ERC-8004 Validation Registry (Starknet adaptation).
/// @dev Stores validator attestations for agent identities. Validators are managed via
///      AccessControlComponent with VALIDATOR_ROLE, replacing the legacy boolean allowlist map.
#[starknet::interface]
pub trait IERC8004ValidationRegistry<TContractState> {
    /// @notice Grants or revokes VALIDATOR_ROLE for a given address.
    /// @dev Callable only by the contract owner. Emits `ValidatorUpdated`.
    ///      Internally calls `_grant_role` / `_revoke_role` on AccessControlComponent.
    /// @param validator The address to update.
    /// @param allowed true to grant VALIDATOR_ROLE, false to revoke it.
    fn set_validator(ref self: TContractState, validator: ContractAddress, allowed: bool);

    /// @notice Submits or updates a validation record for an agent.
    /// @dev Callable only by addresses holding VALIDATOR_ROLE.
    ///      `expires_at` must be strictly in the future (M-7 fix — rejects backdated submissions).
    ///      If the validator had no previous active record for this agent, increments `active_counts`.
    ///      Emits `ValidationSubmitted`.
    /// @param agent_id The ERC-8004 agent to validate.
    /// @param proof_uri Off-chain URI pointing to the validation proof document.
    /// @param proof_hash Integrity hash of the proof document (must be non-zero).
    /// @param expires_at Unix timestamp after which this validation is considered stale (must be > now).
    fn submit_validation(
        ref self: TContractState,
        agent_id: felt252,
        proof_uri: ByteArray,
        proof_hash: felt252,
        expires_at: u64
    );

    /// @notice Revokes the caller's own validation record for an agent.
    /// @dev Callable by an address holding VALIDATOR_ROLE, or by the contract owner.
    ///      Decrements `active_counts` if the record was active. Emits `ValidationRevoked`.
    /// @param agent_id The agent whose validation is being revoked.
    fn revoke_validation(ref self: TContractState, agent_id: felt252);

    /// @notice Revokes the validation record of any validator for an agent (admin only).
    /// @dev Callable only by the contract owner. Emits `ValidationRevokedByAdmin`.
    /// @param agent_id The agent whose validation is being revoked.
    /// @param validator The validator whose record is being removed.
    fn revoke_validation_by_validator(
        ref self: TContractState,
        agent_id: felt252,
        validator: ContractAddress
    );

    /// @notice Returns the validation record and proof URI for a specific (agent, validator) pair.
    /// @param agent_id The agent to query.
    /// @param validator The validator to query.
    /// @return (ValidationRecord, proof_uri). `record.active == false` if not found.
    fn get_validation(
        self: @TContractState,
        agent_id: felt252,
        validator: ContractAddress
    ) -> (ValidationRecord, ByteArray);

    /// @notice Returns whether an agent has at least one active validation record.
    /// @dev Based on `active_counts`. Note: counts are decremented on explicit revocation but NOT
    ///      on expiry (no on-chain cron). Callers requiring strict expiry enforcement must call
    ///      `get_validation` and compare `expires_at` against `block_timestamp` directly.
    /// @param agent_id The agent to query.
    /// @return true if `active_counts[agent_id] > 0`.
    fn is_validated(self: @TContractState, agent_id: felt252) -> bool;

    /// @notice Returns the count of active (non-revoked) validation records for an agent.
    /// @dev Subject to the same expiry caveat as `is_validated`.
    /// @param agent_id The agent to query.
    /// @return Number of active validation records.
    fn get_active_validation_count(self: @TContractState, agent_id: felt252) -> u64;
}

/// @title ERC8004ValidationRegistry
/// @notice Implements IERC8004ValidationRegistry with OZ OwnableTwoStepComponent
///         and AccessControlComponent (VALIDATOR_ROLE).
#[starknet::contract]
pub mod ERC8004ValidationRegistry {
    use super::{IERC8004ValidationRegistry, ValidationRecord};
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::{get_block_timestamp, get_caller_address};
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::access::accesscontrol::{AccessControlComponent, DEFAULT_ADMIN_ROLE};
    use openzeppelin::introspection::src5::SRC5Component;
    use core::num::traits::Zero;

    /// @dev Keccak selector for the string "VALIDATOR_ROLE".
    const VALIDATOR_ROLE: felt252 = selector!("VALIDATOR_ROLE");

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    component!(path: AccessControlComponent, storage: access_control, event: AccessControlEvent);
    component!(path: SRC5Component, storage: src5, event: SRC5Event);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;
    #[abi(embed_v0)]
    impl AccessControlImpl = AccessControlComponent::AccessControlImpl<ContractState>;
    impl AccessControlInternalImpl = AccessControlComponent::InternalImpl<ContractState>;
    #[abi(embed_v0)]
    impl SRC5Impl = SRC5Component::SRC5Impl<ContractState>;

    #[storage]
    pub struct Storage {
        /// @dev Key: (agent_id, validator) → ValidationRecord.
        pub validations: Map<(felt252, ContractAddress), ValidationRecord>,
        /// @dev Key: (agent_id, validator) → off-chain proof URI.
        pub validation_uri: Map<(felt252, ContractAddress), ByteArray>,
        /// @dev Key: agent_id → count of non-revoked validation records.
        pub active_counts: Map<felt252, u64>,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
        #[substorage(v0)]
        pub access_control: AccessControlComponent::Storage,
        #[substorage(v0)]
        pub src5: SRC5Component::Storage,
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
        #[flat]
        AccessControlEvent: AccessControlComponent::Event,
        #[flat]
        SRC5Event: SRC5Component::Event,
    }

    /// @notice Emitted when a validator's role is granted or revoked.
    #[derive(Drop, starknet::Event)]
    pub struct ValidatorUpdated {
        pub validator: ContractAddress,
        pub allowed: bool,
    }

    /// @notice Emitted when a validator submits or updates a validation record.
    #[derive(Drop, starknet::Event)]
    pub struct ValidationSubmitted {
        pub agent_id: felt252,
        pub validator: ContractAddress,
        pub proof_hash: felt252,
    }

    /// @notice Emitted when a validator self-revokes their record for an agent.
    #[derive(Drop, starknet::Event)]
    pub struct ValidationRevoked {
        pub agent_id: felt252,
        pub validator: ContractAddress,
    }

    /// @notice Emitted when the owner revokes a validator's record on their behalf.
    #[derive(Drop, starknet::Event)]
    pub struct ValidationRevokedByAdmin {
        pub agent_id: felt252,
        pub validator: ContractAddress,
    }

    /// @notice Initializes the registry and grants `DEFAULT_ADMIN_ROLE` to the admin address.
    /// @param admin Initial owner and access control admin address.
    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress) {
        self.ownable.initializer(admin);
        self.access_control.initializer();
        self.access_control._grant_role(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Asserts the caller holds VALIDATOR_ROLE and returns their address.
    /// @dev Panics with "Validator not allowed" if the caller does not have the role.
    /// @return The caller's address.
    fn assert_validator(self: @ContractState) -> ContractAddress {
        let caller = get_caller_address();
        assert!(self.access_control.has_role(VALIDATOR_ROLE, caller), "Validator not allowed");
        caller
    }

    #[abi(embed_v0)]
    impl ValidationRegistryImpl of IERC8004ValidationRegistry<ContractState> {
        /// @inheritdoc IERC8004ValidationRegistry
        fn set_validator(ref self: ContractState, validator: ContractAddress, allowed: bool) {
            self.ownable.assert_only_owner();
            assert!(!validator.is_zero(), "Validator required");
            if allowed {
                self.access_control._grant_role(VALIDATOR_ROLE, validator);
            } else {
                self.access_control._revoke_role(VALIDATOR_ROLE, validator);
            }
            self.emit(Event::ValidatorUpdated(ValidatorUpdated { validator, allowed }));
        }

        /// @inheritdoc IERC8004ValidationRegistry
        fn submit_validation(
            ref self: ContractState,
            agent_id: felt252,
            proof_uri: ByteArray,
            proof_hash: felt252,
            expires_at: u64
        ) {
            assert!(agent_id != 0, "Agent id required");
            assert!(proof_hash != 0, "Proof hash required");
            let now = get_block_timestamp();
            assert!(expires_at > now, "Expires in the past");
            let validator = assert_validator(@self);
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

        /// @inheritdoc IERC8004ValidationRegistry
        fn revoke_validation(ref self: ContractState, agent_id: felt252) {
            assert!(agent_id != 0, "Agent id required");
            let caller = get_caller_address();
            let is_validator = self.access_control.has_role(VALIDATOR_ROLE, caller);
            if !is_validator {
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

        /// @inheritdoc IERC8004ValidationRegistry
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

        /// @inheritdoc IERC8004ValidationRegistry
        fn get_validation(
            self: @ContractState,
            agent_id: felt252,
            validator: ContractAddress
        ) -> (ValidationRecord, ByteArray) {
            let key = (agent_id, validator);
            (self.validations.entry(key).read(), self.validation_uri.entry(key).read())
        }

        /// @inheritdoc IERC8004ValidationRegistry
        fn is_validated(self: @ContractState, agent_id: felt252) -> bool {
            self.active_counts.entry(agent_id).read() > 0
        }

        /// @inheritdoc IERC8004ValidationRegistry
        fn get_active_validation_count(self: @ContractState, agent_id: felt252) -> u64 {
            self.active_counts.entry(agent_id).read()
        }
    }
}
