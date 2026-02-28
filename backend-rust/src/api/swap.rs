use super::{
    onchain_privacy::{
        verify_onchain_hide_balance_invoke_tx, HideBalanceFlow,
        PrivacyVerificationPayload as OnchainPrivacyPayload,
    },
    privacy::{
        bind_intent_hash_into_payload, ensure_public_inputs_bind_nullifier_commitment,
        ensure_public_inputs_bind_root_nullifier, generate_auto_garaga_payload,
        AutoPrivacyPayloadResponse, AutoPrivacyTxContext,
    },
    require_starknet_user, require_user, AppState,
};
use crate::services::onchain::{felt_to_u128, parse_felt, u256_from_felts, OnchainReader};
use crate::{
    constants::{
        token_address_for, DEX_EKUBO, DEX_HAIKO, EPOCH_DURATION_SECONDS, POINTS_MIN_USD_SWAP,
        POINTS_MIN_USD_SWAP_TESTNET, POINTS_PER_USD_SWAP,
    },
    db::NftDiscountStateUpsert,
    error::{AppError, Result},
    models::{ApiResponse, StarknetWalletCall, SwapQuoteRequest, SwapQuoteResponse},
    services::gas_optimizer::GasOptimizer,
    services::nft_discount::consume_nft_usage,
    services::notification_service::NotificationType,
    services::price_guard::{
        fallback_price_for, first_sane_price, sanitize_points_usd_base, sanitize_usd_notional,
        symbol_candidates_for,
    },
    services::privacy_verifier::parse_privacy_verifier_kind,
    services::relayer::RelayerService,
    services::LiquidityAggregator,
    services::NotificationService,
};
use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use starknet_core::types::{
    Call, ExecutionResult, Felt, FunctionCall, InvokeTransaction, Transaction,
    TransactionFinalityStatus,
};
use starknet_core::utils::{get_selector_from_name, get_storage_var_address};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::sync::OnceLock;
use std::time::Instant;
use tokio::time::{sleep, timeout, Duration};

const ORACLE_ROUTE_DEX_ID_HEX: &str = "0x4f52434c"; // 'ORCL'
const ONCHAIN_DISCOUNT_TIMEOUT_MS: u64 = 2_500;
const NFT_DISCOUNT_CACHE_TTL_SECS: u64 = 300;
const NFT_DISCOUNT_CACHE_STALE_SECS: u64 = 1_800;
const NFT_DISCOUNT_CACHE_MAX_ENTRIES: usize = 100_000;
const AI_LEVEL_2_POINTS_BONUS_PERCENT: f64 = 20.0;
const AI_LEVEL_3_POINTS_BONUS_PERCENT: f64 = 40.0;

#[derive(Clone, Copy)]
struct CachedNftDiscount {
    fetched_at: Instant,
    discount: f64,
}

static NFT_DISCOUNT_CACHE: OnceLock<tokio::sync::RwLock<HashMap<String, CachedNftDiscount>>> =
    OnceLock::new();

// Internal helper that supports `nft_discount_cache` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn nft_discount_cache() -> &'static tokio::sync::RwLock<HashMap<String, CachedNftDiscount>> {
    NFT_DISCOUNT_CACHE.get_or_init(|| tokio::sync::RwLock::new(HashMap::new()))
}

// Internal helper that supports `nft_discount_cache_key` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn nft_discount_cache_key(contract: &str, user: &str) -> String {
    format!(
        "{}|{}",
        contract.trim().to_ascii_lowercase(),
        user.trim().to_ascii_lowercase()
    )
}

// Internal helper that fetches data for `get_cached_nft_discount` in the swap flow.
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

// Internal helper that supports `cache_nft_discount` operations in the swap flow.
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

#[derive(Debug, Deserialize)]
pub struct PrivacyVerificationPayload {
    pub verifier: Option<String>,
    pub note_version: Option<String>,
    pub root: Option<String>,
    pub nullifier: Option<String>,
    pub commitment: Option<String>,
    pub note_commitment: Option<String>,
    pub denom_id: Option<String>,
    pub spendable_at_unix: Option<u64>,
    pub proof: Option<Vec<String>>,
    pub public_inputs: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct ExecuteSwapRequest {
    pub from_token: String,
    pub to_token: String,
    pub amount: String,
    pub min_amount_out: String,
    pub slippage: f64,
    pub deadline: i64,
    pub recipient: Option<String>,
    pub onchain_tx_hash: Option<String>,
    pub hide_balance: Option<bool>,
    pub privacy: Option<PrivacyVerificationPayload>,
    pub mode: String, // "private" or "transparent"
}

#[derive(Debug, Serialize)]
pub struct ExecuteSwapResponse {
    pub tx_hash: String,
    pub status: String,
    pub from_amount: String,
    pub to_amount: String,
    pub actual_rate: String,
    pub fee_paid: String,
    pub fee_before_discount: String,
    pub fee_discount_saved: String,
    pub nft_discount_percent: String,
    pub estimated_points_earned: String,
    pub points_pending: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub privacy_tx_hash: Option<String>,
}

// Internal helper that supports `env_flag` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
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

// Internal helper that supports `hide_balance_relayer_pool_enabled` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn hide_balance_relayer_pool_enabled() -> bool {
    env_flag("HIDE_BALANCE_RELAYER_POOL_ENABLED", false)
}

// Internal helper that supports `hide_balance_strict_privacy_mode_enabled` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn hide_balance_strict_privacy_mode_enabled() -> bool {
    env_flag("HIDE_BALANCE_STRICT_PRIVACY_MODE", false)
}

fn hide_balance_v2_redeem_only_enabled() -> bool {
    env_flag("HIDE_BALANCE_V2_REDEEM_ONLY", false)
}

fn hide_balance_min_note_age_secs() -> u64 {
    std::env::var("HIDE_BALANCE_MIN_NOTE_AGE_SECS")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(3600)
}

// Internal helper that supports `resolve_swap_final_recipient` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn resolve_swap_final_recipient(
    requested_recipient: Option<&str>,
    user_address: &str,
    hide_mode: bool,
    strict_privacy_mode: bool,
) -> Result<String> {
    let requested = requested_recipient
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    let default_hide_recipient = std::env::var("HIDE_BALANCE_DEFAULT_RECIPIENT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if !hide_mode {
        return Ok(requested.unwrap_or_else(|| user_address.to_string()));
    }

    let final_recipient = requested
        .or(default_hide_recipient)
        .unwrap_or_else(|| user_address.to_string());

    if strict_privacy_mode {
        let recipient_lower = final_recipient.trim().to_ascii_lowercase();
        let user_lower = user_address.trim().to_ascii_lowercase();
        if recipient_lower == user_lower {
            return Err(AppError::BadRequest(
                "Hide Balance strict mode: recipient must be different from depositor address."
                    .to_string(),
            ));
        }
    }

    Ok(final_recipient)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum HideExecutorKind {
    PrivateActionExecutorV1,
    ShieldedPoolV2,
    ShieldedPoolV3,
}

// Internal helper that supports `hide_executor_kind` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn hide_executor_kind() -> HideExecutorKind {
    let raw = std::env::var("HIDE_BALANCE_EXECUTOR_KIND")
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if matches!(raw.as_str(), "shielded_pool_v3" | "shielded-v3" | "v3") {
        HideExecutorKind::ShieldedPoolV3
    } else if matches!(raw.as_str(), "shielded_pool_v2" | "shielded-v2" | "v2") {
        HideExecutorKind::ShieldedPoolV2
    } else {
        HideExecutorKind::PrivateActionExecutorV1
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum HidePoolVersion {
    V2,
    V3,
}

fn hide_balance_pool_version_default() -> HidePoolVersion {
    let raw = std::env::var("HIDE_BALANCE_POOL_VERSION_DEFAULT")
        .unwrap_or_else(|_| "v2".to_string())
        .trim()
        .to_ascii_lowercase();
    if raw == "v3" {
        HidePoolVersion::V3
    } else {
        HidePoolVersion::V2
    }
}

fn resolve_hide_pool_version(payload: Option<&PrivacyVerificationPayload>) -> HidePoolVersion {
    if let Some(note_version) = payload
        .and_then(|value| value.note_version.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if note_version.eq_ignore_ascii_case("v3") {
            return HidePoolVersion::V3;
        }
        if note_version.eq_ignore_ascii_case("v2") {
            return HidePoolVersion::V2;
        }
    }
    hide_balance_pool_version_default()
}

// Internal helper that fetches data for `resolve_private_action_executor_felt` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn read_env_value_from_paths(paths: &[&str], key: &str) -> Option<String> {
    for path in paths {
        let Ok(content) = fs::read_to_string(path) else {
            continue;
        };
        for raw_line in content.lines() {
            let line = raw_line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let Some((raw_key, raw_value)) = line.split_once('=') else {
                continue;
            };
            if raw_key.trim() != key {
                continue;
            }
            let mut value = raw_value.trim().to_string();
            if (value.starts_with('"') && value.ends_with('"'))
                || (value.starts_with('\'') && value.ends_with('\''))
            {
                value = value[1..value.len().saturating_sub(1)].to_string();
            }
            if !value.trim().is_empty() {
                return Some(value.trim().to_string());
            }
        }
    }
    None
}

// Internal helper that fetches data for `resolve_private_action_executor_felt` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn resolve_private_action_executor_candidates(config: &crate::config::Config) -> Result<Vec<Felt>> {
    let mut raw_candidates: Vec<String> = Vec::new();
    raw_candidates.extend(
        [
            std::env::var("PRIVATE_ACTION_EXECUTOR_ADDRESS").ok(),
            std::env::var("NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS").ok(),
            read_env_value_from_paths(
                &[".env", "backend-rust/.env"],
                "PRIVATE_ACTION_EXECUTOR_ADDRESS",
            ),
            read_env_value_from_paths(
                &[
                    ".env",
                    "backend-rust/.env",
                    "frontend/.env.local",
                    "frontend/.env",
                    "../frontend/.env.local",
                    "../frontend/.env",
                ],
                "NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS",
            ),
            config.privacy_router_address.clone(),
        ]
        .into_iter()
        .flatten(),
    );

    let mut out: Vec<Felt> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for raw in raw_candidates {
        let trimmed = raw.trim();
        if trimmed.is_empty() || trimmed.starts_with("0x0000") {
            continue;
        }
        match parse_felt(trimmed) {
            Ok(parsed) => {
                let key = parsed.to_string().to_ascii_lowercase();
                if seen.insert(key) {
                    out.push(parsed);
                }
            }
            Err(err) => {
                tracing::warn!(
                    "Ignoring invalid PrivateActionExecutor candidate '{}': {}",
                    trimmed,
                    err
                );
            }
        }
    }

    if !out.is_empty() {
        return Ok(out);
    }

    Err(AppError::BadRequest(
        "PrivateActionExecutor is not configured. Set PRIVATE_ACTION_EXECUTOR_ADDRESS.".to_string(),
    ))
}

// Internal helper that supports `is_missing_entrypoint_error` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn is_missing_entrypoint_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    if lower.contains("entry_point_not_found") {
        return true;
    }
    let mentions_entrypoint =
        lower.contains("entrypoint") || lower.contains("entry point") || lower.contains("selector");
    let mentions_missing = lower.contains("does not exist")
        || lower.contains("not found")
        || lower.contains("missing");
    mentions_entrypoint && mentions_missing
}

// Internal helper that checks conditions for `is_transient_probe_error` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn is_transient_probe_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("timeout")
        || lower.contains("timed out")
        || lower.contains("too many requests")
        || lower.contains("429")
        || lower.contains("gateway")
        || lower.contains("temporarily unavailable")
        || lower.contains("invalid peer certificate")
        || lower.contains("unknownissuer")
        || lower.contains("connection reset")
        || lower.contains("network")
}

// Internal helper that checks whether an RPC error is a contract-side revert during selector probing.
// Such errors still indicate the selector exists and should be treated as "supported".
fn is_contract_revert_probe_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("contracterror")
        || lower.contains("contract error")
        || lower.contains("revert_error")
        || lower.contains("execution_error")
        || lower.contains("innercontractexecutionerror")
        || lower.contains("sender required")
}

// Internal helper that supports `shielded_executor_supports_deposit_fixed_for` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn shielded_executor_supports_deposit_fixed_for(
    state: &AppState,
    executor: Felt,
) -> Result<bool> {
    let reader = OnchainReader::from_config(&state.config)?;
    let selector = get_selector_from_name("deposit_fixed_for")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let probe = reader
        .call(FunctionCall {
            contract_address: executor,
            entry_point_selector: selector,
            calldata: vec![Felt::ONE, Felt::ONE, Felt::ONE, Felt::ONE],
        })
        .await;
    match probe {
        Ok(_) => Ok(true),
        Err(AppError::BlockchainRPC(message)) => {
            if is_missing_entrypoint_error(&message) {
                Ok(false)
            } else if is_contract_revert_probe_error(&message) {
                tracing::info!(
                    "ShieldedPoolV2 probe for executor {} returned contract revert (treated as supported): {}",
                    executor,
                    message
                );
                Ok(true)
            } else if is_transient_probe_error(&message) {
                Err(AppError::BlockchainRPC(format!(
                    "Failed to probe ShieldedPoolV2 executor {}: {}",
                    executor, message
                )))
            } else {
                // Any non-missing-entrypoint revert still proves the selector exists.
                tracing::info!(
                    "ShieldedPoolV2 probe for executor {} returned non-entrypoint error (treated as supported): {}",
                    executor,
                    message
                );
                Ok(true)
            }
        }
        Err(err) => Err(err),
    }
}

async fn shielded_executor_supports_deposit_fixed_v3(
    state: &AppState,
    executor: Felt,
) -> Result<bool> {
    let reader = OnchainReader::from_config(&state.config)?;
    let selector = get_selector_from_name("deposit_fixed_v3")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let probe = reader
        .call(FunctionCall {
            contract_address: executor,
            entry_point_selector: selector,
            calldata: vec![Felt::ONE, Felt::ONE, Felt::ONE, Felt::ONE],
        })
        .await;
    match probe {
        Ok(_) => Ok(true),
        Err(AppError::BlockchainRPC(message)) => {
            if is_missing_entrypoint_error(&message) {
                Ok(false)
            } else if is_contract_revert_probe_error(&message) {
                tracing::info!(
                    "ShieldedPoolV3 probe for executor {} returned contract revert (treated as supported): {}",
                    executor,
                    message
                );
                Ok(true)
            } else if is_transient_probe_error(&message) {
                Err(AppError::BlockchainRPC(format!(
                    "Failed to probe ShieldedPoolV3 executor {}: {}",
                    executor, message
                )))
            } else {
                tracing::info!(
                    "ShieldedPoolV3 probe for executor {} returned non-entrypoint error (treated as supported): {}",
                    executor,
                    message
                );
                Ok(true)
            }
        }
        Err(err) => Err(err),
    }
}

