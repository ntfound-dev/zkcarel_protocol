use starknet::ContractAddress;

#[derive(Drop, Serde, starknet::Store)]
pub struct EncryptedSwapData {
    pub ciphertext: felt252, 
    pub commitment: felt252, 
    pub is_finalized: bool,
}

/// @title Tongo Verifier Interface
/// @author CAREL Team
/// @notice Minimal interface for Tongo ZK proof verification.
/// @dev Used to validate private swap proofs.
#[starknet::interface]
pub trait ITongoVerifier<TContractState> {
    /// @notice Verifies a zero-knowledge proof.
    /// @dev Returns true if proof and public inputs are valid.
    /// @param proof Proof data.
    /// @param public_inputs Public inputs for verification.
    /// @return valid True if the proof is valid.
    fn verify_proof(
        self: @TContractState, 
        proof: Span<felt252>, 
        public_inputs: Span<felt252>
    ) -> bool;
}

/// @title Private Swap Interface
/// @author CAREL Team
/// @notice Defines private swap lifecycle entrypoints.
/// @dev Uses ZK proofs to validate swap commitments.
#[starknet::interface]
pub trait IPrivateSwap<TContractState> {
    /// @notice Initiates a private swap with encrypted data.
    /// @dev Verifies initiation proof before storing commitment.
    /// @param encrypted_data Encrypted swap payload.
    /// @param zk_proof Zero-knowledge proof for initiation.
    /// @return swap_id Newly created swap id.
    fn initiate_private_swap(
        ref self: TContractState, 
        encrypted_data: EncryptedSwapData, 
        zk_proof: Span<felt252>
    ) -> u64;
    /// @notice Verifies a swap proof against stored commitment.
    /// @dev Read-only helper for clients.
    /// @param swap_id Swap identifier.
    /// @param proof Zero-knowledge proof.
    /// @return valid True if proof is valid.
    fn verify_private_swap(self: @TContractState, swap_id: u64, proof: Span<felt252>) -> bool;
    /// @notice Finalizes a private swap.
    /// @dev Uses nullifier to prevent double spending.
    /// @param swap_id Swap identifier.
    /// @param recipient Swap recipient address.
    /// @param nullifier Nullifier value for replay protection.
    fn finalize_swap(ref self: TContractState, swap_id: u64, recipient: ContractAddress, nullifier: felt252);
}

/// @title Private Swap Privacy Interface
/// @author CAREL Team
/// @notice ZK privacy hooks for private swaps.
#[starknet::interface]
pub trait IPrivateSwapPrivacy<TContractState> {
    /// @notice Sets privacy router address.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    /// @notice Submits a private swap action proof.
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

/// @title Private Swap Contract
/// @author CAREL Team
/// @notice ZK-enabled private swap execution with nullifiers.
/// @dev Integrates a verifier to validate swap proofs.
#[starknet::contract]
pub mod PrivateSwap {
    // HANYA mengimpor yang benar-benar digunakan
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

    /// @notice Initializes the private swap contract.
    /// @dev Sets the verifier address for proof checks.
    /// @param verifier_address Tongo verifier contract address.
    #[constructor]
    fn constructor(ref self: ContractState, verifier_address: ContractAddress) {
        self.tongo_verifier.write(verifier_address);
    }

    #[abi(embed_v0)]
    impl PrivateSwapImpl of IPrivateSwap<ContractState> {
        /// @notice Initiates a private swap with encrypted data.
        /// @dev Verifies initiation proof before storing commitment.
        /// @param encrypted_data Encrypted swap payload.
        /// @param zk_proof Zero-knowledge proof for initiation.
        /// @return swap_id Newly created swap id.
        fn initiate_private_swap(
            ref self: ContractState, 
            encrypted_data: EncryptedSwapData, 
            zk_proof: Span<felt252>
        ) -> u64 {
            // Menggunakan Dispatcher pattern untuk interaksi antar kontrak
            let verifier = ITongoVerifierDispatcher { contract_address: self.tongo_verifier.read() };
            let mut inputs = array![encrypted_data.commitment];
            
            assert!(verifier.verify_proof(zk_proof, inputs.span()), "Invalid initiation proof");

            let id = self.swap_count.read() + 1;
            self.private_swaps.entry(id).write(encrypted_data);
            self.swap_count.write(id);
            id
        }

        /// @notice Verifies a swap proof against stored commitment.
        /// @dev Read-only helper for clients.
        /// @param swap_id Swap identifier.
        /// @param proof Zero-knowledge proof.
        /// @return valid True if proof is valid.
        fn verify_private_swap(self: @ContractState, swap_id: u64, proof: Span<felt252>) -> bool {
            let swap = self.private_swaps.entry(swap_id).read();
            let verifier = ITongoVerifierDispatcher { contract_address: self.tongo_verifier.read() };
            
            let mut inputs = array![swap.commitment];
            verifier.verify_proof(proof, inputs.span())
        }

        /// @notice Finalizes a private swap.
        /// @dev Uses nullifier to prevent double spending.
        /// @param swap_id Swap identifier.
        /// @param recipient Swap recipient address.
        /// @param nullifier Nullifier value for replay protection.
        fn finalize_swap(
            ref self: ContractState, 
            swap_id: u64, 
            recipient: ContractAddress, 
            nullifier: felt252
        ) {
            // Logika Nullifier untuk mencegah double-spending
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
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            let current = self.privacy_router.read();
            assert!(current.is_zero(), "Privacy router already set");
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

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
