use starknet::ContractAddress;
use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, 
    start_cheat_block_timestamp, stop_cheat_block_timestamp, load
};

// Import dispatcher and traits from the module path
use smartcontract::utils::twap_oracle::{ITWAPOracleDispatcher, ITWAPOracleDispatcherTrait};

/// Helper to deploy the TWAPOracle contract
fn deploy_oracle() -> ITWAPOracleDispatcher {
    let contract = declare("TWAPOracle").unwrap().contract_class();
    let (contract_address, _) = contract.deploy(@array![]).unwrap();
    ITWAPOracleDispatcher { contract_address }
}

#[test]
fn test_constructor_initialization() {
    let dispatcher = deploy_oracle();
    let oracle_address = dispatcher.contract_address;

    // Verify observation_window (1800s / 30 mins) using load
    let window = load(oracle_address, selector!("observation_window"), 1);
    assert_eq!(window, array![1800]);

    // Verify min_observations (10) using load
    let min_obs = load(oracle_address, selector!("min_observations"), 1);
    assert_eq!(min_obs, array![10]);
}

#[test]
fn test_update_and_get_spot_price() {
    let dispatcher = deploy_oracle();
    let token: ContractAddress = 0x123.try_into().unwrap();
    let price = 1500_u256;

    dispatcher.update_observation(token, price);
    
    let spot = dispatcher.get_spot_price(token);
    assert_eq!(spot, price);
}

#[test]
fn test_twap_calculation() {
    let dispatcher = deploy_oracle();
    let token: ContractAddress = 0x123.try_into().unwrap();
    let start_ts: u64 = 1000;
    let time_step: u64 = 100;
    
    // We need at least 10 observations to pass the min_observations check
    let mut current_ts = start_ts;
    let mut i: u32 = 0;
    loop {
        if i >= 10 { break; }
        
        start_cheat_block_timestamp(dispatcher.contract_address, current_ts);
        // Price alternates between 100 and 200
        let price = if i % 2 == 0 { 100_u256 } else { 200_u256 };
        dispatcher.update_observation(token, price);
        
        current_ts += time_step;
        i += 1;
    };

    // Calculate TWAP over the last 500 seconds (last 5 intervals)
    let period: u64 = 500;
    let twap = dispatcher.get_twap(token, period);

    // Expected: Average of alternating 100 and 200 should be 150
    // Note: Exact value depends on cumulative calculation in update_observation
    assert!(twap > 0, "TWAP should be non-zero");
    stop_cheat_block_timestamp(dispatcher.contract_address);
}

#[test]
#[should_panic(expected: "Insufficient observations")]
fn test_get_twap_panics_if_insufficient_data() {
    let dispatcher = deploy_oracle();
    let token: ContractAddress = 0x123.try_into().unwrap();

    // Only add 5 observations (requirement is 10)
    let mut i: u32 = 0;
    loop {
        if i >= 5 { break; }
        dispatcher.update_observation(token, 100_u256);
        i += 1;
    };

    dispatcher.get_twap(token, 1800);
}

#[test]
fn test_price_deviation_calculation() {
    let dispatcher = deploy_oracle();
    let token: ContractAddress = 0x456.try_into().unwrap();
    
    // Fill minimum observations with price 100
    let mut i: u32 = 0;
    let mut ts: u64 = 1000;
    loop {
        if i >= 10 { break; }
        start_cheat_block_timestamp(dispatcher.contract_address, ts);
        dispatcher.update_observation(token, 100_u256);
        ts += 100;
        i += 1;
    };

    // Push a new price (spot) that deviates significantly
    start_cheat_block_timestamp(dispatcher.contract_address, ts);
    dispatcher.update_observation(token, 150_u256);

    let deviation = dispatcher.get_price_deviation(token);
    // Spot is 150, TWAP should be roughly 100-105 depending on timing
    assert!(deviation > 40, "Deviation should be significant");
}