use serde::Deserialize;
use std::env;
use std::fs;
use std::path::Path;

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

    // Background workers
    pub point_calculator_batch_size: u32,
    pub point_calculator_max_batches_per_tick: u32,

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
    pub staking_carel_address: Option<String>,
    pub discount_soulbound_address: Option<String>,
    pub treasury_address: Option<String>,
    pub referral_system_address: Option<String>,
    pub ai_executor_address: String,
    pub ai_signature_verifier_address: Option<String>,
    pub bridge_aggregator_address: String,
    pub zk_privacy_router_address: String,
    pub battleship_garaga_address: Option<String>,
    pub privacy_router_address: Option<String>,
    pub privacy_auto_garaga_payload_file: Option<String>,
    pub privacy_auto_garaga_proof_file: Option<String>,
    pub privacy_auto_garaga_public_inputs_file: Option<String>,
    pub privacy_auto_garaga_prover_cmd: Option<String>,
    pub privacy_auto_garaga_prover_timeout_ms: u64,
    pub private_btc_swap_address: String,
    pub dark_pool_address: String,
    pub private_payments_address: String,
    pub anonymous_credentials_address: String,
    // Token Addresses
    pub token_strk_address: Option<String>,
    pub token_eth_address: Option<String>,
    pub token_btc_address: Option<String>,
    pub token_strk_l1_address: Option<String>,

    // Faucet
    pub faucet_btc_amount: Option<f64>,
    pub faucet_strk_amount: Option<f64>,
    pub faucet_carel_amount: Option<f64>,
    pub faucet_cooldown_hours: Option<u64>,

    // Backend Signing
    pub backend_private_key: String,
    pub backend_public_key: String,
    pub backend_account_address: Option<String>,

    // JWT
    pub jwt_secret: String,
    pub jwt_expiry_hours: u64,

    // External APIs
    pub llm_api_key: Option<String>,
    pub llm_api_url: Option<String>,
    pub llm_model: Option<String>,
    pub openai_api_key: Option<String>,
    pub cairo_coder_api_key: Option<String>,
    pub cairo_coder_api_url: String,
    pub cairo_coder_model: Option<String>,
    pub gemini_api_key: Option<String>,
    pub gemini_api_url: String,
    pub gemini_model: String,
    pub ai_llm_rewrite_timeout_ms: u64,
    pub twitter_bearer_token: Option<String>,
    pub telegram_bot_token: Option<String>,
    pub discord_bot_token: Option<String>,
    pub social_tasks_json: Option<String>,
    pub admin_manual_key: Option<String>,
    pub dev_wallet_address: Option<String>,
    pub ai_level_burn_address: Option<String>,
    pub layerswap_api_key: Option<String>,
    pub layerswap_api_url: String,
    pub atomiq_api_key: Option<String>,
    pub atomiq_api_url: String,
    pub garden_api_key: Option<String>,
    pub garden_api_url: String,
    pub sumo_login_api_key: Option<String>,
    pub sumo_login_api_url: String,
    pub xverse_api_key: Option<String>,
    pub xverse_api_url: String,
    pub privacy_verifier_routers: String,

    // Payment Providers
    pub stripe_secret_key: Option<String>,
    pub moonpay_api_key: Option<String>,

    // Rate Limiting
    pub rate_limit_public: u32,
    pub rate_limit_authenticated: u32,
    pub ai_rate_limit_window_seconds: u64,
    pub ai_rate_limit_global_per_window: u32,
    pub ai_rate_limit_level_1_per_window: u32,
    pub ai_rate_limit_level_2_per_window: u32,
    pub ai_rate_limit_level_3_per_window: u32,

    // CORS
    pub cors_allowed_origins: String,
    pub oracle_asset_ids: String,
    pub bridge_provider_ids: String,
    pub price_tokens: String,
    pub coingecko_api_url: String,
    pub coingecko_api_key: Option<String>,
    pub coingecko_ids: String,
}

