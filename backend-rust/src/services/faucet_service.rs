use crate::{
    config::Config,
    constants::{
        FAUCET_AMOUNT_BTC, FAUCET_AMOUNT_CAREL, FAUCET_AMOUNT_ETH, FAUCET_AMOUNT_STRK,
        FAUCET_COOLDOWN_HOURS,
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
use starknet_core::types::{Call, Felt, FunctionCall};
use starknet_core::utils::get_selector_from_name;
use std::sync::Arc;

fn cooldown_hours_from_config(config: &Config) -> i64 {
    config
        .faucet_cooldown_hours
        .unwrap_or(FAUCET_COOLDOWN_HOURS as u64) as i64
}

fn is_carel_token(token: &str) -> bool {
    token.trim().eq_ignore_ascii_case("CAREL")
}

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

fn amount_for_token(token: &str, config: &Config) -> Result<f64> {
    let amount = match token {
        "BTC" => config.faucet_btc_amount.unwrap_or(FAUCET_AMOUNT_BTC),
        "ETH" => FAUCET_AMOUNT_ETH,
        "STRK" => config.faucet_strk_amount.unwrap_or(FAUCET_AMOUNT_STRK),
        "CAREL" => config.faucet_carel_amount.unwrap_or(FAUCET_AMOUNT_CAREL),
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

    fn resolve_token_address(&self, token: &str) -> Result<String> {
        match token.to_ascii_uppercase().as_str() {
            "CAREL" => Ok(self.config.carel_token_address.clone()),
            "STRK" => self
                .config
                .token_strk_address
                .clone()
                .ok_or_else(|| AppError::BadRequest("STRK token address not configured".into())),
            "ETH" => self
                .config
                .token_eth_address
                .clone()
                .ok_or_else(|| AppError::BadRequest("ETH token address not configured".into())),
            "BTC" => self
                .config
                .token_btc_address
                .clone()
                .ok_or_else(|| AppError::BadRequest("BTC token address not configured".into())),
            _ => Err(AppError::InvalidToken),
        }
    }

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
            if let Some(value) = values.get(0) {
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
            .get(0)
            .ok_or_else(|| AppError::Internal("Balance low missing".into()))?;
        let high = values
            .get(1)
            .ok_or_else(|| AppError::Internal("Balance high missing".into()))?;
        u256_from_felts(low, high)
    }

    pub async fn can_claim(&self, user_address: &str, token: &str) -> Result<bool> {
        if !self.config.is_testnet() {
            return Err(AppError::BadRequest("Faucet only on testnet".to_string()));
        }
        if self.resolve_token_address(token).is_err() {
            return Ok(false);
        }
        if is_carel_token(token) && is_faucet_carel_unlimited() {
            return Ok(true);
        }
        let cooldown_hours = cooldown_hours_from_config(&self.config);
        self.db
            .can_claim_faucet(user_address, token, cooldown_hours)
            .await
    }

    pub async fn get_next_claim_time(
        &self,
        user_address: &str,
        token: &str,
    ) -> Result<Option<DateTime<Utc>>> {
        if is_carel_token(token) && is_faucet_carel_unlimited() {
            return Ok(None);
        }
        let last_claim = sqlx::query(
            "SELECT claimed_at FROM faucet_claims WHERE user_address = $1 AND token = $2 ORDER BY claimed_at DESC LIMIT 1"
        )
        .bind(user_address)
        .bind(token)
        .fetch_optional(self.db.pool())
        .await?;

        match last_claim {
            Some(row) => {
                let claimed_at: DateTime<Utc> = row.get("claimed_at");
                let cooldown_hours = cooldown_hours_from_config(&self.config);
                Ok(Some(claimed_at + Duration::hours(cooldown_hours)))
            }
            None => Ok(None),
        }
    }

    pub async fn get_last_claim(
        &self,
        user_address: &str,
        token: &str,
    ) -> Result<Option<FaucetClaim>> {
        let row = sqlx::query(
            "SELECT user_address, token, amount, tx_hash, claimed_at
             FROM faucet_claims
             WHERE user_address = $1 AND token = $2
             ORDER BY claimed_at DESC LIMIT 1",
        )
        .bind(user_address)
        .bind(token)
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

    pub async fn claim_tokens(&self, user_address: &str, token: &str) -> Result<String> {
        if !self.config.is_testnet() {
            return Err(AppError::BadRequest("Faucet only on testnet".into()));
        }

        let token_address = self.resolve_token_address(token)?;
        let token_address = token_address.trim();
        if token_address.is_empty() {
            return Err(AppError::BadRequest("Token address not configured".into()));
        }

        // Cek saldo token faucet sebelum kirim
        let balance = self.get_token_balance(token_address).await?;

        if !self.can_claim(user_address, token).await? {
            return Err(AppError::FaucetCooldown);
        }

        let amount = amount_for_token(token, &self.config)?;
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
            .record_faucet_claim(user_address, token, amount, &tx_hash)
            .await?;

        let _ = self
            .db
            .create_notification(
                user_address,
                "faucet.claim",
                "Faucet claimed",
                &format!("Claimed {} {}", amount, token),
                Some(serde_json::json!({ "tx_hash": tx_hash })),
            )
            .await;

        Ok(tx_hash)
    }

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

    pub async fn get_stats(&self) -> Result<FaucetStats> {
        let row = sqlx::query(
            "SELECT 
                COUNT(DISTINCT user_address) as total_users,
                COUNT(*) as total_claims,
                COALESCE(SUM(CASE WHEN token = 'BTC' THEN amount ELSE 0 END), 0) as total_btc,
                COALESCE(SUM(CASE WHEN token = 'STRK' THEN amount ELSE 0 END), 0) as total_strk,
                COALESCE(SUM(CASE WHEN token = 'CAREL' THEN amount ELSE 0 END), 0) as total_carel
             FROM faucet_claims",
        )
        .fetch_one(self.db.pool())
        .await?;

        Ok(FaucetStats {
            total_users: row.get::<i64, _>("total_users"),
            total_claims: row.get::<i64, _>("total_claims"),
            total_btc_distributed: row.get::<rust_decimal::Decimal, _>("total_btc"),
            total_strk_distributed: row.get::<rust_decimal::Decimal, _>("total_strk"),
            total_carel_distributed: row.get::<rust_decimal::Decimal, _>("total_carel"),
        })
    }
}

#[derive(Debug, serde::Serialize)]
pub struct FaucetStats {
    pub total_users: i64,
    pub total_claims: i64,
    pub total_btc_distributed: rust_decimal::Decimal,
    pub total_strk_distributed: rust_decimal::Decimal,
    pub total_carel_distributed: rust_decimal::Decimal,
}

#[cfg(test)]
mod tests {
    use super::*;

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
            privacy_router_address: None,
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
            openai_api_key: None,
            gemini_api_key: None,
            gemini_api_url: "https://generativelanguage.googleapis.com/v1beta".to_string(),
            gemini_model: "gemini-2.0-flash".to_string(),
            twitter_bearer_token: None,
            telegram_bot_token: None,
            discord_bot_token: None,
            social_tasks_json: None,
            admin_manual_key: None,
            dev_wallet_address: None,
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
    fn cooldown_hours_from_config_uses_override() {
        // Memastikan cooldown memakai nilai override config
        let cfg = sample_config();
        assert_eq!(cooldown_hours_from_config(&cfg), 12);
    }

    #[test]
    fn amount_for_token_uses_override() {
        // Memastikan amount token menggunakan override config
        let cfg = sample_config();
        let amount = amount_for_token("BTC", &cfg).expect("token valid");
        assert!((amount - 0.02).abs() < f64::EPSILON);
    }
}
