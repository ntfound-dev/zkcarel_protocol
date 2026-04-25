use super::{require_starknet_user, AppState};
use crate::{
    constants::{
        EPOCH_DURATION_SECONDS, NFT_TIER_1_DISCOUNT, NFT_TIER_2_DISCOUNT, NFT_TIER_3_DISCOUNT,
        NFT_TIER_4_DISCOUNT, NFT_TIER_5_DISCOUNT, NFT_TIER_6_DISCOUNT,
    },
    db::NftDiscountStateUpsert,
    error::{AppError, Result},
    models::ApiResponse,
    services::{
        invoke_parser::parse_execute_calls,
        onchain::{felt_to_u128, parse_felt, u256_from_felts_u128, OnchainReader},
    },
};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use rust_decimal::prelude::FromPrimitive;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use starknet_core::types::{
    ExecutionResult, Felt, FunctionCall, InvokeTransaction, Transaction as StarknetTransaction,
    TransactionFinalityStatus,
};
use starknet_core::utils::{get_selector_from_name, get_storage_var_address};
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::Instant;
use tokio::time::{timeout, Duration};

const ONCHAIN_NFT_READ_TIMEOUT_MS: u64 = 3_500;
const OWNED_NFT_CACHE_TTL_SECS: u64 = 300;
const OWNED_NFT_CACHE_STALE_SECS: u64 = 1_200;
const OWNED_NFT_CACHE_MAX_ENTRIES: usize = 100_000;

#[derive(Debug, Serialize, Clone)]
pub struct Nft {
    pub token_id: String,
    pub tier: i32,
    pub discount: f64,
    pub expiry: i64,
    pub used: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_usage: Option<u128>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used_in_period: Option<u128>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining_usage: Option<u128>,
}

#[derive(Clone)]
struct CachedOwnedNfts {
    fetched_at: Instant,
    value: Vec<Nft>,
}

static OWNED_NFT_CACHE: OnceLock<tokio::sync::RwLock<HashMap<String, CachedOwnedNfts>>> =
    OnceLock::new();
static OWNED_NFT_FETCH_LOCKS: OnceLock<
    tokio::sync::RwLock<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
> = OnceLock::new();

// Internal helper that supports `owned_nft_cache` operations.
fn owned_nft_cache() -> &'static tokio::sync::RwLock<HashMap<String, CachedOwnedNfts>> {
    OWNED_NFT_CACHE.get_or_init(|| tokio::sync::RwLock::new(HashMap::new()))
}

// Internal helper that supports `owned_nft_fetch_locks` operations.
fn owned_nft_fetch_locks(
) -> &'static tokio::sync::RwLock<HashMap<String, Arc<tokio::sync::Mutex<()>>>> {
    OWNED_NFT_FETCH_LOCKS.get_or_init(|| tokio::sync::RwLock::new(HashMap::new()))
}

// Internal helper that supports `owned_nft_fetch_lock_for` operations.
async fn owned_nft_fetch_lock_for(key: &str) -> Arc<tokio::sync::Mutex<()>> {
    let locks = owned_nft_fetch_locks();
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

    if guard.len() > OWNED_NFT_CACHE_MAX_ENTRIES {
        let cache = owned_nft_cache();
        let cache_guard = cache.read().await;
        guard.retain(|cache_key, _| cache_guard.contains_key(cache_key));
    }
    lock
}

// Internal helper that supports `owned_nft_cache_key` operations.
fn owned_nft_cache_key(contract: &str, user: &str) -> String {
    format!(
        "{}|{}",
        contract.trim().to_ascii_lowercase(),
        user.trim().to_ascii_lowercase()
    )
}

// Internal helper that fetches data for `get_cached_owned_nfts`.
async fn get_cached_owned_nfts(key: &str, max_age: Duration) -> Option<Vec<Nft>> {
    let cache = owned_nft_cache();
    let guard = cache.read().await;
    let entry = guard.get(key)?;
    if entry.fetched_at.elapsed() <= max_age {
        return Some(entry.value.clone());
    }
    None
}

// Internal helper that supports `cache_owned_nfts` operations.
async fn cache_owned_nfts(key: String, value: Vec<Nft>) {
    let cache = owned_nft_cache();
    let mut guard = cache.write().await;
    guard.insert(
        key,
        CachedOwnedNfts {
            fetched_at: Instant::now(),
            value,
        },
    );
    if guard.len() > OWNED_NFT_CACHE_MAX_ENTRIES {
        let stale_after = Duration::from_secs(OWNED_NFT_CACHE_STALE_SECS);
        guard.retain(|_, entry| entry.fetched_at.elapsed() <= stale_after);
    }
}

