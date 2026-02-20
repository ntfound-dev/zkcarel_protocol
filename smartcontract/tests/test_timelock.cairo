use core::traits::TryInto;
use starknet::ContractAddress;
use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait,
    start_cheat_caller_address, stop_cheat_caller_address,
    start_cheat_block_timestamp
};

// Import dispatcher and structs from the project's namespace
// Replace 'smartcontract' with the actual [package] name in your Scarb.toml
#[starknet::interface]
pub trait ITargetMock<TContractState> {
    // Implements execute logic while keeping state transitions deterministic.
    // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
    fn execute(ref self: TContractState) -> Span<felt252>;
}

use smartcontract::governance::timelock::{ITimelockDispatcher, ITimelockDispatcherTrait};

#[starknet::contract]
mod TargetMock {
    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    impl TargetMockImpl of super::ITargetMock<ContractState> {
        // Implements execute logic while keeping state transitions deterministic.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn execute(ref self: ContractState) -> Span<felt252> {
            array![].span()
        }
    }
}

// Deploys target fixture and returns handles used by dependent test flows.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn deploy_target() -> ContractAddress {
    let contract = declare("TargetMock").unwrap().contract_class();
    let (addr, _) = contract.deploy(@array![]).unwrap();
    addr
}

// Deploys timelock fixture and returns handles used by dependent test flows.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn deploy_timelock(admin: ContractAddress, min_delay: u64) -> ITimelockDispatcher {
    let contract = declare("Timelock").expect('Declaration failed');
    
    let mut constructor_calldata = array![];
    admin.serialize(ref constructor_calldata);
    min_delay.serialize(ref constructor_calldata);
    
    let (contract_address, _) = contract.contract_class().deploy(@constructor_calldata).unwrap();
    ITimelockDispatcher { contract_address }
}

#[test]
// Test case: validates queue transaction success behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_queue_transaction_success() {
    let admin: ContractAddress = 0x123.try_into().unwrap();
    let min_delay = 172800_u64; // 48 hours
    let dispatcher = deploy_timelock(admin, min_delay);
    
    let target: ContractAddress = 0x456.try_into().unwrap();
    let calldata: Span<felt252> = array![1, 2, 3].span();
    let eta = 200000_u64; // Sufficiently in the future (timestamp 0 + 200k)

    start_cheat_caller_address(dispatcher.contract_address, admin);
    let selector = selector!("execute");
    let tx_id = dispatcher.queue_transaction(target, selector, 0, calldata, eta);
    stop_cheat_caller_address(dispatcher.contract_address);

    let tx = dispatcher.get_transaction(tx_id);
    assert_eq!(tx.eta, eta);
    assert!(!tx.executed);
}

#[test]
#[should_panic(expected: "ETA below minimum delay")]
// Test case: validates queue fails below min delay behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_queue_fails_below_min_delay() {
    let admin: ContractAddress = 0x123.try_into().unwrap();
    let min_delay = 100_u64;
    let dispatcher = deploy_timelock(admin, min_delay);
    
    // ETA is only 50 seconds in the future, but min_delay is 100
    start_cheat_caller_address(dispatcher.contract_address, admin);
    let selector = selector!("execute");
    dispatcher.queue_transaction(0x456.try_into().unwrap(), selector, 0, array![].span(), 50);
    stop_cheat_caller_address(dispatcher.contract_address);
}

#[test]
// Test case: validates execute after delay behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_execute_after_delay() {
    let admin: ContractAddress = 0x123.try_into().unwrap();
    let min_delay = 100_u64;
    let dispatcher = deploy_timelock(admin, min_delay);
    
    let target: ContractAddress = deploy_target();
    let calldata: Span<felt252> = array![].span();
    let eta = 150_u64;

    start_cheat_caller_address(dispatcher.contract_address, admin);
    let selector = selector!("execute");
    let tx_id = dispatcher.queue_transaction(target, selector, 0, calldata, eta);

    // Warp time to eta
    start_cheat_block_timestamp(dispatcher.contract_address, eta);
    
    dispatcher.execute_transaction(target, selector, 0, calldata, eta);
    
    let tx = dispatcher.get_transaction(tx_id);
    assert!(tx.executed);
}

#[test]
#[should_panic(expected: "Transaction not ready")]
// Test case: validates execute fails too early behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_execute_fails_too_early() {
    let admin: ContractAddress = 0x123.try_into().unwrap();
    let min_delay = 100_u64;
    let dispatcher = deploy_timelock(admin, min_delay);
    
    let target: ContractAddress = 0x456.try_into().unwrap();
    let calldata: Span<felt252> = array![].span();
    let eta = 150_u64;

    start_cheat_caller_address(dispatcher.contract_address, admin);
    let selector = selector!("execute");
    dispatcher.queue_transaction(target, selector, 0, calldata, eta);
    
    // Current timestamp is 0, eta is 150. Execution should fail.
    dispatcher.execute_transaction(target, selector, 0, calldata, eta);
}

#[test]
// Test case: validates cancel by authorized proposer behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_cancel_by_authorized_proposer() {
    let admin: ContractAddress = 0x123.try_into().unwrap();
    let dispatcher = deploy_timelock(admin, 100);
    
    let target: ContractAddress = 0x456.try_into().unwrap();
    let eta = 150_u64;

    start_cheat_caller_address(dispatcher.contract_address, admin);
    let selector = selector!("execute");
    let tx_id = dispatcher.queue_transaction(target, selector, 0, array![].span(), eta);
    
    dispatcher.cancel_transaction(tx_id);
    
    let tx = dispatcher.get_transaction(tx_id);
    assert!(tx.canceled);
}
