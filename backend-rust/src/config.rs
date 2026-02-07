use serde::Deserialize;
use std::env;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    // Server
    pub host: String,
    pub port: u16,
    pub environment: String,
    
    // Database
    pub database_url: String,
    pub database_max_connections: u32,
    
    // Redis
    pub redis_url: String,
    
    // Blockchain
    pub starknet_rpc_url: String,
    pub starknet_chain_id: String,
    pub ethereum_rpc_url: String,
    
    // Contract Addresses
    pub carel_token_address: String,
    pub snapshot_distributor_address: String,
    pub point_storage_address: String,
    pub price_oracle_address: String,
    pub limit_order_book_address: String,
    
    // Faucet
    pub faucet_wallet_private_key: Option<String>,
    pub faucet_btc_amount: Option<f64>,
    pub faucet_strk_amount: Option<f64>,
    pub faucet_carel_amount: Option<f64>,
    pub faucet_cooldown_hours: Option<u64>,
    
    // Backend Signing
    pub backend_private_key: String,
    pub backend_public_key: String,
    
    // JWT
    pub jwt_secret: String,
    pub jwt_expiry_hours: u64,
    
    // External APIs
    pub openai_api_key: Option<String>,
    pub twitter_bearer_token: Option<String>,
    pub telegram_bot_token: Option<String>,
    pub discord_bot_token: Option<String>,
    
    // Payment Providers
    pub stripe_secret_key: Option<String>,
    pub moonpay_api_key: Option<String>,
    
    // Rate Limiting
    pub rate_limit_public: u32,
    pub rate_limit_authenticated: u32,
    
    // CORS
    pub cors_allowed_origins: String,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        dotenv::dotenv().ok();
        
        Ok(Config {
            host: env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port: env::var("PORT")
                .unwrap_or_else(|_| "3000".to_string())
                .parse()?,
            environment: env::var("ENVIRONMENT").unwrap_or_else(|_| "development".to_string()),
            
            database_url: env::var("DATABASE_URL")?,
            database_max_connections: env::var("DATABASE_MAX_CONNECTIONS")
                .unwrap_or_else(|_| "100".to_string())
                .parse()?,
            
            redis_url: env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6379".to_string()),
            
            starknet_rpc_url: env::var("STARKNET_RPC_URL")?,
            starknet_chain_id: env::var("STARKNET_CHAIN_ID").unwrap_or_else(|_| "SN_MAIN".to_string()),
            ethereum_rpc_url: env::var("ETHEREUM_RPC_URL")?,
            
            carel_token_address: env::var("CAREL_TOKEN_ADDRESS")?,
            snapshot_distributor_address: env::var("SNAPSHOT_DISTRIBUTOR_ADDRESS")?,
            point_storage_address: env::var("POINT_STORAGE_ADDRESS")?,
            price_oracle_address: env::var("PRICE_ORACLE_ADDRESS")?,
            limit_order_book_address: env::var("LIMIT_ORDER_BOOK_ADDRESS")?,
            
            faucet_wallet_private_key: env::var("FAUCET_WALLET_PRIVATE_KEY").ok(),
            faucet_btc_amount: env::var("FAUCET_BTC_AMOUNT").ok().and_then(|s| s.parse().ok()),
            faucet_strk_amount: env::var("FAUCET_STRK_AMOUNT").ok().and_then(|s| s.parse().ok()),
            faucet_carel_amount: env::var("FAUCET_CAREL_AMOUNT").ok().and_then(|s| s.parse().ok()),
            faucet_cooldown_hours: env::var("FAUCET_COOLDOWN_HOURS").ok().and_then(|s| s.parse().ok()),
            
            backend_private_key: env::var("BACKEND_PRIVATE_KEY")?,
            backend_public_key: env::var("BACKEND_PUBLIC_KEY")?,
            
            jwt_secret: env::var("JWT_SECRET")?,
            jwt_expiry_hours: env::var("JWT_EXPIRY_HOURS")
                .unwrap_or_else(|_| "24".to_string())
                .parse()?,
            
            openai_api_key: env::var("OPENAI_API_KEY").ok(),
            twitter_bearer_token: env::var("TWITTER_BEARER_TOKEN").ok(),
            telegram_bot_token: env::var("TELEGRAM_BOT_TOKEN").ok(),
            discord_bot_token: env::var("DISCORD_BOT_TOKEN").ok(),
            
            stripe_secret_key: env::var("STRIPE_SECRET_KEY").ok(),
            moonpay_api_key: env::var("MOONPAY_API_KEY").ok(),
            
            rate_limit_public: env::var("RATE_LIMIT_PUBLIC")
                .unwrap_or_else(|_| "100".to_string())
                .parse()?,
            rate_limit_authenticated: env::var("RATE_LIMIT_AUTHENTICATED")
                .unwrap_or_else(|_| "300".to_string())
                .parse()?,
            
            cors_allowed_origins: env::var("CORS_ALLOWED_ORIGINS")
                .unwrap_or_else(|_| "*".to_string()),
        })
    }
    
    pub fn is_testnet(&self) -> bool {
        self.environment == "development" || self.environment == "testnet"
    }
}