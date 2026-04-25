use crate::{
    config::Config,
    error::{AppError, Result},
    models::*,
};
use anyhow::Context;
use sqlx::{postgres::PgPoolOptions, PgPool, Row};

#[derive(Clone)]
pub struct Database {
    pool: PgPool,
}

#[derive(Debug, Clone)]
pub struct NftDiscountState {
    #[allow(dead_code)]
    pub tier: i32,
    pub discount_percent: f64,
    pub is_active: bool,
    pub max_usage: i64,
    pub chain_used_in_period: i64,
    pub local_used_in_period: i64,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct IndexedBlock {
    pub block_number: i64,
}

#[derive(Clone, Copy, Debug)]
pub struct PriceTickUpsert<'a> {
    pub token: &'a str,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
    pub interval: &'a str,
}

#[derive(Clone, Copy, Debug)]
pub struct NftDiscountStateUpsert<'a> {
    pub contract_address: &'a str,
    pub user_address: &'a str,
    pub period_epoch: i64,
    pub tier: i32,
    pub discount_percent: f64,
    pub is_active: bool,
    pub max_usage: i64,
    pub chain_used_in_period: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    // Internal helper that supports `test_config` operations.
    fn test_config(database_url: &str) -> Config {
        Config {
            host: "0.0.0.0".to_string(),
            port: 3000,
            environment: "development".to_string(),
            app_base_url: None,
            database_url: database_url.to_string(),
            database_max_connections: 1,
            database_connect_timeout_secs: 1,
            database_connect_retries: 1,
            database_connect_retry_delay_ms: 0,
            redis_url: "redis://localhost:6379".to_string(),
            point_calculator_batch_size: 100,
            point_calculator_max_batches_per_tick: 1,
            starknet_rpc_url: "http://localhost:5050".to_string(),
            starknet_chain_id: "SN_MAIN".to_string(),
            ethereum_rpc_url: "http://localhost:8545".to_string(),
            carel_token_address: "0x0000000000000000000000000000000000000001".to_string(),
            snapshot_distributor_address: "0x0000000000000000000000000000000000000002".to_string(),
            point_storage_address: "0x0000000000000000000000000000000000000003".to_string(),
            price_oracle_address: "0x0000000000000000000000000000000000000004".to_string(),
            limit_order_book_address: "0x0000000000000000000000000000000000000005".to_string(),
            staking_carel_address: None,
            discount_soulbound_address: None,
            treasury_address: None,
            referral_system_address: None,
            ai_executor_address: "0x0000000000000000000000000000000000000006".to_string(),
            ai_signature_verifier_address: None,
            ai_plan_router_address: None,
            ai_identity_registry_address: None,
            ai_agent_id: None,
            bridge_aggregator_address: "0x0000000000000000000000000000000000000007".to_string(),
            zk_privacy_router_address: "0x0000000000000000000000000000000000000008".to_string(),
            battleship_garaga_address: None,
            privacy_router_address: None,
            privacy_auto_garaga_payload_file: None,
            privacy_auto_garaga_proof_file: None,
            privacy_auto_garaga_public_inputs_file: None,
            privacy_auto_garaga_prover_cmd: None,
            privacy_auto_garaga_prover_sha256: None,
            privacy_auto_garaga_prover_timeout_ms: 45_000,
            token_strk_address: None,
            token_eth_address: None,
            token_btc_address: None,
            token_strk_l1_address: None,
            faucet_btc_amount: None,
            faucet_strk_amount: None,
            faucet_carel_amount: None,
            faucet_cooldown_hours: None,
            backend_private_key: "test_private".to_string(),
            backend_public_key: "test_public".to_string(),
            backend_account_address: None,
            jwt_secret: "test_secret".to_string(),
            jwt_expiry_hours: 24,
            llm_api_key: None,
            llm_api_url: None,
            llm_model: None,
            openai_api_key: None,
            cairo_coder_api_key: None,
            cairo_coder_api_url: "https://api.cairo-coder.com/v1/chat/completions".to_string(),
            cairo_coder_model: None,
            gemini_api_key: None,
            gemini_api_url: "https://generativelanguage.googleapis.com/v1beta".to_string(),
            gemini_model: "gemini-2.0-flash".to_string(),
            ai_llm_rewrite_timeout_ms: 8_000,
            twitter_bearer_token: None,
            telegram_bot_token: None,
            discord_bot_token: None,
            social_tasks_json: None,
            admin_manual_key: None,
            admin_reset_confirm_key: None,
            dev_wallet_address: None,
            ai_level_burn_address: None,
            layerswap_api_key: None,
            layerswap_api_url: "https://api.layerswap.io/api/v2".to_string(),
            atomiq_api_key: None,
            atomiq_api_url: "".to_string(),
            garden_api_key: None,
            garden_api_url: "".to_string(),
            xverse_api_key: None,
            xverse_api_url: "".to_string(),
            privacy_verifier_routers: "".to_string(),
            filecoin_backend: None,
            filecoin_pin_api_url: None,
            filecoin_pin_api_key: None,
            filecoin_synapse_script: None,
            filecoin_synapse_private_key: None,
            filecoin_synapse_rpc_url: None,
            filecoin_synapse_with_cdn: None,
            filecoin_synapse_source: None,
            ipfs_api_url: None,
            ipfs_api_key: None,
            stripe_secret_key: None,
            moonpay_api_key: None,
            rate_limit_public: 1,
            rate_limit_authenticated: 1,
            ai_rate_limit_window_seconds: 60,
            ai_rate_limit_global_per_window: 40,
            ai_rate_limit_level_1_per_window: 20,
            ai_rate_limit_level_2_per_window: 10,
            ai_rate_limit_level_3_per_window: 8,
            api_docs_enabled: true,
            cors_allowed_origins: "*".to_string(),
            oracle_asset_ids: "".to_string(),
            bridge_provider_ids: "".to_string(),
            price_tokens: "BTC,ETH,STRK,CAREL,USDT,USDC".to_string(),
            coingecko_api_url: "https://api.coingecko.com/api/v3".to_string(),
            coingecko_api_key: None,
            coingecko_ids: "".to_string(),
        }
    }

    #[tokio::test]
    // Internal helper that supports `database_new_returns_error_on_invalid_url` operations.
    async fn database_new_returns_error_on_invalid_url() {
        let config = test_config("not-a-url");
        let result = Database::new(&config).await;
        assert!(result.is_err());
    }

    #[test]
    // Internal helper that parses or transforms values for `normalize_wallet_address_is_case_insensitive_per_chain`.
    fn normalize_wallet_address_is_case_insensitive_per_chain() {
        let btc =
            normalize_wallet_address_value("bitcoin", "TB1QDK7PD4347C9KR9Z60GCAXPPGF7ZWXNC2KUKSAV");
        assert_eq!(btc, "tb1qdk7pd4347c9kr9z60gcaxppgf7zwxnc2kuksav");

        let evm = normalize_wallet_address_value("evm", "0xAbCdEF1234");
        assert_eq!(evm, "0xabcdef1234");

        let starknet = normalize_wallet_address_value("starknet", "0X00AaBb");
        assert_eq!(starknet, "0xaabb");
    }

    #[test]
    // Internal helper that parses or transforms values for `normalize_starknet_wallet_address_removes_leading_zeroes`.
    fn normalize_starknet_wallet_address_removes_leading_zeroes() {
        assert_eq!(
            normalize_wallet_address_value(
                "starknet",
                "0x0469de079832d5da0591fc5f8fd2957f70b908d62c5d0dcb057d030cfc827705"
            ),
            "0x469de079832d5da0591fc5f8fd2957f70b908d62c5d0dcb057d030cfc827705"
        );
        assert_eq!(normalize_wallet_address_value("starknet", "0x0000"), "0x0");
    }

    #[test]
    // Internal helper that parses or transforms values for `normalize_wallet_chain_lowercases_value`.
    fn normalize_wallet_chain_lowercases_value() {
        assert_eq!(normalize_wallet_chain_value("BitCoin "), "bitcoin");
        assert_eq!(normalize_wallet_chain_value(" EVM"), "evm");
    }
}

