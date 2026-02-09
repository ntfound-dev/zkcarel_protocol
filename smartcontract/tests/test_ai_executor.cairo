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
fn test_submit_action_increments_count() {
    let (dispatcher, _, user, _) = setup();
    
    start_cheat_caller_address(dispatcher.contract_address, user);
    
    let action_id = dispatcher.submit_action(
        ActionType::Swap, 
        "swap 1 ETH for STRK", 
        array![0x1].span()
    );
    
    assert!(action_id == 1, "Action ID should be 1");
    let pending = dispatcher.get_pending_actions(user);
    assert!(pending.len() == 1, "Should have 1 pending action");
}

#[test]
#[should_panic(expected: "Rate limit exceeded")]
fn test_rate_limit_enforcement() {
    let (dispatcher, _, user, _) = setup();
    
    start_cheat_caller_address(dispatcher.contract_address, user);
    
    // Explicitly type 'i' as u64 to allow comparison
    let mut i: u64 = 0;
    while i < 10 {
        dispatcher.submit_action(ActionType::Stake, "stake action", array![].span());
        i += 1;
    };
    
    dispatcher.submit_action(ActionType::Swap, "over limit", array![].span());
}

#[test]
fn test_rate_limit_resets_next_day() {
    let (dispatcher, _, user, _) = setup();
    let initial_time: u64 = 86400; 
    cheat_block_timestamp(dispatcher.contract_address, initial_time, CheatSpan::TargetCalls(15));
    
    start_cheat_caller_address(dispatcher.contract_address, user);
    
    let mut i: u64 = 0;
    while i < 10 {
        dispatcher.submit_action(ActionType::MintNFT, "mint", array![].span());
        i += 1;
    };
    
    // Jump to the next day
    cheat_block_timestamp(dispatcher.contract_address, initial_time + 86401, CheatSpan::TargetCalls(5));
    
    let new_action_id = dispatcher.submit_action(ActionType::Bridge, "bridge", array![].span());
    assert!(new_action_id == 11, "Should allow new day action");
}

#[test]
fn test_execute_action_by_authorized_backend() {
    let (dispatcher, backend, user, _) = setup();
    
    start_cheat_caller_address(dispatcher.contract_address, user);
    let action_id = dispatcher.submit_action(ActionType::MultiStep, "complex", array![].span());
    stop_cheat_caller_address(dispatcher.contract_address);
    
    start_cheat_caller_address(dispatcher.contract_address, backend);
    dispatcher.execute_action(action_id, array![0x99].span());
    
    let pending = dispatcher.get_pending_actions(user);
    assert!(pending.len() == 0, "Action should not be pending");
}

#[test]
#[should_panic(expected: "Unauthorized backend signer")]
fn test_execute_action_unauthorized_fails() {
    let (dispatcher, _, user, _) = setup();
    
    start_cheat_caller_address(dispatcher.contract_address, user);
    let action_id = dispatcher.submit_action(ActionType::Swap, "test", array![].span());
    
    dispatcher.execute_action(action_id, array![].span());
}