// Internal helper that supports `invalidate_cached_owned_nfts` operations.
async fn invalidate_cached_owned_nfts(contract: &str, user: &str) {
    let key = owned_nft_cache_key(contract, user);
    let cache = owned_nft_cache();
    let mut guard = cache.write().await;
    guard.remove(&key);
}

#[derive(Debug, Deserialize)]
pub struct MintRequest {
    pub tier: i32,
    pub onchain_tx_hash: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MintStatusResponse {
    pub status: String,
    pub tx_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tier: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nft: Option<Nft>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, sqlx::FromRow)]
struct NftMintRecord {
    user_address: String,
    status: String,
    nft_tier: Option<i16>,
}

// Internal helper that supports `points_cost_for_tier` operations.
fn points_cost_for_tier(tier: i32) -> i64 {
    match tier {
        1 => 5_000,
        2 => 15_000,
        3 => 50_000,
        4 => 150_000,
        5 => 500_000,
        _ => 0,
    }
}

// Internal helper that supports `discount_for_tier` operations.
fn discount_for_tier(tier: i32) -> f64 {
    match tier {
        0 => 0.0,
        1 => NFT_TIER_1_DISCOUNT,
        2 => NFT_TIER_2_DISCOUNT,
        3 => NFT_TIER_3_DISCOUNT,
        4 => NFT_TIER_4_DISCOUNT,
        5 => NFT_TIER_5_DISCOUNT,
        6 => NFT_TIER_6_DISCOUNT,
        _ => 0.0,
    }
}

// Internal helper that supports `tier_for_discount` operations.
fn tier_for_discount(discount: f64) -> i32 {
    let rounded = discount.round() as i64;
    match rounded {
        i if i <= 0 => 0,
        1..=7 => 1,   // bronze ~5%
        8..=15 => 2,  // silver ~10%
        16..=25 => 3, // gold 25%
        26..=35 => 4, // platinum 35%
        _ => 5,       // onyx 50%+
    }
}

// Internal helper that supports `current_nft_period_epoch` operations.
fn current_nft_period_epoch() -> i64 {
    let now = chrono::Utc::now().timestamp();
    let period = (EPOCH_DURATION_SECONDS as i64).max(1);
    if now <= 0 {
        0
    } else {
        now / period
    }
}

// Internal helper that parses or transforms values for `u128_to_i64_saturating`.
fn u128_to_i64_saturating(value: u128) -> i64 {
    if value > i64::MAX as u128 {
        i64::MAX
    } else {
        value as i64
    }
}

// Internal helper that parses or transforms values for `derive_discount_state_from_owned_nfts`.
fn derive_discount_state_from_owned_nfts(nfts: &[Nft]) -> Option<(i32, f64, bool, i64, i64)> {
    let primary = nfts
        .iter()
        .find(|nft| !nft.used && nft.discount > 0.0)
        .or_else(|| nfts.first())?;

    let tier = primary.tier.max(0);
    let discount_percent = if primary.used {
        0.0
    } else {
        primary.discount.clamp(0.0, 100.0)
    };
    let chain_used_in_period = primary
        .used_in_period
        .map(u128_to_i64_saturating)
        .unwrap_or(0);
    let max_usage = match primary.max_usage {
        Some(value) => u128_to_i64_saturating(value),
        None => {
            if discount_percent > 0.0 {
                i64::MAX
            } else {
                0
            }
        }
    };
    let has_remaining_usage =
        max_usage == i64::MAX || (max_usage > 0 && chain_used_in_period < max_usage);
    let is_active = discount_percent > 0.0 && has_remaining_usage;

    Some((
        tier,
        discount_percent,
        is_active,
        max_usage,
        chain_used_in_period,
    ))
}

// Internal helper that runs side-effecting logic for `sync_discount_state_from_owned_nfts`.
async fn sync_discount_state_from_owned_nfts(
    state: &AppState,
    contract: &str,
    user_address: &str,
    nfts: &[Nft],
) {
    let Some((tier, discount_percent, is_active, max_usage, chain_used_in_period)) =
        derive_discount_state_from_owned_nfts(nfts)
    else {
        return;
    };

    if let Err(err) = state
        .db
        .upsert_nft_discount_state_from_chain(NftDiscountStateUpsert {
            contract_address: contract,
            user_address,
            period_epoch: current_nft_period_epoch(),
            tier,
            discount_percent,
            is_active,
            max_usage,
            chain_used_in_period,
        })
        .await
    {
        tracing::warn!(
            "nft_owned failed to sync local discount fallback state: user={} contract={} err={}",
            user_address,
            contract,
            err
        );
    }
}

