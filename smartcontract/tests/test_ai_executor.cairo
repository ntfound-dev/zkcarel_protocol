use starknet::ContractAddress;
use core::array::ArrayTrait;
use core::traits::TryInto;
use core::serde::Serde;

use snforge_std::{
    declare, DeclareResultTrait, ContractClassTrait, 
    start_cheat_caller_address, stop_cheat_caller_address,
    cheat_block_timestamp, CheatSpan
};

// Import from 'smartcontract' package and include the DispatcherTrait
use smartcontract::ai::ai_executor::{
    IAIExecutorDispatcher, IAIExecutorDispatcherTrait, ActionType,
    IAIExecutorAdminDispatcher, IAIExecutorAdminDispatcherTrait
};

// Builds reusable fixture state and returns configured contracts for subsequent calls.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn setup() -> (IAIExecutorDispatcher, ContractAddress, ContractAddress, ContractAddress) {
    let carel_token: ContractAddress = 0x111.try_into().unwrap();
    let backend_signer: ContractAddress = 0x222.try_into().unwrap();
    let user: ContractAddress = 0x333.try_into().unwrap();

    let contract = declare("AIExecutor").unwrap().contract_class();
    let mut constructor_args = array![];
    carel_token.serialize(ref constructor_args);
    backend_signer.serialize(ref constructor_args);
    
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap();

    // Disable fees and signature verification for unit tests.
    let admin = backend_signer;
    start_cheat_caller_address(contract_address, admin);
    let admin_dispatcher = IAIExecutorAdminDispatcher { contract_address };
    admin_dispatcher.set_fee_config(1_000_000_000_000_000_000, 2_000_000_000_000_000_000, false);
    admin_dispatcher.set_signature_verification(0.try_into().unwrap(), false);
    stop_cheat_caller_address(contract_address);

    (IAIExecutorDispatcher { contract_address }, backend_signer, user, carel_token)
}

#[test]
// Test case: validates submit action increments count behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_submit_action_increments_count() {
    let (dispatcher, _, user, _) = setup();
    
    start_cheat_caller_address(dispatcher.contract_address, user);
    
    let action_id = dispatcher.submit_action(
        ActionType::Swap, 
        "swap 1 ETH for STRK", 
        0,
        array![0x1].span()
    );
    
    assert!(action_id == 1, "Action ID should be 1");
    let pending = dispatcher.get_pending_actions(user);
    assert!(pending.len() == 1, "Should have 1 pending action");
}

#[test]
#[should_panic(expected: "Rate limit exceeded")]
// Test case: validates rate limit enforcement behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_rate_limit_enforcement() {
    let (dispatcher, _, user, _) = setup();
    
    start_cheat_caller_address(dispatcher.contract_address, user);
    
    // Explicitly type 'i' as u64 to allow comparison
    let mut i: u64 = 0;
    while i < 10 {
        dispatcher.submit_action(ActionType::Stake, "stake action", 0, array![].span());
        i += 1;
    };
    
    dispatcher.submit_action(ActionType::Swap, "over limit", 0, array![].span());
}

#[test]
// Test case: validates rate limit resets next day behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_rate_limit_resets_next_day() {
    let (dispatcher, _, user, _) = setup();
    let initial_time: u64 = 86400; 
    cheat_block_timestamp(dispatcher.contract_address, initial_time, CheatSpan::TargetCalls(15));
    
    start_cheat_caller_address(dispatcher.contract_address, user);
    
    let mut i: u64 = 0;
    while i < 10 {
        dispatcher.submit_action(ActionType::MintNFT, "mint", 0, array![].span());
        i += 1;
    };
    
    // Jump to the next day
    cheat_block_timestamp(dispatcher.contract_address, initial_time + 86401, CheatSpan::TargetCalls(5));
    
    let new_action_id = dispatcher.submit_action(ActionType::Bridge, "bridge", 0, array![].span());
    assert!(new_action_id == 11, "Should allow new day action");
}

#[test]
// Test case: validates execute action by authorized backend behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_execute_action_by_authorized_backend() {
    let (dispatcher, backend, user, _) = setup();
    
    start_cheat_caller_address(dispatcher.contract_address, user);
    let action_id = dispatcher.submit_action(ActionType::MultiStep, "complex", 0, array![].span());
    stop_cheat_caller_address(dispatcher.contract_address);
    
    start_cheat_caller_address(dispatcher.contract_address, backend);
    dispatcher.execute_action(action_id, array![0x99].span());
    
    let pending = dispatcher.get_pending_actions(user);
    assert!(pending.len() == 0, "Action should not be pending");
}

