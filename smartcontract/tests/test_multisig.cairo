use starknet::ContractAddress;
use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, 
    start_cheat_caller_address, stop_cheat_caller_address
};

// Import dispatcher and types from the project namespace
use smartcontract::utils::multisig::{IMultisigDispatcher, IMultisigDispatcherTrait, Transaction};

/// Helper to deploy the Multisig contract
fn deploy_multisig(owners: Span<ContractAddress>, required: u256) -> IMultisigDispatcher {
    let contract = declare("Multisig").expect('Declaration failed');
    
    let mut constructor_calldata = array![];
    owners.serialize(ref constructor_calldata);
    required.serialize(ref constructor_calldata);
    
    let (contract_address, _) = contract.contract_class().deploy(@constructor_calldata).unwrap();
    IMultisigDispatcher { contract_address }
}

#[test]
fn test_multisig_initialization() {
    let owner1: ContractAddress = 0x1.try_into().unwrap();
    let owner2: ContractAddress = 0x2.try_into().unwrap();
    let owners = array![owner1, owner2].span();
    let required = 2_u256;

    let dispatcher = deploy_multisig(owners, required);
    
    let active_owners = dispatcher.get_owners();
    assert_eq!(active_owners.len(), 2);
    assert_eq!(*active_owners.at(0), owner1);
    assert_eq!(*active_owners.at(1), owner2);
}

#[test]
fn test_submit_and_confirm_flow() {
    let owner1: ContractAddress = 0x1.try_into().unwrap();
    let owner2: ContractAddress = 0x2.try_into().unwrap();
    let dispatcher = deploy_multisig(array![owner1, owner2].span(), 2);
    
    let target: ContractAddress = 0x123.try_into().unwrap();
    let selector = selector!("some_function");
    let calldata = array![10, 20].span();

    // Owner 1 submits - Now passing 3 explicit arguments
    start_cheat_caller_address(dispatcher.contract_address, owner1);
    let tx_id = dispatcher.submit_transaction(target, selector, calldata);
    
    // Owner 1 confirms
    dispatcher.confirm_transaction(tx_id);
    stop_cheat_caller_address(dispatcher.contract_address);

    let tx: Transaction = dispatcher.get_transaction(tx_id);
    assert_eq!(tx.confirmations_count, 1);
    
    // Owner 2 confirms
    start_cheat_caller_address(dispatcher.contract_address, owner2);
    dispatcher.confirm_transaction(tx_id);
    stop_cheat_caller_address(dispatcher.contract_address);

    let tx_after: Transaction = dispatcher.get_transaction(tx_id);
    assert_eq!(tx_after.confirmations_count, 2);
}

#[test]
#[should_panic(expected: "Not enough confirmations")]
fn test_execute_fails_below_threshold() {
    let owner1: ContractAddress = 0x1.try_into().unwrap();
    let owner2: ContractAddress = 0x2.try_into().unwrap();
    let dispatcher = deploy_multisig(array![owner1, owner2].span(), 2);
    
    let target: ContractAddress = 0x123.try_into().unwrap();
    let selector = 0; // Dummy selector
    let calldata = array![].span();

    start_cheat_caller_address(dispatcher.contract_address, owner1);
    let tx_id = dispatcher.submit_transaction(target, selector, calldata);
    dispatcher.confirm_transaction(tx_id);
    
    // Attempt execution with only 1/2 confirmations
    dispatcher.execute_transaction(tx_id, calldata);
}

#[test]
fn test_revoke_confirmation() {
    let owner1: ContractAddress = 0x1.try_into().unwrap();
    let dispatcher = deploy_multisig(array![owner1].span(), 1);
    
    let target: ContractAddress = 0x123.try_into().unwrap();
    let selector = 0;
    
    start_cheat_caller_address(dispatcher.contract_address, owner1);
    let tx_id = dispatcher.submit_transaction(target, selector, array![].span());
    dispatcher.confirm_transaction(tx_id);
    
    dispatcher.revoke_confirmation(tx_id);
    let tx: Transaction = dispatcher.get_transaction(tx_id);
    assert_eq!(tx.confirmations_count, 0);
}

#[test]
fn test_governance_add_owner_via_multisig() {
    let owner1: ContractAddress = 0x1.try_into().unwrap();
    let new_owner: ContractAddress = 0x3.try_into().unwrap();
    let dispatcher = deploy_multisig(array![owner1].span(), 1);
    
    let target = dispatcher.contract_address;
    let selector = selector!("add_owner");
    let mut calldata = array![];
    new_owner.serialize(ref calldata);

    // 1. Submit and confirm while cheated as owner1
    start_cheat_caller_address(dispatcher.contract_address, owner1);
    let tx_id = dispatcher.submit_transaction(target, selector, calldata.span());
    dispatcher.confirm_transaction(tx_id);
    
    // 2. Execute
    // Note: If the unwrap_syscall still fails with 'Only contract can call this', 
    // it confirms that snforge is applying the cheat to the internal syscall.
    dispatcher.execute_transaction(tx_id, calldata.span());
    stop_cheat_caller_address(dispatcher.contract_address);

    let owners = dispatcher.get_owners();
    assert_eq!(owners.len(), 2);
}
