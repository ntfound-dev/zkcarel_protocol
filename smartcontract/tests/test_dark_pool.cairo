use starknet::ContractAddress;
use snforge_std::{declare, DeclareResultTrait, ContractClassTrait};

use smartcontract::trading::dark_pool::{
    IDarkPoolDispatcher, IDarkPoolDispatcherTrait, DarkOrder
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

fn setup() -> (IDarkPoolDispatcher, ContractAddress) {
    let verifier_class = declare("MockVerifier").expect('Verifier declaration failed').contract_class();
    let (verifier_addr, _) = verifier_class.deploy(@array![]).expect('Verifier deployment failed');

    let pool_class = declare("DarkPool").expect('DarkPool dec failed').contract_class();
    let mut constructor_args = array![];
    let admin: ContractAddress = 0x1.try_into().unwrap();
    admin.serialize(ref constructor_args);
    verifier_addr.serialize(ref constructor_args);
    let (pool_addr, _) = pool_class.deploy(@constructor_args).expect('DarkPool dep failed');

    (IDarkPoolDispatcher { contract_address: pool_addr }, verifier_addr)
}

#[test]
fn test_submit_order() {
    let (dispatcher, verifier_addr) = setup();
    IMockVerifierDispatcher { contract_address: verifier_addr }.set_next_verification_result(true);

    let order = DarkOrder { ciphertext: 'payload', commitment: 'commit', filled: false };
    let order_id = dispatcher.submit_order(order, array![1].span(), array![2].span());
    assert(order_id == 1, 'Order id should be 1');
}

#[test]
fn test_match_order() {
    let (dispatcher, verifier_addr) = setup();
    IMockVerifierDispatcher { contract_address: verifier_addr }.set_next_verification_result(true);

    let order = DarkOrder { ciphertext: 'payload', commitment: 'commit', filled: false };
    let order_id = dispatcher.submit_order(order, array![].span(), array![].span());

    let nullifier = 'dark_nullifier';
    dispatcher.match_order(order_id, nullifier, array![].span(), array![].span());
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
fn test_match_rejects_reused_nullifier() {
    let (dispatcher, verifier_addr) = setup();
    IMockVerifierDispatcher { contract_address: verifier_addr }.set_next_verification_result(true);

    let order = DarkOrder { ciphertext: 'payload', commitment: 'commit', filled: false };
    let order_id = dispatcher.submit_order(order, array![].span(), array![].span());

    let nullifier = 'reuse_nullifier';
    dispatcher.match_order(order_id, nullifier, array![].span(), array![].span());
    dispatcher.match_order(order_id, nullifier, array![].span(), array![].span());
}
