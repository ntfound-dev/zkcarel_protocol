use starknet::ContractAddress;

// Minimal interface for ZK proof verification.
// Used by privacy router to validate proofs.
#[starknet::interface]
pub trait IProofVerifier<TContractState> {
    // Verifies the supplied proof payload before allowing private state transitions.
    fn verify_proof(
        self: @TContractState,
        proof: Span<felt252>,
        public_inputs: Span<felt252>
    ) -> bool;
}

// Defines privacy action submission and verifier control.
// Tracks nullifiers to prevent replay.
#[starknet::interface]
pub trait IZkPrivacyRouter<TContractState> {
    // Submits a private action, validates proof bindings, and consumes the submitted nullifier.
    fn submit_private_action(
        ref self: TContractState,
        nullifier: felt252,
        commitment: felt252,
        proof: Span<felt252>,
        public_inputs: Span<felt252>
    );
    // Read-only check for whether a nullifier has been consumed (double-spend protection).
    fn is_nullifier_used(self: @TContractState, nullifier: felt252) -> bool;
    // Owner/admin-only setter for rotating the verifier contract used by privacy flows.
    fn set_verifier(ref self: TContractState, verifier: ContractAddress);
}

// Routes privacy-preserving actions with ZK verification.
// Consumes nullifiers to prevent replay attacks.
#[starknet::contract]
pub mod ZkPrivacyRouter {
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::*;
    use openzeppelin::access::ownable::OwnableComponent;
    use super::{IProofVerifierDispatcher, IProofVerifierDispatcherTrait};
    use core::num::traits::Zero;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub verifier: ContractAddress,
        pub nullifiers: Map<felt252, bool>,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PrivateActionSubmitted: PrivateActionSubmitted,
        VerifierUpdated: VerifierUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PrivateActionSubmitted {
        pub user: ContractAddress,
        pub nullifier: felt252,
        pub commitment: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct VerifierUpdated {
        pub verifier: ContractAddress,
    }

    // Initializes the ZK privacy router.
    // Sets admin and verifier address.
    // `admin` receives ownership and `verifier` is used for proof validation.
    #[constructor]
    // Initializes owner/admin roles plus verifier/router dependencies required by privacy flows.
    fn constructor(ref self: ContractState, admin: ContractAddress, verifier: ContractAddress) {
        self.ownable.initializer(admin);
        self.verifier.write(verifier);
    }

    #[abi(embed_v0)]
    impl ZkPrivacyRouterImpl of super::IZkPrivacyRouter<ContractState> {
        // Submits a private action, validates proof bindings, and consumes the submitted nullifier.
            fn submit_private_action(
            ref self: ContractState,
            nullifier: felt252,
            commitment: felt252,
            proof: Span<felt252>,
            public_inputs: Span<felt252>
        ) {
            assert!(!self.nullifiers.entry(nullifier).read(), "Nullifier already used");
            assert!(public_inputs.len() >= 2, "public_inputs must include nullifier+commitment");
            assert!(
                *public_inputs.at(0_usize) == nullifier,
                "public_inputs[0] must equal nullifier"
            );
            assert!(
                *public_inputs.at(1_usize) == commitment,
                "public_inputs[1] must equal commitment"
            );
            let verifier = self.verifier.read();
            assert!(!verifier.is_zero(), "Verifier not set");

            let dispatcher = IProofVerifierDispatcher { contract_address: verifier };
            assert!(dispatcher.verify_proof(proof, public_inputs), "Invalid proof");

            self.nullifiers.entry(nullifier).write(true);
            self.emit(Event::PrivateActionSubmitted(PrivateActionSubmitted {
                user: get_caller_address(),
                nullifier,
                commitment
            }));
        }

        // Read-only check for whether a nullifier has been consumed (double-spend protection).
            fn is_nullifier_used(self: @ContractState, nullifier: felt252) -> bool {
            self.nullifiers.entry(nullifier).read()
        }

        // Owner/admin-only setter for rotating the verifier contract used by privacy flows.
            fn set_verifier(ref self: ContractState, verifier: ContractAddress) {
            self.ownable.assert_only_owner();
            self.verifier.write(verifier);
            self.emit(Event::VerifierUpdated(VerifierUpdated { verifier }));
        }
    }
}
