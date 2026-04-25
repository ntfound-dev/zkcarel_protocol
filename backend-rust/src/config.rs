use serde::Deserialize;
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    // Server
    pub host: String,
    pub port: u16,
    pub environment: String,
    pub app_base_url: Option<String>,

    // Database
    pub database_url: String,
    pub database_max_connections: u32,
    pub database_connect_timeout_secs: u64,
    pub database_connect_retries: u32,
    pub database_connect_retry_delay_ms: u64,

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
    pub ai_plan_router_address: Option<String>,
    pub ai_identity_registry_address: Option<String>,
    pub ai_agent_id: Option<String>,
    pub bridge_aggregator_address: String,
    pub zk_privacy_router_address: String,
    pub battleship_garaga_address: Option<String>,
    pub privacy_router_address: Option<String>,
    #[allow(dead_code)]
    pub privacy_auto_garaga_payload_file: Option<String>,
    #[allow(dead_code)]
    pub privacy_auto_garaga_proof_file: Option<String>,
    #[allow(dead_code)]
    pub privacy_auto_garaga_public_inputs_file: Option<String>,
    pub privacy_auto_garaga_prover_cmd: Option<String>,
    pub privacy_auto_garaga_prover_sha256: Option<String>,
    pub privacy_auto_garaga_prover_timeout_ms: u64,
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
    pub admin_reset_confirm_key: Option<String>,
    pub dev_wallet_address: Option<String>,
    pub ai_level_burn_address: Option<String>,
    pub layerswap_api_key: Option<String>,
    pub layerswap_api_url: String,
    pub atomiq_api_key: Option<String>,
    pub atomiq_api_url: String,
    pub garden_api_key: Option<String>,
    pub garden_api_url: String,
    pub xverse_api_key: Option<String>,
    pub xverse_api_url: String,
    pub privacy_verifier_routers: String,
    pub filecoin_backend: Option<String>,
    pub filecoin_pin_api_url: Option<String>,
    pub filecoin_pin_api_key: Option<String>,
    pub filecoin_synapse_script: Option<String>,
    pub filecoin_synapse_private_key: Option<String>,
    pub filecoin_synapse_rpc_url: Option<String>,
    pub filecoin_synapse_with_cdn: Option<bool>,
    pub filecoin_synapse_source: Option<String>,
    pub ipfs_api_url: Option<String>,
    pub ipfs_api_key: Option<String>,

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
    pub api_docs_enabled: bool,
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
        let env_overrides = load_env_override(&[
            ".env",
            "backend-rust/.env",
            "deploy.env",
            "backend-rust/deploy.env",
        ]);
        let env_value =
            |key: &str| -> Result<String, env::VarError> { env_with_override(&env_overrides, key) };
        let env_value_opt =
            |key: &str| -> Option<String> { env_with_override(&env_overrides, key).ok() };
        let env_value_default = |key: &str, default: &str| -> String {
            env_with_override(&env_overrides, key).unwrap_or_else(|_| default.to_string())
        };

        let privacy_auto_garaga_payload_file = env_value_opt("PRIVACY_AUTO_GARAGA_PAYLOAD_FILE")
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

        let privacy_auto_garaga_prover_cmd = env_value_opt("PRIVACY_AUTO_GARAGA_PROVER_CMD")
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .filter(|value| !value.contains(".py"))
            .or_else(|| {
                for candidate in [
                    "target/release/garaga_auto_prover",
                    "backend-rust/target/release/garaga_auto_prover",
                    "/usr/local/bin/garaga_auto_prover",
                    "/app/garaga_auto_prover",
                ] {
                    if Path::new(candidate).is_file() {
                        return Some(candidate.to_string());
                    }
                }
                None
            });
        let privacy_auto_garaga_prover_sha256 = env_value_opt("PRIVACY_AUTO_GARAGA_PROVER_SHA256")
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

        let environment = env_value_default("ENVIRONMENT", "development");
        let is_production_env = matches!(
            environment.trim().to_ascii_lowercase().as_str(),
            "production" | "prod" | "mainnet"
        );
        let api_docs_enabled = env_value_opt("API_DOCS_ENABLED")
            .map(|value| {
                matches!(
                    value.trim().to_ascii_lowercase().as_str(),
                    "1" | "true" | "yes" | "on"
                )
            })
            .unwrap_or(!is_production_env);

        Ok(Config {
            host: env_value_default("HOST", "0.0.0.0"),
            port: env_value_default("PORT", "3000").parse()?,
            environment,
            app_base_url: env_value_opt("APP_BASE_URL")
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),

            database_url: env_value("DATABASE_URL")?,
            database_max_connections: env_value_default("DATABASE_MAX_CONNECTIONS", "100")
                .parse()?,
            database_connect_timeout_secs: env_value_default("DATABASE_CONNECT_TIMEOUT_SECS", "10")
                .parse()?,
            database_connect_retries: env_value_default("DATABASE_CONNECT_RETRIES", "30")
                .parse()?,
            database_connect_retry_delay_ms: env_value_default(
                "DATABASE_CONNECT_RETRY_DELAY_MS",
                "1000",
            )
            .parse()?,

            redis_url: env_value_default("REDIS_URL", "redis://localhost:6379"),

            point_calculator_batch_size: env_value_default("POINT_CALCULATOR_BATCH_SIZE", "500")
                .parse()?,
            point_calculator_max_batches_per_tick: env_value_default(
                "POINT_CALCULATOR_MAX_BATCHES_PER_TICK",
                "20",
            )
            .parse()?,

            starknet_rpc_url: env_value("STARKNET_RPC_URL")?,
            starknet_chain_id: env_value_default("STARKNET_CHAIN_ID", "SN_MAIN"),
            ethereum_rpc_url: env_value("ETHEREUM_RPC_URL")?,

            carel_token_address: env_value("CAREL_TOKEN_ADDRESS")?,
            snapshot_distributor_address: env_value("SNAPSHOT_DISTRIBUTOR_ADDRESS")?,
            point_storage_address: env_value("POINT_STORAGE_ADDRESS")?,
            price_oracle_address: env_value("PRICE_ORACLE_ADDRESS")?,
            limit_order_book_address: env_value("LIMIT_ORDER_BOOK_ADDRESS")?,
            staking_carel_address: env_value_opt("STAKING_CAREL_ADDRESS"),
            discount_soulbound_address: env_value_opt("DISCOUNT_SOULBOUND_ADDRESS"),
            treasury_address: env_value_opt("TREASURY_ADDRESS"),
            referral_system_address: env_value_opt("REFERRAL_SYSTEM_ADDRESS"),
            ai_executor_address: env_value("AI_EXECUTOR_ADDRESS")?,
            ai_signature_verifier_address: env_value_opt("AI_SIGNATURE_VERIFIER_ADDRESS"),
            ai_plan_router_address: env_value_opt("AI_PLAN_ROUTER_ADDRESS"),
            ai_identity_registry_address: env_value_opt("AI_IDENTITY_REGISTRY_ADDRESS"),
            ai_agent_id: env_value_opt("AI_AGENT_ID"),
            bridge_aggregator_address: env_value("BRIDGE_AGGREGATOR_ADDRESS")?,
            zk_privacy_router_address: env_value("ZK_PRIVACY_ROUTER_ADDRESS")?,
            battleship_garaga_address: env_value_opt("BATTLESHIP_GARAGA_ADDRESS")
                .or_else(|| env_value_opt("BATTLESHIP_CONTRACT_ADDRESS")),
            privacy_router_address: env_value_opt("PRIVACY_ROUTER_ADDRESS"),
            privacy_auto_garaga_payload_file,
            privacy_auto_garaga_proof_file: env_value_opt("PRIVACY_AUTO_GARAGA_PROOF_FILE"),
            privacy_auto_garaga_public_inputs_file: env_value_opt(
                "PRIVACY_AUTO_GARAGA_PUBLIC_INPUTS_FILE",
            ),
            privacy_auto_garaga_prover_cmd,
            privacy_auto_garaga_prover_sha256,
            privacy_auto_garaga_prover_timeout_ms: env_value_default(
                "PRIVACY_AUTO_GARAGA_PROVER_TIMEOUT_MS",
                "45000",
            )
            .parse()?,

            token_strk_address: env_value_opt("TOKEN_STRK_ADDRESS"),
            token_eth_address: env_value_opt("TOKEN_ETH_ADDRESS"),
            token_btc_address: env_value_opt("TOKEN_BTC_ADDRESS"),
            token_strk_l1_address: env_value_opt("TOKEN_STRK_L1_ADDRESS"),

            faucet_btc_amount: env_value_opt("FAUCET_BTC_AMOUNT").and_then(|s| s.parse().ok()),
            faucet_strk_amount: env_value_opt("FAUCET_STRK_AMOUNT").and_then(|s| s.parse().ok()),
            faucet_carel_amount: env_value_opt("FAUCET_CAREL_AMOUNT").and_then(|s| s.parse().ok()),
            faucet_cooldown_hours: env_value_opt("FAUCET_COOLDOWN_HOURS")
                .and_then(|s| s.parse().ok()),

            backend_private_key: env_value("BACKEND_PRIVATE_KEY")?,
            backend_public_key: env_value("BACKEND_PUBLIC_KEY")?,
            backend_account_address: env_value_opt("BACKEND_ACCOUNT_ADDRESS"),

            jwt_secret: env_value("JWT_SECRET")?,
            jwt_expiry_hours: env_value_default("JWT_EXPIRY_HOURS", "24").parse()?,

            llm_api_key: env_value_opt("LLM_API_KEY").or_else(|| env_value_opt("GROQ_API_KEY")),
            llm_api_url: env_value_opt("LLM_API_URL")
                .or_else(|| env_value_opt("GROQ_API_URL"))
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            llm_model: env_value_opt("LLM_MODEL")
                .or_else(|| env_value_opt("GROQ_MODEL"))
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            openai_api_key: env_value_opt("OPENAI_API_KEY"),
            cairo_coder_api_key: env_value_opt("CAIRO_CODER_API_KEY"),
            cairo_coder_api_url: env_value_default(
                "CAIRO_CODER_API_URL",
                "https://api.cairo-coder.com/v1/chat/completions",
            ),
            cairo_coder_model: env_value_opt("CAIRO_CODER_MODEL")
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            gemini_api_key: env_value_opt("GEMINI_API_KEY")
                .or_else(|| env_value_opt("GOOGLE_GEMINI_API_KEY")),
            gemini_api_url: env_value_default(
                "GEMINI_API_URL",
                "https://generativelanguage.googleapis.com/v1beta",
            ),
            gemini_model: env_value_default("GEMINI_MODEL", "gemini-2.0-flash"),
            ai_llm_rewrite_timeout_ms: env_value_default("AI_LLM_REWRITE_TIMEOUT_MS", "8000")
                .parse()?,
            twitter_bearer_token: env_value_opt("TWITTER_BEARER_TOKEN"),
            telegram_bot_token: env_value_opt("TELEGRAM_BOT_TOKEN"),
            discord_bot_token: env_value_opt("DISCORD_BOT_TOKEN"),
            social_tasks_json: env_value_opt("SOCIAL_TASKS_JSON"),
            admin_manual_key: env_value_opt("ADMIN_MANUAL_KEY"),
            admin_reset_confirm_key: env_value_opt("ADMIN_RESET_CONFIRM_KEY"),
            dev_wallet_address: env_value_opt("DEV_WALLET_ADDRESS")
                .or_else(|| env_value_opt("DEV_WALLET")),
            ai_level_burn_address: env_value_opt("AI_LEVEL_BURN_ADDRESS")
                .or_else(|| env_value_opt("CAREL_BURN_ADDRESS"))
                .or_else(|| env_value_opt("BURN_WALLET_ADDRESS")),
            layerswap_api_key: env_value_opt("LAYERSWAP_API_KEY"),
            layerswap_api_url: env_value_default(
                "LAYERSWAP_API_URL",
                "https://api.layerswap.io/api/v2",
            ),
            atomiq_api_key: env_value_opt("ATOMIQ_API_KEY"),
            atomiq_api_url: env_value_default("ATOMIQ_API_URL", ""),
            garden_api_key: env_value_opt("GARDEN_APP_ID")
                .or_else(|| env_value_opt("GARDEN_API_KEY")),
            garden_api_url: env_value_default("GARDEN_API_URL", ""),
            xverse_api_key: env_value_opt("XVERSE_API_KEY"),
            xverse_api_url: env_value_default("XVERSE_API_URL", ""),
            privacy_verifier_routers: env_value_default("PRIVACY_VERIFIER_ROUTERS", ""),
            filecoin_backend: env_value_opt("FILECOIN_BACKEND")
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            filecoin_pin_api_url: env_value_opt("FILECOIN_PIN_API_URL")
                .or_else(|| env_value_opt("FILECOIN_PINNING_API_URL")),
            filecoin_pin_api_key: env_value_opt("FILECOIN_PIN_API_KEY")
                .or_else(|| env_value_opt("FILECOIN_PINNING_API_KEY"))
                .or_else(|| env_value_opt("FILECOIN_API_KEY")),
            filecoin_synapse_script: env_value_opt("FILECOIN_SYNAPSE_SCRIPT")
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .or_else(|| env_value_opt("SYNAPSE_SCRIPT"))
                .or_else(|| {
                    for candidate in [
                        "target/release/filecoin_synapse",
                        "backend-rust/target/release/filecoin_synapse",
                        "/usr/local/bin/filecoin_synapse",
                        "/app/filecoin_synapse",
                        "backend-rust/scripts/filecoin_synapse.mjs",
                        "scripts/filecoin_synapse.mjs",
                    ] {
                        if Path::new(candidate).is_file() {
                            return Some(candidate.to_string());
                        }
                    }
                    None
                }),
            filecoin_synapse_private_key: env_value_opt("FILECOIN_SYNAPSE_PRIVATE_KEY")
                .or_else(|| env_value_opt("SYNAPSE_PRIVATE_KEY")),
            filecoin_synapse_rpc_url: env_value_opt("FILECOIN_SYNAPSE_RPC_URL")
                .or_else(|| env_value_opt("SYNAPSE_RPC_URL")),
            filecoin_synapse_with_cdn: env_value_opt("FILECOIN_SYNAPSE_WITH_CDN")
                .or_else(|| env_value_opt("SYNAPSE_WITH_CDN"))
                .map(|value| {
                    matches!(
                        value.trim().to_ascii_lowercase().as_str(),
                        "1" | "true" | "yes" | "on"
                    )
                }),
            filecoin_synapse_source: env_value_opt("FILECOIN_SYNAPSE_SOURCE")
                .or_else(|| env_value_opt("SYNAPSE_SOURCE")),
            ipfs_api_url: env_value_opt("IPFS_NODE_URL").or_else(|| env_value_opt("IPFS_API_URL")),
            ipfs_api_key: env_value_opt("IPFS_API_KEY"),

            stripe_secret_key: env_value_opt("STRIPE_SECRET_KEY"),
            moonpay_api_key: env_value_opt("MOONPAY_API_KEY"),

            rate_limit_public: env_value_default("RATE_LIMIT_PUBLIC", "100").parse()?,
            rate_limit_authenticated: env_value_default("RATE_LIMIT_AUTHENTICATED", "300")
                .parse()?,
            ai_rate_limit_window_seconds: env_value_default("AI_RATE_LIMIT_WINDOW_SECONDS", "60")
                .parse()?,
            ai_rate_limit_global_per_window: env_value_default(
                "AI_RATE_LIMIT_GLOBAL_PER_WINDOW",
                "40",
            )
            .parse()?,
            ai_rate_limit_level_1_per_window: env_value_default(
                "AI_RATE_LIMIT_LEVEL_1_PER_WINDOW",
                "20",
            )
            .parse()?,
            ai_rate_limit_level_2_per_window: env_value_default(
                "AI_RATE_LIMIT_LEVEL_2_PER_WINDOW",
                "10",
            )
            .parse()?,
            ai_rate_limit_level_3_per_window: env_value_default(
                "AI_RATE_LIMIT_LEVEL_3_PER_WINDOW",
                "8",
            )
            .parse()?,

            api_docs_enabled,
            cors_allowed_origins: env_value_default("CORS_ALLOWED_ORIGINS", "*"),
            oracle_asset_ids: env_value_default("ORACLE_ASSET_IDS", ""),
            bridge_provider_ids: env_value_default("BRIDGE_PROVIDER_IDS", ""),
            price_tokens: env_value_default("PRICE_TOKENS", "BTC,ETH,STRK,CAREL,USDT,USDC"),
            coingecko_api_url: env_value_default(
                "COINGECKO_API_URL",
                "https://api.coingecko.com/api/v3",
            ),
            coingecko_api_key: env_value_opt("COINGECKO_API_KEY"),
            coingecko_ids: env_value_default("COINGECKO_IDS", ""),
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
        // dark_pool/private_payments/anonymous_credentials are legacy optional paths.
        // Do not warn when they are left as placeholders.

        let jwt_len = self.jwt_secret.trim().len();
        let weak_jwt_secret = jwt_len < 32;
        let using_dev_credentials = self.backend_private_key.contains("123456")
            || self.jwt_secret.contains("super_secret")
            || weak_jwt_secret;
        let is_production = is_production_env(&self.environment);
        if using_dev_credentials {
            let env = self.environment.to_ascii_lowercase();
            let is_non_production = !is_production
                && matches!(env.as_str(), "development" | "dev" | "local" | "testnet");
            if is_non_production {
                tracing::debug!("Detected dev credentials in config (development mode)");
            } else {
                tracing::warn!("Detected dev credentials in config");
            }
        }

        if is_production {
            if weak_jwt_secret {
                anyhow::bail!("JWT_SECRET must be at least 32 characters in production");
            }
            if is_placeholder_address(&self.ai_executor_address) {
                anyhow::bail!("AI_EXECUTOR_ADDRESS must be set to a real contract in production");
            }
            if self
                .ai_signature_verifier_address
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty() && !is_placeholder_address(value))
                .is_none()
            {
                anyhow::bail!(
                    "AI_SIGNATURE_VERIFIER_ADDRESS is required in production (real verifier contract)"
                );
            }
            if self
                .treasury_address
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty() && !is_placeholder_address(value))
                .is_none()
            {
                anyhow::bail!("TREASURY_ADDRESS is required in production");
            }
            if self
                .backend_account_address
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty() && !is_placeholder_address(value))
                .is_none()
            {
                anyhow::bail!("BACKEND_ACCOUNT_ADDRESS is required in production");
            }
            if env_truthy("AI_EXECUTOR_AUTO_DISABLE_SIGNATURE_VERIFICATION") {
                anyhow::bail!(
                    "AI_EXECUTOR_AUTO_DISABLE_SIGNATURE_VERIFICATION must be disabled in production"
                );
            }
            let verifier_mode = env::var("AI_SIGNATURE_VERIFIER_MODE")
                .unwrap_or_else(|_| "account".to_string())
                .trim()
                .to_ascii_lowercase();
            if verifier_mode == "allowlist" && !env_truthy("AI_ALLOWLIST_VERIFIER_ACCEPT_RISK") {
                anyhow::bail!(
                    "AI_SIGNATURE_VERIFIER_MODE=allowlist is blocked in production unless AI_ALLOWLIST_VERIFIER_ACCEPT_RISK=true"
                );
            }
            if using_dev_credentials {
                anyhow::bail!("Development credentials are not allowed in production");
            }
            let llm_configured = has_non_empty(&self.llm_api_key)
                || has_non_empty(&self.openai_api_key)
                || has_non_empty(&self.cairo_coder_api_key)
                || has_non_empty(&self.gemini_api_key);
            if !llm_configured {
                anyhow::bail!(
                    "At least one AI provider key must be configured in production (LLM_API_KEY / OPENAI_API_KEY / CAIRO_CODER_API_KEY / GEMINI_API_KEY)"
                );
            }
            if self.cors_allowed_origins.trim().is_empty()
                || self.cors_allowed_origins.contains('*')
            {
                anyhow::bail!("CORS_ALLOWED_ORIGINS must be an explicit allowlist in production");
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

fn has_non_empty(value: &Option<String>) -> bool {
    value
        .as_deref()
        .map(str::trim)
        .filter(|raw| !raw.is_empty())
        .is_some()
}

fn env_truthy(name: &str) -> bool {
    env::var(name)
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

fn is_production_env(environment: &str) -> bool {
    matches!(
        environment.trim().to_ascii_lowercase().as_str(),
        "production" | "prod" | "mainnet"
    )
}

// Internal helper that supports `load_env_override` operations.
fn load_env_override(paths: &[&str]) -> HashMap<String, String> {
    let mut overrides = HashMap::new();
    for path in paths {
        let Ok(content) = fs::read_to_string(path) else {
            continue;
        };
        for (line_no, raw_line) in content.lines().enumerate() {
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
            // Environment provided by platform (e.g. Leapcell, Railway) must win.
            // This keeps `.env` as fallback defaults and prevents accidental override.
            if env::var_os(key).is_some() {
                continue;
            }
            let mut value = raw_value.trim().to_string();
            if (value.starts_with('"') && value.ends_with('"'))
                || (value.starts_with('\'') && value.ends_with('\''))
            {
                value = value[1..value.len().saturating_sub(1)].to_string();
            }
            if overrides.contains_key(key) {
                eprintln!(
                    "Duplicate env key '{}' in {}:{}; later value overrides earlier one.",
                    key,
                    path,
                    line_no + 1
                );
            }
            overrides.insert(key.to_string(), value);
        }
        return overrides;
    }
    overrides
}

fn env_with_override(
    overrides: &HashMap<String, String>,
    key: &str,
) -> Result<String, env::VarError> {
    env::var(key).or_else(|err| overrides.get(key).cloned().ok_or(err))
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
