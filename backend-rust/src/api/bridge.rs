use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Instant;

use crate::services::onchain::{
    felt_to_u128, parse_felt, u256_from_felts, OnchainInvoker, OnchainReader,
};
use crate::services::privacy_verifier::{
    parse_privacy_verifier_kind, resolve_privacy_router_for_verifier, PrivacyVerifierKind,
};
use crate::{
    constants::{
        token_address_for, BRIDGE_ATOMIQ, BRIDGE_GARDEN, BRIDGE_LAYERSWAP, BRIDGE_STARKGATE,
        EPOCH_DURATION_SECONDS, POINTS_MIN_USD_BRIDGE_BTC, POINTS_MIN_USD_BRIDGE_BTC_TESTNET,
        POINTS_MIN_USD_BRIDGE_ETH, POINTS_MIN_USD_BRIDGE_ETH_TESTNET, POINTS_PER_USD_BRIDGE_BTC,
        POINTS_PER_USD_BRIDGE_ETH,
    },
    // Mengimpor hasher untuk menghilangkan warning unused di crypto/hash.rs
    crypto::hash,
    error::Result,
    integrations::bridge::{
        AtomiqClient, AtomiqQuote, GardenClient, GardenEvmTransaction, GardenQuote,
        GardenStarknetTransaction, LayerSwapClient, LayerSwapQuote,
    },
    models::{ApiResponse, BridgeQuoteRequest, BridgeQuoteResponse, LinkedWalletAddress},
    services::nft_discount::consume_nft_usage,
    services::price_guard::{
        fallback_price_for, first_sane_price, sanitize_points_usd_base, sanitize_usd_notional,
        symbol_candidates_for,
    },
    services::RouteOptimizer,
};
use starknet_core::types::{Call, ExecutionResult, Felt, FunctionCall, TransactionFinalityStatus};
use starknet_core::utils::{get_selector_from_name, get_storage_var_address};
use tokio::time::{sleep, timeout, Duration};

use super::{require_starknet_user, require_user, AppState};

#[derive(Debug, Deserialize)]
pub struct PrivacyVerificationPayload {
    pub verifier: Option<String>,
    pub nullifier: Option<String>,
    pub commitment: Option<String>,
    pub proof: Option<Vec<String>>,
    pub public_inputs: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct ExecuteBridgeRequest {
    pub from_chain: String,
    pub to_chain: String,
    pub token: String,
    pub to_token: Option<String>,
    pub estimated_out_amount: Option<String>,
    pub amount: String,
    pub recipient: String,
    pub source_owner: Option<String>,
    pub existing_bridge_id: Option<String>,
    pub xverse_user_id: Option<String>,
    pub onchain_tx_hash: Option<String>,
    pub mode: Option<String>,
    pub hide_balance: Option<bool>,
    pub privacy: Option<PrivacyVerificationPayload>,
}

#[derive(Debug, Serialize)]
pub struct ExecuteBridgeResponse {
    pub bridge_id: String,
    pub status: String,
    pub from_chain: String,
    pub to_chain: String,
    pub amount: String,
    pub estimated_receive: String,
    pub estimated_time: String,
    pub fee_before_discount: String,
    pub fee_discount_saved: String,
    pub nft_discount_percent: String,
    pub estimated_points_earned: String,
    pub points_pending: bool,
    pub ai_level_points_bonus_percent: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub privacy_tx_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deposit_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deposit_amount: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evm_approval_transaction: Option<GardenEvmTransaction>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evm_initiate_transaction: Option<GardenEvmTransaction>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starknet_approval_transaction: Option<GardenStarknetTransaction>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starknet_initiate_transaction: Option<GardenStarknetTransaction>,
}

#[derive(Debug, Serialize)]
pub struct BridgeStatusResponse {
    pub bridge_id: String,
    pub status: String,
    pub is_completed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_initiate_tx_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_redeem_tx_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination_initiate_tx_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination_redeem_tx_hash: Option<String>,
}

const ONCHAIN_DISCOUNT_TIMEOUT_MS: u64 = 2_500;
const NFT_DISCOUNT_CACHE_TTL_SECS: u64 = 300;
const NFT_DISCOUNT_CACHE_STALE_SECS: u64 = 1_800;
const NFT_DISCOUNT_CACHE_MAX_ENTRIES: usize = 100_000;
const BRIDGE_MEV_FEE_RATE: f64 = 0.01;
const BRIDGE_AI_LEVEL_2_POINTS_BONUS_PERCENT: f64 = 2.0;
const BRIDGE_AI_LEVEL_3_POINTS_BONUS_PERCENT: f64 = 5.0;

// Internal helper that supports `canonical_bridge_chain` operations in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn canonical_bridge_chain(chain: &str) -> String {
    let lower = chain.trim().to_ascii_lowercase();
    if lower == "btc" || lower.contains("bitcoin") {
        return "bitcoin".to_string();
    }
    if lower == "eth" || lower == "evm" || lower.contains("ethereum") {
        return "ethereum".to_string();
    }
    if lower == "strk" || lower.contains("starknet") {
        return "starknet".to_string();
    }
    lower
}

#[derive(Clone, Copy)]
struct CachedNftDiscount {
    fetched_at: Instant,
    discount: f64,
}

static NFT_DISCOUNT_CACHE: OnceLock<tokio::sync::RwLock<HashMap<String, CachedNftDiscount>>> =
    OnceLock::new();

// Internal helper that supports `nft_discount_cache` operations in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn nft_discount_cache() -> &'static tokio::sync::RwLock<HashMap<String, CachedNftDiscount>> {
    NFT_DISCOUNT_CACHE.get_or_init(|| tokio::sync::RwLock::new(HashMap::new()))
}

// Internal helper that supports `nft_discount_cache_key` operations in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn nft_discount_cache_key(contract: &str, user: &str) -> String {
    format!(
        "{}|{}",
        contract.trim().to_ascii_lowercase(),
        user.trim().to_ascii_lowercase()
    )
}

// Internal helper that fetches data for `get_cached_nft_discount` in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn get_cached_nft_discount(key: &str, max_age: Duration) -> Option<f64> {
    let cache = nft_discount_cache();
    let guard = cache.read().await;
    let entry = guard.get(key)?;
    if entry.fetched_at.elapsed() <= max_age {
        return Some(entry.discount);
    }
    None
}

// Internal helper that supports `cache_nft_discount` operations in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn cache_nft_discount(key: &str, discount: f64) {
    let cache = nft_discount_cache();
    let mut guard = cache.write().await;
    guard.insert(
        key.to_string(),
        CachedNftDiscount {
            fetched_at: Instant::now(),
            discount,
        },
    );
    if guard.len() > NFT_DISCOUNT_CACHE_MAX_ENTRIES {
        let stale_after = Duration::from_secs(NFT_DISCOUNT_CACHE_STALE_SECS);
        guard.retain(|_, entry| entry.fetched_at.elapsed() <= stale_after);
    }
}

// Internal helper that supports `invalidate_cached_nft_discount` operations in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn invalidate_cached_nft_discount(contract: &str, user: &str) {
    let key = nft_discount_cache_key(contract, user);
    let cache = nft_discount_cache();
    let mut guard = cache.write().await;
    guard.remove(&key);
}

#[derive(Clone, Copy, Debug, Default)]
struct NftUsageSnapshot {
    tier: i32,
    discount_percent: f64,
    max_usage: u128,
    used_in_period: u128,
}

// Internal helper that supports `current_nft_period_epoch` operations in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn current_nft_period_epoch() -> i64 {
    chrono::Utc::now().timestamp() / EPOCH_DURATION_SECONDS
}

// Internal helper that supports `u128_to_i64_saturating` operations in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn u128_to_i64_saturating(value: u128) -> i64 {
    if value > i64::MAX as u128 {
        i64::MAX
    } else {
        value as i64
    }
}

