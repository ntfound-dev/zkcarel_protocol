/// Application constants

// Token addresses (Starknet)
pub const TOKEN_CAREL: &str = "0x0517f60f4ec4e1b2b748f0f642dfdcb32c0ddc893f777f2b595a4e4f6df51545";
pub const TOKEN_BTC: &str = "0x016f2d46ab5cc2244aeeb195cf76f75e7a316a92b71d56618c1bf1b69ab70998";
pub const TOKEN_ETH: &str = "0x0000000000000000000000000000000000000003";
pub const TOKEN_STRK: &str = "0x04718f5a0Fc34cC1AF16A1cdee98fFB20C31f5cD61D6Ab07201858f4287c938D";
pub const TOKEN_USDT: &str = "0x030fcbfd1f83fb2d697ad8bdd52e1d55a700b876bed1f4507875539581ed53e5";
pub const TOKEN_USDC: &str = "0x0179cc8cb5ea0b143e17d649e8ad60d80c45c8132c4cf162d57eaf8297f529d8";

// Contract addresses
pub const CONTRACT_SWAP_AGGREGATOR: &str = "0x0000000000000000000000000000000000001001";
pub const CONTRACT_BRIDGE_AGGREGATOR: &str = "0x0000000000000000000000000000000000001002";
pub const CONTRACT_STAKING_CAREL: &str = "0x0000000000000000000000000000000000001003";
pub const CONTRACT_STAKING_BTC: &str = "0x0000000000000000000000000000000000001004";
pub const CONTRACT_POINT_STORAGE: &str = "0x0000000000000000000000000000000000001005";
pub const CONTRACT_MERKLE_DISTRIBUTOR: &str = "0x0000000000000000000000000000000000001006";
pub const CONTRACT_NFT_DISCOUNT: &str = "0x0000000000000000000000000000000000001007";
pub const CONTRACT_LIMIT_ORDER: &str = "0x0000000000000000000000000000000000001008";

// Points configuration
pub const POINTS_PER_USD_SWAP: f64 = 10.0;
pub const POINTS_MIN_USD_SWAP: f64 = 1.0;
pub const POINTS_MIN_USD_SWAP_TESTNET: f64 = 0.01;
pub const POINTS_PER_USD_LIMIT_ORDER: f64 = 10.0;
pub const POINTS_MIN_USD_LIMIT_ORDER: f64 = 1.0;
pub const POINTS_PER_USD_BRIDGE_ETH: f64 = 15.0;
pub const POINTS_PER_USD_BRIDGE_BTC: f64 = 25.0;
pub const POINTS_MIN_USD_BRIDGE_ETH: f64 = 10.0;
pub const POINTS_MIN_USD_BRIDGE_BTC: f64 = 100.0;
pub const POINTS_PER_USD_STAKE: f64 = 3.0;
pub const POINTS_MIN_STAKE_CAREL: f64 = 100.0;
pub const POINTS_PER_USD_BRIDGE: f64 = POINTS_PER_USD_BRIDGE_ETH; // backward compatibility
pub const POINTS_TWITTER_FOLLOW: f64 = 50.0;
pub const POINTS_TELEGRAM_JOIN: f64 = 30.0;
pub const POINTS_DISCORD_JOIN: f64 = 30.0;
pub const POINTS_TWITTER_RETWEET: f64 = 25.0;

// Staking multipliers
pub const MULTIPLIER_TIER_1: f64 = 1.0; // < 10k CAREL
pub const MULTIPLIER_TIER_2: f64 = 1.25; // 10k - 50k CAREL
pub const MULTIPLIER_TIER_3: f64 = 1.5; // 50k - 100k CAREL
pub const MULTIPLIER_TIER_4: f64 = 2.0; // 100k+ CAREL

// NFT discount tiers
pub const NFT_TIER_1_DISCOUNT: f64 = 5.0; // Bronze
pub const NFT_TIER_2_DISCOUNT: f64 = 10.0; // Silver
pub const NFT_TIER_3_DISCOUNT: f64 = 25.0; // Gold
pub const NFT_TIER_4_DISCOUNT: f64 = 35.0; // Platinum
pub const NFT_TIER_5_DISCOUNT: f64 = 50.0; // Onyx
pub const NFT_TIER_6_DISCOUNT: f64 = 50.0; // reserved

// Epoch configuration
pub const EPOCH_DURATION_SECONDS: i64 = 2592000; // 30 days
pub const POINTS_TO_CAREL_RATIO: f64 = 0.1; // 1 point = 0.1 CAREL

// Faucet configuration
pub const FAUCET_COOLDOWN_HOURS: i64 = 24;
pub const FAUCET_AMOUNT_BTC: f64 = 0.001;
pub const FAUCET_AMOUNT_ETH: f64 = 0.1;
pub const FAUCET_AMOUNT_STRK: f64 = 10.0;
pub const FAUCET_AMOUNT_CAREL: f64 = 100.0;

// Rate limits
pub const RATE_LIMIT_REQUESTS_PER_MINUTE: u32 = 60;
pub const RATE_LIMIT_REQUESTS_PER_HOUR: u32 = 1000;

// Gas configuration
pub const GAS_PRICE_SLOW: f64 = 0.001;
pub const GAS_PRICE_STANDARD: f64 = 0.002;
pub const GAS_PRICE_FAST: f64 = 0.003;
pub const GAS_PRICE_INSTANT: f64 = 0.005;

// Bridge providers
pub const BRIDGE_LAYERSWAP: &str = "LayerSwap";
pub const BRIDGE_ATOMIQ: &str = "Atomiq";
pub const BRIDGE_STARKGATE: &str = "StarkGate";
pub const BRIDGE_GARDEN: &str = "Garden";

// DEX providers
pub const DEX_EKUBO: &str = "Ekubo";
pub const DEX_HAIKO: &str = "Haiko";
pub const DEX_AVNU: &str = "Avnu";

// API version
pub const API_VERSION: &str = "v1";

// WebSocket configuration
pub const WS_HEARTBEAT_INTERVAL_SECS: u64 = 30;
pub const WS_CLIENT_TIMEOUT_SECS: u64 = 60;

// Background service intervals
pub const INDEXER_INTERVAL_SECS: u64 = 5;
pub const POINT_CALCULATOR_INTERVAL_SECS: u64 = 60;
pub const PRICE_UPDATER_INTERVAL_SECS: u64 = 60;
pub const ORDER_EXECUTOR_INTERVAL_SECS: u64 = 10;

/// Map token symbol to Starknet address constant.
pub fn token_address_for(symbol: &str) -> Option<&'static str> {
    match symbol.to_ascii_uppercase().as_str() {
        "CAREL" => Some(TOKEN_CAREL),
        "BTC" | "WBTC" => Some(TOKEN_BTC),
        "ETH" => Some(TOKEN_ETH),
        "STRK" => Some(TOKEN_STRK),
        "USDT" => Some(TOKEN_USDT),
        "USDC" => Some(TOKEN_USDC),
        _ => None,
    }
}
