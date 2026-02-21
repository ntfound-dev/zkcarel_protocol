use axum::{extract::State, http::HeaderMap, Json};
use chrono::TimeZone;
use rust_decimal::prelude::ToPrimitive;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use crate::{
    error::Result,
    models::{ApiResponse, PriceTick},
    services::price_guard::{
        fallback_price_for, first_sane_price, sanitize_price_usd, symbol_candidates_for,
    },
};

use super::{
    resolve_user_scope_addresses,
    wallet::{
        fetch_btc_balance, fetch_evm_erc20_balance, fetch_evm_native_balance,
        fetch_starknet_erc20_balance, resolve_starknet_token_address,
    },
    AppState,
};

#[derive(Debug, Serialize, Clone)]
pub struct BalanceResponse {
    pub total_value_usd: f64,
    pub balances: Vec<TokenBalance>,
}

#[derive(Debug, Serialize, Clone)]
pub struct TokenBalance {
    pub token: String,
    pub amount: f64,
    pub value_usd: f64,
    pub price: f64,
    pub change_24h: f64,
}

#[derive(Debug, Serialize, Clone)]
pub struct HistoryResponse {
    pub total_value: Vec<HistoryPoint>,
    pub pnl: f64,
    pub pnl_percentage: f64,
}

#[derive(Debug, Serialize, Clone)]
pub struct HistoryPoint {
    pub timestamp: i64,
    pub value: f64,
}

#[derive(Debug, Deserialize)]
pub struct HistoryQuery {
    pub period: String, // 1d, 7d, 30d, all
}

#[derive(Debug, Deserialize)]
pub struct PortfolioOHLCVQuery {
    pub interval: String, // 1h, 4h, 1d, 1w
    pub limit: Option<i32>,
}

#[derive(Debug, Serialize, Clone)]
pub struct PortfolioOHLCVPoint {
    pub timestamp: i64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
}

#[derive(Debug, Serialize, Clone)]
pub struct PortfolioOHLCVResponse {
    pub interval: String,
    pub data: Vec<PortfolioOHLCVPoint>,
}

#[derive(sqlx::FromRow)]
struct RawTokenBalance {
    token: String,
    amount: f64,
}

struct TokenSeries {
    amount: f64,
    ticks: HashMap<i64, PriceTick>,
    last_close: Option<f64>,
    fallback_price: f64,
}

const ONCHAIN_BALANCE_TIMEOUT_SECS: u64 = 8;
const ONCHAIN_HOLDINGS_CACHE_TTL_SECS: u64 = 20;
const ONCHAIN_HOLDINGS_CACHE_STALE_SECS: u64 = 180;
const ONCHAIN_HOLDINGS_CACHE_MAX_ENTRIES: usize = 50_000;
const PORTFOLIO_BALANCE_CACHE_TTL_SECS: u64 = 15;
const PORTFOLIO_BALANCE_CACHE_STALE_SECS: u64 = 180;
const PORTFOLIO_BALANCE_CACHE_MAX_ENTRIES: usize = 50_000;
const PORTFOLIO_HISTORY_CACHE_TTL_SECS: u64 = 15;
const PORTFOLIO_HISTORY_CACHE_STALE_SECS: u64 = 180;
const PORTFOLIO_HISTORY_CACHE_MAX_ENTRIES: usize = 50_000;
const PORTFOLIO_OHLCV_CACHE_TTL_SECS: u64 = 15;
const PORTFOLIO_OHLCV_CACHE_STALE_SECS: u64 = 180;
const PORTFOLIO_OHLCV_CACHE_MAX_ENTRIES: usize = 50_000;

#[derive(Clone)]
struct CachedOnchainHoldings {
    fetched_at: Instant,
    values: HashMap<String, f64>,
}

static ONCHAIN_HOLDINGS_CACHE: OnceLock<
    tokio::sync::RwLock<HashMap<String, CachedOnchainHoldings>>,
> = OnceLock::new();
static PORTFOLIO_BALANCE_CACHE: OnceLock<
    tokio::sync::RwLock<HashMap<String, CachedBalanceResponse>>,
> = OnceLock::new();
static PORTFOLIO_HISTORY_CACHE: OnceLock<
    tokio::sync::RwLock<HashMap<String, CachedHistoryResponse>>,
> = OnceLock::new();
static PORTFOLIO_OHLCV_CACHE: OnceLock<tokio::sync::RwLock<HashMap<String, CachedOhlcvResponse>>> =
    OnceLock::new();
static PORTFOLIO_BALANCE_FETCH_LOCKS: OnceLock<
    tokio::sync::RwLock<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
> = OnceLock::new();
static PORTFOLIO_HISTORY_FETCH_LOCKS: OnceLock<
    tokio::sync::RwLock<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
> = OnceLock::new();
static PORTFOLIO_OHLCV_FETCH_LOCKS: OnceLock<
    tokio::sync::RwLock<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
> = OnceLock::new();

#[derive(Clone)]
struct CachedBalanceResponse {
    fetched_at: Instant,
    value: BalanceResponse,
}

#[derive(Clone)]
struct CachedHistoryResponse {
    fetched_at: Instant,
    value: HistoryResponse,
}

#[derive(Clone)]
struct CachedOhlcvResponse {
    fetched_at: Instant,
    value: PortfolioOHLCVResponse,
}

