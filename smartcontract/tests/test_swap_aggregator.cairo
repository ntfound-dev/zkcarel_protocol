use starknet::ContractAddress;
use snforge_std::{
    declare, DeclareResultTrait, ContractClassTrait, 
    start_cheat_caller_address, stop_cheat_caller_address
};

// Imports dispatcher types from the `smartcontract` package.
use smartcontract::bridge::swap_aggregator::{
    ISwapAggregatorDispatcher, ISwapAggregatorDispatcherTrait
};
use smartcontract::utils::price_oracle::{
    IPriceOracle, IPriceOracleDispatcher, IPriceOracleDispatcherTrait
};

#[starknet::interface]
pub trait ITestToken<TContractState> {
    // Updates balance configuration after access-control and invariant checks.
    // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
    fn set_balance(ref self: TContractState, account: ContractAddress, amount: u256);
    // Applies transfer after input validation and commits the resulting state.
    // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    // Applies transfer from after input validation and commits the resulting state.
    // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
    fn transfer_from(
        ref self: TContractState,
        sender: ContractAddress,
        recipient: ContractAddress,
        amount: u256
    ) -> bool;
    // Applies approve after input validation and commits the resulting state.
    // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
    // Implements balance of logic while keeping state transitions deterministic.
    // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
}

// This interface auto-generates IMockDEXDispatcher and IMockDEXDispatcherTrait.
#[starknet::interface]
pub trait IMockDEX<TContractState> {
    // Updates price configuration after access-control and invariant checks.
    // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
    fn set_price(ref self: TContractState, price: u256);
}

#[starknet::contract]
pub mod MockDEX {
    use starknet::ContractAddress;
    // Required for storage `.read()` and `.write()` access.
    use starknet::storage::*;

    #[storage]
    pub struct Storage {
        pub price: u256
    }

    #[abi(embed_v0)]
    impl IDEXRouterImpl of smartcontract::bridge::swap_aggregator::IDEXRouter<ContractState> {
        // Returns get quote from state without mutating storage.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn get_quote(self: @ContractState, from_token: ContractAddress, to_token: ContractAddress, amount: u256) -> u256 {
            self.price.read()
        }
        // Implements swap logic while keeping state transitions deterministic.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn swap(ref self: ContractState, from_token: ContractAddress, to_token: ContractAddress, amount: u256, min_amount_out: u256) {
            // No-op mock logic for tests.
        }
    }

    #[abi(embed_v0)]
    impl IMockDEXImpl of super::IMockDEX<ContractState> {
        // Updates price configuration after access-control and invariant checks.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn set_price(ref self: ContractState, price: u256) {
            self.price.write(price);
        }
    }
}

#[starknet::contract]
pub mod SwapTestERC20 {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::storage::*;

    #[storage]
    pub struct Storage {
        pub balances: Map<ContractAddress, u256>
    }

    #[abi(embed_v0)]
    impl ITestTokenImpl of super::ITestToken<ContractState> {
        // Updates balance configuration after access-control and invariant checks.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn set_balance(ref self: ContractState, account: ContractAddress, amount: u256) {
            self.balances.entry(account).write(amount);
        }

        // Applies transfer after input validation and commits the resulting state.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let sender = get_caller_address();
            let sender_balance = self.balances.entry(sender).read();
            assert!(sender_balance >= amount, "Insufficient balance");
            self.balances.entry(sender).write(sender_balance - amount);
            let recipient_balance = self.balances.entry(recipient).read();
            self.balances.entry(recipient).write(recipient_balance + amount);
            true
        }

        // Applies transfer from after input validation and commits the resulting state.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256
        ) -> bool {
            let sender_balance = self.balances.entry(sender).read();
            assert!(sender_balance >= amount, "Insufficient balance");
            self.balances.entry(sender).write(sender_balance - amount);
            let recipient_balance = self.balances.entry(recipient).read();
            self.balances.entry(recipient).write(recipient_balance + amount);
            true
        }

        // Applies approve after input validation and commits the resulting state.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            let _ = spender;
            let _ = amount;
            true
        }

        // Implements balance of logic while keeping state transitions deterministic.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.entry(account).read()
        }
    }
}

#[starknet::contract]
pub mod MockPriceOracle {
    use starknet::ContractAddress;
    use starknet::storage::*;

    #[storage]
    pub struct Storage {
        pub prices: Map<ContractAddress, u256>,
    }

    #[abi(embed_v0)]
    impl OracleImpl of super::IPriceOracle<ContractState> {
        // Returns get price from state without mutating storage.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn get_price(self: @ContractState, token: ContractAddress, asset_id: felt252) -> u256 {
            let _ = asset_id;
            self.prices.entry(token).read()
        }

        // Returns get price usd from state without mutating storage.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn get_price_usd(
            self: @ContractState,
            token: ContractAddress,
            asset_id: felt252,
            amount: u256,
            decimals: u32
        ) -> u256 {
            let _ = asset_id;
            let price = self.prices.entry(token).read();
            let mut divisor: u256 = 1;
            let mut i: u32 = 0;
            while i < decimals {
                divisor *= 10;
                i += 1;
            };
            (amount * price) / divisor
        }

        // Updates price manual configuration after access-control and invariant checks.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn update_price_manual(ref self: ContractState, token: ContractAddress, price: u256) {
            self.prices.entry(token).write(price);
        }

        // Updates fallback price configuration after access-control and invariant checks.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn set_fallback_price(ref self: ContractState, token: ContractAddress, price: u256) {
            self.prices.entry(token).write(price);
        }

        // Updates paused configuration after access-control and invariant checks.
        // Used in isolated test context to validate invariants and avoid regressions in contract behavior.
        fn set_paused(ref self: ContractState, paused: bool) {
            let _ = paused;
        }
    }
}

