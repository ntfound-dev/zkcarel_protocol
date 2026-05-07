use starknet::ContractAddress;
use core::array::ArrayTrait;
use core::serde::Serde;
use core::poseidon::poseidon_hash_span;
use core::traits::Into;
use core::traits::TryInto;
use snforge_std::{
    declare, DeclareResultTrait, ContractClassTrait,
    start_cheat_caller_address, stop_cheat_caller_address
};

use smartcontract::ai::ai_executor::{
    IAIExecutorDispatcher, IAIExecutorDispatcherTrait, ActionType,
    IAIExecutorAdminDispatcher, IAIExecutorAdminDispatcherTrait
};
use smartcontract::mocks::mock_signature_account::{
    IMockSignatureAccountAdminDispatcher, IMockSignatureAccountAdminDispatcherTrait
};

const TEST_CHAIN_ID: felt252 = 0x1;

// Deploys a mock account contract and returns the contract address.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn deploy_mock_account(admin: ContractAddress) -> ContractAddress {
    let class = declare("MockSignatureAccount").unwrap().contract_class();
    let mut args = array![];
    admin.serialize(ref args);
    let (address, _) = class.deploy(@args).unwrap();
    address
}

// Deploys executor+verifier fixture wired with mock signer accounts.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn setup_with_signature_verifier() -> (
    IAIExecutorDispatcher,
    ContractAddress,
    ContractAddress,
    ContractAddress,
    ContractAddress
) {
    let admin: ContractAddress = 0x111.try_into().unwrap();
    let carel_token: ContractAddress = 0x222.try_into().unwrap();

    let backend_signer = deploy_mock_account(admin);
    let user = deploy_mock_account(admin);

    let verifier_class = declare("AISignatureVerifier").unwrap().contract_class();
    let mut verifier_args = array![];
    admin.serialize(ref verifier_args);
    let (verifier_address, _) = verifier_class.deploy(@verifier_args).unwrap();

    let executor_class = declare("AIExecutor").unwrap().contract_class();
    let mut executor_args = array![];
    carel_token.serialize(ref executor_args);
    backend_signer.serialize(ref executor_args);
    executor_args.append(1); // chain_id (non-zero required; overwritten by set_chain_id below)
    let (executor_address, _) = executor_class.deploy(@executor_args).unwrap();

    let admin_exec = IAIExecutorAdminDispatcher { contract_address: executor_address };
    start_cheat_caller_address(executor_address, backend_signer);
    admin_exec.set_fee_config(2_000_000_000_000_000_000, 3_000_000_000_000_000_000, false);
    admin_exec.set_signature_verification(verifier_address, true);
    admin_exec.set_chain_id(TEST_CHAIN_ID);
    stop_cheat_caller_address(executor_address);

    (
        IAIExecutorDispatcher { contract_address: executor_address },
        admin,
        verifier_address,
        backend_signer,
        user
    )
}

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
    executor_address: ContractAddress,
    user: ContractAddress,
    action_type: ActionType,
    params: ByteArray,
    nonce: felt252
) -> felt252 {
    let mut params_data: Array<felt252> = array![];
    params.serialize(ref params_data);
    let params_hash = poseidon_hash_span(params_data.span());

    let mut fields: Array<felt252> = array![];
    let user_felt: felt252 = user.into();
    fields.append(user_felt);
    fields.append(action_type_to_felt(action_type));
    fields.append(params_hash);
    fields.append(nonce);
    fields.append(TEST_CHAIN_ID);
    let contract_felt: felt252 = executor_address.into();
    fields.append(contract_felt);
    poseidon_hash_span(fields.span())
}

#[test]
// Test case: validates ai executor signature verification with account is_valid_signature behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_ai_executor_signature_verification_with_account_signature() {
    let (executor, admin, _, _, user) = setup_with_signature_verifier();

    let nonce: felt252 = 0x1;
    let message_hash: felt252 = compute_action_hash(
        executor.contract_address,
        user,
        ActionType::Swap,
        "swap 1 BTC to STRK",
        nonce
    );
    let r: felt252 = 0x123;
    let s: felt252 = 0x456;

    let user_admin = IMockSignatureAccountAdminDispatcher { contract_address: user };
    start_cheat_caller_address(user, admin);
    user_admin.set_valid_signature(message_hash, r, s, true);
    stop_cheat_caller_address(user);

    start_cheat_caller_address(executor.contract_address, user);
    let action_id = executor.submit_action(
        ActionType::Swap,
        "swap 1 BTC to STRK",
        nonce,
        message_hash,
        array![r, s].span()
    );
    assert!(action_id == 1, "Action should be accepted with valid account signature");
}

