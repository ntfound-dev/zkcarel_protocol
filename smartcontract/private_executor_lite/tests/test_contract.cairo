//! # PrivateActionExecutor Unit Tests
//!
//! Fast unit test suite for executor logic.
//! The heavy verifier fork test is split into `tests/test_verifier_fork.cairo`.

use private_executor_lite::private_action_executor::{
    IPrivateActionExecutorDispatcher, IPrivateActionExecutorDispatcherTrait,
};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::ContractAddress;

#[starknet::interface]
pub trait IMockExecutorVerifierAdmin<TContractState> {
    fn set_should_fail(ref self: TContractState, value: bool);
}

#[starknet::contract]
pub mod MockExecutorVerifier {
    use starknet::storage::*;

    #[storage]
    pub struct Storage {
        pub should_fail: bool,
    }

    #[abi(embed_v0)]
    impl VerifierImpl of private_executor_lite::private_action_executor::IGroth16VerifierBlsOutput<
        ContractState,
    > {
        fn verify_groth16_proof_bls12_381(
            self: @ContractState, full_proof_with_hints: Span<felt252>,
        ) -> Option<Span<u256>> {
            if self.should_fail.read() {
                return Option::None;
            }

            assert!(full_proof_with_hints.len() >= 3, "mock proof too short");

            let mut out: Array<u256> = array![];
            out.append((*full_proof_with_hints.at(0_usize)).try_into().unwrap());
            out.append((*full_proof_with_hints.at(1_usize)).try_into().unwrap());
            out.append((*full_proof_with_hints.at(2_usize)).try_into().unwrap());
            Option::Some(out.span())
        }
    }

    #[abi(embed_v0)]
    impl AdminImpl of super::IMockExecutorVerifierAdmin<ContractState> {
        fn set_should_fail(ref self: ContractState, value: bool) {
            self.should_fail.write(value);
        }
    }
}

#[starknet::interface]
pub trait IMockExecutorTarget<TContractState> {
    fn mark(ref self: TContractState, value: felt252);
    fn get_mark(self: @TContractState) -> felt252;
}

#[starknet::contract]
pub mod MockExecutorTarget {
    use starknet::storage::*;

    #[storage]
    pub struct Storage {
        pub mark: felt252,
        pub calls: u64,
    }

    #[abi(embed_v0)]
    impl TargetImpl of super::IMockExecutorTarget<ContractState> {
        fn mark(ref self: ContractState, value: felt252) {
            self.mark.write(value);
            self.calls.write(self.calls.read() + 1);
        }

        fn get_mark(self: @ContractState) -> felt252 {
            self.mark.read()
        }
    }
}

fn setup_private_executor() -> (
    IPrivateActionExecutorDispatcher,
    IMockExecutorTargetDispatcher,
    ContractAddress,
    ContractAddress,
) {
    let admin: ContractAddress = 0x111.try_into().unwrap();
    let relayer: ContractAddress = 0x222.try_into().unwrap();

    let verifier_class = declare("MockExecutorVerifier").unwrap().contract_class();
    let (verifier_addr, _) = verifier_class.deploy(@array![]).unwrap();

    let target_class = declare("MockExecutorTarget").unwrap().contract_class();
    let (target_addr, _) = target_class.deploy(@array![]).unwrap();
    let target = IMockExecutorTargetDispatcher { contract_address: target_addr };

    let executor_class = declare("PrivateActionExecutor").unwrap().contract_class();
    let mut constructor_args = array![];
    admin.serialize(ref constructor_args);
    verifier_addr.serialize(ref constructor_args);
    relayer.serialize(ref constructor_args);
    target_addr.serialize(ref constructor_args);
    target_addr.serialize(ref constructor_args);
    target_addr.serialize(ref constructor_args);
    let (executor_addr, _) = executor_class.deploy(@constructor_args).unwrap();

    (IPrivateActionExecutorDispatcher { contract_address: executor_addr }, target, admin, relayer)
}

#[test]
fn test_private_action_executor_submit_and_execute_swap() {
    let (executor, target, _, relayer) = setup_private_executor();
    let nullifier: felt252 = 0x1111;
    let commitment: felt252 = 0x2222;
    let selector = selector!("mark");
    let calldata = array![0xabcdef];
    let intent_hash = executor.preview_swap_intent_hash(selector, calldata.span());

    let proof = array![nullifier, commitment, intent_hash];
    let public_inputs = array![nullifier, commitment, intent_hash];
    executor.submit_private_intent(nullifier, commitment, proof.span(), public_inputs.span());

    assert(executor.is_nullifier_used(nullifier), 'NULL_USED');
    assert(!executor.is_commitment_executed(commitment), 'COMMIT_PENDING');

    start_cheat_caller_address(executor.contract_address, relayer);
    executor.execute_private_swap(commitment, selector, calldata.span());
    stop_cheat_caller_address(executor.contract_address);

    assert(executor.is_commitment_executed(commitment), 'COMMIT_EXEC');
    assert(target.get_mark() == 0xabcdef, 'TARGET_MARK');
}

