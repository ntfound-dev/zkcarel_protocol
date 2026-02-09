use starknet::ContractAddress;

/// @title Merkle Verifier Interface
/// @author CAREL Team
/// @notice Defines Merkle proof verification helpers for rewards.
/// @dev Uses Poseidon hashing for deterministic proofs.
#[starknet::interface]
pub trait IMerkleVerifier<TContractState> {
    /// @notice Verifies a Merkle proof against a root.
    /// @dev Recomputes the root from the leaf and proof.
    /// @param leaf Leaf hash.
    /// @param proof Merkle proof array.
    /// @param root Expected Merkle root.
    /// @return valid True if proof is valid.
    fn verify_proof(
        self: @TContractState, 
        leaf: felt252, 
        proof: Span<felt252>, 
        root: felt252
    ) -> bool;

    /// @notice Hashes a reward leaf from user data.
    /// @dev Ensures a deterministic leaf for reward claims.
    /// @param user User address.
    /// @param amount Claimable amount.
    /// @param epoch Reward epoch.
    /// @return leaf Leaf hash.
    fn hash_leaf(
        self: @TContractState, 
        user: ContractAddress, 
        amount: u256, 
        epoch: u64
    ) -> felt252;

    /// @notice Hashes a pair of nodes for Merkle tree construction.
    /// @dev Orders pair to keep hashes deterministic.
    /// @param left Left node hash.
    /// @param right Right node hash.
    /// @return hash Parent hash.
    fn hash_pair(
        self: @TContractState, 
        left: felt252, 
        right: felt252
    ) -> felt252;
}

/// @title Merkle Verifier Contract
/// @author CAREL Team
/// @notice On-chain Merkle verification utilities for reward claims.
/// @dev Uses Poseidon hashing consistent with off-chain generation.
#[starknet::contract]
pub mod MerkleVerifier {
    use starknet::ContractAddress;
    use starknet::storage::*;
    use core::poseidon::PoseidonTrait;
    use core::hash::{HashStateTrait, HashStateExTrait};

    #[storage]
    pub struct Storage {}

    #[abi(embed_v0)]
    pub impl MerkleVerifierImpl of super::IMerkleVerifier<ContractState> {
        /// @notice Verifies a Merkle proof against a root.
        /// @dev Recomputes the root from the leaf and proof.
        /// @param leaf Leaf hash.
        /// @param proof Merkle proof array.
        /// @param root Expected Merkle root.
        /// @return valid True if proof is valid.
        fn verify_proof(
            self: @ContractState, 
            leaf: felt252, 
            proof: Span<felt252>, 
            root: felt252
        ) -> bool {
            let mut computed_hash = leaf;
            
            for i in 0..proof.len() {
                computed_hash = self.hash_pair(computed_hash, *proof.at(i));
            };

            computed_hash == root
        }

        /// @notice Hashes a reward leaf from user data.
        /// @dev Ensures a deterministic leaf for reward claims.
        /// @param user User address.
        /// @param amount Claimable amount.
        /// @param epoch Reward epoch.
        /// @return leaf Leaf hash.
        fn hash_leaf(
            self: @ContractState, 
            user: ContractAddress, 
            amount: u256, 
            epoch: u64
        ) -> felt252 {
            PoseidonTrait::new()
                .update_with(user)
                .update_with(amount)
                .update_with(epoch)
                .finalize()
        }

        /// @notice Hashes a pair of nodes for Merkle tree construction.
        /// @dev Orders pair to keep hashes deterministic.
        /// @param left Left node hash.
        /// @param right Right node hash.
        /// @return hash Parent hash.
        fn hash_pair(
            self: @ContractState, 
            left: felt252, 
            right: felt252
        ) -> felt252 {
            let left_u256: u256 = left.into();
            let right_u256: u256 = right.into();

            if left_u256 < right_u256 {
                PoseidonTrait::new().update(left).update(right).finalize()
            } else {
                PoseidonTrait::new().update(right).update(left).finalize()
            }
        }
    }
}
