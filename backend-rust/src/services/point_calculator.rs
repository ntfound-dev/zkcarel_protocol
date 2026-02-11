use crate::{
    config::Config,
    constants::{
        EPOCH_DURATION_SECONDS,
        MULTIPLIER_TIER_1,
        MULTIPLIER_TIER_2,
        MULTIPLIER_TIER_3,
        MULTIPLIER_TIER_4,
        POINTS_PER_USD_BRIDGE,
        POINTS_PER_USD_STAKE_DAILY,
        POINTS_PER_USD_SWAP,
        POINT_CALCULATOR_INTERVAL_SECS,
    },
    db::Database,
    error::Result,
};
use std::sync::Arc;
use tokio::time::{interval, Duration};
use sqlx::Row;
use rust_decimal::prelude::{FromPrimitive, ToPrimitive};
use rust_decimal::Decimal;
use starknet_core::types::{Call, Felt};
use starknet_core::utils::get_selector_from_name;
use crate::services::onchain::{OnchainInvoker, parse_felt};

/// Point Calculator - Calculates trading points with anti-wash trading detection
pub struct PointCalculator {
    db: Database,
    config: Config,
    onchain: Option<OnchainInvoker>,
}

const REFERRAL_MIN_POINTS: i64 = 100;
const REFERRAL_BONUS_BPS: i64 = 1000; // 10%

impl PointCalculator {
    pub fn new(db: Database, config: Config) -> Self {
        let onchain = OnchainInvoker::from_config(&config).ok().flatten();
        Self { db, config, onchain }
    }

    /// Start point calculation loop
    pub async fn start(self: Arc<Self>) {
        tokio::spawn(async move {
            let mut ticker = interval(Duration::from_secs(POINT_CALCULATOR_INTERVAL_SECS)); // Every minute

            loop {
                ticker.tick().await;

                if let Err(e) = self.calculate_pending_points().await {
                    tracing::error!("Point calculator error: {}", e);
                }
            }
        });
    }

    /// Calculate points for all pending transactions
    async fn calculate_pending_points(&self) -> Result<()> {
        if self.config.is_testnet() {
            tracing::debug!("Point calculator running in testnet mode");
        }
        // Ganti ke runtime query_as
        let transactions = sqlx::query_as::<_, crate::models::Transaction>(
            "SELECT * FROM transactions WHERE processed = false ORDER BY timestamp ASC LIMIT 100"
        )
        .fetch_all(self.db.pool())
        .await?;

        for tx in transactions {
            self.process_transaction(&tx).await?;
        }

        Ok(())
    }

    /// Process a single transaction and calculate points
    async fn process_transaction(&self, tx: &crate::models::Transaction) -> Result<()> {
        // Check for wash trading
        if self.is_wash_trading(&tx.user_address, &tx.tx_hash).await? {
            tracing::warn!("Wash trading detected for user: {}", tx.user_address);
            
            sqlx::query("UPDATE transactions SET processed = true WHERE tx_hash = $1")
                .bind(&tx.tx_hash)
                .execute(self.db.pool())
                .await?;

            self.flag_wash_trading(&tx.user_address).await?;
            return Ok(());
        }

        let current_epoch = (chrono::Utc::now().timestamp() / EPOCH_DURATION_SECONDS) as i64;
        let prev_total: Decimal = sqlx::query_scalar(
            "SELECT COALESCE(total_points, 0) FROM points WHERE user_address = $1 AND epoch = $2"
        )
        .bind(&tx.user_address)
        .bind(current_epoch)
        .fetch_optional(self.db.pool())
        .await?
        .unwrap_or(Decimal::ZERO);

        let points = match tx.tx_type.as_str() {
            "swap" => self.calculate_swap_points(tx).await?,
            "limit_order" => self.calculate_swap_points(tx).await?,
            "bridge" => self.calculate_bridge_points(tx).await?,
            "stake" => self.calculate_stake_points(tx).await?,
            _ => 0.0,
        };

        let points_decimal = rust_decimal::Decimal::from_f64_retain(points).unwrap_or_default();
        
        match tx.tx_type.as_str() {
            "swap" => {
                self.db.create_or_update_points(
                    &tx.user_address,
                    current_epoch,
                    points_decimal,
                    rust_decimal::Decimal::ZERO,
                    rust_decimal::Decimal::ZERO,
                ).await?;
            }
            "bridge" => {
                self.db.create_or_update_points(
                    &tx.user_address,
                    current_epoch,
                    rust_decimal::Decimal::ZERO,
                    points_decimal,
                    rust_decimal::Decimal::ZERO,
                ).await?;
            }
            "stake" => {
                self.db.create_or_update_points(
                    &tx.user_address,
                    current_epoch,
                    rust_decimal::Decimal::ZERO,
                    rust_decimal::Decimal::ZERO,
                    points_decimal,
                ).await?;
            }
            _ => {}
        }

        // Apply multipliers after point updates
        self.apply_multipliers(&tx.user_address, current_epoch).await?;

        let new_total: Decimal = sqlx::query_scalar(
            "SELECT COALESCE(total_points, 0) FROM points WHERE user_address = $1 AND epoch = $2"
        )
        .bind(&tx.user_address)
        .bind(current_epoch)
        .fetch_one(self.db.pool())
        .await?;

        self.apply_referral_bonus(&tx.user_address, current_epoch, prev_total, new_total)
            .await?;

        sqlx::query("UPDATE transactions SET points_earned = $1, processed = true WHERE tx_hash = $2")
            .bind(points_decimal)
            .bind(&tx.tx_hash)
            .execute(self.db.pool())
            .await?;

        tracing::info!(
            "Points calculated: user={}, type={}, points={}",
            tx.user_address,
            tx.tx_type,
            points
        );

        Ok(())
    }

