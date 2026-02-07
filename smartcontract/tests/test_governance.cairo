use starknet::ContractAddress;
use core::traits::TryInto;
use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, 
    start_cheat_caller_address, stop_cheat_caller_address, 
    start_cheat_block_number
};

// Pastikan path ini sesuai dengan struktur folder src Anda
// Jika interface berada di src/governance/governance.cairo:
use smartcontract::governance::governance::{
    IGovernanceDispatcher, 
    IGovernanceDispatcherTrait, 
    Proposal
};

fn deploy_governance() -> IGovernanceDispatcher {
    // declare mengembalikan Result<DeclareResult, Array<felt252>>
    let contract = declare("Governance").expect("Declaration failed");
    let mut constructor_calldata = array![];
    
    // Gunakan trait ContractClassTrait dan DeclareResultTrait
    let (contract_address, _) = contract.contract_class().deploy(@constructor_calldata).expect("Deployment failed");
    
    IGovernanceDispatcher { contract_address }
}

#[test]
fn test_propose_action() {
    let dispatcher = deploy_governance();
    let proposer: ContractAddress = 0x123.try_into().unwrap();
    
    // start_cheat_caller_address memerlukan import dari snforge_std
    start_cheat_caller_address(dispatcher.contract_address, proposer);
    
    // Logika pengujian Anda...
    
    stop_cheat_caller_address(dispatcher.contract_address);
}