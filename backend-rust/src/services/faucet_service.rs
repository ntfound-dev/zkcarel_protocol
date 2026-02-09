use crate::{
    config::Config,
    constants::{
        token_address_for,
        FAUCET_AMOUNT_BTC,
        FAUCET_AMOUNT_CAREL,
        FAUCET_AMOUNT_ETH,
        FAUCET_AMOUNT_STRK,
        FAUCET_COOLDOWN_HOURS,
    },
    db::Database,
    error::{AppError, Result},
    models::FaucetClaim,
};
use ethers::{
    prelude::*,
    providers::{Http, Provider},
};
use std::sync::Arc;
use sqlx::Row;
use chrono::{DateTime, Utc, Duration};
use rust_decimal::prelude::ToPrimitive;

fn cooldown_hours_from_config(config: &Config) -> i64 {
    config
        .faucet_cooldown_hours
        .unwrap_or(FAUCET_COOLDOWN_HOURS as u64) as i64
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
    provider: Arc<Provider<Http>>, // Sekarang kita pakai!
    wallet: Option<LocalWallet>,
}

impl FaucetService {
    pub fn new(db: Database, config: Config) -> Result<Self> {
        let provider = Provider::<Http>::try_from(&config.ethereum_rpc_url)
            .map_err(|e| AppError::Internal(format!("Failed to connect to RPC: {}", e)))?;

        let wallet = if let Some(key) = &config.faucet_wallet_private_key {
            Some(
                key.parse::<LocalWallet>()
                    .map_err(|e| AppError::Internal(format!("Invalid private key: {}", e)))?,
            )
        } else {
            None
        };

        Ok(Self {
            db,
            config,
            provider: Arc::new(provider),
            wallet,
        })
    }

    /// Mengecek saldo wallet faucet menggunakan provider RPC
    pub async fn get_faucet_balance(&self) -> Result<U256> {
        if let Some(wallet) = &self.wallet {
            let balance = self.provider
                .get_balance(wallet.address(), None)
                .await
                .map_err(|e| AppError::BlockchainRPC(e.to_string()))?;
            Ok(balance)
        } else {
            Err(AppError::Internal("Wallet not configured".into()))
        }
    }

    pub async fn can_claim(&self, user_address: &str, token: &str) -> Result<bool> {
        if !self.config.is_testnet() {
            return Err(AppError::BadRequest("Faucet only on testnet".to_string()));
        }
        if token_address_for(token).is_none() {
            return Err(AppError::InvalidToken);
        }
        let cooldown_hours = cooldown_hours_from_config(&self.config);
        self.db
            .can_claim_faucet(user_address, token, cooldown_hours)
            .await
    }

    pub async fn get_next_claim_time(&self, user_address: &str, token: &str) -> Result<Option<DateTime<Utc>>> {
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

    pub async fn get_last_claim(&self, user_address: &str, token: &str) -> Result<Option<FaucetClaim>> {
        let row = sqlx::query(
            "SELECT user_address, token, amount, tx_hash, claimed_at
             FROM faucet_claims
             WHERE user_address = $1 AND token = $2
             ORDER BY claimed_at DESC LIMIT 1"
        )
        .bind(user_address)
        .bind(token)
        .fetch_optional(self.db.pool())
        .await?;

        Ok(row.map(|r| FaucetClaim {
            user_address: r.get("user_address"),
            token: r.get("token"),
            amount: r.get::<rust_decimal::Decimal, _>("amount").to_f64().unwrap_or(0.0),
            tx_hash: r.get("tx_hash"),
            claimed_at: r.get("claimed_at"),
        }))
    }

    pub async fn claim_tokens(&self, user_address: &str, token: &str) -> Result<String> {
        if !self.config.is_testnet() {
            return Err(AppError::BadRequest("Faucet only on testnet".into()));
        }

        let _token_address = token_address_for(token).ok_or(AppError::InvalidToken)?;

        // Pakai provider buat cek saldo sebelum kirim
        let balance = self.get_faucet_balance().await?;
        if balance == U256::zero() {
            return Err(AppError::InsufficientBalance);
        }

        if !self.can_claim(user_address, token).await? {
            return Err(AppError::FaucetCooldown);
        }

        let amount = amount_for_token(token, &self.config)?;

        let tx_hash = self.send_tokens(user_address, token, amount).await?;
        self.db.record_faucet_claim(user_address, token, amount, &tx_hash).await?;

        let _ = self
            .db
            .create_notification(
                user_address,
                "faucet.claim",
                "Faucet claimed",
                &format!("Claimed {} {}", amount, token),
            )
            .await;

        Ok(tx_hash)
    }

    async fn send_tokens(&self, _to: &str, _token: &str, _amount: f64) -> Result<String> {
        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        Ok(format!("0x{}", hex::encode(&rand::random::<[u8; 32]>())))
    }

    pub async fn get_stats(&self) -> Result<FaucetStats> {
        let row = sqlx::query(
            "SELECT 
                COUNT(DISTINCT user_address) as total_users,
                COUNT(*) as total_claims,
                COALESCE(SUM(CASE WHEN token = 'BTC' THEN amount ELSE 0 END), 0) as total_btc,
                COALESCE(SUM(CASE WHEN token = 'STRK' THEN amount ELSE 0 END), 0) as total_strk,
                COALESCE(SUM(CASE WHEN token = 'CAREL' THEN amount ELSE 0 END), 0) as total_carel
             FROM faucet_claims"
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
            starknet_rpc_url: "http://localhost:5050".to_string(),
            starknet_chain_id: "SN_MAIN".to_string(),
            ethereum_rpc_url: "http://localhost:8545".to_string(),
            carel_token_address: "0x1".to_string(),
            snapshot_distributor_address: "0x2".to_string(),
            point_storage_address: "0x3".to_string(),
            price_oracle_address: "0x4".to_string(),
            limit_order_book_address: "0x5".to_string(),
            referral_system_address: None,
            ai_executor_address: "0x6".to_string(),
            bridge_aggregator_address: "0x7".to_string(),
            zk_privacy_router_address: "0x8".to_string(),
            private_btc_swap_address: "0x9".to_string(),
            dark_pool_address: "0x10".to_string(),
            private_payments_address: "0x11".to_string(),
            anonymous_credentials_address: "0x12".to_string(),
            faucet_wallet_private_key: None,
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
            twitter_bearer_token: None,
            telegram_bot_token: None,
            discord_bot_token: None,
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
            stripe_secret_key: None,
            moonpay_api_key: None,
            rate_limit_public: 1,
            rate_limit_authenticated: 1,
            cors_allowed_origins: "*".to_string(),
            oracle_asset_ids: "".to_string(),
            bridge_provider_ids: "".to_string(),
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
