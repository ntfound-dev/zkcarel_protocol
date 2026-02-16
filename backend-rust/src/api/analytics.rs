use axum::{extract::State, http::HeaderMap, Json};
use serde::Serialize;

use super::{resolve_user_scope_addresses, AppState};
use crate::{
    constants::EPOCH_DURATION_SECONDS,
    error::Result,
    models::ApiResponse,
    services::AnalyticsService,
    tokenomics::{claim_fee_multiplier, rewards_distribution_pool_for_environment},
};

use rust_decimal::Decimal;

fn decimal_or_zero(value: f64) -> Decimal {
    Decimal::from_f64_retain(value).unwrap_or(Decimal::ZERO)
}

fn estimated_carel_from_points(
    total_points: Decimal,
    total_epoch_points: Decimal,
    distribution_pool: Decimal,
) -> Decimal {
    if total_epoch_points == Decimal::ZERO {
        return Decimal::ZERO;
    }
    let gross = (total_points / total_epoch_points) * distribution_pool;
    gross * claim_fee_multiplier()
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

#[derive(Debug, Serialize)]
pub struct AnalyticsResponse {
    pub portfolio: PortfolioAnalytics,
    pub trading: TradingAnalytics,
    pub rewards: RewardsAnalytics,
}

#[derive(Debug, Serialize)]
pub struct PortfolioAnalytics {
    pub total_value_usd: Decimal,
    pub pnl_24h: Decimal,
    pub pnl_7d: Decimal,
    pub pnl_30d: Decimal,
    pub pnl_all_time: Decimal,
    pub allocation: Vec<AllocationItem>,
}

#[derive(Debug, Serialize)]
pub struct AllocationItem {
    pub asset: String,
    pub percentage: f64,
    pub value_usd: Decimal,
}

#[derive(Debug, Serialize)]
pub struct TradingAnalytics {
    pub total_trades: i64,
    pub total_volume_usd: Decimal,
    pub avg_trade_size: Decimal,
    pub win_rate: f64,
    pub best_trade: Decimal,
    pub worst_trade: Decimal,
}

#[derive(Debug, Serialize)]
pub struct RewardsAnalytics {
    pub total_points: Decimal,
    pub estimated_carel: Decimal,
    pub rank: i64,
    pub percentile: f64,
}

/// GET /api/v1/portfolio/analytics
pub async fn get_analytics(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<AnalyticsResponse>>> {
    let user_addresses = resolve_user_scope_addresses(&headers, &state).await?;
    let normalized_addresses = normalize_scope_addresses(&user_addresses);

    let analytics = AnalyticsService::new(state.db.clone(), state.config.clone());
    let pnl_24h = analytics.calculate_pnl(&user_addresses, "24h").await?;
    let pnl_7d = analytics.calculate_pnl(&user_addresses, "7d").await?;
    let pnl_30d = analytics.calculate_pnl(&user_addresses, "30d").await?;
    let pnl_all = analytics.calculate_pnl(&user_addresses, "all_time").await?;
    let allocation = analytics.get_allocation(&user_addresses).await?;
    let trading = analytics.get_trading_performance(&user_addresses).await?;

    // Current epoch (30 days window)
    let current_epoch = (chrono::Utc::now().timestamp() / EPOCH_DURATION_SECONDS) as i64;

    let total_points: Decimal = if normalized_addresses.is_empty() {
        Decimal::ZERO
    } else {
        sqlx::query_scalar(
            "SELECT COALESCE(SUM(total_points), 0) FROM points WHERE LOWER(user_address) = ANY($1) AND epoch = $2",
        )
        .bind(normalized_addresses)
        .bind(current_epoch)
        .fetch_one(state.db.pool())
        .await?
    };

    let allocation = allocation
        .into_iter()
        .map(|item| AllocationItem {
            asset: item.asset,
            percentage: item.percentage,
            value_usd: decimal_or_zero(item.value_usd),
        })
        .collect::<Vec<_>>();

    let total_epoch_points: Decimal =
        sqlx::query_scalar("SELECT COALESCE(SUM(total_points), 0) FROM points WHERE epoch = $1")
            .bind(current_epoch)
            .fetch_one(state.db.pool())
            .await?;
    let distribution_pool = rewards_distribution_pool_for_environment(&state.config.environment);

    let response = AnalyticsResponse {
        portfolio: PortfolioAnalytics {
            total_value_usd: decimal_or_zero(pnl_all.current_value),
            pnl_24h: decimal_or_zero(pnl_24h.pnl),
            pnl_7d: decimal_or_zero(pnl_7d.pnl),
            pnl_30d: decimal_or_zero(pnl_30d.pnl),
            pnl_all_time: decimal_or_zero(pnl_all.pnl),
            allocation,
        },
        trading: TradingAnalytics {
            total_trades: trading.total_trades,
            total_volume_usd: decimal_or_zero(trading.total_volume_usd),
            avg_trade_size: decimal_or_zero(trading.avg_trade_size),
            win_rate: trading.win_rate,
            best_trade: decimal_or_zero(trading.best_trade),
            worst_trade: decimal_or_zero(trading.worst_trade),
        },
        rewards: RewardsAnalytics {
            total_points,
            estimated_carel: estimated_carel_from_points(
                total_points,
                total_epoch_points,
                distribution_pool,
            ),
            rank: 1234,
            percentile: 85.5,
        },
    };

    Ok(Json(ApiResponse::success(response)))
}

// Utility: if you need to return f64 to frontend instead of Decimal,
// convert at serialization layer or construct a DTO that converts:
// e.g. value.to_f64().unwrap_or(0.0)

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decimal_or_zero_returns_zero_for_nan() {
        // Memastikan nilai NaN dipetakan menjadi 0
        let value = decimal_or_zero(f64::NAN);
        assert_eq!(value, Decimal::ZERO);
    }

    #[test]
    fn estimated_carel_uses_pool_math() {
        // Memastikan konversi poin memakai pool distribusi + claim fee multiplier
        let points = Decimal::from_f64_retain(100.0).unwrap();
        let total_points = Decimal::from_f64_retain(1000.0).unwrap();
        let pool = Decimal::from_f64_retain(30_000_000.0).unwrap();
        let expected = (points / total_points) * pool * claim_fee_multiplier();
        assert_eq!(
            estimated_carel_from_points(points, total_points, pool),
            expected
        );
    }
}
