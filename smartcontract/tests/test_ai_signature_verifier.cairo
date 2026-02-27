use starknet::ContractAddress;
use core::array::ArrayTrait;
use core::serde::Serde;
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
    let (executor_address, _) = executor_class.deploy(@executor_args).unwrap();

    let admin_exec = IAIExecutorAdminDispatcher { contract_address: executor_address };
    start_cheat_caller_address(executor_address, backend_signer);
    admin_exec.set_fee_config(1_000_000_000_000_000_000, 2_000_000_000_000_000_000, false);
    admin_exec.set_signature_verification(verifier_address, true);
    stop_cheat_caller_address(executor_address);

    (
        IAIExecutorDispatcher { contract_address: executor_address },
        admin,
        verifier_address,
        backend_signer,
        user
    )
}

#[test]
// Test case: validates ai executor signature verification with account is_valid_signature behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_ai_executor_signature_verification_with_account_signature() {
    let (executor, admin, _, _, user) = setup_with_signature_verifier();

    let message_hash: felt252 = 0xabc;
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
        message_hash,
        array![r, s].span()
    );
    assert!(action_id == 1, "Action should be accepted with valid account signature");
}

#[test]
#[should_panic(expected: "Invalid user signature")]
// Test case: validates ai executor rejects replay signature hash behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_ai_executor_rejects_replay_signature_hash() {
    let (executor, admin, _, _, user) = setup_with_signature_verifier();

    let message_hash: felt252 = 0xdef;
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
        message_hash,
        array![r, s].span()
    );

    // Reusing identical hash+signature should fail because verifier consumes hash.
    executor.submit_action(
        ActionType::Swap,
        "swap 1 BTC to STRK",
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

    let message_hash: felt252 = 0x999;
    let r: felt252 = 0xaaa;
    let s: felt252 = 0xbbb;

    start_cheat_caller_address(executor.contract_address, user);
    executor.submit_action(
        ActionType::Swap,
        "swap",
        message_hash,
        array![r, s].span()
    );
}

#[test]
// Test case: validates ai executor execute_action accepts valid backend account signature behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_ai_executor_execute_action_accepts_valid_backend_signature() {
    let (executor, admin, _, backend_signer, user) = setup_with_signature_verifier();

    let action_hash: felt252 = 0x4444;
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

    let action_hash: felt252 = 0x5555;
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
        action_hash,
        array![user_r, user_s].span()
    );
    stop_cheat_caller_address(executor.contract_address);

    start_cheat_caller_address(executor.contract_address, backend_signer);
    executor.execute_action(action_id, array![0x9, 0xa].span());
}