// Internal helper that fetches data for `read_nft_usage_snapshot` in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn read_nft_usage_snapshot(
    reader: &OnchainReader,
    contract_address: Felt,
    user_felt: Felt,
) -> Result<Option<NftUsageSnapshot>> {
    let storage_key = get_storage_var_address("user_nft", &[user_felt]).map_err(|e| {
        crate::error::AppError::Internal(format!("Storage key resolution error: {}", e))
    })?;
    let token_raw = reader.get_storage_at(contract_address, storage_key).await?;
    let token_id = felt_to_u128(&token_raw).unwrap_or(0);
    if token_id == 0 {
        return Ok(None);
    }

    let info_call = FunctionCall {
        contract_address,
        entry_point_selector: get_selector_from_name("get_nft_info")
            .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?,
        calldata: vec![Felt::from(token_id), Felt::from(0_u8)],
    };
    let info = reader.call(info_call).await?;
    if info.len() < 7 {
        return Ok(None);
    }

    let tier = felt_to_u128(&info[0]).unwrap_or(0) as i32;
    let discount = u256_from_felts(&info[1], &info[2]).unwrap_or(0) as f64;
    let max_usage = u256_from_felts(&info[3], &info[4]).unwrap_or(0);
    let used_in_period = u256_from_felts(&info[5], &info[6]).unwrap_or(0);
    Ok(Some(NftUsageSnapshot {
        tier: tier.max(0),
        discount_percent: discount.clamp(0.0, 100.0),
        max_usage,
        used_in_period,
    }))
}

// Internal helper that supports `estimate_time` operations in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn estimate_time(provider: &str) -> &'static str {
    match provider {
        BRIDGE_LAYERSWAP => "~15-20 min",
        BRIDGE_STARKGATE => "~10-15 min",
        BRIDGE_ATOMIQ => "~20-30 min",
        BRIDGE_GARDEN => "~25-35 min",
        _ => "~15-20 min",
    }
}

// Internal helper that supports `bridge_ai_level_points_bonus_percent` operations in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn bridge_ai_level_points_bonus_percent(level: u8) -> f64 {
    match level {
        2 => BRIDGE_AI_LEVEL_2_POINTS_BONUS_PERCENT,
        3 => BRIDGE_AI_LEVEL_3_POINTS_BONUS_PERCENT,
        _ => 0.0,
    }
}

// Internal helper that supports `estimate_bridge_points_for_response` operations in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn estimate_bridge_points_for_response(
    volume_usd: f64,
    is_btc_bridge: bool,
    nft_discount_percent: f64,
    ai_level: u8,
    is_testnet: bool,
) -> f64 {
    let sanitized = sanitize_points_usd_base(volume_usd);
    let (min_threshold, per_usd_rate) = if is_btc_bridge {
        (
            if is_testnet {
                POINTS_MIN_USD_BRIDGE_BTC_TESTNET
            } else {
                POINTS_MIN_USD_BRIDGE_BTC
            },
            POINTS_PER_USD_BRIDGE_BTC,
        )
    } else {
        (
            if is_testnet {
                POINTS_MIN_USD_BRIDGE_ETH_TESTNET
            } else {
                POINTS_MIN_USD_BRIDGE_ETH
            },
            POINTS_PER_USD_BRIDGE_ETH,
        )
    };
    if sanitized < min_threshold {
        return 0.0;
    }
    let nft_factor = 1.0 + (nft_discount_percent.clamp(0.0, 100.0) / 100.0);
    let ai_factor = 1.0 + (bridge_ai_level_points_bonus_percent(ai_level) / 100.0);
    (sanitized * per_usd_rate * nft_factor * ai_factor).max(0.0)
}

// Internal helper that supports `discount_contract_address` operations in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn discount_contract_address(state: &AppState) -> Option<&str> {
    state
        .config
        .discount_soulbound_address
        .as_deref()
        .filter(|addr| !addr.trim().is_empty() && !addr.starts_with("0x0000"))
}

// Internal helper that supports `active_nft_discount_percent` operations in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn cached_nft_discount_from_local_state(state: &AppState, user_address: &str) -> f64 {
    let Some(contract) = discount_contract_address(state) else {
        return 0.0;
    };
    let cache_key = nft_discount_cache_key(contract, user_address);
    if let Some(cached) =
        get_cached_nft_discount(&cache_key, Duration::from_secs(NFT_DISCOUNT_CACHE_TTL_SECS)).await
    {
        return cached.max(0.0);
    }

    let period_epoch = current_nft_period_epoch();
    match state
        .db
        .get_nft_discount_state(contract, user_address, period_epoch)
        .await
    {
        Ok(Some(row)) => {
            let age_secs = chrono::Utc::now()
                .signed_duration_since(row.updated_at)
                .num_seconds()
                .max(0) as u64;
            if age_secs > NFT_DISCOUNT_CACHE_STALE_SECS {
                return 0.0;
            }
            let effective_used = row.local_used_in_period.max(row.chain_used_in_period);
            let has_remaining_usage = row.max_usage > 0 && effective_used < row.max_usage;
            let discount = if row.is_active && has_remaining_usage {
                row.discount_percent.clamp(0.0, 100.0)
            } else {
                0.0
            };
            cache_nft_discount(&cache_key, discount).await;
            discount
        }
        Ok(None) => 0.0,
        Err(err) => {
            tracing::warn!(
                "Failed to read local NFT discount state in bridge for user={}: {}",
                user_address,
                err
            );
            0.0
        }
    }
}

// Internal helper that supports `refresh_nft_discount_for_submit` operations in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn refresh_nft_discount_for_submit(state: &AppState, user_address: &str) -> f64 {
    let Some(contract) = discount_contract_address(state) else {
        return 0.0;
    };
    let cache_key = nft_discount_cache_key(contract, user_address);
    let period_epoch = current_nft_period_epoch();

    let reader = match OnchainReader::from_config(&state.config) {
        Ok(reader) => reader,
        Err(err) => {
            tracing::warn!(
                "Failed to initialize on-chain reader for NFT discount submit validation in bridge: {}",
                err
            );
            return cached_nft_discount_from_local_state(state, user_address).await;
        }
    };

    let contract_address = match parse_felt(contract) {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(
                "Invalid discount contract address while validating bridge fee discount: {}",
                err
            );
            return 0.0;
        }
    };
    let user_felt = match parse_felt(user_address) {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(
                "Invalid user address while validating bridge fee discount: user={}, err={}",
                user_address,
                err
            );
            return 0.0;
        }
    };

    let selector = match get_selector_from_name("has_active_discount") {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(
                "Selector resolution failed for has_active_discount in bridge submit validation: {}",
                err
            );
            return 0.0;
        }
    };

    let call = FunctionCall {
        contract_address,
        entry_point_selector: selector,
        calldata: vec![user_felt],
    };

    let result = match timeout(
        Duration::from_millis(ONCHAIN_DISCOUNT_TIMEOUT_MS),
        reader.call(call),
    )
    .await
    {
        Ok(Ok(value)) => value,
        Ok(Err(err)) => {
            tracing::warn!(
                "Failed on-chain NFT discount submit validation in bridge for user={}: {}. Falling back to local NFT discount state.",
                user_address,
                err
            );
            return cached_nft_discount_from_local_state(state, user_address).await;
        }
        Err(_) => {
            tracing::warn!(
                "Timeout on-chain NFT discount submit validation in bridge for user={}. Falling back to local NFT discount state.",
                user_address
            );
            return cached_nft_discount_from_local_state(state, user_address).await;
        }
    };
    if result.len() < 3 {
        tracing::warn!(
            "NFT discount submit validation returned malformed payload for user={}. Falling back to local NFT discount state.",
            user_address
        );
        return cached_nft_discount_from_local_state(state, user_address).await;
    }

    let chain_active = felt_to_u128(&result[0]).unwrap_or(0) > 0;
    let chain_discount = u256_from_felts(&result[1], &result[2]).unwrap_or(0) as f64;

    let usage_snapshot = match timeout(
        Duration::from_millis(ONCHAIN_DISCOUNT_TIMEOUT_MS),
        read_nft_usage_snapshot(&reader, contract_address, user_felt),
    )
    .await
    {
        Ok(Ok(value)) => value.unwrap_or_default(),
        Ok(Err(err)) => {
            tracing::warn!(
                "Failed to read NFT usage snapshot in bridge submit validation for user={}: {}. Falling back to local NFT discount state.",
                user_address,
                err
            );
            return cached_nft_discount_from_local_state(state, user_address).await;
        }
        Err(_) => {
            tracing::warn!(
                "Timeout reading NFT usage snapshot in bridge submit validation for user={}. Falling back to local NFT discount state.",
                user_address
            );
            return cached_nft_discount_from_local_state(state, user_address).await;
        }
    };

    let discount_percent = if chain_discount > 0.0 {
        chain_discount
    } else {
        usage_snapshot.discount_percent
    }
    .clamp(0.0, 100.0);
    let max_usage_i64 = u128_to_i64_saturating(usage_snapshot.max_usage);
    let chain_used_i64 = u128_to_i64_saturating(usage_snapshot.used_in_period);

    let db_row = state
        .db
        .upsert_nft_discount_state_from_chain(
            contract,
            user_address,
            period_epoch,
            usage_snapshot.tier.max(0),
            discount_percent,
            chain_active,
            max_usage_i64,
            chain_used_i64,
        )
        .await;

    let resolved_discount = match db_row {
        Ok(row) => {
            let effective_used = row.local_used_in_period.max(row.chain_used_in_period);
            let has_remaining_usage = row.max_usage > 0 && effective_used < row.max_usage;
            if row.is_active && has_remaining_usage {
                row.discount_percent.clamp(0.0, 100.0)
            } else {
                0.0
            }
        }
        Err(err) => {
            tracing::warn!(
                "Failed to persist NFT discount state in bridge for user={}: {}",
                user_address,
                err
            );
            let has_remaining_usage = usage_snapshot.max_usage > 0
                && usage_snapshot.used_in_period < usage_snapshot.max_usage;
            if chain_active && has_remaining_usage {
                discount_percent
            } else {
                0.0
            }
        }
    };

    cache_nft_discount(&cache_key, resolved_discount).await;
    resolved_discount
}