// Internal helper that supports `discount_contract_or_error` operations.
fn discount_contract_or_error(state: &AppState) -> Result<&str> {
    let Some(contract) = state.config.discount_soulbound_address.as_deref() else {
        return Err(crate::error::AppError::BadRequest(
            "DISCOUNT_SOULBOUND_ADDRESS is not configured".to_string(),
        ));
    };
    if contract.trim().is_empty() || contract.starts_with("0x0000") {
        return Err(crate::error::AppError::BadRequest(
            "DISCOUNT_SOULBOUND_ADDRESS is placeholder/invalid".to_string(),
        ));
    }
    Ok(contract)
}

// Internal helper that supports `discount_contract` operations.
fn discount_contract(state: &AppState) -> Option<&str> {
    state
        .config
        .discount_soulbound_address
        .as_deref()
        .filter(|addr| !addr.trim().is_empty() && !addr.starts_with("0x0000"))
}

// Internal helper that parses or transforms values for `normalize_onchain_tx_hash`.
fn normalize_onchain_tx_hash(
    tx_hash: Option<&str>,
) -> std::result::Result<Option<String>, crate::error::AppError> {
    let Some(raw) = tx_hash.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    if !raw.starts_with("0x") {
        return Err(crate::error::AppError::BadRequest(
            "onchain_tx_hash must start with 0x".to_string(),
        ));
    }
    if raw.len() > 66 {
        return Err(crate::error::AppError::BadRequest(
            "onchain_tx_hash exceeds maximum length (66)".to_string(),
        ));
    }
    if !raw[2..].chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(crate::error::AppError::BadRequest(
            "onchain_tx_hash must be hex-encoded".to_string(),
        ));
    }
    Ok(Some(raw.to_ascii_lowercase()))
}

// Internal helper that fetches data for `fetch_nft_mint_record`.
async fn fetch_nft_mint_record(state: &AppState, tx_hash: &str) -> Result<Option<NftMintRecord>> {
    let record = sqlx::query_as::<_, NftMintRecord>(
        "SELECT user_address, status, nft_tier
         FROM transactions
         WHERE tx_hash = $1 AND tx_type = 'nft_mint'",
    )
    .bind(tx_hash)
    .fetch_optional(state.db.pool())
    .await?;
    Ok(record)
}

// Internal helper that supports `insert_nft_mint_pending` operations.
async fn insert_nft_mint_pending(
    state: &AppState,
    tx_hash: &str,
    user_address: &str,
    tier: i32,
) -> Result<()> {
    let tier_value: i16 = tier
        .try_into()
        .map_err(|_| AppError::BadRequest("Invalid NFT tier".to_string()))?;
    sqlx::query(
        r#"
        INSERT INTO transactions
            (tx_hash, block_number, user_address, tx_type,
             token_in, token_out, amount_in, amount_out,
             usd_value, fee_paid, points_earned, timestamp,
             processed, status, nft_tier)
        VALUES ($1, 0, $2, 'nft_mint',
                NULL, NULL, NULL, NULL,
                NULL, NULL, $3, NOW(),
                true, 'pending', $4)
        ON CONFLICT (tx_hash) DO NOTHING
        "#,
    )
    .bind(tx_hash)
    .bind(user_address)
    .bind(Decimal::ZERO)
    .bind(tier_value)
    .execute(state.db.pool())
    .await?;
    Ok(())
}

// Internal helper that supports `update_nft_mint_status` operations.
async fn update_nft_mint_status(
    state: &AppState,
    tx_hash: &str,
    status: &str,
    block_number: Option<i64>,
    only_if_pending: bool,
) -> Result<bool> {
    let query = if only_if_pending {
        "UPDATE transactions
         SET status = $2,
             block_number = COALESCE($3, block_number)
         WHERE tx_hash = $1 AND tx_type = 'nft_mint' AND status = 'pending'"
    } else {
        "UPDATE transactions
         SET status = $2,
             block_number = COALESCE($3, block_number)
         WHERE tx_hash = $1 AND tx_type = 'nft_mint'"
    };
    let result = sqlx::query(query)
        .bind(tx_hash)
        .bind(status)
        .bind(block_number)
        .execute(state.db.pool())
        .await?;
    Ok(result.rows_affected() > 0)
}

// Internal helper that fetches data for `resolve_allowed_starknet_senders_async`.
async fn resolve_allowed_starknet_senders_async(
    state: &AppState,
    auth_subject: &str,
) -> Result<Vec<Felt>> {
    let mut out: Vec<Felt> = Vec::new();
    if let Ok(subject_felt) = parse_felt(auth_subject) {
        out.push(subject_felt);
    }

    if let Ok(linked_wallets) = state.db.list_wallet_addresses(auth_subject).await {
        for wallet in linked_wallets {
            if !wallet.chain.eq_ignore_ascii_case("starknet") {
                continue;
            }
            if let Ok(felt) = parse_felt(wallet.wallet_address.trim()) {
                if !out.contains(&felt) {
                    out.push(felt);
                }
            }
        }
    }

    if out.is_empty() {
        return Err(AppError::BadRequest(
            "No Starknet sender resolved for NFT mint verification".to_string(),
        ));
    }
    Ok(out)
}

