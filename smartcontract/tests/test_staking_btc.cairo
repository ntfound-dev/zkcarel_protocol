use core::array::ArrayTrait;
use core::traits::TryInto;
use starknet::ContractAddress;

// Use the correct package name 'smartcontract' instead of 'carel'
// Ensure IBTCStakingDispatcherTrait is imported to enable method calls
use smartcontract::staking::staking_btc::{IBTCStakingDispatcher, IBTCStakingDispatcherTrait};

use snforge_std::{
    declare, DeclareResultTrait, ContractClassTrait, 
    start_cheat_caller_address, stop_cheat_caller_address, 
    start_cheat_block_timestamp, stop_cheat_block_timestamp
};

#[starknet::interface]
pub trait IERC20Mock<TContractState> {
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256) -> bool;
}

#[starknet::contract]
mod ERC20Mock {
    use starknet::ContractAddress;
    #[storage]
    struct Storage {}
    #[abi(embed_v0)]
    impl IERC20MockImpl of super::IERC20Mock<ContractState> {
        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool { true }
        fn transfer_from(ref self: ContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256) -> bool { true }
    }
}

fn setup() -> (IBTCStakingDispatcher, ContractAddress, ContractAddress, ContractAddress) {
    let owner: ContractAddress = 0x111.try_into().unwrap();
    
    // 1. Deploy Mock Tokens
    let erc20_class = declare("ERC20Mock").unwrap().contract_class();
    let (btc_wrapper, _) = erc20_class.deploy(@array![]).unwrap();
    let (reward_token, _) = erc20_class.deploy(@array![]).unwrap();

    // 2. Deploy BTC Staking
    let staking_class = declare("BTCStaking").unwrap().contract_class();
    let mut constructor_args = array![];
    reward_token.serialize(ref constructor_args);
    owner.serialize(ref constructor_args);
    
    let (staking_addr, _) = staking_class.deploy(@constructor_args).unwrap();
    let dispatcher = IBTCStakingDispatcher { contract_address: staking_addr };

    // 3. Register BTC Wrapper via administrative call
    start_cheat_caller_address(staking_addr, owner);
    // Directly calling the dispatcher method is preferred if it's in the interface
    dispatcher.add_btc_token(btc_wrapper);
    stop_cheat_caller_address(staking_addr);

    (dispatcher, btc_wrapper, reward_token, owner)
}

#[test]
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
fn test_reward_accumulation_after_one_year() {
    let (dispatcher, btc_wrapper, _, _) = setup();
    let user: ContractAddress = 0x222.try_into().unwrap();
    let amount: u256 = 10000; 
    let start_time: u64 = 1000;

    start_cheat_block_timestamp(dispatcher.contract_address, start_time);
    start_cheat_caller_address(dispatcher.contract_address, user);
    
    dispatcher.stake(btc_wrapper, amount);

    // Advance time by 1 year (31,536,000 seconds)
    let one_year_later = start_time + 31536000;
    start_cheat_block_timestamp(dispatcher.contract_address, one_year_later);

    let rewards = dispatcher.calculate_rewards(user, btc_wrapper);
    assert!(rewards == 1200, "Reward 12% APY calculation mismatch");

    stop_cheat_caller_address(dispatcher.contract_address);
    stop_cheat_block_timestamp(dispatcher.contract_address);
}

#[test]
#[should_panic(expected: "Periode lock 14 hari belum selesai")]
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