    async fn calculate_swap_points(&self, tx: &crate::models::Transaction) -> Result<f64> {
        Ok(tx.usd_value.and_then(|v| v.to_f64()).unwrap_or(0.0) * POINTS_PER_USD_SWAP)
    }

    async fn calculate_bridge_points(&self, tx: &crate::models::Transaction) -> Result<f64> {
        Ok(tx.usd_value.and_then(|v| v.to_f64()).unwrap_or(0.0) * POINTS_PER_USD_BRIDGE)
    }

    async fn calculate_stake_points(&self, tx: &crate::models::Transaction) -> Result<f64> {
        Ok(tx.usd_value.and_then(|v| v.to_f64()).unwrap_or(0.0) * POINTS_PER_USD_STAKE_DAILY)
    }

    async fn is_wash_trading(&self, user_address: &str, current_tx: &str) -> Result<bool> {
        let row = sqlx::query(
            "SELECT COUNT(*) as count FROM transactions
             WHERE user_address = $1 
             AND timestamp > NOW() - INTERVAL '5 minutes'
             AND tx_hash != $2
             AND tx_type = 'swap'"
        )
        .bind(user_address)
        .bind(current_tx)
        .fetch_one(self.db.pool())
        .await?;

        Ok(row.get::<i64, _>("count") > 5)
    }

    async fn flag_wash_trading(&self, user_address: &str) -> Result<()> {
        let current_epoch = (chrono::Utc::now().timestamp() / EPOCH_DURATION_SECONDS) as i64;

        sqlx::query(
            "UPDATE points SET wash_trading_flagged = true
             WHERE user_address = $1 AND epoch = $2"
        )
        .bind(user_address)
        .bind(current_epoch)
        .execute(self.db.pool())
        .await?;

        Ok(())
    }

    pub async fn apply_multipliers(&self, user_address: &str, epoch: i64) -> Result<()> {
        let stake_points: Option<rust_decimal::Decimal> = sqlx::query_scalar(
            "SELECT COALESCE(stake_points, 0) FROM points WHERE user_address = $1 AND epoch = $2"
        )
        .bind(user_address)
        .bind(epoch)
        .fetch_optional(self.db.pool())
        .await?;

        let stake_points_f64 = stake_points
            .unwrap_or(rust_decimal::Decimal::ZERO)
            .to_f64()
            .unwrap_or(0.0);

        let multiplier = staking_multiplier_for(stake_points_f64);
        let nft_boost = false;

        sqlx::query(
            "UPDATE points 
             SET staking_multiplier = $1,
                 nft_boost = $2,
                 total_points = (swap_points + bridge_points + stake_points + referral_points + social_points) * $1
             WHERE user_address = $3 AND epoch = $4"
        )
        .bind(rust_decimal::Decimal::from_f64_retain(multiplier).unwrap())
        .bind(nft_boost)
        .bind(user_address)
        .bind(epoch)
        .execute(self.db.pool())
        .await?;

        Ok(())
    }