// Internal helper that runs side-effecting logic for `record_nft_discount_usage_after_submit` in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn record_nft_discount_usage_after_submit(state: &AppState, user_address: &str) {
    let Some(contract) = discount_contract_address(state) else {
        return;
    };
    let period_epoch = current_nft_period_epoch();
    match state
        .db
        .increment_nft_discount_local_usage(contract, user_address, period_epoch, 1)
        .await
    {
        Ok(updated_usage) => {
            tracing::debug!(
                "Recorded local NFT usage after bridge submit user={} period={} local_used={}",
                user_address,
                period_epoch,
                updated_usage
            );
        }
        Err(err) => {
            tracing::warn!(
                "Failed recording local NFT usage after bridge submit for user={}: {}",
                user_address,
                err
            );
        }
    }
    invalidate_cached_nft_discount(contract, user_address).await;
}

// Internal helper that supports `latest_price_usd` operations in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn latest_price_usd(state: &AppState, token: &str) -> Result<f64> {
    let symbol = token.to_ascii_uppercase();
    for candidate in symbol_candidates_for(&symbol) {
        let prices: Vec<f64> = sqlx::query_scalar(
            "SELECT close::FLOAT FROM price_history WHERE token = $1 ORDER BY timestamp DESC LIMIT 16",
        )
        .bind(&candidate)
        .fetch_all(state.db.pool())
        .await?;
        if let Some(sane) = first_sane_price(&candidate, &prices) {
            return Ok(sane);
        }
    }
    Ok(fallback_price_for(&symbol))
}

// Internal helper that builds inputs for `build_bridge_id` in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn build_bridge_id(tx_hash: &str) -> String {
    let short = tx_hash.strip_prefix("0x").unwrap_or(tx_hash);
    let suffix = if short.len() >= 12 {
        &short[..12]
    } else {
        short
    };
    format!("BR_{}", suffix)
}

// Internal helper that parses or transforms values for `normalize_bridge_onchain_tx_hash` in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn normalize_bridge_onchain_tx_hash(
    tx_hash: Option<&str>,
    from_chain: &str,
) -> std::result::Result<String, crate::error::AppError> {
    let from_chain_normalized = from_chain.trim().to_ascii_lowercase();
    let raw = if let Some(value) = tx_hash.map(str::trim).filter(|v| !v.is_empty()) {
        value.to_string()
    } else if from_chain_normalized == "bitcoin" || from_chain_normalized == "btc" {
        // Garden-style BTC flow creates order first, then user deposits to generated address.
        // Keep internal tx_hash field non-empty for DB correlation even before real BTC txid exists.
        return Ok(hex::encode(rand::random::<[u8; 32]>()));
    } else {
        return Err(crate::error::AppError::BadRequest(
            "Bridge requires onchain_tx_hash from user-signed transaction".to_string(),
        ));
    };
    let body = raw.strip_prefix("0x").unwrap_or(&raw);
    if body.is_empty() || body.len() > 64 || !body.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(crate::error::AppError::BadRequest(
            "onchain_tx_hash must be hex-encoded and max 64 chars (without 0x)".to_string(),
        ));
    }

    if from_chain_normalized == "bitcoin" || from_chain_normalized == "btc" {
        // Store BTC txid in explorer-friendly format (no 0x).
        return Ok(body.to_ascii_lowercase());
    }

    Ok(format!("0x{}", body.to_ascii_lowercase()))
}

// Internal helper that parses or transforms values for `parse_hex_u64` in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn parse_hex_u64(value: &str) -> Option<u64> {
    let body = value.trim().strip_prefix("0x").unwrap_or(value.trim());
    if body.is_empty() {
        return Some(0);
    }
    u64::from_str_radix(body, 16).ok()
}

// Internal helper that supports `verify_starknet_bridge_tx_hash` operations in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn verify_starknet_bridge_tx_hash(state: &AppState, tx_hash: &str) -> Result<i64> {
    let reader = OnchainReader::from_config(&state.config)?;
    let tx_hash_felt = parse_felt(tx_hash)?;
    let mut last_rpc_error = String::new();

    for attempt in 0..5 {
        match reader.get_transaction_receipt(&tx_hash_felt).await {
            Ok(receipt) => {
                if let ExecutionResult::Reverted { reason } = receipt.receipt.execution_result() {
                    return Err(crate::error::AppError::BadRequest(format!(
                        "onchain_tx_hash reverted on Starknet: {}",
                        reason
                    )));
                }
                if matches!(
                    receipt.receipt.finality_status(),
                    TransactionFinalityStatus::PreConfirmed
                ) {
                    last_rpc_error = "transaction still pre-confirmed".to_string();
                    if attempt < 4 {
                        sleep(Duration::from_millis(1000)).await;
                        continue;
                    }
                    break;
                }
                let block_number = receipt.block.block_number() as i64;
                tracing::info!(
                    "Verified Starknet bridge tx {} at block {} with finality {:?}",
                    tx_hash,
                    block_number,
                    receipt.receipt.finality_status()
                );
                return Ok(block_number);
            }
            Err(err) => {
                last_rpc_error = err.to_string();
                if attempt < 4 {
                    sleep(Duration::from_millis(1000)).await;
                }
            }
        }
    }

    Err(crate::error::AppError::BadRequest(format!(
        "onchain_tx_hash not found/confirmed on Starknet RPC: {}",
        last_rpc_error
    )))
}

// Internal helper that supports `verify_ethereum_bridge_tx_hash` operations in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn verify_ethereum_bridge_tx_hash(state: &AppState, tx_hash: &str) -> Result<i64> {
    let rpc_url = state.config.ethereum_rpc_url.trim();
    if rpc_url.is_empty() {
        return Err(crate::error::AppError::BadRequest(
            "ETHEREUM_RPC_URL is empty".to_string(),
        ));
    }

    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_getTransactionReceipt",
        "params": [tx_hash],
    });

    let client = reqwest::Client::new();
    let mut last_rpc_error = String::new();

    // Ethereum receipt can take a few blocks to appear. Retry to avoid false-negative "failed" UX.
    for attempt in 0..12 {
        let response = match client.post(rpc_url).json(&payload).send().await {
            Ok(value) => value,
            Err(err) => {
                last_rpc_error = format!("query error: {}", err);
                if attempt < 11 {
                    sleep(Duration::from_millis(1500)).await;
                    continue;
                }
                break;
            }
        };

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            last_rpc_error = format!("http {}: {}", status, body);
            if attempt < 11 {
                sleep(Duration::from_millis(1500)).await;
                continue;
            }
            break;
        }

        let body: serde_json::Value = match response.json().await {
            Ok(value) => value,
            Err(err) => {
                last_rpc_error = format!("parse error: {}", err);
                if attempt < 11 {
                    sleep(Duration::from_millis(1500)).await;
                    continue;
                }
                break;
            }
        };

        if let Some(err) = body.get("error") {
            last_rpc_error = format!("rpc error: {}", err);
            if attempt < 11 {
                sleep(Duration::from_millis(1500)).await;
                continue;
            }
            break;
        }

        let Some(receipt) = body.get("result") else {
            last_rpc_error = "response missing result".to_string();
            if attempt < 11 {
                sleep(Duration::from_millis(1500)).await;
                continue;
            }
            break;
        };

        if receipt.is_null() {
            last_rpc_error = "receipt not found yet".to_string();
            if attempt < 11 {
                sleep(Duration::from_millis(1500)).await;
                continue;
            }
            break;
        }

        let status = receipt.get("status").and_then(|value| value.as_str());
        if matches!(status, Some("0x0") | Some("0x00")) {
            return Err(crate::error::AppError::BadRequest(
                "onchain_tx_hash reverted on Ethereum".to_string(),
            ));
        }

        let Some(block_number_hex) = receipt.get("blockNumber").and_then(|value| value.as_str())
        else {
            last_rpc_error = "receipt missing blockNumber".to_string();
            if attempt < 11 {
                sleep(Duration::from_millis(1500)).await;
                continue;
            }
            break;
        };

        let Some(block_number) = parse_hex_u64(block_number_hex) else {
            last_rpc_error = "invalid blockNumber format".to_string();
            if attempt < 11 {
                sleep(Duration::from_millis(1500)).await;
                continue;
            }
            break;
        };

        tracing::info!(
            "Verified Ethereum bridge tx {} at block {}",
            tx_hash,
            block_number
        );
        return Ok(block_number as i64);
    }

    Err(crate::error::AppError::BadRequest(format!(
        "onchain_tx_hash not found/confirmed on Ethereum RPC: {}",
        last_rpc_error
    )))
}