impl Database {
    /// Constructs a new instance via `new`.
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
    pub async fn new(config: &Config) -> anyhow::Result<Self> {
        let mut last_err: Option<sqlx::Error> = None;
        let retries = config.database_connect_retries.max(1);
        for attempt in 1..=retries {
            let connect_future = PgPoolOptions::new()
                .max_connections(config.database_max_connections)
                .connect(&config.database_url);
            let result = tokio::time::timeout(
                std::time::Duration::from_secs(config.database_connect_timeout_secs),
                connect_future,
            )
            .await;
            match result {
                Ok(Ok(pool)) => return Ok(Self { pool }),
                Ok(Err(err)) => {
                    let err_text = err.to_string();
                    last_err = Some(err);
                    if attempt < retries {
                        let delay = std::time::Duration::from_millis(
                            config.database_connect_retry_delay_ms,
                        );
                        tracing::warn!(
                            "Database connect attempt {}/{} failed ({}); retrying in {:?}",
                            attempt,
                            retries,
                            err_text,
                            delay
                        );
                        tokio::time::sleep(delay).await;
                    }
                }
                Err(_) => {
                    last_err = Some(sqlx::Error::PoolTimedOut);
                    if attempt < retries {
                        let delay = std::time::Duration::from_millis(
                            config.database_connect_retry_delay_ms,
                        );
                        tracing::warn!(
                            "Database connect attempt {}/{} timed out; retrying in {:?}",
                            attempt,
                            retries,
                            delay
                        );
                        tokio::time::sleep(delay).await;
                    }
                }
            }
        }

        Err(anyhow::anyhow!(
            "failed to connect to PostgreSQL using DATABASE_URL: {}",
            last_err
                .map(|err| err.to_string())
                .unwrap_or_else(|| "unknown error".to_string())
        ))
    }

    /// Handles `run_migrations` logic.
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
    pub async fn run_migrations(&self) -> anyhow::Result<()> {
        // migrations harus berada di crate root: ./migrations
        sqlx::migrate!("./migrations")
            .run(&self.pool)
            .await
            .context("failed to run SQLx migrations")?;
        Ok(())
    }

    /// Handles `pool` logic.
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
    pub fn pool(&self) -> &PgPool {
        &self.pool
    }
}

// ==================== USER QUERIES ====================
impl Database {
    /// Builds inputs required by `create_user`.
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
    pub async fn create_user(&self, address: &str) -> Result<()> {
        ensure_varchar_max("users.address", address, 66)?;

        sqlx::query(
            "INSERT INTO users (address) VALUES ($1)
             ON CONFLICT DO NOTHING",
        )
        .bind(address)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Updates state for `touch_user`.
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
    pub async fn touch_user(&self, address: &str) -> Result<()> {
        ensure_varchar_max("users.address", address, 66)?;

        sqlx::query(
            "INSERT INTO users (address, last_active)
             VALUES ($1, NOW())
             ON CONFLICT (address)
             DO UPDATE SET last_active = NOW()",
        )
        .bind(address)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Fetches data for `get_user`.
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
    pub async fn get_user(&self, address: &str) -> Result<Option<User>> {
        let row = sqlx::query_as::<_, User>("SELECT * FROM users WHERE address = $1")
            .bind(address)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row)
    }

    /// Fetches data for `get_user_ai_level`.
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
    pub async fn get_user_ai_level(&self, address: &str) -> Result<u8> {
        ensure_varchar_max("user_ai_levels.user_address", address, 66)?;
        let level = sqlx::query_scalar::<_, i16>(
            "SELECT level FROM user_ai_levels WHERE user_address = $1 LIMIT 1",
        )
        .bind(address)
        .fetch_optional(&self.pool)
        .await?
        .unwrap_or(1);
        Ok(level.clamp(1, 3) as u8)
    }

    /// Updates state for `upsert_user_ai_level`.
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
    pub async fn upsert_user_ai_level(&self, address: &str, level: u8) -> Result<u8> {
        ensure_varchar_max("user_ai_levels.user_address", address, 66)?;
        if !(1..=3).contains(&level) {
            return Err(AppError::BadRequest("Invalid AI level".to_string()));
        }

        let mut db_tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO users (address, last_active)
             VALUES ($1, NOW())
             ON CONFLICT (address)
             DO UPDATE SET last_active = NOW()",
        )
        .bind(address)
        .execute(&mut *db_tx)
        .await?;

        let applied = sqlx::query_scalar::<_, i16>(
            "INSERT INTO user_ai_levels (user_address, level, upgraded_at, updated_at)
             VALUES ($1, $2, CASE WHEN $2 > 1 THEN NOW() ELSE NULL END, NOW())
             ON CONFLICT (user_address)
             DO UPDATE
             SET level = GREATEST(user_ai_levels.level, EXCLUDED.level),
                 upgraded_at = CASE
                    WHEN GREATEST(user_ai_levels.level, EXCLUDED.level) > 1
                        THEN COALESCE(user_ai_levels.upgraded_at, NOW())
                    ELSE user_ai_levels.upgraded_at
                 END,
                 updated_at = NOW()
             RETURNING level",
        )
        .bind(address)
        .bind(level as i16)
        .fetch_one(&mut *db_tx)
        .await?;

        db_tx.commit().await?;
        Ok(applied.clamp(1, 3) as u8)
    }