#[test]
#[should_panic(expected: "Signature already consumed")]
// Test case: validates ai executor rejects replay signature hash behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_ai_executor_rejects_replay_signature_hash() {
    let (executor, admin, _, _, user) = setup_with_signature_verifier();

    let nonce: felt252 = 0x2;
    let message_hash: felt252 = compute_action_hash(
        executor.contract_address,
        user,
        ActionType::Swap,
        "swap 1 BTC to STRK",
        nonce
    );
    let r: felt252 = 0x777;
    let s: felt252 = 0x888;

    let user_admin = IMockSignatureAccountAdminDispatcher { contract_address: user };
    start_cheat_caller_address(user, admin);
    user_admin.set_valid_signature(message_hash, r, s, true);
    stop_cheat_caller_address(user);

    start_cheat_caller_address(executor.contract_address, user);
    let _ = executor.submit_action(
        ActionType::Swap,
        "swap 1 BTC to STRK",
        nonce,
        message_hash,
        array![r, s].span()
    );

    // Reusing identical hash+signature should fail because verifier consumes hash.
    executor.submit_action(
        ActionType::Swap,
        "swap 1 BTC to STRK",
        nonce,
        message_hash,
        array![r, s].span()
    );
}

#[test]
#[should_panic(expected: "Invalid user signature")]
// Test case: validates ai executor rejects unknown account signature behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_ai_executor_signature_verification_rejects_unknown_signature() {
    let (executor, _, _, _, user) = setup_with_signature_verifier();

    let nonce: felt252 = 0x3;
    let message_hash: felt252 = compute_action_hash(
        executor.contract_address,
        user,
        ActionType::Swap,
        "swap",
        nonce
    );
    let r: felt252 = 0xaaa;
    let s: felt252 = 0xbbb;

    start_cheat_caller_address(executor.contract_address, user);
    executor.submit_action(
        ActionType::Swap,
        "swap",
        nonce,
        message_hash,
        array![r, s].span()
    );
}

#[test]
// Test case: validates ai executor execute_action accepts valid backend account signature behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_ai_executor_execute_action_accepts_valid_backend_signature() {
    let (executor, admin, _, backend_signer, user) = setup_with_signature_verifier();

    let nonce: felt252 = 0x4;
    let action_hash: felt252 = compute_action_hash(
        executor.contract_address,
        user,
        ActionType::Swap,
        "swap",
        nonce
    );
    let user_r: felt252 = 0x1001;
    let user_s: felt252 = 0x1002;
    let backend_r: felt252 = 0x2001;
    let backend_s: felt252 = 0x2002;

    let user_admin = IMockSignatureAccountAdminDispatcher { contract_address: user };
    start_cheat_caller_address(user, admin);
    user_admin.set_valid_signature(action_hash, user_r, user_s, true);
    stop_cheat_caller_address(user);

    let backend_admin = IMockSignatureAccountAdminDispatcher { contract_address: backend_signer };
    start_cheat_caller_address(backend_signer, admin);
    backend_admin.set_valid_signature(action_hash, backend_r, backend_s, true);
    stop_cheat_caller_address(backend_signer);

    start_cheat_caller_address(executor.contract_address, user);
    let action_id = executor.submit_action(
        ActionType::Swap,
        "swap",
        nonce,
        action_hash,
        array![user_r, user_s].span()
    );
    stop_cheat_caller_address(executor.contract_address);

    start_cheat_caller_address(executor.contract_address, backend_signer);
    executor.execute_action(action_id, array![backend_r, backend_s].span());
    stop_cheat_caller_address(executor.contract_address);

    let pending = executor.get_pending_actions(user);
    assert!(pending.len() == 0, "Action should be executed and removed from pending");
}

#[test]
#[should_panic(expected: "Invalid backend signature")]
// Test case: validates ai executor execute_action rejects invalid backend signature behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_ai_executor_execute_action_rejects_invalid_backend_signature() {
    let (executor, admin, _, backend_signer, user) = setup_with_signature_verifier();

    let nonce: felt252 = 0x5;
    let action_hash: felt252 = compute_action_hash(
        executor.contract_address,
        user,
        ActionType::Swap,
        "swap",
        nonce
    );
    let user_r: felt252 = 0x3001;
    let user_s: felt252 = 0x3002;

    let user_admin = IMockSignatureAccountAdminDispatcher { contract_address: user };
    start_cheat_caller_address(user, admin);
    user_admin.set_valid_signature(action_hash, user_r, user_s, true);
    stop_cheat_caller_address(user);

    start_cheat_caller_address(executor.contract_address, user);
    let action_id = executor.submit_action(
        ActionType::Swap,
        "swap",
        nonce,
        action_hash,
        array![user_r, user_s].span()
    );
    stop_cheat_caller_address(executor.contract_address);

    start_cheat_caller_address(executor.contract_address, backend_signer);
    executor.execute_action(action_id, array![0x9, 0xa].span());
}