// Internal helper that supports `verify_bridge_onchain_tx_hash` operations in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn verify_bridge_onchain_tx_hash(
    state: &AppState,
    tx_hash: &str,
    from_chain: &str,
) -> Result<i64> {
    match from_chain.trim().to_ascii_lowercase().as_str() {
        "starknet" => verify_starknet_bridge_tx_hash(state, tx_hash).await,
        "ethereum" => verify_ethereum_bridge_tx_hash(state, tx_hash).await,
        // Native BTC settles asynchronously via bridge providers; txid is validated format-wise above.
        "bitcoin" | "btc" => Ok(0),
        _ => Ok(0),
    }
}

// Internal helper that checks conditions for `is_valid_evm_address` in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn is_valid_evm_address(value: &str) -> bool {
    let normalized = value.trim();
    normalized.starts_with("0x")
        && normalized.len() == 42
        && normalized[2..].chars().all(|c| c.is_ascii_hexdigit())
}

// Internal helper that parses or transforms values for `normalize_evm_address` in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn normalize_evm_address(value: &str) -> Option<String> {
    let normalized = value.trim();
    if !is_valid_evm_address(normalized) {
        return None;
    }
    Some(format!("0x{}", normalized[2..].to_ascii_lowercase()))
}

// Internal helper that parses or transforms values for `normalize_source_owner_for_chain` in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn normalize_source_owner_for_chain(chain: &str, candidate: &str) -> Option<String> {
    let normalized_chain = chain.trim().to_ascii_lowercase();
    let normalized_candidate = candidate.trim();
    if normalized_candidate.is_empty() {
        return None;
    }

    match normalized_chain.as_str() {
        "ethereum" | "eth" | "evm" => normalize_evm_address(normalized_candidate),
        "starknet" | "strk" => {
            if parse_felt(normalized_candidate).is_ok() {
                Some(normalized_candidate.to_string())
            } else {
                None
            }
        }
        "bitcoin" | "btc" => Some(normalized_candidate.to_string()),
        _ => Some(normalized_candidate.to_string()),
    }
}

// Internal helper that supports `missing_garden_source_wallet_error` operations in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn missing_garden_source_wallet_error(from_chain: &str) -> crate::error::AppError {
    match from_chain.trim().to_ascii_lowercase().as_str() {
        "ethereum" | "eth" | "evm" => crate::error::AppError::BadRequest(
            "Garden bridge Ethereum source requires a valid EVM address (0x + 40 hex). Connect MetaMask and link EVM wallet first."
                .to_string(),
        ),
        "starknet" | "strk" => crate::error::AppError::BadRequest(
            "Garden bridge Starknet source requires a valid Starknet source address."
                .to_string(),
        ),
        "bitcoin" | "btc" => crate::error::AppError::BadRequest(
            "Garden bridge Bitcoin source requires a BTC source address or xverse_user_id."
                .to_string(),
        ),
        _ => crate::error::AppError::BadRequest(
            "Garden bridge requires a valid source wallet address.".to_string(),
        ),
    }
}

// Internal helper that fetches data for `find_linked_wallet_for_chain` in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn find_linked_wallet_for_chain(wallets: &[LinkedWalletAddress], chain: &str) -> Option<String> {
    // Internal helper that checks conditions for `is_btc_chain` in the bridge flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn is_btc_chain(value: &str) -> bool {
        value.eq_ignore_ascii_case("bitcoin") || value.eq_ignore_ascii_case("btc")
    }

    // Internal helper that checks conditions for `is_starknet_chain` in the bridge flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn is_starknet_chain(value: &str) -> bool {
        value.eq_ignore_ascii_case("starknet") || value.eq_ignore_ascii_case("strk")
    }

    // Internal helper that checks conditions for `is_evm_chain` in the bridge flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn is_evm_chain(value: &str) -> bool {
        value.eq_ignore_ascii_case("evm")
            || value.eq_ignore_ascii_case("ethereum")
            || value.eq_ignore_ascii_case("eth")
    }

    if is_btc_chain(chain) {
        return wallets
            .iter()
            .find(|wallet| is_btc_chain(&wallet.chain))
            .map(|wallet| wallet.wallet_address.clone());
    }

    if is_evm_chain(chain) {
        return wallets.iter().find_map(|wallet| {
            if is_evm_chain(&wallet.chain) {
                return normalize_evm_address(&wallet.wallet_address);
            }
            None
        });
    }

    if is_starknet_chain(chain) {
        return wallets
            .iter()
            .find(|wallet| {
                is_starknet_chain(&wallet.chain) && parse_felt(wallet.wallet_address.trim()).is_ok()
            })
            .map(|wallet| wallet.wallet_address.trim().to_string());
    }

    wallets
        .iter()
        .find(|wallet| wallet.chain.eq_ignore_ascii_case(chain))
        .map(|wallet| wallet.wallet_address.clone())
}

// Internal helper that fetches data for `lookup_xverse_btc_address` in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn lookup_xverse_btc_address(state: &AppState, user_id: &str) -> Result<Option<String>> {
    let normalized = user_id.trim();
    if normalized.is_empty() {
        return Ok(None);
    }

    let client = crate::integrations::xverse::XverseClient::new(
        state.config.xverse_api_url.clone(),
        state.config.xverse_api_key.clone(),
    );
    client
        .get_btc_address(normalized)
        .await
        .map_err(|e| crate::error::AppError::BadRequest(format!("Xverse lookup failed: {}", e)))
}

// Internal helper that supports `privacy_seed_from_tx_hash` operations in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn privacy_seed_from_tx_hash(tx_hash: &str) -> String {
    let raw = tx_hash.trim();
    if raw.starts_with("0x")
        && raw.len() <= 66
        && raw.len() > 2
        && raw[2..].chars().all(|c| c.is_ascii_hexdigit())
    {
        return raw.to_ascii_lowercase();
    }
    let body = raw.strip_prefix("0x").unwrap_or(raw);
    if !body.is_empty() && body.len() <= 64 && body.chars().all(|c| c.is_ascii_hexdigit()) {
        return format!("0x{}", body.to_ascii_lowercase());
    }
    hash::hash_string(raw)
}

// Internal helper that checks conditions for `should_run_privacy_verification` in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn should_run_privacy_verification(hide_balance: bool) -> bool {
    hide_balance
}

// Internal helper that supports `mev_fee_for_mode` operations in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn mev_fee_for_mode(mode: Option<&str>, amount: f64) -> f64 {
    if mode.unwrap_or_default().eq_ignore_ascii_case("private") {
        amount * BRIDGE_MEV_FEE_RATE
    } else {
        0.0
    }
}

// Internal helper that fetches data for `resolve_privacy_inputs` in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn resolve_privacy_inputs(
    seed: &str,
    payload: Option<&PrivacyVerificationPayload>,
) -> Result<(String, String, Vec<String>, Vec<String>)> {
    let payload = payload.ok_or_else(|| {
        crate::error::AppError::BadRequest(
            "privacy payload is required when hide_balance=true".to_string(),
        )
    })?;

    let nullifier = payload
        .nullifier
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| seed.to_string());
    let commitment = payload
        .commitment
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| hash::hash_string(&format!("commitment:{seed}")));
    let proof = payload
        .proof
        .clone()
        .filter(|items| !items.is_empty())
        .ok_or_else(|| {
            crate::error::AppError::BadRequest(
                "privacy.proof must be provided and non-empty when hide_balance=true".to_string(),
            )
        })?;
    let public_inputs = payload
        .public_inputs
        .clone()
        .filter(|items| !items.is_empty())
        .ok_or_else(|| {
            crate::error::AppError::BadRequest(
                "privacy.public_inputs must be provided and non-empty when hide_balance=true"
                    .to_string(),
            )
        })?;
    if is_dummy_garaga_payload(&proof, &public_inputs) {
        return Err(crate::error::AppError::BadRequest(
            "privacy.proof/public_inputs dummy payload (0x1) is not allowed; submit a real Garaga proof"
                .to_string(),
        ));
    }
    Ok((nullifier, commitment, proof, public_inputs))
}

