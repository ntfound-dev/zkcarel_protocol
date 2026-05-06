use starknet::ContractAddress;

/// @notice Stores a reference to an off-chain AI agent execution log.
#[derive(Drop, Serde, Copy, starknet::Store)]
pub struct RunLog {
    pub log_hash: felt252,
    pub status: felt252,
    pub timestamp: u64,
}

/// @title IAgentRegistry
/// @notice Per-agent on-chain registry for ERC-8004 identity binding and execution log anchoring.
/// @dev Designed as a single-agent contract: one deployment per AI agent instance.
///      The owner controls configuration; the operator submits run logs.
#[starknet::interface]
pub trait IAgentRegistry<TContractState> {
    /// @notice Updates the operator address allowed to submit run logs.
    /// @dev Callable only by the contract owner. Operator must be non-zero.
    ///      Emits `OperatorUpdated`.
    /// @param operator New operator address.
    fn set_operator(ref self: TContractState, operator: ContractAddress);

    /// @notice Updates the ERC-8004 identity binding for this agent.
    /// @dev Callable only by the contract owner. `agent_identity` must be non-zero.
    ///      Emits `AgentIdentityUpdated`.
    /// @param agent_identity ERC-8004 agent ID from the identity registry (or custom ID).
    fn set_agent_identity(ref self: TContractState, agent_identity: felt252);

    /// @notice Updates the agent's manifest URI and integrity hash.
    /// @dev Callable only by the contract owner. `manifest_hash` must be non-zero.
    ///      Emits `ManifestUpdated`.
    /// @param manifest_uri Off-chain URI pointing to the agent's manifest document.
    /// @param manifest_hash Integrity hash of the manifest document.
    fn set_manifest(ref self: TContractState, manifest_uri: ByteArray, manifest_hash: felt252);

    /// @notice Anchors an off-chain execution log reference on-chain.
    /// @dev Callable only by the registered operator. `run_id` and `log_hash` must be non-zero.
    ///      Emits `RunLogSubmitted`.
    /// @param run_id Unique identifier for this execution run (caller-assigned, non-zero).
    /// @param log_uri Off-chain URI pointing to the full execution log.
    /// @param log_hash Integrity hash of the log document (must be non-zero).
    /// @param status Execution status code (caller-defined felt252, e.g. `'SUCCESS'`, `'FAILED'`).
    fn submit_run_log(
        ref self: TContractState,
        run_id: felt252,
        log_uri: ByteArray,
        log_hash: felt252,
        status: felt252
    );

    /// @notice Returns the agent's identity, operator, manifest URI, and manifest hash.
    /// @return (agent_identity, operator, manifest_uri, manifest_hash).
    fn get_agent(self: @TContractState) -> (felt252, ContractAddress, ByteArray, felt252);

    /// @notice Returns the URI and metadata for a given run log.
    /// @param run_id The run identifier to query.
    /// @return (log_uri, RunLog). `log.log_hash == 0` if the run_id was never submitted.
    fn get_run_log(self: @TContractState, run_id: felt252) -> (ByteArray, RunLog);
}

/// @title AIAgentRegistry
/// @notice Implements IAgentRegistry with OZ OwnableComponent for safe ownership transfer.
#[starknet::contract]
pub mod AIAgentRegistry {
    use super::{IAgentRegistry, RunLog};
    use starknet::ContractAddress;
    use starknet::storage::*;
    use starknet::{get_block_timestamp, get_caller_address};
    use openzeppelin::access::ownable::OwnableComponent;
    use core::num::traits::Zero;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub agent_identity: felt252,
        pub operator: ContractAddress,
        pub manifest_uri: ByteArray,
        pub manifest_hash: felt252,
        /// @dev Key: run_id → off-chain log URI.
        pub run_log_uri: Map<felt252, ByteArray>,
        /// @dev Key: run_id → RunLog metadata struct.
        pub run_log_meta: Map<felt252, RunLog>,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        OperatorUpdated: OperatorUpdated,
        AgentIdentityUpdated: AgentIdentityUpdated,
        ManifestUpdated: ManifestUpdated,
        RunLogSubmitted: RunLogSubmitted,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    /// @notice Emitted when the operator address is updated.
    #[derive(Drop, starknet::Event)]
    pub struct OperatorUpdated {
        pub operator: ContractAddress,
    }

