use crate::{
    config::Config,
    error::{AppError, Result},
    services::onchain::{
        felt_to_u128, parse_felt, u256_from_felts_u128, OnchainInvoker, OnchainReader,
    },
};
use starknet_core::types::{Call, FunctionCall};
use starknet_core::utils::get_selector_from_name;
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Instant;
use tokio::time::{timeout, Duration};

const DISCOUNT_READ_TIMEOUT_MS: u64 = 2_500;
const DISCOUNT_CONSUME_TIMEOUT_MS: u64 = 5_000;
const NFT_DISCOUNT_RATE_LIMIT_DEFAULT_WINDOW_SECS: u64 = 60;
const NFT_DISCOUNT_RATE_LIMIT_DEFAULT_MAX: u32 = 8;
const NFT_DISCOUNT_RATE_LIMIT_MAX_ENTRIES: usize = 50_000;

#[derive(Clone, Copy)]
struct NftRateLimitEntry {
    window_start: Instant,
    count: u32,
}

static NFT_DISCOUNT_RATE_LIMIT: OnceLock<tokio::sync::RwLock<HashMap<String, NftRateLimitEntry>>> =
    OnceLock::new();

// Internal helper that supports `nft_discount_rate_limit` operations.
fn nft_discount_rate_limit() -> &'static tokio::sync::RwLock<HashMap<String, NftRateLimitEntry>> {
    NFT_DISCOUNT_RATE_LIMIT.get_or_init(|| tokio::sync::RwLock::new(HashMap::new()))
}

// Internal helper that supports `nft_discount_rate_limit_config` operations.
fn nft_discount_rate_limit_config() -> (Duration, u32) {
    let window_secs = std::env::var("NFT_DISCOUNT_RATE_LIMIT_WINDOW_SECS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(NFT_DISCOUNT_RATE_LIMIT_DEFAULT_WINDOW_SECS);
    let max = std::env::var("NFT_DISCOUNT_RATE_LIMIT_MAX")
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(NFT_DISCOUNT_RATE_LIMIT_DEFAULT_MAX);
    (Duration::from_secs(window_secs), max)
}

// Internal helper that supports `enforce_nft_discount_rate_limit` operations.
async fn enforce_nft_discount_rate_limit(user_address: &str, action: &str) -> Result<()> {
    let (window, max) = nft_discount_rate_limit_config();
    if max == 0 {
        return Ok(());
    }

    let key = format!(
        "{}|{}",
        user_address.trim().to_ascii_lowercase(),
        action.trim().to_ascii_lowercase()
    );
    let now = Instant::now();
    let cache = nft_discount_rate_limit();
    let mut guard = cache.write().await;
    let entry = guard.entry(key).or_insert(NftRateLimitEntry {
        window_start: now,
        count: 0,
    });

    if now.duration_since(entry.window_start) > window {
        entry.window_start = now;
        entry.count = 0;
    }

    if entry.count >= max {
        return Err(AppError::RateLimitExceeded);
    }
    entry.count = entry.count.saturating_add(1);

    if guard.len() > NFT_DISCOUNT_RATE_LIMIT_MAX_ENTRIES {
        guard.retain(|_, value| value.window_start.elapsed() <= window);
    }

    Ok(())
}

// Internal helper that supports `discount_contract` operations.
fn discount_contract(config: &Config) -> Option<&str> {
    config
        .discount_soulbound_address
        .as_deref()
        .filter(|addr| !addr.trim().is_empty() && !addr.starts_with("0x0000"))
}

// Internal helper that supports `active_discount_rate` operations.
async fn active_discount_rate(config: &Config, user_address: &str) -> Result<f64> {
    let Some(contract) = discount_contract(config) else {
        return Ok(0.0);
    };

    let reader = OnchainReader::from_config(config)?;
    let call = FunctionCall {
        contract_address: parse_felt(contract)?,
        entry_point_selector: get_selector_from_name("has_active_discount")
            .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?,
        calldata: vec![parse_felt(user_address)?],
    };

    let result = timeout(
        Duration::from_millis(DISCOUNT_READ_TIMEOUT_MS),
        reader.call(call),
    )
    .await
    .map_err(|_| AppError::BlockchainRPC("NFT discount read timeout".to_string()))??;

    if result.len() < 3 {
        return Ok(0.0);
    }
    let active = felt_to_u128(&result[0]).unwrap_or(0) > 0;
    if !active {
        return Ok(0.0);
    }

    let discount = u256_from_felts_u128(&result[1], &result[2]).unwrap_or(0) as f64;
    Ok(discount.max(0.0))
}

/// Reads active NFT discount percentage for a user from on-chain discount contract.
pub async fn read_active_discount_rate(config: &Config, user_address: &str) -> Result<f64> {
    active_discount_rate(config, user_address).await
}

// Internal helper that runs side-effecting logic for `consume_nft_usage_inner`.
async fn consume_nft_usage_inner(
    config: &Config,
    user_address: &str,
    action: &str,
) -> Result<Option<String>> {
    let Some(contract) = discount_contract(config) else {
        return Ok(None);
    };
    if parse_felt(user_address).is_err() {
        return Ok(None);
    }
    enforce_nft_discount_rate_limit(user_address, action).await?;

    let Some(invoker) = OnchainInvoker::from_config(config)? else {
        return Ok(None);
    };

    let call = Call {
        to: parse_felt(contract)?,
        selector: get_selector_from_name("use_discount")
            .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?,
        calldata: vec![parse_felt(user_address)?],
    };

    let tx_hash = timeout(
        Duration::from_millis(DISCOUNT_CONSUME_TIMEOUT_MS),
        invoker.invoke(call),
    )
    .await
    .map_err(|_| AppError::BlockchainRPC("NFT discount consume timeout".to_string()))??;
    let tx_hash_text = tx_hash.to_string();
    tracing::info!(
        "nft_discount_usage_consumed action={} user={} tx_hash={}",
        action,
        user_address,
        tx_hash_text
    );

    Ok(Some(tx_hash_text))
}

/// Consumes one NFT discount usage on-chain without re-reading discount metadata first.
pub async fn consume_nft_usage(
    config: &Config,
    user_address: &str,
    action: &str,
) -> Result<Option<String>> {
    consume_nft_usage_inner(config, user_address, action).await
}

/// Handles `consume_nft_usage_if_active` logic.
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
pub async fn consume_nft_usage_if_active(
    config: &Config,
    user_address: &str,
    action: &str,
) -> Result<Option<String>> {
    let active_discount = active_discount_rate(config, user_address).await?;
    if active_discount <= 0.0 {
        return Ok(None);
    }
    consume_nft_usage_inner(config, user_address, action).await
}
