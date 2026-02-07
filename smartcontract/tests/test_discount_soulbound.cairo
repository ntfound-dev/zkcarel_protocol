use starknet::ContractAddress;
use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, 
    start_cheat_caller_address, stop_cheat_caller_address, 
    spy_events, EventSpyAssertionsTrait
};

// Import dispatcher dan tipe data dari kontrak utama
use smartcontract::nft::discount_soulbound::{
    IDiscountSoulboundDispatcher, IDiscountSoulboundDispatcherTrait,
    ISoulboundDispatcher, ISoulboundDispatcherTrait,
    DiscountSoulbound
};

// 1. Mock PointStorage untuk isolasi testing
#[starknet::interface]
pub trait IPointStorageMock<TContractState> {
    fn consume_points(ref self: TContractState, user: ContractAddress, amount: u256);
}

#[starknet::contract]
mod PointStorageMock {
    use starknet::ContractAddress;
    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    impl IPointStorageMockImpl of super::IPointStorageMock<ContractState> {
        fn consume_points(ref self: ContractState, user: ContractAddress, amount: u256) {
            // Mock sukses tanpa logika internal
        }
    }
}

// 2. Helper function untuk setup lingkungan testing
fn setup() -> (IDiscountSoulboundDispatcher, ContractAddress) {
    // Deploy Mock PointStorage
    let mock_class = declare("PointStorageMock").unwrap().contract_class();
    let (mock_addr, _) = mock_class.deploy(@array![]).unwrap();

    // Deploy DiscountSoulbound
    let nft_class = declare("DiscountSoulbound").unwrap().contract_class();
    let mut constructor_args = array![];
    mock_addr.serialize(ref constructor_args); // point_storage_contract
    1_u64.serialize(ref constructor_args);      // current_epoch
    
    let (nft_addr, _) = nft_class.deploy(@constructor_args).unwrap();
    (IDiscountSoulboundDispatcher { contract_address: nft_addr }, mock_addr)
}

#[test]
fn test_mint_nft_and_verify_storage() {
    let (dispatcher, _) = setup();
    let user: ContractAddress = 0x123.try_into().unwrap();
    let mut spy = spy_events();

    start_cheat_caller_address(dispatcher.contract_address, user);
    
    // Mint Tier 1 (Bronze)
    dispatcher.mint_nft(1);
    
    // Verifikasi state melalui interface
    let discount = dispatcher.get_user_discount(user);
    assert!(discount == 5, "Diskon Bronze harus 5%");
    
    let nft_info = dispatcher.get_nft_info(1);
    assert!(nft_info.tier == 1, "Tier metadata salah");
    assert!(nft_info.owner == user, "Owner metadata salah");

    // Verifikasi Event emission
    spy.assert_emitted(@array![
        (
            dispatcher.contract_address,
            DiscountSoulbound::Event::NFTMinted(
                DiscountSoulbound::NFTMinted { user, token_id: 1, tier: 1 }
            )
        )
    ]);
    
    stop_cheat_caller_address(dispatcher.contract_address);
}

#[test]
fn test_usage_cycle_and_autoburn() {
    let (dispatcher, _) = setup();
    let user: ContractAddress = 0x456.try_into().unwrap();

    start_cheat_caller_address(dispatcher.contract_address, user);
    dispatcher.mint_nft(1); // Max usage = 5

    // Gunakan diskon 4 kali
    let mut i: u8 = 0;
    while i < 4 {
        dispatcher.use_discount(user);
        i += 1;
    };

    // Pastikan NFT masih ada sebelum penggunaan terakhir
    assert!(dispatcher.get_user_discount(user) == 5, "NFT harusnya masih aktif");

    // Penggunaan ke-5 (Memicu Auto-burn)
    let mut spy = spy_events();
    dispatcher.use_discount(user);

    // Verifikasi NFT sudah hangus (Default/Zero state)
    let info_after = dispatcher.get_user_discount(user);
    assert!(info_after == 0, "NFT harusnya sudah di-burn otomatis");
    
    spy.assert_emitted(@array![
        (
            dispatcher.contract_address,
            DiscountSoulbound::Event::NFTBurned(
                DiscountSoulbound::NFTBurned { user, token_id: 1 }
            )
        )
    ]);

    stop_cheat_caller_address(dispatcher.contract_address);
}

#[test]
#[should_panic(expected: "NFT ini bersifat Soulbound dan tidak dapat dipindahtangankan")]
fn test_soulbound_restriction() {
    let (dispatcher, _) = setup();
    let user: ContractAddress = 0x123.try_into().unwrap();
    let recipient: ContractAddress = 0x789.try_into().unwrap();

    start_cheat_caller_address(dispatcher.contract_address, user);
    dispatcher.mint_nft(1);
    
    // Mencoba transfer menggunakan ISoulbound interface
    let soulbound_dispatcher = ISoulboundDispatcher { contract_address: dispatcher.contract_address };
    soulbound_dispatcher.transfer(recipient, 1);
}

#[test]
#[should_panic(expected: "User sudah memiliki NFT")]
fn test_duplicate_mint_prevention() {
    let (dispatcher, _) = setup();
    let user: ContractAddress = 0x111.try_into().unwrap();

    start_cheat_caller_address(dispatcher.contract_address, user);
    dispatcher.mint_nft(1);
    dispatcher.mint_nft(2); // Harus gagal
}