use starknet::ContractAddress;
// Imports Starknet Foundry testing utilities.
use snforge_std::{declare, DeclareResultTrait, ContractClassTrait, start_cheat_caller_address, stop_cheat_caller_address};

// Imports internal project dispatcher types.
// Update package path if Scarb package name differs.
use smartcontract::core::token::{ICarelTokenDispatcher, ICarelTokenDispatcherTrait};

// Imports OpenZeppelin ERC20 ABI dispatcher for name/symbol access.
use openzeppelin::token::erc20::interface::{ERC20ABIDispatcher, ERC20ABIDispatcherTrait};

// Deploys carel token fixture and returns handles used by dependent test flows.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn deploy_carel_token(admin: ContractAddress) -> ICarelTokenDispatcher {
    let contract = declare("CarelToken").unwrap().contract_class();
    
    let mut constructor_args = array![];
    admin.serialize(ref constructor_args);
    
    let (contract_address, _) = contract.deploy(@constructor_args).unwrap();
    
    ICarelTokenDispatcher { contract_address }
}

#[test]
// Test case: validates token initialization behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_token_initialization() {
    let admin: ContractAddress = 0x1.try_into().unwrap();
    let dispatcher = deploy_carel_token(admin);
    
    // Use ERC20ABIDispatcher to access token metadata (name, symbol).
    let erc20_metadata = ERC20ABIDispatcher { contract_address: dispatcher.contract_address };
    
    // ERC20ABIDispatcherTrait must be imported for these methods to resolve.
    assert_eq!(erc20_metadata.name(), "Carel Protocol");
    assert_eq!(erc20_metadata.symbol(), "CAREL");
    assert_eq!(erc20_metadata.total_supply(), 0);
}

#[test]
// Test case: validates permissioned minting behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_permissioned_minting() {
    let admin: ContractAddress = 0x1.try_into().unwrap();
    let minter: ContractAddress = 0x2.try_into().unwrap();
    let recipient: ContractAddress = 0x3.try_into().unwrap();
    
    let dispatcher = deploy_carel_token(admin);
    let erc20 = ERC20ABIDispatcher { contract_address: dispatcher.contract_address };

    // 1. Admin grants MINTER_ROLE.
    start_cheat_caller_address(dispatcher.contract_address, admin);
    dispatcher.set_minter(minter);
    stop_cheat_caller_address(dispatcher.contract_address);

    // 2. Minter mints tokens.
    start_cheat_caller_address(dispatcher.contract_address, minter);
    let amount: u256 = 1000_u256;
    dispatcher.mint(recipient, amount);
    stop_cheat_caller_address(dispatcher.contract_address);

    // 3. Verify resulting balance.
    assert_eq!(erc20.balance_of(recipient), amount);
}

#[test]
// Use single quotes for felt252 matching to resolve "Incorrect panic data"
#[should_panic(expected: 'Caller is missing role')]
// Test case: validates unauthorized mint fails behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
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
// Test case: validates burning tokens behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
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