// Internal helper that supports `onchain_holdings_cache` operations.
fn onchain_holdings_cache() -> &'static tokio::sync::RwLock<HashMap<String, CachedOnchainHoldings>>
{
    ONCHAIN_HOLDINGS_CACHE.get_or_init(|| tokio::sync::RwLock::new(HashMap::new()))
}

// Internal helper that supports `portfolio_balance_cache` operations.
fn portfolio_balance_cache() -> &'static tokio::sync::RwLock<HashMap<String, CachedBalanceResponse>>
{
    PORTFOLIO_BALANCE_CACHE.get_or_init(|| tokio::sync::RwLock::new(HashMap::new()))
}

// Internal helper that supports `portfolio_history_cache` operations.
fn portfolio_history_cache() -> &'static tokio::sync::RwLock<HashMap<String, CachedHistoryResponse>>
{
    PORTFOLIO_HISTORY_CACHE.get_or_init(|| tokio::sync::RwLock::new(HashMap::new()))
}

// Internal helper that supports `portfolio_ohlcv_cache` operations.
fn portfolio_ohlcv_cache() -> &'static tokio::sync::RwLock<HashMap<String, CachedOhlcvResponse>> {
    PORTFOLIO_OHLCV_CACHE.get_or_init(|| tokio::sync::RwLock::new(HashMap::new()))
}

// Internal helper that supports `portfolio_balance_fetch_locks` operations.
fn portfolio_balance_fetch_locks(
) -> &'static tokio::sync::RwLock<HashMap<String, Arc<tokio::sync::Mutex<()>>>> {
    PORTFOLIO_BALANCE_FETCH_LOCKS.get_or_init(|| tokio::sync::RwLock::new(HashMap::new()))
}

// Internal helper that supports `portfolio_history_fetch_locks` operations.
fn portfolio_history_fetch_locks(
) -> &'static tokio::sync::RwLock<HashMap<String, Arc<tokio::sync::Mutex<()>>>> {
    PORTFOLIO_HISTORY_FETCH_LOCKS.get_or_init(|| tokio::sync::RwLock::new(HashMap::new()))
}

// Internal helper that supports `portfolio_ohlcv_fetch_locks` operations.
fn portfolio_ohlcv_fetch_locks(
) -> &'static tokio::sync::RwLock<HashMap<String, Arc<tokio::sync::Mutex<()>>>> {
    PORTFOLIO_OHLCV_FETCH_LOCKS.get_or_init(|| tokio::sync::RwLock::new(HashMap::new()))
}

// Internal helper that supports `portfolio_balance_fetch_lock_for` operations.
async fn portfolio_balance_fetch_lock_for(key: &str) -> Arc<tokio::sync::Mutex<()>> {
    let locks = portfolio_balance_fetch_locks();
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

    if guard.len() > PORTFOLIO_BALANCE_CACHE_MAX_ENTRIES {
        let cache = portfolio_balance_cache();
        let cache_guard = cache.read().await;
        guard.retain(|cache_key, _| cache_guard.contains_key(cache_key));
    }
    lock
}

// Internal helper that supports `portfolio_history_fetch_lock_for` operations.
async fn portfolio_history_fetch_lock_for(key: &str) -> Arc<tokio::sync::Mutex<()>> {
    let locks = portfolio_history_fetch_locks();
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

    if guard.len() > PORTFOLIO_HISTORY_CACHE_MAX_ENTRIES {
        let cache = portfolio_history_cache();
        let cache_guard = cache.read().await;
        guard.retain(|cache_key, _| cache_guard.contains_key(cache_key));
    }
    lock
}

// Internal helper that supports `portfolio_ohlcv_fetch_lock_for` operations.
async fn portfolio_ohlcv_fetch_lock_for(key: &str) -> Arc<tokio::sync::Mutex<()>> {
    let locks = portfolio_ohlcv_fetch_locks();
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

    if guard.len() > PORTFOLIO_OHLCV_CACHE_MAX_ENTRIES {
        let cache = portfolio_ohlcv_cache();
        let cache_guard = cache.read().await;
        guard.retain(|cache_key, _| cache_guard.contains_key(cache_key));
    }
    lock
}

// Internal helper that supports `portfolio_scope_cache_key` operations.
fn portfolio_scope_cache_key(user_addresses: &[String]) -> String {
    let normalized = normalize_scope_addresses(user_addresses);
    if normalized.is_empty() {
        return "-".to_string();
    }
    normalized.join(",")
}

// Internal helper that supports `portfolio_balance_cache_key` operations.
fn portfolio_balance_cache_key(auth_subject: &str, user_addresses: &[String]) -> String {
    format!(
        "{}|{}",
        auth_subject.trim().to_ascii_lowercase(),
        portfolio_scope_cache_key(user_addresses)
    )
}

// Internal helper that supports `portfolio_history_cache_key` operations.
fn portfolio_history_cache_key(
    auth_subject: &str,
    user_addresses: &[String],
    period: &str,
) -> String {
    format!(
        "{}|{}|{}",
        auth_subject.trim().to_ascii_lowercase(),
        portfolio_scope_cache_key(user_addresses),
        period.trim().to_ascii_lowercase()
    )
}

