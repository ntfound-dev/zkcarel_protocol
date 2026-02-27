use crate::{
    config::Config,
    constants::{
        FAUCET_AMOUNT_CAREL, FAUCET_AMOUNT_USDC, FAUCET_AMOUNT_USDT, FAUCET_COOLDOWN_HOURS,
        TOKEN_USDC, TOKEN_USDT,
    },
    db::Database,
    error::{AppError, Result},
    models::FaucetClaim,
    services::onchain::{
        parse_felt, resolve_backend_account, u256_from_felts, u256_to_felts, OnchainInvoker,
        OnchainReader,
    },
};
use chrono::{DateTime, Duration, Utc};
use rust_decimal::prelude::ToPrimitive;
use sqlx::Row;
use starknet_core::types::{Call, ExecutionResult, Felt, FunctionCall};
use starknet_core::utils::get_selector_from_name;
use std::sync::Arc;

// Internal helper that supports `cooldown_hours_from_config` operations.
fn cooldown_hours_from_config(config: &Config) -> i64 {
    config
        .faucet_cooldown_hours
        .unwrap_or(FAUCET_COOLDOWN_HOURS as u64) as i64
}

// Internal helper that checks conditions for `is_carel_token`.
fn is_carel_token(token: &str) -> bool {
    token.trim().eq_ignore_ascii_case("CAREL")
}

// Internal helper that parses or transforms values for `normalize_token_symbol`.
fn normalize_token_symbol(token: &str) -> String {
    token.trim().to_ascii_uppercase()
}

// Internal helper that checks conditions for `is_internal_faucet_token`.
fn is_internal_faucet_token(token: &str) -> bool {
    matches!(
        normalize_token_symbol(token).as_str(),
        "CAREL" | "USDT" | "USDC"
    )
}

// Internal helper that checks conditions for `is_transaction_hash_missing_error`.
fn is_transaction_hash_missing_error(error: &AppError) -> bool {
    match error {
        AppError::BlockchainRPC(message) => {
            let lower = message.to_ascii_lowercase();
            (lower.contains("transaction") && lower.contains("not found"))
                || lower.contains("txn hash not found")
                || lower.contains("unknown transaction")
        }
        _ => false,
    }
}

// Internal helper that checks conditions for `is_faucet_carel_unlimited`.
fn is_faucet_carel_unlimited() -> bool {
    std::env::var("FAUCET_CAREL_UNLIMITED")
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "y" | "on"
            )
        })
        .unwrap_or(false)
}

// Internal helper that supports `faucet_policy_reset_at` operations.
fn faucet_policy_reset_at() -> Option<DateTime<Utc>> {
    let raw = std::env::var("FAUCET_POLICY_RESET_AT").ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    DateTime::parse_from_rfc3339(trimmed)
        .ok()
        .map(|value| value.with_timezone(&Utc))
}

// Internal helper that supports `amount_for_token` operations.
fn amount_for_token(token: &str, config: &Config) -> Result<f64> {
    let amount = match normalize_token_symbol(token).as_str() {
        "CAREL" => config.faucet_carel_amount.unwrap_or(FAUCET_AMOUNT_CAREL),
        "USDT" => FAUCET_AMOUNT_USDT,
        "USDC" => FAUCET_AMOUNT_USDC,
        _ => return Err(AppError::InvalidToken),
    };
    Ok(amount)
}

pub struct FaucetService {
    db: Database,
    config: Config,
    invoker: Arc<OnchainInvoker>,
    reader: Arc<OnchainReader>,
    faucet_address: Felt,
}

impl FaucetService {
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
    pub fn new(db: Database, config: Config) -> Result<Self> {
        let invoker = OnchainInvoker::from_config(&config)?
            .ok_or_else(|| AppError::Internal("Faucet signer not configured".into()))?;
        let reader = OnchainReader::from_config(&config)?;

        let faucet_account = resolve_backend_account(&config)
            .ok_or_else(|| AppError::Internal("Faucet account address missing".into()))?;
        let faucet_address = parse_felt(faucet_account)?;

        Ok(Self {
            db,
            config,
            invoker: Arc::new(invoker),
            reader: Arc::new(reader),
            faucet_address,
        })
    }

    // Internal helper that fetches data for `resolve_token_address`.
    fn resolve_token_address(&self, token: &str) -> Result<String> {
        match normalize_token_symbol(token).as_str() {
            "CAREL" => Ok(self.config.carel_token_address.clone()),
            "USDT" => Ok(TOKEN_USDT.to_string()),
            "USDC" => Ok(TOKEN_USDC.to_string()),
            _ => Err(AppError::InvalidToken),
        }
    }

