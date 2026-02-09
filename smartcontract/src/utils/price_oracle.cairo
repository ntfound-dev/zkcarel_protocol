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

/// @title Pragma Oracle Interface
/// @author CAREL Team
/// @notice Minimal interface for reading Pragma median prices.
/// @dev Keeps dependency surface small for oracle integrations.
#[starknet::interface]
pub trait IPragmaOracle<TContractState> {
    /// @notice Returns median price data for a given data type.
    /// @dev Read-only oracle query used for price resolution.
    /// @param data_type Pragma data type selector.
    /// @return response Aggregated price data.
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

/// @title Price Oracle Interface
/// @author CAREL Team
/// @notice Standard price oracle entrypoints for CAREL protocol.
/// @dev Supports cached reads, manual updates, and fallback prices.
#[starknet::interface]
pub trait IPriceOracle<TContractState> {
    /// @notice Returns the latest price for a token.
    /// @dev Falls back to cached or fallback price when needed.
    /// @param token Token address.
    /// @param asset_id Oracle asset identifier.
    /// @return price Latest resolved price.
    fn get_price(self: @TContractState, token: ContractAddress, asset_id: felt252) -> u256;
    /// @notice Returns a USD value for a token amount.
    /// @dev Uses get_price and scales by token decimals.
    /// @param token Token address.
    /// @param asset_id Oracle asset identifier.
    /// @param amount Token amount.
    /// @param decimals Token decimals.
    /// @return value_usd USD value of the amount.
    fn get_price_usd(self: @TContractState, token: ContractAddress, asset_id: felt252, amount: u256, decimals: u32) -> u256;
    /// @notice Updates the manual price cache for a token.
    /// @dev Restricted to authorized updaters for integrity.
    /// @param token Token address.
    /// @param price Manual price value.
    fn update_price_manual(ref self: TContractState, token: ContractAddress, price: u256);
    /// @notice Sets a fallback price for a token.
    /// @dev Owner-only to avoid malicious price injection.
    /// @param token Token address.
    /// @param price Fallback price value.
    fn set_fallback_price(ref self: TContractState, token: ContractAddress, price: u256);
    /// @notice Pauses or unpauses oracle reads.
    /// @dev Owner-only for emergency control.
    /// @param paused Pause flag.
    fn set_paused(ref self: TContractState, paused: bool);
}

/// @title Price Oracle Privacy Interface
/// @author CAREL Team
/// @notice ZK privacy entrypoints for oracle updates.
#[starknet::interface]
pub trait IPriceOraclePrivacy<TContractState> {
    /// @notice Sets privacy router address.
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);
    /// @notice Submits a private oracle update proof.
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

/// @title Price Oracle Contract
/// @author CAREL Team
/// @notice Resolves token prices from oracles with caching and fallback.
/// @dev Combines Pragma data with cached and fallback pricing.
#[starknet::contract]
pub mod PriceOracle {
    // Rule: Always use full paths for core library imports
    use starknet::ContractAddress;
    use starknet::{get_caller_address, get_block_timestamp};
    // Rule: Always add all storage imports using wildcard
    use starknet::storage::*;
    use core::num::traits::Zero;
    use crate::privacy::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy::action_types::ACTION_ORACLE;
    
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
        pub privacy_router: ContractAddress,
    }

    /// @notice Initializes the price oracle.
    /// @dev Sets oracle addresses and safe cache defaults.
    /// @param pragma Pragma oracle address.
    /// @param chainlink Chainlink oracle address.
    /// @param owner_address Owner address for admin controls.
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
        /// @notice Returns the latest price for a token.
        /// @dev Falls back to cached or fallback price when needed.
        /// @param token Token address.
        /// @param asset_id Oracle asset identifier.
        /// @return price Latest resolved price.
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

        /// @notice Returns a USD value for a token amount.
        /// @dev Uses get_price and scales by token decimals.
        /// @param token Token address.
        /// @param asset_id Oracle asset identifier.
        /// @param amount Token amount.
        /// @param decimals Token decimals.
        /// @return value_usd USD value of the amount.
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

        /// @notice Updates the manual price cache for a token.
        /// @dev Restricted to authorized updaters for integrity.
        /// @param token Token address.
        /// @param price Manual price value.
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

        /// @notice Sets a fallback price for a token.
        /// @dev Owner-only to avoid malicious price injection.
        /// @param token Token address.
        /// @param price Fallback price value.
        fn set_fallback_price(ref self: ContractState, token: ContractAddress, price: u256) {
            assert!(get_caller_address() == self.owner.read(), "Only owner");
            self.fallback_prices.entry(token).write(price);
        }

        /// @notice Pauses or unpauses oracle reads.
        /// @dev Owner-only for emergency control.
        /// @param paused Pause flag.
        fn set_paused(ref self: ContractState, paused: bool) {
            assert!(get_caller_address() == self.owner.read(), "Only owner");
            self.paused.write(paused);
        }
    }

    #[abi(embed_v0)]
    impl PriceOraclePrivacyImpl of super::IPriceOraclePrivacy<ContractState> {
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            assert!(get_caller_address() == self.owner.read(), "Only owner");
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
        }

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
