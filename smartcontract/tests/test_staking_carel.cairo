use core::array::ArrayTrait;
use core::traits::TryInto;
use starknet::ContractAddress;

// Import interface dan dispatcher
use smartcontract::staking::staking_carel::{
    IStakingCarelDispatcher, IStakingCarelDispatcherTrait, StakingCarel
};

// Import interface token CAREL
use smartcontract::core::token::{ICarelTokenDispatcher, ICarelTokenDispatcherTrait};

// Import event structs untuk spying dari modul kontrak
use smartcontract::staking::staking_carel::StakingCarel::{Staked, Unstaked, RewardsClaimed};

// Interface standar ERC20 untuk pengecekan saldo dan approval
#[starknet::interface]
pub trait IERC20<TContractState> {
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
}

use snforge_std::{
    declare, DeclareResultTrait, ContractClassTrait, 
    start_cheat_caller_address, stop_cheat_caller_address,
    start_cheat_block_timestamp, spy_events, EventSpyAssertionsTrait
};

fn setup_staking() -> (IStakingCarelDispatcher, ContractAddress, ContractAddress, ContractAddress) {
    let admin: ContractAddress = 0x123.try_into().unwrap();
    let user: ContractAddress = 0x456.try_into().unwrap();
    let reward_pool: ContractAddress = 0x789.try_into().unwrap();

    // 1. Deploy CarelToken (Constructor: multisig_admin)
    let token_class = declare("CarelToken").unwrap().contract_class();
    let mut token_calldata = array![];
    admin.serialize(ref token_calldata);
    
    let (token_addr, _) = token_class.deploy(@token_calldata).unwrap();
    let carel_token = ICarelTokenDispatcher { contract_address: token_addr };
    let erc20_token = IERC20Dispatcher { contract_address: token_addr };

    // 2. Deploy StakingCarel
    let staking_class = declare("StakingCarel").unwrap().contract_class();
    let (staking_addr, _) = staking_class.deploy(@array![token_addr.into(), reward_pool.into()]).unwrap();
    let staking = IStakingCarelDispatcher { contract_address: staking_addr };

    // 3. Grant MINTER_ROLE kepada admin untuk setup test
    start_cheat_caller_address(token_addr, admin);
    carel_token.set_minter(admin);
    
    // 4. Mint token untuk user dan reward pool
    carel_token.mint(user, 50000 * 1000000000000000000_u256);
    carel_token.mint(reward_pool, 1000000 * 1000000000000000000_u256);
    stop_cheat_caller_address(token_addr);

    // 5. Approve kontrak staking untuk menggunakan token user
    start_cheat_caller_address(token_addr, user);
    erc20_token.approve(staking_addr, 50000 * 1000000000000000000_u256);
    stop_cheat_caller_address(token_addr);

    (staking, token_addr, user, reward_pool)
}

#[test]
fn test_successful_stake_and_tier() {
    let (staking, _, user, _) = setup_staking();
    let amount = 1500 * 1000000000000000000_u256; 

    let mut spy = spy_events();

    start_cheat_caller_address(staking.contract_address, user);
    staking.stake(amount);
    stop_cheat_caller_address(staking.contract_address);

    let info = staking.get_stake_info(user);
    assert!(info.amount == amount, "Amount mismatch");
    assert!(info.tier == 2, "Tier should be 2");

    spy.assert_emitted(@array![
        (
            staking.contract_address,
            StakingCarel::Event::Staked(Staked { user, amount, tier: 2 })
        )
    ]);
}

#[test]
#[should_panic(expected: "Minimal stake adalah 100 CAREL")]
fn test_stake_below_minimum_fails() {
    let (staking, _, user, _) = setup_staking();
    let low_amount = 50 * 1000000000000000000_u256;

    start_cheat_caller_address(staking.contract_address, user);
    staking.stake(low_amount);
}

#[test]
fn test_rewards_accrual_after_one_year() {
    let (staking, _, user, _) = setup_staking();
    let one_carel: u256 = 1000000000000000000;
    let amount = 10000 * one_carel; 
    
    let start_time = 1000000;
    start_cheat_block_timestamp(staking.contract_address, start_time);

    start_cheat_caller_address(staking.contract_address, user);
    staking.stake(amount);

    let one_year_later = start_time + 31536000;
    start_cheat_block_timestamp(staking.contract_address, one_year_later);

    let expected_rewards = 1500 * one_carel;
    let actual_rewards = staking.calculate_rewards(user);
    
    assert!(actual_rewards == expected_rewards, "Reward mismatch");
}

#[test]
fn test_unstake_early_penalty() {
    let (staking, _, user, _) = setup_staking();
    let amount = 1000 * 1000000000000000000_u256;

    // Set waktu awal sebelum staking
    let start_time = 1000000;
    start_cheat_block_timestamp(staking.contract_address, start_time);

    start_cheat_caller_address(staking.contract_address, user);
    staking.stake(amount);

    // Unstake setelah 1 hari (86.400 detik) - Masih dalam periode penalti (< 7 hari)
    let unstake_time = start_time + 86400;
    start_cheat_block_timestamp(staking.contract_address, unstake_time);
    
    let mut spy = spy_events();
    staking.unstake(amount);

    // Ekspektasi penalti 10% (100 CAREL)
    let expected_penalty = 100 * 1000000000000000000_u256;
    
    spy.assert_emitted(@array![
        (
            staking.contract_address,
            StakingCarel::Event::Unstaked(Unstaked { user, amount, penalty: expected_penalty })
        )
    ]);
}

#[test]
fn test_claim_rewards_flow() {
    let (staking, token_addr, user, reward_pool) = setup_staking();
    let amount = 1000 * 1000000000000000000_u256;

    start_cheat_caller_address(staking.contract_address, user);
    staking.stake(amount);

    start_cheat_block_timestamp(staking.contract_address, 15768000);

    // Approval dari reward pool untuk mendistribusikan reward
    start_cheat_caller_address(token_addr, reward_pool);
    IERC20Dispatcher { contract_address: token_addr }.approve(staking.contract_address, 1000000 * 1000000000000000000_u256);
    stop_cheat_caller_address(token_addr);

    let mut spy = spy_events();
    start_cheat_caller_address(staking.contract_address, user);
    
    let reward_amount = staking.calculate_rewards(user);
    staking.claim_rewards();
    
    let info = staking.get_stake_info(user);
    assert!(info.accumulated_rewards == 0, "Rewards not reset");

    spy.assert_emitted(@array![
        (
            staking.contract_address,
            StakingCarel::Event::RewardsClaimed(RewardsClaimed { user, amount: reward_amount })
        )
    ]);
}
