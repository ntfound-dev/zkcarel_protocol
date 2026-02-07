use crate::{config::Config, db::Database, error::{AppError, Result}};
use ethers::{
    prelude::*,
    providers::{Http, Provider},
};
use std::sync::Arc;
use sqlx::Row;
use chrono::{DateTime, Utc, Duration};

pub struct FaucetService {
    db: Database,
    config: Config,
    provider: Arc<Provider<Http>>, // Sekarang kita pakai!
    wallet: Option<LocalWallet>,
}

impl FaucetService {
    pub fn new(db: Database, config: Config) -> Result<Self> {
        let provider = Provider::<Http>::try_from(&config.starknet_rpc_url)
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
        let last_claim = self.get_next_claim_time(user_address, token).await?;
        match last_claim {
            Some(next_time) => Ok(Utc::now() >= next_time),
            None => Ok(true),
        }
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
                let cooldown_hours = self.config.faucet_cooldown_hours.unwrap_or(24) as i64;
                Ok(Some(claimed_at + Duration::hours(cooldown_hours)))
            }
            None => Ok(None),
        }
    }

    pub async fn claim_tokens(&self, user_address: &str, token: &str) -> Result<String> {
        if !self.config.is_testnet() {
            return Err(AppError::BadRequest("Faucet only on testnet".into()));
        }

        // Pakai provider buat cek saldo sebelum kirim
        let balance = self.get_faucet_balance().await?;
        if balance == U256::zero() {
            return Err(AppError::Internal("Faucet wallet is empty!".into()));
        }

        if !self.can_claim(user_address, token).await? {
            return Err(AppError::FaucetCooldown);
        }

        let amount = match token {
            "BTC" => self.config.faucet_btc_amount.unwrap_or(0.001),
            "STRK" => self.config.faucet_strk_amount.unwrap_or(10.0),
            "CAREL" => self.config.faucet_carel_amount.unwrap_or(100.0),
            _ => return Err(AppError::BadRequest("Invalid token".into())),
        };

        let tx_hash = self.send_tokens(user_address, token, amount).await?;
        self.db.record_faucet_claim(user_address, token, amount, &tx_hash).await?;

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
