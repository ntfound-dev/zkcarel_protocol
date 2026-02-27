use axum::{extract::State, http::HeaderMap, Json};
use ethers::{
    providers::{Http, Middleware, Provider},
    types::{Address, U256},
};
use serde::{Deserialize, Serialize};
use starknet_core::types::FunctionCall;
use starknet_core::utils::get_selector_from_name;
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use crate::{
    config::Config,
    constants::token_address_for,
    error::{AppError, Result},
    indexer::starknet_client::{ContractBatchCall, StarknetClient},
    models::ApiResponse,
    services::onchain::{parse_felt, u256_from_felts, OnchainReader},
};

use super::{
    portfolio::{
        get_cached_onchain_holdings_for_scope, get_cached_portfolio_balance_amounts_for_scope,
    },
    require_user, AppState,
};

#[derive(Debug, Deserialize)]
pub struct OnchainBalanceRequest {
    pub starknet_address: Option<String>,
    pub evm_address: Option<String>,
    pub btc_address: Option<String>,
    pub force: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct LinkWalletAddressRequest {
    pub chain: String,
    pub address: String,
    pub provider: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LinkWalletAddressResponse {
    pub user_address: String,
    pub chain: String,
    pub address: String,
}

#[derive(Debug, Serialize, Default)]
pub struct LinkedWalletsResponse {
    pub starknet_address: Option<String>,
    pub evm_address: Option<String>,
    pub btc_address: Option<String>,
}

#[derive(Debug, Serialize, Default, Clone)]
pub struct OnchainBalanceResponse {
    pub strk_l2: Option<f64>,
    pub strk_l1: Option<f64>,
    pub eth: Option<f64>,
    pub btc: Option<f64>,
    pub carel: Option<f64>,
    pub usdc: Option<f64>,
    pub usdt: Option<f64>,
    pub wbtc: Option<f64>,
}

const ONCHAIN_BALANCE_TIMEOUT_SECS: u64 = 6;
const BTC_BALANCE_SOURCE_TIMEOUT_SECS: u64 = 4;
const ONCHAIN_BALANCE_CACHE_TTL_SECS: u64 = 20;
const ONCHAIN_BALANCE_CACHE_STALE_SECS: u64 = 180;
const ONCHAIN_BALANCE_CACHE_MAX_ENTRIES: usize = 50_000;
const EVM_RPC_MAX_INFLIGHT_DEFAULT: usize = 8;
const EVM_RPC_BREAKER_THRESHOLD: u32 = 3;
const EVM_RPC_BREAKER_BASE_SECS: u64 = 2;
const EVM_RPC_BREAKER_MAX_SECS: u64 = 45;

#[derive(Clone)]
struct CachedOnchainBalance {
    fetched_at: Instant,
    value: OnchainBalanceResponse,
}

static ONCHAIN_BALANCE_CACHE: OnceLock<tokio::sync::RwLock<HashMap<String, CachedOnchainBalance>>> =
    OnceLock::new();
static ONCHAIN_BALANCE_FETCH_LOCKS: OnceLock<
    tokio::sync::RwLock<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
> = OnceLock::new();
static EVM_RPC_SEMAPHORE: OnceLock<Arc<Semaphore>> = OnceLock::new();
static EVM_RPC_BREAKER: OnceLock<tokio::sync::RwLock<EvmRpcCircuitBreaker>> = OnceLock::new();

#[derive(Default)]
struct EvmRpcCircuitBreaker {
    consecutive_failures: u32,
    open_until: Option<Instant>,
}

// Internal helper that supports `onchain_balance_cache` operations.
fn onchain_balance_cache() -> &'static tokio::sync::RwLock<HashMap<String, CachedOnchainBalance>> {
    ONCHAIN_BALANCE_CACHE.get_or_init(|| tokio::sync::RwLock::new(HashMap::new()))
}

// Internal helper that supports `onchain_balance_fetch_locks` operations.
fn onchain_balance_fetch_locks(
) -> &'static tokio::sync::RwLock<HashMap<String, Arc<tokio::sync::Mutex<()>>>> {
    ONCHAIN_BALANCE_FETCH_LOCKS.get_or_init(|| tokio::sync::RwLock::new(HashMap::new()))
}

// Internal helper that supports `configured_evm_max_inflight` operations.
fn configured_evm_max_inflight() -> usize {
    std::env::var("EVM_RPC_MAX_INFLIGHT")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(EVM_RPC_MAX_INFLIGHT_DEFAULT)
}

// Internal helper that supports `evm_rpc_semaphore` operations.
fn evm_rpc_semaphore() -> &'static Arc<Semaphore> {
    EVM_RPC_SEMAPHORE.get_or_init(|| Arc::new(Semaphore::new(configured_evm_max_inflight())))
}

// Internal helper that supports `evm_rpc_breaker` operations.
fn evm_rpc_breaker() -> &'static tokio::sync::RwLock<EvmRpcCircuitBreaker> {
    EVM_RPC_BREAKER.get_or_init(|| tokio::sync::RwLock::new(EvmRpcCircuitBreaker::default()))
}

// Internal helper that supports `evm_breaker_backoff_duration` operations.
fn evm_breaker_backoff_duration(failures: u32) -> Duration {
    if failures <= EVM_RPC_BREAKER_THRESHOLD {
        return Duration::from_secs(EVM_RPC_BREAKER_BASE_SECS);
    }
    let exponent = (failures - EVM_RPC_BREAKER_THRESHOLD).min(6);
    let multiplier = 1_u64 << exponent;
    let secs = EVM_RPC_BREAKER_BASE_SECS.saturating_mul(multiplier);
    Duration::from_secs(secs.min(EVM_RPC_BREAKER_MAX_SECS))
}

// Internal helper that supports `looks_like_transient_evm_error` operations.
fn looks_like_transient_evm_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("too many requests")
        || lower.contains("429")
        || lower.contains("timeout")
        || lower.contains("timed out")
        || lower.contains("gateway")
        || lower.contains("temporarily unavailable")
        || lower.contains("connection reset")
        || lower.contains("eof while parsing")
        || lower.contains("unknown field `code`")
}

