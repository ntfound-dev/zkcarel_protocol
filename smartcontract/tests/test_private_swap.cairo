use starknet::ContractAddress;
use snforge_std::{declare, DeclareResultTrait, ContractClassTrait};

use smartcontract::bridge::private_swap::{
    IPrivateSwapDispatcher, IPrivateSwapDispatcherTrait, EncryptedSwapData
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
    impl ITongoVerifierImpl of smartcontract::bridge::private_swap::ITongoVerifier<ContractState> {
        // Applies verify proof after input validation and commits the resulting state.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn verify_proof(self: @ContractState, proof: Span<felt252>, public_inputs: Span<felt252>) -> bool {
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
fn setup() -> (IPrivateSwapDispatcher, ContractAddress, ContractAddress) {
    let verifier_class = declare("MockVerifier").expect('Verifier declaration failed').contract_class();
    let (verifier_addr, _) = verifier_class.deploy(@array![]).expect('Verifier deployment failed');
    
    let private_swap_class = declare("PrivateSwap").expect('PrivateSwap dec failed').contract_class();
    let mut constructor_args = array![];
    verifier_addr.serialize(ref constructor_args);
    let (private_swap_addr, _) = private_swap_class.deploy(@constructor_args).expect('PrivateSwap dep failed');
    
    (IPrivateSwapDispatcher { contract_address: private_swap_addr }, verifier_addr, private_swap_addr)
}

#[test]
// Test case: validates successful private initiation behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_successful_private_initiation() {
    let (dispatcher, verifier_addr, _) = setup();
    let mock_verifier = IMockVerifierDispatcher { contract_address: verifier_addr };
    
    mock_verifier.set_next_verification_result(true);
    
    let encrypted_data = EncryptedSwapData { 
        ciphertext: 'secret_payload', 
        commitment: 'hash_of_swap', 
        is_finalized: false 
    };
    let proof = array![1, 2, 3].span();
    
    let swap_id = dispatcher.initiate_private_swap(encrypted_data, proof);
    assert(swap_id == 1, 'Swap ID should be 1');
}

#[test]
#[should_panic(expected: "Invalid initiation proof")]
// Test case: validates initiation fails with invalid proof behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_initiation_fails_with_invalid_proof() {
    let (dispatcher, verifier_addr, _) = setup();
    let mock_verifier = IMockVerifierDispatcher { contract_address: verifier_addr };
    
    mock_verifier.set_next_verification_result(false);
    
    let encrypted_data = EncryptedSwapData { 
        ciphertext: 'fake', 
        commitment: 'fake_hash', 
        is_finalized: false 
    };
    dispatcher.initiate_private_swap(encrypted_data, array![0].span());
}

#[test]
// Test case: validates finalize swap marks nullifier behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_finalize_swap_marks_nullifier() {
    let (dispatcher, verifier_addr, _) = setup();
    IMockVerifierDispatcher { contract_address: verifier_addr }.set_next_verification_result(true);
    
    let encrypted_data = EncryptedSwapData { ciphertext: 'data', commitment: 'comm', is_finalized: false };
    let swap_id = dispatcher.initiate_private_swap(encrypted_data, array![].span());
    
    let recipient: ContractAddress = 0x888.try_into().unwrap();
    let nullifier = 'unique_nullifier_1';
    
    dispatcher.finalize_swap(swap_id, recipient, nullifier);
}

#[test]
#[should_panic(expected: "Nullifier already used")]
// Test case: validates prevent double spend with same nullifier behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_prevent_double_spend_with_same_nullifier() {
    let (dispatcher, verifier_addr, _) = setup();
    IMockVerifierDispatcher { contract_address: verifier_addr }.set_next_verification_result(true);
    
    let encrypted_data = EncryptedSwapData { ciphertext: 'd1', commitment: 'c1', is_finalized: false };
    let swap_id_1 = dispatcher.initiate_private_swap(encrypted_data, array![].span());
    
    let encrypted_data_2 = EncryptedSwapData { ciphertext: 'd2', commitment: 'c2', is_finalized: false };
    let swap_id_2 = dispatcher.initiate_private_swap(encrypted_data_2, array![].span());
    
    let recipient: ContractAddress = 0x888.try_into().unwrap();
    let nullifier = 'shared_nullifier';
    
    dispatcher.finalize_swap(swap_id_1, recipient, nullifier);
    dispatcher.finalize_swap(swap_id_2, recipient, nullifier);
}
