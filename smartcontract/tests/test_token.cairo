use starknet::ContractAddress;
// Import tool dari Starknet Foundry
use snforge_std::{declare, DeclareResultTrait, ContractClassTrait, start_cheat_caller_address, stop_cheat_caller_address};

// Import Dispatcher internal proyek
// Ganti 'smartcontract' dengan nama package Anda jika berbeda
use smartcontract::core::token::{ICarelTokenDispatcher, ICarelTokenDispatcherTrait};

// Import Dispatcher OpenZeppelin yang mendukung name() dan symbol()
use openzeppelin::token::erc20::interface::{ERC20ABIDispatcher, ERC20ABIDispatcherTrait};

/// Fungsi pembantu untuk deployment
fn deploy_carel_token(admin: ContractAddress) -> ICarelTokenDispatcher {
    let contract = declare("CarelToken").unwrap().contract_class();
    
    let mut constructor_args = array![];
    admin.serialize(ref constructor_args);
    
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap();
    
    ICarelTokenDispatcher { contract_address }
}

#[test]
fn test_token_initialization() {
    let admin: ContractAddress = 0x1.try_into().unwrap();
    let dispatcher = deploy_carel_token(admin);
    
    // Gunakan ERC20ABIDispatcher untuk mengakses Metadata (name, symbol)
    let erc20_metadata = ERC20ABIDispatcher { contract_address: dispatcher.contract_address };
    
    // ERC20ABIDispatcherTrait harus di-import agar method ini terbaca
    assert_eq!(erc20_metadata.name(), "Carel Protocol");
    assert_eq!(erc20_metadata.symbol(), "CAREL");
    assert_eq!(erc20_metadata.total_supply(), 0);
}

#[test]
fn test_permissioned_minting() {
    let admin: ContractAddress = 0x1.try_into().unwrap();
    let minter: ContractAddress = 0x2.try_into().unwrap();
    let recipient: ContractAddress = 0x3.try_into().unwrap();
    
    let dispatcher = deploy_carel_token(admin);
    let erc20 = ERC20ABIDispatcher { contract_address: dispatcher.contract_address };

    // 1. Admin memberikan MINTER_ROLE
    start_cheat_caller_address(dispatcher.contract_address, admin);
    dispatcher.set_minter(minter);
    stop_cheat_caller_address(dispatcher.contract_address);

    // 2. Minter melakukan minting token
    start_cheat_caller_address(dispatcher.contract_address, minter);
    let amount: u256 = 1000_u256;
    dispatcher.mint(recipient, amount);
    stop_cheat_caller_address(dispatcher.contract_address);

    // 3. Verifikasi saldo
    assert_eq!(erc20.balance_of(recipient), amount);
}

#[test]
// Use single quotes for felt252 matching to resolve "Incorrect panic data"
#[should_panic(expected: 'Caller is missing role')]
fn test_unauthorized_mint_fails() {
    let admin: ContractAddress = 0x1.try_into().unwrap();
    let attacker: ContractAddress = 0x666.try_into().unwrap();
    
    let dispatcher = deploy_carel_token(admin);

    start_cheat_caller_address(dispatcher.contract_address, attacker);
    dispatcher.mint(attacker, 1000_u256);
    // Panic occurs here, execution stops
    stop_cheat_caller_address(dispatcher.contract_address);
}

#[test]
fn test_burning_tokens() {
    let admin: ContractAddress = 0x1.try_into().unwrap();
    let burner: ContractAddress = 0x2.try_into().unwrap();
    // Prefix with underscore to resolve E0001: Unused variable warning
    let _user: ContractAddress = 0x3.try_into().unwrap();
    
    let dispatcher = deploy_carel_token(admin);
    let erc20 = ERC20ABIDispatcher { contract_address: dispatcher.contract_address };

    start_cheat_caller_address(dispatcher.contract_address, admin);
    dispatcher.set_minter(admin);
    dispatcher.set_burner(burner);
    dispatcher.mint(burner, 500_u256);
    stop_cheat_caller_address(dispatcher.contract_address);

    start_cheat_caller_address(dispatcher.contract_address, burner);
    dispatcher.burn(200_u256);
    stop_cheat_caller_address(dispatcher.contract_address);

    assert_eq!(erc20.balance_of(burner), 300_u256);
}