// Internal helper that fetches data for `resolve_private_action_executor_felt_for_swap_hide` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn resolve_private_action_executor_felt_for_swap_hide(state: &AppState) -> Result<Felt> {
    let candidates = resolve_private_action_executor_candidates(&state.config)?;
    if hide_executor_kind() == HideExecutorKind::PrivateActionExecutorV1 {
        let selected = candidates[0];
        tracing::info!("Using private executor {} for swap hide mode", selected);
        return Ok(selected);
    }

    let mut unsupported: Vec<String> = Vec::new();
    for candidate in candidates {
        if hide_executor_kind() == HideExecutorKind::ShieldedPoolV2 {
            if shielded_executor_supports_deposit_fixed_for(state, candidate).await? {
                tracing::info!(
                    "Using ShieldedPoolV2 executor {} for swap hide mode",
                    candidate
                );
                return Ok(candidate);
            }
            tracing::warn!(
                "Skipping outdated ShieldedPoolV2 executor candidate {} (missing deposit_fixed_for)",
                candidate
            );
            unsupported.push(candidate.to_string());
            continue;
        }

        if shielded_executor_supports_deposit_fixed_v3(state, candidate).await? {
            tracing::info!(
                "Using ShieldedPoolV3 executor {} for swap hide mode",
                candidate
            );
            return Ok(candidate);
        }
        tracing::warn!(
            "Skipping outdated ShieldedPoolV3 executor candidate {} (missing deposit_fixed_v3)",
            candidate
        );
        unsupported.push(candidate.to_string());
    }

    if hide_executor_kind() == HideExecutorKind::ShieldedPoolV3 {
        return Err(AppError::BadRequest(format!(
            "Configured ShieldedPoolV3 executor is outdated (missing deposit_fixed_v3): {}. Redeploy latest ShieldedPoolV3 and set PRIVATE_ACTION_EXECUTOR_ADDRESS.",
            unsupported.join(", ")
        )));
    }

    Err(AppError::BadRequest(format!(
        "Configured ShieldedPoolV2 executor is outdated (missing deposit_fixed_for): {}. Redeploy latest ShieldedPoolV2 and set PRIVATE_ACTION_EXECUTOR_ADDRESS.",
        unsupported.join(", ")
    )))
}

// Internal helper that parses or transforms values for `normalize_hex_items` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn normalize_hex_items(items: &[String]) -> Vec<String> {
    items
        .iter()
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn configured_root_public_input_index() -> usize {
    std::env::var("GARAGA_ROOT_PUBLIC_INPUT_INDEX")
        .ok()
        .and_then(|raw| raw.trim().parse::<usize>().ok())
        .unwrap_or(0)
}

fn infer_v3_root_from_public_inputs(public_inputs: &[String]) -> Option<String> {
    let index = configured_root_public_input_index();
    let candidate = public_inputs.get(index)?.trim();
    if candidate.is_empty() {
        return None;
    }
    if parse_felt(candidate).is_err() {
        return None;
    }
    Some(candidate.to_string())
}

fn configured_v3_nullifier_public_input_index() -> usize {
    std::env::var("GARAGA_NULLIFIER_PUBLIC_INPUT_INDEX_V3")
        .ok()
        .and_then(|raw| raw.trim().parse::<usize>().ok())
        .unwrap_or(1)
}

fn configured_v3_action_hash_public_input_index() -> usize {
    std::env::var("GARAGA_INTENT_HASH_PUBLIC_INPUT_INDEX")
        .ok()
        .and_then(|raw| raw.trim().parse::<usize>().ok())
        .unwrap_or(2)
}

fn ensure_v3_payload_public_inputs_shape(
    payload: &AutoPrivacyPayloadResponse,
    source_label: &str,
) -> Result<()> {
    let legacy_compat = std::env::var("HIDE_BALANCE_V3_LEGACY_VERIFIER_COMPAT")
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false);
    let root_index = configured_root_public_input_index();
    let nullifier_index = configured_v3_nullifier_public_input_index();
    if legacy_compat {
        let required_len = std::cmp::max(root_index, nullifier_index) + 1;
        if payload.public_inputs.len() < required_len {
            return Err(AppError::BadRequest(format!(
                "{} must expose root/nullifier in public_inputs indexes [{}, {}], but public_inputs length is {}",
                source_label,
                root_index,
                nullifier_index,
                payload.public_inputs.len()
            )));
        }
        return Ok(());
    }
    let action_hash_index = configured_v3_action_hash_public_input_index();
    let required_len = std::cmp::max(
        std::cmp::max(root_index, nullifier_index),
        action_hash_index,
    ) + 1;

    if payload.public_inputs.len() < required_len {
        return Err(AppError::BadRequest(format!(
            "{} V3 verifier output too short: public_inputs length is {}, required >= {} (root={}, nullifier={}, action_hash={}). Regenerate Garaga proving key/verifier with at least [root, nullifier, action_hash] outputs.",
            source_label,
            payload.public_inputs.len(),
            required_len,
            root_index,
            nullifier_index,
            action_hash_index
        )));
    }

    let _ = parse_felt(payload.public_inputs[action_hash_index].trim()).map_err(|_| {
        AppError::BadRequest(format!(
            "{} contains invalid action-hash felt at public_inputs[{}]",
            source_label, action_hash_index
        ))
    })?;
    Ok(())
}

fn normalize_v3_public_inputs_binding(payload: &mut AutoPrivacyPayloadResponse) -> Result<()> {
    let root = payload.root.as_deref().ok_or_else(|| {
        AppError::BadRequest("Hide Balance V3 requires privacy.root".to_string())
    })?;
    let expected_root = parse_felt(root.trim())?;
    let expected_nullifier = parse_felt(payload.nullifier.trim())?;
    let root_index = configured_root_public_input_index();
    let nullifier_index = configured_v3_nullifier_public_input_index();
    let required_len = std::cmp::max(root_index, nullifier_index) + 1;
    while payload.public_inputs.len() < required_len {
        payload.public_inputs.push("0x0".to_string());
    }
    payload.public_inputs[root_index] = expected_root.to_string();
    payload.public_inputs[nullifier_index] = expected_nullifier.to_string();
    Ok(())
}

fn ensure_v3_payload_root(
    payload: &mut AutoPrivacyPayloadResponse,
    tx_context: &AutoPrivacyTxContext,
) {
    // For V3 spend flows, always prefer the executor on-chain root captured in tx_context.
    // This prevents stale/off-by-one roots from cached frontend payloads or prover output.
    if let Some(root) = tx_context
        .root
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        payload.root = Some(root.to_string());
        return;
    }

    let has_root = payload
        .root
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some();
    if has_root {
        return;
    }

    payload.root = infer_v3_root_from_public_inputs(&payload.public_inputs);
}

// Internal helper that supports `payload_from_request` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn payload_from_request(
    payload: Option<&PrivacyVerificationPayload>,
    verifier: &str,
) -> Option<AutoPrivacyPayloadResponse> {
    let payload = payload?;
    let nullifier = payload.nullifier.as_deref()?.trim();
    if nullifier.is_empty() {
        return None;
    }
    let commitment = payload
        .commitment
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("0x0");
    let proof = normalize_hex_items(payload.proof.as_ref()?);
    let public_inputs = normalize_hex_items(payload.public_inputs.as_ref()?);
    if proof.is_empty() || public_inputs.is_empty() {
        return None;
    }
    if proof.len() == 1
        && public_inputs.len() == 1
        && proof[0].eq_ignore_ascii_case("0x1")
        && public_inputs[0].eq_ignore_ascii_case("0x1")
    {
        return None;
    }
    let note_version = payload
        .note_version
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let mut root = payload
        .root
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    if root.is_none()
        && note_version
            .as_deref()
            .map(|value| value.eq_ignore_ascii_case("v3"))
            .unwrap_or(false)
    {
        root = infer_v3_root_from_public_inputs(&public_inputs);
    }

    Some(AutoPrivacyPayloadResponse {
        verifier: payload
            .verifier
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(verifier)
            .to_string(),
        nullifier: nullifier.to_string(),
        commitment: commitment.to_string(),
        executor_address: None,
        root,
        note_version,
        note_commitment: payload
            .note_commitment
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        denom_id: payload
            .denom_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        spendable_at_unix: payload.spendable_at_unix,
        proof,
        public_inputs,
    })
}

// Internal helper that builds inputs for `build_swap_executor_action_calldata` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn build_swap_executor_action_calldata(
    context: &OnchainSwapContext,
    mev_protected: bool,
) -> Vec<Felt> {
    let mev_flag = if mev_protected { Felt::ONE } else { Felt::ZERO };
    vec![
        context.route.dex_id,
        context.route.expected_amount_out_low,
        context.route.expected_amount_out_high,
        context.route.min_amount_out_low,
        context.route.min_amount_out_high,
        context.from_token,
        context.to_token,
        context.amount_low,
        context.amount_high,
        mev_flag,
    ]
}

// Internal helper that builds inputs for `build_submit_private_intent_call` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn build_submit_private_intent_call(
    executor: Felt,
    payload: &AutoPrivacyPayloadResponse,
) -> Result<Call> {
    let kind = hide_executor_kind();
    let selector_name = match kind {
        HideExecutorKind::PrivateActionExecutorV1 => "submit_private_intent",
        HideExecutorKind::ShieldedPoolV2 => "submit_private_action",
        HideExecutorKind::ShieldedPoolV3 => "submit_private_swap",
    };
    let selector = get_selector_from_name(selector_name)
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;

    let proof: Vec<Felt> = payload
        .proof
        .iter()
        .map(|felt| parse_felt(felt))
        .collect::<Result<Vec<_>>>()?;
    let mut calldata: Vec<Felt>;
    if kind == HideExecutorKind::ShieldedPoolV3 {
        let root = payload.root.as_deref().ok_or_else(|| {
            AppError::BadRequest("Hide Balance V3 requires privacy.root".to_string())
        })?;
        calldata = Vec::with_capacity(3 + proof.len());
        calldata.push(parse_felt(root.trim())?);
        calldata.push(parse_felt(payload.nullifier.trim())?);
        calldata.push(Felt::from(proof.len() as u64));
        calldata.extend(proof);
    } else {
        let public_inputs: Vec<Felt> = payload
            .public_inputs
            .iter()
            .map(|felt| parse_felt(felt))
            .collect::<Result<Vec<_>>>()?;
        calldata = Vec::with_capacity(4 + proof.len() + public_inputs.len());
        calldata.push(parse_felt(payload.nullifier.trim())?);
        calldata.push(parse_felt(payload.commitment.trim())?);
        calldata.push(Felt::from(proof.len() as u64));
        calldata.extend(proof);
        calldata.push(Felt::from(public_inputs.len() as u64));
        calldata.extend(public_inputs);
    }

    Ok(Call {
        to: executor,
        selector,
        calldata,
    })
}

// Internal helper that builds inputs for `build_execute_private_swap_with_payout_call` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
struct SwapPayoutCallInput<'a> {
    action_target: Felt,
    action_selector: Felt,
    action_calldata: &'a [Felt],
    approval_token: Felt,
    payout_token: Felt,
    recipient: Felt,
    min_payout_low: Felt,
    min_payout_high: Felt,
}

fn build_execute_private_swap_with_payout_call(
    executor: Felt,
    payload: &AutoPrivacyPayloadResponse,
    input: &SwapPayoutCallInput<'_>,
) -> Result<Call> {
    let selector = get_selector_from_name("execute_private_swap_with_payout")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;

    let kind = hide_executor_kind();
    let mut calldata: Vec<Felt> = Vec::with_capacity(10 + input.action_calldata.len());
    if kind == HideExecutorKind::ShieldedPoolV3 {
        calldata.push(parse_felt(payload.nullifier.trim())?);
    } else {
        calldata.push(parse_felt(payload.commitment.trim())?);
    }
    if kind == HideExecutorKind::ShieldedPoolV2 || kind == HideExecutorKind::ShieldedPoolV3 {
        calldata.push(input.action_target);
    }
    calldata.push(input.action_selector);
    calldata.push(Felt::from(input.action_calldata.len() as u64));
    calldata.extend_from_slice(input.action_calldata);
    calldata.push(input.approval_token);
    calldata.push(input.payout_token);
    if kind != HideExecutorKind::ShieldedPoolV3 {
        calldata.push(input.recipient);
    }
    calldata.push(input.min_payout_low);
    calldata.push(input.min_payout_high);

    Ok(Call {
        to: executor,
        selector,
        calldata,
    })
}

// Internal helper that builds inputs for `build_shielded_set_asset_rule_call` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn build_shielded_set_asset_rule_call(
    executor: Felt,
    token: Felt,
    amount_low: Felt,
    amount_high: Felt,
) -> Result<Call> {
    let selector = get_selector_from_name("set_asset_rule")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    Ok(Call {
        to: executor,
        selector,
        calldata: vec![token, amount_low, amount_high],
    })
}

// Internal helper that builds inputs for `build_shielded_deposit_fixed_for_call` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn build_shielded_deposit_fixed_for_call(
    executor: Felt,
    depositor: Felt,
    token: Felt,
    note_commitment: Felt,
) -> Result<Call> {
    let selector = get_selector_from_name("deposit_fixed_for")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    Ok(Call {
        to: executor,
        selector,
        calldata: vec![depositor, token, note_commitment],
    })
}

// Internal helper that supports `shielded_note_registered` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn shielded_note_registered(
    state: &AppState,
    executor: Felt,
    note_commitment: Felt,
) -> Result<bool> {
    let reader = OnchainReader::from_config(&state.config)?;
    let selector = get_selector_from_name("is_note_registered")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let out = reader
        .call(FunctionCall {
            contract_address: executor,
            entry_point_selector: selector,
            calldata: vec![note_commitment],
        })
        .await?;
    let flag = out.first().copied().unwrap_or(Felt::ZERO);
    Ok(flag != Felt::ZERO)
}