#[test]
#[should_panic(expected: "Unauthorized backend signer")]
// Test case: validates execute action unauthorized fails behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_execute_action_unauthorized_fails() {
    let (dispatcher, _, user, _) = setup();
    
    start_cheat_caller_address(dispatcher.contract_address, user);
    let action_id = dispatcher.submit_action(ActionType::Swap, "test", 0, array![].span());
    
    dispatcher.execute_action(action_id, array![].span());
}

#[test]
// Test case: validates backend signer rotation behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_rotate_backend_signer_updates_executor_authority() {
    let (dispatcher, backend, user, _) = setup();
    let new_backend: ContractAddress = 0x444.try_into().unwrap();
    let admin = IAIExecutorAdminDispatcher { contract_address: dispatcher.contract_address };

    start_cheat_caller_address(dispatcher.contract_address, backend);
    admin.set_backend_signer(new_backend);
    stop_cheat_caller_address(dispatcher.contract_address);

    start_cheat_caller_address(dispatcher.contract_address, user);
    let action_id = dispatcher.submit_action(ActionType::Swap, "rotate backend", 0, array![].span());
    stop_cheat_caller_address(dispatcher.contract_address);

    start_cheat_caller_address(dispatcher.contract_address, new_backend);
    dispatcher.execute_action(action_id, array![].span());

    let pending = dispatcher.get_pending_actions(user);
    assert!(pending.len() == 0, "Action should be executed by new backend signer");
}

#[test]
#[should_panic(expected: "Unauthorized backend signer")]
// Test case: validates old backend signer loses authority after rotation behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_rotate_backend_signer_revokes_old_signer() {
    let (dispatcher, backend, user, _) = setup();
    let new_backend: ContractAddress = 0x444.try_into().unwrap();
    let admin = IAIExecutorAdminDispatcher { contract_address: dispatcher.contract_address };

    start_cheat_caller_address(dispatcher.contract_address, backend);
    admin.set_backend_signer(new_backend);
    stop_cheat_caller_address(dispatcher.contract_address);

    start_cheat_caller_address(dispatcher.contract_address, user);
    let action_id = dispatcher.submit_action(ActionType::Swap, "old backend should fail", 0, array![].span());
    stop_cheat_caller_address(dispatcher.contract_address);

    start_cheat_caller_address(dispatcher.contract_address, backend);
    dispatcher.execute_action(action_id, array![].span());
}

#[test]
// Test case: validates admin transfer behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_transfer_admin_allows_new_admin_config() {
    let (dispatcher, backend, _, _) = setup();
    let new_admin: ContractAddress = 0x555.try_into().unwrap();
    let admin = IAIExecutorAdminDispatcher { contract_address: dispatcher.contract_address };

    start_cheat_caller_address(dispatcher.contract_address, backend);
    admin.set_admin(new_admin);
    stop_cheat_caller_address(dispatcher.contract_address);

    start_cheat_caller_address(dispatcher.contract_address, new_admin);
    admin.set_rate_limit(1234);
    let current = admin.rate_limit();
    assert!(current == 1234, "New admin should be able to set rate limit");
}

#[test]
#[should_panic(expected: "Unauthorized admin")]
// Test case: validates previous admin loses permissions after transfer behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_transfer_admin_revokes_old_admin() {
    let (dispatcher, backend, _, _) = setup();
    let new_admin: ContractAddress = 0x555.try_into().unwrap();
    let admin = IAIExecutorAdminDispatcher { contract_address: dispatcher.contract_address };

    start_cheat_caller_address(dispatcher.contract_address, backend);
    admin.set_admin(new_admin);
    admin.set_rate_limit(4321);
}

