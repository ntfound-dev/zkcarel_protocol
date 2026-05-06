use starknet::ContractAddress;

/// @notice Price source marker stored with cached values.
#[derive(Copy, Drop, Serde, starknet::Store)]
pub enum PriceSource {
    #[default]
    Manual,
    Pragma,
    Chainlink,
    Fallback
}

/// @notice Cached price entry with staleness metadata.
#[derive(Drop, Serde, starknet::Store)]
pub struct CachedPrice {
    pub price: u256,
    pub timestamp: u64,
    pub source: PriceSource,
    pub is_stale: bool,
}

/// @notice Minimal interface for reading Pragma median prices.
#[starknet::interface]
pub trait IPragmaOracle<TContractState> {
    /// @notice Returns median price data from Pragma oracle.
    fn get_data_median(self: @TContractState, data_type: DataType) -> PragmaPricesResponse;
}

/// @notice Pragma data type selector for spot, futures, or generic feeds.
#[derive(Copy, Drop, Serde)]
pub enum DataType {
    /// Spot price data (e.g., BTC/USD).
    SpotEntry: felt252,
    /// Futures data (e.g., BTC/USD expiry).
    FutureEntry: (felt252, u64),
    /// Generic data feeds.
    GenericEntry: felt252,
}

/// @notice Pragma price response struct.
#[derive(Drop, Serde)]
pub struct PragmaPricesResponse {
    pub price: u128,
    pub decimals: u32,
    pub last_updated_timestamp: u64,
    pub num_sources_aggregated: u32,
    pub expiration_timestamp: Option<u64>,
}

/// @title IPriceOracle
/// @notice Price oracle API used by trading and bridge quote paths.
///         Supports live Pragma feeds, manual overrides, and per-token fallback prices.
#[starknet::interface]
pub trait IPriceOracle<TContractState> {
    /// @notice Returns the latest cached or live-resolved price for an asset.
    /// @dev Tries cache first, then Pragma if `asset_id` is non-zero, then stale cache, then fallback.
    /// @param token ERC20 token address.
    /// @param asset_id Pragma feed ID (pass 0 to skip live resolution).
    /// @return Price scaled to 8 decimals.
    fn get_price(self: @TContractState, token: ContractAddress, asset_id: felt252) -> u256;

    /// @notice Converts a token amount into its USD value using oracle pricing.
    /// @param token ERC20 token address.
    /// @param asset_id Pragma feed ID.
    /// @param amount Token amount to convert.
    /// @param decimals Token decimals.
    /// @return USD value of `amount`.
    fn get_price_usd(
        self: @TContractState,
        token: ContractAddress,
        asset_id: felt252,
        amount: u256,
        decimals: u32
    ) -> u256;

    /// @notice Writes a manual price into the cache.
    /// @dev Callable only by an authorized updater. Emits `PriceUpdated`.
    /// @param token Token address to update.
    /// @param price New price (8-decimal normalized).
    fn update_price_manual(ref self: TContractState, token: ContractAddress, price: u256);

    /// @notice Sets the fallback price used when no live source is available.
    /// @dev Callable only by the contract owner. Emits `FallbackPriceUpdated`.
    /// @param token Token address to update.
    /// @param price Fallback price (8-decimal normalized).
    fn set_fallback_price(ref self: TContractState, token: ContractAddress, price: u256);

    /// @notice Toggles the oracle pause state.
    /// @dev Callable only by the contract owner. Emits `OraclePauseUpdated`.
    /// @param paused true to pause, false to unpause.
    fn set_paused(ref self: TContractState, paused: bool);

    /// @notice Grants or revokes manual price update permission for an address.
    /// @dev Callable only by the contract owner. Emits `AuthorizedUpdaterUpdated`.
    /// @param updater Address to configure.
    /// @param authorized true to authorize, false to revoke.
    fn set_authorized_updater(ref self: TContractState, updater: ContractAddress, authorized: bool);
}

/// @title IPriceOraclePrivacy
/// @notice Hide Mode hooks for private oracle updates through the privacy router.
#[starknet::interface]
pub trait IPriceOraclePrivacy<TContractState> {
    /// @notice Sets the privacy router for private oracle actions.
    /// @dev Callable only by the contract owner. Emits `PrivacyRouterUpdated`.
    /// @param router New privacy router address (must be non-zero).
    fn set_privacy_router(ref self: TContractState, router: ContractAddress);

    /// @notice Forwards a nullifier/commitment-bound oracle payload to the privacy router.
    /// @dev Nullifiers are replay-protected: each may only be consumed once.
    /// @param old_root Previous Merkle tree root.
    /// @param new_root Updated Merkle tree root after commitments.
    /// @param nullifiers Nullifiers for inputs being spent.
    /// @param commitments New Merkle commitments.
    /// @param public_inputs ZK circuit public inputs.
    /// @param proof Serialized ZK proof.
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

/// @title PriceOracle
/// @notice Resolves token prices from Pragma with caching, manual updates, and fallback support.
///         Owner is set via two-step OZ OwnableComponent transfer.
#[starknet::contract]
pub mod PriceOracle {
    use starknet::ContractAddress;
    use starknet::{get_caller_address, get_block_timestamp};
    use starknet::storage::*;
    use crate::privacy_router::{IPrivacyRouterDispatcher, IPrivacyRouterDispatcherTrait};
    use crate::privacy_action_types::ACTION_ORACLE;
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
    use openzeppelin::access::ownable::OwnableComponent;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableTwoStepImpl = OwnableComponent::OwnableTwoStepImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        pub pragma_oracle_address: ContractAddress,
        pub chainlink_oracle_address: ContractAddress,
        pub price_cache: Map<ContractAddress, CachedPrice>,
        pub cache_validity_seconds: u64,
        pub max_price_age_seconds: u64,
        pub fallback_prices: Map<ContractAddress, u256>,
        pub authorized_updaters: Map<ContractAddress, bool>,
        pub paused: bool,
        pub privacy_router: ContractAddress,
        pub used_nullifiers: Map<felt252, bool>,
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PriceUpdated: PriceUpdated,
        FallbackPriceUpdated: FallbackPriceUpdated,
        OraclePauseUpdated: OraclePauseUpdated,
        AuthorizedUpdaterUpdated: AuthorizedUpdaterUpdated,
        PrivacyRouterUpdated: PrivacyRouterUpdated,
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    /// @notice Emitted when a manual price update is written to the cache.
    #[derive(Drop, starknet::Event)]
    pub struct PriceUpdated {
        pub token: ContractAddress,
        pub price: u256,
        pub updater: ContractAddress,
    }

