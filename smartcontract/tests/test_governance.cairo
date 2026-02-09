use starknet::ContractAddress;
use core::traits::TryInto;
use core::byte_array::ByteArray;
use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, 
    start_cheat_caller_address, stop_cheat_caller_address
};

// Pastikan path ini sesuai dengan struktur folder src Anda
// Jika interface berada di src/governance/governance.cairo:
use smartcontract::governance::governance::{
    IGovernanceDispatcher,
    IGovernanceDispatcherTrait
};

fn deploy_governance() -> IGovernanceDispatcher {
    // declare mengembalikan Result<DeclareResult, Array<felt252>>
    let contract = declare("Governance").expect('Declaration failed');
    let mut constructor_calldata = array![];
    1_u64.serialize(ref constructor_calldata); // voting_delay
    10_u64.serialize(ref constructor_calldata); // voting_period
    
    // Gunakan trait ContractClassTrait dan DeclareResultTrait
    let (contract_address, _) = contract.contract_class().deploy(@constructor_calldata).expect('Deployment failed');
    
    IGovernanceDispatcher { contract_address }
}

#[test]
fn test_propose_action() {
    let dispatcher = deploy_governance();
    let proposer: ContractAddress = 0x123.try_into().unwrap();
    
    // start_cheat_caller_address memerlukan import dari snforge_std
    start_cheat_caller_address(dispatcher.contract_address, proposer);

    let targets: Span<ContractAddress> = array![].span();
    let calldatas: Span<Span<felt252>> = array![].span();
    let description: ByteArray = "Test proposal";
    let proposal_id = dispatcher.propose(targets, calldatas, description);
    assert!(proposal_id == 1, "Proposal id should start at 1");

    stop_cheat_caller_address(dispatcher.contract_address);
}