// Internal helper that supports `evm_rpc_preflight` operations.
async fn evm_rpc_preflight(method: &str) -> Result<OwnedSemaphorePermit> {
    let now = Instant::now();
    {
        let guard = evm_rpc_breaker().read().await;
        if let Some(until) = guard.open_until {
            if until > now {
                let remain_ms = until.duration_since(now).as_millis();
                return Err(AppError::BlockchainRPC(format!(
                    "{} skipped: EVM RPC circuit open for {}ms",
                    method, remain_ms
                )));
            }
        }
    }

    evm_rpc_semaphore()
        .clone()
        .acquire_owned()
        .await
        .map_err(|e| AppError::Internal(format!("EVM RPC semaphore closed: {}", e)))
}

// Internal helper that supports `evm_rpc_record_success` operations.
async fn evm_rpc_record_success() {
    let mut guard = evm_rpc_breaker().write().await;
    if guard.consecutive_failures != 0 || guard.open_until.is_some() {
        guard.consecutive_failures = 0;
        guard.open_until = None;
    }
}

// Internal helper that supports `evm_rpc_record_failure` operations.
async fn evm_rpc_record_failure(method: &str, error_text: &str) {
    if !looks_like_transient_evm_error(error_text) {
        return;
    }

    let mut guard = evm_rpc_breaker().write().await;
    guard.consecutive_failures = guard.consecutive_failures.saturating_add(1);
    if guard.consecutive_failures < EVM_RPC_BREAKER_THRESHOLD {
        return;
    }

    let backoff = evm_breaker_backoff_duration(guard.consecutive_failures);
    guard.open_until = Some(Instant::now() + backoff);
    tracing::warn!(
        "{} transient EVM RPC failure triggered circuit backoff={}s failures={}",
        method,
        backoff.as_secs(),
        guard.consecutive_failures
    );
}

// Internal helper that supports `onchain_balance_fetch_lock_for` operations.
async fn onchain_balance_fetch_lock_for(key: &str) -> Arc<tokio::sync::Mutex<()>> {
    let locks = onchain_balance_fetch_locks();
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

    if guard.len() > ONCHAIN_BALANCE_CACHE_MAX_ENTRIES {
        let cache = onchain_balance_cache();
        let cache_guard = cache.read().await;
        guard.retain(|cache_key, _| cache_guard.contains_key(cache_key));
    }
    lock
}

// Internal helper that parses or transforms values for `normalize_cache_part`.
fn normalize_cache_part(value: Option<&str>) -> String {
    value
        .map(|v| v.trim().to_ascii_lowercase())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "-".to_string())
}