// Internal helper that supports `verify_mint_nft_invoke_payload` operations.
fn verify_mint_nft_invoke_payload(
    tx: &StarknetTransaction,
    allowed_senders: &[Felt],
    discount_contract: Felt,
    expected_tier: i32,
) -> Result<()> {
    let invoke = match tx {
        StarknetTransaction::Invoke(invoke) => invoke,
        _ => {
            return Err(AppError::BadRequest(
                "onchain_tx_hash must be an INVOKE transaction".to_string(),
            ))
        }
    };

    let mint_selector = get_selector_from_name("mint_nft")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;

    let (sender, calldata) = match invoke {
        InvokeTransaction::V1(tx) => (tx.sender_address, tx.calldata.as_slice()),
        InvokeTransaction::V3(tx) => (tx.sender_address, tx.calldata.as_slice()),
        InvokeTransaction::V0(_) => {
            return Err(AppError::BadRequest(
                "onchain_tx_hash uses unsupported INVOKE v0".to_string(),
            ))
        }
    };

    if !allowed_senders.contains(&sender) {
        return Err(AppError::BadRequest(
            "onchain_tx_hash sender does not match authenticated Starknet user".to_string(),
        ));
    }

    let calls = parse_execute_calls(calldata)?;
    let expected_tier_felt = Felt::from(expected_tier as u64);
    for call in calls {
        if call.to != discount_contract || call.selector != mint_selector {
            continue;
        }
        if call.calldata.is_empty() {
            continue;
        }
        if call.calldata[0] == expected_tier_felt {
            return Ok(());
        }
    }

    Err(AppError::BadRequest(
        "onchain_tx_hash must include mint_nft(tier) call to discount contract".to_string(),
    ))
}

#[derive(Debug)]
enum MintReceiptStatus {
    Pending,
    Confirmed(i64),
    Failed(String),
}

