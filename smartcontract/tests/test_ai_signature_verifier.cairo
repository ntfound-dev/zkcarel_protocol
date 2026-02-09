use starknet::ContractAddress;
use core::array::ArrayTrait;
use core::serde::Serde;
use core::traits::TryInto;
use core::poseidon::poseidon_hash_span;
use snforge_std::{
    declare, DeclareResultTrait, ContractClassTrait,
    start_cheat_caller_address, stop_cheat_caller_address,
    cheat_block_timestamp, CheatSpan
};

use smartcontract::ai::ai_executor::{
    IAIExecutorDispatcher, IAIExecutorDispatcherTrait, ActionType,
    IAIExecutorAdminDispatcher, IAIExecutorAdminDispatcherTrait
};
use smartcontract::ai::ai_signature_verifier::{
    IAISignatureVerifierAdminDispatcher, IAISignatureVerifierAdminDispatcherTrait
};

fn action_type_to_felt(action_type: ActionType) -> felt252 {
    match action_type {
        ActionType::Swap => 0,
        ActionType::Bridge => 1,
        ActionType::Stake => 2,
        ActionType::ClaimReward => 3,
        ActionType::MintNFT => 4,
        ActionType::MultiStep => 5,
        ActionType::Basic => 6,
    }
}

fn compute_action_hash(
    user: ContractAddress,
    action_type: ActionType,
    params: ByteArray,
    timestamp: u64
) -> felt252 {
    let mut data = array![];
    user.serialize(ref data);
    action_type_to_felt(action_type).serialize(ref data);
    params.serialize(ref data);
    timestamp.serialize(ref data);
    poseidon_hash_span(data.span())
}

#[test]
fn test_ai_executor_signature_verification_with_allowlist() {
    let carel_token: ContractAddress = 0x111.try_into().unwrap();
    let backend_signer: ContractAddress = 0x222.try_into().unwrap();
    let user: ContractAddress = 0x333.try_into().unwrap();

    let verifier_class = declare("AISignatureVerifier").unwrap().contract_class();
    let mut verifier_args = array![];
    backend_signer.serialize(ref verifier_args);
    let (verifier_address, _) = verifier_class.deploy(@verifier_args).unwrap();

    let executor_class = declare("AIExecutor").unwrap().contract_class();
    let mut executor_args = array![];
    carel_token.serialize(ref executor_args);
    backend_signer.serialize(ref executor_args);
    let (executor_address, _) = executor_class.deploy(@executor_args).unwrap();

    let admin_exec = IAIExecutorAdminDispatcher { contract_address: executor_address };
    start_cheat_caller_address(executor_address, backend_signer);
    admin_exec.set_fee_config(1_000_000_000_000_000_000, 2_000_000_000_000_000_000, false);
    admin_exec.set_signature_verification(verifier_address, true);
    stop_cheat_caller_address(executor_address);

    let timestamp: u64 = 5000;
    cheat_block_timestamp(executor_address, timestamp, CheatSpan::TargetCalls(5));

    let params = "swap 1 BTC to STRK";
    let msg_hash = compute_action_hash(user, ActionType::Swap, params.clone(), timestamp);

    let verifier_admin = IAISignatureVerifierAdminDispatcher { contract_address: verifier_address };
    start_cheat_caller_address(verifier_address, backend_signer);
    verifier_admin.set_valid_hash(user, msg_hash, true);
    stop_cheat_caller_address(verifier_address);

    let executor = IAIExecutorDispatcher { contract_address: executor_address };
    start_cheat_caller_address(executor_address, user);
    let action_id = executor.submit_action(ActionType::Swap, params, array![0x1].span());
    assert!(action_id == 1, "Action should be accepted with valid signature");
}

#[test]
#[should_panic(expected: "Invalid user signature")]
fn test_ai_executor_rejects_replay_hash() {
    let carel_token: ContractAddress = 0x111.try_into().unwrap();
    let backend_signer: ContractAddress = 0x222.try_into().unwrap();
    let user: ContractAddress = 0x333.try_into().unwrap();

    let verifier_class = declare("AISignatureVerifier").unwrap().contract_class();
    let mut verifier_args = array![];
    backend_signer.serialize(ref verifier_args);
    let (verifier_address, _) = verifier_class.deploy(@verifier_args).unwrap();

    let executor_class = declare("AIExecutor").unwrap().contract_class();
    let mut executor_args = array![];
    carel_token.serialize(ref executor_args);
    backend_signer.serialize(ref executor_args);
    let (executor_address, _) = executor_class.deploy(@executor_args).unwrap();

    let admin_exec = IAIExecutorAdminDispatcher { contract_address: executor_address };
    start_cheat_caller_address(executor_address, backend_signer);
    admin_exec.set_fee_config(1_000_000_000_000_000_000, 2_000_000_000_000_000_000, false);
    admin_exec.set_signature_verification(verifier_address, true);
    stop_cheat_caller_address(executor_address);

    let timestamp: u64 = 7000;
    cheat_block_timestamp(executor_address, timestamp, CheatSpan::TargetCalls(5));

    let params = "swap 1 BTC to STRK";
    let msg_hash = compute_action_hash(user, ActionType::Swap, params.clone(), timestamp);

    let verifier_admin = IAISignatureVerifierAdminDispatcher { contract_address: verifier_address };
    start_cheat_caller_address(verifier_address, backend_signer);
    verifier_admin.set_valid_hash(user, msg_hash, true);
    stop_cheat_caller_address(verifier_address);

    let executor = IAIExecutorDispatcher { contract_address: executor_address };
    start_cheat_caller_address(executor_address, user);
    let _ = executor.submit_action(ActionType::Swap, params.clone(), array![0x1].span());

    // Reuse the same hash/signature should fail after consume.
    executor.submit_action(ActionType::Swap, params, array![0x1].span());
}

#[test]
#[should_panic(expected: "Invalid user signature")]
fn test_ai_executor_signature_verification_rejects_unknown_hash() {
    let carel_token: ContractAddress = 0x111.try_into().unwrap();
    let backend_signer: ContractAddress = 0x222.try_into().unwrap();
    let user: ContractAddress = 0x333.try_into().unwrap();

    let verifier_class = declare("AISignatureVerifier").unwrap().contract_class();
    let mut verifier_args = array![];
    backend_signer.serialize(ref verifier_args);
    let (verifier_address, _) = verifier_class.deploy(@verifier_args).unwrap();

    let executor_class = declare("AIExecutor").unwrap().contract_class();
    let mut executor_args = array![];
    carel_token.serialize(ref executor_args);
    backend_signer.serialize(ref executor_args);
    let (executor_address, _) = executor_class.deploy(@executor_args).unwrap();

    let admin_exec = IAIExecutorAdminDispatcher { contract_address: executor_address };
    start_cheat_caller_address(executor_address, backend_signer);
    admin_exec.set_fee_config(1_000_000_000_000_000_000, 2_000_000_000_000_000_000, false);
    admin_exec.set_signature_verification(verifier_address, true);
    stop_cheat_caller_address(executor_address);

    let timestamp: u64 = 6000;
    cheat_block_timestamp(executor_address, timestamp, CheatSpan::TargetCalls(2));

    let executor = IAIExecutorDispatcher { contract_address: executor_address };
    start_cheat_caller_address(executor_address, user);
    executor.submit_action(ActionType::Swap, "swap", array![0x1].span());
}