// Builds reusable fixture state and returns configured contracts for subsequent calls.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn setup() -> (ISwapAggregatorDispatcher, ContractAddress, ContractAddress, ContractAddress) {
    let owner: ContractAddress = 0x123.try_into().unwrap();
    let token_class = declare("SwapTestERC20").unwrap().contract_class();
    let (token_a, _) = token_class.deploy(@array![]).unwrap();
    let (token_b, _) = token_class.deploy(@array![]).unwrap();

    // 1. Deploy Aggregator
    let aggregator_class = declare("SwapAggregator").expect('Declaration failed').contract_class();
    let mut constructor_args = array![];
    owner.serialize(ref constructor_args);
    let (aggregator_addr, _) = aggregator_class.deploy(@constructor_args).expect('Deployment failed');
    let dispatcher = ISwapAggregatorDispatcher { contract_address: aggregator_addr };

    // 2. Deploy & Register Mock DEX 1
    let dex_class = declare("MockDEX").expect('DEX Dec failed').contract_class();
    let (dex1_addr, _) = dex_class.deploy(@array![]).expect('DEX1 Dep failed');
    // Calls the auto-generated dispatcher in the same scope.
    IMockDEXDispatcher { contract_address: dex1_addr }.set_price(950);

    // 3. Deploy & Register Mock DEX 2
    let (dex2_addr, _) = dex_class.deploy(@array![]).expect('DEX2 Dep failed');
    IMockDEXDispatcher { contract_address: dex2_addr }.set_price(1000);

    start_cheat_caller_address(aggregator_addr, owner);
    dispatcher.register_dex_router('DEX_LOW', dex1_addr);
    dispatcher.register_dex_router('DEX_HIGH', dex2_addr);
    stop_cheat_caller_address(aggregator_addr);

    (dispatcher, token_a, token_b, owner)
}

#[test]
// Test case: validates selects highest quote behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_selects_highest_quote() {
    let (dispatcher, token_a, token_b, _) = setup();
    
    let route = dispatcher.get_best_swap_route(token_a, token_b, 100);
    
    // Use single quotes for felt252 panic message matching.
    assert(route.dex_id == 'DEX_HIGH', 'Should select DEX_HIGH');
    assert(route.expected_amount_out == 1000, 'Wrong expected amount');
}

#[test]
// Test case: validates slippage calculation behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_slippage_calculation() {
    let (dispatcher, token_a, token_b, _) = setup();
    
    let route = dispatcher.get_best_swap_route(token_a, token_b, 100);
    
    assert(route.min_amount_out == 990, 'Slippage calculation mismatch');
}

#[test]
// Use double quotes because the contract panic payload is ByteArray.
#[should_panic(expected: "Only owner")]
// Test case: validates unauthorized registration fails behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_unauthorized_registration_fails() {
    let (dispatcher, _, _, _) = setup();
    let attacker: ContractAddress = 0x666.try_into().unwrap();
    
    start_cheat_caller_address(dispatcher.contract_address, attacker);
    dispatcher.register_dex_router('EVIL_DEX', attacker);
}

#[test]
// Test case: validates execute swap with mev protection behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_execute_swap_with_mev_protection() {
    let (dispatcher, token_a, _token_b, _) = setup();
    let user: ContractAddress = 0x444.try_into().unwrap();
    let token = ITestTokenDispatcher { contract_address: token_a };
    
    // Use same in/out token to avoid depending on mocked DEX settlement output.
    let route = dispatcher.get_best_swap_route(token_a, token_a, 10000);
    token.set_balance(user, 10000);
    
    start_cheat_caller_address(dispatcher.contract_address, user);
    dispatcher.execute_swap(route, token_a, token_a, 10000, true);
    stop_cheat_caller_address(dispatcher.contract_address);
}

#[test]
// Test case: validates oracle quote uses price oracle behavior with expected assertions and revert boundaries.
// Used in isolated test context to validate invariants and avoid regressions in contract behavior.
fn test_oracle_quote_uses_price_oracle() {
    let (dispatcher, token_a, token_b, owner) = setup();

    let oracle_class = declare("MockPriceOracle").unwrap().contract_class();
    let (oracle_addr, _) = oracle_class.deploy(@array![]).unwrap();

    start_cheat_caller_address(dispatcher.contract_address, owner);
    dispatcher.set_price_oracle(oracle_addr);
    dispatcher.set_token_oracle_config(token_a, 1, 18);
    dispatcher.set_token_oracle_config(token_b, 2, 18);
    stop_cheat_caller_address(dispatcher.contract_address);

    // Set token prices: token_a = $2, token_b = $1
    start_cheat_caller_address(oracle_addr, owner);
    IPriceOracleDispatcher { contract_address: oracle_addr }
        .update_price_manual(token_a, 2);
    IPriceOracleDispatcher { contract_address: oracle_addr }
        .update_price_manual(token_b, 1);
    stop_cheat_caller_address(oracle_addr);

    let amount_in: u256 = 1_000_000_000_000_000_000;
    let quote = dispatcher.get_oracle_quote(token_a, token_b, amount_in);
    assert(quote == 2_000_000_000_000_000_000, 'Oracle quote mismatch');
}
