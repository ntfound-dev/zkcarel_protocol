use starknet::ContractAddress;

#[derive(Drop, Serde, Copy, starknet::Store)]
pub struct RunLog {
    pub log_hash: felt252,
    pub status: felt252,
    pub timestamp: u64,
}

// Agent registry interface for ERC-8004 identity binding + execution logs.
#[starknet::interface]
pub trait IAgentRegistry<TContractState> {
    // Updates operator wallet.
    fn set_operator(ref self: TContractState, operator: ContractAddress);
    // Updates ERC-8004 identity (agent id or registry-bound id).
    fn set_agent_identity(ref self: TContractState, agent_identity: felt252);
    // Updates manifest metadata (URI + hash).
    fn set_manifest(ref self: TContractState, manifest_uri: ByteArray, manifest_hash: felt252);
    // Submits a structured execution log reference.
    fn submit_run_log(
        ref self: TContractState,
        run_id: felt252,
        log_uri: ByteArray,
        log_hash: felt252,
        status: felt252
    );
    // Returns agent identity + operator + manifest metadata.
    fn get_agent(self: @TContractState) -> (felt252, ContractAddress, ByteArray, felt252);
    // Returns run log metadata.
    fn get_run_log(self: @TContractState, run_id: felt252) -> (ByteArray, RunLog);
}

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
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub agent_identity: felt252,
        pub operator: ContractAddress,
        pub manifest_uri: ByteArray,
        pub manifest_hash: felt252,
        pub run_log_uri: Map<felt252, ByteArray>,
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

    #[derive(Drop, starknet::Event)]
    pub struct OperatorUpdated {
        pub operator: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AgentIdentityUpdated {
        pub agent_identity: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ManifestUpdated {
        pub manifest_hash: felt252,
        pub manifest_uri: ByteArray,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RunLogSubmitted {
        pub run_id: felt252,
        pub log_hash: felt252,
        pub status: felt252,
    }

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

    fn assert_operator(self: @ContractState) {
        let operator = self.operator.read();
        assert!(!operator.is_zero(), "Operator not set");
        assert!(get_caller_address() == operator, "Not operator");
    }

    #[abi(embed_v0)]
    impl AgentRegistryImpl of IAgentRegistry<ContractState> {
        fn set_operator(ref self: ContractState, operator: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!operator.is_zero(), "Operator required");
            self.operator.write(operator);
            self.emit(Event::OperatorUpdated(OperatorUpdated { operator }));
        }

        fn set_agent_identity(ref self: ContractState, agent_identity: felt252) {
            self.ownable.assert_only_owner();
            assert!(agent_identity != 0, "Agent identity required");
            self.agent_identity.write(agent_identity);
            self.emit(Event::AgentIdentityUpdated(AgentIdentityUpdated { agent_identity }));
        }

        fn set_manifest(ref self: ContractState, manifest_uri: ByteArray, manifest_hash: felt252) {
            self.ownable.assert_only_owner();
            assert!(manifest_hash != 0, "Manifest hash required");
            self.manifest_uri.write(manifest_uri.clone());
            self.manifest_hash.write(manifest_hash);
            self.emit(Event::ManifestUpdated(ManifestUpdated { manifest_hash, manifest_uri }));
        }

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

        fn get_agent(self: @ContractState) -> (felt252, ContractAddress, ByteArray, felt252) {
            (
                self.agent_identity.read(),
                self.operator.read(),
                self.manifest_uri.read(),
                self.manifest_hash.read()
            )
        }

        fn get_run_log(self: @ContractState, run_id: felt252) -> (ByteArray, RunLog) {
            (self.run_log_uri.entry(run_id).read(), self.run_log_meta.entry(run_id).read())
        }
    }
}
