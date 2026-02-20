use starknet::ContractAddress;
use snforge_std::{declare, DeclareResultTrait, ContractClassTrait, start_cheat_caller_address, stop_cheat_caller_address, spy_events, EventSpyAssertionsTrait};

// 1. Corrected imports: Include the inner structs (PointsUpdated, EpochFinalized) from the PointStorage module
use smartcontract::rewards::point_storage::{IPointStorageDispatcher, IPointStorageDispatcherTrait, PointStorage};
use smartcontract::rewards::point_storage::PointStorage::{PointsUpdated, EpochFinalized};

// Deploys point storage fixture and returns handles used by dependent test flows.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn deploy_point_storage(signer: ContractAddress) -> IPointStorageDispatcher {
    let contract = declare("PointStorage").unwrap().contract_class();
    let mut constructor_args = array![];
    constructor_args.append(signer.into());
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap();
    IPointStorageDispatcher { contract_address }
}

#[test]
// Test case: validates submit points by authorized signer behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_submit_points_by_authorized_signer() {
    let signer: ContractAddress = 0x123.try_into().unwrap();
    let dispatcher = deploy_point_storage(signer);
    let user: ContractAddress = 0x456.try_into().unwrap();
    let epoch: u64 = 1;
    let points: u256 = 1000;

    let mut spy = spy_events();

    start_cheat_caller_address(dispatcher.contract_address, signer);
    dispatcher.submit_points(epoch, user, points);
    stop_cheat_caller_address(dispatcher.contract_address);

    assert_eq!(dispatcher.get_user_points(epoch, user), points);

    // 2. Updated event assertion: Using the imported PointsUpdated struct
    spy.assert_emitted(@array![(
        dispatcher.contract_address,
        PointStorage::Event::PointsUpdated(PointsUpdated { epoch, user, points })
    )]);
}

#[test]
#[should_panic(expected: "Caller is not authorized")]
// Test case: validates submit points unauthorized behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_submit_points_unauthorized() {
    let signer: ContractAddress = 0x123.try_into().unwrap();
    let attacker: ContractAddress = 0x666.try_into().unwrap();
    let dispatcher = deploy_point_storage(signer);

    start_cheat_caller_address(dispatcher.contract_address, attacker);
    dispatcher.submit_points(1, 0x456.try_into().unwrap(), 100);
}

#[test]
// Test case: validates finalize epoch logic behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_finalize_epoch_logic() {
    let signer: ContractAddress = 0x123.try_into().unwrap();
    let dispatcher = deploy_point_storage(signer);
    let epoch: u64 = 1;
    let total_points: u256 = 50000;

    let mut spy = spy_events();

    start_cheat_caller_address(dispatcher.contract_address, signer);
    dispatcher.finalize_epoch(epoch, total_points);
    
    assert!(dispatcher.is_epoch_finalized(epoch), "Epoch should already be finalized");
    assert_eq!(dispatcher.get_global_points(epoch), total_points);

    // Verifying EpochFinalized event
    spy.assert_emitted(@array![(
        dispatcher.contract_address,
        PointStorage::Event::EpochFinalized(EpochFinalized { epoch, total_points })
    )]);
    
    stop_cheat_caller_address(dispatcher.contract_address);
}

#[test]
#[should_panic(expected: "Epoch already finalized")]
// Test case: validates submit points after finalization behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_submit_points_after_finalization() {
    let signer: ContractAddress = 0x123.try_into().unwrap();
    let dispatcher = deploy_point_storage(signer);
    let epoch: u64 = 1;

    start_cheat_caller_address(dispatcher.contract_address, signer);
    dispatcher.finalize_epoch(epoch, 1000);
    dispatcher.submit_points(epoch, 0x456.try_into().unwrap(), 500);
}
