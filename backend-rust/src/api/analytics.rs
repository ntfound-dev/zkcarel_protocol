use axum::{extract::State, http::HeaderMap, Json};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::Instant;
use tokio::time::Duration;

use super::leaderboard::compute_percentile;
use super::{ensure_user_exists, resolve_user_scope_addresses, AppState};
use crate::{
    constants::EPOCH_DURATION_SECONDS,
    error::Result,
    models::ApiResponse,
    services::{analytics_service::SystemHealth, AnalyticsService},
    tokenomics::{claim_fee_multiplier, rewards_distribution_pool_for_environment},
};

use rust_decimal::Decimal;

const ANALYTICS_CACHE_TTL_SECS: u64 = 45;
const ANALYTICS_CACHE_STALE_SECS: u64 = 300;
const ANALYTICS_CACHE_MAX_ENTRIES: usize = 50_000;
const ANALYTICS_REDIS_PREFIX: &str = "analytics:cache:v1";

#[derive(Clone)]
struct CachedAnalyticsResponse {
    fetched_at: Instant,
    value: AnalyticsResponse,
}

#[derive(sqlx::FromRow)]
struct RankResult {
    rank: i64,
}

#[derive(sqlx::FromRow)]
struct CountResult {
    count: i64,
}

static ANALYTICS_CACHE: OnceLock<tokio::sync::RwLock<HashMap<String, CachedAnalyticsResponse>>> =
    OnceLock::new();
static ANALYTICS_FETCH_LOCKS: OnceLock<
    tokio::sync::RwLock<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
> = OnceLock::new();

// Internal helper that supports `analytics_cache` operations.
fn analytics_cache() -> &'static tokio::sync::RwLock<HashMap<String, CachedAnalyticsResponse>> {
    ANALYTICS_CACHE.get_or_init(|| tokio::sync::RwLock::new(HashMap::new()))
}

// Internal helper that supports `analytics_fetch_locks` operations.
fn analytics_fetch_locks(
) -> &'static tokio::sync::RwLock<HashMap<String, Arc<tokio::sync::Mutex<()>>>> {
    ANALYTICS_FETCH_LOCKS.get_or_init(|| tokio::sync::RwLock::new(HashMap::new()))
}

// Internal helper that supports `analytics_fetch_lock_for` operations.
async fn analytics_fetch_lock_for(key: &str) -> Arc<tokio::sync::Mutex<()>> {
    let locks = analytics_fetch_locks();
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

    if guard.len() > ANALYTICS_CACHE_MAX_ENTRIES {
        let cache = analytics_cache();
        let cache_guard = cache.read().await;
        guard.retain(|cache_key, _| cache_guard.contains_key(cache_key));
    }
    lock
}

// Internal helper that supports `decimal_or_zero` operations.
fn decimal_or_zero(value: f64) -> Decimal {
    Decimal::from_f64_retain(value).unwrap_or(Decimal::ZERO)
}

// Internal helper that supports `estimated_carel_from_points` operations.
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

// Internal helper that parses or transforms values for `normalize_scope_addresses`.
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