// Internal helper that supports `onchain_balance_cache_key` operations.
fn onchain_balance_cache_key(
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

// Internal helper that supports `onchain_response_has_data` operations.
fn onchain_response_has_data(value: &OnchainBalanceResponse) -> bool {
    value.strk_l2.is_some()
        || value.strk_l1.is_some()
        || value.eth.is_some()
        || value.btc.is_some()
        || value.carel.is_some()
        || value.usdc.is_some()
        || value.usdt.is_some()
        || value.wbtc.is_some()
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

// Internal helper that supports `prefer_portfolio_onchain_fallback` operations.
fn prefer_portfolio_onchain_fallback(
    field: &str,
    current: Option<f64>,
    portfolio_cached: Option<f64>,
) -> Option<f64> {
    let Some(cached) = portfolio_cached else {
        return current;
    };
    if !cached.is_finite() || cached <= 0.0 {
        return current;
    }

    match current {
        None => {
            tracing::debug!("wallet {} using cached fallback value={}", field, cached);
            Some(cached)
        }
        Some(value) if value.is_finite() && value <= 0.0 => {
            tracing::debug!(
                "wallet {} replacing non-positive value {} with cached fallback {}",
                field,
                value,
                cached
            );
            Some(cached)
        }
        Some(value) => Some(value),
    }
}

// Internal helper that fetches data for `get_cached_onchain_balance`.
async fn get_cached_onchain_balance(
    key: &str,
    max_age: Duration,
) -> Option<OnchainBalanceResponse> {
    let cache = onchain_balance_cache();
    let guard = cache.read().await;
    let entry = guard.get(key)?;
    if entry.fetched_at.elapsed() <= max_age {
        return Some(entry.value.clone());
    }
    None
}

// Internal helper that supports `cache_onchain_balance` operations.
async fn cache_onchain_balance(key: String, value: OnchainBalanceResponse) {
    let cache = onchain_balance_cache();
    let mut guard = cache.write().await;
    guard.insert(
        key,
        CachedOnchainBalance {
            fetched_at: Instant::now(),
            value,
        },
    );
    if guard.len() > ONCHAIN_BALANCE_CACHE_MAX_ENTRIES {
        let stale_after = Duration::from_secs(ONCHAIN_BALANCE_CACHE_STALE_SECS);
        guard.retain(|_, entry| entry.fetched_at.elapsed() <= stale_after);
    }
}

/// POST /api/v1/wallet/onchain-balances
pub async fn get_onchain_balances(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<OnchainBalanceRequest>,
) -> Result<Json<ApiResponse<OnchainBalanceResponse>>> {
    let user_address = require_user(&headers, &state).await?;
    let linked_wallets = state
        .db
        .list_wallet_addresses(&user_address)
        .await
        .unwrap_or_default();
    let mut portfolio_scope_addresses = vec![user_address.clone()];
    for linked in &linked_wallets {
        let candidate = linked.wallet_address.trim();
        if candidate.is_empty() {
            continue;
        }
        if portfolio_scope_addresses
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(candidate))
        {
            continue;
        }
        portfolio_scope_addresses.push(candidate.to_string());
    }

    let starknet_address = req.starknet_address.or_else(|| {
        linked_wallets
            .iter()
            .find(|item| item.chain == "starknet")
            .map(|item| item.wallet_address.clone())
    });
    let evm_address = req.evm_address.or_else(|| {
        linked_wallets
            .iter()
            .find(|item| item.chain == "evm")
            .map(|item| item.wallet_address.clone())
    });
    let btc_address = req.btc_address.or_else(|| {
        linked_wallets
            .iter()
            .find(|item| item.chain == "bitcoin")
            .map(|item| item.wallet_address.clone())
    });
    let force_refresh = req.force.unwrap_or(false);
    let cache_key = onchain_balance_cache_key(
        &user_address,
        starknet_address.as_deref(),
        evm_address.as_deref(),
        btc_address.as_deref(),
    );
    if !force_refresh {
        if let Some(cached) = get_cached_onchain_balance(
            &cache_key,
            Duration::from_secs(ONCHAIN_BALANCE_CACHE_TTL_SECS),
        )
        .await
        {
            return Ok(Json(ApiResponse::success(cached)));
        }
    }

    let fetch_lock = onchain_balance_fetch_lock_for(&cache_key).await;
    let _guard = fetch_lock.lock().await;
    if !force_refresh {
        if let Some(cached) = get_cached_onchain_balance(
            &cache_key,
            Duration::from_secs(ONCHAIN_BALANCE_CACHE_TTL_SECS),
        )
        .await
        {
            return Ok(Json(ApiResponse::success(cached)));
        }
    }

    let strk_token = resolve_starknet_token_address(&state.config, "STRK");
    let carel_token = resolve_starknet_token_address(&state.config, "CAREL");
    let usdc_token = resolve_starknet_token_address(&state.config, "USDC");
    let usdt_token = resolve_starknet_token_address(&state.config, "USDT");
    let wbtc_token = resolve_starknet_token_address(&state.config, "WBTC");

    let starknet_batch_fut = async {
        match starknet_address.as_deref() {
            Some(addr) => {
                let mut pairs: Vec<(String, String)> = Vec::new();
                if let Some(token) = strk_token.as_deref() {
                    pairs.push(("STRK".to_string(), token.to_string()));
                }
                if let Some(token) = carel_token.as_deref() {
                    pairs.push(("CAREL".to_string(), token.to_string()));
                }
                if let Some(token) = usdc_token.as_deref() {
                    pairs.push(("USDC".to_string(), token.to_string()));
                }
                if let Some(token) = usdt_token.as_deref() {
                    pairs.push(("USDT".to_string(), token.to_string()));
                }
                if let Some(token) = wbtc_token.as_deref() {
                    pairs.push(("WBTC".to_string(), token.to_string()));
                }
                if pairs.is_empty() {
                    return (None, false);
                }
                match tokio::time::timeout(
                    Duration::from_secs(ONCHAIN_BALANCE_TIMEOUT_SECS),
                    fetch_starknet_erc20_balances_batch(&state.config, addr, &pairs),
                )
                .await
                {
                    Ok(Ok(map)) => (Some(map), false),
                    Ok(Err(err)) => {
                        tracing::warn!("wallet starknet batch balance failed: {}", err);
                        (None, true)
                    }
                    Err(_) => {
                        tracing::debug!(
                            "wallet starknet batch balance timed out after {}s",
                            ONCHAIN_BALANCE_TIMEOUT_SECS
                        );
                        (None, true)
                    }
                }
            }
            None => (None, false),
        }
    };
    let eth_fut = async {
        match evm_address.as_deref() {
            Some(evm_addr) => {
                fetch_optional_balance_with_timeout(
                    "wallet evm ETH",
                    fetch_evm_native_balance(&state.config, evm_addr),
                )
                .await
            }
            None => None,
        }
    };
    let strk_l1_fut = async {
        match (
            evm_address.as_deref(),
            state.config.token_strk_l1_address.as_deref(),
        ) {
            (Some(evm_addr), Some(token)) => {
                fetch_optional_balance_with_timeout(
                    "wallet evm STRK",
                    fetch_evm_erc20_balance(&state.config, evm_addr, token),
                )
                .await
            }
            _ => None,
        }
    };
    let btc_fut = async {
        match btc_address.as_deref() {
            Some(btc_addr) => {
                fetch_optional_balance_with_timeout(
                    "wallet bitcoin BTC",
                    fetch_btc_balance(&state.config, btc_addr),
                )
                .await
            }
            None => None,
        }
    };

    let ((starknet_batch, starknet_batch_had_issue), eth, strk_l1, btc) =
        tokio::join!(starknet_batch_fut, eth_fut, strk_l1_fut, btc_fut);

    let mut strk_l2 = starknet_batch
        .as_ref()
        .and_then(|map| map.get("STRK").copied().flatten());
    let mut carel = starknet_batch
        .as_ref()
        .and_then(|map| map.get("CAREL").copied().flatten());
    let mut usdc = starknet_batch
        .as_ref()
        .and_then(|map| map.get("USDC").copied().flatten());
    let mut usdt = starknet_batch
        .as_ref()
        .and_then(|map| map.get("USDT").copied().flatten());
    let mut wbtc = starknet_batch
        .as_ref()
        .and_then(|map| map.get("WBTC").copied().flatten());
    let mut strk_l2_had_issue = starknet_batch_had_issue && starknet_address.is_some();
    let mut carel_had_issue = starknet_batch_had_issue && starknet_address.is_some();
    let mut usdc_had_issue = starknet_batch_had_issue && starknet_address.is_some();
    let mut usdt_had_issue = starknet_batch_had_issue && starknet_address.is_some();
    let mut wbtc_had_issue = starknet_batch_had_issue && starknet_address.is_some();

    if strk_l2.is_none() {
        strk_l2_had_issue = true;
        if let (Some(addr), Some(token)) = (starknet_address.as_deref(), strk_token.as_deref()) {
            strk_l2 = fetch_optional_balance_with_timeout(
                "wallet starknet STRK fallback",
                fetch_starknet_erc20_balance(&state.config, addr, token),
            )
            .await;
        }
    }
    if carel.is_none() {
        carel_had_issue = true;
        if let (Some(addr), Some(token)) = (starknet_address.as_deref(), carel_token.as_deref()) {
            carel = fetch_optional_balance_with_timeout(
                "wallet starknet CAREL fallback",
                fetch_starknet_erc20_balance(&state.config, addr, token),
            )
            .await;
        }
    }
    if usdc.is_none() {
        usdc_had_issue = true;
        if let (Some(addr), Some(token)) = (starknet_address.as_deref(), usdc_token.as_deref()) {
            usdc = fetch_optional_balance_with_timeout(
                "wallet starknet USDC fallback",
                fetch_starknet_erc20_balance(&state.config, addr, token),
            )
            .await;
        }
    }
    if usdt.is_none() {
        usdt_had_issue = true;
        if let (Some(addr), Some(token)) = (starknet_address.as_deref(), usdt_token.as_deref()) {
            usdt = fetch_optional_balance_with_timeout(
                "wallet starknet USDT fallback",
                fetch_starknet_erc20_balance(&state.config, addr, token),
            )
            .await;
        }
    }
    if wbtc.is_none() {
        wbtc_had_issue = true;
        if let (Some(addr), Some(token)) = (starknet_address.as_deref(), wbtc_token.as_deref()) {
            wbtc = fetch_optional_balance_with_timeout(
                "wallet starknet WBTC fallback",
                fetch_starknet_erc20_balance(&state.config, addr, token),
            )
            .await;
        }
    }
    if starknet_address.is_some() {
        let portfolio_onchain = get_cached_onchain_holdings_for_scope(
            &state,
            &user_address,
            starknet_address.as_deref(),
            evm_address.as_deref(),
            btc_address.as_deref(),
        )
        .await;
        let fallback_for = |symbol: &str| {
            portfolio_onchain
                .as_ref()
                .and_then(|holdings| holdings.get(symbol).copied())
        };
        let strk_l2_fallback = if evm_address.is_none() {
            fallback_for("STRK")
        } else {
            None
        };
        strk_l2 = prefer_portfolio_onchain_fallback("STRK_L2", strk_l2, strk_l2_fallback);
        carel = prefer_portfolio_onchain_fallback("CAREL", carel, fallback_for("CAREL"));
        usdc = prefer_portfolio_onchain_fallback("USDC", usdc, fallback_for("USDC"));
        usdt = prefer_portfolio_onchain_fallback("USDT", usdt, fallback_for("USDT"));
        wbtc = prefer_portfolio_onchain_fallback("WBTC", wbtc, fallback_for("WBTC"));

        let portfolio_balance_fallback = get_cached_portfolio_balance_amounts_for_scope(
            &user_address,
            &portfolio_scope_addresses,
        )
        .await;
        let fallback_balance_for = |symbol: &str| {
            portfolio_balance_fallback
                .as_ref()
                .and_then(|balances| balances.get(symbol).copied())
        };
        if strk_l2_had_issue {
            let strk_l2_balance_fallback = if evm_address.is_none() {
                fallback_balance_for("STRK")
            } else {
                None
            };
            strk_l2 =
                prefer_portfolio_onchain_fallback("STRK_L2", strk_l2, strk_l2_balance_fallback);
        }
        if carel_had_issue {
            carel =
                prefer_portfolio_onchain_fallback("CAREL", carel, fallback_balance_for("CAREL"));
        }
        if usdc_had_issue {
            usdc = prefer_portfolio_onchain_fallback("USDC", usdc, fallback_balance_for("USDC"));
        }
        if usdt_had_issue {
            usdt = prefer_portfolio_onchain_fallback("USDT", usdt, fallback_balance_for("USDT"));
        }
        if wbtc_had_issue {
            wbtc = prefer_portfolio_onchain_fallback("WBTC", wbtc, fallback_balance_for("WBTC"));
        }
    }

    let response = OnchainBalanceResponse {
        strk_l2,
        strk_l1,
        eth,
        btc,
        carel,
        usdc,
        usdt,
        wbtc,
    };

    if !onchain_response_has_data(&response) {
        if let Some(cached) = get_cached_onchain_balance(
            &cache_key,
            Duration::from_secs(ONCHAIN_BALANCE_CACHE_STALE_SECS),
        )
        .await
        {
            tracing::debug!(
                "wallet onchain balances returning stale cache fallback for key={}",
                cache_key
            );
            return Ok(Json(ApiResponse::success(cached)));
        }
    }

    cache_onchain_balance(cache_key, response.clone()).await;

    Ok(Json(ApiResponse::success(response)))
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
                tracing::debug!("{} transient fetch issue: {}", label, err_text);
            } else {
                tracing::warn!("{} fetch failed: {}", label, err_text);
            }
            None
        }
        Err(_) => {
            tracing::debug!(
                "{} fetch timed out after {}s",
                label,
                ONCHAIN_BALANCE_TIMEOUT_SECS
            );
            None
        }
    }
}

