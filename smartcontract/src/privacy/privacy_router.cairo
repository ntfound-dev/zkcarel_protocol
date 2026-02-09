use starknet::ContractAddress;

/// @title Privacy Router Interface
/// @author CAREL Team
/// @notice Routes ZK proofs to verifiers and applies shielded transitions.
#[starknet::interface]
pub trait IPrivacyRouter<TContractState> {
    /// @notice Submits a privacy action with proof.
    /// @dev Verifies proof then updates ShieldedVault.
    /// @param action_type Action identifier.
    /// @param old_root Root before transition.
    /// @param new_root Root after transition.
    /// @param nullifiers Nullifiers to consume.
    /// @param commitments New commitments to add.
    /// @param public_inputs Public inputs for verifier.
    /// @param proof ZK proof.
    fn submit_action(
        ref self: TContractState,
        action_type: felt252,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

/// @title Privacy Router Admin Interface
/// @author CAREL Team
/// @notice Owner-only configuration for router dependencies.
#[starknet::interface]
pub trait IPrivacyRouterAdmin<TContractState> {
    /// @notice Sets the shielded vault address.
    fn set_vault(ref self: TContractState, vault: ContractAddress);
    /// @notice Sets the verifier registry address.
    fn set_registry(ref self: TContractState, registry: ContractAddress);
    /// @notice Pauses router submissions.
    fn pause(ref self: TContractState);
    /// @notice Unpauses router submissions.
    fn unpause(ref self: TContractState);
}

/// @title Privacy Router Contract
/// @author CAREL Team
/// @notice Central entrypoint for ZK privacy actions.
#[starknet::contract]
pub mod PrivacyRouter {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use core::num::traits::Zero;
    use openzeppelin::access::ownable::OwnableComponent;
    use crate::privacy::zk_privacy_router::{IProofVerifierDispatcher, IProofVerifierDispatcherTrait};
    use crate::privacy::shielded_vault::{IShieldedVaultDispatcher, IShieldedVaultDispatcherTrait};
    use crate::privacy::verifier_registry::{IVerifierRegistryDispatcher, IVerifierRegistryDispatcherTrait};

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub vault: ContractAddress,
        pub registry: ContractAddress,
        pub paused: bool,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        ActionSubmitted: ActionSubmitted,
        VaultUpdated: VaultUpdated,
        RegistryUpdated: RegistryUpdated,
        Paused: Paused,
        Unpaused: Unpaused,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ActionSubmitted {
        pub action_type: felt252,
        pub old_root: felt252,
        pub new_root: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct VaultUpdated {
        pub vault: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RegistryUpdated {
        pub registry: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Paused {}

    #[derive(Drop, starknet::Event)]
    pub struct Unpaused {}

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress, vault: ContractAddress, registry: ContractAddress) {
        self.ownable.initializer(owner);
        self.vault.write(vault);
        self.registry.write(registry);
        self.paused.write(false);
    }

    #[abi(embed_v0)]
    impl PrivacyRouterImpl of super::IPrivacyRouter<ContractState> {
        fn submit_action(
            ref self: ContractState,
            action_type: felt252,
            old_root: felt252,
            new_root: felt252,
            nullifiers: Span<felt252>,
            commitments: Span<felt252>,
            public_inputs: Span<felt252>,
            proof: Span<felt252>
        ) {
            assert!(!self.paused.read(), "Router paused");

            let registry = self.registry.read();
            assert!(!registry.is_zero(), "Registry not set");
            let registry_dispatcher = IVerifierRegistryDispatcher { contract_address: registry };
            let verifier = registry_dispatcher.get_verifier(action_type);
            assert!(!verifier.is_zero(), "Verifier not set");

            let verifier_dispatcher = IProofVerifierDispatcher { contract_address: verifier };
            let ok = verifier_dispatcher.verify_proof(proof, public_inputs);
            assert!(ok, "Invalid proof");

            let vault = self.vault.read();
            assert!(!vault.is_zero(), "Vault not set");
            let vault_dispatcher = IShieldedVaultDispatcher { contract_address: vault };
            vault_dispatcher.submit_transition(old_root, new_root, nullifiers, commitments);

            self.emit(Event::ActionSubmitted(ActionSubmitted { action_type, old_root, new_root }));
        }
    }

    #[abi(embed_v0)]
    impl PrivacyRouterAdminImpl of super::IPrivacyRouterAdmin<ContractState> {
        fn set_vault(ref self: ContractState, vault: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!vault.is_zero(), "Vault required");
            self.vault.write(vault);
            self.emit(Event::VaultUpdated(VaultUpdated { vault }));
        }

        fn set_registry(ref self: ContractState, registry: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!registry.is_zero(), "Registry required");
            self.registry.write(registry);
            self.emit(Event::RegistryUpdated(RegistryUpdated { registry }));
        }

        fn pause(ref self: ContractState) {
            self.ownable.assert_only_owner();
            self.paused.write(true);
            self.emit(Event::Paused(Paused {}));
        }

        fn unpause(ref self: ContractState) {
            self.ownable.assert_only_owner();
            self.paused.write(false);
            self.emit(Event::Unpaused(Unpaused {}));
        }
    }
}
