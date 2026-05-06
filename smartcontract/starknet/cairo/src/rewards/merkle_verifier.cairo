use starknet::ContractAddress;

/// @title IMerkleVerifier
/// @notice Poseidon-based Merkle proof verification helpers.
///         Leaf format: `Poseidon(user, amount, epoch)` — epoch binding prevents cross-epoch replay.
#[starknet::interface]
pub trait IMerkleVerifier<TContractState> {
    /// @notice Recomputes the Merkle path from `leaf` and returns true when it matches `root`.
    /// @param leaf The starting hash (leaf node).
    /// @param proof Ordered sibling hashes along the path to the root.
    /// @param root Expected Merkle root.
    /// @return true if the computed root matches `root`.
    fn verify_proof(
        self: @TContractState,
        leaf: felt252,
        proof: Span<felt252>,
        root: felt252
    ) -> bool;

    /// @notice Builds the canonical claim leaf hash from user, amount, and epoch.
    /// @param user Claimant address.
    /// @param amount Token allocation amount.
    /// @param epoch Distribution epoch.
    /// @return Poseidon hash of `(user, amount, epoch)`.
    fn hash_leaf(
        self: @TContractState,
        user: ContractAddress,
        amount: u256,
        epoch: u64
    ) -> felt252;

    /// @notice Hashes two sibling nodes after sorting them for deterministic ordering.
    /// @param left First node.
    /// @param right Second node.
    /// @return Poseidon hash of the sorted pair.
    fn hash_pair(
        self: @TContractState,
        left: felt252,
        right: felt252
    ) -> felt252;
}

/// @title MerkleVerifier
/// @notice Stateless on-chain Merkle verifier used by reward contracts to validate claim proofs.
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
        /// @inheritdoc IMerkleVerifier
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

        /// @inheritdoc IMerkleVerifier
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

        /// @inheritdoc IMerkleVerifier
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