// Internal helper that checks conditions for `is_dummy_garaga_payload` in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn is_dummy_garaga_payload(proof: &[String], public_inputs: &[String]) -> bool {
    if proof.len() != 1 || public_inputs.len() != 1 {
        return false;
    }
    proof[0].trim().eq_ignore_ascii_case("0x1")
        && public_inputs[0].trim().eq_ignore_ascii_case("0x1")
}

// Internal helper that supports `verify_private_trade_with_verifier` operations in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn verify_private_trade_with_verifier(
    state: &AppState,
    seed: &str,
    payload: Option<&PrivacyVerificationPayload>,
    verifier: PrivacyVerifierKind,
) -> Result<String> {
    let router = resolve_privacy_router_for_verifier(&state.config, verifier)?;
    let Some(invoker) = OnchainInvoker::from_config(&state.config).ok().flatten() else {
        return Err(crate::error::AppError::BadRequest(format!(
            "On-chain invoker is not configured for '{}' verification",
            verifier.as_str()
        )));
    };
    let (nullifier, commitment, proof, public_inputs) = resolve_privacy_inputs(seed, payload)?;

    let to = parse_felt(&router)?;
    let selector = get_selector_from_name("submit_private_action")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    let mut calldata = vec![parse_felt(&nullifier)?, parse_felt(&commitment)?];
    calldata.push(Felt::from(proof.len() as u64));
    for item in proof {
        calldata.push(parse_felt(&item)?);
    }
    calldata.push(Felt::from(public_inputs.len() as u64));
    for item in public_inputs {
        calldata.push(parse_felt(&item)?);
    }
    let tx_hash = invoker
        .invoke(Call {
            to,
            selector,
            calldata,
        })
        .await?;
    Ok(tx_hash.to_string())
}

/// POST /api/v1/bridge/quote
pub async fn get_bridge_quote(
    State(state): State<AppState>,
    Json(req): Json<BridgeQuoteRequest>,
) -> Result<Json<ApiResponse<BridgeQuoteResponse>>> {
    let from_chain_normalized = canonical_bridge_chain(&req.from_chain);
    let to_chain_normalized = canonical_bridge_chain(&req.to_chain);
    if from_chain_normalized == to_chain_normalized {
        return Err(crate::error::AppError::BadRequest(
            "Bridge requires different source and destination chains. Use swap for same-chain pairs."
                .to_string(),
        ));
    }

    let amount: f64 = req
        .amount
        .parse()
        .map_err(|_| crate::error::AppError::BadRequest("Invalid amount".to_string()))?;

    if token_address_for(&req.token).is_none() {
        return Err(crate::error::AppError::InvalidToken);
    }
    let optimizer = RouteOptimizer::new(state.config.clone());
    let best_route = optimizer
        .find_best_bridge_route(
            &req.from_chain,
            &req.to_chain,
            &req.token,
            req.to_token.as_deref(),
            amount,
        )
        .await?;

    let provider = best_route.provider.as_str();
    let bridge_fee = best_route.fee;
    let estimated_receive = best_route.amount_out;
    let estimated_time = estimate_time(provider);

    let response = BridgeQuoteResponse {
        from_chain: req.from_chain,
        to_chain: req.to_chain,
        amount: req.amount,
        estimated_receive: estimated_receive.to_string(),
        fee: bridge_fee.to_string(),
        estimated_time: estimated_time.to_string(),
        bridge_provider: provider.to_string(),
    };

    Ok(Json(ApiResponse::success(response)))
}

