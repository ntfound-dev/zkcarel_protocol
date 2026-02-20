use starknet::ContractAddress;

// Proves attributes without revealing identity.
// Uses external verifier for proof validation.
#[starknet::interface]
pub trait IAnonymousCredentials<TContractState> {
    // Verifies an anonymous-credential proof and marks its nullifier as consumed.
    fn submit_credential_proof(
        ref self: TContractState,
        nullifier: felt252,
        proof: Span<felt252>,
        public_inputs: Span<felt252>
    );
    // Read-only check for whether a nullifier has been consumed (double-spend protection).
    fn is_nullifier_used(self: @TContractState, nullifier: felt252) -> bool;
    // Owner/admin-only setter for rotating the verifier contract used by privacy flows.
    fn set_verifier(ref self: TContractState, verifier: ContractAddress);
}

// ZK privacy hooks for credential proofs.
#[starknet::interface]
pub trait IAnonymousCredentialsPrivacy<TContractState> {
    // Owner/admin-only setter for wiring the PrivacyRouter dependency.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    // Forwards credential privacy actions to the router with nullifier/commitment arrays.
    fn submit_private_credentials_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

// Verifies anonymous credentials using ZK proofs.
// Integrates an external verifier contract.
#[starknet::contract]
pub mod AnonymousCredentials {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use openzeppelin::access::ownable::OwnableComponent;
    use core::num::traits::Zero;
    use super::super::zk_privacy_router::{IProofVerifierDispatcher, IProofVerifierDispatcherTrait};
    use super::super::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use super::super::action_types::ACTION_ANON_CREDENTIALS;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub verifier: ContractAddress,
        pub nullifiers: Map<felt252, bool>,
        pub privacy_router: ContractAddress,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        CredentialVerified: CredentialVerified,
        VerifierUpdated: VerifierUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct CredentialVerified {
        pub nullifier: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct VerifierUpdated {
        pub verifier: ContractAddress,
    }

    #[constructor]
    // Initializes owner/admin roles plus verifier/router dependencies required by privacy flows.
    fn constructor(ref self: ContractState, admin: ContractAddress, verifier: ContractAddress) {
        self.ownable.initializer(admin);
        self.verifier.write(verifier);
    }

    #[abi(embed_v0)]
    impl AnonymousCredentialsImpl of super::IAnonymousCredentials<ContractState> {
        // Verifies an anonymous-credential proof and marks its nullifier as consumed.
            fn submit_credential_proof(
            ref self: ContractState,
            nullifier: felt252,
            proof: Span<felt252>,
            public_inputs: Span<felt252>
        ) {
            assert!(!self.nullifiers.entry(nullifier).read(), "Nullifier already used");
            let verifier = self.verifier.read();
            let dispatcher = IProofVerifierDispatcher { contract_address: verifier };
            assert!(dispatcher.verify_proof(proof, public_inputs), "Invalid proof");
            self.nullifiers.entry(nullifier).write(true);
            self.emit(Event::CredentialVerified(CredentialVerified { nullifier }));
        }

        // Read-only check for whether a nullifier has been consumed (double-spend protection).
            fn is_nullifier_used(self: @ContractState, nullifier: felt252) -> bool {
            self.nullifiers.entry(nullifier).read()
        }

        // Owner/admin-only setter for rotating the verifier contract used by privacy flows.
            fn set_verifier(ref self: ContractState, verifier: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!verifier.is_zero(), "Verifier required");
            self.verifier.write(verifier);
            self.emit(Event::VerifierUpdated(VerifierUpdated { verifier }));
        }
    }

    #[abi(embed_v0)]
    impl AnonymousCredentialsPrivacyImpl of super::IAnonymousCredentialsPrivacy<ContractState> {
        // Owner/admin-only setter for wiring the PrivacyRouter dependency.
            fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        // Forwards credential privacy actions to the router with nullifier/commitment arrays.
            fn submit_private_credentials_action(
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
                ACTION_ANON_CREDENTIALS,
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
