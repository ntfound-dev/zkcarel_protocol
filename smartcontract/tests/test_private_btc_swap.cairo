use starknet::ContractAddress;
use snforge_std::{declare, DeclareResultTrait, ContractClassTrait};

use smartcontract::bridge::private_btc_swap::{
    IPrivateBTCSwapDispatcher, IPrivateBTCSwapDispatcherTrait, PrivateBTCSwapData
};

#[starknet::interface]
pub trait IMockVerifier<TContractState> {
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
        fn verify_proof(self: @ContractState, proof: Span<felt252>, public_inputs: Span<felt252>) -> bool {
            let _ = proof;
            let _ = public_inputs;
            self.next_result.read()
        }
    }

    #[abi(embed_v0)]
    impl IMockVerifierImpl of super::IMockVerifier<ContractState> {
        fn set_next_verification_result(ref self: ContractState, result: bool) {
            self.next_result.write(result);
        }
    }
}

fn setup() -> (IPrivateBTCSwapDispatcher, ContractAddress) {
    let verifier_class = declare("MockVerifier").expect('Verifier declaration failed').contract_class();
    let (verifier_addr, _) = verifier_class.deploy(@array![]).expect('Verifier deployment failed');

    let swap_class = declare("PrivateBTCSwap").expect('PrivateBTCSwap dec failed').contract_class();
    let mut constructor_args = array![];
    let admin: ContractAddress = 0x1.try_into().unwrap();
    admin.serialize(ref constructor_args);
    verifier_addr.serialize(ref constructor_args);
    let (swap_addr, _) = swap_class.deploy(@constructor_args).expect('PrivateBTCSwap dep failed');

    (IPrivateBTCSwapDispatcher { contract_address: swap_addr }, verifier_addr)
}

#[test]
fn test_initiate_private_btc_swap() {
    let (dispatcher, verifier_addr) = setup();
    let mock_verifier = IMockVerifierDispatcher { contract_address: verifier_addr };
    mock_verifier.set_next_verification_result(true);

    let swap = PrivateBTCSwapData { ciphertext: 'payload', commitment: 'commit', finalized: false };
    let swap_id = dispatcher.initiate_private_btc_swap(swap, array![1, 2].span(), array![3].span());
    assert(swap_id == 1, 'Swap id should be 1');
}

#[test]
fn test_finalize_sets_nullifier() {
    let (dispatcher, verifier_addr) = setup();
    IMockVerifierDispatcher { contract_address: verifier_addr }.set_next_verification_result(true);

    let swap = PrivateBTCSwapData { ciphertext: 'payload', commitment: 'commit', finalized: false };
    let swap_id = dispatcher.initiate_private_btc_swap(swap, array![].span(), array![].span());

    let recipient: ContractAddress = 0x123.try_into().unwrap();
    let nullifier = 'nullifier_1';
    dispatcher.finalize_private_btc_swap(swap_id, recipient, nullifier, array![].span(), array![].span());

    let used = dispatcher.is_nullifier_used(nullifier);
    assert(used, 'Nullifier should be marked used');
}

#[test]
fn test_nullifier_view_default_false() {
    let (dispatcher, _verifier_addr) = setup();
    let nullifier = 'unused_nullifier';
    let used = dispatcher.is_nullifier_used(nullifier);
    assert(!used, 'Nullifier unused');
}

#[test]
#[should_panic(expected: "Nullifier already used")]
fn test_prevent_double_finalize_with_same_nullifier() {
    let (dispatcher, verifier_addr) = setup();
    IMockVerifierDispatcher { contract_address: verifier_addr }.set_next_verification_result(true);

    let swap = PrivateBTCSwapData { ciphertext: 'payload', commitment: 'commit', finalized: false };
    let swap_id = dispatcher.initiate_private_btc_swap(swap, array![].span(), array![].span());

    let recipient: ContractAddress = 0x123.try_into().unwrap();
    let nullifier = 'nullifier_shared';
    dispatcher.finalize_private_btc_swap(swap_id, recipient, nullifier, array![].span(), array![].span());
    dispatcher.finalize_private_btc_swap(swap_id, recipient, nullifier, array![].span(), array![].span());
}