/// POST /api/v1/bridge/execute
pub async fn execute_bridge(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ExecuteBridgeRequest>,
) -> Result<Json<ApiResponse<ExecuteBridgeResponse>>> {
    let user_address = require_user(&headers, &state).await?;
    let linked_wallets = state
        .db
        .list_wallet_addresses(&user_address)
        .await
        .unwrap_or_default();

    let discount_usage_user = match require_starknet_user(&headers, &state).await {
        Ok(starknet_user) => Some(starknet_user),
        Err(_) => {
            if parse_felt(&user_address).is_ok() {
                Some(user_address.clone())
            } else {
                linked_wallets
                    .iter()
                    .find(|wallet| {
                        wallet.chain.eq_ignore_ascii_case("starknet")
                            && parse_felt(wallet.wallet_address.trim()).is_ok()
                    })
                    .map(|wallet| wallet.wallet_address.clone())
            }
        }
    };
    let from_chain_normalized = canonical_bridge_chain(&req.from_chain);
    let to_chain_normalized = canonical_bridge_chain(&req.to_chain);
    if from_chain_normalized == to_chain_normalized {
        return Err(crate::error::AppError::BadRequest(
            "Bridge requires different source and destination chains. Use swap for same-chain pairs."
                .to_string(),
        ));
    }
    let is_from_btc = from_chain_normalized == "bitcoin" || from_chain_normalized == "btc";
    let is_to_btc = to_chain_normalized == "bitcoin" || to_chain_normalized == "btc";
    let is_to_starknet = to_chain_normalized == "starknet";

    let mut recipient = req.recipient.trim().to_string();
    if recipient.is_empty() {
        if is_to_btc {
            if let Some(user_id) = req.xverse_user_id.as_deref() {
                if let Some(addr) = lookup_xverse_btc_address(&state, user_id).await? {
                    recipient = addr;
                }
            }
            if recipient.is_empty() {
                if let Some(addr) = find_linked_wallet_for_chain(&linked_wallets, "bitcoin") {
                    recipient = addr;
                }
            }
        } else if is_to_starknet {
            if parse_felt(&user_address).is_ok() {
                recipient = user_address.clone();
            } else if let Some(addr) = find_linked_wallet_for_chain(&linked_wallets, "starknet") {
                recipient = addr;
            }
        } else if let Some(addr) =
            find_linked_wallet_for_chain(&linked_wallets, &to_chain_normalized)
        {
            recipient = addr;
        }
    }
    if recipient.is_empty() {
        return Err(crate::error::AppError::BadRequest(format!(
            "Recipient is required for destination chain '{}'",
            req.to_chain
        )));
    }

    let requested_source_owner = req
        .source_owner
        .as_deref()
        .and_then(|candidate| normalize_source_owner_for_chain(&from_chain_normalized, candidate));
    let mut garden_source_owner = if requested_source_owner.is_some() {
        requested_source_owner
    } else if is_from_btc {
        find_linked_wallet_for_chain(&linked_wallets, "bitcoin")
    } else {
        find_linked_wallet_for_chain(&linked_wallets, &from_chain_normalized)
    };
    if garden_source_owner.is_none() && is_from_btc {
        if let Some(user_id) = req.xverse_user_id.as_deref() {
            garden_source_owner = lookup_xverse_btc_address(&state, user_id).await?;
        }
    }
    if garden_source_owner.is_none()
        && (from_chain_normalized == "starknet" || from_chain_normalized == "ethereum")
    {
        if from_chain_normalized == "starknet" && parse_felt(&user_address).is_ok() {
            garden_source_owner = Some(user_address.clone());
        } else if from_chain_normalized == "ethereum" {
            if let Some(normalized) = normalize_evm_address(&user_address) {
                garden_source_owner = Some(normalized);
            }
        }
    }

    let amount: f64 = req
        .amount
        .parse()
        .map_err(|_| crate::error::AppError::BadRequest("Invalid amount".to_string()))?;

    if token_address_for(&req.token).is_none() {
        return Err(crate::error::AppError::InvalidToken);
    }
    if let Some(to_token) = req.to_token.as_deref() {
        if token_address_for(to_token).is_none() {
            return Err(crate::error::AppError::BadRequest(
                "Invalid to_token".to_string(),
            ));
        }
    }

    let optimizer = RouteOptimizer::new(state.config.clone());
    let best_route = optimizer
        .find_best_bridge_route(
            &req.from_chain,
            &req.to_chain,
            &req.token,
            req.to_token.as_deref(),
            amount,
        )
        .await?;
    let is_garden_provider = best_route.provider.as_str() == BRIDGE_GARDEN;
    let is_garden_user_signed_source = is_garden_provider
        && (from_chain_normalized == "ethereum" || from_chain_normalized == "starknet");

    let applied_nft_discount_percent = if let Some(discount_user) = discount_usage_user.as_deref() {
        refresh_nft_discount_for_submit(&state, discount_user).await
    } else {
        0.0
    };
    let mev_fee = mev_fee_for_mode(req.mode.as_deref(), amount);
    let route_fee_with_mev = best_route.fee + mev_fee;
    let effective_bridge_fee =
        route_fee_with_mev * (1.0 - (applied_nft_discount_percent.clamp(0.0, 100.0) / 100.0));
    if applied_nft_discount_percent > 0.0 || mev_fee > 0.0 {
        tracing::debug!(
            "Bridge fee applied: user={} mode={} discount_percent={} route_fee={} mev_fee={} effective_fee={}",
            user_address,
            req.mode.as_deref().unwrap_or("transparent"),
            applied_nft_discount_percent,
            best_route.fee,
            mev_fee,
            effective_bridge_fee
        );
    }

    let estimated_receive = if let Some(raw) = req.estimated_out_amount.as_deref() {
        raw.parse::<f64>().unwrap_or(best_route.amount_out)
    } else {
        best_route.amount_out
    };
    let to_token = req
        .to_token
        .as_deref()
        .unwrap_or(req.token.as_str())
        .trim()
        .to_ascii_uppercase();
    let from_token = req.token.trim().to_ascii_uppercase();
    let user_ai_level = match state.db.get_user_ai_level(&user_address).await {
        Ok(level) => level,
        Err(err) => {
            tracing::warn!(
                "Failed to resolve user AI level for bridge points bonus (user={}): {}",
                user_address,
                err
            );
            1
        }
    };
    let ai_level_points_bonus_percent = bridge_ai_level_points_bonus_percent(user_ai_level);
    let mut estimated_points_earned = estimate_bridge_points_for_response(
        sanitize_usd_notional(amount * fallback_price_for(&from_token)),
        is_from_btc,
        applied_nft_discount_percent,
        user_ai_level,
        state.config.is_testnet(),
    );

    if req.existing_bridge_id.is_some() && !is_garden_provider {
        return Err(crate::error::AppError::BadRequest(
            "existing_bridge_id is only supported for Garden bridge flow".to_string(),
        ));
    }

    if is_garden_user_signed_source
        && req
            .onchain_tx_hash
            .as_deref()
            .map(str::trim)
            .unwrap_or_default()
            .is_empty()
    {
        let client = GardenClient::new(
            state.config.garden_api_key.clone().unwrap_or_default(),
            state.config.garden_api_url.clone(),
        );
        let source_owner = garden_source_owner
            .clone()
            .ok_or_else(|| missing_garden_source_wallet_error(&from_chain_normalized))?;
        let quote = GardenQuote {
            from_chain: req.from_chain.clone(),
            to_chain: req.to_chain.clone(),
            from_token: from_token.clone(),
            to_token: to_token.clone(),
            amount_in: amount,
            amount_out: estimated_receive,
            fee: effective_bridge_fee,
            estimated_time_minutes: 30,
        };
        let submission = client
            .execute_bridge(&quote, &source_owner, &recipient)
            .await?;
        let response = ExecuteBridgeResponse {
            bridge_id: submission.order_id,
            status: "awaiting_source_signature".to_string(),
            from_chain: req.from_chain,
            to_chain: req.to_chain,
            amount: req.amount,
            estimated_receive: estimated_receive.to_string(),
            estimated_time: estimate_time(best_route.provider.as_str()).to_string(),
            fee_before_discount: route_fee_with_mev.to_string(),
            fee_discount_saved: (route_fee_with_mev - effective_bridge_fee)
                .max(0.0)
                .to_string(),
            nft_discount_percent: applied_nft_discount_percent.to_string(),
            estimated_points_earned: estimated_points_earned.to_string(),
            points_pending: true,
            ai_level_points_bonus_percent: ai_level_points_bonus_percent.to_string(),
            privacy_tx_hash: None,
            deposit_address: submission.deposit_address,
            deposit_amount: submission.deposit_amount,
            evm_approval_transaction: submission.evm_approval_transaction,
            evm_initiate_transaction: submission.evm_initiate_transaction,
            starknet_approval_transaction: submission.starknet_approval_transaction,
            starknet_initiate_transaction: submission.starknet_initiate_transaction,
        };
        return Ok(Json(ApiResponse::success(response)));
    }

    let tx_hash =
        normalize_bridge_onchain_tx_hash(req.onchain_tx_hash.as_deref(), &req.from_chain)?;
    let onchain_block_number =
        verify_bridge_onchain_tx_hash(&state, &tx_hash, &from_chain_normalized).await?;
    let should_hide = should_run_privacy_verification(req.hide_balance.unwrap_or(false));

    // Keep DB tx_hash within varchar(66), while exposing a human-friendly bridge_id.
    let mut bridge_id = if is_garden_user_signed_source {
        let existing = req
            .existing_bridge_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                crate::error::AppError::BadRequest(
                    "Garden bridge with Ethereum/Starknet source requires existing_bridge_id from create-order step."
                        .to_string(),
                )
            })?;
        existing.to_string()
    } else {
        build_bridge_id(&tx_hash)
    };
    let mut garden_deposit_address: Option<String> = None;
    let mut garden_deposit_amount: Option<String> = None;
    let mut garden_evm_approval_transaction: Option<GardenEvmTransaction> = None;
    let mut garden_evm_initiate_transaction: Option<GardenEvmTransaction> = None;
    let mut garden_starknet_approval_transaction: Option<GardenStarknetTransaction> = None;
    let mut garden_starknet_initiate_transaction: Option<GardenStarknetTransaction> = None;
    let mut privacy_verification_tx: Option<String> = None;
    let privacy_payload = req.privacy.as_ref();
    if should_hide {
        let verifier =
            parse_privacy_verifier_kind(privacy_payload.and_then(|p| p.verifier.as_deref()))?;
        let privacy_seed = privacy_seed_from_tx_hash(&tx_hash);
        let privacy_tx =
            verify_private_trade_with_verifier(&state, &privacy_seed, privacy_payload, verifier)
                .await
                .map_err(|e| {
                    crate::error::AppError::BadRequest(format!(
                        "Privacy verification failed via '{}': {}",
                        verifier.as_str(),
                        e
                    ))
                })?;
        privacy_verification_tx = Some(privacy_tx);
        if let Some(ref privacy_tx_hash) = privacy_verification_tx {
            tracing::info!(
                "Privacy verification submitted via {} for bridge tx_hash={} privacy_tx_hash={}",
                verifier.as_str(),
                tx_hash,
                privacy_tx_hash
            );
        }
    }

    let token_price = latest_price_usd(&state, &from_token).await?;
    let volume_usd = sanitize_usd_notional(amount * token_price);
    estimated_points_earned = estimate_bridge_points_for_response(
        volume_usd,
        is_from_btc,
        applied_nft_discount_percent,
        user_ai_level,
        state.config.is_testnet(),
    );

    let tx = crate::models::Transaction {
        tx_hash: tx_hash.clone(),
        block_number: onchain_block_number,
        user_address: user_address.to_string(),
        tx_type: "bridge".to_string(),
        token_in: Some(from_token.clone()),
        token_out: Some(to_token.clone()),
        amount_in: Some(rust_decimal::Decimal::from_f64_retain(amount).unwrap()),
        amount_out: Some(rust_decimal::Decimal::from_f64_retain(estimated_receive).unwrap()),
        usd_value: Some(rust_decimal::Decimal::from_f64_retain(volume_usd).unwrap()),
        fee_paid: Some(rust_decimal::Decimal::from_f64_retain(effective_bridge_fee).unwrap()),
        points_earned: Some(rust_decimal::Decimal::ZERO),
        timestamp: chrono::Utc::now(),
        processed: false,
    };

    state.db.save_transaction(&tx).await?;
    if should_hide {
        state.db.mark_transaction_private(&tx_hash).await?;
    }
    if let Some(discount_user) = discount_usage_user.as_deref() {
        if applied_nft_discount_percent > 0.0 {
            record_nft_discount_usage_after_submit(&state, discount_user).await;
            let consume_result = consume_nft_usage(&state.config, discount_user, "bridge").await;
            if let Err(err) = consume_result {
                tracing::warn!(
                    "Failed to consume NFT discount usage after bridge success: user={} tx_hash={} err={}",
                    discount_user,
                    tx_hash,
                    err
                );
            }
        } else if let Some(contract) = discount_contract_address(&state) {
            // Keep in-memory cache aligned with latest submit-time chain validation.
            invalidate_cached_nft_discount(contract, discount_user).await;
        }
    }

    let is_starkgate_direct = best_route.provider.as_str() == BRIDGE_STARKGATE
        && (from_chain_normalized == "ethereum" || from_chain_normalized == "starknet");
    if is_starkgate_direct {
        let mut response_provider = best_route.provider.as_str();
        // Ethereum -> Starknet flow is signed in user wallet via StarkGate.
        // Mirror it into bridge aggregator so on-chain CAREL accounting still runs.
        if from_chain_normalized == "ethereum" {
            response_provider = BRIDGE_STARKGATE;
            if let Err(err) = invoke_bridge_aggregator(
                &state,
                BRIDGE_STARKGATE,
                amount,
                effective_bridge_fee,
                best_route.estimated_time_minutes,
            )
            .await
            {
                tracing::warn!("Bridge aggregator mirror invoke failed: {}", err);
            }
        }
        let response = ExecuteBridgeResponse {
            bridge_id: tx_hash.clone(),
            status: "submitted_onchain".to_string(),
            from_chain: req.from_chain,
            to_chain: req.to_chain,
            amount: req.amount,
            estimated_receive: estimated_receive.to_string(),
            estimated_time: estimate_time(response_provider).to_string(),
            fee_before_discount: route_fee_with_mev.to_string(),
            fee_discount_saved: (route_fee_with_mev - effective_bridge_fee)
                .max(0.0)
                .to_string(),
            nft_discount_percent: applied_nft_discount_percent.to_string(),
            estimated_points_earned: estimated_points_earned.to_string(),
            points_pending: true,
            ai_level_points_bonus_percent: ai_level_points_bonus_percent.to_string(),
            privacy_tx_hash: privacy_verification_tx.clone(),
            deposit_address: None,
            deposit_amount: None,
            evm_approval_transaction: None,
            evm_initiate_transaction: None,
            starknet_approval_transaction: None,
            starknet_initiate_transaction: None,
        };
        return Ok(Json(ApiResponse::success(response)));
    }

    // MENGGUNAKAN 'recipient' agar tidak dead_code
    tracing::info!(
        "Bridge initiated to {}: {} {} from {} to {} (id: {}, privacy={:?})",
        recipient,
        amount,
        req.token,
        req.from_chain,
        req.to_chain,
        bridge_id,
        privacy_verification_tx
    );

    if best_route.provider.as_str() == BRIDGE_LAYERSWAP {
        let client = LayerSwapClient::new(
            state.config.layerswap_api_key.clone().unwrap_or_default(),
            state.config.layerswap_api_url.clone(),
        );
        let quote = LayerSwapQuote {
            from_chain: req.from_chain.clone(),
            to_chain: req.to_chain.clone(),
            token: req.token.clone(),
            amount_in: amount,
            amount_out: estimated_receive,
            fee: effective_bridge_fee,
            estimated_time_minutes: 15,
        };
        bridge_id = client.execute_bridge(&quote, &recipient).await?;
    } else if best_route.provider.as_str() == BRIDGE_ATOMIQ {
        let client = AtomiqClient::new(
            state.config.atomiq_api_key.clone().unwrap_or_default(),
            state.config.atomiq_api_url.clone(),
        );
        let quote = AtomiqQuote {
            from_chain: req.from_chain.clone(),
            to_chain: req.to_chain.clone(),
            token: req.token.clone(),
            amount_in: amount,
            amount_out: estimated_receive,
            fee: effective_bridge_fee,
            estimated_time_minutes: 20,
        };
        bridge_id = client.execute_bridge(&quote, &recipient).await?;
    } else if best_route.provider.as_str() == BRIDGE_GARDEN {
        if is_garden_user_signed_source {
            tracing::info!(
                "Using existing Garden order for finalize step: order_id={} source_chain={}",
                bridge_id,
                from_chain_normalized
            );
        } else {
            let client = GardenClient::new(
                state.config.garden_api_key.clone().unwrap_or_default(),
                state.config.garden_api_url.clone(),
            );
            let source_owner = garden_source_owner
                .clone()
                .ok_or_else(|| missing_garden_source_wallet_error(&from_chain_normalized))?;
            let quote = GardenQuote {
                from_chain: req.from_chain.clone(),
                to_chain: req.to_chain.clone(),
                from_token: from_token.clone(),
                to_token: to_token.clone(),
                amount_in: amount,
                amount_out: estimated_receive,
                fee: effective_bridge_fee,
                estimated_time_minutes: 30,
            };
            let submission = client
                .execute_bridge(&quote, &source_owner, &recipient)
                .await?;
            bridge_id = submission.order_id;
            garden_deposit_address = submission.deposit_address;
            garden_deposit_amount = submission.deposit_amount;
            garden_evm_approval_transaction = submission.evm_approval_transaction;
            garden_evm_initiate_transaction = submission.evm_initiate_transaction;
            garden_starknet_approval_transaction = submission.starknet_approval_transaction;
            garden_starknet_initiate_transaction = submission.starknet_initiate_transaction;
        }
    }

    if let Err(err) = invoke_bridge_aggregator(
        &state,
        &best_route.provider,
        amount,
        effective_bridge_fee,
        best_route.estimated_time_minutes,
    )
    .await
    {
        tracing::warn!("Bridge aggregator invoke failed: {}", err);
    }

    let response = ExecuteBridgeResponse {
        bridge_id,
        status: "pending".to_string(),
        from_chain: req.from_chain,
        to_chain: req.to_chain,
        amount: req.amount,
        estimated_receive: estimated_receive.to_string(),
        estimated_time: estimate_time(best_route.provider.as_str()).to_string(),
        fee_before_discount: route_fee_with_mev.to_string(),
        fee_discount_saved: (route_fee_with_mev - effective_bridge_fee)
            .max(0.0)
            .to_string(),
        nft_discount_percent: applied_nft_discount_percent.to_string(),
        estimated_points_earned: estimated_points_earned.to_string(),
        points_pending: true,
        ai_level_points_bonus_percent: ai_level_points_bonus_percent.to_string(),
        privacy_tx_hash: privacy_verification_tx.clone(),
        deposit_address: garden_deposit_address,
        deposit_amount: garden_deposit_amount,
        evm_approval_transaction: garden_evm_approval_transaction,
        evm_initiate_transaction: garden_evm_initiate_transaction,
        starknet_approval_transaction: garden_starknet_approval_transaction,
        starknet_initiate_transaction: garden_starknet_initiate_transaction,
    };

    Ok(Json(ApiResponse::success(response)))
}