// Internal helper that supports `portfolio_ohlcv_cache_key` operations.
fn portfolio_ohlcv_cache_key(
    auth_subject: &str,
    user_addresses: &[String],
    interval: &str,
    limit: i64,
) -> String {
    format!(
        "{}|{}|{}|{}",
        auth_subject.trim().to_ascii_lowercase(),
        portfolio_scope_cache_key(user_addresses),
        interval.trim().to_ascii_lowercase(),
        limit
    )
}

// Internal helper that fetches data for `get_cached_portfolio_balance`.
async fn get_cached_portfolio_balance(key: &str, max_age: Duration) -> Option<BalanceResponse> {
    let cache = portfolio_balance_cache();
    let guard = cache.read().await;
    let entry = guard.get(key)?;
    if entry.fetched_at.elapsed() <= max_age {
        return Some(entry.value.clone());
    }
    None
}

// Internal helper that supports `cache_portfolio_balance` operations.
async fn cache_portfolio_balance(key: &str, value: BalanceResponse) {
    let cache = portfolio_balance_cache();
    let mut guard = cache.write().await;
    guard.insert(
        key.to_string(),
        CachedBalanceResponse {
            fetched_at: Instant::now(),
            value,
        },
    );
    if guard.len() > PORTFOLIO_BALANCE_CACHE_MAX_ENTRIES {
        let stale_after = Duration::from_secs(PORTFOLIO_BALANCE_CACHE_STALE_SECS);
        guard.retain(|_, entry| entry.fetched_at.elapsed() <= stale_after);
    }
}

// Internal helper that fetches data for `get_cached_portfolio_history`.
async fn get_cached_portfolio_history(key: &str, max_age: Duration) -> Option<HistoryResponse> {
    let cache = portfolio_history_cache();
    let guard = cache.read().await;
    let entry = guard.get(key)?;
    if entry.fetched_at.elapsed() <= max_age {
        return Some(entry.value.clone());
    }
    None
}

// Internal helper that supports `cache_portfolio_history` operations.
async fn cache_portfolio_history(key: &str, value: HistoryResponse) {
    let cache = portfolio_history_cache();
    let mut guard = cache.write().await;
    guard.insert(
        key.to_string(),
        CachedHistoryResponse {
            fetched_at: Instant::now(),
            value,
        },
    );
    if guard.len() > PORTFOLIO_HISTORY_CACHE_MAX_ENTRIES {
        let stale_after = Duration::from_secs(PORTFOLIO_HISTORY_CACHE_STALE_SECS);
        guard.retain(|_, entry| entry.fetched_at.elapsed() <= stale_after);
    }
}

// Internal helper that fetches data for `get_cached_portfolio_ohlcv`.
async fn get_cached_portfolio_ohlcv(
    key: &str,
    max_age: Duration,
) -> Option<PortfolioOHLCVResponse> {
    let cache = portfolio_ohlcv_cache();
    let guard = cache.read().await;
    let entry = guard.get(key)?;
    if entry.fetched_at.elapsed() <= max_age {
        return Some(entry.value.clone());
    }
    None
}

// Internal helper that supports `cache_portfolio_ohlcv` operations.
async fn cache_portfolio_ohlcv(key: &str, value: PortfolioOHLCVResponse) {
    let cache = portfolio_ohlcv_cache();
    let mut guard = cache.write().await;
    guard.insert(
        key.to_string(),
        CachedOhlcvResponse {
            fetched_at: Instant::now(),
            value,
        },
    );
    if guard.len() > PORTFOLIO_OHLCV_CACHE_MAX_ENTRIES {
        let stale_after = Duration::from_secs(PORTFOLIO_OHLCV_CACHE_STALE_SECS);
        guard.retain(|_, entry| entry.fetched_at.elapsed() <= stale_after);
    }
}

// Internal helper that parses or transforms values for `normalize_cache_part`.
fn normalize_cache_part(value: Option<&str>) -> String {
    value
        .map(|v| v.trim().to_ascii_lowercase())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "-".to_string())
}

// Internal helper that supports `onchain_holdings_cache_key` operations.
fn onchain_holdings_cache_key(
    auth_subject: &str,
    starknet: Option<&str>,
    evm: Option<&str>,
    btc: Option<&str>,
) -> String {
    format!(
        "{}|{}|{}|{}",
        auth_subject.trim().to_ascii_lowercase(),
        normalize_cache_part(starknet),
        normalize_cache_part(evm),
        normalize_cache_part(btc)
    )
}

// Internal helper that fetches data for `get_cached_onchain_holdings`.
async fn get_cached_onchain_holdings(key: &str, max_age: Duration) -> Option<HashMap<String, f64>> {
    let cache = onchain_holdings_cache();
    let guard = cache.read().await;
    let entry = guard.get(key)?;
    if entry.fetched_at.elapsed() <= max_age {
        return Some(entry.values.clone());
    }
    None
}

// Internal helper that supports `cache_onchain_holdings` operations.
async fn cache_onchain_holdings(key: String, values: HashMap<String, f64>) {
    let cache = onchain_holdings_cache();
    let mut guard = cache.write().await;
    guard.insert(
        key,
        CachedOnchainHoldings {
            fetched_at: Instant::now(),
            values,
        },
    );
    if guard.len() > ONCHAIN_HOLDINGS_CACHE_MAX_ENTRIES {
        let stale_after = Duration::from_secs(ONCHAIN_HOLDINGS_CACHE_STALE_SECS);
        guard.retain(|_, entry| entry.fetched_at.elapsed() <= stale_after);
    }
}

