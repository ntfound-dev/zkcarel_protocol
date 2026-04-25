#[cfg(test)]
mod tests {
    use starknet::ContractAddress;
    use core::byte_array::ByteArray;
    use snforge_std::{
        declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address,
        stop_cheat_caller_address
    };

    use smartcontract::trading::dca_orders::{ILimitOrderBookDispatcher, ILimitOrderBookDispatcherTrait};
    use smartcontract::utils::price_oracle::{
        IPriceOracle, IPriceOracleDispatcher, IPriceOracleDispatcherTrait
    };
    use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};

    #[starknet::contract]
    mod MockDcaPriceOracle {
        use starknet::ContractAddress;
        use super::IPriceOracle;

        #[storage]
        struct Storage {}

        #[abi(embed_v0)]
        impl IPriceOracleImpl of IPriceOracle<ContractState> {
            fn get_price(self: @ContractState, token: ContractAddress, asset_id: felt252) -> u256 {
                u256 { low: 100000000, high: 0 }
            }
            fn get_price_usd(
                self: @ContractState,
                token: ContractAddress,
                asset_id: felt252,
                amount: u256,
                decimals: u32
            ) -> u256 {
                u256 { low: 100000000, high: 0 }
            }
            fn update_price_manual(ref self: ContractState, token: ContractAddress, price: u256) {}
            fn set_fallback_price(ref self: ContractState, token: ContractAddress, price: u256) {}
            fn set_paused(ref self: ContractState, paused: bool) {}
            fn set_authorized_updater(ref self: ContractState, updater: ContractAddress, authorized: bool) {}
        }
    }

    // Deploys limit order book fixture and returns handles used by dependent test flows.
    fn deploy_limit_order_book(owner: ContractAddress) -> ILimitOrderBookDispatcher {
        let contract = declare("LimitOrderBook").unwrap().contract_class();
        let mut constructor_calldata = array![owner.into()];
        let (contract_address, _) = contract.deploy(@constructor_calldata).unwrap();
        ILimitOrderBookDispatcher { contract_address }
    }

    fn deploy_mock_token(
        name: ByteArray,
        symbol: ByteArray,
        owner: ContractAddress,
        recipient: ContractAddress,
        supply: u256,
    ) -> ContractAddress {
        let token_class = declare("MockERC20").unwrap().contract_class();
        let mut args = array![];
        name.serialize(ref args);
        symbol.serialize(ref args);
        18_u8.serialize(ref args);
        owner.serialize(ref args);
        supply.serialize(ref args);
        recipient.serialize(ref args);
        let (token_addr, _) = token_class.deploy(@args).unwrap();
        token_addr
    }

    fn deploy_mock_oracle() -> ContractAddress {
        let oracle = declare("MockDcaPriceOracle").unwrap().contract_class();
        let (oracle_addr, _) = oracle.deploy(@array![]).unwrap();
        oracle_addr
    }

    #[test]
    // Test case: validates create + cancel flow for limit orders.
    fn test_create_and_cancel_order() {
        let owner: ContractAddress = 0x123.try_into().unwrap();
        let dispatcher = deploy_limit_order_book(owner);
        let order_id: felt252 = 1;
        let token_in = deploy_mock_token("MockIn", "MIN", owner, owner, 1_000_000_u256);
        let token_out = deploy_mock_token("MockOut", "MOUT", owner, owner, 1_000_000_u256);
        let amount: u256 = 10_000;

        let token_in_disp = IERC20Dispatcher { contract_address: token_in };
        start_cheat_caller_address(token_in, owner);
        token_in_disp.approve(dispatcher.contract_address, amount);
        stop_cheat_caller_address(token_in);

        start_cheat_caller_address(dispatcher.contract_address, owner);
        dispatcher.create_limit_order(order_id, token_in, token_out, amount, 200000000_u256, 9_999_999_999);
        dispatcher.cancel_limit_order(order_id);
        stop_cheat_caller_address(dispatcher.contract_address);
    }

    #[test]
    #[should_panic(expected: "Not order owner")]
    // Test case: validates cancel requires order owner.
    fn test_cancel_by_non_owner_fails() {
        let owner: ContractAddress = 0x123.try_into().unwrap();
        let attacker: ContractAddress = 0x456.try_into().unwrap();
        let dispatcher = deploy_limit_order_book(owner);
        let order_id: felt252 = 1;
        let token_in = deploy_mock_token("MockIn", "MIN", owner, owner, 1_000_000_u256);
        let token_out = deploy_mock_token("MockOut", "MOUT", owner, owner, 1_000_000_u256);
        let amount: u256 = 10_000;

        let token_in_disp = IERC20Dispatcher { contract_address: token_in };
        start_cheat_caller_address(token_in, owner);
        token_in_disp.approve(dispatcher.contract_address, amount);
        stop_cheat_caller_address(token_in);

        start_cheat_caller_address(dispatcher.contract_address, owner);
        dispatcher.create_limit_order(order_id, token_in, token_out, amount, 1_u256, 9_999_999_999);
        stop_cheat_caller_address(dispatcher.contract_address);

        start_cheat_caller_address(dispatcher.contract_address, attacker);
        dispatcher.cancel_limit_order(order_id);
    }

    #[test]
    #[should_panic(expected: "Order not active")]
    // Test case: validates execute cannot run twice on same order.
    fn test_execute_twice_fails() {
        let owner: ContractAddress = 0x123.try_into().unwrap();
        let executor: ContractAddress = 0x789.try_into().unwrap();
        let dispatcher = deploy_limit_order_book(owner);
        let oracle_addr = deploy_mock_oracle();
        let order_id: felt252 = 1;
        let token_in = deploy_mock_token("MockIn", "MIN", owner, owner, 1_000_000_u256);
        let token_out = deploy_mock_token("MockOut", "MOUT", owner, executor, 1_000_000_u256);
        let amount: u256 = 10_000;

        let token_in_disp = IERC20Dispatcher { contract_address: token_in };
        start_cheat_caller_address(token_in, owner);
        token_in_disp.approve(dispatcher.contract_address, amount);
        stop_cheat_caller_address(token_in);

        start_cheat_caller_address(dispatcher.contract_address, owner);
        dispatcher.set_price_oracle(oracle_addr);
        dispatcher.set_token_asset_id(token_in, 1);
        dispatcher.set_authorized_keeper(executor, true);
        dispatcher.create_limit_order(order_id, token_in, token_out, amount, 200000000_u256, 9_999_999_999);
        stop_cheat_caller_address(dispatcher.contract_address);

        let oracle = IPriceOracleDispatcher { contract_address: oracle_addr };
        let price = oracle.get_price(token_in, 1);
        assert!(price > 0, "Mock oracle should return price");

        let token_out_disp = IERC20Dispatcher { contract_address: token_out };
        start_cheat_caller_address(token_out, executor);
        token_out_disp.approve(dispatcher.contract_address, amount);
        stop_cheat_caller_address(token_out);

        start_cheat_caller_address(dispatcher.contract_address, executor);
        dispatcher.execute_limit_order(order_id, amount);
        dispatcher.execute_limit_order(order_id, amount);
    }
}
