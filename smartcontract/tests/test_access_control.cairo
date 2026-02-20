use starknet::ContractAddress;
use snforge_std::{declare, ContractClassTrait, DeclareResultTrait};
use snforge_std::{start_cheat_caller_address, stop_cheat_caller_address, spy_events, EventSpyAssertionsTrait};

// Imports dispatcher using full path from the parent module.
use smartcontract::utils::access_control::{IAccessControlDispatcher, IAccessControlDispatcherTrait};
// Imports constants and contract event namespace.
use smartcontract::utils::access_control::{
    MINTER_ROLE, BURNER_ROLE, AccessControlContract
};

// Imports OpenZeppelin access-control primitives.
use openzeppelin::access::accesscontrol::DEFAULT_ADMIN_ROLE;
use openzeppelin::access::accesscontrol::AccessControlComponent::{RoleGranted, Event as ACEvent};

// Deploys access control fixture and returns handles used by dependent test flows.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn deploy_access_control(admin: ContractAddress) -> IAccessControlDispatcher {
    let contract = declare("AccessControlContract").unwrap().contract_class();
    let mut constructor_calldata = array![admin.into()];
    let (contract_address, _) = contract.deploy(@constructor_calldata).unwrap();
    IAccessControlDispatcher { contract_address }
}

#[test]
// Test case: validates constructor initializes admin behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_constructor_initializes_admin() {
    let admin: ContractAddress = 0x123.try_into().unwrap();
    let dispatcher = deploy_access_control(admin);

    assert!(dispatcher.has_role(DEFAULT_ADMIN_ROLE, admin), "Admin should have default role");
}

#[test]
// Test case: validates grant role as admin behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
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


#[test]
#[should_panic(expected: ('Caller is missing role', ))]
// Test case: validates grant role unauthorized fails behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_grant_role_unauthorized_fails() {
    let admin: ContractAddress = 0x123.try_into().unwrap();
    let non_admin: ContractAddress = 0x789.try_into().unwrap();
    let account: ContractAddress = 0x456.try_into().unwrap();
    let dispatcher = deploy_access_control(admin);

    start_cheat_caller_address(dispatcher.contract_address, non_admin);
    dispatcher.grant_role(MINTER_ROLE, account);
}

#[test]
// Test case: validates revoke role behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
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
// Test case: validates renounce role behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
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
// Test case: validates set role admin hierarchy behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
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