async fn shielded_note_deposit_timestamp(
    state: &AppState,
    executor: Felt,
    note_commitment: Felt,
) -> Result<u64> {
    let reader = OnchainReader::from_config(&state.config)?;
    let selector = get_selector_from_name("get_note_deposit_timestamp")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let out = reader
        .call(FunctionCall {
            contract_address: executor,
            entry_point_selector: selector,
            calldata: vec![note_commitment],
        })
        .await?;
    let raw = out.first().copied().unwrap_or(Felt::ZERO);
    let value = felt_to_u128(&raw).map_err(|_| {
        AppError::BadRequest("Invalid note timestamp returned by shielded pool".to_string())
    })?;
    Ok(value as u64)
}

async fn shielded_current_root(state: &AppState, executor: Felt) -> Result<Felt> {
    let reader = OnchainReader::from_config(&state.config)?;
    let selector = get_selector_from_name("get_root")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let out = reader
        .call(FunctionCall {
            contract_address: executor,
            entry_point_selector: selector,
            calldata: vec![],
        })
        .await?;
    let root = out.first().copied().unwrap_or(Felt::ZERO);
    if root == Felt::ZERO {
        return Err(AppError::BadRequest(
            "ShieldedPoolV3 root belum diinisialisasi (get_root=0).".to_string(),
        ));
    }
    Ok(root)
}

// Internal helper that supports `shielded_fixed_amount` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn shielded_fixed_amount(
    state: &AppState,
    executor: Felt,
    token: Felt,
) -> Result<(Felt, Felt)> {
    let reader = OnchainReader::from_config(&state.config)?;
    let selector = get_selector_from_name("fixed_amount")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let out = reader
        .call(FunctionCall {
            contract_address: executor,
            entry_point_selector: selector,
            calldata: vec![token],
        })
        .await?;
    if out.len() < 2 {
        return Err(AppError::BadRequest(
            "ShieldedPoolV2 fixed_amount returned invalid response".to_string(),
        ));
    }
    Ok((out[0], out[1]))
}

// Internal helper that supports `compute_swap_payout_intent_hash_on_executor` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn compute_swap_payout_intent_hash_on_executor(
    state: &AppState,
    executor: Felt,
    input: &SwapPayoutCallInput<'_>,
) -> Result<String> {
    let reader = OnchainReader::from_config(&state.config)?;
    let kind = hide_executor_kind();
    let selector_name = match kind {
        HideExecutorKind::PrivateActionExecutorV1 => "preview_swap_payout_intent_hash",
        HideExecutorKind::ShieldedPoolV2 => "preview_swap_payout_action_hash",
        HideExecutorKind::ShieldedPoolV3 => "preview_swap_action_hash",
    };
    let selector = get_selector_from_name(selector_name)
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let mut calldata: Vec<Felt> = Vec::with_capacity(10 + input.action_calldata.len());
    if kind == HideExecutorKind::ShieldedPoolV2 || kind == HideExecutorKind::ShieldedPoolV3 {
        calldata.push(input.action_target);
    }
    calldata.push(input.action_selector);
    calldata.push(Felt::from(input.action_calldata.len() as u64));
    calldata.extend_from_slice(input.action_calldata);
    calldata.push(input.approval_token);
    calldata.push(input.payout_token);
    if kind != HideExecutorKind::ShieldedPoolV3 {
        calldata.push(input.recipient);
    }
    calldata.push(input.min_payout_low);
    calldata.push(input.min_payout_high);

    let out = reader
        .call(FunctionCall {
            contract_address: executor,
            entry_point_selector: selector,
            calldata,
        })
        .await?;
    let intent_hash = out.first().ok_or_else(|| {
        AppError::BadRequest("PrivateActionExecutor preview returned empty response".to_string())
    })?;
    Ok(intent_hash.to_string())
}

// Internal helper that checks conditions for `is_deadline_valid` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn is_deadline_valid(deadline: i64, now: i64) -> bool {
    deadline >= now
}

// Internal helper that supports `invalidate_cached_nft_discount` operations in the swap flow.
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

// Internal helper that supports `current_nft_period_epoch` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn current_nft_period_epoch() -> i64 {
    chrono::Utc::now().timestamp() / EPOCH_DURATION_SECONDS
}

// Internal helper that supports `u128_to_i64_saturating` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn u128_to_i64_saturating(value: u128) -> i64 {
    if value > i64::MAX as u128 {
        i64::MAX
    } else {
        value as i64
    }
}

// Internal helper that fetches data for `read_nft_usage_snapshot` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn read_nft_usage_snapshot(
    reader: &OnchainReader,
    contract_address: Felt,
    user_felt: Felt,
) -> Result<Option<NftUsageSnapshot>> {
    let storage_key = get_storage_var_address("user_nft", &[user_felt])
        .map_err(|e| AppError::Internal(format!("Storage key resolution error: {}", e)))?;
    let token_raw = reader.get_storage_at(contract_address, storage_key).await?;
    let token_id = felt_to_u128(&token_raw).unwrap_or(0);
    if token_id == 0 {
        return Ok(None);
    }

    let info_call = FunctionCall {
        contract_address,
        entry_point_selector: get_selector_from_name("get_nft_info")
            .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?,
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

// Internal helper that supports `base_fee` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn base_fee(amount_in: f64) -> f64 {
    amount_in * 0.003
}

// Internal helper that supports `mev_fee_for_mode` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn mev_fee_for_mode(mode: &str, amount_in: f64) -> f64 {
    if mode.eq_ignore_ascii_case("private") {
        amount_in * 0.01
    } else {
        0.0
    }
}

// Internal helper that supports `total_fee` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn total_fee(amount_in: f64, mode: &str, nft_discount_percent: f64) -> f64 {
    let undiscounted = base_fee(amount_in) + mev_fee_for_mode(mode, amount_in);
    let discount_factor = 1.0 - (nft_discount_percent.clamp(0.0, 100.0) / 100.0);
    undiscounted * discount_factor
}

// Internal helper that supports `estimate_swap_points_for_response` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn estimate_swap_points_for_response(
    volume_usd: f64,
    is_testnet: bool,
    nft_discount_percent: f64,
    ai_level: u8,
) -> f64 {
    let sanitized = sanitize_points_usd_base(volume_usd);
    let min_threshold = if is_testnet {
        POINTS_MIN_USD_SWAP_TESTNET
    } else {
        POINTS_MIN_USD_SWAP
    };
    if sanitized < min_threshold {
        return 0.0;
    }
    let nft_factor = 1.0 + (nft_discount_percent.clamp(0.0, 100.0) / 100.0);
    let ai_factor = 1.0 + (ai_level_points_bonus_percent(ai_level) / 100.0);
    (sanitized * POINTS_PER_USD_SWAP * nft_factor * ai_factor).max(0.0)
}

// Internal helper that supports `ai_level_points_bonus_percent` operations in the swap flow.
fn ai_level_points_bonus_percent(level: u8) -> f64 {
    match level {
        2 => AI_LEVEL_2_POINTS_BONUS_PERCENT,
        3 => AI_LEVEL_3_POINTS_BONUS_PERCENT,
        _ => 0.0,
    }
}

// Internal helper that supports `discount_contract_address` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn discount_contract_address(state: &AppState) -> Option<&str> {
    state
        .config
        .discount_soulbound_address
        .as_deref()
        .filter(|addr| !addr.trim().is_empty() && !addr.starts_with("0x0000"))
}

// Internal helper that supports `active_nft_discount_percent` operations in the swap flow.
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
                "Failed to read local NFT discount state in swap for user={}: {}",
                user_address,
                err
            );
            0.0
        }
    }
}

// Internal helper that supports `refresh_nft_discount_for_submit` operations in the swap flow.
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
                "Failed to initialize on-chain reader for NFT discount submit validation in swap: {}",
                err
            );
            return cached_nft_discount_from_local_state(state, user_address).await;
        }
    };

    let contract_address = match parse_felt(contract) {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(
                "Invalid discount contract address while validating swap fee discount: {}",
                err
            );
            return 0.0;
        }
    };
    let user_felt = match parse_felt(user_address) {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(
                "Invalid user address while validating swap fee discount: user={}, err={}",
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
                "Selector resolution failed for has_active_discount in swap submit validation: {}",
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
                "Failed on-chain NFT discount submit validation in swap for user={}: {}",
                user_address,
                err
            );
            return 0.0;
        }
        Err(_) => {
            tracing::warn!(
                "Timeout on-chain NFT discount submit validation in swap for user={}",
                user_address
            );
            return 0.0;
        }
    };
    if result.len() < 3 {
        return 0.0;
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
                "Failed to read NFT usage snapshot in swap submit validation for user={}: {}",
                user_address,
                err
            );
            return 0.0;
        }
        Err(_) => {
            tracing::warn!(
                "Timeout reading NFT usage snapshot in swap submit validation for user={}",
                user_address
            );
            return 0.0;
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
        .upsert_nft_discount_state_from_chain(NftDiscountStateUpsert {
            contract_address: contract,
            user_address,
            period_epoch,
            tier: usage_snapshot.tier.max(0),
            discount_percent,
            is_active: chain_active,
            max_usage: max_usage_i64,
            chain_used_in_period: chain_used_i64,
        })
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
                "Failed to persist NFT discount state in swap for user={}: {}",
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

// Internal helper that runs side-effecting logic for `record_nft_discount_usage_after_submit`.
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
                "Recorded local NFT usage after swap submit user={} period={} local_used={}",
                user_address,
                period_epoch,
                updated_usage
            );
        }
        Err(err) => {
            tracing::warn!(
                "Failed recording local NFT usage after swap submit for user={}: {}",
                user_address,
                err
            );
        }
    }
    invalidate_cached_nft_discount(contract, user_address).await;
}

// Internal helper that parses or transforms values for `normalize_usd_volume` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn normalize_usd_volume(usd_in: f64, usd_out: f64) -> f64 {
    let in_valid = usd_in.is_finite() && usd_in > 0.0;
    let out_valid = usd_out.is_finite() && usd_out > 0.0;
    match (in_valid, out_valid) {
        (true, true) => (usd_in + usd_out) / 2.0,
        (true, false) => usd_in,
        (false, true) => usd_out,
        (false, false) => 0.0,
    }
}

// Internal helper that checks conditions for `should_run_privacy_verification` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn should_run_privacy_verification(hide_balance: bool) -> bool {
    hide_balance
}

// Internal helper that checks conditions for `is_supported_starknet_swap_token` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn is_supported_starknet_swap_token(token: &str) -> bool {
    matches!(
        token.trim().to_ascii_uppercase().as_str(),
        "USDT" | "USDC" | "STRK" | "WBTC" | "CAREL"
    )
}

// Internal helper that runs side-effecting logic for `ensure_supported_starknet_swap_pair` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn ensure_supported_starknet_swap_pair(from_token: &str, to_token: &str) -> Result<()> {
    if from_token.trim().eq_ignore_ascii_case(to_token.trim()) {
        return Err(AppError::BadRequest(
            "Swap pair must use two different tokens".to_string(),
        ));
    }
    if !is_supported_starknet_swap_token(from_token) || !is_supported_starknet_swap_token(to_token)
    {
        return Err(AppError::BadRequest(
            "On-chain swap token is not listed. Supported symbols: USDT, USDC, STRK, WBTC, CAREL."
                .to_string(),
        ));
    }
    Ok(())
}

#[derive(Debug, Clone)]
struct ParsedExecuteCall {
    to: Felt,
    selector: Felt,
    calldata: Vec<Felt>,
}

#[derive(Debug, Clone)]
struct OnchainSwapRoute {
    dex_id: Felt,
    expected_amount_out_low: Felt,
    expected_amount_out_high: Felt,
    min_amount_out_low: Felt,
    min_amount_out_high: Felt,
}

#[derive(Debug, Clone)]
struct OnchainSwapContext {
    swap_contract: Felt,
    from_token: Felt,
    to_token: Felt,
    amount_low: Felt,
    amount_high: Felt,
    route: OnchainSwapRoute,
}

/// Handles `token_decimals` logic in the swap API flow.
///
/// # Arguments
/// * Function parameters carry authenticated request context and execution inputs.
///
/// # Returns
/// * `Ok(...)` when the swap operation is validated and processed successfully.
/// * `Err(AppError)` when validation, authorization, or integration checks fail.
///
/// # Notes
/// * May interact with relayer/on-chain components and update runtime state.
pub(crate) fn token_decimals(symbol: &str) -> u32 {
    match symbol.to_ascii_uppercase().as_str() {
        "BTC" | "WBTC" => 8,
        "USDT" | "USDC" => 6,
        _ => 18,
    }
}

// Internal helper that supports `pow10_u128` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn pow10_u128(exp: u32) -> Result<u128> {
    let mut out = 1_u128;
    for _ in 0..exp {
        out = out.checked_mul(10).ok_or_else(|| {
            AppError::BadRequest("Token decimals overflow while scaling amount".to_string())
        })?;
    }
    Ok(out)
}

// Internal helper that parses or transforms values for `parse_decimal_to_scaled_u128` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn parse_decimal_to_scaled_u128(raw: &str, decimals: u32) -> Result<u128> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest("Amount is empty".to_string()));
    }
    if trimmed.starts_with('-') {
        return Err(AppError::BadRequest(
            "Amount must be non-negative".to_string(),
        ));
    }

    let (whole_raw, frac_raw) = trimmed.split_once('.').unwrap_or((trimmed, ""));
    if !whole_raw.chars().all(|c| c.is_ascii_digit())
        || !frac_raw.chars().all(|c| c.is_ascii_digit())
    {
        return Err(AppError::BadRequest(
            "Amount must be a decimal number".to_string(),
        ));
    }

    let whole = if whole_raw.is_empty() {
        0_u128
    } else {
        whole_raw
            .parse::<u128>()
            .map_err(|_| AppError::BadRequest("Amount is too large".to_string()))?
    };
    let scale = pow10_u128(decimals)?;
    let whole_scaled = whole
        .checked_mul(scale)
        .ok_or_else(|| AppError::BadRequest("Amount is too large".to_string()))?;

    let frac_cut = if frac_raw.len() > decimals as usize {
        &frac_raw[..decimals as usize]
    } else {
        frac_raw
    };
    let mut frac_padded = frac_cut.to_string();
    while frac_padded.len() < decimals as usize {
        frac_padded.push('0');
    }
    let frac_scaled = if frac_padded.is_empty() {
        0_u128
    } else {
        frac_padded
            .parse::<u128>()
            .map_err(|_| AppError::BadRequest("Amount is too large".to_string()))?
    };

    whole_scaled
        .checked_add(frac_scaled)
        .ok_or_else(|| AppError::BadRequest("Amount is too large".to_string()))
}

