use starknet::ContractAddress;
use snforge_std::{
    declare, DeclareResultTrait, ContractClassTrait, 
    start_cheat_caller_address, stop_cheat_caller_address, 
    start_cheat_block_timestamp
};

// Import Dispatchers and Traits from the 'smartcontract' package
use smartcontract::core::vesting_manager::{
    IVestingManagerDispatcher, IVestingManagerDispatcherTrait, VestingCategory
};
use smartcontract::core::token::{
    ICarelTokenDispatcher, ICarelTokenDispatcherTrait
};

// Import OpenZeppelin ERC20 Dispatcher to access balance_of
use openzeppelin::token::erc20::interface::{ERC20ABIDispatcher, ERC20ABIDispatcherTrait};

/// Setup function to deploy contracts and configure roles
fn setup() -> (IVestingManagerDispatcher, ICarelTokenDispatcher, ContractAddress) {
    let admin: ContractAddress = 0x1.try_into().unwrap();
    let start_time: u64 = 1000;

    // 1. Deploy CarelToken
    let token_class = declare("CarelToken").unwrap().contract_class();
    let mut token_args = array![];
    admin.serialize(ref token_args);
    let (token_addr, _) = token_class.deploy(@token_args).unwrap();
    let token = ICarelTokenDispatcher { contract_address: token_addr };

    // 2. Deploy Vesting Manager
    let vesting_class = declare("VestingManager").unwrap().contract_class();
    let mut vesting_args = array![];
    admin.serialize(ref vesting_args);
    token_addr.serialize(ref vesting_args);
    start_time.serialize(ref vesting_args);
    
    let (vesting_addr, _) = vesting_class.deploy(@vesting_args).unwrap();
    let vesting = IVestingManagerDispatcher { contract_address: vesting_addr };

    // 3. Configure Roles: Admin grants MINTER role to VestingManager contract
    start_cheat_caller_address(token_addr, admin);
    token.set_minter(vesting_addr);
    stop_cheat_caller_address(token_addr);

    (vesting, token, admin)
}

#[test]
fn test_team_vesting_milestones() {
    let (vesting, token, admin) = setup();
    let team_member: ContractAddress = 0x2.try_into().unwrap();
    
    // Schedule: 1M tokens, 6-month cliff (15,552,000s), 36-month total (94,608,000s)
    let amount = 1_000_000_u256;
    let cliff = 15_552_000_u64;
    let duration = 94_608_000_u64;

    // Create schedule as Admin
    start_cheat_caller_address(vesting.contract_address, admin);
    vesting.create_vesting(team_member, amount, VestingCategory::Tim, cliff, duration);
    stop_cheat_caller_address(vesting.contract_address);

    // 1. Check Cliff: Time at 5 months (start_time + 13,000,000)
    // Releasable should be 0 during cliff
    start_cheat_block_timestamp(vesting.contract_address, 13001000); 
    assert_eq!(vesting.calculate_releasable(team_member), 0);

    // 2. Check Linear Release: Time at 18 months (~50% through 36 months)
    // Absolute timestamp: 1000 + 47,304,000 = 47,305,000
    start_cheat_block_timestamp(vesting.contract_address, 47305000); 
    let releasable = vesting.calculate_releasable(team_member);
    
    // Expectation: (1,000,000 * 47,304,000) / 94,608,000 = 500,000
    assert!(releasable > 499_000 && releasable < 501_000);

    // 3. Execution: Release tokens and verify minting
    vesting.release(team_member);
    
    // Create an ERC20 dispatcher to check balance
    let erc20 = ERC20ABIDispatcher { contract_address: token.contract_address };
    assert!(erc20.balance_of(team_member) == releasable);
}

#[test]
// Change 'Caller is missing role' to 'Caller is not the owner'
#[should_panic(expected: 'Caller is not the owner')]
fn test_unauthorized_vesting_creation_fails() {
    let (vesting, _, _) = setup();
    let attacker: ContractAddress = 0x666.try_into().unwrap();
    
    // Simulate an unauthorized caller
    start_cheat_caller_address(vesting.contract_address, attacker);
    
    // This call triggers self.ownable.assert_only_owner() in the contract
    vesting.create_vesting(attacker, 100, VestingCategory::Investor, 0, 100);
    
    // Execution stops at the panic above
    stop_cheat_caller_address(vesting.contract_address);
}