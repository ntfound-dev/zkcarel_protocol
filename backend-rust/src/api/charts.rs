use axum::{
    extract::{Path, Query, State},
    Json,
};
use redis::AsyncCommands;
use rust_decimal::prelude::ToPrimitive;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use crate::{
    error::Result,
    models::{ApiResponse, OHLCVResponse},
    services::PriceChartService,
};

use super::AppState;

const CHARTS_CACHE_TTL_SECS: u64 = 60;
const CHARTS_CACHE_MAX_ENTRIES: usize = 10_000;
const CHARTS_OHLCV_REDIS_PREFIX: &str = "charts:ohlcv:v1";
const CHARTS_INDICATORS_REDIS_PREFIX: &str = "charts:indicators:v1";

#[derive(Clone)]
struct CachedOhlcv {
    fetched_at: Instant,
    data: Vec<crate::models::PriceTick>,
}

#[derive(Clone)]
struct CachedIndicators {
    fetched_at: Instant,
    data: Vec<IndicatorsResponse>,
}

static CHARTS_OHLCV_CACHE: OnceLock<RwLock<HashMap<String, CachedOhlcv>>> = OnceLock::new();
static CHARTS_INDICATORS_CACHE: OnceLock<RwLock<HashMap<String, CachedIndicators>>> =
    OnceLock::new();
static CHARTS_FETCH_LOCKS: OnceLock<RwLock<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> =
    OnceLock::new();

// Internal helper that supports `charts_ohlcv_cache` operations.
fn charts_ohlcv_cache() -> &'static RwLock<HashMap<String, CachedOhlcv>> {
    CHARTS_OHLCV_CACHE.get_or_init(|| RwLock::new(HashMap::new()))
}

// Internal helper that supports `charts_indicators_cache` operations.
fn charts_indicators_cache() -> &'static RwLock<HashMap<String, CachedIndicators>> {
    CHARTS_INDICATORS_CACHE.get_or_init(|| RwLock::new(HashMap::new()))
}

// Internal helper that supports `charts_fetch_locks` operations.
fn charts_fetch_locks() -> &'static RwLock<HashMap<String, Arc<tokio::sync::Mutex<()>>>> {
    CHARTS_FETCH_LOCKS.get_or_init(|| RwLock::new(HashMap::new()))
}

// Internal helper that supports `charts_fetch_lock_for` operations.
async fn charts_fetch_lock_for(key: &str) -> Arc<tokio::sync::Mutex<()>> {
    let locks = charts_fetch_locks();
    {
        let guard = locks.read().await;
        if let Some(lock) = guard.get(key) {
            return lock.clone();
        }
    }

    let mut guard = locks.write().await;
    if let Some(lock) = guard.get(key) {
        return lock.clone();
    }
    let lock = Arc::new(tokio::sync::Mutex::new(()));
    guard.insert(key.to_string(), lock.clone());

    if guard.len() > CHARTS_CACHE_MAX_ENTRIES {
        let cache = charts_ohlcv_cache();
        let cache_guard = cache.read().await;
        guard.retain(|cache_key, _| cache_guard.contains_key(cache_key));
    }
    lock
}

// Internal helper that supports `get_cached_ohlcv` operations.
async fn get_cached_ohlcv(
    state: &AppState,
    key: &str,
    ttl: Duration,
) -> Option<Vec<crate::models::PriceTick>> {
    let cache = charts_ohlcv_cache();
    let guard = cache.read().await;
    if let Some(entry) = guard.get(key) {
        if entry.fetched_at.elapsed() <= ttl {
            return Some(entry.data.clone());
        }
    }
    drop(guard);

    if let Some(redis_cached) = get_cached_ohlcv_redis(state, key).await {
        store_cached_ohlcv(state, key, redis_cached.clone()).await;
        return Some(redis_cached);
    }

    None
}

// Internal helper that supports `store_cached_ohlcv` operations.
async fn store_cached_ohlcv(state: &AppState, key: &str, data: Vec<crate::models::PriceTick>) {
    let cache = charts_ohlcv_cache();
    let mut guard = cache.write().await;
    guard.insert(
        key.to_string(),
        CachedOhlcv {
            fetched_at: Instant::now(),
            data: data.clone(),
        },
    );
    store_cached_ohlcv_redis(state, key, data).await;
}

// Internal helper that supports `get_cached_indicators` operations.
async fn get_cached_indicators(
    state: &AppState,
    key: &str,
    ttl: Duration,
) -> Option<Vec<IndicatorsResponse>> {
    let cache = charts_indicators_cache();
    let guard = cache.read().await;
    if let Some(entry) = guard.get(key) {
        if entry.fetched_at.elapsed() <= ttl {
            return Some(entry.data.clone());
        }
    }
    drop(guard);

    if let Some(redis_cached) = get_cached_indicators_redis(state, key).await {
        store_cached_indicators(state, key, redis_cached.clone()).await;
        return Some(redis_cached);
    }

    None
}

