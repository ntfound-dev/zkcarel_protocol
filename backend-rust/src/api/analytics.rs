use axum::{extract::State, Json};
use serde::Serialize;

use super::AppState;
use crate::{
    error::Result,
    models::{ApiResponse, UserPoints},
};

use rust_decimal::Decimal;
use sqlx::Row;

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

    // Runtime-checked SQL (no compile DB required)
    let row = sqlx::query(
        r#"
        SELECT 
            COUNT(*) as total_trades,
            SUM(usd_value) as total_volume,
            AVG(usd_value) as avg_trade,
            MAX(usd_value) as best_trade,
            MIN(usd_value) as worst_trade
        FROM transactions
        WHERE user_address = $1
        "#,
    )
    .bind(user_address)
    .fetch_one(state.db.pool())
    .await?;

    // Extract using Decimal where appropriate
    let total_trades: i64 = row.try_get::<i64, _>("total_trades")?;

    let total_volume: Decimal = row
        .try_get::<Option<Decimal>, _>("total_volume")?
        .unwrap_or(Decimal::ZERO);

    let avg_trade: Decimal = row
        .try_get::<Option<Decimal>, _>("avg_trade")?
        .unwrap_or(Decimal::ZERO);

    let best_trade: Decimal = row
        .try_get::<Option<Decimal>, _>("best_trade")?
        .unwrap_or(Decimal::ZERO);

    let worst_trade: Decimal = row
        .try_get::<Option<Decimal>, _>("worst_trade")?
        .unwrap_or(Decimal::ZERO);

    // Current epoch (30 days window)
    let current_epoch = (chrono::Utc::now().timestamp() / 2_592_000) as i64;

    // Explicit DB helper return type assumed: Result<Option<UserPoints>>
    let points: Option<UserPoints> = state
        .db
        .get_user_points(user_address, current_epoch)
        .await?;
    let total_points: Decimal = points
        .as_ref()
        .map(|p| p.total_points)
        .unwrap_or(Decimal::ZERO);

    // Example allocation using Decimal for values
    let allocation = vec![
        AllocationItem {
            asset: "BTC".to_string(),
            percentage: 31.5,
            value_usd: Decimal::new(9750, 0),
        },
        AllocationItem {
            asset: "ETH".to_string(),
            percentage: 28.2,
            value_usd: Decimal::new(8750, 0),
        },
        AllocationItem {
            asset: "CAREL".to_string(),
            percentage: 24.2,
            value_usd: Decimal::new(7500, 0),
        },
        AllocationItem {
            asset: "USDT".to_string(),
            percentage: 16.1,
            value_usd: Decimal::new(5000, 0),
        },
    ];

    let response = AnalyticsResponse {
        portfolio: PortfolioAnalytics {
            total_value_usd: Decimal::new(31_000, 0),
            pnl_24h: Decimal::new(450, 2), // 4.50 example (adjust scale as needed)
            pnl_7d: Decimal::new(1230, 2),
            pnl_30d: Decimal::new(3000, 2),
            pnl_all_time: Decimal::new(5500, 2),
            allocation,
        },
        trading: TradingAnalytics {
            total_trades,
            total_volume_usd: total_volume,
            avg_trade_size: avg_trade,
            win_rate: 68.5,
            best_trade,
            worst_trade,
        },
        rewards: RewardsAnalytics {
            total_points,
            estimated_carel: total_points * Decimal::new(1, 1) / Decimal::new(10, 0), // *0.1
            rank: 1234,
            percentile: 85.5,
        },
    };

    Ok(Json(ApiResponse::success(response)))
}

// Utility: if you need to return f64 to frontend instead of Decimal,
// convert at serialization layer or construct a DTO that converts:
// e.g. value.to_f64().unwrap_or(0.0)
