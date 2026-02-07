use starknet::ContractAddress;
use snforge_std::{declare, ContractClassTrait, DeclareResultTrait};
use snforge_std::{start_cheat_caller_address, stop_cheat_caller_address, spy_events};

use smartcontract::utils::emergency_pause::{IEmergencyPauseDispatcher, IEmergencyPauseDispatcherTrait};
use smartcontract::utils::emergency_pause::EmergencyPause;
use smartcontract::utils::emergency_pause::EmergencyPause::EmergencyPaused;

fn deploy_emergency_pause(admin: ContractAddress, guardian: ContractAddress) -> IEmergencyPauseDispatcher {
    let contract = declare("EmergencyPause").unwrap().contract_class();
    let mut constructor_calldata = array![admin.into(), guardian.into()];
    let (contract_address, _) = contract.deploy(@constructor_calldata).unwrap();
    IEmergencyPauseDispatcher { contract_address }
}

#[test]
fn test_initial_state() {
    let admin: ContractAddress = 0x1.try_into().unwrap();
    let guardian: ContractAddress = 0x2.try_into().unwrap();
    let dispatcher = deploy_emergency_pause(admin, guardian);

    assert!(!dispatcher.is_paused(), "Should not be paused initially");
    let contracts = dispatcher.get_pausable_contracts();
    assert!(contracts.len() == 0, "Contract list should be empty");
}

#[test]
fn test_pause_by_guardian() {
    let admin: ContractAddress = 0x1.try_into().unwrap();
    let guardian: ContractAddress = 0x2.try_into().unwrap();
    let dispatcher = deploy_emergency_pause(admin, guardian);
    let mut _spy = spy_events();

    let reason: ByteArray = "Security Breach";
    
    start_cheat_caller_address(dispatcher.contract_address, guardian);
    dispatcher.pause_all(reason.clone());
    stop_cheat_caller_address(dispatcher.contract_address);

    assert!(dispatcher.is_paused(), "System should be paused");

    let _expected_event = EmergencyPause::Event::EmergencyPaused(
        EmergencyPaused { reason: reason, paused_at: 0 }
    );
}

#[test]
#[should_panic(expected: 'Caller is missing role')] // Fixed: Use single quotes for felt252 panic
fn test_pause_unauthorized_fails() {
    let admin: ContractAddress = 0x1.try_into().unwrap();
    let guardian: ContractAddress = 0x2.try_into().unwrap();
    let random_user: ContractAddress = 0x3.try_into().unwrap();
    let dispatcher = deploy_emergency_pause(admin, guardian);

    start_cheat_caller_address(dispatcher.contract_address, random_user);
    dispatcher.pause_all("Attempt");
}

#[test]
fn test_unpause_by_admin() {
    let admin: ContractAddress = 0x1.try_into().unwrap();
    let guardian: ContractAddress = 0x2.try_into().unwrap();
    let dispatcher = deploy_emergency_pause(admin, guardian);

    start_cheat_caller_address(dispatcher.contract_address, guardian);
    dispatcher.pause_all("Maintenance");
    stop_cheat_caller_address(dispatcher.contract_address);

    start_cheat_caller_address(dispatcher.contract_address, admin);
    dispatcher.unpause_all();
    stop_cheat_caller_address(dispatcher.contract_address);

    assert!(!dispatcher.is_paused(), "System should be unpaused");
}

#[test]
fn test_manage_pausable_contracts() {
    let admin: ContractAddress = 0x1.try_into().unwrap();
    let guardian: ContractAddress = 0x2.try_into().unwrap();
    let target_contract: ContractAddress = 0x99.try_into().unwrap();
    let dispatcher = deploy_emergency_pause(admin, guardian);

    start_cheat_caller_address(dispatcher.contract_address, admin);
    
    dispatcher.add_pausable_contract(target_contract);
    let contracts = dispatcher.get_pausable_contracts();
    assert!(contracts.len() == 1, "Should have 1 contract");

    dispatcher.remove_pausable_contract(target_contract);
    let contracts_after = dispatcher.get_pausable_contracts();
    assert!(contracts_after.len() == 0, "Should be empty after removal");
    
    stop_cheat_caller_address(dispatcher.contract_address);
}

#[test]
#[should_panic(expected: "System already paused")]
fn test_double_pause_fails() {
    let admin: ContractAddress = 0x1.try_into().unwrap();
    let guardian: ContractAddress = 0x2.try_into().unwrap();
    let dispatcher = deploy_emergency_pause(admin, guardian);

    start_cheat_caller_address(dispatcher.contract_address, guardian);
    dispatcher.pause_all("Reason 1");
    dispatcher.pause_all("Reason 2");
}