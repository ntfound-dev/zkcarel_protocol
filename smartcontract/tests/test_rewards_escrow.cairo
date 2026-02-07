use starknet::ContractAddress;
use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, 
    start_cheat_block_timestamp
};

// Import dispatcher dan interface
use smartcontract::rewards::rewards_escrow::{IRewardsEscrowDispatcher, IRewardsEscrowDispatcherTrait};

fn deploy_escrow() -> IRewardsEscrowDispatcher {
    let contract = declare("RewardsEscrow").expect('Declaration failed');
    let (contract_address, _) = contract.contract_class().deploy(@array![]).unwrap();
    IRewardsEscrowDispatcher { contract_address }
}

#[test]
fn test_release_vested_updates_released_amount() {
    // 1. Setup: Deploy dan buat escrow
    let dispatcher = deploy_escrow();
    let user: ContractAddress = 0x123.try_into().unwrap();
    let total_amount: u256 = 1000;
    let start_time: u64 = 1000;
    let fifteen_days: u64 = 1296000; // 50% dari durasi 30 hari

    // Set waktu awal dan buat escrow
    start_cheat_block_timestamp(dispatcher.contract_address, start_time);
    dispatcher.create_escrow(user, total_amount);

    // 2. Manipulasi Waktu: Majukan ke hari ke-15
    start_cheat_block_timestamp(dispatcher.contract_address, start_time + fifteen_days);

    // Verifikasi awal: Releasable harus 500 (50% dari 1000)
    let initial_releasable = dispatcher.get_releasable(user);
    assert_eq!(initial_releasable, 500);

    // 3. Eksekusi: Panggil release_vested
    dispatcher.release_vested(user);

    // 4. Verifikasi: 
    // Setelah rilis pada t=15 hari, get_releasable harus menjadi 0 
    // karena (vested_amount - released_amount) => (500 - 500) = 0.
    let remaining_releasable = dispatcher.get_releasable(user);
    assert_eq!(remaining_releasable, 0);

    // 5. Verifikasi Lanjutan: Majukan ke hari ke-30 (Full Vesting)
    let thirty_days: u64 = 2592000;
    start_cheat_block_timestamp(dispatcher.contract_address, start_time + thirty_days);

    // Releasable sekarang haruslah sisa 500 lagi yang belum dirilis
    let final_releasable = dispatcher.get_releasable(user);
    assert_eq!(final_releasable, 500);
}