    // Internal helper that fetches data for `get_token_decimals`.
    async fn get_token_decimals(&self, token_address: &str) -> Result<u8> {
        let contract = parse_felt(token_address)?;
        let selector = get_selector_from_name("decimals")
            .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
        let call = FunctionCall {
            contract_address: contract,
            entry_point_selector: selector,
            calldata: vec![],
        };
        let result = self.reader.call(call).await;
        if let Ok(values) = result {
            if let Some(value) = values.first() {
                if let Ok(decoded) = u256_from_felts(value, &Felt::from(0_u128)) {
                    return Ok(decoded as u8);
                }
                if let Ok(parsed) = value.to_string().parse::<u8>() {
                    return Ok(parsed);
                }
            }
        }
        Ok(18)
    }

    // Internal helper that fetches data for `get_token_balance`.
    async fn get_token_balance(&self, token_address: &str) -> Result<u128> {
        let contract = parse_felt(token_address)?;
        let selector = get_selector_from_name("balanceOf")
            .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
        let call = FunctionCall {
            contract_address: contract,
            entry_point_selector: selector,
            calldata: vec![self.faucet_address],
        };
        let values = self.reader.call(call).await?;
        let low = values
            .first()
            .ok_or_else(|| AppError::Internal("Balance low missing".into()))?;
        let high = values
            .get(1)
            .ok_or_else(|| AppError::Internal("Balance high missing".into()))?;
        u256_from_felts(low, high)
    }

    // Internal helper that fetches data for `should_bypass_cooldown_for_failed_claim`.
    async fn should_bypass_cooldown_for_failed_claim(
        &self,
        user_address: &str,
        token: &str,
    ) -> bool {
        let last_claim = match self.get_last_claim(user_address, token).await {
            Ok(value) => value,
            Err(_) => return false,
        };
        let Some(last_claim) = last_claim else {
            return false;
        };
        let tx_hash = last_claim.tx_hash.trim();
        if tx_hash.is_empty() {
            return false;
        }
        let tx_hash_felt = match parse_felt(tx_hash) {
            Ok(value) => value,
            Err(_) => return false,
        };
        match self.reader.get_transaction_receipt(&tx_hash_felt).await {
            Ok(receipt) => matches!(
                receipt.receipt.execution_result(),
                ExecutionResult::Reverted { .. }
            ),
            Err(error) => is_transaction_hash_missing_error(&error),
        }
    }

    // Internal helper that fetches data for `should_bypass_cooldown_for_policy_reset`.
    async fn should_bypass_cooldown_for_policy_reset(
        &self,
        user_address: &str,
        token: &str,
    ) -> bool {
        let Some(reset_at) = faucet_policy_reset_at() else {
            return false;
        };
        let last_claim = match self.get_last_claim(user_address, token).await {
            Ok(value) => value,
            Err(_) => return false,
        };
        let Some(last_claim) = last_claim else {
            return false;
        };
        last_claim.claimed_at < reset_at
    }

    /// Checks conditions for `can_claim`.
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
    pub async fn can_claim(&self, user_address: &str, token: &str) -> Result<bool> {
        if !self.config.is_testnet() {
            return Err(AppError::BadRequest("Faucet only on testnet".to_string()));
        }
        let token_symbol = normalize_token_symbol(token);
        if !is_internal_faucet_token(&token_symbol) {
            return Ok(false);
        }
        if self.resolve_token_address(&token_symbol).is_err() {
            return Ok(false);
        }
        if is_carel_token(&token_symbol) && is_faucet_carel_unlimited() {
            return Ok(true);
        }
        let cooldown_hours = cooldown_hours_from_config(&self.config);
        let can_claim = self
            .db
            .can_claim_faucet(user_address, &token_symbol, cooldown_hours)
            .await?;
        if can_claim {
            return Ok(true);
        }

        if self
            .should_bypass_cooldown_for_policy_reset(user_address, &token_symbol)
            .await
        {
            tracing::warn!(
                "Bypassing faucet cooldown due policy reset timestamp: user={} token={}",
                user_address,
                token_symbol
            );
            return Ok(true);
        }

        if self
            .should_bypass_cooldown_for_failed_claim(user_address, &token_symbol)
            .await
        {
            tracing::warn!(
                "Bypassing faucet cooldown because last claim tx failed or missing: user={} token={}",
                user_address,
                token_symbol
            );
            return Ok(true);
        }

        Ok(false)
    }

