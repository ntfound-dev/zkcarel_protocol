#[cfg(test)]
mod tests {
    // Rule: Gunakan starknet secara langsung tanpa prefix core::
    use starknet::ContractAddress;
    use snforge_std::{
        declare, ContractClassTrait, DeclareResultTrait, 
        start_cheat_caller_address, stop_cheat_caller_address,
        start_cheat_block_timestamp 
    };

    use smartcontract::utils::price_oracle::{
        IPriceOracleDispatcher, IPriceOracleDispatcherTrait,
        DataType, PragmaPricesResponse
    };

    #[starknet::interface]
    pub trait IMockPragma<TState> {
        fn set_price(ref self: TState, price: u128, timestamp: u64);
        fn get_data_median(self: @TState, data_type: DataType) -> PragmaPricesResponse;
    }

    #[starknet::contract]
    pub mod MockPragma {
        use super::{DataType, PragmaPricesResponse};
        // Rule: Gunakan starknet secara langsung untuk storage wildcard
        use starknet::storage::*;

        #[storage]
        struct Storage {
            price: u128,
            timestamp: u64
        }

        #[abi(embed_v0)]
        impl MockPragmaImpl of super::IMockPragma<ContractState> {
            fn set_price(ref self: ContractState, price: u128, timestamp: u64) {
                self.price.write(price);
                self.timestamp.write(timestamp);
            }

            fn get_data_median(self: @ContractState, data_type: DataType) -> PragmaPricesResponse {
                let _ = data_type;
                PragmaPricesResponse {
                    price: self.price.read(),
                    decimals: 8,
                    last_updated_timestamp: self.timestamp.read(),
                    num_sources_aggregated: 1,
                    expiration_timestamp: Option::None
                }
            }
        }
    }

    fn deploy_mock_pragma() -> ContractAddress {
        let contract = declare("MockPragma").expect('Mock declare failed');
        let (address, _) = contract.contract_class().deploy(@array![]).expect('Mock deploy failed');
        address
    }

    fn deploy_price_oracle(pragma: ContractAddress, owner: ContractAddress) -> IPriceOracleDispatcher {
        let contract = declare("PriceOracle").expect('Oracle declare failed');
        let chainlink: ContractAddress = 0x0_felt252.try_into().unwrap();
        
        let mut constructor_args = array![];
        constructor_args.append(pragma.into());
        constructor_args.append(chainlink.into());
        constructor_args.append(owner.into());

        let (address, _) = contract.contract_class().deploy(@constructor_args).expect('Oracle deploy failed');
        IPriceOracleDispatcher { contract_address: address }
    }

    #[test]
    fn test_get_price_from_pragma() {
        let owner: ContractAddress = 0x123_felt252.try_into().unwrap();
        let pragma_address = deploy_mock_pragma();
        let dispatcher = deploy_price_oracle(pragma_address, owner);

        // Fix: Set timestamp ke 1500. 
        // 1500 (now) - 1000 (price_ts) = 500. 500 < 600 (max_age), jadi harga VALID.
        start_cheat_block_timestamp(dispatcher.contract_address, 1500);

        let mock_pragma = IMockPragmaDispatcher { contract_address: pragma_address };
        mock_pragma.set_price(2500, 1000); 

        let asset_id = 'ETH/USD';
        let token: ContractAddress = 0x1_felt252.try_into().unwrap();
        
        let price = dispatcher.get_price(token, asset_id);
        assert!(price == 2500, "Price mismatch from Pragma");
    }

    #[test]
    fn test_get_price_usd_calculation() {
        let owner: ContractAddress = 0x123_felt252.try_into().unwrap();
        let pragma_address = deploy_mock_pragma();
        let dispatcher = deploy_price_oracle(pragma_address, owner);

        // Fix: Gunakan 1500 agar selisih waktu tidak melebihi max_price_age_seconds (600)
        start_cheat_block_timestamp(dispatcher.contract_address, 1500);

        let mock_pragma = IMockPragmaDispatcher { contract_address: pragma_address };
        mock_pragma.set_price(200000000, 1000); 

        let asset_id = 'USDC/USD';
        let token: ContractAddress = 0x2_felt252.try_into().unwrap();
        
        let amount: u256 = 10000000;
        let decimals: u32 = 6;

        let usd_value = dispatcher.get_price_usd(token, asset_id, amount, decimals);
        assert!(usd_value == 2000000000, "USD calculation error");
    }

    #[test]
    #[should_panic(expected: "Contract is paused")]
    fn test_pause_circuit_breaker() {
        let owner: ContractAddress = 0x123_felt252.try_into().unwrap();
        let pragma_address = deploy_mock_pragma();
        let dispatcher = deploy_price_oracle(pragma_address, owner);

        start_cheat_caller_address(dispatcher.contract_address, owner);
        dispatcher.set_paused(true);
        stop_cheat_caller_address(dispatcher.contract_address);

        let asset_id = 'ETH/USD';
        let token: ContractAddress = 0x1_felt252.try_into().unwrap();
        
        dispatcher.get_price(token, asset_id);
    }
}