/// POST /api/v1/wallet/link
pub async fn link_wallet_address(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<LinkWalletAddressRequest>,
) -> Result<Json<ApiResponse<LinkWalletAddressResponse>>> {
    let user_address = require_user(&headers, &state).await?;
    let chain = normalize_wallet_chain(&req.chain)
        .ok_or_else(|| AppError::BadRequest("Unsupported wallet chain".to_string()))?;
    let wallet_address = req.address.trim();
    if wallet_address.is_empty() {
        return Err(AppError::BadRequest(
            "Wallet address is required".to_string(),
        ));
    }
    validate_link_wallet_address(chain, wallet_address)?;

    state
        .db
        .upsert_wallet_address(
            &user_address,
            chain,
            wallet_address,
            req.provider.as_deref(),
        )
        .await?;

    Ok(Json(ApiResponse::success(LinkWalletAddressResponse {
        user_address,
        chain: chain.to_string(),
        address: wallet_address.to_string(),
    })))
}

/// GET /api/v1/wallet/linked
pub async fn get_linked_wallets(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<LinkedWalletsResponse>>> {
    let user_address = require_user(&headers, &state).await?;
    let linked_wallets = state.db.list_wallet_addresses(&user_address).await?;

    let mut response = LinkedWalletsResponse::default();
    for linked in linked_wallets {
        match linked.chain.as_str() {
            "starknet" => response.starknet_address = Some(linked.wallet_address),
            "evm" => response.evm_address = Some(linked.wallet_address),
            "bitcoin" => response.btc_address = Some(linked.wallet_address),
            _ => {}
        }
    }

    Ok(Json(ApiResponse::success(response)))
}

// Internal helper that parses or transforms values for `normalize_wallet_chain`.
fn normalize_wallet_chain(chain: &str) -> Option<&'static str> {
    match chain.trim().to_ascii_lowercase().as_str() {
        "starknet" | "strk" => Some("starknet"),
        "evm" | "ethereum" | "eth" => Some("evm"),
        "bitcoin" | "btc" => Some("bitcoin"),
        _ => None,
    }
}