/// GET /api/v1/bridge/status/{bridge_id}
pub async fn get_bridge_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(bridge_id): Path<String>,
) -> Result<Json<ApiResponse<BridgeStatusResponse>>> {
    let _ = require_user(&headers, &state).await?;

    let client = GardenClient::new(
        state.config.garden_api_key.clone().unwrap_or_default(),
        state.config.garden_api_url.clone(),
    );
    let status = client.get_order_status(&bridge_id).await?;
    let is_completed = status.destination_redeem_tx_hash.is_some();

    Ok(Json(ApiResponse::success(BridgeStatusResponse {
        bridge_id: status.order_id,
        status: status.status,
        is_completed,
        version: status.version,
        source_initiate_tx_hash: status.source_initiate_tx_hash,
        source_redeem_tx_hash: status.source_redeem_tx_hash,
        destination_initiate_tx_hash: status.destination_initiate_tx_hash,
        destination_redeem_tx_hash: status.destination_redeem_tx_hash,
    })))
}

// Internal helper that runs side-effecting logic for `invoke_bridge_aggregator` in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn invoke_bridge_aggregator(
    state: &AppState,
    provider: &str,
    amount: f64,
    fee: f64,
    estimated_time_minutes: u32,
) -> Result<()> {
    let aggregator = state.config.bridge_aggregator_address.trim();
    if aggregator.is_empty() || aggregator.starts_with("0x0000") {
        return Ok(());
    }

    let provider_id = state
        .config
        .bridge_provider_id_for(provider)
        .or_else(|| default_bridge_provider_id(provider).map(str::to_string));
    let Some(provider_id) = provider_id else {
        return Ok(());
    };

    let Some(invoker) = OnchainInvoker::from_config(&state.config).ok().flatten() else {
        return Ok(());
    };

    let to = parse_felt(aggregator)?;
    let selector = get_selector_from_name("execute_bridge")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;

    let provider_felt = parse_felt(&provider_id)?;
    let total_cost = to_u256_felt(fee)?;
    let amount_u256 = to_u256_felt(amount)?;
    let estimated_time = starknet_core::types::Felt::from(estimated_time_minutes as u64);

    let calldata = vec![
        provider_felt,
        total_cost.0,
        total_cost.1,
        estimated_time,
        amount_u256.0,
        amount_u256.1,
    ];

    let call = Call {
        to,
        selector,
        calldata,
    };
    let _ = invoker.invoke(call).await?;
    Ok(())
}

