use starknet::ContractAddress;

#[starknet::interface]
pub trait IMerkleVerifier<TContractState> {
    fn verify_proof(
        self: @TContractState, 
        leaf: felt252, 
        proof: Span<felt252>, 
        root: felt252
    ) -> bool;

    fn hash_leaf(
        self: @TContractState, 
        user: ContractAddress, 
        amount: u256, 
        epoch: u64
    ) -> felt252;

    fn hash_pair(
        self: @TContractState, 
        left: felt252, 
        right: felt252
    ) -> felt252;
}

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