#[test]
fn test_private_action_executor_submit_and_execute_limit_order() {
    let (executor, target, _, relayer) = setup_private_executor();
    let nullifier: felt252 = 0x3333;
    let commitment: felt252 = 0x4444;
    let selector = selector!("mark");
    let calldata = array![0x777];
    let intent_hash = executor.preview_limit_intent_hash(selector, calldata.span());

    let proof = array![nullifier, commitment, intent_hash];
    let public_inputs = array![nullifier, commitment, intent_hash];
    executor.submit_private_intent(nullifier, commitment, proof.span(), public_inputs.span());

    start_cheat_caller_address(executor.contract_address, relayer);
    executor.execute_private_limit_order(commitment, selector, calldata.span());
    stop_cheat_caller_address(executor.contract_address);

    assert(executor.is_commitment_executed(commitment), 'LIMIT_EXEC');
    assert(target.get_mark() == 0x777, 'LIMIT_MARK');
}

#[test]
fn test_private_action_executor_submit_and_execute_stake() {
    let (executor, target, _, relayer) = setup_private_executor();
    let nullifier: felt252 = 0x5555;
    let commitment: felt252 = 0x6666;
    let selector = selector!("mark");
    let calldata = array![0x888];
    let intent_hash = executor.preview_stake_intent_hash(selector, calldata.span());

    let proof = array![nullifier, commitment, intent_hash];
    let public_inputs = array![nullifier, commitment, intent_hash];
    executor.submit_private_intent(nullifier, commitment, proof.span(), public_inputs.span());

    start_cheat_caller_address(executor.contract_address, relayer);
    executor.execute_private_stake(commitment, selector, calldata.span());
    stop_cheat_caller_address(executor.contract_address);

    assert(executor.is_commitment_executed(commitment), 'STAKE_EXEC');
    assert(target.get_mark() == 0x888, 'STAKE_MARK');
}

#[test]
fn test_private_action_executor_submitter_can_execute_without_relayer() {
    let (executor, target, _, _) = setup_private_executor();
    let submitter: ContractAddress = 0x333.try_into().unwrap();
    let nullifier: felt252 = 0x7711;
    let commitment: felt252 = 0x7722;
    let selector = selector!("mark");
    let calldata = array![0x909];
    let intent_hash = executor.preview_swap_intent_hash(selector, calldata.span());
    let proof = array![nullifier, commitment, intent_hash];
    let public_inputs = array![nullifier, commitment, intent_hash];

    start_cheat_caller_address(executor.contract_address, submitter);
    executor.submit_private_intent(nullifier, commitment, proof.span(), public_inputs.span());
    executor.execute_private_swap(commitment, selector, calldata.span());
    stop_cheat_caller_address(executor.contract_address);

    assert(executor.is_commitment_executed(commitment), 'OWNER_EXEC');
    assert(target.get_mark() == 0x909, 'OWNER_MARK');
}

#[test]
#[should_panic(expected: "Nullifier already used")]
fn test_private_action_executor_rejects_reused_nullifier() {
    let (executor, _, _, _) = setup_private_executor();
    let nullifier: felt252 = 0xaaaa;
    let commitment_a: felt252 = 0xbbbb;
    let commitment_b: felt252 = 0xcccc;
    let selector = selector!("mark");
    let calldata = array![0x1];

    let intent_hash_a = executor.preview_swap_intent_hash(selector, calldata.span());
    let proof_a = array![nullifier, commitment_a, intent_hash_a];
    let public_inputs_a = array![nullifier, commitment_a, intent_hash_a];
    executor.submit_private_intent(nullifier, commitment_a, proof_a.span(), public_inputs_a.span());

    let intent_hash_b = executor.preview_swap_intent_hash(selector, calldata.span());
    let proof_b = array![nullifier, commitment_b, intent_hash_b];
    let public_inputs_b = array![nullifier, commitment_b, intent_hash_b];
    executor.submit_private_intent(nullifier, commitment_b, proof_b.span(), public_inputs_b.span());
}

#[test]
#[should_panic(expected: "Only relayer/admin/owner")]
fn test_private_action_executor_blocks_unauthorized_execute() {
    let (executor, _, _, _) = setup_private_executor();
    let submitter: ContractAddress = 0x333.try_into().unwrap();
    let intruder: ContractAddress = 0x444.try_into().unwrap();
    let nullifier: felt252 = 0x111;
    let commitment: felt252 = 0x222;
    let selector = selector!("mark");
    let calldata = array![0x99];
    let intent_hash = executor.preview_swap_intent_hash(selector, calldata.span());
    let proof = array![nullifier, commitment, intent_hash];
    let public_inputs = array![nullifier, commitment, intent_hash];

    start_cheat_caller_address(executor.contract_address, submitter);
    executor.submit_private_intent(nullifier, commitment, proof.span(), public_inputs.span());
    stop_cheat_caller_address(executor.contract_address);

    start_cheat_caller_address(executor.contract_address, intruder);
    executor.execute_private_swap(commitment, selector, calldata.span());
    stop_cheat_caller_address(executor.contract_address);
}

#[test]
#[should_panic(expected: "Commitment already executed")]
fn test_private_action_executor_blocks_double_execute() {
    let (executor, _, _, relayer) = setup_private_executor();
    let nullifier: felt252 = 0x9911;
    let commitment: felt252 = 0x9922;
    let selector = selector!("mark");
    let calldata = array![0x55];
    let intent_hash = executor.preview_swap_intent_hash(selector, calldata.span());

    let proof = array![nullifier, commitment, intent_hash];
    let public_inputs = array![nullifier, commitment, intent_hash];
    executor.submit_private_intent(nullifier, commitment, proof.span(), public_inputs.span());

    start_cheat_caller_address(executor.contract_address, relayer);
    executor.execute_private_swap(commitment, selector, calldata.span());
    executor.execute_private_swap(commitment, selector, calldata.span());
    stop_cheat_caller_address(executor.contract_address);
}
