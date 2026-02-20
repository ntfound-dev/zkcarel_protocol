// Correct the typo: ITextTreasuryDispatcher -> ITreasuryDispatcher
use smartcontract::core::fee_collector::{FeeCollector, IFeeCollectorDispatcher, IFeeCollectorDispatcherTrait};
use smartcontract::core::treasury::{ITreasuryDispatcher, ITreasuryDispatcherTrait};
use smartcontract::core::fee_collector::FeeCollector::FeeCollected;

use snforge_std::{
    declare, DeclareResultTrait, ContractClassTrait, 
    start_cheat_caller_address, stop_cheat_caller_address, 
    spy_events, EventSpyAssertionsTrait
};
use starknet::ContractAddress;

// Builds reusable fixture state and returns configured contracts for subsequent calls.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn setup_protocol() -> (IFeeCollectorDispatcher, ITreasuryDispatcher, ContractAddress) {
    let admin: ContractAddress = 0x1.try_into().unwrap();
    
    let token_class = declare("CarelToken").unwrap().contract_class();
    let (token_addr, _) = token_class.deploy(@array![admin.into()]).unwrap();

    let treasury_class = declare("Treasury").unwrap().contract_class();
    let (treasury_addr, _) = treasury_class.deploy(@array![admin.into(), token_addr.into()]).unwrap();
    let treasury = ITreasuryDispatcher { contract_address: treasury_addr };

    let collector_class = declare("FeeCollector").unwrap().contract_class();
    let (collector_addr, _) = collector_class.deploy(@array![admin.into(), treasury_addr.into()]).unwrap();
    let collector = IFeeCollectorDispatcher { contract_address: collector_addr };

    start_cheat_caller_address(treasury_addr, admin);
    treasury.add_fee_collector(collector_addr);
    stop_cheat_caller_address(treasury_addr);

    (collector, treasury, admin)
}

#[test]
// Test case: validates collect swap fee distribution behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_collect_swap_fee_distribution() {
    let (collector, treasury, _) = setup_protocol();
    let lp_provider: ContractAddress = 0x123.try_into().unwrap();
    let swap_amount = 1_000_000_u256;
    
    collector.collect_swap_fee(swap_amount, lp_provider);

    // This method is now found because ITreasuryDispatcher and its Trait are correctly imported
    assert_eq!(treasury.get_treasury_balance(), 0); 
}

#[test]
// Test case: validates update rates only owner behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_update_rates_only_owner() {
    let (collector, _, admin) = setup_protocol();

    start_cheat_caller_address(collector.contract_address, admin);
    collector.update_fee_rates(50, 50, 20, 30, 20);
    stop_cheat_caller_address(collector.contract_address);
}

#[test]
// Use single quotes to match the felt252 (short string) panic data
#[should_panic(expected: 'Caller is not the owner')]
// Test case: validates update rates attacker fails behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_update_rates_attacker_fails() {
    let (collector, _, _) = setup_protocol();
    let attacker: ContractAddress = 0x666.try_into().unwrap();

    start_cheat_caller_address(collector.contract_address, attacker);
    collector.update_fee_rates(100, 100, 100, 100, 100);
}

#[test]
// Test case: validates bridge fee forwarding behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_bridge_fee_forwarding() {
    let (collector, _treasury, _) = setup_protocol();
    let provider: ContractAddress = 0x444.try_into().unwrap();
    let mut spy = spy_events();

    collector.collect_bridge_fee(10_000_u256, provider);

    let expected_event = FeeCollector::Event::FeeCollected(
        FeeCollected { 
            category: 'BRIDGE', 
            total_amount: 40, 
            treasury_part: 10 
        }
    );

    spy.assert_emitted(@array![(collector.contract_address, expected_event)]);
}
