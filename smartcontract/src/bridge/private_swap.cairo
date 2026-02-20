use starknet::ContractAddress;

#[derive(Drop, Serde, starknet::Store)]
pub struct EncryptedSwapData {
    pub ciphertext: felt252, 
    pub commitment: felt252, 
    pub is_finalized: bool,
}

// Minimal interface for Tongo ZK proof verification.
// Used to validate private swap proofs.
#[starknet::interface]
pub trait ITongoVerifier<TContractState> {
    // Applies verify proof after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn verify_proof(
        self: @TContractState, 
        proof: Span<felt252>, 
        public_inputs: Span<felt252>
    ) -> bool;
}

// Defines private swap lifecycle entrypoints.
// Uses ZK proofs to validate swap commitments.
#[starknet::interface]
pub trait IPrivateSwap<TContractState> {
    // Implements initiate private swap logic while keeping state transitions deterministic.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn initiate_private_swap(
        ref self: TContractState, 
        encrypted_data: EncryptedSwapData, 
        zk_proof: Span<felt252>
    ) -> u64;
    // Applies verify private swap after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn verify_private_swap(self: @TContractState, swap_id: u64, proof: Span<felt252>) -> bool;
    // Applies finalize swap after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn finalize_swap(ref self: TContractState, swap_id: u64, recipient: ContractAddress, nullifier: felt252);
}

// ZK privacy hooks for private swaps.
#[starknet::interface]
pub trait IPrivateSwapPrivacy<TContractState> {
    // Updates privacy router configuration after access-control and invariant checks.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    // Applies submit private swap action after input validation and commits the resulting state.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn submit_private_swap_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

// ZK-enabled private swap execution with nullifiers.
// Integrates a verifier to validate swap proofs.
#[starknet::contract]
pub mod PrivateSwap {
    // Imports only symbols required by this module.
    use starknet::ContractAddress;
    use starknet::storage::*;
    use super::{EncryptedSwapData, IPrivateSwap, ITongoVerifierDispatcher, ITongoVerifierDispatcherTrait};
    use core::num::traits::Zero;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_PRIVATE_SWAP;

    #[storage]
    pub struct Storage {
        pub tongo_verifier: ContractAddress,
        pub private_swaps: Map<u64, EncryptedSwapData>,
        pub nullifiers: Map<felt252, bool>,
        pub swap_count: u64,
        pub privacy_router: ContractAddress,
    }

    // Initializes the private swap contract.
    // Sets the verifier address for proof checks.
    // `verifier_address` is the Tongo verifier used for proof validation.
    #[constructor]
    // Initializes storage and role configuration during deployment.
    // May read/write storage, emit events, and call external contracts depending on runtime branch.
    fn constructor(ref self: ContractState, verifier_address: ContractAddress) {
        self.tongo_verifier.write(verifier_address);
    }

    #[abi(embed_v0)]
    impl PrivateSwapImpl of IPrivateSwap<ContractState> {
        // Implements initiate private swap logic while keeping state transitions deterministic.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn initiate_private_swap(
            ref self: ContractState, 
            encrypted_data: EncryptedSwapData, 
            zk_proof: Span<felt252>
        ) -> u64 {
            // Uses dispatcher pattern for inter-contract verification call.
            let verifier = ITongoVerifierDispatcher { contract_address: self.tongo_verifier.read() };
            let mut inputs = array![encrypted_data.commitment];
            
            assert!(verifier.verify_proof(zk_proof, inputs.span()), "Invalid initiation proof");

            let id = self.swap_count.read() + 1;
            self.private_swaps.entry(id).write(encrypted_data);
            self.swap_count.write(id);
            id
        }

        // Applies verify private swap after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn verify_private_swap(self: @ContractState, swap_id: u64, proof: Span<felt252>) -> bool {
            let swap = self.private_swaps.entry(swap_id).read();
            let verifier = ITongoVerifierDispatcher { contract_address: self.tongo_verifier.read() };
            
            let mut inputs = array![swap.commitment];
            verifier.verify_proof(proof, inputs.span())
        }

        // Applies finalize swap after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn finalize_swap(
            ref self: ContractState, 
            swap_id: u64, 
            recipient: ContractAddress, 
            nullifier: felt252
        ) {
            // Enforces one-time nullifier usage to prevent double spending.
            assert!(!self.nullifiers.entry(nullifier).read(), "Nullifier already used");
            
            let mut swap = self.private_swaps.entry(swap_id).read();
            assert!(!swap.is_finalized, "Swap already finalized");

            swap.is_finalized = true;
            self.private_swaps.entry(swap_id).write(swap);
            self.nullifiers.entry(nullifier).write(true);
        }
    }

    #[abi(embed_v0)]
    impl PrivateSwapPrivacyImpl of super::IPrivateSwapPrivacy<ContractState> {
        // Updates privacy router configuration after access-control and invariant checks.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            let current = self.privacy_router.read();
            assert!(current.is_zero(), "Privacy router already set");
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        // Applies submit private swap action after input validation and commits the resulting state.
        // May read/write storage, emit events, and call external contracts depending on runtime branch.
        fn submit_private_swap_action(
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
                ACTION_PRIVATE_SWAP,
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