impl Config {
    /// Handles `from_env` logic.
    ///
    /// # Arguments
    /// * Uses function parameters as validated input and runtime context.
    ///
    /// # Returns
    /// * `Ok(...)` when processing succeeds.
    /// * `Err(AppError)` when validation, authorization, or integration checks fail.
    ///
    /// # Notes
    /// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
    pub fn from_env() -> anyhow::Result<Self> {
        load_env_override(&[".env", "backend-rust/.env"]);

        let privacy_auto_garaga_payload_file = env::var("PRIVACY_AUTO_GARAGA_PAYLOAD_FILE")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or_else(|| {
                for candidate in ["garaga_payload.json", "backend-rust/garaga_payload.json"] {
                    if Path::new(candidate).is_file() {
                        return Some(candidate.to_string());
                    }
                }
                None
            });

        let privacy_auto_garaga_prover_cmd = env::var("PRIVACY_AUTO_GARAGA_PROVER_CMD")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or_else(|| {
                for candidate in [
                    "scripts/garaga_auto_prover.py",
                    "backend-rust/scripts/garaga_auto_prover.py",
                ] {
                    if Path::new(candidate).is_file() {
                        return Some(format!("python3 {}", candidate));
                    }
                }
                None
            });

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

            redis_url: env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://localhost:6379".to_string()),

            point_calculator_batch_size: env::var("POINT_CALCULATOR_BATCH_SIZE")
                .unwrap_or_else(|_| "500".to_string())
                .parse()?,
            point_calculator_max_batches_per_tick: env::var(
                "POINT_CALCULATOR_MAX_BATCHES_PER_TICK",
            )
            .unwrap_or_else(|_| "20".to_string())
            .parse()?,

            starknet_rpc_url: env::var("STARKNET_RPC_URL")?,
            starknet_chain_id: env::var("STARKNET_CHAIN_ID")
                .unwrap_or_else(|_| "SN_MAIN".to_string()),
            ethereum_rpc_url: env::var("ETHEREUM_RPC_URL")?,

            carel_token_address: env::var("CAREL_TOKEN_ADDRESS")?,
            snapshot_distributor_address: env::var("SNAPSHOT_DISTRIBUTOR_ADDRESS")?,
            point_storage_address: env::var("POINT_STORAGE_ADDRESS")?,
            price_oracle_address: env::var("PRICE_ORACLE_ADDRESS")?,
            limit_order_book_address: env::var("LIMIT_ORDER_BOOK_ADDRESS")?,
            staking_carel_address: env::var("STAKING_CAREL_ADDRESS").ok(),
            discount_soulbound_address: env::var("DISCOUNT_SOULBOUND_ADDRESS").ok(),
            treasury_address: env::var("TREASURY_ADDRESS").ok(),
            referral_system_address: env::var("REFERRAL_SYSTEM_ADDRESS").ok(),
            ai_executor_address: env::var("AI_EXECUTOR_ADDRESS")?,
            ai_signature_verifier_address: env::var("AI_SIGNATURE_VERIFIER_ADDRESS").ok(),
            bridge_aggregator_address: env::var("BRIDGE_AGGREGATOR_ADDRESS")?,
            zk_privacy_router_address: env::var("ZK_PRIVACY_ROUTER_ADDRESS")?,
            battleship_garaga_address: env::var("BATTLESHIP_GARAGA_ADDRESS")
                .ok()
                .or_else(|| env::var("BATTLESHIP_CONTRACT_ADDRESS").ok()),
            privacy_router_address: env::var("PRIVACY_ROUTER_ADDRESS").ok(),
            privacy_auto_garaga_payload_file,
            privacy_auto_garaga_proof_file: env::var("PRIVACY_AUTO_GARAGA_PROOF_FILE").ok(),
            privacy_auto_garaga_public_inputs_file: env::var(
                "PRIVACY_AUTO_GARAGA_PUBLIC_INPUTS_FILE",
            )
            .ok(),
            privacy_auto_garaga_prover_cmd,
            privacy_auto_garaga_prover_timeout_ms: env::var(
                "PRIVACY_AUTO_GARAGA_PROVER_TIMEOUT_MS",
            )
            .unwrap_or_else(|_| "45000".to_string())
            .parse()?,
            private_btc_swap_address: env::var("PRIVATE_BTC_SWAP_ADDRESS")?,
            dark_pool_address: env::var("DARK_POOL_ADDRESS")?,
            private_payments_address: env::var("PRIVATE_PAYMENTS_ADDRESS")?,
            anonymous_credentials_address: env::var("ANONYMOUS_CREDENTIALS_ADDRESS")?,

            token_strk_address: env::var("TOKEN_STRK_ADDRESS").ok(),
            token_eth_address: env::var("TOKEN_ETH_ADDRESS").ok(),
            token_btc_address: env::var("TOKEN_BTC_ADDRESS").ok(),
            token_strk_l1_address: env::var("TOKEN_STRK_L1_ADDRESS").ok(),

            faucet_btc_amount: env::var("FAUCET_BTC_AMOUNT")
                .ok()
                .and_then(|s| s.parse().ok()),
            faucet_strk_amount: env::var("FAUCET_STRK_AMOUNT")
                .ok()
                .and_then(|s| s.parse().ok()),
            faucet_carel_amount: env::var("FAUCET_CAREL_AMOUNT")
                .ok()
                .and_then(|s| s.parse().ok()),
            faucet_cooldown_hours: env::var("FAUCET_COOLDOWN_HOURS")
                .ok()
                .and_then(|s| s.parse().ok()),

            backend_private_key: env::var("BACKEND_PRIVATE_KEY")?,
            backend_public_key: env::var("BACKEND_PUBLIC_KEY")?,
            backend_account_address: env::var("BACKEND_ACCOUNT_ADDRESS").ok(),

            jwt_secret: env::var("JWT_SECRET")?,
            jwt_expiry_hours: env::var("JWT_EXPIRY_HOURS")
                .unwrap_or_else(|_| "24".to_string())
                .parse()?,

            llm_api_key: env::var("LLM_API_KEY")
                .ok()
                .or_else(|| env::var("GROQ_API_KEY").ok()),
            llm_api_url: env::var("LLM_API_URL")
                .ok()
                .or_else(|| env::var("GROQ_API_URL").ok())
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            llm_model: env::var("LLM_MODEL")
                .ok()
                .or_else(|| env::var("GROQ_MODEL").ok())
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            openai_api_key: env::var("OPENAI_API_KEY").ok(),
            cairo_coder_api_key: env::var("CAIRO_CODER_API_KEY").ok(),
            cairo_coder_api_url: env::var("CAIRO_CODER_API_URL")
                .unwrap_or_else(|_| "https://api.cairo-coder.com/v1/chat/completions".to_string()),
            cairo_coder_model: env::var("CAIRO_CODER_MODEL")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            gemini_api_key: env::var("GEMINI_API_KEY")
                .ok()
                .or_else(|| env::var("GOOGLE_GEMINI_API_KEY").ok()),
            gemini_api_url: env::var("GEMINI_API_URL")
                .unwrap_or_else(|_| "https://generativelanguage.googleapis.com/v1beta".to_string()),
            gemini_model: env::var("GEMINI_MODEL")
                .unwrap_or_else(|_| "gemini-2.0-flash".to_string()),
            ai_llm_rewrite_timeout_ms: env::var("AI_LLM_REWRITE_TIMEOUT_MS")
                .unwrap_or_else(|_| "8000".to_string())
                .parse()?,
            twitter_bearer_token: env::var("TWITTER_BEARER_TOKEN").ok(),
            telegram_bot_token: env::var("TELEGRAM_BOT_TOKEN").ok(),
            discord_bot_token: env::var("DISCORD_BOT_TOKEN").ok(),
            social_tasks_json: env::var("SOCIAL_TASKS_JSON").ok(),
            admin_manual_key: env::var("ADMIN_MANUAL_KEY").ok(),
            dev_wallet_address: env::var("DEV_WALLET_ADDRESS")
                .ok()
                .or_else(|| env::var("DEV_WALLET").ok()),
            ai_level_burn_address: env::var("AI_LEVEL_BURN_ADDRESS")
                .ok()
                .or_else(|| env::var("CAREL_BURN_ADDRESS").ok())
                .or_else(|| env::var("BURN_WALLET_ADDRESS").ok()),
            layerswap_api_key: env::var("LAYERSWAP_API_KEY").ok(),
            layerswap_api_url: env::var("LAYERSWAP_API_URL")
                .unwrap_or_else(|_| "https://api.layerswap.io/api/v2".to_string()),
            atomiq_api_key: env::var("ATOMIQ_API_KEY").ok(),
            atomiq_api_url: env::var("ATOMIQ_API_URL").unwrap_or_else(|_| "".to_string()),
            garden_api_key: env::var("GARDEN_APP_ID")
                .ok()
                .or_else(|| env::var("GARDEN_API_KEY").ok()),
            garden_api_url: env::var("GARDEN_API_URL").unwrap_or_else(|_| "".to_string()),
            sumo_login_api_key: env::var("SUMO_LOGIN_API_KEY").ok(),
            sumo_login_api_url: env::var("SUMO_LOGIN_API_URL").unwrap_or_else(|_| "".to_string()),
            xverse_api_key: env::var("XVERSE_API_KEY").ok(),
            xverse_api_url: env::var("XVERSE_API_URL").unwrap_or_else(|_| "".to_string()),
            privacy_verifier_routers: env::var("PRIVACY_VERIFIER_ROUTERS")
                .unwrap_or_else(|_| "".to_string()),

            stripe_secret_key: env::var("STRIPE_SECRET_KEY").ok(),
            moonpay_api_key: env::var("MOONPAY_API_KEY").ok(),

            rate_limit_public: env::var("RATE_LIMIT_PUBLIC")
                .unwrap_or_else(|_| "100".to_string())
                .parse()?,
            rate_limit_authenticated: env::var("RATE_LIMIT_AUTHENTICATED")
                .unwrap_or_else(|_| "300".to_string())
                .parse()?,
            ai_rate_limit_window_seconds: env::var("AI_RATE_LIMIT_WINDOW_SECONDS")
                .unwrap_or_else(|_| "60".to_string())
                .parse()?,
            ai_rate_limit_global_per_window: env::var("AI_RATE_LIMIT_GLOBAL_PER_WINDOW")
                .unwrap_or_else(|_| "40".to_string())
                .parse()?,
            ai_rate_limit_level_1_per_window: env::var("AI_RATE_LIMIT_LEVEL_1_PER_WINDOW")
                .unwrap_or_else(|_| "20".to_string())
                .parse()?,
            ai_rate_limit_level_2_per_window: env::var("AI_RATE_LIMIT_LEVEL_2_PER_WINDOW")
                .unwrap_or_else(|_| "10".to_string())
                .parse()?,
            ai_rate_limit_level_3_per_window: env::var("AI_RATE_LIMIT_LEVEL_3_PER_WINDOW")
                .unwrap_or_else(|_| "8".to_string())
                .parse()?,

            cors_allowed_origins: env::var("CORS_ALLOWED_ORIGINS")
                .unwrap_or_else(|_| "*".to_string()),
            oracle_asset_ids: env::var("ORACLE_ASSET_IDS").unwrap_or_else(|_| "".to_string()),
            bridge_provider_ids: env::var("BRIDGE_PROVIDER_IDS").unwrap_or_else(|_| "".to_string()),
            price_tokens: env::var("PRICE_TOKENS")
                .unwrap_or_else(|_| "BTC,ETH,STRK,CAREL,USDT,USDC".to_string()),
            coingecko_api_url: env::var("COINGECKO_API_URL")
                .unwrap_or_else(|_| "https://api.coingecko.com/api/v3".to_string()),
            coingecko_api_key: env::var("COINGECKO_API_KEY").ok(),
            coingecko_ids: env::var("COINGECKO_IDS").unwrap_or_else(|_| "".to_string()),
        })
    }

    /// Handles `validate` logic.
    ///
    /// # Arguments
    /// * Uses function parameters as validated input and runtime context.
    ///
    /// # Returns
    /// * `Ok(...)` when processing succeeds.
    /// * `Err(AppError)` when validation, authorization, or integration checks fail.
    ///
    /// # Notes
    /// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
    pub fn validate(&self) -> anyhow::Result<()> {
        if self.database_url.trim().is_empty() {
            anyhow::bail!("DATABASE_URL is empty");
        }
        if self.starknet_rpc_url.trim().is_empty() {
            anyhow::bail!("STARKNET_RPC_URL is empty");
        }
        if self.ethereum_rpc_url.trim().is_empty() {
            anyhow::bail!("ETHEREUM_RPC_URL is empty");
        }
        if self.backend_private_key.trim().is_empty() || self.backend_public_key.trim().is_empty() {
            anyhow::bail!("Backend signing keys are missing");
        }
        if self.jwt_secret.trim().is_empty() {
            anyhow::bail!("JWT_SECRET is empty");
        }

        if is_placeholder_address(&self.carel_token_address) {
            tracing::warn!("Using placeholder CAREL token address");
        }
        if is_placeholder_address(&self.snapshot_distributor_address) {
            tracing::warn!("Using placeholder snapshot distributor address");
        }
        if is_placeholder_address(&self.point_storage_address) {
            tracing::warn!("Using placeholder point storage address");
        }
        if is_placeholder_address(&self.price_oracle_address) {
            tracing::warn!("Using placeholder price oracle address");
        }
        if is_placeholder_address(&self.limit_order_book_address) {
            tracing::warn!("Using placeholder limit order book address");
        }
        if let Some(addr) = &self.staking_carel_address {
            if is_placeholder_address(addr) {
                tracing::warn!("Using placeholder staking carel address");
            }
        }
        if let Some(addr) = &self.discount_soulbound_address {
            if is_placeholder_address(addr) {
                tracing::warn!("Using placeholder discount soulbound address");
            }
        }
        if let Some(addr) = &self.treasury_address {
            if is_placeholder_address(addr) {
                tracing::warn!("Using placeholder treasury address");
            }
        }
        if is_placeholder_address(&self.ai_executor_address) {
            tracing::warn!("Using placeholder AI executor address");
        }
        if let Some(addr) = &self.ai_signature_verifier_address {
            if is_placeholder_address(addr) {
                tracing::warn!("Using placeholder AI signature verifier address");
            }
        }
        if let Some(addr) = &self.dev_wallet_address {
            if is_placeholder_address(addr) {
                tracing::warn!("Using placeholder DEV wallet address");
            }
        }
        if self
            .treasury_address
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty() && !is_placeholder_address(value))
            .is_none()
        {
            tracing::warn!(
                "TREASURY_ADDRESS is not configured; AI level upgrade payment verification will fail"
            );
        }
        if let Some(addr) = &self.ai_level_burn_address {
            if !addr.trim().is_empty() {
                tracing::warn!(
                    "AI_LEVEL_BURN_ADDRESS is legacy for AI upgrades. Upgrade payment verification now uses TREASURY_ADDRESS."
                );
            }
        }
        if is_placeholder_address(&self.bridge_aggregator_address) {
            tracing::warn!("Using placeholder bridge aggregator address");
        }
        if is_placeholder_address(&self.zk_privacy_router_address) {
            tracing::warn!("Using placeholder ZK privacy router address");
        }
        if is_placeholder_address(&self.private_btc_swap_address) {
            tracing::warn!("Using placeholder private BTC swap address");
        }
        if is_placeholder_address(&self.dark_pool_address) {
            tracing::warn!("Using placeholder dark pool address");
        }
        if is_placeholder_address(&self.private_payments_address) {
            tracing::warn!("Using placeholder private payments address");
        }
        if is_placeholder_address(&self.anonymous_credentials_address) {
            tracing::warn!("Using placeholder anonymous credentials address");
        }

        let using_dev_credentials =
            self.backend_private_key.contains("123456") || self.jwt_secret.contains("super_secret");
        if using_dev_credentials {
            let env = self.environment.to_ascii_lowercase();
            let is_non_production =
                matches!(env.as_str(), "development" | "dev" | "local" | "testnet");
            if is_non_production {
                tracing::debug!("Detected dev credentials in config (development mode)");
            } else {
                tracing::warn!("Detected dev credentials in config");
            }
        }

        if self.rate_limit_public == 0 || self.rate_limit_authenticated == 0 {
            tracing::warn!("Rate limit values should be > 0");
        }
        if self.point_calculator_batch_size == 0 {
            tracing::warn!("POINT_CALCULATOR_BATCH_SIZE should be > 0");
        }
        if self.point_calculator_max_batches_per_tick == 0 {
            tracing::warn!("POINT_CALCULATOR_MAX_BATCHES_PER_TICK should be > 0");
        }
        if self.ai_rate_limit_window_seconds == 0
            || self.ai_rate_limit_global_per_window == 0
            || self.ai_rate_limit_level_1_per_window == 0
            || self.ai_rate_limit_level_2_per_window == 0
            || self.ai_rate_limit_level_3_per_window == 0
        {
            tracing::warn!("AI rate limit values should be > 0");
        }
        if self.ai_llm_rewrite_timeout_ms == 0 {
            tracing::warn!("AI_LLM_REWRITE_TIMEOUT_MS is 0; fallback default will be used");
        }

        if self.cors_allowed_origins.trim().is_empty() {
            tracing::warn!("CORS_ALLOWED_ORIGINS is empty; requests may be blocked");
        }

        let _ = &self.llm_api_key;
        let _ = &self.llm_api_url;
        let _ = &self.llm_model;
        let _ = &self.openai_api_key;
        let _ = &self.cairo_coder_api_key;
        let _ = &self.cairo_coder_api_url;
        let _ = &self.cairo_coder_model;
        let _ = &self.gemini_api_key;
        let _ = &self.gemini_api_url;
        let _ = &self.gemini_model;
        let _ = &self.ai_llm_rewrite_timeout_ms;
        let _ = &self.twitter_bearer_token;
        let _ = &self.telegram_bot_token;
        let _ = &self.discord_bot_token;
        let _ = &self.social_tasks_json;
        let _ = &self.admin_manual_key;
        let _ = &self.dev_wallet_address;
        let _ = &self.ai_level_burn_address;
        let _ = &self.layerswap_api_key;
        let _ = &self.layerswap_api_url;
        let _ = &self.atomiq_api_key;
        let _ = &self.atomiq_api_url;
        let _ = &self.garden_api_key;
        let _ = &self.garden_api_url;
        let _ = &self.sumo_login_api_key;
        let _ = &self.sumo_login_api_url;
        let _ = &self.xverse_api_key;
        let _ = &self.xverse_api_url;
        let _ = &self.privacy_verifier_routers;
        let _ = &self.privacy_auto_garaga_payload_file;
        let _ = &self.privacy_auto_garaga_proof_file;
        let _ = &self.privacy_auto_garaga_public_inputs_file;
        let _ = &self.privacy_auto_garaga_prover_cmd;
        let _ = &self.privacy_auto_garaga_prover_timeout_ms;
        let _ = &self.stripe_secret_key;
        let _ = &self.moonpay_api_key;
        let _ = &self.starknet_chain_id;
        let _ = &self.oracle_asset_ids;
        let _ = &self.bridge_provider_ids;
        let _ = &self.price_tokens;
        let _ = &self.coingecko_api_url;
        let _ = &self.coingecko_api_key;
        let _ = &self.coingecko_ids;

        Ok(())
    }

    /// Checks conditions for `is_testnet`.
    ///
    /// # Arguments
    /// * Uses function parameters as validated input and runtime context.
    ///
    /// # Returns
    /// * `Ok(...)` when processing succeeds.
    /// * `Err(AppError)` when validation, authorization, or integration checks fail.
    ///
    /// # Notes
    /// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
    pub fn is_testnet(&self) -> bool {
        if self.environment == "development" || self.environment == "testnet" {
            return true;
        }
        let chain = self.starknet_chain_id.to_ascii_uppercase();
        chain.contains("SEPOLIA") || chain.contains("GOERLI")
    }
}

