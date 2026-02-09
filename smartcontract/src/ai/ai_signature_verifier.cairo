use starknet::ContractAddress;

/// @title AI Signature Verifier Interface
/// @author CAREL Team
/// @notice Interface for AI action signature verification.
/// @dev Keep signature format aligned with AI executor.
#[starknet::interface]
pub trait IAISignatureVerifier<TContractState> {
    /// @notice Verifies a signature for a given message hash.
    /// @dev Returns true if the signature is valid.
    /// @param signer Expected signer address.
    /// @param message_hash Poseidon hash of the action payload.
    /// @param signature Signature data.
    /// @return valid True if valid.
    fn verify_signature(
        self: @TContractState,
        signer: ContractAddress,
        message_hash: felt252,
        signature: Span<felt252>
    ) -> bool;
    /// @notice Verifies and consumes a message hash to prevent replay.
    /// @dev Returns true if the signature is valid and unused, then marks it used.
    /// @param signer Expected signer address.
    /// @param message_hash Poseidon hash of the action payload.
    /// @param signature Signature data.
    /// @return valid True if valid and consumed.
    fn verify_and_consume(
        ref self: TContractState,
        signer: ContractAddress,
        message_hash: felt252,
        signature: Span<felt252>
    ) -> bool;
}

/// @title AI Signature Verifier Admin Interface
/// @author CAREL Team
/// @notice Admin controls for allowlist-based verifier.
/// @dev Owner-only configuration for tests and staging.
#[starknet::interface]
pub trait IAISignatureVerifierAdmin<TContractState> {
    /// @notice Marks a message hash as valid/invalid for a signer.
    /// @dev Owner-only to prevent spoofing.
    /// @param signer Signer address.
    /// @param message_hash Poseidon hash of the action payload.
    /// @param valid Flag to set validity.
    fn set_valid_hash(ref self: TContractState, signer: ContractAddress, message_hash: felt252, valid: bool);
}

/// @title AI Signature Verifier Privacy Interface
/// @author CAREL Team
/// @notice ZK privacy hooks for AI signature verification.
#[starknet::interface]
pub trait IAISignatureVerifierPrivacy<TContractState> {
    /// @notice Sets privacy router address.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    /// @notice Submits a private AI signature action proof.
    fn submit_private_ai_signature_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

/// @title AI Signature Verifier
/// @author CAREL Team
/// @notice Simple allowlist-based signature verifier for AI actions.
/// @dev Replace with proper ECDSA/account verification for production.
#[starknet::contract]
pub mod AISignatureVerifier {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use openzeppelin::access::ownable::OwnableComponent;
    use core::num::traits::Zero;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_AI;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub valid_hashes: Map<(ContractAddress, felt252), bool>,
        pub used_hashes: Map<(ContractAddress, felt252), bool>,
        pub privacy_router: ContractAddress,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        HashUpdated: HashUpdated,
        HashConsumed: HashConsumed,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct HashUpdated {
        pub signer: ContractAddress,
        pub message_hash: felt252,
        pub valid: bool,
    }

    #[derive(Drop, starknet::Event)]
    pub struct HashConsumed {
        pub signer: ContractAddress,
        pub message_hash: felt252,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress) {
        self.ownable.initializer(admin);
    }

    #[abi(embed_v0)]
    impl VerifierImpl of super::IAISignatureVerifier<ContractState> {
        fn verify_signature(
            self: @ContractState,
            signer: ContractAddress,
            message_hash: felt252,
            signature: Span<felt252>
        ) -> bool {
            let _ = signature;
            let key = (signer, message_hash);
            if !self.valid_hashes.entry(key).read() {
                return false;
            }
            !self.used_hashes.entry(key).read()
        }

        fn verify_and_consume(
            ref self: ContractState,
            signer: ContractAddress,
            message_hash: felt252,
            signature: Span<felt252>
        ) -> bool {
            let _ = signature;
            let key = (signer, message_hash);
            if !self.valid_hashes.entry(key).read() {
                return false;
            }
            if self.used_hashes.entry(key).read() {
                return false;
            }
            self.used_hashes.entry(key).write(true);
            self.emit(Event::HashConsumed(HashConsumed { signer, message_hash }));
            true
        }
    }

    #[abi(embed_v0)]
    impl AdminImpl of super::IAISignatureVerifierAdmin<ContractState> {
        fn set_valid_hash(ref self: ContractState, signer: ContractAddress, message_hash: felt252, valid: bool) {
            self.ownable.assert_only_owner();
            self.valid_hashes.entry((signer, message_hash)).write(valid);
            self.emit(Event::HashUpdated(HashUpdated { signer, message_hash, valid }));
        }
    }

    #[abi(embed_v0)]
    impl AISignatureVerifierPrivacyImpl of super::IAISignatureVerifierPrivacy<ContractState> {
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        fn submit_private_ai_signature_action(
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
                ACTION_AI,
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