    /// Updates state for `update_last_active`.
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
    pub async fn update_last_active(&self, address: &str) -> Result<()> {
        sqlx::query("UPDATE users SET last_active = NOW() WHERE address = $1")
            .bind(address)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Updates state for `set_display_name`.
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
    pub async fn set_display_name(&self, address: &str, display_name: &str) -> Result<User> {
        ensure_varchar_max("users.address", address, 66)?;
        ensure_varchar_max("users.display_name", display_name, 50)?;

        let user = sqlx::query_as::<_, User>(
            "UPDATE users
             SET display_name = $1
             WHERE address = $2
             RETURNING *",
        )
        .bind(display_name)
        .bind(address)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

        Ok(user)
    }

    /// Fetches data for `find_user_by_referral_code`.
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
    pub async fn find_user_by_referral_code(
        &self,
        referral_suffix: &str,
    ) -> Result<Option<String>> {
        ensure_varchar_max("referral_suffix", referral_suffix, 8)?;
        let suffix = referral_suffix.trim().to_ascii_uppercase();
        let address = sqlx::query_scalar::<_, String>(
            "SELECT address
             FROM users
             WHERE RIGHT(UPPER(address), 8) = $1
             ORDER BY created_at ASC
             LIMIT 1",
        )
        .bind(suffix)
        .fetch_optional(&self.pool)
        .await?;
        Ok(address)
    }

    /// Updates state for `bind_referrer_once`.
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
    pub async fn bind_referrer_once(
        &self,
        user_address: &str,
        referrer_address: &str,
    ) -> Result<bool> {
        ensure_varchar_max("users.address", user_address, 66)?;
        ensure_varchar_max("users.referrer", referrer_address, 66)?;

        let result = sqlx::query(
            "UPDATE users u
             SET referrer = $1
             WHERE u.address = $2
               AND u.referrer IS NULL
               AND u.address <> $1
               AND EXISTS (SELECT 1 FROM users r WHERE r.address = $1)",
        )
        .bind(referrer_address)
        .bind(user_address)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    /// Handles `upsert_wallet_address` logic.
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
    pub async fn upsert_wallet_address(
        &self,
        user_address: &str,
        chain: &str,
        wallet_address: &str,
        provider: Option<&str>,
    ) -> Result<()> {
        let chain = normalize_wallet_chain_value(chain);
        let wallet_address = normalize_wallet_address_value(&chain, wallet_address);

        ensure_varchar_max("user_wallet_addresses.user_address", user_address, 66)?;
        ensure_varchar_max("user_wallet_addresses.chain", &chain, 16)?;
        ensure_varchar_max("user_wallet_addresses.wallet_address", &wallet_address, 128)?;
        if let Some(provider) = provider {
            ensure_varchar_max("user_wallet_addresses.provider", provider, 32)?;
        }

        let existing_owner: Option<String> = if chain == "starknet" {
            sqlx::query_scalar(
                r#"
                SELECT user_address
                FROM user_wallet_addresses
                WHERE chain = $1
                  AND (
                    CASE
                      WHEN wallet_address ~* '^0x'
                        THEN '0x' || COALESCE(NULLIF(LTRIM(LOWER(SUBSTRING(wallet_address FROM 3)), '0'), ''), '0')
                      ELSE LOWER(wallet_address)
                    END
                  ) = $2
                ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
                LIMIT 1
                "#,
            )
            .bind(&chain)
            .bind(&wallet_address)
            .fetch_optional(&self.pool)
            .await?
        } else {
            sqlx::query_scalar(
                "SELECT user_address
                 FROM user_wallet_addresses
                 WHERE chain = $1 AND LOWER(wallet_address) = LOWER($2)
                 ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
                 LIMIT 1",
            )
            .bind(&chain)
            .bind(&wallet_address)
            .fetch_optional(&self.pool)
            .await?
        };

        if let Some(owner) = existing_owner {
            if !owner.eq_ignore_ascii_case(user_address) {
                return Err(AppError::BadRequest(
                    "Wallet address already linked to another user".to_string(),
                ));
            }
        }

        let exec_result = sqlx::query(
            r#"
            INSERT INTO user_wallet_addresses (user_address, chain, wallet_address, provider)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_address, chain) DO UPDATE
            SET wallet_address = EXCLUDED.wallet_address,
                provider = EXCLUDED.provider,
                updated_at = NOW()
            "#,
        )
        .bind(user_address)
        .bind(&chain)
        .bind(&wallet_address)
        .bind(provider)
        .execute(&self.pool)
        .await;

        if let Err(err) = exec_result {
            if let Some(db_err) = err.as_database_error() {
                if db_err.code().as_deref() == Some("23505") {
                    return Err(AppError::BadRequest(
                        "Wallet address already linked to another user".to_string(),
                    ));
                }
            }
            return Err(AppError::Database(err));
        }

        Ok(())
    }

    /// Fetches data for `find_user_by_wallet_address`.
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
    pub async fn find_user_by_wallet_address(
        &self,
        wallet_address: &str,
        chain: Option<&str>,
    ) -> Result<Option<String>> {
        let normalized_chain = chain.map(normalize_wallet_chain_value);
        let normalized_wallet_address = normalize_wallet_address_value(
            normalized_chain.as_deref().unwrap_or("unknown"),
            wallet_address,
        );

        ensure_varchar_max(
            "user_wallet_addresses.wallet_address",
            &normalized_wallet_address,
            128,
        )?;
        if let Some(chain) = chain {
            let chain = normalize_wallet_chain_value(chain);
            ensure_varchar_max("user_wallet_addresses.chain", &chain, 16)?;
            let row: Option<String> = if chain == "starknet" {
                sqlx::query_scalar(
                    r#"
                    SELECT user_address
                    FROM user_wallet_addresses
                    WHERE chain = $1
                      AND (
                        CASE
                          WHEN wallet_address ~* '^0x'
                            THEN '0x' || COALESCE(NULLIF(LTRIM(LOWER(SUBSTRING(wallet_address FROM 3)), '0'), ''), '0')
                          ELSE LOWER(wallet_address)
                        END
                      ) = $2
                    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
                    LIMIT 1
                    "#,
                )
                .bind(&chain)
                .bind(&normalized_wallet_address)
                .fetch_optional(&self.pool)
                .await?
            } else {
                sqlx::query_scalar(
                    "SELECT user_address
                     FROM user_wallet_addresses
                     WHERE LOWER(wallet_address) = LOWER($1) AND chain = $2
                     ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
                     LIMIT 1",
                )
                .bind(&normalized_wallet_address)
                .bind(&chain)
                .fetch_optional(&self.pool)
                .await?
            };
            return Ok(row);
        }

        let row: Option<String> = sqlx::query_scalar(
            "SELECT user_address
             FROM user_wallet_addresses
             WHERE LOWER(wallet_address) = LOWER($1)
             ORDER BY updated_at DESC
             LIMIT 1",
        )
        .bind(&normalized_wallet_address)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    /// Fetches data for `list_wallet_addresses`.
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
    pub async fn list_wallet_addresses(
        &self,
        user_address: &str,
    ) -> Result<Vec<LinkedWalletAddress>> {
        ensure_varchar_max("user_wallet_addresses.user_address", user_address, 66)?;
        let rows = sqlx::query_as::<_, LinkedWalletAddress>(
            "SELECT user_address, chain, wallet_address, provider, created_at, updated_at
             FROM user_wallet_addresses
             WHERE user_address = $1
             ORDER BY created_at ASC",
        )
        .bind(user_address)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    /// Checks whether wallet linking should be locked for the user
    /// because points/volume/referral have already been recorded.
    pub async fn is_wallet_link_locked(&self, user_address: &str) -> Result<bool> {
        ensure_varchar_max("user_wallet_addresses.user_address", user_address, 66)?;

        let locked: Option<i64> = sqlx::query_scalar(
            r#"
            WITH scope AS (
                SELECT LOWER($1) AS addr
                UNION
                SELECT LOWER(wallet_address) AS addr
                FROM user_wallet_addresses
                WHERE LOWER(user_address) = LOWER($1)
            ),
            points_hit AS (
                SELECT 1::bigint FROM points
                WHERE LOWER(user_address) IN (SELECT addr FROM scope)
                LIMIT 1
            ),
            tx_hit AS (
                SELECT 1::bigint FROM transactions
                WHERE LOWER(user_address) IN (SELECT addr FROM scope)
                LIMIT 1
            ),
            referral_hit AS (
                SELECT 1::bigint FROM users
                WHERE LOWER(referrer) = LOWER($1)
                LIMIT 1
            )
            SELECT 1::bigint
            FROM (
                SELECT * FROM points_hit
                UNION ALL
                SELECT * FROM tx_hit
                UNION ALL
                SELECT * FROM referral_hit
            ) AS hits
            LIMIT 1
            "#,
        )
        .bind(user_address)
        .fetch_optional(&self.pool)
        .await?;

        Ok(locked.is_some())
    }
}

// ==================== POINTS QUERIES ====================
impl Database {
    /// Fetches data for `get_user_points`.
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
    pub async fn get_user_points(&self, address: &str, epoch: i64) -> Result<Option<UserPoints>> {
        let points = sqlx::query_as::<_, UserPoints>(
            "SELECT * FROM points WHERE user_address = $1 AND epoch = $2",
        )
        .bind(address)
        .bind(epoch)
        .fetch_optional(&self.pool)
        .await?;
        Ok(points)
    }

    /// Builds inputs required by `create_or_update_points`.
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
    pub async fn create_or_update_points(
        &self,
        address: &str,
        epoch: i64,
        swap_points: rust_decimal::Decimal,
        bridge_points: rust_decimal::Decimal,
        stake_points: rust_decimal::Decimal,
    ) -> Result<()> {
        let total = swap_points + bridge_points + stake_points;

        // Upsert yang menambah nilai yang sudah ada (accumulate deltas)
        sqlx::query(
            r#"
            INSERT INTO points
                (user_address, epoch, swap_points, bridge_points, stake_points, total_points)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (user_address, epoch) DO UPDATE
            SET swap_points   = points.swap_points   + EXCLUDED.swap_points,
                bridge_points = points.bridge_points + EXCLUDED.bridge_points,
                stake_points  = points.stake_points  + EXCLUDED.stake_points,
                total_points  = points.total_points  + EXCLUDED.total_points,
                updated_at    = NOW()
            "#,
        )
        .bind(address)
        .bind(epoch)
        .bind(swap_points)
        .bind(bridge_points)
        .bind(stake_points)
        .bind(total)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Handles `consume_points` logic.
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
    pub async fn consume_points(
        &self,
        address: &str,
        epoch: i64,
        amount: rust_decimal::Decimal,
    ) -> Result<()> {
        let current: Option<rust_decimal::Decimal> = sqlx::query_scalar(
            "SELECT total_points FROM points WHERE user_address = $1 AND epoch = $2",
        )
        .bind(address)
        .bind(epoch)
        .fetch_optional(&self.pool)
        .await?;

        let current_points = current.unwrap_or(rust_decimal::Decimal::ZERO);
        if current_points < amount {
            return Err(crate::error::AppError::BadRequest(
                "Insufficient points".to_string(),
            ));
        }

        sqlx::query(
            "UPDATE points
             SET spent_points = COALESCE(spent_points, 0) + $3,
                 total_points = GREATEST(0, total_points - $3)
             WHERE user_address = $1 AND epoch = $2",
        )
        .bind(address)
        .bind(epoch)
        .bind(amount)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Removes a linked wallet address for a user.
    pub async fn delete_wallet_address(
        &self,
        user_address: &str,
        chain: &str,
        wallet_address: &str,
    ) -> Result<bool> {
        let chain = normalize_wallet_chain_value(chain);
        let wallet_address = normalize_wallet_address_value(&chain, wallet_address);

        ensure_varchar_max("user_wallet_addresses.user_address", user_address, 66)?;
        ensure_varchar_max("user_wallet_addresses.chain", &chain, 16)?;
        ensure_varchar_max("user_wallet_addresses.wallet_address", &wallet_address, 128)?;

        let result = sqlx::query(
            "DELETE FROM user_wallet_addresses
             WHERE user_address = $1 AND chain = $2 AND wallet_address = $3",
        )
        .bind(user_address)
        .bind(&chain)
        .bind(&wallet_address)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    /// Handles `add_referral_points` logic.
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
    pub async fn add_referral_points(
        &self,
        address: &str,
        epoch: i64,
        amount: rust_decimal::Decimal,
    ) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO points
                (user_address, epoch, referral_points, total_points)
            VALUES ($1, $2, $3, $3)
            ON CONFLICT (user_address, epoch) DO UPDATE
            SET referral_points = points.referral_points + EXCLUDED.referral_points,
                total_points = points.total_points + EXCLUDED.total_points,
                updated_at = NOW()
            "#,
        )
        .bind(address)
        .bind(epoch)
        .bind(amount)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Handles `add_social_points` logic.
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
    pub async fn add_social_points(
        &self,
        address: &str,
        epoch: i64,
        amount: rust_decimal::Decimal,
    ) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO points
                (user_address, epoch, social_points, total_points)
            VALUES ($1, $2, $3, $3)
            ON CONFLICT (user_address, epoch) DO UPDATE
            SET social_points = points.social_points + EXCLUDED.social_points,
                total_points = points.total_points + EXCLUDED.total_points,
                updated_at = NOW()
            "#,
        )
        .bind(address)
        .bind(epoch)
        .bind(amount)
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}

// ==================== TRANSACTION QUERIES ====================
impl Database {
    // Internal helper that validates inputs for transaction persistence.
    fn validate_transaction_fields(tx: &Transaction) -> Result<()> {
        ensure_varchar_max("transactions.tx_hash", &tx.tx_hash, 66)?;
        ensure_varchar_max("transactions.user_address", &tx.user_address, 66)?;
        ensure_varchar_max("transactions.tx_type", &tx.tx_type, 20)?;
        if tx.user_address.trim().is_empty() {
            return Err(AppError::BadRequest(
                "transactions.user_address cannot be empty".to_string(),
            ));
        }
        if let Some(token_in) = tx.token_in.as_deref() {
            ensure_varchar_max("transactions.token_in", token_in, 66)?;
        }
        if let Some(token_out) = tx.token_out.as_deref() {
            ensure_varchar_max("transactions.token_out", token_out, 66)?;
        }
        Ok(())
    }

    /// Updates state for `save_transaction`.
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
    pub async fn save_transaction(&self, tx: &Transaction) -> Result<()> {
        Self::validate_transaction_fields(tx)?;

        let mut db_tx = self.pool.begin().await?;

        // Ensure FK target exists for indexed on-chain addresses that have not touched auth flows yet.
        sqlx::query(
            "INSERT INTO users (address, last_active)
             VALUES ($1, NOW())
             ON CONFLICT (address)
             DO UPDATE SET last_active = NOW()",
        )
        .bind(&tx.user_address)
        .execute(&mut *db_tx)
        .await?;

        sqlx::query(
            r#"
            INSERT INTO transactions
                (tx_hash, block_number, user_address, tx_type,
                 token_in, token_out, amount_in, amount_out,
                 usd_value, fee_paid, points_earned, timestamp)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            ON CONFLICT (tx_hash) DO UPDATE
            SET
                block_number = GREATEST(transactions.block_number, EXCLUDED.block_number),
                token_in = COALESCE(transactions.token_in, EXCLUDED.token_in),
                token_out = COALESCE(transactions.token_out, EXCLUDED.token_out),
                amount_in = COALESCE(transactions.amount_in, EXCLUDED.amount_in),
                amount_out = COALESCE(transactions.amount_out, EXCLUDED.amount_out),
                usd_value = COALESCE(transactions.usd_value, EXCLUDED.usd_value),
                fee_paid = COALESCE(transactions.fee_paid, EXCLUDED.fee_paid),
                points_earned = COALESCE(transactions.points_earned, EXCLUDED.points_earned),
                timestamp = GREATEST(transactions.timestamp, EXCLUDED.timestamp)
            "#,
        )
        .bind(&tx.tx_hash)
        .bind(tx.block_number)
        .bind(&tx.user_address)
        .bind(&tx.tx_type)
        .bind(&tx.token_in)
        .bind(&tx.token_out)
        .bind(tx.amount_in)
        .bind(tx.amount_out)
        .bind(tx.usd_value)
        .bind(tx.fee_paid)
        .bind(tx.points_earned)
        .bind(tx.timestamp)
        .execute(&mut *db_tx)
        .await?;

        db_tx.commit().await?;
        Ok(())
    }

    /// Inserts a transaction once and fails on duplicate tx_hash.
    ///
    /// Returns `true` if the transaction was inserted, `false` if it already exists.
    pub async fn insert_transaction_once(&self, tx: &Transaction) -> Result<bool> {
        Self::validate_transaction_fields(tx)?;

        let mut db_tx = self.pool.begin().await?;

        // Ensure FK target exists for indexed on-chain addresses that have not touched auth flows yet.
        sqlx::query(
            "INSERT INTO users (address, last_active)
             VALUES ($1, NOW())
             ON CONFLICT (address)
             DO UPDATE SET last_active = NOW()",
        )
        .bind(&tx.user_address)
        .execute(&mut *db_tx)
        .await?;

        let result = sqlx::query(
            r#"
            INSERT INTO transactions
                (tx_hash, block_number, user_address, tx_type,
                 token_in, token_out, amount_in, amount_out,
                 usd_value, fee_paid, points_earned, timestamp)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            ON CONFLICT (tx_hash) DO NOTHING
            "#,
        )
        .bind(&tx.tx_hash)
        .bind(tx.block_number)
        .bind(&tx.user_address)
        .bind(&tx.tx_type)
        .bind(&tx.token_in)
        .bind(&tx.token_out)
        .bind(tx.amount_in)
        .bind(tx.amount_out)
        .bind(tx.usd_value)
        .bind(tx.fee_paid)
        .bind(tx.points_earned)
        .bind(tx.timestamp)
        .execute(&mut *db_tx)
        .await?;

        db_tx.commit().await?;
        Ok(result.rows_affected() > 0)
    }

    /// Batch insert/update for transactions.
    ///
    /// # Arguments
    /// * Uses function parameters as validated input and runtime context.
    ///
    /// # Returns
    /// * `Ok(...)` when processing succeeds.
    /// * `Err(AppError)` when validation, authorization, or integration checks fail.
    ///
    /// # Notes
    /// * Uses a single transaction with bulk insert to avoid N+1 overhead.
    pub async fn save_transactions_batch(&self, txs: &[Transaction]) -> Result<()> {
        if txs.is_empty() {
            return Ok(());
        }

        for tx in txs {
            Self::validate_transaction_fields(tx)?;
        }

        let mut db_tx = self.pool.begin().await?;

        let addresses: Vec<String> = txs.iter().map(|tx| tx.user_address.clone()).collect();
        sqlx::query(
            "INSERT INTO users (address, last_active)
             SELECT UNNEST($1::text[]), NOW()
             ON CONFLICT (address)
             DO UPDATE SET last_active = NOW()",
        )
        .bind(&addresses)
        .execute(&mut *db_tx)
        .await?;

        let mut builder = sqlx::QueryBuilder::new(
            "INSERT INTO transactions
                (tx_hash, block_number, user_address, tx_type,
                 token_in, token_out, amount_in, amount_out,
                 usd_value, fee_paid, points_earned, timestamp) ",
        );

        builder.push_values(txs, |mut b, tx| {
            b.push_bind(&tx.tx_hash)
                .push_bind(tx.block_number)
                .push_bind(&tx.user_address)
                .push_bind(&tx.tx_type)
                .push_bind(&tx.token_in)
                .push_bind(&tx.token_out)
                .push_bind(tx.amount_in)
                .push_bind(tx.amount_out)
                .push_bind(tx.usd_value)
                .push_bind(tx.fee_paid)
                .push_bind(tx.points_earned)
                .push_bind(tx.timestamp);
        });

        builder.push(
            " ON CONFLICT (tx_hash) DO UPDATE
              SET
                  block_number = GREATEST(transactions.block_number, EXCLUDED.block_number),
                  token_in = COALESCE(transactions.token_in, EXCLUDED.token_in),
                  token_out = COALESCE(transactions.token_out, EXCLUDED.token_out),
                  amount_in = COALESCE(transactions.amount_in, EXCLUDED.amount_in),
                  amount_out = COALESCE(transactions.amount_out, EXCLUDED.amount_out),
                  usd_value = COALESCE(transactions.usd_value, EXCLUDED.usd_value),
                  fee_paid = COALESCE(transactions.fee_paid, EXCLUDED.fee_paid),
                  points_earned = COALESCE(transactions.points_earned, EXCLUDED.points_earned),
                  timestamp = GREATEST(transactions.timestamp, EXCLUDED.timestamp)",
        );

        builder.build().execute(&mut *db_tx).await?;
        db_tx.commit().await?;
        Ok(())
    }

    /// Fetches data for `get_transaction`.
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
    pub async fn get_transaction(&self, tx_hash: &str) -> Result<Option<Transaction>> {
        let tx = sqlx::query_as::<_, Transaction>("SELECT * FROM transactions WHERE tx_hash = $1")
            .bind(tx_hash)
            .fetch_optional(&self.pool)
            .await?;
        Ok(tx)
    }

    /// Updates state for `mark_transaction_private`.
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
    pub async fn mark_transaction_private(&self, tx_hash: &str) -> Result<()> {
        ensure_varchar_max("transactions.tx_hash", tx_hash, 66)?;
        sqlx::query(
            "UPDATE transactions
             SET is_private = true
             WHERE tx_hash = $1",
        )
        .bind(tx_hash)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Fetches data for `count_private_swaps_today`.
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
    pub async fn count_private_swaps_today(&self, user_address: &str) -> Result<i64> {
        ensure_varchar_max("transactions.user_address", user_address, 66)?;
        if user_address.trim().is_empty() {
            return Err(AppError::BadRequest(
                "transactions.user_address cannot be empty".to_string(),
            ));
        }

        let count = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT COUNT(*)
            FROM transactions
            WHERE LOWER(user_address) = LOWER($1)
              AND tx_type = 'swap'
              AND COALESCE(is_private, false) = true
              AND (timestamp AT TIME ZONE 'UTC')::date = (NOW() AT TIME ZONE 'UTC')::date
            "#,
        )
        .bind(user_address)
        .fetch_one(&self.pool)
        .await?;
        Ok(count)
    }

    /// Fetches the latest indexed block metadata.
    pub async fn get_latest_indexed_block(&self) -> Result<Option<IndexedBlock>> {
        let block = sqlx::query_as::<_, IndexedBlock>(
            "SELECT block_number::bigint AS block_number
             FROM indexed_blocks
             ORDER BY block_number DESC
             LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(block)
    }

    /// Fetches the stored block hash for a given block number.
    pub async fn get_indexed_block_hash(&self, block_number: i64) -> Result<Option<String>> {
        let hash = sqlx::query_scalar::<_, String>(
            "SELECT block_hash FROM indexed_blocks WHERE block_number = $1",
        )
        .bind(block_number)
        .fetch_optional(&self.pool)
        .await?;
        Ok(hash)
    }

    /// Inserts or updates indexed block metadata.
    pub async fn upsert_indexed_block(
        &self,
        block_number: i64,
        block_hash: &str,
        parent_hash: Option<&str>,
    ) -> Result<()> {
        ensure_varchar_max("indexed_blocks.block_hash", block_hash, 66)?;
        if let Some(parent_hash) = parent_hash {
            ensure_varchar_max("indexed_blocks.parent_hash", parent_hash, 66)?;
        }

        sqlx::query(
            r#"
            INSERT INTO indexed_blocks
                (block_number, block_hash, parent_hash, indexed_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (block_number) DO UPDATE
            SET block_hash = EXCLUDED.block_hash,
                parent_hash = EXCLUDED.parent_hash,
                indexed_at = NOW()
            "#,
        )
        .bind(block_number)
        .bind(block_hash)
        .bind(parent_hash)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Rolls back indexed blocks and their transactions starting from the given block number.
    pub async fn rollback_indexed_blocks_from(&self, from_block: i64) -> Result<u64> {
        let mut db_tx = self.pool.begin().await?;

        sqlx::query("DELETE FROM transactions WHERE block_number >= $1")
            .bind(from_block)
            .execute(&mut *db_tx)
            .await?;

        let result = sqlx::query("DELETE FROM indexed_blocks WHERE block_number >= $1")
            .bind(from_block)
            .execute(&mut *db_tx)
            .await?;

        db_tx.commit().await?;
        Ok(result.rows_affected())
    }
}

// Internal helper that runs side-effecting logic for `ensure_varchar_max`.
fn ensure_varchar_max(field: &str, value: &str, max_len: usize) -> Result<()> {
    if value.chars().count() > max_len {
        return Err(AppError::BadRequest(format!(
            "{} too long ({} > {})",
            field,
            value.chars().count(),
            max_len
        )));
    }
    Ok(())
}

// Internal helper that parses or transforms values for `normalize_wallet_chain_value`.
fn normalize_wallet_chain_value(chain: &str) -> String {
    chain.trim().to_ascii_lowercase()
}

// Internal helper that parses or transforms values for `normalize_wallet_address_value`.
fn normalize_wallet_address_value(chain: &str, wallet_address: &str) -> String {
    let trimmed = wallet_address.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let chain_lower = chain.trim().to_ascii_lowercase();
    if chain_lower == "bitcoin" || chain_lower == "btc" {
        return trimmed.to_ascii_lowercase();
    }
    if chain_lower == "starknet" || chain_lower == "strk" {
        return normalize_starknet_wallet_address(trimmed);
    }
    // Starknet/EVM hex addresses are case-insensitive in practice.
    if trimmed.starts_with("0x") || trimmed.starts_with("0X") {
        return format!("0x{}", trimmed[2..].to_ascii_lowercase());
    }
    trimmed.to_ascii_lowercase()
}

// Internal helper that parses or transforms values for `normalize_starknet_wallet_address`.
fn normalize_starknet_wallet_address(wallet_address: &str) -> String {
    let trimmed = wallet_address.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let without_prefix = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
        .unwrap_or(trimmed)
        .to_ascii_lowercase();
    let normalized = without_prefix.trim_start_matches('0');
    if normalized.is_empty() {
        "0x0".to_string()
    } else {
        format!("0x{}", normalized)
    }
}

// ==================== FAUCET QUERIES ====================
impl Database {
    /// Checks conditions for `can_claim_faucet`.
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
    pub async fn can_claim_faucet(
        &self,
        address: &str,
        token: &str,
        cooldown_hours: i64,
    ) -> Result<bool> {
        // gunakan query_scalar untuk mendapatkan satu boolean langsung
        let recent_claim: bool = sqlx::query_scalar(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM faucet_claims
                WHERE user_address = $1
                  AND token = $2
                  AND claimed_at >= NOW() - ($3::double precision * INTERVAL '1 hour')
            )
            "#,
        )
        .bind(address)
        .bind(token)
        .bind(cooldown_hours)
        .fetch_one(&self.pool)
        .await?;

        Ok(!recent_claim)
    }

    /// Attempts to reserve a faucet claim slot to prevent parallel spam.
    pub async fn reserve_faucet_claim(
        &self,
        address: &str,
        token: &str,
        amount: f64,
    ) -> Result<Option<i64>> {
        let amount_dec = rust_decimal::Decimal::from_f64_retain(amount);

        let row = sqlx::query(
            "INSERT INTO faucet_claims (user_address, token, amount, tx_hash)
             VALUES ($1, $2, $3, '')
             ON CONFLICT DO NOTHING
             RETURNING id::bigint as id",
        )
        .bind(address)
        .bind(token)
        .bind(amount_dec)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|r| r.get::<i64, _>("id")))
    }

    /// Finalizes a pending faucet claim with the transaction hash.
    pub async fn finalize_faucet_claim(&self, claim_id: i64, tx_hash: &str) -> Result<()> {
        sqlx::query(
            "UPDATE faucet_claims
             SET tx_hash = $2
             WHERE id = $1",
        )
        .bind(claim_id)
        .bind(tx_hash)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Releases a pending faucet claim reservation.
    pub async fn release_faucet_claim(&self, claim_id: i64) -> Result<()> {
        sqlx::query("DELETE FROM faucet_claims WHERE id = $1")
            .bind(claim_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

// ==================== BRIDGE QUERIES ====================
impl Database {
    /// Reserves a BTC bridge mint record to prevent duplicate mints.
    pub async fn reserve_btc_bridge_mint(
        &self,
        btc_txid: &str,
        vault_address: &str,
        btc_sats: i64,
        usd_value: f64,
        points_amount: f64,
        recipient: &str,
    ) -> Result<Option<i64>> {
        ensure_varchar_max("bridge_btc_mints.btc_txid", btc_txid, 100)?;
        ensure_varchar_max("bridge_btc_mints.vault_address", vault_address, 128)?;
        ensure_varchar_max("bridge_btc_mints.starknet_recipient", recipient, 66)?;
        if btc_txid.trim().is_empty()
            || recipient.trim().is_empty()
            || vault_address.trim().is_empty()
        {
            return Err(AppError::BadRequest(
                "bridge_btc_mints requires txid, vault_address, and recipient".to_string(),
            ));
        }

        let usd_dec = rust_decimal::Decimal::from_f64_retain(usd_value).ok_or_else(|| {
            AppError::BadRequest("bridge_btc_mints.usd_value invalid".to_string())
        })?;
        let points_dec =
            rust_decimal::Decimal::from_f64_retain(points_amount).ok_or_else(|| {
                AppError::BadRequest("bridge_btc_mints.points_amount invalid".to_string())
            })?;

        let row = sqlx::query(
            "INSERT INTO bridge_btc_mints\n                (btc_txid, vault_address, btc_sats, usd_value, points_amount, starknet_recipient)\n             VALUES ($1, $2, $3, $4, $5, $6)\n             ON CONFLICT (btc_txid) DO NOTHING\n             RETURNING id::bigint as id",
        )
        .bind(btc_txid)
        .bind(vault_address)
        .bind(btc_sats)
        .bind(usd_dec)
        .bind(points_dec)
        .bind(recipient)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|r| r.get::<i64, _>("id")))
    }

    /// Marks a BTC bridge mint as finalized.
    pub async fn finalize_btc_bridge_mint(&self, mint_id: i64, mint_tx_hash: &str) -> Result<()> {
        ensure_varchar_max("bridge_btc_mints.mint_tx_hash", mint_tx_hash, 66)?;
        sqlx::query(
            "UPDATE bridge_btc_mints\n             SET mint_tx_hash = $2,\n                 status = 'minted',\n                 updated_at = NOW()\n             WHERE id = $1",
        )
        .bind(mint_id)
        .bind(mint_tx_hash)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Marks a BTC bridge mint as failed.
    pub async fn mark_btc_bridge_mint_failed(&self, mint_id: i64, error: &str) -> Result<()> {
        sqlx::query(
            "UPDATE bridge_btc_mints\n             SET status = 'failed',\n                 error = $2,\n                 updated_at = NOW()\n             WHERE id = $1",
        )
        .bind(mint_id)
        .bind(error)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

// ==================== NOTIFICATION QUERIES ====================
impl Database {
    /// Builds inputs required by `create_notification`.
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
    pub async fn create_notification(
        &self,
        user: &str,
        notif_type: &str,
        title: &str,
        message: &str,
        data: Option<serde_json::Value>,
    ) -> Result<i64> {
        // runtime query + ambil id dari PgRow
        let row = sqlx::query(
            "INSERT INTO notifications (user_address, type, title, message, data)
             VALUES ($1,$2,$3,$4,$5)
             RETURNING id::BIGINT as id",
        )
        .bind(user)
        .bind(notif_type)
        .bind(title)
        .bind(message)
        .bind(data)
        .fetch_one(&self.pool)
        .await?;

        // ambil kolom id
        let id: i64 = row.try_get("id")?;
        Ok(id)
    }

    /// Fetches data for `get_user_notifications`.
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
    pub async fn get_user_notifications(
        &self,
        address: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Notification>> {
        let notifications = sqlx::query_as::<_, Notification>(
            "SELECT
                id::BIGINT as id,
                user_address,
                type,
                title,
                message,
                data,
                read,
                created_at
             FROM notifications
             WHERE user_address = $1
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3",
        )
        .bind(address)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;

        Ok(notifications)
    }

    /// Updates state for `mark_notification_read`.
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
    pub async fn mark_notification_read(&self, id: i64, user: &str) -> Result<()> {
        sqlx::query("UPDATE notifications SET read = true WHERE id = $1 AND user_address = $2")
            .bind(id)
            .bind(user)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

// ==================== PRICE HISTORY QUERIES ====================
impl Database {
    /// Updates state for `save_price_tick`.
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
    pub async fn save_price_tick(&self, input: PriceTickUpsert<'_>) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO price_history
              (token, timestamp, open, high, low, close, volume, interval)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT (token, timestamp, interval) DO UPDATE
            SET high   = GREATEST(price_history.high, $4),
                low    = LEAST(price_history.low,  $5),
                close  = $6,
                volume = price_history.volume + $7
            "#,
        )
        .bind(input.token)
        .bind(input.timestamp)
        .bind(rust_decimal::Decimal::from_f64_retain(input.open))
        .bind(rust_decimal::Decimal::from_f64_retain(input.high))
        .bind(rust_decimal::Decimal::from_f64_retain(input.low))
        .bind(rust_decimal::Decimal::from_f64_retain(input.close))
        .bind(rust_decimal::Decimal::from_f64_retain(input.volume))
        .bind(input.interval)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Fetches data for `get_price_history`.
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
    pub async fn get_price_history(
        &self,
        token: &str,
        interval: &str,
        from: chrono::DateTime<chrono::Utc>,
        to: chrono::DateTime<chrono::Utc>,
    ) -> Result<Vec<PriceTick>> {
        let rows = sqlx::query_as::<_, PriceTick>(
            r#"
            SELECT
                token,
                timestamp,
                open   as "open",
                high   as "high",
                low    as "low",
                close  as "close",
                volume as "volume"
            FROM price_history
            WHERE token = $1
              AND interval = $2
              AND timestamp BETWEEN $3 AND $4
            ORDER BY timestamp ASC
            "#,
        )
        .bind(token)
        .bind(interval)
        .bind(from)
        .bind(to)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows)
    }
}

// ==================== LIMIT ORDER QUERIES ====================
impl Database {
    /// Builds inputs required by `create_limit_order`.
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
    pub async fn create_limit_order(&self, order: &LimitOrder) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO limit_orders
                (order_id, owner, from_token, to_token, amount, price, expiry, recipient, status)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            "#,
        )
        .bind(&order.order_id)
        .bind(&order.owner)
        .bind(&order.from_token)
        .bind(&order.to_token)
        .bind(order.amount)
        .bind(order.price)
        .bind(order.expiry)
        .bind(&order.recipient)
        .bind(order.status)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Fetches data for `get_limit_order`.
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
    pub async fn get_limit_order(&self, order_id: &str) -> Result<Option<LimitOrder>> {
        let order =
            sqlx::query_as::<_, LimitOrder>("SELECT * FROM limit_orders WHERE order_id = $1")
                .bind(order_id)
                .fetch_optional(&self.pool)
                .await?;
        Ok(order)
    }

    /// Fetches data for `get_active_orders_for_owner`.
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
    pub async fn get_active_orders_for_owner(&self, owner: &str) -> Result<Vec<LimitOrder>> {
        let orders = sqlx::query_as::<_, LimitOrder>(
            "SELECT * FROM limit_orders WHERE owner = $1 AND status = 0 AND expiry > NOW() ORDER BY created_at ASC",
        )
        .bind(owner)
        .fetch_all(&self.pool)
        .await?;
        Ok(orders)
    }

    /// Marks expired limit orders for a specific owner.
    ///
    /// Status transition:
    /// - 0 (active) -> 4 (expired)
    /// - 1 (partial) -> 4 (expired)
    pub async fn expire_limit_orders_for_owner(&self, owner: &str) -> Result<u64> {
        let result = sqlx::query(
            r#"
            UPDATE limit_orders
            SET status = 4
            WHERE owner = $1
              AND status IN (0, 1)
              AND expiry <= NOW()
            "#,
        )
        .bind(owner)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
    }

    /// Updates state for `update_order_status`.
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
    pub async fn update_order_status(&self, order_id: &str, status: i16) -> Result<()> {
        sqlx::query("UPDATE limit_orders SET status = $1 WHERE order_id = $2")
            .bind(status)
            .bind(order_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Handles `fill_order` logic.
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
    pub async fn fill_order(&self, order_id: &str, amount: rust_decimal::Decimal) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE limit_orders
            SET filled = filled + $1,
                status = CASE WHEN filled + $1 >= amount THEN 2 ELSE 1 END
            WHERE order_id = $2
            "#,
        )
        .bind(amount)
        .bind(order_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

// ==================== NFT DISCOUNT STATE ====================
impl Database {
    /// Fetches data for `get_nft_discount_state`.
    pub async fn get_nft_discount_state(
        &self,
        contract_address: &str,
        user_address: &str,
        period_epoch: i64,
    ) -> Result<Option<NftDiscountState>> {
        ensure_varchar_max("nft_discount_state.contract_address", contract_address, 66)?;
        ensure_varchar_max("nft_discount_state.user_address", user_address, 66)?;

        let row = sqlx::query(
            r#"
            SELECT
                tier,
                discount_percent,
                is_active,
                max_usage,
                chain_used_in_period,
                local_used_in_period,
                updated_at
            FROM nft_discount_state
            WHERE contract_address = $1
              AND user_address = $2
              AND period_epoch = $3
            LIMIT 1
            "#,
        )
        .bind(contract_address)
        .bind(user_address)
        .bind(period_epoch)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|value| NftDiscountState {
            tier: value.get::<i32, _>("tier"),
            discount_percent: value.get::<f64, _>("discount_percent"),
            is_active: value.get::<bool, _>("is_active"),
            max_usage: value.get::<i64, _>("max_usage"),
            chain_used_in_period: value.get::<i64, _>("chain_used_in_period"),
            local_used_in_period: value.get::<i64, _>("local_used_in_period"),
            updated_at: value.get::<chrono::DateTime<chrono::Utc>, _>("updated_at"),
        }))
    }

    /// Updates state for `upsert_nft_discount_state_from_chain`.
    pub async fn upsert_nft_discount_state_from_chain(
        &self,
        input: NftDiscountStateUpsert<'_>,
    ) -> Result<NftDiscountState> {
        ensure_varchar_max(
            "nft_discount_state.contract_address",
            input.contract_address,
            66,
        )?;
        ensure_varchar_max("nft_discount_state.user_address", input.user_address, 66)?;

        let row = sqlx::query(
            r#"
            INSERT INTO nft_discount_state (
                contract_address,
                user_address,
                period_epoch,
                tier,
                discount_percent,
                is_active,
                max_usage,
                chain_used_in_period,
                local_used_in_period,
                last_chain_sync_at,
                updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, NOW(), NOW())
            ON CONFLICT (contract_address, user_address, period_epoch)
            DO UPDATE SET
                tier = EXCLUDED.tier,
                discount_percent = EXCLUDED.discount_percent,
                is_active = EXCLUDED.is_active,
                max_usage = EXCLUDED.max_usage,
                chain_used_in_period = EXCLUDED.chain_used_in_period,
                local_used_in_period = GREATEST(
                    nft_discount_state.local_used_in_period,
                    EXCLUDED.chain_used_in_period
                ),
                last_chain_sync_at = NOW(),
                updated_at = NOW()
            RETURNING
                tier,
                discount_percent,
                is_active,
                max_usage,
                chain_used_in_period,
                local_used_in_period,
                updated_at
            "#,
        )
        .bind(input.contract_address)
        .bind(input.user_address)
        .bind(input.period_epoch)
        .bind(input.tier)
        .bind(input.discount_percent)
        .bind(input.is_active)
        .bind(input.max_usage.max(0))
        .bind(input.chain_used_in_period.max(0))
        .fetch_one(&self.pool)
        .await?;

        Ok(NftDiscountState {
            tier: row.get::<i32, _>("tier"),
            discount_percent: row.get::<f64, _>("discount_percent"),
            is_active: row.get::<bool, _>("is_active"),
            max_usage: row.get::<i64, _>("max_usage"),
            chain_used_in_period: row.get::<i64, _>("chain_used_in_period"),
            local_used_in_period: row.get::<i64, _>("local_used_in_period"),
            updated_at: row.get::<chrono::DateTime<chrono::Utc>, _>("updated_at"),
        })
    }

    /// Updates state for `increment_nft_discount_local_usage`.
    pub async fn increment_nft_discount_local_usage(
        &self,
        contract_address: &str,
        user_address: &str,
        period_epoch: i64,
        delta: i64,
    ) -> Result<i64> {
        ensure_varchar_max("nft_discount_state.contract_address", contract_address, 66)?;
        ensure_varchar_max("nft_discount_state.user_address", user_address, 66)?;
        if delta <= 0 {
            return Ok(0);
        }

        let row = sqlx::query(
            r#"
            INSERT INTO nft_discount_state (
                contract_address,
                user_address,
                period_epoch,
                local_used_in_period,
                updated_at
            )
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (contract_address, user_address, period_epoch)
            DO UPDATE SET
                local_used_in_period =
                    nft_discount_state.local_used_in_period + EXCLUDED.local_used_in_period,
                updated_at = NOW()
            RETURNING local_used_in_period
            "#,
        )
        .bind(contract_address)
        .bind(user_address)
        .bind(period_epoch)
        .bind(delta)
        .fetch_one(&self.pool)
        .await?;

        Ok(row.get::<i64, _>("local_used_in_period"))
    }
}
