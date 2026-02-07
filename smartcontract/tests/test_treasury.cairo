use starknet::ContractAddress;
use snforge_std::{
    declare, DeclareResultTrait, ContractClassTrait, 
    start_cheat_caller_address, stop_cheat_caller_address, 
    start_cheat_block_timestamp, spy_events, EventSpyAssertionsTrait
};

// Define role constants for AccessControl
pub const MINTER_ROLE: felt252 = selector!("MINTER_ROLE");
pub const BURNER_ROLE: felt252 = selector!("BURNER_ROLE");

// Interface for testing token interactions
#[starknet::interface]
pub trait ICarelTokenTest<TContractState> {
    fn mint(ref self: TContractState, recipient: ContractAddress, amount: u256);
    fn burn(ref self: TContractState, amount: u256);
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    fn grant_role(ref self: TContractState, role: felt252, account: ContractAddress);
}

// Import Treasury Dispatchers and the module for event assertions
use smartcontract::core::treasury::{ITreasuryDispatcher, ITreasuryDispatcherTrait, Treasury};

fn setup() -> (ContractAddress, ContractAddress, ITreasuryDispatcher, ICarelTokenTestDispatcher) {
    let admin: ContractAddress = 0x1.try_into().unwrap();
    
    // 1. Deploy Token
    let token_class = declare("CarelToken").unwrap().contract_class();
    let (token_addr, _) = token_class.deploy(@array![admin.into()]).unwrap();
    let token = ICarelTokenTestDispatcher { contract_address: token_addr };

    // 2. Deploy Treasury
    let treasury_class = declare("Treasury").unwrap().contract_class();
    let (treasury_addr, _) = treasury_class.deploy(@array![admin.into(), token_addr.into()]).unwrap();
    let treasury = ITreasuryDispatcher { contract_address: treasury_addr };

    // 3. Setup Roles
    start_cheat_caller_address(token_addr, admin);
    token.grant_role(MINTER_ROLE, admin);
    token.grant_role(BURNER_ROLE, treasury_addr);
    stop_cheat_caller_address(token_addr);

    (admin, treasury_addr, treasury, token)
}

#[test]
fn test_full_treasury_flow() {
    let (admin, treasury_addr, treasury, token) = setup();
    let collector: ContractAddress = 0x2.try_into().unwrap();
    let burn_amount: u256 = 1_000_000_u256;
    let initial_timestamp: u64 = 1000;

    // --- 1. Authorized Collector Setup ---
    start_cheat_caller_address(treasury_addr, admin);
    treasury.add_fee_collector(collector);
    stop_cheat_caller_address(treasury_addr);

    // --- 2. Receive Fee and Event Verification ---
    // This utilizes spy_events and EventSpyAssertionsTrait
    let mut spy = spy_events();
    start_cheat_caller_address(treasury_addr, collector);
    let fee_amount: u256 = 500;
    treasury.receive_fee(fee_amount);
    
    // This utilizes the Treasury import for event construction
    let expected_event = Treasury::Event::FeeReceived(
        Treasury::FeeReceived { from: collector, amount: fee_amount }
    );
    spy.assert_emitted(@array![(treasury_addr, expected_event)]);
    stop_cheat_caller_address(treasury_addr);

    // --- 3. Minting for Burn Setup ---
    start_cheat_caller_address(token.contract_address, admin);
    token.mint(treasury_addr, burn_amount * 2);
    stop_cheat_caller_address(token.contract_address);

    // --- 4. Burn Logic with Epochs ---
    start_cheat_block_timestamp(treasury_addr, initial_timestamp);
    start_cheat_caller_address(treasury_addr, admin);
    
    // First burn in Epoch 0
    treasury.burn_excess(burn_amount);

    // Verify time-based reset (Epoch 1)
    let epoch_duration: u64 = 2592000; 
    let next_epoch_time = initial_timestamp + epoch_duration + 1;
    start_cheat_block_timestamp(treasury_addr, next_epoch_time);
    
    // Second burn succeeds because epoch reset burned_this_epoch to 0
    treasury.burn_excess(burn_amount);
    
    let final_bal = treasury.get_treasury_balance();
    assert!(final_bal == 0, "Treasury should be empty after burns");
    
    stop_cheat_caller_address(treasury_addr);
}

#[test]
#[should_panic(expected: "Not an authorized collector")]
fn test_unauthorized_fee_fails() {
    let (_, treasury_addr, treasury, _) = setup();
    let stranger: ContractAddress = 0x999.try_into().unwrap();
    
    start_cheat_caller_address(treasury_addr, stranger);
    treasury.receive_fee(100);
}

#[test]
#[should_panic(expected: "Epoch burn quota exceeded")]
fn test_burn_quota_enforced() {
    let (admin, treasury_addr, treasury, token) = setup();
    let limit: u256 = 5_000_000_000_000_000_000_000_000_u256;
    let excess_burn: u256 = limit + 1; 

    start_cheat_caller_address(token.contract_address, admin);
    token.mint(treasury_addr, excess_burn);
    stop_cheat_caller_address(token.contract_address);

    start_cheat_caller_address(treasury_addr, admin);
    treasury.burn_excess(excess_burn);
}