    /// @notice Emitted when the fallback price for a token is updated.
    #[derive(Drop, starknet::Event)]
    pub struct FallbackPriceUpdated {
        pub token: ContractAddress,
        pub price: u256,
    }

    /// @notice Emitted when the oracle pause state changes.
    #[derive(Drop, starknet::Event)]
    pub struct OraclePauseUpdated {
        pub paused: bool,
    }

    /// @notice Emitted when an authorized updater is granted or revoked.
    #[derive(Drop, starknet::Event)]
    pub struct AuthorizedUpdaterUpdated {
        pub updater: ContractAddress,
        pub authorized: bool,
    }

    /// @notice Emitted when the privacy router address is updated.
    #[derive(Drop, starknet::Event)]
    pub struct PrivacyRouterUpdated {
        pub router: ContractAddress,
    }

    const STANDARD_PRICE_DECIMALS: u32 = 8;

    fn normalize_price(price: u128, decimals: u32) -> u256 {
        let result: u256 = price.into();
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

    /// @notice Initializes oracle dependencies and cache validity windows.
    /// @param admin Initial contract owner (two-step transfer via OZ OwnableComponent).
    /// @param pragma Pragma oracle contract address.
    /// @param chainlink Chainlink oracle contract address.
    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        pragma: ContractAddress,
        chainlink: ContractAddress,
    ) {
        self.ownable.initializer(admin);
        self.pragma_oracle_address.write(pragma);
        self.chainlink_oracle_address.write(chainlink);
        self.cache_validity_seconds.write(60);
        self.max_price_age_seconds.write(600);
        self.paused.write(false);
    }

    #[abi(embed_v0)]
    impl PriceOracleImpl of IPriceOracle<ContractState> {
        /// @inheritdoc IPriceOracle
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
                if pragma_data.price > 0
                    && (now - pragma_data.last_updated_timestamp < self.max_price_age_seconds.read()) {
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

        /// @inheritdoc IPriceOracle
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

        /// @inheritdoc IPriceOracle
        fn update_price_manual(ref self: ContractState, token: ContractAddress, price: u256) {
            let caller = get_caller_address();
            assert!(self.authorized_updaters.entry(caller).read(), "Not authorized");
            let new_cache = CachedPrice {
                price,
                timestamp: get_block_timestamp(),
                source: PriceSource::Manual,
                is_stale: false,
            };
            self.price_cache.entry(token).write(new_cache);
            self.emit(Event::PriceUpdated(PriceUpdated { token, price, updater: caller }));
        }

        /// @inheritdoc IPriceOracle
        fn set_fallback_price(ref self: ContractState, token: ContractAddress, price: u256) {
            self.ownable.assert_only_owner();
            self.fallback_prices.entry(token).write(price);
            self.emit(Event::FallbackPriceUpdated(FallbackPriceUpdated { token, price }));
        }

        /// @inheritdoc IPriceOracle
        fn set_paused(ref self: ContractState, paused: bool) {
            self.ownable.assert_only_owner();
            self.paused.write(paused);
            self.emit(Event::OraclePauseUpdated(OraclePauseUpdated { paused }));
        }

        /// @inheritdoc IPriceOracle
        fn set_authorized_updater(
            ref self: ContractState,
            updater: ContractAddress,
            authorized: bool
        ) {
            self.ownable.assert_only_owner();
            assert!(!updater.is_zero(), "Invalid updater");
            self.authorized_updaters.entry(updater).write(authorized);
            self.emit(Event::AuthorizedUpdaterUpdated(AuthorizedUpdaterUpdated { updater, authorized }));
        }
    }

    #[abi(embed_v0)]
    impl PriceOraclePrivacyImpl of super::IPriceOraclePrivacy<ContractState> {
        /// @inheritdoc IPriceOraclePrivacy
        fn set_privacy_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert!(!router.is_zero(), "Privacy router required");
            self.privacy_router.write(router);
            self.emit(Event::PrivacyRouterUpdated(PrivacyRouterUpdated { router }));
        }

        /// @inheritdoc IPriceOraclePrivacy
        fn submit_private_oracle_action(
            ref self: ContractState,
            old_root: felt252,
            new_root: felt252,
            nullifiers: Span<felt252>,
            commitments: Span<felt252>,
            public_inputs: Span<felt252>,
            proof: Span<felt252>
        ) {
            let total: u64 = nullifiers.len().into();
            let mut i: u64 = 0;
            while i < total {
                let idx: u32 = i.try_into().unwrap();
                let nf = *nullifiers.at(idx);
                assert!(!self.used_nullifiers.entry(nf).read(), "Nullifier already used");
                self.used_nullifiers.entry(nf).write(true);
                i += 1;
            };
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