// Internal helper that fetches data for `fetch_rewards_rank_stats`.
async fn fetch_rewards_rank_stats(
    state: &AppState,
    canonical_address: &str,
    epoch: i64,
) -> Result<(i64, f64)> {
    let rank_result: RankResult = sqlx::query_as(
        r#"
        WITH all_identities AS (
            SELECT address as identity
            FROM users
            UNION
            SELECT COALESCE(uw.user_address, p.user_address) as identity
            FROM points p
            LEFT JOIN user_wallet_addresses uw
              ON LOWER(uw.wallet_address) = LOWER(p.user_address)
            WHERE p.epoch = $1
        ),
        aggregated_points AS (
            SELECT
                COALESCE(uw.user_address, p.user_address) as identity,
                COALESCE(SUM(p.total_points), 0) as total_points
            FROM points p
            LEFT JOIN user_wallet_addresses uw
              ON LOWER(uw.wallet_address) = LOWER(p.user_address)
            WHERE p.epoch = $1
            GROUP BY COALESCE(uw.user_address, p.user_address)
        ),
        identity_points AS (
            SELECT
                ai.identity,
                COALESCE(ap.total_points, 0) as total_points
            FROM all_identities ai
            LEFT JOIN aggregated_points ap
              ON LOWER(ap.identity) = LOWER(ai.identity)
        )
        SELECT COUNT(*) + 1 as rank
        FROM identity_points
        WHERE total_points > COALESCE(
              (
                  SELECT ip.total_points
                  FROM identity_points ip
                  WHERE LOWER(ip.identity) = LOWER($2)
                  LIMIT 1
              ),
              0
          )
        "#,
    )
    .bind(epoch)
    .bind(canonical_address)
    .fetch_one(state.db.pool())
    .await?;

    let total_users_res: CountResult = sqlx::query_as(
        r#"
        WITH all_identities AS (
            SELECT address as identity
            FROM users
            UNION
            SELECT COALESCE(uw.user_address, p.user_address) as identity
            FROM points p
            LEFT JOIN user_wallet_addresses uw
              ON LOWER(uw.wallet_address) = LOWER(p.user_address)
            WHERE p.epoch = $1
        )
        SELECT COUNT(*) as count
        FROM all_identities
        "#,
    )
    .bind(epoch)
    .fetch_one(state.db.pool())
    .await?;

    let total_users = total_users_res.count.max(1);
    let percentile = compute_percentile(rank_result.rank, total_users);
    Ok((rank_result.rank, percentile))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AnalyticsResponse {
    pub portfolio: PortfolioAnalytics,
    pub trading: TradingAnalytics,
    pub rewards: RewardsAnalytics,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PortfolioAnalytics {
    pub total_value_usd: Decimal,
    pub pnl_24h: Decimal,
    pub pnl_7d: Decimal,
    pub pnl_30d: Decimal,
    pub pnl_all_time: Decimal,
    pub allocation: Vec<AllocationItem>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AllocationItem {
    pub asset: String,
    pub percentage: f64,
    pub value_usd: Decimal,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TradingAnalytics {
    pub total_trades: i64,
    pub total_volume_usd: Decimal,
    pub avg_trade_size: Decimal,
    pub win_rate: f64,
    pub best_trade: Decimal,
    pub worst_trade: Decimal,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RewardsAnalytics {
    pub total_points: Decimal,
    pub estimated_carel: Decimal,
    pub rank: i64,
    pub percentile: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SystemHealthResponse {
    pub indexer_delay_seconds: Option<i64>,
    pub avg_block_time_seconds: Option<f64>,
    pub total_transactions: i64,
}

/// GET /api/v1/portfolio/analytics
pub async fn get_analytics(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<AnalyticsResponse>>> {
    let user_addresses = resolve_user_scope_addresses(&headers, &state).await?;
    let canonical_address = user_addresses
        .first()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    if !canonical_address.is_empty() {
        ensure_user_exists(&state, canonical_address).await?;
    }
    let normalized_addresses = normalize_scope_addresses(&user_addresses);
    let current_epoch = chrono::Utc::now().timestamp() / EPOCH_DURATION_SECONDS;

    let cache_key = analytics_cache_key(&normalized_addresses, current_epoch);
    if let Some(cached) = get_cached_analytics(
        &state,
        &cache_key,
        Duration::from_secs(ANALYTICS_CACHE_TTL_SECS),
    )
    .await
    {
        return Ok(Json(ApiResponse::success(cached)));
    }

    let fetch_lock = analytics_fetch_lock_for(&cache_key).await;
    let _guard = fetch_lock.lock().await;
    if let Some(cached) = get_cached_analytics(
        &state,
        &cache_key,
        Duration::from_secs(ANALYTICS_CACHE_TTL_SECS),
    )
    .await
    {
        return Ok(Json(ApiResponse::success(cached)));
    }

    let analytics = AnalyticsService::new(state.db.clone(), state.config.clone());
    let (pnl_24h, pnl_7d, pnl_30d, pnl_all, allocation, trading) = tokio::try_join!(
        analytics.calculate_pnl(&user_addresses, "24h"),
        analytics.calculate_pnl(&user_addresses, "7d"),
        analytics.calculate_pnl(&user_addresses, "30d"),
        analytics.calculate_pnl(&user_addresses, "all_time"),
        analytics.get_allocation(&user_addresses),
        analytics.get_trading_performance(&user_addresses),
    )?;

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
    let (rewards_rank, rewards_percentile) = if canonical_address.is_empty() {
        (0, 0.0)
    } else {
        fetch_rewards_rank_stats(&state, canonical_address, current_epoch).await?
    };

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
            rank: rewards_rank,
            percentile: rewards_percentile,
        },
    };

    cache_analytics(&cache_key, response.clone()).await;
    cache_analytics_redis(&state, &cache_key, &response).await;
    Ok(Json(ApiResponse::success(response)))
}

/// GET /api/v1/analytics/system-health
pub async fn get_system_health(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<SystemHealthResponse>>> {
    let analytics = AnalyticsService::new(state.db.clone(), state.config.clone());
    let health: SystemHealth = analytics.get_system_health().await?;
    let response = SystemHealthResponse {
        indexer_delay_seconds: health.indexer_delay_seconds,
        avg_block_time_seconds: health.avg_block_time_seconds,
        total_transactions: health.total_transactions,
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
    // Internal helper that supports `decimal_or_zero_returns_zero_for_nan` operations.
    fn decimal_or_zero_returns_zero_for_nan() {
        // Memastikan nilai NaN dipetakan menjadi 0
        let value = decimal_or_zero(f64::NAN);
        assert_eq!(value, Decimal::ZERO);
    }

    #[test]
    // Internal helper that supports `estimated_carel_uses_pool_math` operations.
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

// Internal helper that supports `analytics_cache_key` operations.
fn analytics_cache_key(user_addresses: &[String], epoch: i64) -> String {
    let mut scope = normalize_scope_addresses(user_addresses);
    if !scope.is_empty() {
        scope.sort();
    }
    format!(
        "{}|{}",
        epoch,
        if scope.is_empty() {
            "-".to_string()
        } else {
            scope.join(",")
        }
    )
}

// Internal helper that supports `analytics_redis_key` operations.
fn analytics_redis_key(cache_key: &str) -> String {
    format!("{}:{}", ANALYTICS_REDIS_PREFIX, cache_key)
}

// Internal helper that supports `cache_analytics_redis` operations.
async fn cache_analytics_redis(state: &AppState, cache_key: &str, value: &AnalyticsResponse) {
    let Ok(payload) = serde_json::to_string(value) else {
        return;
    };
    let redis_key = analytics_redis_key(cache_key);
    let mut conn = state.redis.clone();
    let _: std::result::Result<(), redis::RedisError> = conn
        .set_ex(redis_key, payload, ANALYTICS_CACHE_TTL_SECS)
        .await;
}

// Internal helper that fetches data for `get_cached_analytics_redis`.
async fn get_cached_analytics_redis(
    state: &AppState,
    cache_key: &str,
) -> Option<AnalyticsResponse> {
    let redis_key = analytics_redis_key(cache_key);
    let mut conn = state.redis.clone();
    let raw: Option<String> = conn.get(redis_key).await.ok()?;
    raw.and_then(|value| serde_json::from_str(&value).ok())
}

// Internal helper that fetches data for `get_cached_analytics`.
async fn get_cached_analytics(
    state: &AppState,
    key: &str,
    max_age: Duration,
) -> Option<AnalyticsResponse> {
    let cache = analytics_cache();
    let guard = cache.read().await;
    if let Some(entry) = guard.get(key) {
        if entry.fetched_at.elapsed() <= max_age {
            return Some(entry.value.clone());
        }
    }
    drop(guard);

    if let Some(redis_cached) = get_cached_analytics_redis(state, key).await {
        cache_analytics(key, redis_cached.clone()).await;
        return Some(redis_cached);
    }

    None
}

// Internal helper that supports `cache_analytics` operations.
async fn cache_analytics(key: &str, value: AnalyticsResponse) {
    let cache = analytics_cache();
    let mut guard = cache.write().await;
    guard.insert(
        key.to_string(),
        CachedAnalyticsResponse {
            fetched_at: Instant::now(),
            value,
        },
    );
    if guard.len() > ANALYTICS_CACHE_MAX_ENTRIES {
        let stale_after = Duration::from_secs(ANALYTICS_CACHE_STALE_SECS);
        guard.retain(|_, entry| entry.fetched_at.elapsed() <= stale_after);
    }
}