// Internal helper that fetches data for `check_mint_receipt_status`.
async fn check_mint_receipt_status(state: &AppState, tx_hash: &str) -> Result<MintReceiptStatus> {
    let reader = OnchainReader::from_config(&state.config)?;
    let tx_hash_felt = parse_felt(tx_hash)?;
    match reader.get_transaction_receipt(&tx_hash_felt).await {
        Ok(receipt) => {
            if let ExecutionResult::Reverted { reason } = receipt.receipt.execution_result() {
                return Ok(MintReceiptStatus::Failed(reason.to_string()));
            }
            if matches!(
                receipt.receipt.finality_status(),
                TransactionFinalityStatus::PreConfirmed
            ) {
                return Ok(MintReceiptStatus::Pending);
            }
            Ok(MintReceiptStatus::Confirmed(
                receipt.block.block_number() as i64
            ))
        }
        Err(err) => {
            let message = err.to_string();
            let lower = message.to_ascii_lowercase();
            if lower.contains("not found") || looks_like_transient_rpc_error(&message) {
                Ok(MintReceiptStatus::Pending)
            } else {
                Err(err)
            }
        }
    }
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

#[derive(Debug, Clone, Copy)]
struct OnchainNftState {
    token_id: u128,
    tier: i32,
    discount_rate: f64,
    max_usage: u128,
    used_in_period: u128,
}

// Internal helper that fetches data for `read_discount_state_onchain`.
async fn read_discount_state_onchain(
    state: &AppState,
    contract: &str,
    user_address: &str,
) -> Result<(bool, f64)> {
    let reader = OnchainReader::from_config(&state.config)?;
    let call = FunctionCall {
        contract_address: parse_felt(contract)?,
        entry_point_selector: get_selector_from_name("has_active_discount")
            .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?,
        calldata: vec![parse_felt(user_address)?],
    };
    let result = reader.call(call).await?;
    if result.len() < 3 {
        return Ok((false, 0.0));
    }
    let active = felt_to_u128(&result[0]).unwrap_or(0) > 0;
    let discount_u128 = u256_from_felts_u128(&result[1], &result[2]).unwrap_or(0);
    Ok((active, discount_u128 as f64))
}

// Internal helper that fetches data for `read_user_nft_token_id_onchain`.
async fn read_user_nft_token_id_onchain(
    state: &AppState,
    contract: &str,
    user_address: &str,
) -> Result<u128> {
    let reader = OnchainReader::from_config(&state.config)?;
    let contract_felt = parse_felt(contract)?;
    let user_felt = parse_felt(user_address)?;
    let storage_key = get_storage_var_address("user_nft", &[user_felt]).map_err(|e| {
        crate::error::AppError::Internal(format!("Storage key resolution error: {}", e))
    })?;
    let raw_value = reader.get_storage_at(contract_felt, storage_key).await?;
    Ok(felt_to_u128(&raw_value).unwrap_or(0))
}

// Internal helper that supports `u256_calldata` operations.
fn u256_calldata(value: u128) -> [Felt; 2] {
    [Felt::from(value), Felt::from(0_u8)]
}

// Internal helper that fetches data for `read_nft_info_onchain`.
async fn read_nft_info_onchain(
    state: &AppState,
    contract: &str,
    token_id: u128,
) -> Result<OnchainNftState> {
    let reader = OnchainReader::from_config(&state.config)?;
    let [token_low, token_high] = u256_calldata(token_id);
    let call = FunctionCall {
        contract_address: parse_felt(contract)?,
        entry_point_selector: get_selector_from_name("get_nft_info")
            .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?,
        calldata: vec![token_low, token_high],
    };
    let result = reader.call(call).await?;
    if result.len() < 9 {
        return Err(crate::error::AppError::Internal(
            "get_nft_info returned malformed payload".to_string(),
        ));
    }

    let tier = felt_to_u128(&result[0]).unwrap_or(0) as i32;
    let discount_rate = u256_from_felts_u128(&result[1], &result[2]).unwrap_or(0) as f64;
    let max_usage = u256_from_felts_u128(&result[3], &result[4]).unwrap_or(0);
    let used_in_period = u256_from_felts_u128(&result[5], &result[6]).unwrap_or(0);
    let _last_reset = felt_to_u128(&result[8]).unwrap_or(0) as i64;

    Ok(OnchainNftState {
        token_id,
        tier,
        discount_rate,
        max_usage,
        used_in_period,
    })
}

// Internal helper that supports `fallback_owned_nft_from_discount_state` operations.
async fn fallback_owned_nft_from_discount_state(
    state: &AppState,
    contract: &str,
    user_address: &str,
) -> Option<Nft> {
    let read = timeout(
        Duration::from_millis(ONCHAIN_NFT_READ_TIMEOUT_MS),
        read_discount_state_onchain(state, contract, user_address),
    )
    .await;

    let (active, discount) = match read {
        Ok(Ok(value)) => value,
        Ok(Err(err)) => {
            let message = err.to_string();
            if looks_like_transient_rpc_error(&message) {
                tracing::debug!(
                    "nft_owned_discount_fallback transient rpc issue user={} contract={} err={}",
                    user_address,
                    contract,
                    message
                );
            } else {
                tracing::warn!(
                    "nft_owned_discount_fallback failed user={} contract={} err={}",
                    user_address,
                    contract,
                    message
                );
            }
            return None;
        }
        Err(_) => {
            tracing::debug!(
                "nft_owned_discount_fallback timeout user={} contract={}",
                user_address,
                contract
            );
            return None;
        }
    };

    if !active && discount <= 0.0 {
        return None;
    }

    let mut tier = tier_for_discount(discount);
    if tier <= 0 && active {
        tier = 1;
    }

    Some(Nft {
        token_id: "0x0".to_string(),
        tier,
        discount,
        expiry: 0,
        used: !active,
        max_usage: None,
        used_in_period: None,
        remaining_usage: None,
    })
}

/// POST /api/v1/nft/mint
pub async fn mint_nft(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<MintRequest>,
) -> Result<impl IntoResponse> {
    let user_address = require_starknet_user(&headers, &state).await?;
    if !(1..=5).contains(&req.tier) {
        return Err(crate::error::AppError::BadRequest(
            "Invalid tier".to_string(),
        ));
    }
    let onchain_tx_hash = normalize_onchain_tx_hash(req.onchain_tx_hash.as_deref())?;
    let tx_hash = onchain_tx_hash.ok_or_else(|| {
        crate::error::AppError::BadRequest(
            "NFT mint requires onchain_tx_hash from user-signed Starknet transaction".to_string(),
        )
    })?;

    if let Some(record) = fetch_nft_mint_record(&state, &tx_hash).await? {
        if !record.user_address.eq_ignore_ascii_case(&user_address) {
            return Err(AppError::BadRequest(
                "onchain_tx_hash is associated with a different user".to_string(),
            ));
        }
        let tier = record.nft_tier.map(|value| value as i32).or(Some(req.tier));
        let status = record.status.to_ascii_lowercase();
        if status == "confirmed" {
            let nft = tier.map(|value| Nft {
                token_id: format!("NFT_{}", tx_hash.trim_start_matches("0x")),
                tier: value,
                discount: discount_for_tier(value),
                expiry: 0,
                used: false,
                max_usage: None,
                used_in_period: None,
                remaining_usage: None,
            });
            let response = MintStatusResponse {
                status: "confirmed".to_string(),
                tx_hash: tx_hash.clone(),
                tier,
                nft,
                message: None,
            };
            return Ok((StatusCode::OK, Json(ApiResponse::success(response))));
        }
        if status == "failed" {
            let response = MintStatusResponse {
                status: "failed".to_string(),
                tx_hash: tx_hash.clone(),
                tier,
                nft: None,
                message: Some("Mint transaction failed on-chain".to_string()),
            };
            return Ok((StatusCode::OK, Json(ApiResponse::success(response))));
        }
        let response = MintStatusResponse {
            status: "pending".to_string(),
            tx_hash: tx_hash.clone(),
            tier,
            nft: None,
            message: Some("Transaction pending confirmation".to_string()),
        };
        return Ok((StatusCode::ACCEPTED, Json(ApiResponse::success(response))));
    }

    let contract = discount_contract_or_error(&state)?;
    let allowed_senders = resolve_allowed_starknet_senders_async(&state, &user_address).await?;
    let reader = OnchainReader::from_config(&state.config)?;
    let tx_hash_felt = parse_felt(&tx_hash)?;
    let contract_felt = parse_felt(contract)?;
    let tx = reader.get_transaction(&tx_hash_felt).await?;
    verify_mint_nft_invoke_payload(&tx, &allowed_senders, contract_felt, req.tier)?;

    insert_nft_mint_pending(&state, &tx_hash, &user_address, req.tier).await?;

    let response = MintStatusResponse {
        status: "pending".to_string(),
        tx_hash,
        tier: Some(req.tier),
        nft: None,
        message: Some("Transaction pending confirmation".to_string()),
    };
    Ok((StatusCode::ACCEPTED, Json(ApiResponse::success(response))))
}

/// GET /api/v1/nft/status/:tx_hash
pub async fn get_mint_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(tx_hash_raw): Path<String>,
) -> Result<impl IntoResponse> {
    let user_address = require_starknet_user(&headers, &state).await?;
    let tx_hash = normalize_onchain_tx_hash(Some(&tx_hash_raw))?
        .ok_or_else(|| AppError::BadRequest("Invalid tx_hash".to_string()))?;

    let Some(record) = fetch_nft_mint_record(&state, &tx_hash).await? else {
        return Err(AppError::NotFound(
            "NFT mint transaction not found".to_string(),
        ));
    };
    if !record.user_address.eq_ignore_ascii_case(&user_address) {
        return Err(AppError::BadRequest(
            "onchain_tx_hash is associated with a different user".to_string(),
        ));
    }

    let tier = record.nft_tier.map(|value| value as i32);
    let status = record.status.to_ascii_lowercase();
    if status == "confirmed" {
        let nft = tier.map(|value| Nft {
            token_id: format!("NFT_{}", tx_hash.trim_start_matches("0x")),
            tier: value,
            discount: discount_for_tier(value),
            expiry: 0,
            used: false,
            max_usage: None,
            used_in_period: None,
            remaining_usage: None,
        });
        let response = MintStatusResponse {
            status: "confirmed".to_string(),
            tx_hash,
            tier,
            nft,
            message: None,
        };
        return Ok((StatusCode::OK, Json(ApiResponse::success(response))));
    }

    if status == "failed" {
        let response = MintStatusResponse {
            status: "failed".to_string(),
            tx_hash,
            tier,
            nft: None,
            message: Some("Mint transaction failed on-chain".to_string()),
        };
        return Ok((StatusCode::OK, Json(ApiResponse::success(response))));
    }

    match check_mint_receipt_status(&state, &tx_hash).await? {
        MintReceiptStatus::Pending => {
            let response = MintStatusResponse {
                status: "pending".to_string(),
                tx_hash,
                tier,
                nft: None,
                message: Some("Transaction pending confirmation".to_string()),
            };
            Ok((StatusCode::ACCEPTED, Json(ApiResponse::success(response))))
        }
        MintReceiptStatus::Failed(reason) => {
            let _ = update_nft_mint_status(&state, &tx_hash, "failed", None, true).await?;
            let response = MintStatusResponse {
                status: "failed".to_string(),
                tx_hash,
                tier,
                nft: None,
                message: Some(format!("Mint transaction reverted: {}", reason)),
            };
            Ok((StatusCode::OK, Json(ApiResponse::success(response))))
        }
        MintReceiptStatus::Confirmed(block_number) => {
            let updated =
                update_nft_mint_status(&state, &tx_hash, "confirmed", Some(block_number), true)
                    .await?;
            if let Some(tier_value) = tier {
                if updated {
                    let cost_points = points_cost_for_tier(tier_value);
                    if cost_points > 0 {
                        let current_epoch = chrono::Utc::now().timestamp() / EPOCH_DURATION_SECONDS;
                        if let Err(err) = state
                            .db
                            .consume_points(
                                &user_address,
                                current_epoch,
                                rust_decimal::Decimal::from_i64(cost_points).unwrap(),
                            )
                            .await
                        {
                            tracing::warn!(
                                "NFT confirmed but failed to consume off-chain points: user={}, tier={}, error={}",
                                user_address,
                                tier_value,
                                err
                            );
                        }
                    }
                }
            }

            if let Some(contract) = discount_contract(&state) {
                invalidate_cached_owned_nfts(contract, &user_address).await;
            }

            let nft = tier.map(|value| Nft {
                token_id: format!("NFT_{}", tx_hash.trim_start_matches("0x")),
                tier: value,
                discount: discount_for_tier(value),
                expiry: 0,
                used: false,
                max_usage: None,
                used_in_period: None,
                remaining_usage: None,
            });

            let response = MintStatusResponse {
                status: "confirmed".to_string(),
                tx_hash,
                tier,
                nft,
                message: None,
            };
            Ok((StatusCode::OK, Json(ApiResponse::success(response))))
        }
    }
}