    /// @notice Emitted when the ERC-8004 identity binding is updated.
    #[derive(Drop, starknet::Event)]
    pub struct AgentIdentityUpdated {
        pub agent_identity: felt252,
    }

    /// @notice Emitted when the manifest URI or hash is updated.
    #[derive(Drop, starknet::Event)]
    pub struct ManifestUpdated {
        pub manifest_hash: felt252,
        pub manifest_uri: ByteArray,
    }

    /// @notice Emitted when a new run log is anchored on-chain.
    #[derive(Drop, starknet::Event)]
    pub struct RunLogSubmitted {
        pub run_id: felt252,
        pub log_hash: felt252,
        pub status: felt252,
    }

    /// @notice Initializes the registry with identity, operator, and manifest data.
    /// @param admin Initial owner address (receives OwnableTwoStep ownership).
    /// @param operator Address authorized to submit run logs.
    /// @param agent_identity ERC-8004 agent ID for this agent instance.
    /// @param manifest_uri Off-chain URI for the agent manifest.
    /// @param manifest_hash Integrity hash of the manifest document.
    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        operator: ContractAddress,
        agent_identity: felt252,
        manifest_uri: ByteArray,
        manifest_hash: felt252
    ) {
        self.ownable.initializer(admin);
        self.operator.write(operator);
        self.agent_identity.write(agent_identity);
        self.manifest_uri.write(manifest_uri.clone());
        self.manifest_hash.write(manifest_hash);
    }

    /// @notice Asserts the caller is the registered operator.
    /// @dev Panics with "Operator not set" if the operator slot is zero,
    ///      or "Not operator" if the caller does not match.
    fn assert_operator(self: @ContractState) {
        let operator = self.operator.read();
        assert!(!operator.is_zero(), "Operator not set");
        assert!(get_caller_address() == operator, "Not operator");
    }

    #[abi(embed_v0)]
    impl AgentRegistryImpl of IAgentRegistry<ContractState> {
        /// @inheritdoc IAgentRegistry
        fn set_operator(ref self: ContractState, operator: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!operator.is_zero(), "Operator required");
            self.operator.write(operator);
            self.emit(Event::OperatorUpdated(OperatorUpdated { operator }));
        }

        /// @inheritdoc IAgentRegistry
        fn set_agent_identity(ref self: ContractState, agent_identity: felt252) {
            self.ownable.assert_only_owner();
            assert!(agent_identity != 0, "Agent identity required");
            self.agent_identity.write(agent_identity);
            self.emit(Event::AgentIdentityUpdated(AgentIdentityUpdated { agent_identity }));
        }

        /// @inheritdoc IAgentRegistry
        fn set_manifest(ref self: ContractState, manifest_uri: ByteArray, manifest_hash: felt252) {
            self.ownable.assert_only_owner();
            assert!(manifest_hash != 0, "Manifest hash required");
            self.manifest_uri.write(manifest_uri.clone());
            self.manifest_hash.write(manifest_hash);
            self.emit(Event::ManifestUpdated(ManifestUpdated { manifest_hash, manifest_uri }));
        }

        /// @inheritdoc IAgentRegistry
        fn submit_run_log(
            ref self: ContractState,
            run_id: felt252,
            log_uri: ByteArray,
            log_hash: felt252,
            status: felt252
        ) {
            assert_operator(@self);
            assert!(run_id != 0, "Run id required");
            assert!(log_hash != 0, "Log hash required");
            let ts = get_block_timestamp();
            self.run_log_uri.entry(run_id).write(log_uri.clone());
            self.run_log_meta.entry(run_id).write(RunLog { log_hash, status, timestamp: ts });
            self.emit(Event::RunLogSubmitted(RunLogSubmitted { run_id, log_hash, status }));
        }

        /// @inheritdoc IAgentRegistry
        fn get_agent(self: @ContractState) -> (felt252, ContractAddress, ByteArray, felt252) {
            (
                self.agent_identity.read(),
                self.operator.read(),
                self.manifest_uri.read(),
                self.manifest_hash.read()
            )
        }

        /// @inheritdoc IAgentRegistry
        fn get_run_log(self: @ContractState, run_id: felt252) -> (ByteArray, RunLog) {
            (self.run_log_uri.entry(run_id).read(), self.run_log_meta.entry(run_id).read())
        }
    }
}