// Internal helper that supports `load_env_override` operations.
fn load_env_override(paths: &[&str]) {
    for path in paths {
        let Ok(content) = fs::read_to_string(path) else {
            continue;
        };
        for raw_line in content.lines() {
            let line = raw_line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let Some((raw_key, raw_value)) = line.split_once('=') else {
                continue;
            };
            let key = raw_key.trim();
            if key.is_empty() {
                continue;
            }
            let mut value = raw_value.trim().to_string();
            if (value.starts_with('"') && value.ends_with('"'))
                || (value.starts_with('\'') && value.ends_with('\''))
            {
                value = value[1..value.len().saturating_sub(1)].to_string();
            }
            unsafe {
                env::set_var(key, value);
            }
        }
        return;
    }
}

impl Config {
    /// Handles `oracle_asset_id_for` logic.
    ///
    /// # Arguments
    /// * Uses function parameters as validated input and runtime context.
    ///
    /// # Returns
    /// * `Ok(...)` when processing succeeds.
    /// * `Err(AppError)` when validation, authorization, or integration checks fail.
    ///
    /// # Notes
    /// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
    pub fn oracle_asset_id_for(&self, symbol: &str) -> Option<String> {
        parse_kv_map(&self.oracle_asset_ids, symbol)
    }

    /// Handles `bridge_provider_id_for` logic.
    ///
    /// # Arguments
    /// * Uses function parameters as validated input and runtime context.
    ///
    /// # Returns
    /// * `Ok(...)` when processing succeeds.
    /// * `Err(AppError)` when validation, authorization, or integration checks fail.
    ///
    /// # Notes
    /// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
    pub fn bridge_provider_id_for(&self, provider: &str) -> Option<String> {
        parse_kv_map(&self.bridge_provider_ids, provider)
    }

