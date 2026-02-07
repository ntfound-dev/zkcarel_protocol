// Import dispatcher and structs from the project's namespace
// Replace 'smartcontract' with the actual [package] name in your Scarb.toml
use smartcontract::governance::timelock::{ITimelockDispatcher, ITimelockDispatcherTrait, QueuedTransaction};

/// Helper to deploy Timelock
fn deploy_timelock(admin: ContractAddress, min_delay: u64) -> ITimelockDispatcher {
    let contract = declare("Timelock").expect('Declaration failed');
    
    let mut constructor_calldata = array![];
    admin.serialize(ref constructor_calldata);
    min_delay.serialize(ref constructor_calldata);
    
    let (contract_address, _) = contract.contract_class().deploy(@constructor_calldata).unwrap();
    ITimelockDispatcher { contract_address }
}

#[test]
fn test_queue_transaction_success() {
    let admin: ContractAddress = 0x123.try_into().unwrap();
    let min_delay = 172800_u64; // 48 hours
    let dispatcher = deploy_timelock(admin, min_delay);
    
    let target: ContractAddress = 0x456.try_into().unwrap();
    let calldata: Span<felt252> = array![1, 2, 3].span();
    let eta = 200000_u64; // Sufficiently in the future (timestamp 0 + 200k)

    start_cheat_caller_address(dispatcher.contract_address, admin);
    let tx_id = dispatcher.queue_transaction(target, 0, calldata, eta);
    stop_cheat_caller_address(dispatcher.contract_address);

    let tx = dispatcher.get_transaction(tx_id);
    assert_eq!(tx.eta, eta);
    assert!(!tx.executed);
}

#[test]
#[should_panic(expected: "ETA below minimum delay")]
fn test_queue_fails_below_min_delay() {
    let admin: ContractAddress = 0x123.try_into().unwrap();
    let min_delay = 100_u64;
    let dispatcher = deploy_timelock(admin, min_delay);
    
    // ETA is only 50 seconds in the future, but min_delay is 100
    dispatcher.queue_transaction(0x456.try_into().unwrap(), 0, array![].span(), 50);
}

#[test]
fn test_execute_after_delay() {
    let admin: ContractAddress = 0x123.try_into().unwrap();
    let min_delay = 100_u64;
    let dispatcher = deploy_timelock(admin, min_delay);
    
    let target: ContractAddress = 0x456.try_into().unwrap();
    let calldata: Span<felt252> = array![].span();
    let eta = 150_u64;

    start_cheat_caller_address(dispatcher.contract_address, admin);
    let tx_id = dispatcher.queue_transaction(target, 0, calldata, eta);

    // Warp time to eta
    start_cheat_block_timestamp(dispatcher.contract_address, eta);
    
    dispatcher.execute_transaction(target, 0, calldata, eta);
    
    let tx = dispatcher.get_transaction(tx_id);
    assert!(tx.executed);
}

#[test]
#[should_panic(expected: "Transaction not ready")]
fn test_execute_fails_too_early() {
    let admin: ContractAddress = 0x123.try_into().unwrap();
    let min_delay = 100_u64;
    let dispatcher = deploy_timelock(admin, min_delay);
    
    let target: ContractAddress = 0x456.try_into().unwrap();
    let calldata: Span<felt252> = array![].span();
    let eta = 150_u64;

    start_cheat_caller_address(dispatcher.contract_address, admin);
    dispatcher.queue_transaction(target, 0, calldata, eta);
    
    // Current timestamp is 0, eta is 150. Execution should fail.
    dispatcher.execute_transaction(target, 0, calldata, eta);
}

#[test]
fn test_cancel_by_authorized_proposer() {
    let admin: ContractAddress = 0x123.try_into().unwrap();
    let dispatcher = deploy_timelock(admin, 100);
    
    let target: ContractAddress = 0x456.try_into().unwrap();
    let eta = 150_u64;

    start_cheat_caller_address(dispatcher.contract_address, admin);
    let tx_id = dispatcher.queue_transaction(target, 0, array![].span(), eta);
    
    dispatcher.cancel_transaction(tx_id);
    
    let tx = dispatcher.get_transaction(tx_id);
    assert!(tx.canceled);
}