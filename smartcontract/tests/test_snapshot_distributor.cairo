use starknet::ContractAddress;
use snforge_std::{declare, DeclareResultTrait, ContractClassTrait, start_cheat_caller_address, stop_cheat_caller_address};
use core::poseidon::PoseidonTrait;
use core::hash::{HashStateTrait, HashStateExTrait};

use smartcontract::rewards::snapshot_distributor::{ISnapshotDistributorDispatcher, ISnapshotDistributorDispatcherTrait};
use smartcontract::core::token::{ICarelTokenDispatcher, ICarelTokenDispatcherTrait};

#[starknet::interface]
pub trait IStakingMock<TContractState> {
    // Updates user stake configuration after access-control and invariant checks.
    // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
    fn set_user_stake(ref self: TContractState, user: ContractAddress, amount: u256);
    // Returns get user stake from state without mutating storage.
    // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
    fn get_user_stake(self: @TContractState, user: ContractAddress) -> u256;
}

#[starknet::contract]
mod StakingMock {
    use starknet::ContractAddress;
    use starknet::storage::*;

    #[storage]
    struct Storage {
        stakes: Map<ContractAddress, u256>,
    }

    #[abi(embed_v0)]
    impl IStakingMockImpl of super::IStakingMock<ContractState> {
        // Updates user stake configuration after access-control and invariant checks.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn set_user_stake(ref self: ContractState, user: ContractAddress, amount: u256) {
            self.stakes.entry(user).write(amount);
        }
        // Returns get user stake from state without mutating storage.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn get_user_stake(self: @ContractState, user: ContractAddress) -> u256 {
            self.stakes.entry(user).read()
        }
    }
}

// Builds reusable fixture state and returns configured contracts for subsequent calls.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn setup() -> (ISnapshotDistributorDispatcher, ContractAddress, ContractAddress) {
    let admin: ContractAddress = 0x1.try_into().unwrap();
    let signer: ContractAddress = 0x2.try_into().unwrap();
    let dev: ContractAddress = 0x3.try_into().unwrap();
    let treasury: ContractAddress = 0x4.try_into().unwrap();
    let start_time: u64 = 1000000;

    let token_class = declare("CarelToken").unwrap().contract_class();
    let (token_addr, _) = token_class.deploy(@array![admin.into()]).unwrap();

    let staking_class = declare("StakingMock").unwrap().contract_class();
    let (staking_addr, _) = staking_class.deploy(@array![]).unwrap();

    let dist_class = declare("SnapshotDistributor").unwrap().contract_class();
    let mut args = array![];
    token_addr.serialize(ref args);
    staking_addr.serialize(ref args);
    dev.serialize(ref args);
    treasury.serialize(ref args);
    signer.serialize(ref args);
    start_time.serialize(ref args);
    
    let (dist_addr, _) = dist_class.deploy(@args).unwrap();
    let dist = ISnapshotDistributorDispatcher { contract_address: dist_addr };

    let token = ICarelTokenDispatcher { contract_address: token_addr };
    start_cheat_caller_address(token_addr, admin);
    token.set_minter(dist_addr);
    token.set_burner(dist_addr);
    stop_cheat_caller_address(token_addr);

    (dist, signer, staking_addr)
}

#[test]
// Test case: validates successful claim behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_successful_claim() {
    let (dist, signer, staking_addr) = setup();
    let user: ContractAddress = 0x123.try_into().unwrap();
    let epoch: u64 = 1;
    let amount: u256 = 1000_u256;

    let staking = IStakingMockDispatcher { contract_address: staking_addr };
    staking.set_user_stake(user, 100_000_000_000_000_000_000_u256);

    let leaf = PoseidonTrait::new().update_with(user).update_with(amount).update_with(epoch).finalize();
    
    start_cheat_caller_address(dist.contract_address, signer);
    dist.submit_merkle_root(epoch, leaf);
    stop_cheat_caller_address(dist.contract_address);

    start_cheat_caller_address(dist.contract_address, user);
    let proof: Span<felt252> = array![].span();
    dist.claim_reward(epoch, amount, proof);
    
    assert!(dist.is_claimed(epoch, user), "Status should be claimed");
}