    /// Fetches data for `get_next_claim_time`.
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
    pub async fn get_next_claim_time(
        &self,
        user_address: &str,
        token: &str,
    ) -> Result<Option<DateTime<Utc>>> {
        let token_symbol = normalize_token_symbol(token);
        if !is_internal_faucet_token(&token_symbol) {
            return Err(AppError::InvalidToken);
        }
        if is_carel_token(&token_symbol) && is_faucet_carel_unlimited() {
            return Ok(None);
        }
        let last_claim = sqlx::query(
            "SELECT claimed_at FROM faucet_claims WHERE user_address = $1 AND token = $2 ORDER BY claimed_at DESC LIMIT 1"
        )
        .bind(user_address)
        .bind(&token_symbol)
        .fetch_optional(self.db.pool())
        .await?;

        match last_claim {
            Some(row) => {
                let claimed_at: DateTime<Utc> = row.get("claimed_at");
                if let Some(reset_at) = faucet_policy_reset_at() {
                    if claimed_at < reset_at {
                        return Ok(None);
                    }
                }
                let cooldown_hours = cooldown_hours_from_config(&self.config);
                Ok(Some(claimed_at + Duration::hours(cooldown_hours)))
            }
            None => Ok(None),
        }
    }

    /// Fetches data for `get_last_claim`.
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
    pub async fn get_last_claim(
        &self,
        user_address: &str,
        token: &str,
    ) -> Result<Option<FaucetClaim>> {
        let token_symbol = normalize_token_symbol(token);
        if !is_internal_faucet_token(&token_symbol) {
            return Ok(None);
        }
        let row = sqlx::query(
            "SELECT user_address, token, amount, tx_hash, claimed_at
             FROM faucet_claims
             WHERE user_address = $1 AND token = $2
             ORDER BY claimed_at DESC LIMIT 1",
        )
        .bind(user_address)
        .bind(&token_symbol)
        .fetch_optional(self.db.pool())
        .await?;

        Ok(row.map(|r| FaucetClaim {
            user_address: r.get("user_address"),
            token: r.get("token"),
            amount: r
                .get::<rust_decimal::Decimal, _>("amount")
                .to_f64()
                .unwrap_or(0.0),
            tx_hash: r.get("tx_hash"),
            claimed_at: r.get("claimed_at"),
        }))
    }

    /// Runs `claim_tokens` and handles related side effects.
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
    pub async fn claim_tokens(&self, user_address: &str, token: &str) -> Result<String> {
        if !self.config.is_testnet() {
            return Err(AppError::BadRequest("Faucet only on testnet".into()));
        }

        let token_symbol = normalize_token_symbol(token);
        if !is_internal_faucet_token(&token_symbol) {
            return Err(AppError::BadRequest(
                "Token not supported by internal faucet".into(),
            ));
        }

        let token_address = self.resolve_token_address(&token_symbol)?;
        let token_address = token_address.trim();
        if token_address.is_empty() {
            return Err(AppError::BadRequest("Token address not configured".into()));
        }

        // Cek saldo token faucet sebelum kirim
        let balance = self.get_token_balance(token_address).await?;

        if !self.can_claim(user_address, &token_symbol).await? {
            return Err(AppError::FaucetCooldown);
        }

        let amount = amount_for_token(&token_symbol, &self.config)?;
        let decimals = self.get_token_decimals(token_address).await?;
        let scale = 10f64.powi(decimals as i32);
        let amount_u128 = (amount * scale).round() as u128;
        if amount_u128 == 0 {
            return Err(AppError::BadRequest("Faucet amount too small".into()));
        }
        if balance < amount_u128 {
            return Err(AppError::InsufficientBalance);
        }

        let tx_hash = self
            .send_tokens(user_address, token_address, amount_u128)
            .await?;
        self.db
            .record_faucet_claim(user_address, &token_symbol, amount, &tx_hash)
            .await?;

        let _ = self
            .db
            .create_notification(
                user_address,
                "faucet.claim",
                "Token faucet masuk",
                &format!("Berhasil claim {} {}", amount, token_symbol),
                Some(serde_json::json!({
                    "tx_hash": tx_hash,
                    "tx_network": "starknet"
                })),
            )
            .await;

        Ok(tx_hash)
    }

    // Internal helper that runs side-effecting logic for `send_tokens`.
    async fn send_tokens(&self, to: &str, token_address: &str, amount: u128) -> Result<String> {
        let to = parse_felt(to)?;
        let token = parse_felt(token_address)?;
        let selector = get_selector_from_name("transfer")
            .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
        let (low, high) = u256_to_felts(amount);
        let calldata = vec![to, low, high];

        let call = Call {
            to: token,
            selector,
            calldata,
        };
        let tx_hash = self.invoker.invoke(call).await?;
        Ok(tx_hash.to_string())
    }