// Internal helper that supports `apply_onchain_overrides` operations.
fn apply_onchain_overrides(
    holdings: &mut HashMap<String, f64>,
    onchain_values: &HashMap<String, f64>,
) {
    for (token, amount) in onchain_values {
        override_holding(holdings, token, *amount);
    }
}

// Internal helper that supports `prune_testnet_holdings_without_onchain` operations.
fn prune_testnet_holdings_without_onchain(
    holdings: &mut HashMap<String, f64>,
    resolved_onchain: &HashMap<String, f64>,
    has_starknet: bool,
    has_evm: bool,
    has_btc: bool,
) {
    if has_starknet {
        for token in ["CAREL", "USDC", "USDT", "WBTC"] {
            if !resolved_onchain.contains_key(token) {
                holdings.remove(token);
            }
        }
        if !resolved_onchain.contains_key("STRK") && !has_evm {
            holdings.remove("STRK");
        }
    }
    if has_evm {
        if !resolved_onchain.contains_key("ETH") {
            holdings.remove("ETH");
        }
        if !resolved_onchain.contains_key("STRK") && !has_starknet {
            holdings.remove("STRK");
        }
    }
    if has_btc && !resolved_onchain.contains_key("BTC") {
        holdings.remove("BTC");
    }
}

// Internal helper that supports `total_value_usd` operations.
fn total_value_usd(balances: &[TokenBalance]) -> f64 {
    balances.iter().map(|b| b.value_usd).sum()
}

// Internal helper that supports `period_to_interval` operations.
fn period_to_interval(period: &str) -> (&'static str, i64) {
    match period {
        "1d" => ("1h", 24),
        "7d" => ("1d", 7),
        "30d" => ("1d", 30),
        _ => ("1w", 26),
    }
}

// Internal helper that supports `decimal_to_f64` operations.
fn decimal_to_f64(value: rust_decimal::Decimal) -> f64 {
    value.to_f64().unwrap_or(0.0)
}

// Internal helper that supports `interval_seconds` operations.
fn interval_seconds(interval: &str) -> i64 {
    match interval {
        "1h" => 3600,
        "4h" => 14400,
        "1d" => 86400,
        "1w" => 604800,
        _ => 3600,
    }
}