// Internal helper that supports `store_cached_indicators` operations.
async fn store_cached_indicators(state: &AppState, key: &str, data: Vec<IndicatorsResponse>) {
    let cache = charts_indicators_cache();
    let mut guard = cache.write().await;
    guard.insert(
        key.to_string(),
        CachedIndicators {
            fetched_at: Instant::now(),
            data: data.clone(),
        },
    );
    store_cached_indicators_redis(state, key, data).await;
}

// Internal helper that supports `charts_ohlcv_redis_key` operations.
fn charts_ohlcv_redis_key(cache_key: &str) -> String {
    format!("{}:{}", CHARTS_OHLCV_REDIS_PREFIX, cache_key)
}

// Internal helper that supports `charts_indicators_redis_key` operations.
fn charts_indicators_redis_key(cache_key: &str) -> String {
    format!("{}:{}", CHARTS_INDICATORS_REDIS_PREFIX, cache_key)
}

// Internal helper that fetches data for `get_cached_ohlcv_redis`.
async fn get_cached_ohlcv_redis(
    state: &AppState,
    cache_key: &str,
) -> Option<Vec<crate::models::PriceTick>> {
    let redis_key = charts_ohlcv_redis_key(cache_key);
    let mut conn = state.redis.clone();
    let raw: Option<String> = conn.get(redis_key).await.ok()?;
    raw.and_then(|value| serde_json::from_str(&value).ok())
}

// Internal helper that supports `store_cached_ohlcv_redis` operations.
async fn store_cached_ohlcv_redis(
    state: &AppState,
    cache_key: &str,
    data: Vec<crate::models::PriceTick>,
) {
    let Ok(payload) = serde_json::to_string(&data) else {
        return;
    };
    let redis_key = charts_ohlcv_redis_key(cache_key);
    let mut conn = state.redis.clone();
    let _: std::result::Result<(), redis::RedisError> =
        conn.set_ex(redis_key, payload, CHARTS_CACHE_TTL_SECS).await;
}

// Internal helper that fetches data for `get_cached_indicators_redis`.
async fn get_cached_indicators_redis(
    state: &AppState,
    cache_key: &str,
) -> Option<Vec<IndicatorsResponse>> {
    let redis_key = charts_indicators_redis_key(cache_key);
    let mut conn = state.redis.clone();
    let raw: Option<String> = conn.get(redis_key).await.ok()?;
    raw.and_then(|value| serde_json::from_str(&value).ok())
}

