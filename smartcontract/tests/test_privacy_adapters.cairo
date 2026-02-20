use core::traits::TryInto;
use starknet::ContractAddress;

use snforge_std::{
    declare, DeclareResultTrait, ContractClassTrait,
    start_cheat_caller_address, stop_cheat_caller_address
};

use smartcontract::privacy::zk_privacy_router::{
    IProofVerifierDispatcher, IProofVerifierDispatcherTrait
};
use smartcontract::privacy::mock_verifiers::{
    IMockVerifierAdminDispatcher, IMockVerifierAdminDispatcherTrait
};
use smartcontract::privacy::garaga_verifier_adapter::GaragaVerifierAdapter::{
    IGaragaVerifierModeAdminDispatcher, IGaragaVerifierModeAdminDispatcherTrait
};

#[test]
// Test case: validates garaga adapter forwards verification behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_garaga_adapter_forwards_verification() {
    let admin: ContractAddress = 0x111.try_into().unwrap();

    let mock_class = declare("MockGaragaVerifier").unwrap().contract_class();
    let mut mock_args = array![];
    admin.serialize(ref mock_args);
    true.serialize(ref mock_args);
    let (mock_address, _) = mock_class.deploy(@mock_args).unwrap();

    let adapter_class = declare("GaragaVerifierAdapter").unwrap().contract_class();
    let mut adapter_args = array![];
    admin.serialize(ref adapter_args);
    mock_address.serialize(ref adapter_args);
    let (adapter_address, _) = adapter_class.deploy(@adapter_args).unwrap();

    let mode_admin = IGaragaVerifierModeAdminDispatcher { contract_address: adapter_address };
    assert!(mode_admin.get_verification_mode() == 0, "Expected legacy mode by default");

    let dispatcher = IProofVerifierDispatcher { contract_address: adapter_address };
    assert!(dispatcher.verify_proof(array![].span(), array![].span()), "Expected proof to be valid");

    start_cheat_caller_address(mock_address, admin);
    let mock_admin = IMockVerifierAdminDispatcher { contract_address: mock_address };
    mock_admin.set_result(false);
    stop_cheat_caller_address(mock_address);

    assert!(!dispatcher.verify_proof(array![].span(), array![].span()), "Expected proof to be invalid");
}

#[test]
#[should_panic(expected: "Unsupported mode")]
// Test case: validates garaga adapter rejects unsupported mode behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_garaga_adapter_rejects_unsupported_mode() {
    let admin: ContractAddress = 0x111.try_into().unwrap();

    let mock_class = declare("MockGaragaVerifier").unwrap().contract_class();
    let mut mock_args = array![];
    admin.serialize(ref mock_args);
    true.serialize(ref mock_args);
    let (mock_address, _) = mock_class.deploy(@mock_args).unwrap();

    let adapter_class = declare("GaragaVerifierAdapter").unwrap().contract_class();
    let mut adapter_args = array![];
    admin.serialize(ref adapter_args);
    mock_address.serialize(ref adapter_args);
    let (adapter_address, _) = adapter_class.deploy(@adapter_args).unwrap();

    start_cheat_caller_address(adapter_address, admin);
    let mode_admin = IGaragaVerifierModeAdminDispatcher { contract_address: adapter_address };
    mode_admin.set_verification_mode(9);
}

#[test]
// Test case: validates tongo adapter forwards verification behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_tongo_adapter_forwards_verification() {
    let admin: ContractAddress = 0x111.try_into().unwrap();

    let mock_class = declare("MockTongoVerifier").unwrap().contract_class();
    let mut mock_args = array![];
    admin.serialize(ref mock_args);
    true.serialize(ref mock_args);
    let (mock_address, _) = mock_class.deploy(@mock_args).unwrap();

    let adapter_class = declare("TongoVerifierAdapter").unwrap().contract_class();
    let mut adapter_args = array![];
    admin.serialize(ref adapter_args);
    mock_address.serialize(ref adapter_args);
    let (adapter_address, _) = adapter_class.deploy(@adapter_args).unwrap();

    let dispatcher = IProofVerifierDispatcher { contract_address: adapter_address };
    assert!(dispatcher.verify_proof(array![].span(), array![].span()), "Expected proof to be valid");

    start_cheat_caller_address(mock_address, admin);
    let mock_admin = IMockVerifierAdminDispatcher { contract_address: mock_address };
    mock_admin.set_result(false);
    stop_cheat_caller_address(mock_address);

    assert!(!dispatcher.verify_proof(array![].span(), array![].span()), "Expected proof to be invalid");
}

#[test]
// Test case: validates semaphore adapter forwards verification behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_semaphore_adapter_forwards_verification() {
    let admin: ContractAddress = 0x111.try_into().unwrap();

    let mock_class = declare("MockSemaphoreVerifier").unwrap().contract_class();
    let mut mock_args = array![];
    admin.serialize(ref mock_args);
    true.serialize(ref mock_args);
    let (mock_address, _) = mock_class.deploy(@mock_args).unwrap();

    let adapter_class = declare("SemaphoreVerifierAdapter").unwrap().contract_class();
    let mut adapter_args = array![];
    admin.serialize(ref adapter_args);
    mock_address.serialize(ref adapter_args);
    let (adapter_address, _) = adapter_class.deploy(@adapter_args).unwrap();

    let dispatcher = IProofVerifierDispatcher { contract_address: adapter_address };
    let public_inputs = array![0x1, 0x2, 0x3];
    assert!(dispatcher.verify_proof(array![].span(), public_inputs.span()), "Expected proof to be valid");

    start_cheat_caller_address(mock_address, admin);
    let mock_admin = IMockVerifierAdminDispatcher { contract_address: mock_address };
    mock_admin.set_result(false);
    stop_cheat_caller_address(mock_address);

    assert!(!dispatcher.verify_proof(array![].span(), public_inputs.span()), "Expected proof to be invalid");
}