// Internal helper that parses or transforms values for `clamp_ohlcv_limit`.
fn clamp_ohlcv_limit(limit: Option<i32>) -> i64 {
    limit.unwrap_or(24).clamp(2, 200) as i64
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

// Internal helper that supports `align_timestamp` operations.
fn align_timestamp(timestamp: i64, interval: i64) -> i64 {
    if interval <= 0 {
        return timestamp;
    }
    timestamp - (timestamp % interval)
}

// Internal helper that supports `tick_prices` operations.
fn tick_prices(tick: &PriceTick) -> (f64, f64, f64, f64, f64) {
    let symbol = tick.token.as_str();
    let fallback = fallback_price_for(symbol);
    let close = sanitize_price_usd(symbol, decimal_to_f64(tick.close)).unwrap_or(fallback);
    let open = sanitize_price_usd(symbol, decimal_to_f64(tick.open)).unwrap_or(close);
    let high = sanitize_price_usd(symbol, decimal_to_f64(tick.high)).unwrap_or(open.max(close));
    let low = sanitize_price_usd(symbol, decimal_to_f64(tick.low)).unwrap_or(open.min(close));
    (open, high, low, close, decimal_to_f64(tick.volume))
}

// Internal helper that supports `latest_price` operations.
async fn latest_price(state: &AppState, token: &str) -> Result<f64> {
    let token_upper = token.to_ascii_uppercase();
    for candidate in symbol_candidates_for(&token_upper) {
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

    Ok(fallback_price_for(&token_upper))
}

// Internal helper that supports `latest_price_with_change` operations.
async fn latest_price_with_change(state: &AppState, token: &str) -> Result<(f64, f64)> {
    let token_upper = token.to_ascii_uppercase();
    let mut sane_rows: Vec<f64> = Vec::new();

    for candidate in symbol_candidates_for(&token_upper) {
        let rows: Vec<f64> = sqlx::query_scalar(
            "SELECT close::FLOAT FROM price_history WHERE token = $1 ORDER BY timestamp DESC LIMIT 16",
        )
        .bind(&candidate)
        .fetch_all(state.db.pool())
        .await?;
        sane_rows = rows
            .into_iter()
            .filter_map(|value| sanitize_price_usd(&candidate, value))
            .take(2)
            .collect();
        if !sane_rows.is_empty() {
            break;
        }
    }

    let latest = sane_rows
        .first()
        .copied()
        .unwrap_or_else(|| fallback_price_for(&token_upper));
    let prev = sane_rows.get(1).copied().unwrap_or(latest);
    let change = if prev > 0.0 {
        ((latest - prev) / prev) * 100.0
    } else {
        0.0
    };
    Ok((latest, change))
}

// Internal helper that fetches data for `fetch_token_holdings`.
async fn fetch_token_holdings(
    state: &AppState,
    user_addresses: &[String],
) -> Result<Vec<RawTokenBalance>> {
    let normalized_addresses = normalize_scope_addresses(user_addresses);
    if normalized_addresses.is_empty() {
        return Ok(Vec::new());
    }

    let rows = sqlx::query_as::<_, RawTokenBalance>(
        r#"
        SELECT token, SUM(amount) as amount
        FROM (
            SELECT UPPER(token_out) as token, COALESCE(CAST(amount_out AS FLOAT), 0) as amount
            FROM transactions
            WHERE LOWER(user_address) = ANY($1) AND token_out IS NOT NULL AND COALESCE(is_private, false) = false
            UNION ALL
            SELECT UPPER(token_in) as token, -COALESCE(CAST(amount_in AS FLOAT), 0) as amount
            FROM transactions
            WHERE LOWER(user_address) = ANY($1) AND token_in IS NOT NULL AND COALESCE(is_private, false) = false
        ) t
        GROUP BY token
        "#,
    )
    .bind(normalized_addresses)
    .fetch_all(state.db.pool())
    .await?;

    Ok(rows)
}

// Internal helper that supports `override_holding` operations.
fn override_holding(holdings: &mut HashMap<String, f64>, token: &str, amount: f64) {
    if !amount.is_finite() {
        return;
    }
    if amount <= 0.0 {
        holdings.remove(token);
        return;
    }
    holdings.insert(token.to_string(), amount);
}

// Internal helper that supports `looks_like_transient_rpc_error` operations.
fn looks_like_transient_rpc_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("jsonrpcresponse")
        || lower.contains("error decoding response body")
        || lower.contains("too many requests")
        || lower.contains("429")
        || lower.contains("timeout")
        || lower.contains("timed out")
}

// Internal helper that fetches data for `fetch_optional_balance_with_timeout`.
async fn fetch_optional_balance_with_timeout<F>(label: &str, fut: F) -> Option<f64>
where
    F: std::future::Future<Output = Result<Option<f64>>>,
{
    match tokio::time::timeout(Duration::from_secs(ONCHAIN_BALANCE_TIMEOUT_SECS), fut).await {
        Ok(Ok(value)) => value,
        Ok(Err(err)) => {
            let err_text = err.to_string();
            if looks_like_transient_rpc_error(&err_text) {
                tracing::debug!("Portfolio {} transient fetch issue: {}", label, err_text);
            } else {
                tracing::warn!("Portfolio {} fetch failed: {}", label, err_text);
            }
            None
        }
        Err(_) => {
            tracing::debug!(
                "Portfolio {} fetch timed out after {}s",
                label,
                ONCHAIN_BALANCE_TIMEOUT_SECS
            );
            None
        }
    }
}

// Internal helper that supports `merge_onchain_holdings` operations.
async fn merge_onchain_holdings(
    state: &AppState,
    auth_subject: &str,
    holdings: &mut HashMap<String, f64>,
) -> Result<()> {
    let linked = state
        .db
        .list_wallet_addresses(auth_subject)
        .await
        .unwrap_or_default();
    let starknet_address = linked
        .iter()
        .find(|item| item.chain == "starknet")
        .map(|item| item.wallet_address.clone());
    let evm_address = linked
        .iter()
        .find(|item| item.chain == "evm")
        .map(|item| item.wallet_address.clone());
    let btc_address = linked
        .iter()
        .find(|item| item.chain == "bitcoin")
        .map(|item| item.wallet_address.clone());
    let cache_key = onchain_holdings_cache_key(
        auth_subject,
        starknet_address.as_deref(),
        evm_address.as_deref(),
        btc_address.as_deref(),
    );
    if let Some(cached) = get_cached_onchain_holdings(
        &cache_key,
        Duration::from_secs(ONCHAIN_HOLDINGS_CACHE_TTL_SECS),
    )
    .await
    {
        apply_onchain_overrides(holdings, &cached);
        return Ok(());
    }

    let starknet_strk_fut = async {
        match (
            starknet_address.as_deref(),
            state.config.token_strk_address.as_deref(),
        ) {
            (Some(addr), Some(token)) => {
                fetch_optional_balance_with_timeout(
                    "starknet STRK",
                    fetch_starknet_erc20_balance(&state.config, addr, token),
                )
                .await
            }
            _ => None,
        }
    };
    let starknet_carel_fut = async {
        match (
            starknet_address.as_deref(),
            resolve_starknet_token_address(&state.config, "CAREL"),
        ) {
            (Some(addr), Some(token)) => {
                fetch_optional_balance_with_timeout(
                    "starknet CAREL",
                    fetch_starknet_erc20_balance(&state.config, addr, &token),
                )
                .await
            }
            _ => None,
        }
    };
    let starknet_usdc_fut = async {
        match (
            starknet_address.as_deref(),
            resolve_starknet_token_address(&state.config, "USDC"),
        ) {
            (Some(addr), Some(token)) => {
                fetch_optional_balance_with_timeout(
                    "starknet USDC",
                    fetch_starknet_erc20_balance(&state.config, addr, &token),
                )
                .await
            }
            _ => None,
        }
    };
    let starknet_usdt_fut = async {
        match (
            starknet_address.as_deref(),
            resolve_starknet_token_address(&state.config, "USDT"),
        ) {
            (Some(addr), Some(token)) => {
                fetch_optional_balance_with_timeout(
                    "starknet USDT",
                    fetch_starknet_erc20_balance(&state.config, addr, &token),
                )
                .await
            }
            _ => None,
        }
    };
    let starknet_wbtc_fut = async {
        match (
            starknet_address.as_deref(),
            resolve_starknet_token_address(&state.config, "WBTC"),
        ) {
            (Some(addr), Some(token)) => {
                fetch_optional_balance_with_timeout(
                    "starknet WBTC",
                    fetch_starknet_erc20_balance(&state.config, addr, &token),
                )
                .await
            }
            _ => None,
        }
    };
    let evm_eth_fut = async {
        match evm_address.as_deref() {
            Some(addr) => {
                fetch_optional_balance_with_timeout(
                    "evm ETH",
                    fetch_evm_native_balance(&state.config, addr),
                )
                .await
            }
            None => None,
        }
    };
    let evm_strk_fut = async {
        match (
            evm_address.as_deref(),
            state.config.token_strk_l1_address.as_deref(),
        ) {
            (Some(addr), Some(token)) => {
                fetch_optional_balance_with_timeout(
                    "evm STRK",
                    fetch_evm_erc20_balance(&state.config, addr, token),
                )
                .await
            }
            _ => None,
        }
    };
    let btc_fut = async {
        match btc_address.as_deref() {
            Some(addr) => {
                fetch_optional_balance_with_timeout(
                    "bitcoin BTC",
                    fetch_btc_balance(&state.config, addr),
                )
                .await
            }
            None => None,
        }
    };

    let (
        starknet_strk,
        starknet_carel,
        starknet_usdc,
        starknet_usdt,
        starknet_wbtc,
        evm_eth,
        evm_strk,
        btc_balance,
    ) = tokio::join!(
        starknet_strk_fut,
        starknet_carel_fut,
        starknet_usdc_fut,
        starknet_usdt_fut,
        starknet_wbtc_fut,
        evm_eth_fut,
        evm_strk_fut,
        btc_fut
    );

    let mut resolved_onchain = HashMap::new();
    let has_starknet = starknet_address.is_some();
    let has_evm = evm_address.is_some();
    let has_btc = btc_address.is_some();
    if evm_address.is_some() {
        if let Some(balance) = evm_eth {
            resolved_onchain.insert("ETH".to_string(), balance);
        }
    }

    let strk_total = starknet_strk.unwrap_or(0.0) + evm_strk.unwrap_or(0.0);
    if (starknet_address.is_some() || evm_address.is_some())
        && (starknet_strk.is_some() || evm_strk.is_some())
    {
        resolved_onchain.insert("STRK".to_string(), strk_total);
    } else if strk_total > 0.0 {
        resolved_onchain.insert("STRK".to_string(), strk_total);
    }

    if btc_address.is_some() {
        if let Some(balance) = btc_balance {
            resolved_onchain.insert("BTC".to_string(), balance);
        }
    }
    if starknet_address.is_some() {
        if let Some(balance) = starknet_carel {
            resolved_onchain.insert("CAREL".to_string(), balance);
        }
        if let Some(balance) = starknet_usdc {
            resolved_onchain.insert("USDC".to_string(), balance);
        }
        if let Some(balance) = starknet_usdt {
            resolved_onchain.insert("USDT".to_string(), balance);
        }
        if let Some(balance) = starknet_wbtc {
            resolved_onchain.insert("WBTC".to_string(), balance);
        }
    }

    if state.config.is_testnet() {
        prune_testnet_holdings_without_onchain(
            holdings,
            &resolved_onchain,
            has_starknet,
            has_evm,
            has_btc,
        );
    }

    if resolved_onchain.is_empty() {
        if let Some(stale) = get_cached_onchain_holdings(
            &cache_key,
            Duration::from_secs(ONCHAIN_HOLDINGS_CACHE_STALE_SECS),
        )
        .await
        {
            tracing::debug!(
                "portfolio onchain holdings returning stale cache fallback for key={}",
                cache_key
            );
            apply_onchain_overrides(holdings, &stale);
            return Ok(());
        }
        // Negative-cache empty/failed reads to avoid retry storms.
        cache_onchain_holdings(cache_key, HashMap::new()).await;
    } else {
        cache_onchain_holdings(cache_key, resolved_onchain.clone()).await;
    }
    apply_onchain_overrides(holdings, &resolved_onchain);

    Ok(())
}

// Internal helper that builds inputs for `build_balances`.
async fn build_balances(
    state: &AppState,
    auth_subject: &str,
    user_addresses: &[String],
) -> Result<Vec<TokenBalance>> {
    let rows = fetch_token_holdings(state, user_addresses).await?;
    let mut holding_map = HashMap::new();
    for row in rows {
        if row.amount > 0.0 {
            holding_map.insert(row.token, row.amount);
        }
    }
    merge_onchain_holdings(state, auth_subject, &mut holding_map).await?;

    let mut balances = Vec::new();

    for (token, amount) in holding_map {
        if amount <= 0.0 {
            continue;
        }
        let (price, change) = latest_price_with_change(state, token.as_str()).await?;
        let value_usd = amount * price;
        balances.push(TokenBalance {
            token,
            amount,
            value_usd,
            price,
            change_24h: change,
        });
    }

    Ok(balances)
}

// Internal helper that builds inputs for `build_portfolio_ohlcv`.
async fn build_portfolio_ohlcv(
    state: &AppState,
    auth_subject: &str,
    user_addresses: &[String],
    interval: &str,
    limit: i64,
) -> Result<Vec<PortfolioOHLCVPoint>> {
    let rows = fetch_token_holdings(state, user_addresses).await?;
    let mut holding_map = HashMap::new();
    for row in rows {
        if row.amount > 0.0 {
            holding_map.insert(row.token, row.amount);
        }
    }
    merge_onchain_holdings(state, auth_subject, &mut holding_map).await?;
    if holding_map.is_empty() {
        return Ok(Vec::new());
    }

    let interval_secs = interval_seconds(interval);
    let now_ts = align_timestamp(chrono::Utc::now().timestamp(), interval_secs);
    let start_ts = now_ts - interval_secs * (limit - 1);
    let from = chrono::Utc
        .timestamp_opt(start_ts, 0)
        .single()
        .unwrap_or_else(|| chrono::Utc::now());
    let to = chrono::Utc
        .timestamp_opt(now_ts, 0)
        .single()
        .unwrap_or_else(|| chrono::Utc::now());

    let mut series = Vec::new();
    for (token, amount) in holding_map {
        let ticks = state
            .db
            .get_price_history(&token, interval, from, to)
            .await?
            .into_iter()
            .map(|tick| (tick.timestamp.timestamp(), tick))
            .collect::<HashMap<_, _>>();
        let fallback = latest_price(state, token.as_str()).await?;

        series.push(TokenSeries {
            amount,
            ticks,
            last_close: None,
            fallback_price: fallback,
        });
    }

    let mut data = Vec::with_capacity(limit as usize);
    for idx in 0..limit {
        let ts = start_ts + interval_secs * idx;
        let mut open_total = 0.0;
        let mut high_total = 0.0;
        let mut low_total = 0.0;
        let mut close_total = 0.0;
        let mut volume_total = 0.0;

        for token_series in series.iter_mut() {
            let (open, high, low, close, volume) = if let Some(tick) = token_series.ticks.get(&ts) {
                let (o, h, l, c, v) = tick_prices(tick);
                token_series.last_close = Some(c);
                (o, h, l, c, v)
            } else if let Some(last) = token_series.last_close {
                (last, last, last, last, 0.0)
            } else {
                let fallback = token_series.fallback_price;
                (fallback, fallback, fallback, fallback, 0.0)
            };

            open_total += token_series.amount * open;
            high_total += token_series.amount * high;
            low_total += token_series.amount * low;
            close_total += token_series.amount * close;
            volume_total += volume;
        }

        data.push(PortfolioOHLCVPoint {
            timestamp: ts,
            open: open_total,
            high: high_total,
            low: low_total,
            close: close_total,
            volume: volume_total,
        });
    }

    Ok(data)
}

/// GET /api/v1/portfolio/balance
pub async fn get_balance(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<BalanceResponse>>> {
    let user_addresses = resolve_user_scope_addresses(&headers, &state).await?;
    let auth_subject = user_addresses.first().cloned().unwrap_or_default();
    let cache_key = portfolio_balance_cache_key(&auth_subject, &user_addresses);
    if let Some(cached) = get_cached_portfolio_balance(
        &cache_key,
        Duration::from_secs(PORTFOLIO_BALANCE_CACHE_TTL_SECS),
    )
    .await
    {
        return Ok(Json(ApiResponse::success(cached)));
    }

    let fetch_lock = portfolio_balance_fetch_lock_for(&cache_key).await;
    let _guard = fetch_lock.lock().await;
    if let Some(cached) = get_cached_portfolio_balance(
        &cache_key,
        Duration::from_secs(PORTFOLIO_BALANCE_CACHE_TTL_SECS),
    )
    .await
    {
        return Ok(Json(ApiResponse::success(cached)));
    }

    match build_balances(&state, &auth_subject, &user_addresses).await {
        Ok(balances) => {
            let response = BalanceResponse {
                total_value_usd: total_value_usd(&balances),
                balances,
            };
            cache_portfolio_balance(&cache_key, response.clone()).await;
            Ok(Json(ApiResponse::success(response)))
        }
        Err(err) => {
            if let Some(stale) = get_cached_portfolio_balance(
                &cache_key,
                Duration::from_secs(PORTFOLIO_BALANCE_CACHE_STALE_SECS),
            )
            .await
            {
                tracing::debug!(
                    "portfolio_balance returning stale cache fallback key={}",
                    cache_key
                );
                return Ok(Json(ApiResponse::success(stale)));
            }
            Err(err)
        }
    }
}

/// GET /api/v1/portfolio/history
pub async fn get_history(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(query): axum::extract::Query<HistoryQuery>,
) -> Result<Json<ApiResponse<HistoryResponse>>> {
    let user_addresses = resolve_user_scope_addresses(&headers, &state).await?;
    let auth_subject = user_addresses.first().cloned().unwrap_or_default();
    let cache_key = portfolio_history_cache_key(&auth_subject, &user_addresses, &query.period);
    if let Some(cached) = get_cached_portfolio_history(
        &cache_key,
        Duration::from_secs(PORTFOLIO_HISTORY_CACHE_TTL_SECS),
    )
    .await
    {
        return Ok(Json(ApiResponse::success(cached)));
    }

    let fetch_lock = portfolio_history_fetch_lock_for(&cache_key).await;
    let _guard = fetch_lock.lock().await;
    if let Some(cached) = get_cached_portfolio_history(
        &cache_key,
        Duration::from_secs(PORTFOLIO_HISTORY_CACHE_TTL_SECS),
    )
    .await
    {
        return Ok(Json(ApiResponse::success(cached)));
    }

    let (interval, limit) = period_to_interval(&query.period);
    match build_portfolio_ohlcv(&state, &auth_subject, &user_addresses, interval, limit).await {
        Ok(ohlcv) => {
            let total_value = ohlcv
                .iter()
                .map(|point| HistoryPoint {
                    timestamp: point.timestamp,
                    value: point.close,
                })
                .collect::<Vec<_>>();

            let (pnl, pnl_percentage) =
                if let (Some(first), Some(last)) = (ohlcv.first(), ohlcv.last()) {
                    let diff = last.close - first.close;
                    let pct = if first.close > 0.0 {
                        (diff / first.close) * 100.0
                    } else {
                        0.0
                    };
                    (diff, pct)
                } else {
                    (0.0, 0.0)
                };

            let response = HistoryResponse {
                total_value,
                pnl,
                pnl_percentage,
            };
            cache_portfolio_history(&cache_key, response.clone()).await;
            Ok(Json(ApiResponse::success(response)))
        }
        Err(err) => {
            if let Some(stale) = get_cached_portfolio_history(
                &cache_key,
                Duration::from_secs(PORTFOLIO_HISTORY_CACHE_STALE_SECS),
            )
            .await
            {
                tracing::debug!(
                    "portfolio_history returning stale cache fallback key={}",
                    cache_key
                );
                return Ok(Json(ApiResponse::success(stale)));
            }
            Err(err)
        }
    }
}

/// GET /api/v1/portfolio/ohlcv
pub async fn get_portfolio_ohlcv(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(query): axum::extract::Query<PortfolioOHLCVQuery>,
) -> Result<Json<ApiResponse<PortfolioOHLCVResponse>>> {
    let user_addresses = resolve_user_scope_addresses(&headers, &state).await?;
    let auth_subject = user_addresses.first().cloned().unwrap_or_default();
    let interval = query.interval.clone();
    let limit = clamp_ohlcv_limit(query.limit);
    let cache_key = portfolio_ohlcv_cache_key(&auth_subject, &user_addresses, &interval, limit);
    if let Some(cached) = get_cached_portfolio_ohlcv(
        &cache_key,
        Duration::from_secs(PORTFOLIO_OHLCV_CACHE_TTL_SECS),
    )
    .await
    {
        return Ok(Json(ApiResponse::success(cached)));
    }

    let fetch_lock = portfolio_ohlcv_fetch_lock_for(&cache_key).await;
    let _guard = fetch_lock.lock().await;
    if let Some(cached) = get_cached_portfolio_ohlcv(
        &cache_key,
        Duration::from_secs(PORTFOLIO_OHLCV_CACHE_TTL_SECS),
    )
    .await
    {
        return Ok(Json(ApiResponse::success(cached)));
    }

    match build_portfolio_ohlcv(&state, &auth_subject, &user_addresses, &interval, limit).await {
        Ok(data) => {
            let response = PortfolioOHLCVResponse { interval, data };
            cache_portfolio_ohlcv(&cache_key, response.clone()).await;
            Ok(Json(ApiResponse::success(response)))
        }
        Err(err) => {
            if let Some(stale) = get_cached_portfolio_ohlcv(
                &cache_key,
                Duration::from_secs(PORTFOLIO_OHLCV_CACHE_STALE_SECS),
            )
            .await
            {
                tracing::debug!(
                    "portfolio_ohlcv returning stale cache fallback key={}",
                    cache_key
                );
                return Ok(Json(ApiResponse::success(stale)));
            }
            Err(err)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    // Internal helper that supports `total_value_usd_sums_balances` operations.
    fn total_value_usd_sums_balances() {
        // Memastikan total nilai dihitung dari seluruh saldo
        let balances = vec![
            TokenBalance {
                token: "A".to_string(),
                amount: 1.0,
                value_usd: 10.0,
                price: 10.0,
                change_24h: 0.0,
            },
            TokenBalance {
                token: "B".to_string(),
                amount: 2.0,
                value_usd: 15.5,
                price: 7.75,
                change_24h: 0.0,
            },
        ];
        assert!((total_value_usd(&balances) - 25.5).abs() < f64::EPSILON);
    }

    #[test]
    // Internal helper that supports `period_to_interval_defaults_to_weekly` operations.
    fn period_to_interval_defaults_to_weekly() {
        // Memastikan periode tidak dikenal memakai default 1w
        let (interval, limit) = period_to_interval("unknown");
        assert_eq!(interval, "1w");
        assert_eq!(limit, 26);
    }

    #[test]
    // Internal helper that supports `interval_seconds_defaults_to_hour` operations.
    fn interval_seconds_defaults_to_hour() {
        // Memastikan interval tidak dikenal memakai 1 jam
        assert_eq!(interval_seconds("unknown"), 3600);
    }

    #[test]
    // Internal helper that supports `align_timestamp_rounds_down` operations.
    fn align_timestamp_rounds_down() {
        // Memastikan timestamp di-align ke interval
        assert_eq!(align_timestamp(10005, 3600), 7200);
    }
}
