use crate::{
    config::Config,
    error::{AppError, Result},
    models::*,
};
use sqlx::{postgres::PgPoolOptions, PgPool, Row};

#[derive(Clone)]
pub struct Database {
    pool: PgPool,
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
            database_url: database_url.to_string(),
            database_max_connections: 1,
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
            bridge_aggregator_address: "0x0000000000000000000000000000000000000007".to_string(),
            zk_privacy_router_address: "0x0000000000000000000000000000000000000008".to_string(),
            battleship_garaga_address: None,
            privacy_router_address: None,
            privacy_auto_garaga_payload_file: None,
            privacy_auto_garaga_proof_file: None,
            privacy_auto_garaga_public_inputs_file: None,
            privacy_auto_garaga_prover_cmd: None,
            privacy_auto_garaga_prover_timeout_ms: 45_000,
            private_btc_swap_address: "0x0000000000000000000000000000000000000009".to_string(),
            dark_pool_address: "0x0000000000000000000000000000000000000010".to_string(),
            private_payments_address: "0x0000000000000000000000000000000000000011".to_string(),
            anonymous_credentials_address: "0x0000000000000000000000000000000000000012".to_string(),
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
            dev_wallet_address: None,
            ai_level_burn_address: None,
            layerswap_api_key: None,
            layerswap_api_url: "https://api.layerswap.io/api/v2".to_string(),
            atomiq_api_key: None,
            atomiq_api_url: "".to_string(),
            garden_api_key: None,
            garden_api_url: "".to_string(),
            sumo_login_api_key: None,
            sumo_login_api_url: "".to_string(),
            xverse_api_key: None,
            xverse_api_url: "".to_string(),
            privacy_verifier_routers: "".to_string(),
            stripe_secret_key: None,
            moonpay_api_key: None,
            rate_limit_public: 1,
            rate_limit_authenticated: 1,
            ai_rate_limit_window_seconds: 60,
            ai_rate_limit_global_per_window: 40,
            ai_rate_limit_level_1_per_window: 20,
            ai_rate_limit_level_2_per_window: 10,
            ai_rate_limit_level_3_per_window: 8,
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
        let pool = PgPoolOptions::new()
            .max_connections(config.database_max_connections)
            .connect(&config.database_url)
            .await?;

        Ok(Self { pool })
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
        sqlx::migrate!("./migrations").run(&self.pool).await?;
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

    /// Updates state for `record_ai_level_upgrade`.
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
    pub async fn record_ai_level_upgrade(
        &self,
        user_address: &str,
        previous_level: u8,
        target_level: u8,
        payment_carel: rust_decimal::Decimal,
        onchain_tx_hash: &str,
        block_number: i64,
    ) -> Result<()> {
        ensure_varchar_max("ai_level_upgrades.user_address", user_address, 66)?;
        ensure_varchar_max("ai_level_upgrades.onchain_tx_hash", onchain_tx_hash, 66)?;
        if !(1..=3).contains(&previous_level) || !(2..=3).contains(&target_level) {
            return Err(AppError::BadRequest(
                "Invalid AI level upgrade payload".to_string(),
            ));
        }
        sqlx::query(
            "INSERT INTO ai_level_upgrades
                (user_address, previous_level, target_level, payment_carel, onchain_tx_hash, block_number)
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(user_address)
        .bind(previous_level as i16)
        .bind(target_level as i16)
        .bind(payment_carel)
        .bind(onchain_tx_hash)
        .bind(block_number)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Fetches data for `find_user_by_sumo_subject`.
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
    pub async fn find_user_by_sumo_subject(&self, sumo_subject: &str) -> Result<Option<String>> {
        ensure_varchar_max("users.sumo_subject", sumo_subject, 255)?;
        let row: Option<String> =
            sqlx::query_scalar("SELECT address FROM users WHERE sumo_subject = $1 LIMIT 1")
                .bind(sumo_subject)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row)
    }

    /// Updates state for `bind_sumo_subject_once`.
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
    pub async fn bind_sumo_subject_once(&self, address: &str, sumo_subject: &str) -> Result<()> {
        ensure_varchar_max("users.address", address, 66)?;
        ensure_varchar_max("users.sumo_subject", sumo_subject, 255)?;

        let result = sqlx::query(
            "UPDATE users
             SET sumo_subject = $1
             WHERE address = $2
               AND (sumo_subject IS NULL OR sumo_subject = $1)",
        )
        .bind(sumo_subject)
        .bind(address)
        .execute(&self.pool)
        .await?;

        if result.rows_affected() > 0 {
            return Ok(());
        }

        let current: Option<String> =
            sqlx::query_scalar("SELECT sumo_subject FROM users WHERE address = $1")
                .bind(address)
                .fetch_optional(&self.pool)
                .await?;

        if current.as_deref() == Some(sumo_subject) {
            return Ok(());
        }

        Err(AppError::BadRequest(
            "This account is already bound to another Sumo identity".to_string(),
        ))
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
             WHERE UPPER(SUBSTRING(address FROM 3 FOR 8)) = $1
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
             SET total_points = total_points - $3
             WHERE user_address = $1 AND epoch = $2",
        )
        .bind(address)
        .bind(epoch)
        .bind(amount)
        .execute(&self.pool)
        .await?;

        Ok(())
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
                  AND claimed_at >= NOW() - make_interval(hours => $3)
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

    /// Handles `record_faucet_claim` logic.
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
    pub async fn record_faucet_claim(
        &self,
        address: &str,
        token: &str,
        amount: f64,
        tx_hash: &str,
    ) -> Result<()> {
        // lebih aman: gunakan from_f64 dan handle Option di caller jika perlu
        let amount_dec = rust_decimal::Decimal::from_f64_retain(amount);

        sqlx::query(
            "INSERT INTO faucet_claims (user_address, token, amount, tx_hash)
             VALUES ($1, $2, $3, $4)",
        )
        .bind(address)
        .bind(token)
        .bind(amount_dec)
        .bind(tx_hash)
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
             RETURNING id",
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
            "SELECT * FROM notifications
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
    pub async fn save_price_tick(
        &self,
        token: &str,
        timestamp: chrono::DateTime<chrono::Utc>,
        open: f64,
        high: f64,
        low: f64,
        close: f64,
        volume: f64,
        interval: &str,
    ) -> Result<()> {
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
        .bind(token)
        .bind(timestamp)
        .bind(rust_decimal::Decimal::from_f64_retain(open))
        .bind(rust_decimal::Decimal::from_f64_retain(high))
        .bind(rust_decimal::Decimal::from_f64_retain(low))
        .bind(rust_decimal::Decimal::from_f64_retain(close))
        .bind(rust_decimal::Decimal::from_f64_retain(volume))
        .bind(interval)
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
