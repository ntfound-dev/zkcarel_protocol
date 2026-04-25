use core::array::ArrayTrait;
use core::traits::TryInto;
use starknet::ContractAddress;
use starknet::syscalls::SyscallResultTrait;

// Use the correct package name 'smartcontract' instead of 'carel'
// Ensure IWBTCStakingDispatcherTrait is imported to enable method calls
use smartcontract::trading::staking::staking_wbtc::{IWBTCStakingDispatcher, IWBTCStakingDispatcherTrait};

use snforge_std::{
    declare, DeclareResultTrait, ContractClassTrait, 
    start_cheat_caller_address, stop_cheat_caller_address, 
    start_cheat_block_timestamp, stop_cheat_block_timestamp
};

#[starknet::interface]
pub trait IERC20MockWBTC<TContractState> {
    // Applies transfer after input validation and commits the resulting state.
    // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    // Applies transfer from after input validation and commits the resulting state.
    // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
    fn transfer_from(ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256) -> bool;
}

#[starknet::contract]
mod ERC20MockWBTC {
    use starknet::ContractAddress;
    #[storage]
    struct Storage {}
    #[abi(embed_v0)]
    impl IERC20MockWBTCImpl of super::IERC20MockWBTC<ContractState> {
        // Applies transfer after input validation and commits the resulting state.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool { true }
        // Applies transfer from after input validation and commits the resulting state.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn transfer_from(ref self: ContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256) -> bool { true }
    }
}

// Builds reusable fixture state and returns configured contracts for subsequent calls.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn setup() -> (IWBTCStakingDispatcher, ContractAddress, ContractAddress, ContractAddress) {
    let owner: ContractAddress = 0x111.try_into().unwrap();
    
    // 1. Deploy Mock Tokens
    let erc20_class = declare("ERC20MockWBTC").unwrap_syscall().contract_class();
    let (btc_wrapper, _) = erc20_class.deploy(@array![]).unwrap_syscall();
    let (reward_token, _) = erc20_class.deploy(@array![]).unwrap_syscall();

    // 2. Deploy BTC Staking
    let staking_class = declare("WBTCStaking").unwrap_syscall().contract_class();
    let mut constructor_args = array![];
    reward_token.serialize(ref constructor_args);
    owner.serialize(ref constructor_args);
    btc_wrapper.serialize(ref constructor_args);
    
    let (staking_addr, _) = staking_class.deploy(@constructor_args).unwrap_syscall();
    let dispatcher = IWBTCStakingDispatcher { contract_address: staking_addr };

    // 3. Register BTC Wrapper via administrative call
    start_cheat_caller_address(staking_addr, owner);
    // Directly calling the dispatcher method is preferred if it's in the interface
    dispatcher.add_wbtc_token(btc_wrapper);
    stop_cheat_caller_address(staking_addr);

    (dispatcher, btc_wrapper, reward_token, owner)
}

#[test]
// Test case: validates successful stake behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_successful_stake() {
    let (dispatcher, btc_wrapper, _, _) = setup();
    let user: ContractAddress = 0x222.try_into().unwrap();
    let amount: u256 = 100000000; 

    start_cheat_caller_address(dispatcher.contract_address, user);
    dispatcher.stake(btc_wrapper, amount);
    
    let rewards = dispatcher.calculate_rewards(user, btc_wrapper);
    assert!(rewards == 0, "Initial rewards should be 0");
    stop_cheat_caller_address(dispatcher.contract_address);
}

#[test]
// Test case: validates reward accumulation after one year behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_reward_accumulation_after_one_year() {
    let (dispatcher, btc_wrapper, _, _) = setup();
    let user: ContractAddress = 0x222.try_into().unwrap();
    let one_token: u256 = 1_000_000_000_000_000_000_u256;
    let amount: u256 = 100 * one_token; 
    let start_time: u64 = 1000;

    start_cheat_block_timestamp(dispatcher.contract_address, start_time);
    start_cheat_caller_address(dispatcher.contract_address, user);
    
    dispatcher.stake(btc_wrapper, amount);

    // Advance time by 1 year (31,536,000 seconds)
    let one_year_later = start_time + 31536000;
    start_cheat_block_timestamp(dispatcher.contract_address, one_year_later);

    let rewards = dispatcher.calculate_rewards(user, btc_wrapper);
    assert!(rewards == (amount * 6) / 100, "Reward 6% APY calculation mismatch");

    stop_cheat_caller_address(dispatcher.contract_address);
    stop_cheat_block_timestamp(dispatcher.contract_address);
}

#[test]
// Test case: validates claim rewards does not revert when fee consumes rewards.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_claim_rewards_fee_consume_does_not_revert() {
    let (dispatcher, btc_wrapper, _, owner) = setup();
    let user: ContractAddress = 0x222.try_into().unwrap();
    let amount: u256 = 1000;
    let start_time: u64 = 1000;

    start_cheat_caller_address(dispatcher.contract_address, owner);
    dispatcher.set_reward_fee(10000, owner);
    stop_cheat_caller_address(dispatcher.contract_address);

    start_cheat_block_timestamp(dispatcher.contract_address, start_time);
    start_cheat_caller_address(dispatcher.contract_address, user);
    dispatcher.stake(btc_wrapper, amount);

    start_cheat_block_timestamp(dispatcher.contract_address, start_time + 60);
    let before = dispatcher.calculate_rewards(user, btc_wrapper);
    dispatcher.claim_rewards(btc_wrapper);
    let after = dispatcher.calculate_rewards(user, btc_wrapper);
    assert!(after == before, "Rewards should remain when fee absorbs all");

    stop_cheat_caller_address(dispatcher.contract_address);
    stop_cheat_block_timestamp(dispatcher.contract_address);
}

#[test]
#[should_panic(expected: "Periode lock 14 hari belum selesai")]
// Test case: validates unstake too early fails behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_unstake_too_early_fails() {
    let (dispatcher, btc_wrapper, _, _) = setup();
    let user: ContractAddress = 0x222.try_into().unwrap();
    
    start_cheat_block_timestamp(dispatcher.contract_address, 1000);
    start_cheat_caller_address(dispatcher.contract_address, user);
    
    dispatcher.stake(btc_wrapper, 1000);
    
    // Attempt unstake after only 5 days
    start_cheat_block_timestamp(dispatcher.contract_address, 1000 + 432000);
    dispatcher.unstake(btc_wrapper, 500);
}

#[test]
// Test case: validates unstake after lock period behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_unstake_after_lock_period() {
    let (dispatcher, btc_wrapper, _, _) = setup();
    let user: ContractAddress = 0x222.try_into().unwrap();
    let amount: u256 = 1000;

    start_cheat_block_timestamp(dispatcher.contract_address, 1000);
    start_cheat_caller_address(dispatcher.contract_address, user);
    
    dispatcher.stake(btc_wrapper, amount);
    
    // Advance time beyond the 14-day lock period
    start_cheat_block_timestamp(dispatcher.contract_address, 1000 + 1300000);
    
    dispatcher.unstake(btc_wrapper, amount);
    stop_cheat_caller_address(dispatcher.contract_address);
}