/// GET /api/v1/nft/owned
pub async fn get_owned_nfts(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<Nft>>>> {
    let user_address = require_starknet_user(&headers, &state).await?;
    let Some(contract) = discount_contract(&state) else {
        return Ok(Json(ApiResponse::success(Vec::new())));
    };
    let cache_key = owned_nft_cache_key(contract, &user_address);
    if let Some(cached) =
        get_cached_owned_nfts(&cache_key, Duration::from_secs(OWNED_NFT_CACHE_TTL_SECS)).await
    {
        sync_discount_state_from_owned_nfts(&state, contract, &user_address, &cached).await;
        return Ok(Json(ApiResponse::success(cached)));
    }

    let fetch_lock = owned_nft_fetch_lock_for(&cache_key).await;
    let _guard = fetch_lock.lock().await;
    if let Some(cached) =
        get_cached_owned_nfts(&cache_key, Duration::from_secs(OWNED_NFT_CACHE_TTL_SECS)).await
    {
        sync_discount_state_from_owned_nfts(&state, contract, &user_address, &cached).await;
        return Ok(Json(ApiResponse::success(cached)));
    }

    match get_owned_nfts_uncached(&state, contract, &user_address).await {
        Ok(nfts) => {
            if nfts.is_empty() {
                if let Some(stale) = get_cached_owned_nfts(
                    &cache_key,
                    Duration::from_secs(OWNED_NFT_CACHE_STALE_SECS),
                )
                .await
                {
                    tracing::debug!(
                        "nft_owned returning stale cache due empty refresh user={} contract={}",
                        user_address,
                        contract
                    );
                    sync_discount_state_from_owned_nfts(&state, contract, &user_address, &stale)
                        .await;
                    return Ok(Json(ApiResponse::success(stale)));
                }
            }
            cache_owned_nfts(cache_key, nfts.clone()).await;
            sync_discount_state_from_owned_nfts(&state, contract, &user_address, &nfts).await;
            Ok(Json(ApiResponse::success(nfts)))
        }
        Err(err) => {
            if let Some(stale) =
                get_cached_owned_nfts(&cache_key, Duration::from_secs(OWNED_NFT_CACHE_STALE_SECS))
                    .await
            {
                tracing::debug!(
                    "nft_owned returning stale cache fallback user={} contract={}",
                    user_address,
                    contract
                );
                sync_discount_state_from_owned_nfts(&state, contract, &user_address, &stale).await;
                return Ok(Json(ApiResponse::success(stale)));
            }
            Err(err)
        }
    }
}

// Internal helper that fetches data for `get_owned_nfts_uncached`.
async fn get_owned_nfts_uncached(
    state: &AppState,
    contract: &str,
    user_address: &str,
) -> Result<Vec<Nft>> {
    let token_id = match timeout(
        Duration::from_millis(ONCHAIN_NFT_READ_TIMEOUT_MS),
        read_user_nft_token_id_onchain(state, contract, user_address),
    )
    .await
    {
        Ok(Ok(value)) => value,
        Ok(Err(err)) => {
            let message = err.to_string();
            if looks_like_transient_rpc_error(&message) {
                tracing::debug!(
                    "nft_owned_token_lookup transient rpc issue user={} contract={} err={}",
                    user_address,
                    contract,
                    message
                );
            } else {
                tracing::warn!(
                    "nft_owned_token_lookup failed user={} contract={} err={}",
                    user_address,
                    contract,
                    message
                );
            }
            if let Some(nft) =
                fallback_owned_nft_from_discount_state(state, contract, user_address).await
            {
                return Ok(vec![nft]);
            }
            return Ok(Vec::new());
        }
        Err(_) => {
            tracing::debug!(
                "nft_owned_token_lookup timeout user={} contract={}",
                user_address,
                contract
            );
            if let Some(nft) =
                fallback_owned_nft_from_discount_state(state, contract, user_address).await
            {
                return Ok(vec![nft]);
            }
            return Ok(Vec::new());
        }
    };
    if token_id == 0 {
        if let Some(nft) =
            fallback_owned_nft_from_discount_state(state, contract, user_address).await
        {
            return Ok(vec![nft]);
        }
        return Ok(Vec::new());
    }

    let nft_state = match timeout(
        Duration::from_millis(ONCHAIN_NFT_READ_TIMEOUT_MS),
        read_nft_info_onchain(state, contract, token_id),
    )
    .await
    {
        Ok(Ok(value)) => value,
        Ok(Err(err)) => {
            let message = err.to_string();
            if looks_like_transient_rpc_error(&message) {
                tracing::debug!(
                    "nft_owned_info transient rpc issue user={} contract={} token_id={} err={}",
                    user_address,
                    contract,
                    token_id,
                    message
                );
            } else {
                tracing::warn!(
                    "nft_owned_info failed user={} contract={} token_id={} err={}",
                    user_address,
                    contract,
                    token_id,
                    message
                );
            }
            if let Some(nft) =
                fallback_owned_nft_from_discount_state(state, contract, user_address).await
            {
                return Ok(vec![nft]);
            }
            return Ok(Vec::new());
        }
        Err(_) => {
            tracing::debug!(
                "nft_owned_info timeout user={} contract={} token_id={}",
                user_address,
                contract,
                token_id
            );
            if let Some(nft) =
                fallback_owned_nft_from_discount_state(state, contract, user_address).await
            {
                return Ok(vec![nft]);
            }
            return Ok(Vec::new());
        }
    };

    let fallback_active = nft_state.max_usage > 0 && nft_state.used_in_period < nft_state.max_usage;
    let fallback_discount = if fallback_active {
        nft_state.discount_rate
    } else {
        0.0
    };

    let (active, onchain_discount) = match timeout(
        Duration::from_millis(ONCHAIN_NFT_READ_TIMEOUT_MS),
        read_discount_state_onchain(state, contract, user_address),
    )
    .await
    {
        Ok(Ok(value)) => value,
        Ok(Err(err)) => {
            let message = err.to_string();
            if looks_like_transient_rpc_error(&message) {
                tracing::debug!(
                    "nft_owned_active_lookup transient rpc issue user={} contract={} token_id={} err={}",
                    user_address,
                    contract,
                    token_id,
                    message
                );
            } else {
                tracing::warn!(
                    "nft_owned_active_lookup failed user={} contract={} token_id={} err={}",
                    user_address,
                    contract,
                    token_id,
                    message
                );
            }
            (fallback_active, fallback_discount)
        }
        Err(_) => {
            tracing::debug!(
                "nft_owned_active_lookup timeout user={} contract={} token_id={}",
                user_address,
                contract,
                token_id
            );
            (fallback_active, fallback_discount)
        }
    };

    let tier = if nft_state.tier > 0 {
        nft_state.tier
    } else {
        tier_for_discount(nft_state.discount_rate)
    };
    let display_discount = if nft_state.discount_rate > 0.0 {
        nft_state.discount_rate
    } else {
        onchain_discount
    };
    tracing::info!(
        "nft_owned_check user={} token_id={} active={} tier={} discount={} used_in_period={} max_usage={}",
        user_address,
        nft_state.token_id,
        active,
        tier,
        display_discount,
        nft_state.used_in_period,
        nft_state.max_usage
    );

    let nfts = vec![Nft {
        token_id: format!("0x{:x}", nft_state.token_id),
        tier,
        discount: display_discount,
        expiry: 0,
        used: !active,
        max_usage: Some(nft_state.max_usage),
        used_in_period: Some(nft_state.used_in_period),
        remaining_usage: Some(nft_state.max_usage.saturating_sub(nft_state.used_in_period)),
    }];
    Ok(nfts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    // Internal helper that supports `discount_for_tier_defaults_to_zero` operations.
    fn discount_for_tier_defaults_to_zero() {
        // Memastikan tier di luar range memakai diskon 0
        assert_eq!(discount_for_tier(99), 0.0);
    }

    #[test]
    // Internal helper that supports `discount_for_tier_returns_exact_value` operations.
    fn discount_for_tier_returns_exact_value() {
        // Memastikan tier 3 memakai konstanta yang benar
        assert_eq!(discount_for_tier(3), NFT_TIER_3_DISCOUNT);
    }
}