// Internal helper that supports `store_cached_indicators_redis` operations.
async fn store_cached_indicators_redis(
    state: &AppState,
    cache_key: &str,
    data: Vec<IndicatorsResponse>,
) {
    let Ok(payload) = serde_json::to_string(&data) else {
        return;
    };
    let redis_key = charts_indicators_redis_key(cache_key);
    let mut conn = state.redis.clone();
    let _: std::result::Result<(), redis::RedisError> =
        conn.set_ex(redis_key, payload, CHARTS_CACHE_TTL_SECS).await;
}
#[derive(Debug, Deserialize)]
pub struct OHLCVQuery {
    pub interval: String,
    pub from: Option<String>,
    pub to: Option<String>,
    pub limit: Option<i32>,
    pub source: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IndicatorsResponse {
    pub indicator: String,
    pub data: Vec<IndicatorPoint>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IndicatorPoint {
    pub timestamp: i64,
    pub value: f64,
}

// Internal helper that parses or transforms values for `parse_rfc3339_or`.
fn parse_rfc3339_or(
    value: Option<&str>,
    default: chrono::DateTime<chrono::Utc>,
) -> chrono::DateTime<chrono::Utc> {
    value
        .and_then(|d| chrono::DateTime::parse_from_rfc3339(d).ok())
        .map(|d| d.with_timezone(&chrono::Utc))
        .unwrap_or(default)
}

// Internal helper that supports `map_indicator_points` operations.
fn map_indicator_points(
    data: Vec<(chrono::DateTime<chrono::Utc>, rust_decimal::Decimal)>,
) -> Vec<IndicatorPoint> {
    data.into_iter()
        .map(|(ts, val)| IndicatorPoint {
            timestamp: ts.timestamp(),
            value: val.to_f64().unwrap_or(0.0),
        })
        .collect()
}

/// GET /api/v1/chart/:token/ohlcv
pub async fn get_ohlcv(
    State(state): State<AppState>,
    Path(token): Path<String>,
    Query(query): Query<OHLCVQuery>,
) -> Result<Json<ApiResponse<OHLCVResponse>>> {
    let service = PriceChartService::new(state.db.clone(), state.config.clone());

    let to = parse_rfc3339_or(query.to.as_deref(), chrono::Utc::now());
    let from_default = to - chrono::Duration::hours(24);
    let from = parse_rfc3339_or(query.from.as_deref(), from_default);
    let source = query
        .source
        .as_deref()
        .unwrap_or("auto")
        .trim()
        .to_ascii_lowercase();

    let limit = query.limit.unwrap_or(120);
    let cache_key = format!(
        "ohlcv:{}:{}:{}:{}:{}:{}",
        token.to_ascii_uppercase(),
        query.interval.to_ascii_lowercase(),
        source,
        limit,
        from.timestamp(),
        to.timestamp()
    );
    if let Some(cached) = get_cached_ohlcv(
        &state,
        &cache_key,
        Duration::from_secs(CHARTS_CACHE_TTL_SECS),
    )
    .await
    {
        return Ok(Json(ApiResponse::success(OHLCVResponse {
            token,
            interval: query.interval,
            data: cached,
        })));
    }

    let fetch_lock = charts_fetch_lock_for(&cache_key).await;
    let _guard = fetch_lock.lock().await;
    if let Some(cached) = get_cached_ohlcv(
        &state,
        &cache_key,
        Duration::from_secs(CHARTS_CACHE_TTL_SECS),
    )
    .await
    {
        return Ok(Json(ApiResponse::success(OHLCVResponse {
            token,
            interval: query.interval,
            data: cached,
        })));
    }

    let data = if source == "coingecko" {
        service
            .get_ohlcv_from_coingecko(&token, &query.interval, limit)
            .await?
    } else {
        let data = if let Some(limit) = query.limit {
            service
                .get_latest_candles(&token, &query.interval, limit)
                .await?
        } else {
            service.get_ohlcv(&token, &query.interval, from, to).await?
        };
        if data.is_empty() {
            service
                .get_ohlcv_from_coingecko(&token, &query.interval, limit)
                .await?
        } else {
            data
        }
    };

    store_cached_ohlcv(&state, &cache_key, data.clone()).await;

    Ok(Json(ApiResponse::success(OHLCVResponse {
        token,
        interval: query.interval,
        data,
    })))
}

/// GET /api/v1/chart/:token/indicators
pub async fn get_indicators(
    State(state): State<AppState>,
    Path(token): Path<String>,
    Query(query): Query<OHLCVQuery>,
) -> Result<Json<ApiResponse<Vec<IndicatorsResponse>>>> {
    let service = PriceChartService::new(state.db.clone(), state.config.clone());
    let cache_key = format!(
        "indicators:{}:{}",
        token.to_ascii_uppercase(),
        query.interval.to_ascii_lowercase()
    );
    if let Some(cached) = get_cached_indicators(
        &state,
        &cache_key,
        Duration::from_secs(CHARTS_CACHE_TTL_SECS),
    )
    .await
    {
        return Ok(Json(ApiResponse::success(cached)));
    }
    let fetch_lock = charts_fetch_lock_for(&cache_key).await;
    let _guard = fetch_lock.lock().await;
    if let Some(cached) = get_cached_indicators(
        &state,
        &cache_key,
        Duration::from_secs(CHARTS_CACHE_TTL_SECS),
    )
    .await
    {
        return Ok(Json(ApiResponse::success(cached)));
    }

    let mut indicators = vec![];

    for (name, key) in [("SMA", "SMA"), ("EMA", "EMA"), ("RSI", "RSI")] {
        if let Ok(data) = service
            .calculate_indicators(&token, &query.interval, key)
            .await
        {
            indicators.push(IndicatorsResponse {
                indicator: name.to_string(),
                data: map_indicator_points(data),
            });
        }
    }

    store_cached_indicators(&state, &cache_key, indicators.clone()).await;
    Ok(Json(ApiResponse::success(indicators)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};
    use rust_decimal::Decimal;

    #[test]
    // Internal helper that parses or transforms values for `parse_rfc3339_or_uses_default_on_invalid`.
    fn parse_rfc3339_or_uses_default_on_invalid() {
        // Memastikan tanggal invalid memakai default
        let fallback = Utc.timestamp_opt(1_700_000_000, 0).unwrap();
        let parsed = parse_rfc3339_or(Some("invalid-date"), fallback);
        assert_eq!(parsed, fallback);
    }

    #[test]
    // Internal helper that supports `map_indicator_points_converts_decimal` operations.
    fn map_indicator_points_converts_decimal() {
        // Memastikan konversi indikator ke tipe response benar
        let ts = Utc.timestamp_opt(1_700_000_000, 0).unwrap();
        let data = vec![(ts, Decimal::from(42))];
        let out = map_indicator_points(data);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].timestamp, 1_700_000_000);
        assert!((out[0].value - 42.0).abs() < f64::EPSILON);
    }
}