    /// Fetches data for `get_stats`.
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
    pub async fn get_stats(&self) -> Result<FaucetStats> {
        let row = sqlx::query(
            "SELECT 
                COUNT(DISTINCT user_address) as total_users,
                COUNT(*) as total_claims,
                COALESCE(SUM(CASE WHEN token = 'CAREL' THEN amount ELSE 0 END), 0) as total_carel,
                COALESCE(SUM(CASE WHEN token = 'USDT' THEN amount ELSE 0 END), 0) as total_usdt,
                COALESCE(SUM(CASE WHEN token = 'USDC' THEN amount ELSE 0 END), 0) as total_usdc
             FROM faucet_claims",
        )
        .fetch_one(self.db.pool())
        .await?;

        Ok(FaucetStats {
            total_users: row.get::<i64, _>("total_users"),
            total_claims: row.get::<i64, _>("total_claims"),
            total_carel_distributed: row.get::<rust_decimal::Decimal, _>("total_carel"),
            total_usdt_distributed: row.get::<rust_decimal::Decimal, _>("total_usdt"),
            total_usdc_distributed: row.get::<rust_decimal::Decimal, _>("total_usdc"),
        })
    }
}

#[derive(Debug, serde::Serialize)]
pub struct FaucetStats {
    pub total_users: i64,
    pub total_claims: i64,
    pub total_carel_distributed: rust_decimal::Decimal,
    pub total_usdt_distributed: rust_decimal::Decimal,
    pub total_usdc_distributed: rust_decimal::Decimal,
}

#[cfg(test)]
mod tests {
    use super::*;

    // Internal helper that supports `sample_config` operations.
    fn sample_config() -> Config {
        Config {
            host: "0.0.0.0".to_string(),
            port: 3000,
            environment: "testnet".to_string(),
            database_url: "postgres://localhost".to_string(),
            database_max_connections: 1,
            redis_url: "redis://localhost:6379".to_string(),
            point_calculator_batch_size: 100,
            point_calculator_max_batches_per_tick: 1,
            starknet_rpc_url: "http://localhost:5050".to_string(),
            starknet_chain_id: "SN_MAIN".to_string(),
            ethereum_rpc_url: "http://localhost:8545".to_string(),
            carel_token_address: "0x1".to_string(),
            snapshot_distributor_address: "0x2".to_string(),
            point_storage_address: "0x3".to_string(),
            price_oracle_address: "0x4".to_string(),
            limit_order_book_address: "0x5".to_string(),
            staking_carel_address: None,
            discount_soulbound_address: None,
            treasury_address: None,
            referral_system_address: None,
            ai_executor_address: "0x6".to_string(),
            ai_signature_verifier_address: None,
            bridge_aggregator_address: "0x7".to_string(),
            zk_privacy_router_address: "0x8".to_string(),
            battleship_garaga_address: None,
            privacy_router_address: None,
            privacy_auto_garaga_payload_file: None,
            privacy_auto_garaga_proof_file: None,
            privacy_auto_garaga_public_inputs_file: None,
            privacy_auto_garaga_prover_cmd: None,
            privacy_auto_garaga_prover_timeout_ms: 45_000,
            private_btc_swap_address: "0x9".to_string(),
            dark_pool_address: "0x10".to_string(),
            private_payments_address: "0x11".to_string(),
            anonymous_credentials_address: "0x12".to_string(),
            token_strk_address: None,
            token_eth_address: None,
            token_btc_address: None,
            token_strk_l1_address: None,
            faucet_btc_amount: Some(0.02),
            faucet_strk_amount: None,
            faucet_carel_amount: None,
            faucet_cooldown_hours: Some(12),
            backend_private_key: "k".to_string(),
            backend_public_key: "p".to_string(),
            backend_account_address: None,
            jwt_secret: "s".to_string(),
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

    #[test]
    // Internal helper that supports `cooldown_hours_from_config_uses_override` operations.
    fn cooldown_hours_from_config_uses_override() {
        // Memastikan cooldown memakai nilai override config
        let cfg = sample_config();
        assert_eq!(cooldown_hours_from_config(&cfg), 12);
    }

    #[test]
    // Internal helper that supports `amount_for_token_uses_override` operations.
    fn amount_for_token_uses_override() {
        // Memastikan amount token menggunakan override config
        let mut cfg = sample_config();
        cfg.faucet_carel_amount = Some(30.0);
        let amount = amount_for_token("CAREL", &cfg).expect("token valid");
        assert!((amount - 30.0).abs() < f64::EPSILON);
    }
}
