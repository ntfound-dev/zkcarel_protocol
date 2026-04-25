use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use crate::{
    error::Result,
    models::ApiResponse,
    services::price_guard::{fallback_price_for, first_sane_price, symbol_candidates_for},
};

use super::AppState;

const MARKET_DEPTH_CACHE_TTL_SECS: u64 = 30;

#[derive(Clone)]
struct CachedMarketDepth {
    fetched_at: Instant,
    data: MarketDepthResponse,
}

static MARKET_DEPTH_CACHE: OnceLock<RwLock<HashMap<String, CachedMarketDepth>>> = OnceLock::new();

// Internal helper that supports `market_depth_cache` operations.
fn market_depth_cache() -> &'static RwLock<HashMap<String, CachedMarketDepth>> {
    MARKET_DEPTH_CACHE.get_or_init(|| RwLock::new(HashMap::new()))
}

// Internal helper that supports `get_cached_market_depth` operations.
async fn get_cached_market_depth(key: &str, ttl: Duration) -> Option<MarketDepthResponse> {
    let cache = market_depth_cache();
    let guard = cache.read().await;
    guard.get(key).and_then(|entry| {
        if entry.fetched_at.elapsed() <= ttl {
            Some(entry.data.clone())
        } else {
            None
        }
    })
}

// Internal helper that supports `store_cached_market_depth` operations.
async fn store_cached_market_depth(key: &str, data: MarketDepthResponse) {
    let cache = market_depth_cache();
    let mut guard = cache.write().await;
    guard.insert(
        key.to_string(),
        CachedMarketDepth {
            fetched_at: Instant::now(),
            data,
        },
    );
}

#[derive(Debug, Serialize, Clone)]
pub struct OrderBookLevel {
    pub price: f64,
    pub amount: f64,
}

#[derive(Debug, Serialize, Clone)]
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

// Internal helper that parses or transforms values for `clamp_limit`.
fn clamp_limit(limit: Option<i32>) -> i32 {
    limit.unwrap_or(10).clamp(1, 50)
}

// Internal helper that builds inputs for `build_levels`.
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

// Internal helper that supports `latest_price` operations.
async fn latest_price(state: &AppState, token: &str) -> Result<f64> {
    let symbol = token.to_ascii_uppercase();
    for candidate in symbol_candidates_for(&symbol) {
        let rows: Vec<f64> = sqlx::query_scalar(
            "SELECT close::FLOAT FROM price_history WHERE token = $1 ORDER BY timestamp DESC LIMIT 16",
        )
        .bind(&candidate)
        .fetch_all(state.db.pool())
        .await?;
        if let Some(price) = first_sane_price(&candidate, &rows) {
            return Ok(price);
        }
    }

    Ok(fallback_price_for(&symbol))
}

/// GET /api/v1/market/depth/:token
pub async fn get_market_depth(
    State(state): State<AppState>,
    Path(token): Path<String>,
    Query(query): Query<MarketDepthQuery>,
) -> Result<Json<ApiResponse<MarketDepthResponse>>> {
    let limit = clamp_limit(query.limit);
    let cache_key = format!("depth:{}:{}", token.to_ascii_uppercase(), limit);
    if let Some(cached) =
        get_cached_market_depth(&cache_key, Duration::from_secs(MARKET_DEPTH_CACHE_TTL_SECS)).await
    {
        return Ok(Json(ApiResponse::success(cached)));
    }
    let mid_price = latest_price(&state, token.as_str()).await?;

    let (bids, asks) = build_levels(mid_price, limit);
    let response = MarketDepthResponse {
        token,
        bids,
        asks,
        updated_at: chrono::Utc::now(),
    };
    store_cached_market_depth(&cache_key, response.clone()).await;
    Ok(Json(ApiResponse::success(response)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    // Internal helper that builds inputs for `build_levels_returns_equal_counts`.
    fn build_levels_returns_equal_counts() {
        // Memastikan bids dan asks memiliki jumlah level yang sama
        let (bids, asks) = build_levels(100.0, 5);
        assert_eq!(bids.len(), 5);
        assert_eq!(asks.len(), 5);
    }
}