// Internal helper that supports `default_bridge_provider_id` operations in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn default_bridge_provider_id(provider: &str) -> Option<&'static str> {
    if provider.eq_ignore_ascii_case(BRIDGE_LAYERSWAP) {
        return Some("0x4c535750"); // LSWP
    }
    if provider.eq_ignore_ascii_case(BRIDGE_ATOMIQ) {
        return Some("0x41544d51"); // ATMQ
    }
    if provider.eq_ignore_ascii_case(BRIDGE_GARDEN) {
        return Some("0x47415244"); // GARD
    }
    if provider.eq_ignore_ascii_case(BRIDGE_STARKGATE) {
        return Some("0x53544754"); // STGT
    }
    None
}

// Internal helper that supports `to_u256_felt` operations in the bridge flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn to_u256_felt(value: f64) -> Result<(starknet_core::types::Felt, starknet_core::types::Felt)> {
    let scaled = (value * 1e18_f64).round();
    let as_u128 = scaled as u128;
    Ok((
        starknet_core::types::Felt::from(as_u128),
        starknet_core::types::Felt::from(0_u128),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    // Internal helper that supports `estimate_time_maps_providers` operations in the bridge flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn estimate_time_maps_providers() {
        // Memastikan estimasi waktu sesuai provider
        assert_eq!(estimate_time(BRIDGE_LAYERSWAP), "~15-20 min");
        assert_eq!(estimate_time(BRIDGE_STARKGATE), "~10-15 min");
        assert_eq!(estimate_time(BRIDGE_ATOMIQ), "~20-30 min");
        assert_eq!(estimate_time("Unknown"), "~15-20 min");
    }

    #[test]
    // Internal helper that builds inputs for `build_bridge_id_uses_short_hash_prefix` in the bridge flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn build_bridge_id_uses_short_hash_prefix() {
        let id = build_bridge_id("0x1234567890abcdef");
        assert_eq!(id, "BR_1234567890ab");
    }

    #[test]
    // Internal helper that parses or transforms values for `normalize_bridge_hash_accepts_btc_txid_without_prefix` in the bridge flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn normalize_bridge_hash_accepts_btc_txid_without_prefix() {
        let txid = "fa28fab8ae02404513796fbb4674347bff278e8806c8f5d29fecff534e94a07d";
        let normalized = normalize_bridge_onchain_tx_hash(Some(txid), "bitcoin")
            .expect("btc tx hash should be valid");
        assert_eq!(normalized, txid);
    }

    #[test]
    // Internal helper that parses or transforms values for `normalize_bridge_hash_prefixes_non_btc` in the bridge flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn normalize_bridge_hash_prefixes_non_btc() {
        let txid = "185243a4591a33171141926dd90aa9c8a8100807dc6f0b7f42b19f261a0cd383";
        let normalized = normalize_bridge_onchain_tx_hash(Some(txid), "ethereum")
            .expect("evm tx hash should be valid");
        assert_eq!(normalized, format!("0x{}", txid));
    }

    #[test]
    // Internal helper that parses or transforms values for `normalize_bridge_hash_allows_missing_btc_hash` in the bridge flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn normalize_bridge_hash_allows_missing_btc_hash() {
        let normalized = normalize_bridge_onchain_tx_hash(None, "bitcoin")
            .expect("missing btc hash should generate internal correlation id");
        assert_eq!(normalized.len(), 64);
        assert!(normalized.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    // Internal helper that parses or transforms values for `normalize_bridge_hash_requires_non_btc_hash` in the bridge flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn normalize_bridge_hash_requires_non_btc_hash() {
        let err = normalize_bridge_onchain_tx_hash(None, "starknet")
            .expect_err("non-btc bridge must require user tx hash");
        let message = err.to_string();
        assert!(
            message.contains("onchain_tx_hash"),
            "unexpected error message: {}",
            message
        );
    }

    #[test]
    // Internal helper that parses or transforms values for `parse_hex_u64_supports_prefixed_and_plain_values` in the bridge flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn parse_hex_u64_supports_prefixed_and_plain_values() {
        assert_eq!(parse_hex_u64("0x10"), Some(16));
        assert_eq!(parse_hex_u64("ff"), Some(255));
        assert_eq!(parse_hex_u64("0x"), Some(0));
        assert_eq!(parse_hex_u64("not-hex"), None);
    }

    #[test]
    // Internal helper that parses or transforms values for `normalize_source_owner_for_ethereum_rejects_starknet_format` in the bridge flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn normalize_source_owner_for_ethereum_rejects_starknet_format() {
        let invalid = "0x0469de079832d5da0591fc5f8fd2957f70b908d62c5d0dcb057d030cfc827705";
        assert!(normalize_source_owner_for_chain("ethereum", invalid).is_none());

        let valid = "0x1234567890abcdef1234567890abcdef12345678";
        assert_eq!(
            normalize_source_owner_for_chain("ethereum", valid),
            Some(valid.to_string())
        );
    }

    #[test]
    // Internal helper that supports `mev_fee_for_private_mode_is_one_percent` operations in the bridge flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn mev_fee_for_private_mode_is_one_percent() {
        assert!((mev_fee_for_mode(Some("private"), 100.0) - 1.0).abs() < 1e-9);
        assert!((mev_fee_for_mode(Some("PRIVATE"), 100.0) - 1.0).abs() < 1e-9);
        assert!((mev_fee_for_mode(Some("transparent"), 100.0) - 0.0).abs() < 1e-9);
        assert!((mev_fee_for_mode(None, 100.0) - 0.0).abs() < 1e-9);
    }

    #[test]
    // Internal helper that supports `privacy_verification_depends_on_hide_balance_only` operations in the bridge flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn privacy_verification_depends_on_hide_balance_only() {
        assert!(should_run_privacy_verification(true));
        assert!(!should_run_privacy_verification(false));
    }

    #[test]
    // Internal helper that supports `estimate_bridge_points_applies_testnet_thresholds` operations in the bridge flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn estimate_bridge_points_applies_testnet_thresholds() {
        let mainnet_points = estimate_bridge_points_for_response(9.5, false, 0.0, 1, false);
        let testnet_points = estimate_bridge_points_for_response(9.5, false, 0.0, 1, true);
        assert_eq!(mainnet_points, 0.0);
        assert!(testnet_points > 0.0);
    }

    #[test]
    // Internal helper that supports `estimate_bridge_points_includes_ai_level_bonus` operations in the bridge flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn estimate_bridge_points_includes_ai_level_bonus() {
        let base = estimate_bridge_points_for_response(100.0, false, 0.0, 1, false);
        let l2 = estimate_bridge_points_for_response(100.0, false, 0.0, 2, false);
        let l3 = estimate_bridge_points_for_response(100.0, false, 0.0, 3, false);
        assert!(l2 > base);
        assert!(l3 > l2);
    }

    #[test]

    // Internal helper that fetches data for `find_linked_wallet_for_chain_skips_invalid_evm_wallet` in the bridge flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn find_linked_wallet_for_chain_skips_invalid_evm_wallet() {
        let now = Utc::now();
        let invalid_evm = LinkedWalletAddress {
            user_address: "0xabc".to_string(),
            chain: "evm".to_string(),
            wallet_address: "0x0469de079832d5da0591fc5f8fd2957f70b908d62c5d0dcb057d030cfc827705"
                .to_string(),
            provider: Some("metamask".to_string()),
            created_at: now,
            updated_at: now,
        };
        let valid_evm = LinkedWalletAddress {
            user_address: "0xabc".to_string(),
            chain: "ethereum".to_string(),
            wallet_address: "0x1234567890abcdef1234567890abcdef12345678".to_string(),
            provider: Some("metamask".to_string()),
            created_at: now,
            updated_at: now,
        };

        let resolved = find_linked_wallet_for_chain(&[invalid_evm, valid_evm], "ethereum");
        assert_eq!(
            resolved,
            Some("0x1234567890abcdef1234567890abcdef12345678".to_string())
        );
    }
}