// Internal helper that checks conditions for `is_valid_evm_address`.
fn is_valid_evm_address(value: &str) -> bool {
    let normalized = value.trim();
    normalized.starts_with("0x")
        && normalized.len() == 42
        && normalized[2..].chars().all(|c| c.is_ascii_hexdigit())
}

// Internal helper that supports `looks_like_btc_address` operations.
fn looks_like_btc_address(value: &str) -> bool {
    let normalized = value.trim();
    if normalized.len() < 14 || normalized.len() > 90 {
        return false;
    }
    let lower = normalized.to_ascii_lowercase();
    lower.starts_with("bc1")
        || lower.starts_with("tb1")
        || lower.starts_with('1')
        || lower.starts_with('3')
        || lower.starts_with('m')
        || lower.starts_with('n')
        || lower.starts_with('2')
}

// Internal helper that supports `validate_link_wallet_address` operations.
fn validate_link_wallet_address(chain: &str, wallet_address: &str) -> Result<()> {
    let is_valid = match chain {
        "starknet" => parse_felt(wallet_address).is_ok(),
        "evm" => is_valid_evm_address(wallet_address),
        "bitcoin" => looks_like_btc_address(wallet_address),
        _ => false,
    };

    if is_valid {
        return Ok(());
    }

    let message = match chain {
        "starknet" => "Invalid Starknet wallet address format",
        "evm" => "Invalid EVM wallet address format (expected 0x + 40 hex chars)",
        "bitcoin" => "Invalid Bitcoin wallet address format",
        _ => "Invalid wallet address format",
    };
    Err(AppError::BadRequest(message.to_string()))
}

// Internal helper that supports `clean_address` operations.
fn clean_address(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty() && v != "0x..." && v != "0x0")
}

// Internal helper that supports `env_address` operations.
fn env_address(key: &str) -> Option<String> {
    clean_address(std::env::var(key).ok())
}

// Internal helper that supports `env_rpc_urls` operations.
fn env_rpc_urls(name: &str) -> Vec<String> {
    std::env::var(name)
        .ok()
        .map(|raw| {
            raw.split([',', ';', '\n', '\r', ' '])
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect::<Vec<String>>()
        })
        .unwrap_or_default()
}

// Internal helper that supports `wallet_rpc_urls` operations.
fn wallet_rpc_urls(config: &Config) -> Vec<String> {
    let mut urls = env_rpc_urls("STARKNET_WALLET_RPC_POOL");
    if urls.is_empty() {
        urls.extend(env_rpc_urls("STARKNET_WALLET_RPC_URL"));
    }
    if urls.is_empty() {
        urls.extend(env_rpc_urls("STARKNET_API_RPC_POOL"));
    }
    if urls.is_empty() {
        urls.extend(env_rpc_urls("STARKNET_API_RPC_URL"));
    }
    if urls.is_empty() {
        urls.extend(env_rpc_urls("STARKNET_RPC_POOL"));
    }
    if urls.is_empty() {
        urls.extend(env_rpc_urls("STARKNET_RPC_URL"));
    }
    if urls.is_empty() && !config.starknet_rpc_url.trim().is_empty() {
        urls.push(config.starknet_rpc_url.trim().to_string());
    }
    let mut deduped = Vec::new();
    for url in urls {
        if !deduped.iter().any(|existing| existing == &url) {
            deduped.push(url);
        }
    }
    deduped
}

// Internal helper that parses or transforms values for `normalize_felt_hex`.
fn normalize_felt_hex(value: &str) -> String {
    let trimmed = value.trim().to_ascii_lowercase();
    let without_prefix = trimmed.strip_prefix("0x").unwrap_or(trimmed.as_str());
    let normalized = without_prefix.trim_start_matches('0');
    if normalized.is_empty() {
        "0".to_string()
    } else {
        normalized.to_string()
    }
}

// Internal helper that supports `addresses_equal` operations.
fn addresses_equal(a: &str, b: &str) -> bool {
    normalize_felt_hex(a) == normalize_felt_hex(b)
}

// Internal helper that supports `known_starknet_token_decimals` operations.
fn known_starknet_token_decimals(config: &Config, token: &str) -> Option<u8> {
    let token_value = token.trim();
    if token_value.is_empty() {
        return None;
    }

    let known = [
        ("STRK", 18_u8),
        ("CAREL", 18_u8),
        ("USDC", 6_u8),
        ("USDT", 6_u8),
        ("WBTC", 8_u8),
    ];
    for (symbol, decimals) in known {
        if let Some(addr) = resolve_starknet_token_address(config, symbol) {
            if addresses_equal(token_value, &addr) {
                return Some(decimals);
            }
        }
    }
    None
}