    async fn apply_referral_bonus(
        &self,
        referee_address: &str,
        epoch: i64,
        prev_total: Decimal,
        new_total: Decimal,
    ) -> Result<()> {
        if new_total <= prev_total {
            return Ok(());
        }

        let referrer_raw: Option<String> = sqlx::query_scalar(
            "SELECT COALESCE(referrer, '') FROM users WHERE address = $1"
        )
        .bind(referee_address)
        .fetch_optional(self.db.pool())
        .await?;

        let referrer = match referrer_raw {
            Some(value) => value.trim().to_string(),
            None => return Ok(()),
        };
        if referrer.is_empty() {
            return Ok(());
        }

        let min_points = Decimal::from_i64(REFERRAL_MIN_POINTS).unwrap_or(Decimal::ZERO);
        if new_total < min_points {
            return Ok(());
        }

        let delta = new_total - prev_total;
        let bonus = delta * Decimal::from_i64(REFERRAL_BONUS_BPS).unwrap_or(Decimal::ZERO) / Decimal::new(10000, 0);
        if bonus <= Decimal::ZERO {
            return Ok(());
        }

        self.db.add_referral_points(&referrer, epoch, bonus).await?;
        self.apply_multipliers(&referrer, epoch).await?;

        if let Err(err) = self.sync_referral_onchain(epoch, referee_address, new_total).await {
            tracing::warn!(
                "Failed to sync referral onchain: referee={}, epoch={}, error={}",
                referee_address,
                epoch,
                err
            );
        }

        Ok(())
    }

    async fn sync_referral_onchain(
        &self,
        epoch: i64,
        referee_address: &str,
        total_points: Decimal,
    ) -> Result<()> {
        let referral_contract = match &self.config.referral_system_address {
            Some(addr) if !addr.trim().is_empty() => addr,
            _ => return Ok(()),
        };
        let Some(invoker) = &self.onchain else {
            return Ok(());
        };

        let points_u128 = total_points.trunc().to_u128().unwrap_or(0);
        if points_u128 == 0 {
            return Ok(());
        }

        let call = build_referral_call(
            referral_contract,
            epoch as u64,
            referee_address,
            points_u128,
        )?;

        let tx_hash = invoker.invoke(call).await?;
        tracing::info!(
            "Referral points synced onchain: referee={}, epoch={}, tx={}",
            referee_address,
            epoch,
            tx_hash
        );

        Ok(())
    }
}

 

fn build_referral_call(
    contract: &str,
    epoch: u64,
    referee: &str,
    total_points: u128,
) -> Result<Call> {
    let to = parse_felt(contract)?;
    let selector = get_selector_from_name("record_referee_points")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    let referee_felt = parse_felt(referee)?;

    let calldata = vec![
        Felt::from(epoch as u128),
        referee_felt,
        Felt::from(total_points),
        Felt::from(0_u128),
    ];

    Ok(Call { to, selector, calldata })
}

fn staking_multiplier_for(stake_amount: f64) -> f64 {
    if stake_amount < 10_000.0 {
        MULTIPLIER_TIER_1
    } else if stake_amount < 50_000.0 {
        MULTIPLIER_TIER_2
    } else if stake_amount < 100_000.0 {
        MULTIPLIER_TIER_3
    } else {
        MULTIPLIER_TIER_4
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn staking_multiplier_for_tier_boundaries() {
        // Memastikan multiplier berubah sesuai batas tier
        assert_eq!(staking_multiplier_for(0.0), MULTIPLIER_TIER_1);
        assert_eq!(staking_multiplier_for(10_000.0), MULTIPLIER_TIER_2);
        assert_eq!(staking_multiplier_for(50_000.0), MULTIPLIER_TIER_3);
        assert_eq!(staking_multiplier_for(100_000.0), MULTIPLIER_TIER_4);
    }
}
