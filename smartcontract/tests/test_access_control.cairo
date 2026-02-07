use starknet::ContractAddress;
use snforge_std::{declare, ContractClassTrait, DeclareResultTrait};
use snforge_std::{start_cheat_caller_address, stop_cheat_caller_address, spy_events, EventSpyAssertionsTrait};

// Import dispatcher menggunakan full path dari parent module
use smartcontract::utils::access_control::{IAccessControlDispatcher, IAccessControlDispatcherTrait};
// Import konstanta dan kontrak
use smartcontract::utils::access_control::{
    MINTER_ROLE, BURNER_ROLE, AccessControlContract
};

// Import dari OpenZeppelin
use openzeppelin::access::accesscontrol::DEFAULT_ADMIN_ROLE;
use openzeppelin::access::accesscontrol::AccessControlComponent::{RoleGranted, Event as ACEvent};

fn deploy_access_control(admin: ContractAddress) -> IAccessControlDispatcher {
    let contract = declare("AccessControlContract").unwrap().contract_class();
    let mut constructor_calldata = array![admin.into()];
    let (contract_address, _) = contract.deploy(@constructor_calldata).unwrap();
    IAccessControlDispatcher { contract_address }
}

#[test]
fn test_constructor_initializes_admin() {
    let admin: ContractAddress = 0x123.try_into().unwrap();
    let dispatcher = deploy_access_control(admin);

    assert!(dispatcher.has_role(DEFAULT_ADMIN_ROLE, admin), "Admin should have default role");
}

#[test]
fn test_grant_role_as_admin() {
    let admin: ContractAddress = 0x123.try_into().unwrap();
    let minter: ContractAddress = 0x456.try_into().unwrap();
    let dispatcher = deploy_access_control(admin);
    let mut spy = spy_events();

    start_cheat_caller_address(dispatcher.contract_address, admin);
    dispatcher.grant_role(MINTER_ROLE, minter);
    stop_cheat_caller_address(dispatcher.contract_address);

    assert!(dispatcher.has_role(MINTER_ROLE, minter), "Minter role not granted");

    let expected_event = AccessControlContract::Event::AccessControlEvent(
        ACEvent::RoleGranted(RoleGranted { role: MINTER_ROLE, account: minter, sender: admin })
    );

    spy.assert_emitted(@array![
        (dispatcher.contract_address, expected_event)
    ]);
}

// PERBAIKAN: Gunakan format tuple ('...', ) untuk mencocokkan panic bertipe felt252 array
#[test]
#[should_panic(expected: ('Caller is missing role', ))]
fn test_grant_role_unauthorized_fails() {
    let admin: ContractAddress = 0x123.try_into().unwrap();
    let non_admin: ContractAddress = 0x789.try_into().unwrap();
    let account: ContractAddress = 0x456.try_into().unwrap();
    let dispatcher = deploy_access_control(admin);

    start_cheat_caller_address(dispatcher.contract_address, non_admin);
    dispatcher.grant_role(MINTER_ROLE, account);
}

#[test]
fn test_revoke_role() {
    let admin: ContractAddress = 0x123.try_into().unwrap();
    let minter: ContractAddress = 0x456.try_into().unwrap();
    let dispatcher = deploy_access_control(admin);

    start_cheat_caller_address(dispatcher.contract_address, admin);
    dispatcher.grant_role(MINTER_ROLE, minter);
    assert!(dispatcher.has_role(MINTER_ROLE, minter), "Should have role before");
    
    dispatcher.revoke_role(MINTER_ROLE, minter);
    assert!(!dispatcher.has_role(MINTER_ROLE, minter), "Role should be revoked");
    stop_cheat_caller_address(dispatcher.contract_address);
}

#[test]
fn test_renounce_role() {
    let admin: ContractAddress = 0x123.try_into().unwrap();
    let minter: ContractAddress = 0x456.try_into().unwrap();
    let dispatcher = deploy_access_control(admin);

    start_cheat_caller_address(dispatcher.contract_address, admin);
    dispatcher.grant_role(MINTER_ROLE, minter);
    stop_cheat_caller_address(dispatcher.contract_address);

    start_cheat_caller_address(dispatcher.contract_address, minter);
    dispatcher.renounce_role(MINTER_ROLE, minter);
    stop_cheat_caller_address(dispatcher.contract_address);

    assert!(!dispatcher.has_role(MINTER_ROLE, minter), "Role not renounced");
}

#[test]
fn test_set_role_admin_hierarchy() {
    let admin: ContractAddress = 0x123.try_into().unwrap();
    let custom_admin: ContractAddress = 0x999.try_into().unwrap();
    let account: ContractAddress = 0x456.try_into().unwrap();
    let dispatcher = deploy_access_control(admin);

    start_cheat_caller_address(dispatcher.contract_address, admin);
    dispatcher.set_role_admin(MINTER_ROLE, BURNER_ROLE);
    dispatcher.grant_role(BURNER_ROLE, custom_admin);
    stop_cheat_caller_address(dispatcher.contract_address);

    start_cheat_caller_address(dispatcher.contract_address, custom_admin);
    dispatcher.grant_role(MINTER_ROLE, account);
    stop_cheat_caller_address(dispatcher.contract_address);

    assert!(dispatcher.has_role(MINTER_ROLE, account), "Hierarchy failed");
}