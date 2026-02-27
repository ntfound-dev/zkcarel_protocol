use starknet::ContractAddress;

// Interface for AI action signature verification.
// Keep signature format aligned with AI executor.
#[starknet::interface]
pub trait IAISignatureVerifier<TContractState> {
    // Applies verify signature after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn verify_signature(
        self: @TContractState,
        signer: ContractAddress,
        message_hash: felt252,
        signature: Span<felt252>
    ) -> bool;
    // Applies verify and consume after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn verify_and_consume(
        ref self: TContractState,
        signer: ContractAddress,
        message_hash: felt252,
        signature: Span<felt252>
    ) -> bool;
}

// ZK privacy hooks for AI signature verification.
#[starknet::interface]
pub trait IAISignatureVerifierPrivacy<TContractState> {
    // Updates privacy router configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    // Applies submit private ai signature action after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
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

// Minimal Starknet account signature interface (SRC-6 compatible).
#[starknet::interface]
pub trait ISignatureAccount<TContractState> {
    // Returns `'VALID'` when signature is valid for the given hash.
    fn is_valid_signature(
        self: @TContractState,
        message_hash: felt252,
        signature: Span<felt252>
    ) -> felt252;
}

// Production-oriented account-based signature verifier for AI actions.
#[starknet::contract]
pub mod AISignatureVerifier {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use openzeppelin::access::ownable::OwnableComponent;
    use core::num::traits::Zero;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_AI;
    use super::{ISignatureAccountDispatcher, ISignatureAccountDispatcherTrait};

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub used_hashes: Map<(ContractAddress, felt252), bool>,
        pub privacy_router: ContractAddress,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        HashConsumed: HashConsumed,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    pub struct HashConsumed {
        pub signer: ContractAddress,
        pub message_hash: felt252,
    }

    #[constructor]
    // Initializes storage and role configuration during deployment.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn constructor(ref self: ContractState, admin: ContractAddress) {
        self.ownable.initializer(admin);
    }

    #[abi(embed_v0)]
    impl VerifierImpl of super::IAISignatureVerifier<ContractState> {
        // Applies verify signature after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn verify_signature(
            self: @ContractState,
            signer: ContractAddress,
            message_hash: felt252,
            signature: Span<felt252>
        ) -> bool {
            if signer.is_zero() || message_hash == 0 || signature.len() == 0 {
                return false;
            }
            let account = ISignatureAccountDispatcher { contract_address: signer };
            account.is_valid_signature(message_hash, signature) == 'VALID'
        }

        // Applies verify and consume after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn verify_and_consume(
            ref self: ContractState,
            signer: ContractAddress,
            message_hash: felt252,
            signature: Span<felt252>
        ) -> bool {
            let key = (signer, message_hash);
            if self.used_hashes.entry(key).read() {
                return false;
            }
            if !self.verify_signature(signer, message_hash, signature) {
                return false;
            }
            self.used_hashes.entry(key).write(true);
            self.emit(Event::HashConsumed(HashConsumed { signer, message_hash }));
            true
        }
    }

    #[abi(embed_v0)]
    impl AISignatureVerifierPrivacyImpl of super::IAISignatureVerifierPrivacy<ContractState> {
        // Updates privacy router configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        // Applies submit private ai signature action after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
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