/// Fetches data for `resolve_starknet_token_address`.
///
/// # Arguments
/// * Uses function parameters as validated input and runtime context.
///
/// # Returns
/// * `Ok(...)` when processing succeeds.
/// * `Err(AppError)` when validation, authorization, or integration checks fail.
///
/// # Notes
/// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
pub(crate) fn resolve_starknet_token_address(config: &Config, symbol: &str) -> Option<String> {
    match symbol.to_ascii_uppercase().as_str() {
        "STRK" => clean_address(config.token_strk_address.clone())
            .or_else(|| env_address("TOKEN_STRK_ADDRESS"))
            .or_else(|| token_address_for("STRK").map(str::to_string)),
        "CAREL" => clean_address(Some(config.carel_token_address.clone()))
            .or_else(|| env_address("TOKEN_CAREL_ADDRESS"))
            .or_else(|| env_address("NEXT_PUBLIC_TOKEN_CAREL_ADDRESS"))
            .or_else(|| token_address_for("CAREL").map(str::to_string)),
        "USDC" => env_address("TOKEN_USDC_ADDRESS")
            .or_else(|| env_address("NEXT_PUBLIC_TOKEN_USDC_ADDRESS"))
            .or_else(|| token_address_for("USDC").map(str::to_string)),
        "USDT" => env_address("TOKEN_USDT_ADDRESS")
            .or_else(|| env_address("NEXT_PUBLIC_TOKEN_USDT_ADDRESS"))
            .or_else(|| token_address_for("USDT").map(str::to_string)),
        "WBTC" | "BTC" => env_address("TOKEN_WBTC_ADDRESS")
            .or_else(|| env_address("TOKEN_BTC_ADDRESS"))
            .or_else(|| env_address("NEXT_PUBLIC_TOKEN_WBTC_ADDRESS"))
            .or_else(|| env_address("NEXT_PUBLIC_TOKEN_BTC_ADDRESS"))
            .or_else(|| token_address_for("WBTC").map(str::to_string)),
        _ => None,
    }
}

/// Fetches data for `fetch_starknet_erc20_balance`.
///
/// # Arguments
/// * Uses function parameters as validated input and runtime context.
///
/// # Returns
/// * `Ok(...)` when processing succeeds.
/// * `Err(AppError)` when validation, authorization, or integration checks fail.
///
/// # Notes
/// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
pub(crate) async fn fetch_starknet_erc20_balance(
    config: &Config,
    owner: &str,
    token: &str,
) -> Result<Option<f64>> {
    if token.trim().is_empty() || owner.trim().is_empty() {
        return Ok(None);
    }
    let reader = OnchainReader::from_config_for_wallet(config)?;
    let token_felt = parse_felt(token)?;
    let owner_felt = parse_felt(owner)?;
    let selector = get_selector_from_name("balanceOf")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let call = FunctionCall {
        contract_address: token_felt,
        entry_point_selector: selector,
        calldata: vec![owner_felt],
    };
    let values = match reader.call(call).await {
        Ok(v) => v,
        Err(AppError::BlockchainRPC(msg))
            if msg.contains("JsonRpcResponse")
                || msg.contains("unknown block tag 'pre_confirmed'")
                || msg.contains("Invalid Params") =>
        {
            tracing::debug!(
                "Transient Starknet balance read issue: owner={} token={} err={}",
                owner,
                token,
                msg
            );
            return Ok(None);
        }
        Err(err) => return Err(err),
    };
    let low = values
        .first()
        .ok_or_else(|| AppError::Internal("Balance low missing".into()))?;
    let high = values
        .get(1)
        .ok_or_else(|| AppError::Internal("Balance high missing".into()))?;
    let raw = u256_from_felts(low, high)?;
    let decimals = match known_starknet_token_decimals(config, token) {
        Some(value) => value,
        None => fetch_starknet_decimals(config, token).await.unwrap_or(18),
    };
    Ok(Some(scale_u128(raw, decimals)))
}

/// Fetches data for `fetch_starknet_erc20_balances_batch`.
///
/// # Arguments
/// * Uses function parameters as validated input and runtime context.
///
/// # Returns
/// * `Ok(...)` when processing succeeds.
/// * `Err(AppError)` when validation, authorization, or integration checks fail.
///
/// # Notes
/// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
pub(crate) async fn fetch_starknet_erc20_balances_batch(
    config: &Config,
    owner: &str,
    symbol_token_pairs: &[(String, String)],
) -> Result<HashMap<String, Option<f64>>> {
    let mut out: HashMap<String, Option<f64>> = HashMap::new();
    if owner.trim().is_empty() || symbol_token_pairs.is_empty() {
        return Ok(out);
    }

    let owner_felt = parse_felt(owner)?;
    let owner_hex = format!("{:#x}", owner_felt);
    let normalized_pairs: Vec<(String, String)> = symbol_token_pairs
        .iter()
        .filter_map(|(symbol, token)| {
            let trimmed = token.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some((symbol.clone(), trimmed.to_string()))
            }
        })
        .collect();
    let calls: Vec<ContractBatchCall> = normalized_pairs
        .iter()
        .map(|(_, token)| ContractBatchCall {
            contract_address: token.clone(),
            function: "balanceOf".to_string(),
            calldata: vec![owner_hex.clone()],
        })
        .collect();

    if calls.is_empty() {
        return Ok(out);
    }

    let client = StarknetClient::new_with_urls(wallet_rpc_urls(config));
    let batch_values = client.call_contract_batch(calls).await?;
    for (index, result) in batch_values.iter().enumerate() {
        let Some((symbol, token)) = normalized_pairs.get(index) else {
            continue;
        };
        if result.len() < 2 {
            out.insert(symbol.clone(), None);
            continue;
        }
        let low = parse_felt(&result[0]);
        let high = parse_felt(&result[1]);
        let amount = match (low, high) {
            (Ok(low), Ok(high)) => u256_from_felts(&low, &high).ok(),
            _ => None,
        };
        if let Some(raw) = amount {
            let decimals = known_starknet_token_decimals(config, token).unwrap_or({
                match symbol.as_str() {
                    "USDC" | "USDT" => 6,
                    "WBTC" => 8,
                    _ => 18,
                }
            });
            out.insert(symbol.clone(), Some(scale_u128(raw, decimals)));
        } else {
            out.insert(symbol.clone(), None);
        }
    }
    Ok(out)
}

