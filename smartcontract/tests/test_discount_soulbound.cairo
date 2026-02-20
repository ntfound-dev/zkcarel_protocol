use starknet::ContractAddress;
use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, 
    start_cheat_caller_address, stop_cheat_caller_address, 
    spy_events, EventSpyAssertionsTrait
};

// Imports dispatcher types from the main contract.
use smartcontract::nft::discount_soulbound::{
    IDiscountSoulboundDispatcher, IDiscountSoulboundDispatcherTrait,
    ISoulboundDispatcher, ISoulboundDispatcherTrait,
    DiscountSoulbound
};

// 1. Mock PointStorage for isolated tests.
#[starknet::interface]
pub trait IPointStorageMock<TContractState> {
    // Applies consume points after input validation and commits the resulting state.
    // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
    fn consume_points(ref self: TContractState, epoch: u64, user: ContractAddress, amount: u256);
}

#[starknet::contract]
mod PointStorageMock {
    use starknet::ContractAddress;
    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    impl IPointStorageMockImpl of super::IPointStorageMock<ContractState> {
        // Applies consume points after input validation and commits the resulting state.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn consume_points(ref self: ContractState, epoch: u64, user: ContractAddress, amount: u256) {
            // Successful no-op mock with no internal logic.
        }
    }
}

// Builds reusable fixture state and returns configured contracts for subsequent calls.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
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
// Test case: validates mint nft and verify storage behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_mint_nft_and_verify_storage() {
    let (dispatcher, _) = setup();
    let user: ContractAddress = 0x123.try_into().unwrap();
    let mut spy = spy_events();

    start_cheat_caller_address(dispatcher.contract_address, user);
    
    // Mint Tier 1 (Bronze)
    dispatcher.mint_nft(1);
    
    // Verify state via interface.
    let discount = dispatcher.get_user_discount(user);
    assert!(discount == 5, "Bronze discount should be 5%");
    
    let nft_info = dispatcher.get_nft_info(1);
    assert!(nft_info.tier == 1, "Tier metadata mismatch");
    assert!(nft_info.owner == user, "Owner metadata mismatch");

    // Verify event emission.
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
// Test case: validates usage cycle and autoburn behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_usage_cycle_and_autoburn() {
    let (dispatcher, _) = setup();
    let user: ContractAddress = 0x456.try_into().unwrap();

    start_cheat_caller_address(dispatcher.contract_address, user);
    dispatcher.mint_nft(1); // Default max usage = 30

    // Use up default tier-1 limit (30)
    dispatcher.use_discount_batch(user, 30);
    assert!(dispatcher.get_user_discount(user) == 0, "Usage exhausted should disable discount");

    // Recharge and use again
    dispatcher.recharge_nft();
    assert!(dispatcher.get_user_discount(user) == 5, "Recharge should restore discount");
    dispatcher.use_discount(user);

    stop_cheat_caller_address(dispatcher.contract_address);
}

#[test]
#[should_panic(expected: "NFT ini bersifat Soulbound dan tidak dapat dipindahtangankan")]
// Test case: validates soulbound restriction behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_soulbound_restriction() {
    let (dispatcher, _) = setup();
    let user: ContractAddress = 0x123.try_into().unwrap();
    let recipient: ContractAddress = 0x789.try_into().unwrap();

    start_cheat_caller_address(dispatcher.contract_address, user);
    dispatcher.mint_nft(1);
    
    // Attempt transfer through the ISoulbound interface.
    let soulbound_dispatcher = ISoulboundDispatcher { contract_address: dispatcher.contract_address };
    soulbound_dispatcher.transfer(recipient, 1);
}

#[test]
#[should_panic(expected: "User sudah memiliki NFT")]
// Test case: validates duplicate mint prevention behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_duplicate_mint_prevention() {
    let (dispatcher, _) = setup();
    let user: ContractAddress = 0x111.try_into().unwrap();

    start_cheat_caller_address(dispatcher.contract_address, user);
    dispatcher.mint_nft(1);
    dispatcher.mint_nft(2); // Must fail.
}