    /// Handles `price_tokens_list` logic.
    ///
    /// # Arguments
    /// * Uses function parameters as validated input and runtime context.
    ///
    /// # Returns
    /// * `Ok(...)` when processing succeeds.
    /// * `Err(AppError)` when validation, authorization, or integration checks fail.
    ///
    /// # Notes
    /// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
    pub fn price_tokens_list(&self) -> Vec<String> {
        let raw = self.price_tokens.trim();
        if raw.is_empty() {
            return vec![
                "BTC".to_string(),
                "ETH".to_string(),
                "STRK".to_string(),
                "CAREL".to_string(),
                "USDT".to_string(),
                "USDC".to_string(),
            ];
        }
        raw.split(',')
            .map(|token| token.trim().to_ascii_uppercase())
            .filter(|token| !token.is_empty())
            .collect()
    }

    /// Handles `coingecko_id_for` logic.
    ///
    /// # Arguments
    /// * Uses function parameters as validated input and runtime context.
    ///
    /// # Returns
    /// * `Ok(...)` when processing succeeds.
    /// * `Err(AppError)` when validation, authorization, or integration checks fail.
    ///
    /// # Notes
    /// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
    pub fn coingecko_id_for(&self, symbol: &str) -> Option<String> {
        parse_kv_map(&self.coingecko_ids, symbol)
    }