/// Fetches data for `fetch_starknet_decimals`.
///
/// # Arguments
/// * Uses function parameters as validated input and runtime context.
///
/// # Returns
/// * `Ok(...)` when processing succeeds.
/// * `Err(AppError)` when validation, authorization, or integration checks fail.
///
/// # Notes
/// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
pub(crate) async fn fetch_starknet_decimals(config: &Config, token: &str) -> Result<u8> {
    let reader = OnchainReader::from_config_for_wallet(config)?;
    let token_felt = parse_felt(token)?;
    let selector = get_selector_from_name("decimals")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let call = FunctionCall {
        contract_address: token_felt,
        entry_point_selector: selector,
        calldata: vec![],
    };
    let values = reader.call(call).await?;
    let value = values
        .first()
        .ok_or_else(|| AppError::Internal("Decimals missing".into()))?;
    let raw = value.to_string();
    let parsed = if let Some(hex) = raw.strip_prefix("0x") {
        u8::from_str_radix(hex, 16).unwrap_or(18)
    } else {
        raw.parse::<u8>().unwrap_or(18)
    };
    Ok(parsed)
}

/// Fetches data for `fetch_evm_native_balance`.
///
/// # Arguments
/// * Uses function parameters as validated input and runtime context.
///
/// # Returns
/// * `Ok(...)` when processing succeeds.
/// * `Err(AppError)` when validation, authorization, or integration checks fail.
///
/// # Notes
/// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
pub(crate) async fn fetch_evm_native_balance(
    config: &Config,
    address: &str,
) -> Result<Option<f64>> {
    if address.trim().is_empty() {
        return Ok(None);
    }
    let _permit = evm_rpc_preflight("evm_getBalance").await?;
    let provider = Provider::<Http>::try_from(&config.ethereum_rpc_url)
        .map_err(|e| AppError::Internal(format!("Invalid EVM RPC URL: {}", e)))?;
    let provider = Arc::new(provider);
    let addr = Address::from_str(address)
        .map_err(|_| AppError::BadRequest("Invalid EVM address".to_string()))?;
    let response = provider
        .get_balance(addr, None)
        .await
        .map_err(|e| AppError::BlockchainRPC(e.to_string()));
    match &response {
        Ok(_) => evm_rpc_record_success().await,
        Err(AppError::BlockchainRPC(err_text)) => {
            evm_rpc_record_failure("evm_getBalance", err_text).await;
        }
        Err(_) => {}
    }
    let balance = response?;
    Ok(Some(scale_u256(balance, 18)))
}

/// Fetches data for `fetch_evm_erc20_balance`.
///
/// # Arguments
/// * Uses function parameters as validated input and runtime context.
///
/// # Returns
/// * `Ok(...)` when processing succeeds.
/// * `Err(AppError)` when validation, authorization, or integration checks fail.
///
/// # Notes
/// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
pub(crate) async fn fetch_evm_erc20_balance(
    config: &Config,
    address: &str,
    token: &str,
) -> Result<Option<f64>> {
    if token.trim().is_empty() || address.trim().is_empty() {
        return Ok(None);
    }
    let _permit = evm_rpc_preflight("evm_erc20_balanceOf").await?;
    let provider = Provider::<Http>::try_from(&config.ethereum_rpc_url)
        .map_err(|e| AppError::Internal(format!("Invalid EVM RPC URL: {}", e)))?;
    let provider = Arc::new(provider);
    let addr = Address::from_str(address)
        .map_err(|_| AppError::BadRequest("Invalid EVM address".to_string()))?;
    let token_addr = Address::from_str(token)
        .map_err(|_| AppError::BadRequest("Invalid ERC20 address".to_string()))?;
    let erc20 = Erc20::new(token_addr, provider.clone());
    let balance_response = erc20
        .balance_of(addr)
        .call()
        .await
        .map_err(|e| AppError::BlockchainRPC(e.to_string()));
    match &balance_response {
        Ok(_) => evm_rpc_record_success().await,
        Err(AppError::BlockchainRPC(err_text)) => {
            evm_rpc_record_failure("evm_erc20_balanceOf", err_text).await;
        }
        Err(_) => {}
    }
    let balance = balance_response?;
    let decimals = erc20.decimals().call().await.unwrap_or(18);
    Ok(Some(scale_u256(balance, decimals)))
}

/// Fetches data for `fetch_btc_balance`.
///
/// # Arguments
/// * Uses function parameters as validated input and runtime context.
///
/// # Returns
/// * `Ok(...)` when processing succeeds.
/// * `Err(AppError)` when validation, authorization, or integration checks fail.
///
/// # Notes
/// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
pub(crate) async fn fetch_btc_balance(config: &Config, address: &str) -> Result<Option<f64>> {
    if address.trim().is_empty() {
        return Ok(None);
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(BTC_BALANCE_SOURCE_TIMEOUT_SECS))
        .build()
        .map_err(|e| AppError::Internal(format!("Failed to build HTTP client: {}", e)))?;

    let unisat_api_key = std::env::var("UNISAT_API_KEY").ok();
    let xverse_api_url = config.xverse_api_url.trim().to_string();
    let xverse_api_key = config.xverse_api_key.clone();
    let blockstream_enabled = env_flag("BTC_BALANCE_ENABLE_BLOCKSTREAM_TESTNET", false);

    let source_priority = if config.is_testnet() {
        let (
            unisat_testnet4,
            unisat_testnet,
            mempool_testnet4,
            mempool_testnet,
            blockstream_testnet,
            xverse,
        ) = tokio::join!(
            fetch_btc_balance_from_unisat(
                &client,
                "https://open-api-testnet4.unisat.io",
                unisat_api_key.as_deref(),
                address
            ),
            fetch_btc_balance_from_unisat(
                &client,
                "https://open-api-testnet.unisat.io",
                unisat_api_key.as_deref(),
                address
            ),
            fetch_btc_balance_from_mempool(&client, "https://mempool.space/testnet4", address),
            fetch_btc_balance_from_mempool(&client, "https://mempool.space/testnet", address),
            async {
                if blockstream_enabled {
                    fetch_btc_balance_from_mempool(
                        &client,
                        "https://blockstream.info/testnet",
                        address,
                    )
                    .await
                } else {
                    None
                }
            },
            fetch_btc_balance_from_xverse(
                &client,
                &xverse_api_url,
                xverse_api_key.as_deref(),
                address
            )
        );
        vec![
            ("unisat_testnet4", unisat_testnet4),
            ("unisat_testnet", unisat_testnet),
            ("mempool_testnet4", mempool_testnet4),
            ("mempool_testnet", mempool_testnet),
            ("blockstream_testnet", blockstream_testnet),
            ("xverse", xverse),
        ]
    } else {
        let (unisat_mainnet, xverse) = tokio::join!(
            fetch_btc_balance_from_unisat(
                &client,
                "https://open-api.unisat.io",
                unisat_api_key.as_deref(),
                address
            ),
            fetch_btc_balance_from_xverse(
                &client,
                &xverse_api_url,
                xverse_api_key.as_deref(),
                address
            )
        );
        vec![("unisat_mainnet", unisat_mainnet), ("xverse", xverse)]
    };

    for (source, candidate) in source_priority {
        if let Some(balance) = candidate {
            tracing::debug!("BTC balance resolved from {} for {}", source, address);
            return Ok(Some(balance));
        }
    }

    tracing::debug!("BTC balance unavailable from all sources for {}", address);
    Ok(None)
}

