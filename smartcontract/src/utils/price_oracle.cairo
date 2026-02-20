use starknet::ContractAddress;

// Price source marker stored with cached values.
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

// Minimal interface for reading Pragma median prices.
// Keeps dependency surface small for oracle integrations.
#[starknet::interface]
pub trait IPragmaOracle<TContractState> {
    // Returns median price data from Pragma oracle.
    fn get_data_median(self: @TContractState, data_type: DataType) -> PragmaPricesResponse;
}

#[derive(Copy, Drop, Serde)]
pub enum DataType {
    // Spot price data (e.g., BTC/USD).
    SpotEntry: felt252,
    // Futures data (e.g., BTC/USD expiry).
    FutureEntry: (felt252, u64),
    // Generic data feeds.
    GenericEntry: felt252,
}

#[derive(Drop, Serde)]
pub struct PragmaPricesResponse {
    pub price: u128,
    pub decimals: u32,
    pub last_updated_timestamp: u64,
    pub num_sources_aggregated: u32,
    pub expiration_timestamp: Option<u64>,
}

// Price-oracle API used by trading and bridge quote paths.
// Supports cached reads plus manual and fallback updates.
#[starknet::interface]
pub trait IPriceOracle<TContractState> {
    // Returns latest cached or resolved price for an asset.
    fn get_price(self: @TContractState, token: ContractAddress, asset_id: felt252) -> u256;
    // Converts token amount into USD value using oracle pricing.
    fn get_price_usd(self: @TContractState, token: ContractAddress, asset_id: felt252, amount: u256, decimals: u32) -> u256;
    // Writes manual price into cache (authorized updater only).
    fn update_price_manual(ref self: TContractState, token: ContractAddress, price: u256);
    // Updates fallback price used when live sources are unavailable (owner only).
    fn set_fallback_price(ref self: TContractState, token: ContractAddress, price: u256);
    // Toggles oracle pause state (owner only).
    fn set_paused(ref self: TContractState, paused: bool);
}

// Hide Mode hooks for private oracle updates.
#[starknet::interface]
pub trait IPriceOraclePrivacy<TContractState> {
    // Sets privacy router used for Hide Mode actions.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    // Forwards private oracle update payload to privacy router.
    fn submit_private_oracle_action(
        ref self: TContractState,
        old_root: felt252,
        new_root: felt252,
        nullifiers: Span<felt252>,
        commitments: Span<felt252>,
        public_inputs: Span<felt252>,
        proof: Span<felt252>
    );
}

// Resolves token prices from oracles with caching and fallback.
// Combines Pragma data with cached and fallback pricing.
#[starknet::contract]
pub mod PriceOracle {
    use starknet::ContractAddress;
    use starknet::{get_caller_address, get_block_timestamp};
    use starknet::storage::*;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_ORACLE;
    
    use super::{
        IPriceOracle,
        IPragmaOracleDispatcher,
        IPragmaOracleDispatcherTrait,
        CachedPrice,
        DataType,
        PragmaPricesResponse,
        PriceSource,
    };
    use core::num::traits::Zero;

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
        pub privacy_router: ContractAddress,
    }

    const STANDARD_PRICE_DECIMALS: u32 = 8;

    // Normalizes oracle price values to target decimals.
    fn normalize_price(price: u128, decimals: u32) -> u256 {
        let mut result: u256 = price.into();
        if decimals == STANDARD_PRICE_DECIMALS {
            return result;
        }
        if decimals < STANDARD_PRICE_DECIMALS {
            let mut i: u32 = 0;
            let mut mul: u256 = 1;
            let diff = STANDARD_PRICE_DECIMALS - decimals;
            while i < diff {
                mul *= 10;
                i += 1;
            };
            return result * mul;
        }
        let mut j: u32 = 0;
        let mut div: u256 = 1;
        let diff = decimals - STANDARD_PRICE_DECIMALS;
        while j < diff {
            div *= 10;
            j += 1;
        };
        result / div
    }

    // Initializes oracle dependencies and cache defaults.
    // pragma/chainlink/owner_address: external sources and admin account.
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
        // Returns latest cached or resolved price for an asset.
        fn get_price(self: @ContractState, token: ContractAddress, asset_id: felt252) -> u256 {
            assert!(!self.paused.read(), "Contract is paused");
            let now = get_block_timestamp();
            let cached = self.price_cache.entry(token).read();

            if now - cached.timestamp < self.cache_validity_seconds.read() && cached.price > 0 {
                return cached.price;
            }

            if asset_id != 0 {
                let pragma_dispatcher = IPragmaOracleDispatcher { 
                    contract_address: self.pragma_oracle_address.read() 
                };
                
                let pragma_data: PragmaPricesResponse =
                    pragma_dispatcher.get_data_median(DataType::SpotEntry(asset_id));
                
                if pragma_data.price > 0 && (now - pragma_data.last_updated_timestamp < self.max_price_age_seconds.read()) {
                    return normalize_price(pragma_data.price, pragma_data.decimals);
                }
            }

            if now - cached.timestamp < self.max_price_age_seconds.read() && cached.price > 0 {
                return cached.price;
            }

            let fallback = self.fallback_prices.entry(token).read();
            assert!(fallback > 0, "No valid price source found");
            fallback
        }

        // Converts token amount into USD value using oracle pricing.
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

        // Writes manual price into cache (authorized updater only).
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

        // Updates fallback price used when live sources are unavailable (owner only).
        fn set_fallback_price(ref self: ContractState, token: ContractAddress, price: u256) {
            assert!(get_caller_address() == self.owner.read(), "Only owner");
            self.fallback_prices.entry(token).write(price);
        }

        // Toggles oracle pause state (owner only).
        fn set_paused(ref self: ContractState, paused: bool) {
            assert!(get_caller_address() == self.owner.read(), "Only owner");
            self.paused.write(paused);
        }
    }

    #[abi(embed_v0)]
    impl PriceOraclePrivacyImpl of super::IPriceOraclePrivacy<ContractState> {
        // Sets privacy router used for Hide Mode oracle actions (owner only).
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            assert!(get_caller_address() == self.owner.read(), "Only owner");
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

        // Relays private oracle payload for proof verification and execution.
        // `nullifiers` prevent replay and `commitments` bind intended update state.
        fn submit_private_oracle_action(
            ref self: ContractState,
            old_root: felt252,
            new_root: felt252,
            nullifiers: Span<felt252>,
            commitments: Span<felt252>,
            public_inputs: Span<felt252>,
            proof: Span<felt252>
        ) {
            let router = self.privacy_router.read();
            assert!(!router.is_zero(), "Privacy router not set");
            let dispatcher = IPrivacyRouterDispatcher { contract_address: router };
            dispatcher.submit_action(
                ACTION_ORACLE,
                old_root,
                new_root,
                nullifiers,
                commitments,
                public_inputs,
                proof
            );
        }
    }
}
