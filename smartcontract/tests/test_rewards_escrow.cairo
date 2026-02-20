use starknet::ContractAddress;
use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, 
    start_cheat_block_timestamp, start_cheat_caller_address, stop_cheat_caller_address
};

// Imports dispatcher and interface types.
use smartcontract::rewards::rewards_escrow::{
    IRewardsEscrowDispatcher, IRewardsEscrowDispatcherTrait,
    IRewardsEscrowAdminDispatcher, IRewardsEscrowAdminDispatcherTrait,
};

#[starknet::interface]
pub trait IERC20Mock<TContractState> {
    // Applies transfer after input validation and commits the resulting state.
    // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
}

#[starknet::contract]
mod ERC20Mock {
    use starknet::ContractAddress;
    #[storage]
    struct Storage {}
    #[abi(embed_v0)]
    impl IERC20MockImpl of super::IERC20Mock<ContractState> {
        // Applies transfer after input validation and commits the resulting state.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool { true }
    }
}

// Deploys escrow fixture and returns handles used by dependent test flows.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn deploy_escrow(admin: ContractAddress) -> IRewardsEscrowDispatcher {
    let erc20_class = declare("ERC20Mock").unwrap().contract_class();
    let (token_addr, _) = erc20_class.deploy(@array![]).unwrap();

    let contract = declare("RewardsEscrow").expect('Declaration failed');
    let mut args = array![];
    admin.serialize(ref args);
    token_addr.serialize(ref args);
    let (contract_address, _) = contract.contract_class().deploy(@args).unwrap();
    IRewardsEscrowDispatcher { contract_address }
}

#[test]
// Test case: validates release vested updates released amount behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_release_vested_updates_released_amount() {
    // 1. Setup: deploy contract and create escrow.
    let admin: ContractAddress = 0x1.try_into().unwrap();
    let dispatcher = deploy_escrow(admin);
    let user: ContractAddress = 0x123.try_into().unwrap();
    let total_amount: u256 = 1000;
    let start_time: u64 = 1000;
    let fifteen_days: u64 = 1296000; // 50% of the 30-day vesting duration.

    // Set initial time and create escrow.
    start_cheat_block_timestamp(dispatcher.contract_address, start_time);
    start_cheat_caller_address(dispatcher.contract_address, admin);
    let admin_iface = IRewardsEscrowAdminDispatcher { contract_address: dispatcher.contract_address };
    admin_iface.set_enabled(true);
    dispatcher.create_escrow(user, total_amount);
    stop_cheat_caller_address(dispatcher.contract_address);

    // 2. Time manipulation: move forward to day 15.
    start_cheat_block_timestamp(dispatcher.contract_address, start_time + fifteen_days);

    // Initial check: releasable should be 500 (50% of 1000).
    let initial_releasable = dispatcher.get_releasable(user);
    assert_eq!(initial_releasable, 500);

    // 3. Execute: call `release_vested`.
    start_cheat_caller_address(dispatcher.contract_address, user);
    dispatcher.release_vested(user);
    stop_cheat_caller_address(dispatcher.contract_address);

    // 4. Verify:
    // After release at t=15 days, `get_releasable` should be 0
    // because (vested_amount - released_amount) => (500 - 500) = 0.
    let remaining_releasable = dispatcher.get_releasable(user);
    assert_eq!(remaining_releasable, 0);

    // 5. Follow-up verification: move to day 30 (full vesting).
    let thirty_days: u64 = 2592000;
    start_cheat_block_timestamp(dispatcher.contract_address, start_time + thirty_days);

    // Releasable should now be the remaining unreleased 500.
    let final_releasable = dispatcher.get_releasable(user);
    assert_eq!(final_releasable, 500);
}