#[test]
// Test case: validates batch submit and execute behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_batch_submit_and_execute() {
    let (dispatcher, backend, user, _) = setup();

    start_cheat_caller_address(dispatcher.contract_address, user);
    let start_id = dispatcher.batch_submit_actions(ActionType::Swap, "batch", 3);
    let pending = dispatcher.get_pending_actions(user);
    stop_cheat_caller_address(dispatcher.contract_address);

    assert!(start_id == 1, "Start id mismatch");
    assert!(pending.len() == 3, "Pending count mismatch");

    start_cheat_caller_address(dispatcher.contract_address, backend);
    dispatcher.batch_execute_actions(array![1, 2, 3].span(), array![].span());
    stop_cheat_caller_address(dispatcher.contract_address);

    let pending_after = dispatcher.get_pending_actions(user);
    assert!(pending_after.len() == 0, "Pending not cleared");
}

#[test]
// Test case: validates get pending actions page behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_get_pending_actions_page() {
    let (dispatcher, _, user, _) = setup();

    start_cheat_caller_address(dispatcher.contract_address, user);
    let _ = dispatcher.batch_submit_actions(ActionType::Swap, "page", 5);
    stop_cheat_caller_address(dispatcher.contract_address);

    let page1 = dispatcher.get_pending_actions_page(user, 0, 2);
    let page2 = dispatcher.get_pending_actions_page(user, 2, 2);
    let page3 = dispatcher.get_pending_actions_page(user, 4, 2);

    assert!(page1.len() == 2, "Page1 size");
    assert!(page2.len() == 2, "Page2 size");
    assert!(page3.len() == 1, "Page3 size");
}

#[test]
#[should_panic(expected: "Batch too large")]
// Test case: validates batch execute too large panics behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_batch_execute_too_large_panics() {
    let (dispatcher, backend, user, _) = setup();

    start_cheat_caller_address(dispatcher.contract_address, backend);
    let admin = IAIExecutorAdminDispatcher { contract_address: dispatcher.contract_address };
    admin.set_max_batch_execute(2);
    stop_cheat_caller_address(dispatcher.contract_address);

    start_cheat_caller_address(dispatcher.contract_address, user);
    let _ = dispatcher.batch_submit_actions(ActionType::Swap, "batch", 3);
    stop_cheat_caller_address(dispatcher.contract_address);

    start_cheat_caller_address(dispatcher.contract_address, backend);
    dispatcher.batch_execute_actions(array![1, 2, 3].span(), array![].span());
}

#[test]
#[should_panic(expected: "Too many pending actions")]
// Test case: validates max actions per user enforced behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_max_actions_per_user_enforced() {
    let (dispatcher, backend, user, _) = setup();

    start_cheat_caller_address(dispatcher.contract_address, backend);
    let admin = IAIExecutorAdminDispatcher { contract_address: dispatcher.contract_address };
    admin.set_max_actions_per_user(2);
    stop_cheat_caller_address(dispatcher.contract_address);

    start_cheat_caller_address(dispatcher.contract_address, user);
    dispatcher.submit_action(ActionType::Swap, "one", 0, array![].span());
    dispatcher.submit_action(ActionType::Swap, "two", 0, array![].span());
    dispatcher.submit_action(ActionType::Swap, "three", 0, array![].span());
}

#[test]
// Test case: validates get pending actions page limit zero returns empty behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_get_pending_actions_page_limit_zero_returns_empty() {
    let (dispatcher, _, user, _) = setup();

    start_cheat_caller_address(dispatcher.contract_address, user);
    let _ = dispatcher.batch_submit_actions(ActionType::Swap, "page", 2);
    stop_cheat_caller_address(dispatcher.contract_address);

    let page = dispatcher.get_pending_actions_page(user, 0, 0);
    assert!(page.len() == 0, "Limit zero should return empty");
}

#[test]
// Test case: validates get pending actions respects max scan behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_get_pending_actions_respects_max_scan() {
    let (dispatcher, backend, user, _) = setup();

    start_cheat_caller_address(dispatcher.contract_address, backend);
    let admin = IAIExecutorAdminDispatcher { contract_address: dispatcher.contract_address };
    admin.set_max_pending_scan(1);
    stop_cheat_caller_address(dispatcher.contract_address);

    start_cheat_caller_address(dispatcher.contract_address, user);
    let _ = dispatcher.batch_submit_actions(ActionType::Swap, "scan", 3);
    stop_cheat_caller_address(dispatcher.contract_address);

    let pending = dispatcher.get_pending_actions(user);
    assert!(pending.len() == 1, "Max scan should cap results");
}
