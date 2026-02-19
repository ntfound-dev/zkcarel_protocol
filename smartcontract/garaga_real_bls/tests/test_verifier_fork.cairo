//! # Groth16 Verifier Fork Test
//!
//! This test hits Sepolia fork and is intentionally split from fast unit tests.
//! Run explicitly when needed:
//! `snforge test tests/test_verifier_fork.cairo --ignored`

use garaga_real_bls::groth16_verifier::{
    IGroth16VerifierBLS12_381DispatcherTrait, IGroth16VerifierBLS12_381LibraryDispatcher,
};
use snforge_std::fs::{FileTrait, read_txt};
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare};
use starknet::ClassHash;

fn declare_contract(name: ByteArray) -> ClassHash {
    *declare(name).unwrap().contract_class().class_hash
}

#[test]
#[ignore]
#[fork(url: "https://starknet-sepolia.public.blastapi.io/rpc/v0_8", block_tag: latest)]
fn test_verify_groth16_proof_bls12_381_fork() {
    let class_hash = declare_contract("Groth16VerifierBLS12_381");
    let dispatcher = IGroth16VerifierBLS12_381LibraryDispatcher { class_hash };

    let file = FileTrait::new("tests/proof_calldata.txt");
    let calldata = read_txt(@file).span();
    let result = dispatcher.verify_groth16_proof_bls12_381(calldata);

    assert(result.is_some(), 'Proof is invalid');
}
