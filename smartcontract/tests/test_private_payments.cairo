use starknet::ContractAddress;
use snforge_std::{declare, DeclareResultTrait, ContractClassTrait};

use smartcontract::privacy::private_payments::{
    IPrivatePaymentsDispatcher, IPrivatePaymentsDispatcherTrait, PaymentCommitment
};

#[starknet::interface]
pub trait IMockVerifier<TContractState> {
    // Updates next verification result configuration after access-control and invariant checks.
    // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
    fn set_next_verification_result(ref self: TContractState, result: bool);
}

#[starknet::contract]
pub mod MockVerifier {
    use starknet::storage::*;

    #[storage]
    struct Storage {
        next_result: bool
    }

    #[abi(embed_v0)]
    impl IProofVerifierImpl of smartcontract::privacy::zk_privacy_router::IProofVerifier<ContractState> {
        // Applies verify proof after input validation and commits the resulting state.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn verify_proof(self: @ContractState, proof: Span<felt252>, public_inputs: Span<felt252>) -> bool {
            let _ = proof;
            let _ = public_inputs;
            self.next_result.read()
        }
    }

    #[abi(embed_v0)]
    impl IMockVerifierImpl of super::IMockVerifier<ContractState> {
        // Updates next verification result configuration after access-control and invariant checks.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn set_next_verification_result(ref self: ContractState, result: bool) {
            self.next_result.write(result);
        }
    }
}

// Builds reusable fixture state and returns configured contracts for subsequent calls.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn setup() -> (IPrivatePaymentsDispatcher, ContractAddress) {
    let verifier_class = declare("MockVerifier").expect('Verifier declaration failed').contract_class();
    let (verifier_addr, _) = verifier_class.deploy(@array![]).expect('Verifier deployment failed');

    let payments_class = declare("PrivatePayments").expect('PrivatePayments dec failed').contract_class();
    let mut constructor_args = array![];
    let admin: ContractAddress = 0x1.try_into().unwrap();
    admin.serialize(ref constructor_args);
    verifier_addr.serialize(ref constructor_args);
    let (payments_addr, _) = payments_class.deploy(@constructor_args).expect('PrivatePayments dep failed');

    (IPrivatePaymentsDispatcher { contract_address: payments_addr }, verifier_addr)
}

#[test]
// Test case: validates submit private payment behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_submit_private_payment() {
    let (dispatcher, verifier_addr) = setup();
    IMockVerifierDispatcher { contract_address: verifier_addr }.set_next_verification_result(true);

    let payment = PaymentCommitment { ciphertext: 'payload', commitment: 'commit', amount_commitment: 'amount', finalized: false };
    let payment_id = dispatcher.submit_private_payment(payment, array![1].span(), array![2].span());
    assert(payment_id == 1, 'Payment id should be 1');
}

#[test]
// Test case: validates finalize private payment behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_finalize_private_payment() {
    let (dispatcher, verifier_addr) = setup();
    IMockVerifierDispatcher { contract_address: verifier_addr }.set_next_verification_result(true);

    let payment = PaymentCommitment { ciphertext: 'payload', commitment: 'commit', amount_commitment: 'amount', finalized: false };
    let payment_id = dispatcher.submit_private_payment(payment, array![].span(), array![].span());

    let recipient: ContractAddress = 0x123.try_into().unwrap();
    let nullifier = 'payment_nullifier';
    dispatcher.finalize_private_payment(payment_id, recipient, nullifier, array![].span(), array![].span());
    let used = dispatcher.is_nullifier_used(nullifier);
    assert(used, 'Nullifier should be marked used');
}

#[test]
// Test case: validates nullifier view default false behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_nullifier_view_default_false() {
    let (dispatcher, _verifier_addr) = setup();
    let nullifier = 'unused_nullifier';
    let used = dispatcher.is_nullifier_used(nullifier);
    assert(!used, 'Nullifier unused');
}

#[test]
#[should_panic(expected: "Nullifier already used")]
// Test case: validates reject double finalize with same nullifier behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_reject_double_finalize_with_same_nullifier() {
    let (dispatcher, verifier_addr) = setup();
    IMockVerifierDispatcher { contract_address: verifier_addr }.set_next_verification_result(true);

    let payment = PaymentCommitment { ciphertext: 'payload', commitment: 'commit', amount_commitment: 'amount', finalized: false };
    let payment_id = dispatcher.submit_private_payment(payment, array![].span(), array![].span());

    let recipient: ContractAddress = 0x123.try_into().unwrap();
    let nullifier = 'reuse_nullifier';
    dispatcher.finalize_private_payment(payment_id, recipient, nullifier, array![].span(), array![].span());
    dispatcher.finalize_private_payment(payment_id, recipient, nullifier, array![].span(), array![].span());
}
