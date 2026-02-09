use snforge_std::{declare, DeclareResultTrait, ContractClassTrait};

use smartcontract::rewards::merkle_verifier::{
    IMerkleVerifierDispatcher, IMerkleVerifierDispatcherTrait
};

fn deploy_merkle() -> IMerkleVerifierDispatcher {
    let contract = declare("MerkleVerifier").unwrap().contract_class();
    let (addr, _) = contract.deploy(@array![]).unwrap();
    IMerkleVerifierDispatcher { contract_address: addr }
}

#[test]
#[fuzzer(runs: 64)]
fn fuzz_hash_pair_commutative(a: felt252, b: felt252) {
    let dispatcher = deploy_merkle();
    let ab = dispatcher.hash_pair(a, b);
    let ba = dispatcher.hash_pair(b, a);
    assert!(ab == ba, "Hash pair should be commutative");
}

#[test]
#[fuzzer(runs: 64)]
fn fuzz_verify_empty_proof(leaf: felt252) {
    let dispatcher = deploy_merkle();
    let ok = dispatcher.verify_proof(leaf, array![].span(), leaf);
    assert!(ok, "Empty proof should accept leaf == root");

    let bad_root = leaf + 1;
    let bad = dispatcher.verify_proof(leaf, array![].span(), bad_root);
    assert!(!bad, "Empty proof should reject mismatched root");
}
