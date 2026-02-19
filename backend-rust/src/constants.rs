/// Application constants

// Token addresses (Starknet)
pub const TOKEN_CAREL: &str = "0x0517f60f4ec4e1b2b748f0f642dfdcb32c0ddc893f777f2b595a4e4f6df51545";
// Canonical Starknet Sepolia WBTC (Garden `starknet_sepolia:wbtc` token.address).
pub const TOKEN_BTC: &str = "0x496bef3ed20371382fbe0ca6a5a64252c5c848f9f1f0cccf8110fc4def912d5";
pub const TOKEN_ETH: &str = "0x0000000000000000000000000000000000000003";
pub const TOKEN_STRK: &str = "0x04718f5a0Fc34cC1AF16A1cdee98fFB20C31f5cD61D6Ab07201858f4287c938D";
pub const TOKEN_USDT: &str = "0x030fcbfd1f83fb2d697ad8bdd52e1d55a700b876bed1f4507875539581ed53e5";
pub const TOKEN_USDC: &str = "0x0179cc8cb5ea0b143e17d649e8ad60d80c45c8132c4cf162d57eaf8297f529d8";

// Points configuration
pub const POINTS_PER_USD_SWAP: f64 = 10.0;
pub const POINTS_MIN_USD_SWAP: f64 = 1.0;
pub const POINTS_MIN_USD_SWAP_TESTNET: f64 = 0.01;
pub const POINTS_PER_USD_LIMIT_ORDER: f64 = 12.0;
pub const POINTS_MIN_USD_LIMIT_ORDER: f64 = 1.0;
pub const POINTS_PER_USD_BRIDGE_ETH: f64 = 15.0;
pub const POINTS_PER_USD_BRIDGE_BTC: f64 = 25.0;
pub const POINTS_MIN_USD_BRIDGE_ETH: f64 = 10.0;
pub const POINTS_MIN_USD_BRIDGE_BTC: f64 = 100.0;
pub const POINTS_PER_USD_STAKE: f64 = 3.0;
pub const POINTS_MIN_STAKE_CAREL: f64 = 100.0;
pub const POINTS_MIN_STAKE_STRK: f64 = 10.0;
pub const POINTS_MIN_STAKE_STABLECOIN: f64 = 100.0;
pub const POINTS_MIN_STAKE_BTC: f64 = 0.001;
pub const POINTS_MIN_STAKE_LP: f64 = 1.0;
pub const POINTS_TWITTER_FOLLOW: f64 = 5.0;
pub const POINTS_TWITTER_LIKE: f64 = 2.0;
pub const POINTS_TWITTER_RETWEET: f64 = 3.0;
pub const POINTS_TWITTER_COMMENT: f64 = 10.0;
pub const POINTS_TELEGRAM_JOIN_CHANNEL: f64 = 5.0;
pub const POINTS_TELEGRAM_JOIN_GROUP: f64 = 5.0;
pub const POINTS_DISCORD_JOIN: f64 = 5.0;
pub const POINTS_DISCORD_VERIFY: f64 = 10.0;
pub const POINTS_DISCORD_ROLE: f64 = 5.0;
pub const POINTS_BATTLE_HIT: f64 = 3.0;
pub const POINTS_BATTLE_MISS: f64 = 1.0;
pub const POINTS_BATTLE_WIN: f64 = 20.0;
pub const POINTS_BATTLE_LOSS: f64 = 2.0;
pub const POINTS_BATTLE_TIMEOUT_WIN: f64 = 15.0;

// Staking multipliers
pub const MULTIPLIER_TIER_1: f64 = 1.0; // < 100 CAREL (no tier boost)
pub const MULTIPLIER_TIER_2: f64 = 2.0; // 100 - <1k CAREL
pub const MULTIPLIER_TIER_3: f64 = 3.0; // 1k - <10k CAREL
pub const MULTIPLIER_TIER_4: f64 = 5.0; // 10k+ CAREL

// Staking points multipliers by product
pub const POINTS_MULTIPLIER_STAKE_CAREL_TIER_1: f64 = 2.0;
pub const POINTS_MULTIPLIER_STAKE_CAREL_TIER_2: f64 = 3.0;
pub const POINTS_MULTIPLIER_STAKE_CAREL_TIER_3: f64 = 5.0;
pub const POINTS_MULTIPLIER_STAKE_BTC: f64 = 1.5;
pub const POINTS_MULTIPLIER_STAKE_STABLECOIN: f64 = 1.0;
pub const POINTS_MULTIPLIER_STAKE_LP: f64 = 5.0;

// NFT discount tiers
pub const NFT_TIER_1_DISCOUNT: f64 = 5.0; // Bronze
pub const NFT_TIER_2_DISCOUNT: f64 = 10.0; // Silver
pub const NFT_TIER_3_DISCOUNT: f64 = 25.0; // Gold
pub const NFT_TIER_4_DISCOUNT: f64 = 35.0; // Platinum
pub const NFT_TIER_5_DISCOUNT: f64 = 50.0; // Onyx
pub const NFT_TIER_6_DISCOUNT: f64 = 50.0; // reserved

// Epoch configuration
pub const EPOCH_DURATION_SECONDS: i64 = 2592000; // 30 days

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
