use axum::{extract::State, Json};
use serde::Serialize;

use super::AppState;
use crate::{
    constants::{EPOCH_DURATION_SECONDS, POINTS_TO_CAREL_RATIO},
    error::Result,
    models::{ApiResponse, UserPoints},
    services::AnalyticsService,
};

use rust_decimal::Decimal;

fn decimal_or_zero(value: f64) -> Decimal {
    Decimal::from_f64_retain(value).unwrap_or(Decimal::ZERO)
}

fn estimated_carel_from_points(total_points: Decimal) -> Decimal {
    total_points * decimal_or_zero(POINTS_TO_CAREL_RATIO)
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
) -> Result<Json<ApiResponse<AnalyticsResponse>>> {
    // TODO: Extract real user from JWT
    let user_address = "0x1234...";

    let analytics = AnalyticsService::new(state.db.clone(), state.config.clone());
    let pnl_24h = analytics.calculate_pnl(user_address, "24h").await?;
    let pnl_7d = analytics.calculate_pnl(user_address, "7d").await?;
    let pnl_30d = analytics.calculate_pnl(user_address, "30d").await?;
    let pnl_all = analytics.calculate_pnl(user_address, "all_time").await?;
    let allocation = analytics.get_allocation(user_address).await?;
    let trading = analytics.get_trading_performance(user_address).await?;

    // Current epoch (30 days window)
    let current_epoch = (chrono::Utc::now().timestamp() / EPOCH_DURATION_SECONDS) as i64;

    // Explicit DB helper return type assumed: Result<Option<UserPoints>>
    let points: Option<UserPoints> = state
        .db
        .get_user_points(user_address, current_epoch)
        .await?;
    let total_points: Decimal = points
        .as_ref()
        .map(|p| p.total_points)
        .unwrap_or(Decimal::ZERO);

    let allocation = allocation
        .into_iter()
        .map(|item| AllocationItem {
            asset: item.asset,
            percentage: item.percentage,
            value_usd: decimal_or_zero(item.value_usd),
        })
        .collect::<Vec<_>>();

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
            estimated_carel: estimated_carel_from_points(total_points),
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
    fn estimated_carel_uses_ratio_constant() {
        // Memastikan konversi poin ke CAREL mengikuti konstanta
        let points = Decimal::from_f64_retain(100.0).unwrap();
        let expected = points * decimal_or_zero(POINTS_TO_CAREL_RATIO);
        assert_eq!(estimated_carel_from_points(points), expected);
    }
}
