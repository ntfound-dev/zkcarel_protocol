use core::array::ArrayTrait;
use core::traits::TryInto;
use starknet::ContractAddress;

// Use the package name 'smartcontract' as the root for absolute paths
use smartcontract::staking::staking_lp::{ILPStakingDispatcher, ILPStakingDispatcherTrait};

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

fn setup() -> (ILPStakingDispatcher, ContractAddress, ContractAddress, ContractAddress) {
    let owner: ContractAddress = 0x111.try_into().unwrap();
    
    // 1. Deploy Mock Tokens
    let erc20_class = declare("ERC20Mock").unwrap().contract_class();
    let (lp_token, _) = erc20_class.deploy(@array![]).unwrap();
    let (reward_token, _) = erc20_class.deploy(@array![]).unwrap();

    // 2. Deploy LP Staking
    let staking_class = declare("LPStaking").unwrap().contract_class();
    let mut constructor_args = array![];
    reward_token.serialize(ref constructor_args);
    owner.serialize(ref constructor_args);
    
    let (staking_addr, _) = staking_class.deploy(@constructor_args).unwrap();
    let dispatcher = ILPStakingDispatcher { contract_address: staking_addr };

    // 3. Register Pool (18% APY = 1800 BPS)
    start_cheat_caller_address(staking_addr, owner);
    let pool_id: ContractAddress = 0x999.try_into().unwrap();
    dispatcher.add_pool(
        pool_id, 
        lp_token, 
        0x1.try_into().unwrap(), 
        0x2.try_into().unwrap(), 
        1800,                    
        5                        
    );
    stop_cheat_caller_address(staking_addr);

    (dispatcher, lp_token, pool_id, owner)
}

#[test]
fn test_lp_stake_and_reward_accuracy() {
    let (dispatcher, _, pool_id, _) = setup();
    let user: ContractAddress = 0x222.try_into().unwrap();
    let amount: u256 = 10000;
    let start_time: u64 = 100000;

    start_cheat_block_timestamp(dispatcher.contract_address, start_time);
    start_cheat_caller_address(dispatcher.contract_address, user);
    
    dispatcher.stake(pool_id, amount);

    // Simulate 1 Year
    let one_year_later = start_time + 31536000;
    start_cheat_block_timestamp(dispatcher.contract_address, one_year_later);

    let rewards = dispatcher.calculate_rewards(user, pool_id);
    assert!(rewards == 1800, "18% APY calculation mismatch");

    stop_cheat_caller_address(dispatcher.contract_address);
    stop_cheat_block_timestamp(dispatcher.contract_address);
}

#[test]
fn test_unstake_reduces_balance() {
    let (dispatcher, _, pool_id, _) = setup();
    let user: ContractAddress = 0x222.try_into().unwrap();
    let amount: u256 = 5000;

    start_cheat_caller_address(dispatcher.contract_address, user);
    dispatcher.stake(pool_id, amount);
    dispatcher.unstake(pool_id, 2000);
    
    let rewards = dispatcher.calculate_rewards(user, pool_id);
    assert!(rewards == 0, "Rewards should be zero at the same timestamp");

    stop_cheat_caller_address(dispatcher.contract_address);
}

#[test]
#[should_panic(expected: "Pool tidak aktif")]
fn test_stake_inactive_pool_fails() {
    let (dispatcher, _, _, _) = setup();
    let random_pool: ContractAddress = 0x888.try_into().unwrap();
    
    dispatcher.stake(random_pool, 100);
}

#[test]
#[should_panic(expected: "Unauthorized")]
fn test_only_owner_can_add_pool() {
    let (dispatcher, lp_token, _, _) = setup();
    let attacker: ContractAddress = 0x666.try_into().unwrap();
    
    start_cheat_caller_address(dispatcher.contract_address, attacker);
    dispatcher.add_pool(
        0x777.try_into().unwrap(), 
        lp_token, 
        0x1.try_into().unwrap(), 
        0x2.try_into().unwrap(), 
        1000, 
        1
    );
}
