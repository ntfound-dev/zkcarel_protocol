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
    if is_testnet {
        0.5
    } else {
        1.0
    }
}

fn fallback_price_for(token: &str) -> f64 {
    match token.to_uppercase().as_str() {
        "USDT" | "USDC" | "CAREL" => 1.0,
        _ => 0.0,
    }
}

async fn latest_price_for_token(db: &Database, token: &str) -> Result<Option<f64>> {
    let token_upper = token.to_ascii_uppercase();
    let mut price: Option<f64> = sqlx::query_scalar(
        "SELECT close::FLOAT FROM price_history WHERE token = $1 ORDER BY timestamp DESC LIMIT 1",
    )
    .bind(&token_upper)
    .fetch_optional(db.pool())
    .await?;
    if price.is_none() && token_upper == "WBTC" {
        price = sqlx::query_scalar(
            "SELECT close::FLOAT FROM price_history WHERE token = $1 ORDER BY timestamp DESC LIMIT 1",
        )
        .bind("BTC")
        .fetch_optional(db.pool())
        .await?;
    }
    Ok(price)
}

fn normalize_scope_addresses(user_addresses: &[String]) -> Vec<String> {
    let mut normalized = Vec::new();
    for address in user_addresses {
        let trimmed = address.trim();
        if trimmed.is_empty() {
            continue;
        }
        let lower = trimmed.to_ascii_lowercase();
        if normalized.iter().any(|existing| existing == &lower) {
            continue;
        }
        normalized.push(lower);
    }
    normalized
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
    pub async fn calculate_pnl(&self, user_addresses: &[String], period: &str) -> Result<PnLData> {
        let normalized_addresses = normalize_scope_addresses(user_addresses);
        if normalized_addresses.is_empty() {
            return Ok(PnLData {
                period: period.to_string(),
                pnl: 0.0,
                pnl_percentage: 0.0,
                initial_value: 0.0,
                current_value: 0.0,
            });
        }
        let multiplier = pnl_multiplier(self.config.is_testnet());
        let now = Utc::now();
        let from_ts = period_to_duration(period).map(|d| now - d);

        let row = sqlx::query(
            r#"
            SELECT
                COALESCE(SUM(usd_value) FILTER (WHERE timestamp < $2), 0) AS initial_value,
                COALESCE(SUM(usd_value), 0) AS current_value
            FROM transactions
            WHERE LOWER(user_address) = ANY($1)
              AND usd_value IS NOT NULL
            "#,
        )
        .bind(normalized_addresses)
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
    pub async fn get_allocation(&self, user_addresses: &[String]) -> Result<Vec<AssetAllocation>> {
        let normalized_addresses = normalize_scope_addresses(user_addresses);
        if normalized_addresses.is_empty() {
            return Ok(Vec::new());
        }
        let rows = sqlx::query(
            r#"
            SELECT token, SUM(amount) as amount
            FROM (
                SELECT UPPER(token_out) as token, COALESCE(CAST(amount_out AS FLOAT), 0) as amount
                FROM transactions
                WHERE LOWER(user_address) = ANY($1) AND token_out IS NOT NULL
                UNION ALL
                SELECT UPPER(token_in) as token, -COALESCE(CAST(amount_in AS FLOAT), 0) as amount
                FROM transactions
                WHERE LOWER(user_address) = ANY($1) AND token_in IS NOT NULL
            ) t
            GROUP BY token
            "#,
        )
        .bind(normalized_addresses)
        .fetch_all(self.db.pool())
        .await?;

        let mut allocations = Vec::new();
        let mut total_value = 0.0;
        let mut values = Vec::new();

        for row in rows {
            let token: String = row.try_get("token")?;
            let amount: f64 = row.try_get::<f64, _>("amount").unwrap_or(0.0);
            if amount <= 0.0 {
                continue;
            }

            let price = latest_price_for_token(&self.db, &token).await?;

            let latest_price = price
                .filter(|value| value.is_finite() && *value > 0.0)
                .unwrap_or_else(|| fallback_price_for(&token));
            let value_usd = amount * latest_price;
            total_value += value_usd;
            values.push((token, amount, value_usd));
        }

        for (token, amount, value_usd) in values {
            let percentage = if total_value > 0.0 {
                (value_usd / total_value) * 100.0
            } else {
                0.0
            };
            allocations.push(AssetAllocation {
                asset: token,
                value_usd,
                percentage,
                amount,
            });
        }

        Ok(allocations)
    }

    /// Get trading performance
    pub async fn get_trading_performance(
        &self,
        user_addresses: &[String],
    ) -> Result<TradingPerformance> {
        let normalized_addresses = normalize_scope_addresses(user_addresses);
        if normalized_addresses.is_empty() {
            return Ok(TradingPerformance {
                total_trades: 0,
                total_volume_usd: 0.0,
                avg_trade_size: 0.0,
                win_rate: 0.0,
                best_trade: 0.0,
                worst_trade: 0.0,
            });
        }
        // Use runtime query + Row extraction to avoid compile-time sqlx macros
        let row = sqlx::query(
            r#"
            SELECT 
                COUNT(*) AS total_trades,
                COALESCE(SUM(usd_value), 0)::FLOAT AS total_volume,
                COALESCE(AVG(usd_value), 0)::FLOAT AS avg_trade_size,
                COALESCE(MAX(usd_value), 0)::FLOAT AS best_trade,
                COALESCE(MIN(usd_value), 0)::FLOAT AS worst_trade,
                COALESCE(AVG(CASE WHEN usd_value >= 0 THEN 1 ELSE 0 END), 0)::FLOAT * 100 AS win_rate
            FROM transactions
            WHERE LOWER(user_address) = ANY($1)
              AND usd_value IS NOT NULL
            "#,
        )
        .bind(normalized_addresses)
        .fetch_one(self.db.pool())
        .await?;

        let total_trades: i64 = row.try_get::<i64, &str>("total_trades").unwrap_or(0);
        let total_volume_usd: f64 = row.try_get::<f64, &str>("total_volume").unwrap_or(0.0);
        let avg_trade_size: f64 = row.try_get::<f64, &str>("avg_trade_size").unwrap_or(0.0);
        let best_trade: f64 = row.try_get::<f64, &str>("best_trade").unwrap_or(0.0);
        let worst_trade: f64 = row.try_get::<f64, &str>("worst_trade").unwrap_or(0.0);
        let win_rate: f64 = row.try_get::<f64, &str>("win_rate").unwrap_or(0.0);

        Ok(TradingPerformance {
            total_trades,
            total_volume_usd,
            avg_trade_size,
            win_rate,
            best_trade,
            worst_trade,
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
