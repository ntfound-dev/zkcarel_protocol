use core::array::ArrayTrait;
use core::poseidon::poseidon_hash_span;

use snforge_std::{declare, DeclareResultTrait, ContractClassTrait};

use smartcontract::privacy::sigma_verifier::{ISigmaVerifierDispatcher, ISigmaVerifierDispatcherTrait};

#[test]
// Test case: validates sigma verifier accepts valid proof behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_sigma_verifier_accepts_valid_proof() {
    let contract = declare("SigmaVerifier").unwrap().contract_class();
    let (address, _) = contract.deploy(@array![]).unwrap();
    let verifier = ISigmaVerifierDispatcher { contract_address: address };

    let s: felt252 = 123;
    let y: felt252 = 456;
    let mut data = array![s, y];
    let t = poseidon_hash_span(data.span());

    let proof = array![t, s];
    let inputs = array![y];

    let ok = verifier.verify_proof(proof.span(), inputs.span());
    assert!(ok, "Sigma verifier should accept valid proof");
}

#[test]
// Test case: validates sigma verifier rejects invalid proof behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_sigma_verifier_rejects_invalid_proof() {
    let contract = declare("SigmaVerifier").unwrap().contract_class();
    let (address, _) = contract.deploy(@array![]).unwrap();
    let verifier = ISigmaVerifierDispatcher { contract_address: address };

    let proof = array![1, 2];
    let inputs = array![3];

    let ok = verifier.verify_proof(proof.span(), inputs.span());
    assert!(!ok, "Sigma verifier should reject invalid proof");
}
