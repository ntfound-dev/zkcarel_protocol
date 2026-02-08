use axum::{extract::{Path, Query, State}, Json};
use serde::{Deserialize, Serialize};

use crate::{
    error::Result,
    models::ApiResponse,
};

use super::AppState;

#[derive(Debug, Serialize)]
pub struct OrderBookLevel {
    pub price: f64,
    pub amount: f64,
}

#[derive(Debug, Serialize)]
pub struct MarketDepthResponse {
    pub token: String,
    pub bids: Vec<OrderBookLevel>,
    pub asks: Vec<OrderBookLevel>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct MarketDepthQuery {
    pub limit: Option<i32>,
}

fn clamp_limit(limit: Option<i32>) -> i32 {
    limit.unwrap_or(10).clamp(1, 50)
}

fn build_levels(mid_price: f64, levels: i32) -> (Vec<OrderBookLevel>, Vec<OrderBookLevel>) {
    let mut bids = Vec::new();
    let mut asks = Vec::new();
    let base = if mid_price <= 0.0 { 1.0 } else { mid_price };

    for i in 1..=levels {
        let step = 0.002 * i as f64;
        let bid_price = base * (1.0 - step);
        let ask_price = base * (1.0 + step);
        let amount = (base / (1000.0 * i as f64)).max(0.001);

        bids.push(OrderBookLevel {
            price: bid_price,
            amount,
        });
        asks.push(OrderBookLevel {
            price: ask_price,
            amount,
        });
    }

    (bids, asks)
}

async fn latest_price(state: &AppState, token: &str) -> Result<f64> {
    let price: Option<f64> = sqlx::query_scalar(
        "SELECT close::FLOAT FROM price_history WHERE token = $1 ORDER BY timestamp DESC LIMIT 1",
    )
    .bind(token)
    .fetch_optional(state.db.pool())
    .await?;

    Ok(price.unwrap_or(1.0))
}

/// GET /api/v1/market/depth/:token
pub async fn get_market_depth(
    State(state): State<AppState>,
    Path(token): Path<String>,
    Query(query): Query<MarketDepthQuery>,
) -> Result<Json<ApiResponse<MarketDepthResponse>>> {
    let limit = clamp_limit(query.limit);
    let mid_price = latest_price(&state, token.as_str()).await?;

    let (bids, asks) = build_levels(mid_price, limit);

    Ok(Json(ApiResponse::success(MarketDepthResponse {
        token,
        bids,
        asks,
        updated_at: chrono::Utc::now(),
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_levels_returns_equal_counts() {
        // Memastikan bids dan asks memiliki jumlah level yang sama
        let (bids, asks) = build_levels(100.0, 5);
        assert_eq!(bids.len(), 5);
        assert_eq!(asks.len(), 5);
    }
}
