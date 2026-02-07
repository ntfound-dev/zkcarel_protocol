use starknet::ContractAddress;

// Add #[default] to resolve the starknet::Store diagnostic
#[derive(Copy, Drop, Serde, starknet::Store)]
pub enum PriceSource {
    #[default]
    Manual,
    Pragma,
    Chainlink,
    Fallback
}

#[derive(Drop, Serde, starknet::Store)]
pub struct CachedPrice {
    pub price: u256,
    pub timestamp: u64,
    pub source: PriceSource,
    pub is_stale: bool,
}

#[starknet::interface]
pub trait IPragmaOracle<TContractState> {
    fn get_data_median(self: @TContractState, data_type: felt252) -> PragmaPricesResponse;
}

#[derive(Drop, Serde)]
pub struct PragmaPricesResponse {
    pub price: u128,
    pub decimals: u32,
    pub last_updated_timestamp: u64,
    pub num_sources_aggregated: u32,
    pub maybe_errors: felt252,
}

#[starknet::interface]
pub trait IPriceOracle<TContractState> {
    fn get_price(self: @TContractState, token: ContractAddress, asset_id: felt252) -> u256;
    fn get_price_usd(self: @TContractState, token: ContractAddress, asset_id: felt252, amount: u256, decimals: u32) -> u256;
    fn update_price_manual(ref self: TContractState, token: ContractAddress, price: u256);
    fn set_fallback_price(ref self: TContractState, token: ContractAddress, price: u256);
    fn set_paused(ref self: TContractState, paused: bool);
}

#[starknet::contract]
pub mod PriceOracle {
    // Rule: Always use full paths for core library imports
    use starknet::ContractAddress;
    use starknet::{get_caller_address, get_block_timestamp};
    // Rule: Always add all storage imports using wildcard
    use starknet::storage::*;
    
    // Removed PragmaPricesResponse from super import to resolve unused import warning
    use super::{IPriceOracle, IPragmaOracleDispatcher, IPragmaOracleDispatcherTrait, CachedPrice, PriceSource};

    #[storage]
    pub struct Storage {
        pub pragma_oracle_address: ContractAddress,
        pub chainlink_oracle_address: ContractAddress,
        pub price_cache: Map<ContractAddress, CachedPrice>,
        pub cache_validity_seconds: u64,
        pub max_price_age_seconds: u64,
        pub fallback_prices: Map<ContractAddress, u256>,
        pub authorized_updaters: Map<ContractAddress, bool>,
        pub owner: ContractAddress,
        pub paused: bool,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState, 
        pragma: ContractAddress, 
        chainlink: ContractAddress,
        owner_address: ContractAddress
    ) {
        self.pragma_oracle_address.write(pragma);
        self.chainlink_oracle_address.write(chainlink);
        self.owner.write(owner_address);
        self.cache_validity_seconds.write(60);
        self.max_price_age_seconds.write(600);
        self.paused.write(false);
    }

    #[abi(embed_v0)]
    impl PriceOracleImpl of IPriceOracle<ContractState> {
        fn get_price(self: @ContractState, token: ContractAddress, asset_id: felt252) -> u256 {
            // Rule: Ensure double quotes in assert strings
            assert!(!self.paused.read(), "Contract is paused");
            let now = get_block_timestamp();
            let cached = self.price_cache.entry(token).read();

            if now - cached.timestamp < self.cache_validity_seconds.read() && cached.price > 0 {
                return cached.price;
            }

            let pragma_dispatcher = IPragmaOracleDispatcher { 
                contract_address: self.pragma_oracle_address.read() 
            };
            
            let pragma_data = pragma_dispatcher.get_data_median(asset_id);
            
            if pragma_data.price > 0 && (now - pragma_data.last_updated_timestamp < self.max_price_age_seconds.read()) {
                return pragma_data.price.into();
            }

            if now - cached.timestamp < self.max_price_age_seconds.read() && cached.price > 0 {
                return cached.price;
            }

            let fallback = self.fallback_prices.entry(token).read();
            assert!(fallback > 0, "No valid price source found");
            fallback
        }

        fn get_price_usd(
            self: @ContractState, 
            token: ContractAddress, 
            asset_id: felt252, 
            amount: u256, 
            decimals: u32
        ) -> u256 {
            let price = self.get_price(token, asset_id);
            
            let mut divisor: u256 = 1;
            let mut i: u32 = 0;
            while i < decimals {
                divisor *= 10;
                i += 1;
            };

            (amount * price) / divisor
        }

        fn update_price_manual(ref self: ContractState, token: ContractAddress, price: u256) {
            assert!(self.authorized_updaters.entry(get_caller_address()).read(), "Not authorized");
            let new_cache = CachedPrice {
                price,
                timestamp: get_block_timestamp(),
                source: PriceSource::Manual,
                is_stale: false,
            };
            self.price_cache.entry(token).write(new_cache);
        }

        fn set_fallback_price(ref self: ContractState, token: ContractAddress, price: u256) {
            assert!(get_caller_address() == self.owner.read(), "Only owner");
            self.fallback_prices.entry(token).write(price);
        }

        fn set_paused(ref self: ContractState, paused: bool) {
            assert!(get_caller_address() == self.owner.read(), "Only owner");
            self.paused.write(paused);
        }
    }
}