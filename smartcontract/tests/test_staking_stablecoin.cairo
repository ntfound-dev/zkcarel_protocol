use core::array::ArrayTrait;
use core::traits::TryInto;
use starknet::ContractAddress;

// Import the interface and dispatchers using the absolute path from the 'smartcontract' crate
use smartcontract::staking::staking_stablecoin::{IStakingStablecoinDispatcher, IStakingStablecoinDispatcherTrait};

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

fn setup() -> (IStakingStablecoinDispatcher, ContractAddress, ContractAddress, ContractAddress) {
    let owner: ContractAddress = 0x123.try_into().unwrap();
    
    // 1. Deploy Mock Tokens
    let erc20_class = declare("ERC20Mock").unwrap().contract_class();
    let (usdt_addr, _) = erc20_class.deploy(@array![]).unwrap();
    let (reward_addr, _) = erc20_class.deploy(@array![]).unwrap();

    // 2. Deploy Staking Contract
    let staking_class = declare("StakingStablecoin").unwrap().contract_class();
    let mut constructor_args = array![];
    reward_addr.serialize(ref constructor_args);
    owner.serialize(ref constructor_args);
    
    let (staking_addr, _) = staking_class.deploy(@constructor_args).unwrap();
    let dispatcher = IStakingStablecoinDispatcher { contract_address: staking_addr };

    // 3. Register USDT as accepted token
    start_cheat_caller_address(staking_addr, owner);
    // Use the low-level call if add_stablecoin is not in the IStakingStablecoin interface
    starknet::syscalls::call_contract_syscall(
        staking_addr, 
        selector!("add_stablecoin"), 
        array![usdt_addr.into()].span()
    ).unwrap();
    stop_cheat_caller_address(staking_addr);

    (dispatcher, usdt_addr, reward_addr, owner)
}

#[test]
fn test_stake_and_reward_accumulation() {
    let (dispatcher, usdt_addr, _, _) = setup();
    let user: ContractAddress = 0x444.try_into().unwrap();
    let amount: u256 = 1000000; 
    let start_time: u64 = 1000000;

    start_cheat_block_timestamp(dispatcher.contract_address, start_time);
    start_cheat_caller_address(dispatcher.contract_address, user);
    
    dispatcher.stake(usdt_addr, amount);

    // Fast forward 1 year
    let one_year_later = start_time + 31536000;
    start_cheat_block_timestamp(dispatcher.contract_address, one_year_later);

    let pending_rewards = dispatcher.calculate_rewards(user, usdt_addr);
    // Corrected assertion syntax for custom error messages
    assert!(pending_rewards == 50000, "Reward 5% APY tidak akurat");

    stop_cheat_caller_address(dispatcher.contract_address);
    stop_cheat_block_timestamp(dispatcher.contract_address);
}

#[test]
fn test_unstake_anytime() {
    let (dispatcher, usdt_addr, _, _) = setup();
    let user: ContractAddress = 0x444.try_into().unwrap();
    let amount: u256 = 5000;

    start_cheat_caller_address(dispatcher.contract_address, user);
    
    dispatcher.stake(usdt_addr, amount);
    dispatcher.unstake(usdt_addr, amount);
    
    let current_stake = dispatcher.calculate_rewards(user, usdt_addr);
    assert!(current_stake == 0, "Saldo harusnya kosong setelah unstake");

    stop_cheat_caller_address(dispatcher.contract_address);
}

#[test]
#[should_panic(expected: "Token tidak didukung")]
fn test_stake_unaccepted_token_fails() {
    let (dispatcher, _, _, _) = setup();
    let random_token: ContractAddress = 0x999.try_into().unwrap();
    
    dispatcher.stake(random_token, 100);
}