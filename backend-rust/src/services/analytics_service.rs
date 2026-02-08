use crate::{config::Config, db::Database, error::Result};
use chrono::{Duration, Utc};
use rust_decimal::prelude::ToPrimitive;
use sqlx::Row;

fn period_to_duration(period: &str) -> Option<Duration> {
    match period {
        "24h" | "1d" => Some(Duration::hours(24)),
        "7d" => Some(Duration::days(7)),
        "30d" => Some(Duration::days(30)),
        "all_time" | "all" => None,
        _ => None,
    }
}

fn pnl_multiplier(is_testnet: bool) -> f64 {
    if is_testnet { 0.5 } else { 1.0 }
}

/// Analytics Service - Portfolio analytics and insights
pub struct AnalyticsService {
    db: Database,
    config: Config,
}

impl AnalyticsService {
    pub fn new(db: Database, config: Config) -> Self {
        Self { db, config }
    }

    /// Calculate portfolio PnL
    pub async fn calculate_pnl(&self, user_address: &str, period: &str) -> Result<PnLData> {
        let multiplier = pnl_multiplier(self.config.is_testnet());
        let now = Utc::now();
        let from_ts = period_to_duration(period).map(|d| now - d);

        let row = sqlx::query(
            r#"
            SELECT
                COALESCE(SUM(usd_value) FILTER (WHERE timestamp < $2), 0) AS initial_value,
                COALESCE(SUM(usd_value), 0) AS current_value
            FROM transactions
            WHERE user_address = $1
              AND usd_value IS NOT NULL
            "#,
        )
        .bind(user_address)
        .bind(from_ts)
        .fetch_one(self.db.pool())
        .await?;

        let initial_value_dec: rust_decimal::Decimal = row.try_get("initial_value")?;
        let current_value_dec: rust_decimal::Decimal = row.try_get("current_value")?;

        let initial_value = initial_value_dec.to_f64().unwrap_or(0.0);
        let current_value = current_value_dec.to_f64().unwrap_or(0.0);
        let pnl = current_value - initial_value;
        let pnl_percentage = if initial_value != 0.0 {
            (pnl / initial_value) * 100.0
        } else {
            0.0
        };

        Ok(PnLData {
            period: period.to_string(),
            pnl: pnl * multiplier,
            pnl_percentage: pnl_percentage * multiplier,
            initial_value,
            current_value,
        })
    }

    /// Get portfolio allocation
    pub async fn get_allocation(&self, _user_address: &str) -> Result<Vec<AssetAllocation>> {
        // TODO: Get actual holdings
        Ok(vec![
            AssetAllocation {
                asset: "BTC".to_string(),
                value_usd: 9750.0,
                percentage: 31.5,
                amount: 0.15,
            },
            AssetAllocation {
                asset: "ETH".to_string(),
                value_usd: 8750.0,
                percentage: 28.2,
                amount: 2.5,
            },
            AssetAllocation {
                asset: "CAREL".to_string(),
                value_usd: 7500.0,
                percentage: 24.2,
                amount: 15000.0,
            },
            AssetAllocation {
                asset: "USDT".to_string(),
                value_usd: 5000.0,
                percentage: 16.1,
                amount: 5000.0,
            },
        ])
    }

    /// Get trading performance
    pub async fn get_trading_performance(&self, user_address: &str) -> Result<TradingPerformance> {
        // Use runtime query + Row extraction to avoid compile-time sqlx macros
        let row = sqlx::query(
            r#"
            SELECT 
                COUNT(*) AS total_trades,
                SUM(usd_value) AS total_volume,
                AVG(usd_value) AS avg_trade_size
            FROM transactions
            WHERE user_address = $1
            "#,
        )
        .bind(user_address)
        .fetch_one(self.db.pool())
        .await?;

        // Perbaikan: Gunakan unwrap_or(0) untuk menghindari ambiguitas tipe E pada Result
        let total_trades: i64 = row
            .try_get::<i64, &str>("total_trades")
            .unwrap_or(0);

        // SUM/AVG can be NULL — they map to Option<Decimal>
        let total_volume_dec: Option<rust_decimal::Decimal> =
            row.try_get::<Option<rust_decimal::Decimal>, &str>("total_volume")?;
        let avg_trade_dec: Option<rust_decimal::Decimal> =
            row.try_get::<Option<rust_decimal::Decimal>, &str>("avg_trade_size")?;

        let total_volume_usd = total_volume_dec.and_then(|d| d.to_f64()).unwrap_or(0.0);
        let avg_trade_size = avg_trade_dec.and_then(|d| d.to_f64()).unwrap_or(0.0);

        Ok(TradingPerformance {
            total_trades,
            total_volume_usd,
            avg_trade_size,
            // TODO: compute these from trade history instead of hardcoding
            win_rate: 68.5,
            best_trade: 2340.50,
            worst_trade: -450.20,
        })
    }
}

#[derive(Debug, serde::Serialize)]
pub struct PnLData {
    pub period: String,
    pub pnl: f64,
    pub pnl_percentage: f64,
    pub initial_value: f64,
    pub current_value: f64,
}

#[derive(Debug, serde::Serialize)]
pub struct AssetAllocation {
    pub asset: String,
    pub value_usd: f64,
    pub percentage: f64,
    pub amount: f64,
}

#[derive(Debug, serde::Serialize)]
pub struct TradingPerformance {
    pub total_trades: i64,
    pub total_volume_usd: f64,
    pub avg_trade_size: f64,
    pub win_rate: f64,
    pub best_trade: f64,
    pub worst_trade: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn period_to_duration_handles_7d() {
        // Memastikan periode 7d menghasilkan durasi 7 hari
        let duration = period_to_duration("7d").expect("harus ada durasi");
        assert_eq!(duration.num_days(), 7);
    }

    #[test]
    fn pnl_multiplier_testnet_is_half() {
        // Memastikan testnet memakai multiplier 0.5
        assert!((pnl_multiplier(true) - 0.5).abs() < f64::EPSILON);
    }
}