    /// Handles `privacy_router_for_verifier` logic.
    ///
    /// # Arguments
    /// * Uses function parameters as validated input and runtime context.
    ///
    /// # Returns
    /// * `Ok(...)` when processing succeeds.
    /// * `Err(AppError)` when validation, authorization, or integration checks fail.
    ///
    /// # Notes
    /// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
    pub fn privacy_router_for_verifier(&self, verifier: &str) -> Option<String> {
        parse_kv_map(&self.privacy_verifier_routers, verifier)
    }
}

// Internal helper that parses or transforms values for `parse_kv_map`.
fn parse_kv_map(raw: &str, key: &str) -> Option<String> {
    if raw.trim().is_empty() {
        return None;
    }
    raw.split(',')
        .filter_map(|entry| {
            let trimmed = entry.trim();
            let (k, v) = trimmed
                .split_once('=')
                .or_else(|| trimmed.split_once(':'))?;
            let k = k.trim();
            let v = v.trim();
            if k.eq_ignore_ascii_case(key) {
                Some(v.to_string())
            } else {
                None
            }
        })
        .next()
}

// Internal helper that checks conditions for `is_placeholder_address`.
fn is_placeholder_address(address: &str) -> bool {
    let trimmed = address.trim();
    if trimmed.is_empty() {
        return true;
    }
    if trimmed == "0x..." {
        return true;
    }
    if !trimmed.starts_with("0x") {
        return false;
    }
    let hex = trimmed.trim_start_matches("0x");
    if hex.is_empty() {
        return true;
    }
    hex.chars().all(|c| c == '0')
}
