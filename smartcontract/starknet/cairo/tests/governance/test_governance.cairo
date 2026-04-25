use starknet::ContractAddress;
use core::traits::TryInto;
use core::byte_array::ByteArray;
use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, 
    start_cheat_caller_address, stop_cheat_caller_address
};

// Ensure this import path matches your `src` folder structure.
// Interface path expected at `src/governance/governance.cairo`.
use smartcontract::governance::governance::{
    IGovernanceDispatcher,
    IGovernanceDispatcherTrait
};
use smartcontract::core::token::ICarelTokenDispatcher;

// Deploys governance fixture and returns handles used by dependent test flows.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn deploy_governance() -> IGovernanceDispatcher {
    // `declare` returns `Result<DeclareResult, Array<felt252>>`.
    let admin: ContractAddress = 0x1.try_into().unwrap();
    let token_class = declare("CarelToken").unwrap().contract_class();
    let (token_addr, _) = token_class.deploy(@array![admin.into()]).unwrap();
    let _token = ICarelTokenDispatcher { contract_address: token_addr };

    let contract = declare("Governance").expect('Declaration failed');
    let mut constructor_calldata = array![];
    1_u64.serialize(ref constructor_calldata); // voting_delay
    10_u64.serialize(ref constructor_calldata); // voting_period
    token_addr.serialize(ref constructor_calldata);
    admin.serialize(ref constructor_calldata); // owner
    1_u256.serialize(ref constructor_calldata); // quorum_votes
    
    // Uses ContractClassTrait and DeclareResultTrait for deployment.
    let (contract_address, _) = contract.contract_class().deploy(@constructor_calldata).expect('Deployment failed');
    
    IGovernanceDispatcher { contract_address }
}

#[test]
// Test case: validates propose action behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_propose_action() {
    let dispatcher = deploy_governance();
    let proposer: ContractAddress = 0x123.try_into().unwrap();
    
    // `start_cheat_caller_address` requires the `snforge_std` import.
    start_cheat_caller_address(dispatcher.contract_address, proposer);

    let targets: Span<ContractAddress> = array![].span();
    let calldatas: Span<Span<felt252>> = array![].span();
    let description: ByteArray = "Test proposal";
    let proposal_id = dispatcher.propose(targets, calldatas, description);
    assert!(proposal_id == 1, "Proposal id should start at 1");

    stop_cheat_caller_address(dispatcher.contract_address);
}
