use starknet::ContractAddress;
use snforge_std::{declare, ContractClassTrait, DeclareResultTrait};

// Import dispatcher and traits from the module path
use smartcontract::rewards::merkle_verifier::{IMerkleVerifierDispatcher, IMerkleVerifierDispatcherTrait};

/// Helper function to deploy the MerkleVerifier contract
fn deploy_merkle_verifier() -> IMerkleVerifierDispatcher {
    let contract = declare("MerkleVerifier").unwrap().contract_class();
    // Constructor is empty, so no calldata needed
    let (contract_address, _) = contract.deploy(@array![]).unwrap();
    IMerkleVerifierDispatcher { contract_address }
}

#[test]
fn test_hash_leaf_consistency() {
    let dispatcher = deploy_merkle_verifier();
    
    let user: ContractAddress = 0x123.try_into().unwrap();
    let amount: u256 = 1000_u256;
    let epoch: u64 = 1_u64;

    let leaf1 = dispatcher.hash_leaf(user, amount, epoch);
    let leaf2 = dispatcher.hash_leaf(user, amount, epoch);

    assert!(leaf1 != 0, "Leaf hash should not be zero");
    assert!(leaf1 == leaf2, "Hashing same data should yield same result");
}

#[test]
fn test_hash_pair_sorting() {
    let dispatcher = deploy_merkle_verifier();
    
    let a = 0x100_felt252;
    let b = 0x200_felt252;

    // The commutative hasher should produce the same result regardless of input order
    let hash_ab = dispatcher.hash_pair(a, b);
    let hash_ba = dispatcher.hash_pair(b, a);

    assert!(hash_ab == hash_ba, "hash_pair must be commutative (sorted)");
}

#[test]
fn test_verify_valid_proof_single_level() {
    let dispatcher = deploy_merkle_verifier();
    
    // Setup simple tree: 
    //      Root
    //     /    \
    //  Leaf   Sibling
    
    let leaf = 0x111_felt252;
    let sibling = 0x222_felt252;
    let root = dispatcher.hash_pair(leaf, sibling);

    let mut proof = array![sibling];
    
    let is_valid = dispatcher.verify_proof(leaf, proof.span(), root);
    assert!(is_valid, "Valid single-level proof should pass");
}

#[test]
fn test_verify_valid_proof_multi_level() {
    let dispatcher = deploy_merkle_verifier();
    
    // Setup 3-level tree:
    //          Root
    //         /    \
    //      Node1    Node2 (Proof level 1)
    //     /    \
    //  Leaf     Sibling (Proof level 0)

    let leaf = 0xaaa_felt252;
    let sibling = 0xbbb_felt252;
    let proof_l1 = 0xccc_felt252;

    let node1 = dispatcher.hash_pair(leaf, sibling);
    let root = dispatcher.hash_pair(node1, proof_l1);

    let mut proof = array![sibling, proof_l1];
    
    let is_valid = dispatcher.verify_proof(leaf, proof.span(), root);
    assert!(is_valid, "Valid multi-level proof should pass");
}

#[test]
fn test_verify_invalid_proof_fails() {
    let dispatcher = deploy_merkle_verifier();
    
    let leaf = 0x111_felt252;
    let sibling = 0x222_felt252;
    let root = dispatcher.hash_pair(leaf, sibling);

    // Case 1: Wrong sibling
    let mut wrong_proof = array![0x999_felt252];
    let result1 = dispatcher.verify_proof(leaf, wrong_proof.span(), root);
    assert!(!result1, "Proof with wrong sibling should fail");

    // Case 2: Wrong leaf
    let mut proof = array![sibling];
    let result2 = dispatcher.verify_proof(0x333_felt252, proof.span(), root);
    assert!(!result2, "Proof with wrong leaf should fail");
}

#[test]
fn test_verify_empty_proof_is_leaf() {
    let dispatcher = deploy_merkle_verifier();
    
    let leaf = 0x111_felt252;
    let root = leaf; // If proof is empty, leaf must be root
    
    let mut empty_proof = array![];
    let is_valid = dispatcher.verify_proof(leaf, empty_proof.span(), root);
    assert!(is_valid, "Empty proof should pass if leaf equals root");
}