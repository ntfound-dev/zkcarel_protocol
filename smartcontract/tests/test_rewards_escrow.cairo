use starknet::ContractAddress;
use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, 
    start_cheat_block_timestamp, start_cheat_caller_address, stop_cheat_caller_address
};

// Import dispatcher dan interface
use smartcontract::rewards::rewards_escrow::{
    IRewardsEscrowDispatcher, IRewardsEscrowDispatcherTrait,
    IRewardsEscrowAdminDispatcher, IRewardsEscrowAdminDispatcherTrait,
};

#[starknet::interface]
pub trait IERC20Mock<TContractState> {
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
}

#[starknet::contract]
mod ERC20Mock {
    use starknet::ContractAddress;
    #[storage]
    struct Storage {}
    #[abi(embed_v0)]
    impl IERC20MockImpl of super::IERC20Mock<ContractState> {
        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool { true }
    }
}

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
fn test_release_vested_updates_released_amount() {
    // 1. Setup: Deploy dan buat escrow
    let admin: ContractAddress = 0x1.try_into().unwrap();
    let dispatcher = deploy_escrow(admin);
    let user: ContractAddress = 0x123.try_into().unwrap();
    let total_amount: u256 = 1000;
    let start_time: u64 = 1000;
    let fifteen_days: u64 = 1296000; // 50% dari durasi 30 hari

    // Set waktu awal dan buat escrow
    start_cheat_block_timestamp(dispatcher.contract_address, start_time);
    start_cheat_caller_address(dispatcher.contract_address, admin);
    let admin_iface = IRewardsEscrowAdminDispatcher { contract_address: dispatcher.contract_address };
    admin_iface.set_enabled(true);
    dispatcher.create_escrow(user, total_amount);
    stop_cheat_caller_address(dispatcher.contract_address);

    // 2. Manipulasi Waktu: Majukan ke hari ke-15
    start_cheat_block_timestamp(dispatcher.contract_address, start_time + fifteen_days);

    // Verifikasi awal: Releasable harus 500 (50% dari 1000)
    let initial_releasable = dispatcher.get_releasable(user);
    assert_eq!(initial_releasable, 500);

    // 3. Eksekusi: Panggil release_vested
    start_cheat_caller_address(dispatcher.contract_address, user);
    dispatcher.release_vested(user);
    stop_cheat_caller_address(dispatcher.contract_address);

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