// Internal helper that fetches data for `fetch_btc_balance_from_unisat`.
async fn fetch_btc_balance_from_unisat(
    client: &reqwest::Client,
    base_url: &str,
    api_key: Option<&str>,
    address: &str,
) -> Option<f64> {
    if base_url.trim().is_empty() {
        return None;
    }
    let url = format!(
        "{}/v1/indexer/address/{}/balance",
        base_url.trim_end_matches('/'),
        address
    );
    let mut req = client.get(url);
    if let Some(key) = api_key.filter(|key| !key.trim().is_empty()) {
        req = req.bearer_auth(key);
    }
    let response = req.send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let payload = response.json::<serde_json::Value>().await.ok()?;
    if payload.get("code").and_then(|v| v.as_i64()) != Some(0) {
        return None;
    }
    let data = payload.get("data")?;
    let confirmed_sats = data
        .get("btcSatoshi")
        .or_else(|| data.get("satoshi"))
        .and_then(json_as_f64)?;
    let pending_sats = data
        .get("btcPendingSatoshi")
        .or_else(|| data.get("pendingSatoshi"))
        .and_then(json_as_f64)
        .unwrap_or(0.0);
    let total_sats = (confirmed_sats + pending_sats).max(0.0);
    Some(total_sats / 100_000_000.0)
}

// Internal helper that fetches data for `fetch_btc_balance_from_xverse`.
async fn fetch_btc_balance_from_xverse(
    client: &reqwest::Client,
    base_url: &str,
    api_key: Option<&str>,
    address: &str,
) -> Option<f64> {
    if base_url.trim().is_empty() {
        return None;
    }
    let url = format!(
        "{}/address/{}/balance",
        base_url.trim_end_matches('/'),
        address
    );
    let mut req = client.get(url);
    if let Some(key) = api_key.filter(|key| !key.trim().is_empty()) {
        req = req.bearer_auth(key);
    }
    let response = req.send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let payload = response.json::<serde_json::Value>().await.ok()?;
    payload
        .get("balance")
        .or_else(|| payload.get("sats"))
        .or_else(|| payload.get("confirmed"))
        .or_else(|| payload.get("total"))
        .and_then(json_as_f64)
        .map(|sats| sats / 100_000_000.0)
}

// Internal helper that fetches data for `fetch_btc_balance_from_mempool`.
async fn fetch_btc_balance_from_mempool(
    client: &reqwest::Client,
    base_url: &str,
    address: &str,
) -> Option<f64> {
    let url = format!("{}/api/address/{}", base_url.trim_end_matches('/'), address);
    let response = client.get(url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let payload = response.json::<serde_json::Value>().await.ok()?;

    let chain_funded = payload
        .get("chain_stats")
        .and_then(|stats| stats.get("funded_txo_sum"))
        .and_then(json_as_f64);
    let chain_spent = payload
        .get("chain_stats")
        .and_then(|stats| stats.get("spent_txo_sum"))
        .and_then(json_as_f64);
    let mempool_funded = payload
        .get("mempool_stats")
        .and_then(|stats| stats.get("funded_txo_sum"))
        .and_then(json_as_f64);
    let mempool_spent = payload
        .get("mempool_stats")
        .and_then(|stats| stats.get("spent_txo_sum"))
        .and_then(json_as_f64);

    if let (Some(cf), Some(cs)) = (chain_funded, chain_spent) {
        let confirmed_sats = (cf - cs).max(0.0);
        let pending_sats = match (mempool_funded, mempool_spent) {
            (Some(mf), Some(ms)) => mf - ms,
            _ => 0.0,
        };
        let total_sats = (confirmed_sats + pending_sats).max(0.0);
        return Some(total_sats / 100_000_000.0);
    }

    payload
        .get("balance")
        .or_else(|| payload.get("sats"))
        .or_else(|| payload.get("confirmed"))
        .or_else(|| payload.get("total"))
        .and_then(json_as_f64)
        .map(|sats| sats / 100_000_000.0)
}

// Internal helper that supports `json_as_f64` operations.
fn json_as_f64(value: &serde_json::Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_i64().map(|v| v as f64))
        .or_else(|| value.as_u64().map(|v| v as f64))
}

// Internal helper that supports `env_flag` operations.
fn env_flag(name: &str, default: bool) -> bool {
    std::env::var(name)
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(default)
}

// Internal helper that parses or transforms values for `scale_u128`.
fn scale_u128(value: u128, decimals: u8) -> f64 {
    let base = 10_f64.powi(decimals as i32);
    (value as f64) / base
}

// Internal helper that parses or transforms values for `scale_u256`.
fn scale_u256(value: U256, decimals: u8) -> f64 {
    let base = 10_f64.powi(decimals as i32);
    let raw = value.as_u128() as f64;
    raw / base
}

ethers::contract::abigen!(
    Erc20,
    r#"[
        function balanceOf(address) view returns (uint256)
        function decimals() view returns (uint8)
    ]"#
);