/// Parses or transforms values for `parse_decimal_to_u256_parts` in the swap API flow.
///
/// # Arguments
/// * Function parameters carry authenticated request context and execution inputs.
///
/// # Returns
/// * `Ok(...)` when the swap operation is validated and processed successfully.
/// * `Err(AppError)` when validation, authorization, or integration checks fail.
///
/// # Notes
/// * May interact with relayer/on-chain components and update runtime state.
pub(crate) fn parse_decimal_to_u256_parts(raw: &str, decimals: u32) -> Result<(Felt, Felt)> {
    let scaled = parse_decimal_to_scaled_u128(raw, decimals)?;
    Ok((Felt::from(scaled), Felt::ZERO))
}

// Internal helper that supports `onchain_u256_to_f64` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn onchain_u256_to_f64(low: Felt, high: Felt, decimals: u32) -> Result<f64> {
    let low_u = felt_to_u128(&low).map_err(|_| {
        AppError::BadRequest("Invalid on-chain amount: low limb is not numeric".to_string())
    })?;
    let high_u = felt_to_u128(&high).map_err(|_| {
        AppError::BadRequest("Invalid on-chain amount: high limb is not numeric".to_string())
    })?;

    let value_raw = (high_u as f64) * 2_f64.powi(128) + (low_u as f64);
    let scale = 10_f64.powi(decimals as i32);
    if scale <= 0.0 {
        return Err(AppError::BadRequest(
            "Invalid token decimals for on-chain conversion".to_string(),
        ));
    }
    let out = value_raw / scale;
    if !out.is_finite() {
        return Err(AppError::BadRequest(
            "On-chain quote is out of supported range".to_string(),
        ));
    }
    Ok(out)
}

// Internal helper that supports `felt_hex` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn felt_hex(value: Felt) -> String {
    value.to_string()
}

// Internal helper that supports `felt_debug` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn felt_debug(value: Felt) -> String {
    format!("{} ({:#x})", value, value)
}

// Internal helper that checks conditions for `is_transient_starknet_route_error` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn is_transient_starknet_route_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("error sending request")
        || lower.contains("timeout")
        || lower.contains("timed out")
        || lower.contains("too many requests")
        || lower.contains("429")
        || lower.contains("gateway")
        || lower.contains("temporarily unavailable")
}

// Internal helper that parses or transforms values for `map_hide_relayer_invoke_error` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn map_hide_relayer_invoke_error(err: AppError) -> AppError {
    match err {
        AppError::BlockchainRPC(message) => {
            let lower = message.to_ascii_lowercase();
            let is_verifier_entrypoint_missing = lower.contains("entrypoint_not_found")
                && (lower
                    .contains("0xf7a2c0e06dd94ce04c20d2bd7dcabb38ce8302ca6eeae240f28e9c8c481533")
                    || lower.contains("verify_groth16_proof_bls12_381"));
            if is_verifier_entrypoint_missing {
                return AppError::BadRequest(
                    "ShieldedPoolV2 verifier is misconfigured on-chain. Set ShieldedPoolV2 verifier to a Garaga Groth16 BLS contract that exposes verify_groth16_proof_bls12_381."
                        .to_string(),
                );
            }
            AppError::BlockchainRPC(message)
        }
        other => other,
    }
}

// Internal helper that supports `call_swap_route_with_retry` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn call_swap_route_with_retry(
    reader: &OnchainReader,
    call: FunctionCall,
) -> Result<Vec<Felt>> {
    let mut last_error: Option<AppError> = None;
    for attempt in 0..3 {
        match reader.call(call.clone()).await {
            Ok(raw) => return Ok(raw),
            Err(err) => {
                let message = err.to_string();
                let transient = is_transient_starknet_route_error(&message);
                last_error = Some(err);
                if transient && attempt < 2 {
                    sleep(Duration::from_millis(350 * (attempt as u64 + 1))).await;
                    continue;
                }
                break;
            }
        }
    }
    Err(last_error
        .unwrap_or_else(|| AppError::BadRequest("Failed to call Starknet swap route".to_string())))
}

// Internal helper that supports `felt_to_usize` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn felt_to_usize(value: &Felt, field_name: &str) -> Result<usize> {
    let raw = felt_to_u128(value).map_err(|_| {
        AppError::BadRequest(format!(
            "Invalid invoke calldata: {field_name} is not a valid number"
        ))
    })?;
    usize::try_from(raw).map_err(|_| {
        AppError::BadRequest(format!(
            "Invalid invoke calldata: {field_name} exceeds supported size"
        ))
    })
}

// Internal helper that parses or transforms values for `parse_execute_calls_offset` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn parse_execute_calls_offset(calldata: &[Felt]) -> Result<Vec<ParsedExecuteCall>> {
    if calldata.is_empty() {
        return Err(AppError::BadRequest(
            "Invalid invoke calldata: empty calldata".to_string(),
        ));
    }

    let calls_len = felt_to_usize(&calldata[0], "calls_len")?;
    let header_start = 1usize;
    let header_width = 4usize;
    let headers_end = header_start
        .checked_add(calls_len.checked_mul(header_width).ok_or_else(|| {
            AppError::BadRequest("Invalid invoke calldata: calls_len overflow".to_string())
        })?)
        .ok_or_else(|| {
            AppError::BadRequest("Invalid invoke calldata: malformed headers".to_string())
        })?;

    if calldata.len() <= headers_end {
        return Err(AppError::BadRequest(
            "Invalid invoke calldata: missing calldata length".to_string(),
        ));
    }

    let flattened_len = felt_to_usize(&calldata[headers_end], "flattened_len")?;
    let flattened_start = headers_end + 1;
    let flattened_end = flattened_start.checked_add(flattened_len).ok_or_else(|| {
        AppError::BadRequest("Invalid invoke calldata: flattened overflow".to_string())
    })?;

    if calldata.len() < flattened_end {
        return Err(AppError::BadRequest(
            "Invalid invoke calldata: flattened segment out of bounds".to_string(),
        ));
    }

    let flattened = &calldata[flattened_start..flattened_end];
    let mut calls = Vec::with_capacity(calls_len);

    for idx in 0..calls_len {
        let offset = header_start + idx * header_width;
        let to = calldata[offset];
        let selector = calldata[offset + 1];
        let data_offset = felt_to_usize(&calldata[offset + 2], "data_offset")?;
        let data_len = felt_to_usize(&calldata[offset + 3], "data_len")?;
        let data_end = data_offset.checked_add(data_len).ok_or_else(|| {
            AppError::BadRequest("Invalid invoke calldata: data segment overflow".to_string())
        })?;
        if data_end > flattened.len() {
            return Err(AppError::BadRequest(
                "Invalid invoke calldata: call segment out of bounds".to_string(),
            ));
        }

        calls.push(ParsedExecuteCall {
            to,
            selector,
            calldata: flattened[data_offset..data_end].to_vec(),
        });
    }

    Ok(calls)
}

// Internal helper that parses or transforms values for `parse_execute_calls_inline` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn parse_execute_calls_inline(calldata: &[Felt]) -> Result<Vec<ParsedExecuteCall>> {
    if calldata.is_empty() {
        return Err(AppError::BadRequest(
            "Invalid invoke calldata: empty calldata".to_string(),
        ));
    }
    let calls_len = felt_to_usize(&calldata[0], "calls_len")?;
    let mut cursor = 1usize;
    let mut calls = Vec::with_capacity(calls_len);

    for _ in 0..calls_len {
        let header_end = cursor.checked_add(3).ok_or_else(|| {
            AppError::BadRequest("Invalid invoke calldata: malformed call header".to_string())
        })?;
        if calldata.len() < header_end {
            return Err(AppError::BadRequest(
                "Invalid invoke calldata: missing inline call header".to_string(),
            ));
        }

        let to = calldata[cursor];
        let selector = calldata[cursor + 1];
        let data_len = felt_to_usize(&calldata[cursor + 2], "data_len")?;
        let data_start = cursor + 3;
        let data_end = data_start.checked_add(data_len).ok_or_else(|| {
            AppError::BadRequest("Invalid invoke calldata: inline data overflow".to_string())
        })?;
        if data_end > calldata.len() {
            return Err(AppError::BadRequest(
                "Invalid invoke calldata: inline data out of bounds".to_string(),
            ));
        }

        calls.push(ParsedExecuteCall {
            to,
            selector,
            calldata: calldata[data_start..data_end].to_vec(),
        });
        cursor = data_end;
    }

    Ok(calls)
}

// Internal helper that parses or transforms values for `parse_execute_calls` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn parse_execute_calls(calldata: &[Felt]) -> Result<Vec<ParsedExecuteCall>> {
    if let Ok(calls) = parse_execute_calls_offset(calldata) {
        return Ok(calls);
    }
    parse_execute_calls_inline(calldata)
}

// Internal helper that supports `configured_swap_contract` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn configured_swap_contract(_state: &AppState) -> Result<Option<Felt>> {
    let mut candidates = vec![
        std::env::var("STARKNET_SWAP_CONTRACT_ADDRESS").ok(),
        std::env::var("SWAP_AGGREGATOR_ADDRESS").ok(),
        std::env::var("NEXT_PUBLIC_STARKNET_SWAP_CONTRACT_ADDRESS").ok(),
    ];
    for candidate in candidates.drain(..).flatten() {
        let trimmed = candidate.trim();
        if trimmed.is_empty() || trimmed.starts_with("0x0000") {
            continue;
        }
        return Ok(Some(parse_felt(trimmed)?));
    }
    Ok(None)
}

// Internal helper that supports `env_truthy` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn env_truthy(name: &str) -> bool {
    matches!(
        std::env::var(name)
            .ok()
            .map(|value| value.trim().to_ascii_lowercase()),
        Some(value) if value == "1" || value == "true" || value == "yes"
    )
}

// Internal helper that checks conditions for `is_event_only_swap_contract_configured` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn is_event_only_swap_contract_configured(state: &AppState) -> Result<bool> {
    if env_truthy("SWAP_CONTRACT_EVENT_ONLY") || env_truthy("NEXT_PUBLIC_SWAP_CONTRACT_EVENT_ONLY")
    {
        return Ok(true);
    }

    let Some(configured_swap) = configured_swap_contract(state)? else {
        return Ok(false);
    };

    let carel_candidates = [
        std::env::var("CAREL_PROTOCOL_ADDRESS").ok(),
        std::env::var("NEXT_PUBLIC_CAREL_PROTOCOL_ADDRESS").ok(),
    ];

    for candidate in carel_candidates.into_iter().flatten() {
        let trimmed = candidate.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(carel_protocol) = parse_felt(trimmed) {
            if configured_swap == carel_protocol {
                return Ok(true);
            }
        }
    }

    Ok(false)
}

// Internal helper that supports `env_value` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn env_value(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

// Internal helper that supports `push_token_candidate` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn push_token_candidate(raw: Option<String>, out: &mut Vec<Felt>) {
    let Some(candidate) = raw else {
        return;
    };
    match parse_felt(&candidate) {
        Ok(felt) => {
            if !out.contains(&felt) {
                out.push(felt);
            }
        }
        Err(err) => {
            tracing::warn!(
                "Ignoring invalid token address candidate '{}': {}",
                candidate,
                err
            );
        }
    }
}

// Internal helper that supports `configured_token_candidates` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn configured_token_candidates(state: &AppState, token: &str) -> Vec<Felt> {
    let token = token.to_ascii_uppercase();
    let mut candidates = Vec::new();
    match token.as_str() {
        "CAREL" => {
            push_token_candidate(env_value("TOKEN_CAREL_ADDRESS"), &mut candidates);
            push_token_candidate(
                env_value("NEXT_PUBLIC_TOKEN_CAREL_ADDRESS"),
                &mut candidates,
            );
            push_token_candidate(
                Some(state.config.carel_token_address.clone()),
                &mut candidates,
            );
        }
        "STRK" => {
            push_token_candidate(env_value("TOKEN_STRK_ADDRESS"), &mut candidates);
            push_token_candidate(env_value("NEXT_PUBLIC_TOKEN_STRK_ADDRESS"), &mut candidates);
            push_token_candidate(state.config.token_strk_address.clone(), &mut candidates);
        }
        "WBTC" | "BTC" => {
            push_token_candidate(env_value("TOKEN_WBTC_ADDRESS"), &mut candidates);
            push_token_candidate(env_value("NEXT_PUBLIC_TOKEN_WBTC_ADDRESS"), &mut candidates);
            push_token_candidate(env_value("TOKEN_BTC_ADDRESS"), &mut candidates);
            push_token_candidate(env_value("NEXT_PUBLIC_TOKEN_BTC_ADDRESS"), &mut candidates);
            push_token_candidate(state.config.token_btc_address.clone(), &mut candidates);
        }
        "USDT" => {
            push_token_candidate(env_value("TOKEN_USDT_ADDRESS"), &mut candidates);
            push_token_candidate(env_value("NEXT_PUBLIC_TOKEN_USDT_ADDRESS"), &mut candidates);
        }
        "USDC" => {
            push_token_candidate(env_value("TOKEN_USDC_ADDRESS"), &mut candidates);
            push_token_candidate(env_value("NEXT_PUBLIC_TOKEN_USDC_ADDRESS"), &mut candidates);
        }
        "ETH" => {
            push_token_candidate(env_value("TOKEN_ETH_ADDRESS"), &mut candidates);
            push_token_candidate(env_value("NEXT_PUBLIC_TOKEN_ETH_ADDRESS"), &mut candidates);
            push_token_candidate(state.config.token_eth_address.clone(), &mut candidates);
        }
        _ => {}
    }

    push_token_candidate(
        token_address_for(&token).map(|value| value.to_string()),
        &mut candidates,
    );
    candidates
}

// Internal helper that checks conditions for `is_no_active_dex_found_error` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn is_no_active_dex_found_error(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    message.contains("no active dex found")
        || message.contains("no active dex")
        || message.contains("dex not active")
}

// Internal helper that parses or transforms values for `parse_onchain_route` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn parse_onchain_route(raw: &[Felt]) -> Result<OnchainSwapRoute> {
    if raw.len() < 5 {
        return Err(AppError::BadRequest(
            "Invalid on-chain route response: expected 5 felts".to_string(),
        ));
    }
    Ok(OnchainSwapRoute {
        dex_id: raw[0],
        expected_amount_out_low: raw[1],
        expected_amount_out_high: raw[2],
        min_amount_out_low: raw[3],
        min_amount_out_high: raw[4],
    })
}

// Internal helper that supports `u256_limbs_to_u128_parts` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn u256_limbs_to_u128_parts(low: Felt, high: Felt, label: &str) -> Result<(u128, u128)> {
    let low_u = felt_to_u128(&low).map_err(|_| {
        AppError::BadRequest(format!(
            "Invalid on-chain {} amount: low limb is not numeric",
            label
        ))
    })?;
    let high_u = felt_to_u128(&high).map_err(|_| {
        AppError::BadRequest(format!(
            "Invalid on-chain {} amount: high limb is not numeric",
            label
        ))
    })?;
    Ok((low_u, high_u))
}

// Internal helper that supports `u256_is_greater` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn u256_is_greater(
    left_low: Felt,
    left_high: Felt,
    right_low: Felt,
    right_high: Felt,
    left_label: &str,
    right_label: &str,
) -> Result<bool> {
    let (left_low_u, left_high_u) = u256_limbs_to_u128_parts(left_low, left_high, left_label)?;
    let (right_low_u, right_high_u) = u256_limbs_to_u128_parts(right_low, right_high, right_label)?;
    Ok(left_high_u > right_high_u || (left_high_u == right_high_u && left_low_u > right_low_u))
}

// Internal helper that fetches data for `read_erc20_balance_parts` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn read_erc20_balance_parts(
    reader: &OnchainReader,
    token: Felt,
    owner: Felt,
) -> Result<(Felt, Felt)> {
    for selector_name in ["balance_of", "balanceOf"] {
        let selector = get_selector_from_name(selector_name)
            .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
        let response = reader
            .call(FunctionCall {
                contract_address: token,
                entry_point_selector: selector,
                calldata: vec![owner],
            })
            .await;
        if let Ok(values) = response {
            if values.len() >= 2 {
                return Ok((values[0], values[1]));
            }
        }
    }
    Err(AppError::BadRequest(
        "Failed to read on-chain token liquidity (balance_of)".to_string(),
    ))
}

// Internal helper that fetches data for `read_erc20_allowance_parts` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn read_erc20_allowance_parts(
    reader: &OnchainReader,
    token: Felt,
    owner: Felt,
    spender: Felt,
) -> Result<(Felt, Felt)> {
    for selector_name in ["allowance"] {
        let selector = get_selector_from_name(selector_name)
            .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
        let response = reader
            .call(FunctionCall {
                contract_address: token,
                entry_point_selector: selector,
                calldata: vec![owner, spender],
            })
            .await;
        if let Ok(values) = response {
            if values.len() >= 2 {
                return Ok((values[0], values[1]));
            }
        }
    }
    Err(AppError::BadRequest(
        "Failed to read on-chain token allowance".to_string(),
    ))
}

// Internal helper that checks conditions for `is_oracle_route` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn is_oracle_route(route: &OnchainSwapRoute) -> bool {
    parse_felt(ORACLE_ROUTE_DEX_ID_HEX)
        .map(|oracle_id| route.dex_id == oracle_id)
        .unwrap_or(false)
}

// Internal helper that runs side-effecting logic for `ensure_oracle_route_liquidity` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn ensure_oracle_route_liquidity(
    state: &AppState,
    context: &OnchainSwapContext,
    from_token: &str,
    to_token: &str,
    from_amount: &str,
) -> Result<()> {
    if !is_oracle_route(&context.route) {
        return Ok(());
    }

    let reader = OnchainReader::from_config(&state.config)?;
    let (available_low, available_high) =
        read_erc20_balance_parts(&reader, context.to_token, context.swap_contract).await?;

    let required_is_higher = u256_is_greater(
        context.route.expected_amount_out_low,
        context.route.expected_amount_out_high,
        available_low,
        available_high,
        "required output",
        "available liquidity",
    )?;
    if !required_is_higher {
        return Ok(());
    }

    let required = onchain_u256_to_f64(
        context.route.expected_amount_out_low,
        context.route.expected_amount_out_high,
        token_decimals(to_token),
    )?;
    let available = onchain_u256_to_f64(available_low, available_high, token_decimals(to_token))?;
    let input_amount = from_amount.trim().parse::<f64>().unwrap_or(0.0);
    let max_input = if required > 0.0 && available > 0.0 && input_amount > 0.0 {
        input_amount * (available / required)
    } else {
        0.0
    };

    Err(AppError::BadRequest(format!(
        "Likuiditas on-chain {} tidak cukup untuk {} -> {} via oracle route. Butuh sekitar {:.6} {}, tersedia sekitar {:.6} {} di swap aggregator. Kurangi amount (maks sekitar {:.6} {}) atau top-up liquidity.",
        to_token.to_ascii_uppercase(),
        from_token.to_ascii_uppercase(),
        to_token.to_ascii_uppercase(),
        required,
        to_token.to_ascii_uppercase(),
        available,
        to_token.to_ascii_uppercase(),
        max_input.max(0.0),
        from_token.to_ascii_uppercase(),
    )))
}

// Internal helper that fetches data for `fetch_onchain_swap_context` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn fetch_onchain_swap_context(
    state: &AppState,
    from_token: &str,
    to_token: &str,
    amount: &str,
) -> Result<OnchainSwapContext> {
    let swap_contract = configured_swap_contract(state)?.ok_or_else(|| {
        AppError::BadRequest(
            "Swap contract is not configured for on-chain swap. Set STARKNET_SWAP_CONTRACT_ADDRESS (or SWAP_AGGREGATOR_ADDRESS).".to_string(),
        )
    })?;
    let from_token_candidates = configured_token_candidates(state, from_token);
    if from_token_candidates.is_empty() {
        return Err(AppError::BadRequest(format!(
            "Token address is not configured for {}",
            from_token
        )));
    }
    let to_token_candidates = configured_token_candidates(state, to_token);
    if to_token_candidates.is_empty() {
        return Err(AppError::BadRequest(format!(
            "Token address is not configured for {}",
            to_token
        )));
    }
    let (amount_low, amount_high) =
        parse_decimal_to_u256_parts(amount, token_decimals(from_token))?;
    tracing::debug!(
        "Using swap contract for route lookup: {}",
        felt_debug(swap_contract)
    );

    let reader = OnchainReader::from_config(&state.config)?;
    let route_selector = get_selector_from_name("get_best_swap_route")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let mut saw_no_active_dex = false;
    let mut first_error: Option<AppError> = None;

    for from_token_felt in &from_token_candidates {
        for to_token_felt in &to_token_candidates {
            let route_raw = match call_swap_route_with_retry(
                &reader,
                FunctionCall {
                    contract_address: swap_contract,
                    entry_point_selector: route_selector,
                    calldata: vec![*from_token_felt, *to_token_felt, amount_low, amount_high],
                },
            )
            .await
            {
                Ok(raw) => raw,
                Err(err) => {
                    let message = err.to_string();
                    if is_no_active_dex_found_error(&message) {
                        saw_no_active_dex = true;
                        continue;
                    }
                    if first_error.is_none() {
                        first_error = Some(AppError::BadRequest(format!(
                            "Failed to fetch on-chain swap route: {} (swap_contract={}, from_token={}, to_token={}). If this is RPC/network related, set STARKNET_API_RPC_URL to a healthy Starknet Sepolia endpoint and retry. If you see EntrypointNotFound, check STARKNET_SWAP_CONTRACT_ADDRESS/SWAP_AGGREGATOR_ADDRESS and restart backend.",
                            message,
                            felt_debug(swap_contract),
                            felt_debug(*from_token_felt),
                            felt_debug(*to_token_felt)
                        )));
                    }
                    continue;
                }
            };

            match parse_onchain_route(&route_raw) {
                Ok(route) => {
                    tracing::debug!(
                        "Resolved on-chain swap route with token addresses: {} -> {}",
                        felt_hex(*from_token_felt),
                        felt_hex(*to_token_felt)
                    );
                    return Ok(OnchainSwapContext {
                        swap_contract,
                        from_token: *from_token_felt,
                        to_token: *to_token_felt,
                        amount_low,
                        amount_high,
                        route,
                    });
                }
                Err(err) => {
                    if first_error.is_none() {
                        first_error = Some(AppError::BadRequest(format!(
                            "{} (from_token={}, to_token={})",
                            err,
                            felt_hex(*from_token_felt),
                            felt_hex(*to_token_felt)
                        )));
                    }
                }
            }
        }
    }

    if saw_no_active_dex {
        return Err(AppError::BadRequest(
            "Swap aggregator on-chain is not ready: no active DEX router / oracle quote."
                .to_string(),
        ));
    }
    if let Some(err) = first_error {
        return Err(err);
    }
    Err(AppError::BadRequest(format!(
        "Failed to fetch on-chain swap route from configured contract {}",
        felt_debug(swap_contract)
    )))
}

// Internal helper that builds inputs for `build_onchain_swap_wallet_calls` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn build_onchain_swap_wallet_calls(
    context: &OnchainSwapContext,
    mev_protected: bool,
) -> Vec<StarknetWalletCall> {
    let mev_flag = if mev_protected { Felt::ONE } else { Felt::ZERO };
    vec![
        StarknetWalletCall {
            contract_address: felt_hex(context.from_token),
            entrypoint: "approve".to_string(),
            calldata: vec![
                felt_hex(context.swap_contract),
                felt_hex(context.amount_low),
                felt_hex(context.amount_high),
            ],
        },
        StarknetWalletCall {
            contract_address: felt_hex(context.swap_contract),
            entrypoint: "execute_swap".to_string(),
            calldata: vec![
                felt_hex(context.route.dex_id),
                felt_hex(context.route.expected_amount_out_low),
                felt_hex(context.route.expected_amount_out_high),
                felt_hex(context.route.min_amount_out_low),
                felt_hex(context.route.min_amount_out_high),
                felt_hex(context.from_token),
                felt_hex(context.to_token),
                felt_hex(context.amount_low),
                felt_hex(context.amount_high),
                felt_hex(mev_flag),
            ],
        },
    ]
}

// Internal helper that supports `first_index_of_any` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn first_index_of_any(calldata: &[Felt], candidates: &[Felt]) -> Option<usize> {
    calldata
        .iter()
        .position(|felt| candidates.iter().any(|candidate| candidate == felt))
}

// Internal helper that supports `first_index_of_any_from` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn first_index_of_any_from(calldata: &[Felt], candidates: &[Felt], start: usize) -> Option<usize> {
    calldata
        .iter()
        .enumerate()
        .skip(start)
        .find_map(|(idx, felt)| {
            if candidates.iter().any(|candidate| candidate == felt) {
                Some(idx)
            } else {
                None
            }
        })
}

// Internal helper that fetches data for `resolve_allowed_swap_senders` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn resolve_allowed_swap_senders(
    state: &AppState,
    auth_subject: &str,
    resolved_starknet_user: &str,
) -> Result<Vec<Felt>> {
    let mut out: Vec<Felt> = Vec::new();
    for candidate in [resolved_starknet_user, auth_subject] {
        if let Ok(felt) = parse_felt(candidate) {
            if !out.contains(&felt) {
                out.push(felt);
            }
        }
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
            "No Starknet sender address resolved for swap verification".to_string(),
        ));
    }
    Ok(out)
}

// Internal helper that supports `verify_swap_invoke_payload_fallback_raw` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn verify_swap_invoke_payload_fallback_raw(
    calldata: &[Felt],
    swap_selectors: &[Felt],
    expected_swap_contract: Option<Felt>,
    from_token_candidates: &[Felt],
    to_token_candidates: &[Felt],
) -> bool {
    for (idx, felt) in calldata.iter().enumerate() {
        if !swap_selectors.iter().any(|selector| selector == felt) {
            continue;
        }

        let contract_matches = match expected_swap_contract {
            Some(expected) => {
                (idx > 0 && calldata[idx - 1] == expected) || calldata.contains(&expected)
            }
            None => true,
        };
        if !contract_matches {
            continue;
        }

        let from_idx = first_index_of_any_from(calldata, from_token_candidates, idx + 1);
        let to_idx = from_idx.and_then(|from_idx| {
            first_index_of_any_from(calldata, to_token_candidates, from_idx + 1)
        });
        if from_idx.is_some() && to_idx.is_some() {
            return true;
        }
    }

    false
}

// Internal helper that supports `verify_swap_invoke_payload` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn verify_swap_invoke_payload(
    tx: &Transaction,
    allowed_senders: &[Felt],
    expected_swap_contract: Option<Felt>,
    from_token_candidates: &[Felt],
    to_token_candidates: &[Felt],
) -> Result<()> {
    if allowed_senders.is_empty() {
        return Err(AppError::BadRequest(
            "No Starknet sender allowed for swap verification".to_string(),
        ));
    }
    if from_token_candidates.is_empty() {
        return Err(AppError::BadRequest(
            "from_token address candidates are empty".to_string(),
        ));
    }
    if to_token_candidates.is_empty() {
        return Err(AppError::BadRequest(
            "to_token address candidates are empty".to_string(),
        ));
    }
    let swap_selector = get_selector_from_name("swap")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let execute_swap_selector = get_selector_from_name("execute_swap")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let approve_selector = get_selector_from_name("approve")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let swap_selectors = [swap_selector, execute_swap_selector];

    let (sender, calldata) = extract_invoke_sender_and_calldata(tx)?;

    if !allowed_senders.contains(&sender) {
        let expected = allowed_senders
            .iter()
            .map(|felt| felt.to_string())
            .collect::<Vec<_>>()
            .join(", ");
        return Err(AppError::BadRequest(format!(
            "onchain_tx_hash sender does not match authenticated Starknet user (expected one of [{}], got {})",
            expected, sender
        )));
    }

    let calls = match parse_execute_calls(calldata) {
        Ok(calls) => Some(calls),
        Err(err) => {
            tracing::warn!(
                "Failed to parse invoke calldata with structured parser, fallback to raw heuristic: {}",
                err
            );
            None
        }
    };
    let mut saw_swap_selector = false;
    let mut saw_expected_contract = expected_swap_contract.is_none();
    let mut matched_swap_call = false;
    let mut saw_approve_from_token = false;
    let mut saw_valid_approve = false;

    if let Some(calls) = calls {
        for call in calls {
            if call.selector == approve_selector {
                if !from_token_candidates.contains(&call.to) {
                    continue;
                }
                saw_approve_from_token = true;
                let approve_spender = call.calldata.first().copied();
                let approve_matches = match expected_swap_contract {
                    Some(expected_contract) => approve_spender == Some(expected_contract),
                    None => approve_spender.is_some(),
                };
                if approve_matches {
                    saw_valid_approve = true;
                }
                continue;
            }
            if !swap_selectors.contains(&call.selector) {
                continue;
            }
            saw_swap_selector = true;

            if let Some(expected_contract) = expected_swap_contract {
                if call.to != expected_contract {
                    continue;
                }
                saw_expected_contract = true;
            }

            let from_idx = first_index_of_any(&call.calldata, from_token_candidates);
            let to_idx = from_idx.and_then(|idx| {
                first_index_of_any_from(&call.calldata, to_token_candidates, idx + 1)
            });

            if let (Some(from_idx), Some(to_idx)) = (from_idx, to_idx) {
                if from_idx < to_idx {
                    matched_swap_call = true;
                }
            }
        }
    } else if verify_swap_invoke_payload_fallback_raw(
        calldata,
        &swap_selectors,
        expected_swap_contract,
        from_token_candidates,
        to_token_candidates,
    ) {
        matched_swap_call = true;
    } else {
        saw_swap_selector = swap_selectors
            .iter()
            .any(|selector| calldata.contains(selector));
        saw_expected_contract = expected_swap_contract
            .map(|expected| calldata.contains(&expected))
            .unwrap_or(true);
    }

    if matched_swap_call {
        if saw_approve_from_token && !saw_valid_approve {
            return Err(AppError::BadRequest(
                "onchain_tx_hash approve call does not target configured Starknet swap contract"
                    .to_string(),
            ));
        }
        return Ok(());
    }

    if !saw_swap_selector {
        return Err(AppError::BadRequest(
            "onchain_tx_hash does not contain execute_swap/swap call".to_string(),
        ));
    }
    if !saw_expected_contract {
        return Err(AppError::BadRequest(
            "onchain_tx_hash execute_swap/swap call is not targeting configured Starknet swap contract"
                .to_string(),
        ));
    }

    Err(AppError::BadRequest(
        "onchain_tx_hash swap call does not match requested token pair".to_string(),
    ))
}

// Internal helper that supports `extract_invoke_sender_and_calldata` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn extract_invoke_sender_and_calldata(tx: &Transaction) -> Result<(Felt, &[Felt])> {
    let invoke = match tx {
        Transaction::Invoke(invoke) => invoke,
        _ => {
            return Err(AppError::BadRequest(
                "onchain_tx_hash must be an INVOKE transaction".to_string(),
            ));
        }
    };

    match invoke {
        InvokeTransaction::V1(tx) => Ok((tx.sender_address, tx.calldata.as_slice())),
        InvokeTransaction::V3(tx) => Ok((tx.sender_address, tx.calldata.as_slice())),
        InvokeTransaction::V0(_) => Err(AppError::BadRequest(
            "onchain_tx_hash uses unsupported INVOKE v0".to_string(),
        )),
    }
}

// Internal helper that supports `verify_onchain_swap_tx_hash` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn verify_onchain_swap_tx_hash(
    state: &AppState,
    tx_hash: &str,
    auth_subject: &str,
    resolved_starknet_user: &str,
    from_token: &str,
    to_token: &str,
) -> Result<i64> {
    let reader = OnchainReader::from_config(&state.config)?;
    let tx_hash_felt = parse_felt(tx_hash)?;
    let expected_swap_contract = configured_swap_contract(state)?;
    let allowed_senders =
        resolve_allowed_swap_senders(state, auth_subject, resolved_starknet_user).await?;
    let from_token_candidates = configured_token_candidates(state, from_token);
    if from_token_candidates.is_empty() {
        return Err(AppError::BadRequest(format!(
            "Token address is not configured for {}",
            from_token
        )));
    }
    let to_token_candidates = configured_token_candidates(state, to_token);
    if to_token_candidates.is_empty() {
        return Err(AppError::BadRequest(format!(
            "Token address is not configured for {}",
            to_token
        )));
    }
    let mut last_rpc_error = String::new();

    for attempt in 0..5 {
        let tx = match reader.get_transaction(&tx_hash_felt).await {
            Ok(tx) => tx,
            Err(err) => {
                last_rpc_error = err.to_string();
                if attempt < 4 {
                    sleep(Duration::from_millis(1000)).await;
                    continue;
                }
                break;
            }
        };

        verify_swap_invoke_payload(
            &tx,
            &allowed_senders,
            expected_swap_contract,
            &from_token_candidates,
            &to_token_candidates,
        )?;

        match reader.get_transaction_receipt(&tx_hash_felt).await {
            Ok(receipt) => {
                if let ExecutionResult::Reverted { reason } = receipt.receipt.execution_result() {
                    return Err(AppError::BadRequest(format!(
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
                    "Verified Starknet swap tx {} at block {} with finality {:?}",
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

    Err(AppError::BadRequest(format!(
        "onchain_tx_hash not found/confirmed on Starknet RPC: {}",
        last_rpc_error
    )))
}

// Internal helper that supports `latest_price_usd` operations in the swap flow.
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

// Internal helper that supports `estimated_time_for_dex` operations in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn estimated_time_for_dex(dex: &str) -> &'static str {
    match dex {
        DEX_EKUBO => "~2 min",
        DEX_HAIKO => "~3 min",
        _ => "~2-3 min",
    }
}

// Internal helper that parses or transforms values for `normalize_onchain_tx_hash` in the swap flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn normalize_onchain_tx_hash(tx_hash: Option<&str>) -> Result<Option<String>> {
    let Some(raw) = tx_hash.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    if !raw.starts_with("0x") {
        return Err(AppError::BadRequest(
            "onchain_tx_hash must start with 0x".to_string(),
        ));
    }
    if raw.len() > 66 {
        return Err(AppError::BadRequest(
            "onchain_tx_hash exceeds maximum length (66)".to_string(),
        ));
    }
    if !raw[2..].chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::BadRequest(
            "onchain_tx_hash must be hex-encoded".to_string(),
        ));
    }
    Ok(Some(raw.to_ascii_lowercase()))
}

/// POST /api/v1/swap/quote
pub async fn get_quote(
    State(state): State<AppState>,
    Json(req): Json<SwapQuoteRequest>,
) -> Result<Json<ApiResponse<SwapQuoteResponse>>> {
    let amount_in: f64 = req
        .amount
        .parse()
        .map_err(|_| AppError::BadRequest("Invalid amount".to_string()))?;
    if !amount_in.is_finite() || amount_in <= 0.0 {
        return Err(AppError::BadRequest(
            "Amount must be greater than zero".to_string(),
        ));
    }

    tracing::debug!(
        "Swap quote: from={}, to={}, slippage={}, mode={}",
        req.from_token,
        req.to_token,
        req.slippage,
        req.mode
    );

    ensure_supported_starknet_swap_pair(&req.from_token, &req.to_token)?;
    if is_event_only_swap_contract_configured(&state)? {
        return Err(AppError::BadRequest(
            "Swap real token belum aktif: kontrak swap terkonfigurasi masih event-only. Deploy/aktifkan router swap on-chain yang memindahkan token real terlebih dulu.".to_string(),
        ));
    }

    if token_address_for(&req.from_token).is_none() || token_address_for(&req.to_token).is_none() {
        return Err(AppError::InvalidToken);
    }

    let gas_optimizer = GasOptimizer::new(state.config.clone());
    let estimated_cost = gas_optimizer
        .estimate_cost("swap")
        .await
        .unwrap_or_default();

    let aggregator = LiquidityAggregator::new(state.config.clone());
    let best_route = aggregator
        .get_best_quote(&req.from_token, &req.to_token, amount_in)
        .await?;
    let onchain_context =
        fetch_onchain_swap_context(&state, &req.from_token, &req.to_token, &req.amount).await?;
    ensure_oracle_route_liquidity(
        &state,
        &onchain_context,
        &req.from_token,
        &req.to_token,
        &req.amount,
    )
    .await?;
    let onchain_calls =
        build_onchain_swap_wallet_calls(&onchain_context, req.mode.eq_ignore_ascii_case("private"));
    let onchain_to_amount = onchain_u256_to_f64(
        onchain_context.route.expected_amount_out_low,
        onchain_context.route.expected_amount_out_high,
        token_decimals(&req.to_token),
    )?;
    let quoted_to_amount = if onchain_to_amount > 0.0 {
        onchain_to_amount
    } else {
        best_route.amount_out
    };

    if let Ok(split_routes) = aggregator
        .get_split_quote(&req.from_token, &req.to_token, amount_in)
        .await
    {
        if split_routes.len() > 1 {
            tracing::debug!("Split routing across {} venues", split_routes.len());
        }
    }

    if let Ok(depth) = aggregator
        .get_liquidity_depth(&req.from_token, &req.to_token)
        .await
    {
        tracing::debug!("Liquidity depth: total={}", depth.total_liquidity);
    }

    let gas = gas_optimizer.get_optimal_gas_price().await?;
    tracing::debug!("Estimated swap gas cost: {}", estimated_cost);

    let response = SwapQuoteResponse {
        from_amount: req.amount.clone(),
        to_amount: quoted_to_amount.to_string(),
        rate: (quoted_to_amount / amount_in).to_string(),
        price_impact: format!("{:.2}%", best_route.price_impact * 100.0),
        fee: best_route.fee.to_string(),
        fee_usd: best_route.fee.to_string(),
        route: best_route.path,
        estimated_gas: gas.standard.to_string(),
        estimated_time: estimated_time_for_dex(best_route.dex.as_str()).to_string(),
        onchain_calls: Some(onchain_calls),
    };

    Ok(Json(ApiResponse::success(response)))
}

/// POST /api/v1/swap/execute
pub async fn execute_swap(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ExecuteSwapRequest>,
) -> Result<Json<ApiResponse<ExecuteSwapResponse>>> {
    // 1. VALIDASI DEADLINE
    let now = chrono::Utc::now().timestamp();
    if !is_deadline_valid(req.deadline, now) {
        return Err(AppError::BadRequest(
            "Transaction deadline expired".to_string(),
        ));
    }

    let auth_subject = require_user(&headers, &state).await?;
    let user_address = require_starknet_user(&headers, &state).await?;
    let should_hide = should_run_privacy_verification(req.hide_balance.unwrap_or(false));
    let strict_privacy_mode = should_hide && hide_balance_strict_privacy_mode_enabled();
    let hide_pool_version = if should_hide {
        Some(resolve_hide_pool_version(req.privacy.as_ref()))
    } else {
        None
    };
    if should_hide {
        match (hide_executor_kind(), hide_pool_version) {
            (HideExecutorKind::ShieldedPoolV3, Some(HidePoolVersion::V2)) => {
                return Err(AppError::BadRequest(
                    "Hide Balance config mismatch: executor is V3 but payload/version resolved to V2."
                        .to_string(),
                ));
            }
            (HideExecutorKind::ShieldedPoolV2, Some(HidePoolVersion::V3))
            | (HideExecutorKind::PrivateActionExecutorV1, Some(HidePoolVersion::V3)) => {
                return Err(AppError::BadRequest(
                    "Hide Balance V3 requires HIDE_BALANCE_EXECUTOR_KIND=shielded_pool_v3."
                        .to_string(),
                ));
            }
            _ => {}
        }
    }

    // 2. LOGIKA RECIPIENT
    let final_recipient = if should_hide && hide_pool_version == Some(HidePoolVersion::V3) {
        if req
            .recipient
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_some()
        {
            return Err(AppError::BadRequest(
                "Hide Balance V3 does not accept recipient in swap request. Recipient is bound inside the proof/note."
                    .to_string(),
            ));
        }
        String::new()
    } else {
        resolve_swap_final_recipient(
            req.recipient.as_deref(),
            &user_address,
            should_hide,
            strict_privacy_mode,
        )?
    };

    let amount_in: f64 = req
        .amount
        .parse()
        .map_err(|_| AppError::BadRequest("Invalid amount".to_string()))?;
    if !amount_in.is_finite() || amount_in <= 0.0 {
        return Err(AppError::BadRequest(
            "Amount must be greater than zero".to_string(),
        ));
    }

    ensure_supported_starknet_swap_pair(&req.from_token, &req.to_token)?;
    if is_event_only_swap_contract_configured(&state)? {
        return Err(AppError::BadRequest(
            "Swap real token belum aktif: kontrak swap terkonfigurasi masih event-only. Deploy/aktifkan router swap on-chain yang memindahkan token real terlebih dulu.".to_string(),
        ));
    }

    if token_address_for(&req.from_token).is_none() || token_address_for(&req.to_token).is_none() {
        return Err(AppError::InvalidToken);
    }

    let onchain_context =
        fetch_onchain_swap_context(&state, &req.from_token, &req.to_token, &req.amount).await?;
    ensure_oracle_route_liquidity(
        &state,
        &onchain_context,
        &req.from_token,
        &req.to_token,
        &req.amount,
    )
    .await?;

    // 3. VALIDASI SLIPPAGE
    let expected_out = onchain_u256_to_f64(
        onchain_context.route.expected_amount_out_low,
        onchain_context.route.expected_amount_out_high,
        token_decimals(&req.to_token),
    )?;
    let min_out: f64 = req
        .min_amount_out
        .parse()
        .map_err(|_| AppError::BadRequest("Invalid min amount".to_string()))?;

    if expected_out < min_out {
        tracing::warn!(
            "Off-chain quote below client min_out (set={}%, min_expected={}, market={}). Continuing because final execution validity is enforced by user-signed on-chain calldata.",
            req.slippage,
            min_out,
            expected_out
        );
    }

    let normalized_onchain_tx_hash = normalize_onchain_tx_hash(req.onchain_tx_hash.as_deref())?;
    // Keep relayer path for Hide mode, but allow explicit wallet-signed fallback when tx hash is provided.
    let use_relayer_pool_hide =
        should_hide && hide_balance_relayer_pool_enabled() && normalized_onchain_tx_hash.is_none();

    let (tx_hash, onchain_block_number, is_user_signed_onchain, privacy_verification_tx) =
        if use_relayer_pool_hide {
            let executor = resolve_private_action_executor_felt_for_swap_hide(&state).await?;
            let verifier_kind = parse_privacy_verifier_kind(
                req.privacy
                    .as_ref()
                    .and_then(|payload| payload.verifier.as_deref()),
            )?;
            let action_selector = get_selector_from_name("execute_swap")
                .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
            let action_calldata = build_swap_executor_action_calldata(
                &onchain_context,
                req.mode.eq_ignore_ascii_case("private"),
            );
            let recipient_felt = if hide_pool_version == Some(HidePoolVersion::V3) {
                Felt::ZERO
            } else {
                parse_felt(&final_recipient)?
            };
            let swap_payout_input = SwapPayoutCallInput {
                action_target: onchain_context.swap_contract,
                action_selector,
                action_calldata: &action_calldata,
                approval_token: onchain_context.from_token,
                payout_token: onchain_context.to_token,
                recipient: recipient_felt,
                min_payout_low: onchain_context.route.min_amount_out_low,
                min_payout_high: onchain_context.route.min_amount_out_high,
            };
            let intent_hash =
                compute_swap_payout_intent_hash_on_executor(&state, executor, &swap_payout_input)
                    .await?;

            let mut tx_context = AutoPrivacyTxContext {
                flow: Some("swap".to_string()),
                from_token: Some(req.from_token.clone()),
                to_token: Some(req.to_token.clone()),
                amount: Some(req.amount.clone()),
                recipient: if hide_pool_version == Some(HidePoolVersion::V3) {
                    None
                } else {
                    Some(final_recipient.to_string())
                },
                from_network: Some("starknet".to_string()),
                to_network: Some("starknet".to_string()),
                note_version: if hide_pool_version == Some(HidePoolVersion::V3) {
                    Some("v3".to_string())
                } else {
                    None
                },
                ..Default::default()
            };

            if hide_pool_version == Some(HidePoolVersion::V3) {
                let current_root = shielded_current_root(&state, executor).await?;
                tx_context.root = Some(felt_hex(current_root));
                tx_context.intent_hash = Some(intent_hash.clone());
                tx_context.action_hash = Some(intent_hash.clone());
                tx_context.action_target = Some(felt_hex(onchain_context.swap_contract));
                tx_context.action_selector = Some(felt_hex(action_selector));
                tx_context.approval_token = Some(felt_hex(onchain_context.from_token));
                tx_context.payout_token = Some(felt_hex(onchain_context.to_token));
                tx_context.min_payout = Some(format!(
                    "{}:{}",
                    felt_hex(onchain_context.route.min_amount_out_low),
                    felt_hex(onchain_context.route.min_amount_out_high)
                ));
                if let Some(request_privacy) = req.privacy.as_ref() {
                    tx_context.note_commitment = request_privacy.note_commitment.clone();
                    tx_context.denom_id = request_privacy.denom_id.clone();
                    tx_context.nullifier = request_privacy.nullifier.clone();
                }
            }

            let request_payload = payload_from_request(req.privacy.as_ref(), verifier_kind.as_str());
            let mut payload = if hide_pool_version == Some(HidePoolVersion::V3) {
                if request_payload.is_some() {
                    tracing::info!(
                        "Ignoring client-provided Hide Balance V3 proof/public_inputs; regenerating payload server-side"
                    );
                }
                generate_auto_garaga_payload(
                    &state.config,
                    &user_address,
                    verifier_kind.as_str(),
                    Some(&tx_context),
                )
                .await?
            } else if let Some(request_payload) = request_payload {
                request_payload
            } else {
                generate_auto_garaga_payload(
                    &state.config,
                    &user_address,
                    verifier_kind.as_str(),
                    Some(&tx_context),
                )
                .await?
            };

            bind_intent_hash_into_payload(&mut payload, &intent_hash)?;
            if hide_pool_version == Some(HidePoolVersion::V3) {
                payload.note_version = Some("v3".to_string());
                ensure_v3_payload_root(&mut payload, &tx_context);
                let root = payload.root.clone().ok_or_else(|| {
                    AppError::BadRequest(
                        "Hide Balance V3 requires privacy.root in prover payload".to_string(),
                    )
                })?;
                if let Err(binding_err) = ensure_public_inputs_bind_root_nullifier(
                    root.as_str(),
                    &payload.nullifier,
                    &payload.public_inputs,
                    "swap hide payload (bound)",
                ) {
                    tracing::warn!(
                        "swap hide payload V3 binding mismatch; normalizing public_inputs root/nullifier indexes: {}",
                        binding_err
                    );
                    normalize_v3_public_inputs_binding(&mut payload)?;
                    ensure_public_inputs_bind_root_nullifier(
                        root.as_str(),
                        &payload.nullifier,
                        &payload.public_inputs,
                        "swap hide payload (bound, normalized)",
                    )?;
                }
                ensure_v3_payload_public_inputs_shape(&payload, "swap hide payload (bound)")?;
            } else {
                ensure_public_inputs_bind_nullifier_commitment(
                    &payload.nullifier,
                    &payload.commitment,
                    &payload.public_inputs,
                    "swap hide payload (bound)",
                )?;
            }

            let relayer = RelayerService::from_config(&state.config)
                .map_err(map_hide_relayer_invoke_error)?;
            let mut relayer_calls: Vec<Call> = Vec::new();
            if hide_pool_version == Some(HidePoolVersion::V3) {
                let note_commitment_raw = payload
                    .note_commitment
                    .as_deref()
                    .or_else(|| {
                        if payload.commitment.trim().is_empty()
                            || payload.commitment.trim().eq_ignore_ascii_case("0x0")
                        {
                            None
                        } else {
                            Some(payload.commitment.as_str())
                        }
                    })
                    .ok_or_else(|| {
                        AppError::BadRequest(
                            "Hide Balance V3 requires privacy.note_commitment in payload"
                                .to_string(),
                        )
                    })?;
                let note_commitment_felt = parse_felt(note_commitment_raw.trim())?;
                let deposit_ts =
                    shielded_note_deposit_timestamp(&state, executor, note_commitment_felt).await?;
                if deposit_ts == 0 {
                    return Err(AppError::BadRequest(
                        "Hide Balance V3 note belum terdaftar. Deposit note dulu lalu tunggu mixing window."
                            .to_string(),
                    ));
                }
                let min_age_secs = hide_balance_min_note_age_secs();
                let now_unix = chrono::Utc::now().timestamp().max(0) as u64;
                let spendable_at = deposit_ts.saturating_add(min_age_secs);
                payload.spendable_at_unix = Some(spendable_at);
                if now_unix < spendable_at {
                    let remaining = spendable_at - now_unix;
                    return Err(AppError::BadRequest(format!(
                        "Hide Balance mixing window aktif: note age belum memenuhi minimum {} detik. Coba lagi dalam {} detik.",
                        min_age_secs, remaining
                    )));
                }
            } else if hide_executor_kind() == HideExecutorKind::ShieldedPoolV2 {
                let commitment_felt = parse_felt(payload.commitment.trim())?;
                let user_felt = parse_felt(&user_address)?;
                let note_registered =
                    shielded_note_registered(&state, executor, commitment_felt).await?;
                if !note_registered {
                    if hide_balance_v2_redeem_only_enabled() {
                        return Err(AppError::BadRequest(
                            "Hide Balance V2 is redeem-only. Deposit note baru ke V2 diblok; gunakan V3 untuk note baru."
                                .to_string(),
                        ));
                    }
                    if strict_privacy_mode {
                        return Err(AppError::BadRequest(
                                "Hide Balance strict mode blocks inline deposit+swap in one tx. Pre-fund shielded note first, then execute swap in a separate tx."
                                    .to_string(),
                            ));
                    }
                    let (fixed_low, fixed_high) =
                        shielded_fixed_amount(&state, executor, onchain_context.from_token).await?;
                    if fixed_low != onchain_context.amount_low
                        || fixed_high != onchain_context.amount_high
                    {
                        relayer_calls.push(build_shielded_set_asset_rule_call(
                            executor,
                            onchain_context.from_token,
                            onchain_context.amount_low,
                            onchain_context.amount_high,
                        )?);
                    }
                    let reader = OnchainReader::from_config(&state.config)?;
                    let (balance_low, balance_high) =
                        read_erc20_balance_parts(&reader, onchain_context.from_token, user_felt)
                            .await?;
                    if u256_is_greater(
                        onchain_context.amount_low,
                        onchain_context.amount_high,
                        balance_low,
                        balance_high,
                        "requested hide deposit",
                        "user balance",
                    )? {
                        let available = onchain_u256_to_f64(
                            balance_low,
                            balance_high,
                            token_decimals(&req.from_token),
                        )
                        .unwrap_or(0.0);
                        return Err(AppError::BadRequest(format!(
                            "Shielded note funding failed: insufficient {} balance. Needed {}, available {:.8}.",
                            req.from_token.to_ascii_uppercase(),
                            req.amount,
                            available
                        )));
                    }
                    let (allowance_low, allowance_high) = read_erc20_allowance_parts(
                        &reader,
                        onchain_context.from_token,
                        user_felt,
                        executor,
                    )
                    .await?;
                    if u256_is_greater(
                        onchain_context.amount_low,
                        onchain_context.amount_high,
                        allowance_low,
                        allowance_high,
                        "requested hide deposit",
                        "token allowance",
                    )? {
                        let approved = onchain_u256_to_f64(
                            allowance_low,
                            allowance_high,
                            token_decimals(&req.from_token),
                        )
                        .unwrap_or(0.0);
                        return Err(AppError::BadRequest(format!(
                            "Shielded note funding failed: insufficient allowance. Approve {} {} to executor {} first (current allowance {:.8}).",
                            req.amount,
                            req.from_token.to_ascii_uppercase(),
                            felt_hex(executor),
                            approved
                        )));
                    }
                    relayer_calls.push(build_shielded_deposit_fixed_for_call(
                        executor,
                        user_felt,
                        onchain_context.from_token,
                        commitment_felt,
                    )?);
                }
            }
            let submit_call = build_submit_private_intent_call(executor, &payload)?;
            let execute_call = build_execute_private_swap_with_payout_call(
                executor,
                &payload,
                &swap_payout_input,
            )?;
            relayer_calls.push(submit_call);
            relayer_calls.push(execute_call);
            let submitted = relayer
                .submit_calls(relayer_calls)
                .await
                .map_err(map_hide_relayer_invoke_error)?;
            let tx_hash = submitted.tx_hash;
            tracing::info!(
                "Submitted hide swap via relayer pool user={} tx_hash={} executor={}",
                user_address,
                tx_hash,
                felt_hex(executor)
            );
            (tx_hash.clone(), 0_i64, false, Some(tx_hash))
        } else {
            let onchain_tx_hash = normalized_onchain_tx_hash.clone().ok_or_else(|| {
                AppError::BadRequest(
                    "Swap requires onchain_tx_hash. Frontend must submit user-signed Starknet tx."
                        .to_string(),
                )
            })?;
            let onchain_block_number = verify_onchain_swap_tx_hash(
                &state,
                &onchain_tx_hash,
                &auth_subject,
                &user_address,
                &req.from_token,
                &req.to_token,
            )
            .await?;

            let mut privacy_verification_tx: Option<String> = None;
            let privacy_payload = req.privacy.as_ref();
            if should_hide {
                let mapped_payload = privacy_payload.map(|payload| OnchainPrivacyPayload {
                    verifier: payload.verifier.clone(),
                    nullifier: payload.nullifier.clone(),
                    commitment: payload.commitment.clone(),
                    proof: payload.proof.clone(),
                    public_inputs: payload.public_inputs.clone(),
                });
                verify_onchain_hide_balance_invoke_tx(
                    &state,
                    &onchain_tx_hash,
                    &auth_subject,
                    &user_address,
                    mapped_payload.as_ref(),
                    Some(HideBalanceFlow::Swap),
                )
                .await?;
                privacy_verification_tx = Some(onchain_tx_hash.clone());
                if let Some(ref privacy_tx_hash) = privacy_verification_tx {
                    tracing::info!(
                        "Hide-balance privacy verification included in same swap tx tx_hash={} privacy_tx_hash={}",
                        onchain_tx_hash,
                        privacy_tx_hash
                    );
                }
            }

            (
                onchain_tx_hash,
                onchain_block_number,
                true,
                privacy_verification_tx,
            )
        };

    let gas_optimizer = GasOptimizer::new(state.config.clone());
    let estimated_cost = gas_optimizer
        .estimate_cost("swap")
        .await
        .unwrap_or_default();

    let nft_discount_percent = refresh_nft_discount_for_submit(&state, &user_address).await;
    let fee_before_discount = base_fee(amount_in) + mev_fee_for_mode(&req.mode, amount_in);
    let total_fee = total_fee(amount_in, &req.mode, nft_discount_percent);
    let fee_discount_saved = (fee_before_discount - total_fee).max(0.0);
    let from_price = latest_price_usd(&state, &req.from_token).await?;
    let to_price = latest_price_usd(&state, &req.to_token).await?;
    let volume_usd = sanitize_usd_notional(normalize_usd_volume(
        amount_in * from_price,
        expected_out * to_price,
    ));
    let user_ai_level = match state.db.get_user_ai_level(&user_address).await {
        Ok(level) => level,
        Err(err) => {
            tracing::warn!(
                "Failed to resolve user AI level for swap points bonus (user={}): {}",
                user_address,
                err
            );
            1
        }
    };
    let estimated_points_earned = estimate_swap_points_for_response(
        volume_usd,
        state.config.is_testnet(),
        nft_discount_percent,
        user_ai_level,
    );

    // Simpan ke database
    let tx = crate::models::Transaction {
        tx_hash: tx_hash.clone(),
        block_number: onchain_block_number,
        user_address: user_address.to_string(),
        tx_type: "swap".to_string(),
        token_in: Some(req.from_token.clone()),
        token_out: Some(req.to_token.clone()),
        amount_in: Some(rust_decimal::Decimal::from_f64_retain(amount_in).unwrap()),
        amount_out: Some(rust_decimal::Decimal::from_f64_retain(expected_out).unwrap()),
        usd_value: Some(rust_decimal::Decimal::from_f64_retain(volume_usd).unwrap_or_default()),
        fee_paid: Some(rust_decimal::Decimal::from_f64_retain(total_fee).unwrap()),
        points_earned: Some(rust_decimal::Decimal::ZERO),
        timestamp: chrono::Utc::now(),
        processed: false,
    };

    state.db.save_transaction(&tx).await?;
    if should_hide {
        state.db.mark_transaction_private(&tx_hash).await?;
    }
    if nft_discount_percent > 0.0 {
        record_nft_discount_usage_after_submit(&state, &user_address).await;
        let consume_result = consume_nft_usage(&state.config, &user_address, "swap").await;
        if let Err(err) = consume_result {
            tracing::warn!(
                "Failed to consume NFT discount usage after swap success: user={} tx_hash={} err={}",
                user_address,
                tx_hash,
                err
            );
        }
    }

    if let Ok(batch) = gas_optimizer.optimize_batch(vec![tx_hash.clone()]).await {
        tracing::debug!("Optimized gas batch size: {}", batch.len());
    }

    let notification_service = NotificationService::new(state.db.clone(), state.config.clone());
    if let Err(e) = notification_service
        .send_notification(
            &user_address,
            NotificationType::SwapCompleted,
            "Swap completed".to_string(),
            format!(
                "Swapped {} {} to {} {}",
                amount_in, &req.from_token, expected_out, &req.to_token
            ),
            Some(serde_json::json!({
                "tx_hash": tx_hash.clone(),
                "privacy_tx_hash": privacy_verification_tx.clone(),
                "from_token": req.from_token.clone(),
                "to_token": req.to_token.clone(),
                "amount_in": amount_in,
                "amount_out": expected_out,
            })),
        )
        .await
    {
        tracing::warn!("Failed to send swap notification: {}", e);
    }

    tracing::debug!("Estimated swap gas cost: {}", estimated_cost);

    tracing::info!(
        "Swap success for {}: {} {} -> {} {}. Recipient: {}",
        user_address,
        amount_in,
        req.from_token,
        expected_out,
        req.to_token,
        final_recipient
    );

    Ok(Json(ApiResponse::success(ExecuteSwapResponse {
        tx_hash,
        status: if is_user_signed_onchain {
            "submitted_onchain".to_string()
        } else {
            "submitted_relayer".to_string()
        },
        from_amount: req.amount,
        to_amount: expected_out.to_string(),
        actual_rate: (expected_out / amount_in).to_string(),
        fee_paid: total_fee.to_string(),
        fee_before_discount: fee_before_discount.to_string(),
        fee_discount_saved: fee_discount_saved.to_string(),
        nft_discount_percent: nft_discount_percent.to_string(),
        estimated_points_earned: estimated_points_earned.to_string(),
        points_pending: true,
        privacy_tx_hash: privacy_verification_tx,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_hide_pool_version_prefers_payload_note_version() {
        let payload_v3 = PrivacyVerificationPayload {
            verifier: None,
            note_version: Some("v3".to_string()),
            root: None,
            nullifier: None,
            commitment: None,
            note_commitment: None,
            denom_id: None,
            spendable_at_unix: None,
            proof: None,
            public_inputs: None,
        };
        let payload_v2 = PrivacyVerificationPayload {
            verifier: None,
            note_version: Some("v2".to_string()),
            root: None,
            nullifier: None,
            commitment: None,
            note_commitment: None,
            denom_id: None,
            spendable_at_unix: None,
            proof: None,
            public_inputs: None,
        };
        assert!(matches!(
            resolve_hide_pool_version(Some(&payload_v3)),
            HidePoolVersion::V3
        ));
        assert!(matches!(
            resolve_hide_pool_version(Some(&payload_v2)),
            HidePoolVersion::V2
        ));
    }

    #[test]
    fn payload_from_request_preserves_v3_metadata() {
        let payload = PrivacyVerificationPayload {
            verifier: Some("garaga".to_string()),
            note_version: Some("v3".to_string()),
            root: Some("0x123".to_string()),
            nullifier: Some("0x456".to_string()),
            commitment: Some("0x789".to_string()),
            note_commitment: Some("0xabc".to_string()),
            denom_id: Some("10".to_string()),
            spendable_at_unix: Some(1_777_777_777),
            proof: Some(vec!["0x1".to_string(), "0x2".to_string()]),
            public_inputs: Some(vec![
                "0x123".to_string(),
                "0x456".to_string(),
                "0x999".to_string(),
            ]),
        };
        let mapped = payload_from_request(Some(&payload), "garaga").expect("payload must map");
        assert_eq!(mapped.note_version.as_deref(), Some("v3"));
        assert_eq!(mapped.root.as_deref(), Some("0x123"));
        assert_eq!(mapped.note_commitment.as_deref(), Some("0xabc"));
        assert_eq!(mapped.denom_id.as_deref(), Some("10"));
        assert_eq!(mapped.spendable_at_unix, Some(1_777_777_777));
    }

    #[test]
    fn payload_from_request_infers_v3_root_from_public_inputs() {
        let payload = PrivacyVerificationPayload {
            verifier: Some("garaga".to_string()),
            note_version: Some("v3".to_string()),
            root: None,
            nullifier: Some("0x456".to_string()),
            commitment: Some("0x789".to_string()),
            note_commitment: Some("0xabc".to_string()),
            denom_id: Some("10".to_string()),
            spendable_at_unix: Some(1_777_777_777),
            proof: Some(vec!["0x1".to_string(), "0x2".to_string()]),
            public_inputs: Some(vec![
                "0x123".to_string(),
                "0x456".to_string(),
                "0x999".to_string(),
            ]),
        };
        let mapped = payload_from_request(Some(&payload), "garaga").expect("payload must map");
        assert_eq!(mapped.note_version.as_deref(), Some("v3"));
        assert_eq!(mapped.root.as_deref(), Some("0x123"));
    }

    #[test]
    fn hide_balance_min_note_age_default_is_one_hour() {
        // Default hard gate (no env override) is 3600s.
        assert_eq!(hide_balance_min_note_age_secs(), 3600);
    }

    #[test]
    // Internal helper that checks conditions for `is_deadline_valid_accepts_equal_time` in the swap flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn is_deadline_valid_accepts_equal_time() {
        // Memastikan deadline yang sama dengan waktu sekarang dianggap valid
        assert!(is_deadline_valid(100, 100));
    }

    #[test]
    // Internal helper that supports `mev_fee_for_mode_only_private` operations in the swap flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn mev_fee_for_mode_only_private() {
        // Memastikan fee MEV hanya untuk mode private
        assert!((mev_fee_for_mode("private", 100.0) - 1.0).abs() < 1e-9);
        assert!((mev_fee_for_mode("PRIVATE", 100.0) - 1.0).abs() < 1e-9);
        assert!((mev_fee_for_mode("transparent", 100.0) - 0.0).abs() < 1e-9);
    }

    #[test]
    // Internal helper that supports `privacy_verification_depends_on_hide_balance_only` operations in the swap flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn privacy_verification_depends_on_hide_balance_only() {
        assert!(should_run_privacy_verification(true));
        assert!(!should_run_privacy_verification(false));
    }

    #[test]

    // Internal helper that supports `estimated_time_for_dex_defaults` operations in the swap flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn estimated_time_for_dex_defaults() {
        // Memastikan estimasi waktu untuk DEX yang tidak dikenal
        assert_eq!(estimated_time_for_dex("UNKNOWN"), "~2-3 min");
    }

    #[test]
    // Internal helper that runs side-effecting logic for `ensure_supported_starknet_swap_pair_accepts_listed_tokens` in the swap flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn ensure_supported_starknet_swap_pair_accepts_listed_tokens() {
        assert!(ensure_supported_starknet_swap_pair("STRK", "USDT").is_ok());
        assert!(ensure_supported_starknet_swap_pair("WBTC", "CAREL").is_ok());
        assert!(ensure_supported_starknet_swap_pair("USDC", "CAREL").is_ok());
        assert!(ensure_supported_starknet_swap_pair("ETH", "USDT").is_err());
        assert!(ensure_supported_starknet_swap_pair("BTC", "STRK").is_err());
        assert!(ensure_supported_starknet_swap_pair("STRK", "STRK").is_err());
        assert!(ensure_supported_starknet_swap_pair("DOGE", "STRK").is_err());
    }

    #[test]
    // Internal helper that parses or transforms values for `parse_execute_calls_parses_single_call` in the swap flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn parse_execute_calls_parses_single_call() {
        let to = Felt::from(10_u64);
        let selector = Felt::from(20_u64);
        let calldata = vec![
            Felt::from(1_u64),
            to,
            selector,
            Felt::from(0_u64),
            Felt::from(2_u64),
            Felt::from(2_u64),
            Felt::from(111_u64),
            Felt::from(222_u64),
        ];

        let calls = parse_execute_calls(&calldata).expect("must parse execute calldata");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].to, to);
        assert_eq!(calls[0].selector, selector);
        assert_eq!(
            calls[0].calldata,
            vec![Felt::from(111_u64), Felt::from(222_u64)]
        );
    }

    #[test]
    // Internal helper that parses or transforms values for `parse_execute_calls_parses_inline_single_call` in the swap flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn parse_execute_calls_parses_inline_single_call() {
        let to = Felt::from(10_u64);
        let selector = Felt::from(20_u64);
        let calldata = vec![
            Felt::from(1_u64),
            to,
            selector,
            Felt::from(4_u64),
            Felt::from(25_u64),
            Felt::from(0_u64),
            Felt::from(111_u64),
            Felt::from(222_u64),
        ];

        let calls = parse_execute_calls(&calldata).expect("must parse inline execute calldata");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].to, to);
        assert_eq!(calls[0].selector, selector);
        assert_eq!(
            calls[0].calldata,
            vec![
                Felt::from(25_u64),
                Felt::from(0_u64),
                Felt::from(111_u64),
                Felt::from(222_u64),
            ]
        );
    }

    #[test]
    // Internal helper that supports `verify_swap_invoke_payload_requires_sender_match` operations in the swap flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn verify_swap_invoke_payload_requires_sender_match() {
        let swap_contract = Felt::from(0x123_u64);
        let swap_selector = get_selector_from_name("swap").expect("selector");
        let from_token = parse_felt(token_address_for("STRK").unwrap()).expect("token");
        let to_token = parse_felt(token_address_for("USDT").unwrap()).expect("token");
        let tx = Transaction::Invoke(InvokeTransaction::V1(
            starknet_core::types::InvokeTransactionV1 {
                transaction_hash: Felt::from(1_u64),
                sender_address: Felt::from(0xdead_u64),
                calldata: vec![
                    Felt::from(1_u64),
                    swap_contract,
                    swap_selector,
                    Felt::from(0_u64),
                    Felt::from(4_u64),
                    Felt::from(4_u64),
                    Felt::from(25_u64),
                    Felt::from(0_u64),
                    from_token,
                    to_token,
                ],
                max_fee: Felt::from(0_u64),
                signature: Vec::new(),
                nonce: Felt::from(0_u64),
            },
        ));

        let result = verify_swap_invoke_payload(
            &tx,
            &[Felt::from(0xbeef_u64)],
            Some(swap_contract),
            &[from_token],
            &[to_token],
        );
        assert!(result.is_err());
    }

    #[test]
    // Internal helper that supports `verify_swap_invoke_payload_accepts_execute_swap_selector` operations in the swap flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn verify_swap_invoke_payload_accepts_execute_swap_selector() {
        let swap_contract = Felt::from(0x123_u64);
        let execute_swap_selector = get_selector_from_name("execute_swap").expect("selector");
        let from_token = parse_felt(token_address_for("STRK").unwrap()).expect("token");
        let to_token = parse_felt(token_address_for("USDT").unwrap()).expect("token");
        let tx = Transaction::Invoke(InvokeTransaction::V1(
            starknet_core::types::InvokeTransactionV1 {
                transaction_hash: Felt::from(2_u64),
                sender_address: Felt::from(0xbeef_u64),
                calldata: vec![
                    Felt::from(1_u64),
                    swap_contract,
                    execute_swap_selector,
                    Felt::from(0_u64),
                    Felt::from(10_u64),
                    Felt::from(10_u64),
                    Felt::from(0x454b_u64), // dex_id
                    Felt::from(100_u64),    // expected low
                    Felt::from(0_u64),      // expected high
                    Felt::from(99_u64),     // min low
                    Felt::from(0_u64),      // min high
                    from_token,
                    to_token,
                    Felt::from(25_u64), // amount low
                    Felt::from(0_u64),  // amount high
                    Felt::from(0_u64),  // mev flag
                ],
                max_fee: Felt::from(0_u64),
                signature: Vec::new(),
                nonce: Felt::from(0_u64),
            },
        ));

        let result = verify_swap_invoke_payload(
            &tx,
            &[Felt::from(0xbeef_u64)],
            Some(swap_contract),
            &[from_token],
            &[to_token],
        );
        assert!(result.is_ok());
    }

    #[test]
    // Internal helper that supports `verify_swap_invoke_payload_rejects_wrong_approve_spender` operations in the swap flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn verify_swap_invoke_payload_rejects_wrong_approve_spender() {
        let swap_contract = Felt::from(0x123_u64);
        let execute_swap_selector = get_selector_from_name("execute_swap").expect("selector");
        let approve_selector = get_selector_from_name("approve").expect("selector");
        let from_token = parse_felt(token_address_for("STRK").unwrap()).expect("token");
        let to_token = parse_felt(token_address_for("USDT").unwrap()).expect("token");
        let tx = Transaction::Invoke(InvokeTransaction::V1(
            starknet_core::types::InvokeTransactionV1 {
                transaction_hash: Felt::from(3_u64),
                sender_address: Felt::from(0xbeef_u64),
                calldata: vec![
                    Felt::from(2_u64),
                    from_token,
                    approve_selector,
                    Felt::from(0_u64),
                    Felt::from(3_u64),
                    swap_contract,
                    execute_swap_selector,
                    Felt::from(3_u64),
                    Felt::from(10_u64),
                    Felt::from(13_u64),
                    Felt::from(0x999_u64), // wrong approve spender
                    Felt::from(25_u64),    // approve amount low
                    Felt::from(0_u64),     // approve amount high
                    Felt::from(0x454b_u64),
                    Felt::from(100_u64),
                    Felt::from(0_u64),
                    Felt::from(99_u64),
                    Felt::from(0_u64),
                    from_token,
                    to_token,
                    Felt::from(25_u64),
                    Felt::from(0_u64),
                    Felt::from(0_u64),
                ],
                max_fee: Felt::from(0_u64),
                signature: Vec::new(),
                nonce: Felt::from(0_u64),
            },
        ));

        let result = verify_swap_invoke_payload(
            &tx,
            &[Felt::from(0xbeef_u64)],
            Some(swap_contract),
            &[from_token],
            &[to_token],
        );
        assert!(result.is_err());
    }
}
