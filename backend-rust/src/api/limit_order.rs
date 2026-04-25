use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use serde::{Deserialize, Serialize};

use super::privacy::{
    bind_intent_hash_into_payload, ensure_public_inputs_bind_nullifier_commitment,
    ensure_public_inputs_bind_root_nullifier, ensure_public_inputs_bind_v3_shape,
    generate_auto_garaga_payload, AutoPrivacyPayloadResponse, AutoPrivacyTxContext,
};
use super::swap::{
    parse_decimal_to_u256_parts, payload_from_request as swap_payload_from_request, token_decimals,
    wait_for_shielded_note_deposit_timestamp,
};
use crate::error::Result;
use crate::services::ai_plan::ensure_plan_active_for_user;
use crate::services::notification_service::{NotificationService, NotificationType};
use crate::services::onchain::{parse_felt, OnchainReader};
use crate::services::privacy_verifier::parse_privacy_verifier_kind;
use crate::services::relayer::RelayerService;
use crate::{
    // 1. Import modul hash agar terpakai
    constants::{
        token_address_for, EPOCH_DURATION_SECONDS, POINTS_MIN_USD_LIMIT_ORDER,
        POINTS_MIN_USD_LIMIT_ORDER_TESTNET, POINTS_PER_USD_LIMIT_ORDER,
    },
    crypto::hash,
    models::{
        user::PrivacyVerificationPayload as ModelPrivacyVerificationPayload, ApiResponse,
        CreateLimitOrderRequest, LimitOrder, PaginatedResponse,
    },
    services::nft_discount::{consume_nft_usage_if_active, read_active_discount_rate},
    services::price_guard::{
        fallback_price_for, first_sane_price, sanitize_points_usd_base, sanitize_usd_notional,
        symbol_candidates_for,
    },
};
use starknet_core::types::{Call, Felt, FunctionCall};
use starknet_core::utils::get_selector_from_name;
use std::collections::HashSet;
use std::sync::OnceLock;

use super::{
    onchain_privacy::{
        ensure_nullifier_unused, normalize_onchain_tx_hash, should_run_privacy_verification,
        verify_onchain_hide_balance_invoke_tx, HideBalanceFlow,
        PrivacyVerificationPayload as OnchainPrivacyPayload,
    },
    require_starknet_user, require_user, AppState,
};

const AI_LEVEL_2_POINTS_BONUS_PERCENT: f64 = 20.0;
const AI_LEVEL_3_POINTS_BONUS_PERCENT: f64 = 40.0;

#[derive(Debug, Serialize)]
pub struct CreateOrderResponse {
    pub order_id: String,
    pub status: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nft_discount_percent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_points_earned: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub points_pending: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub privacy_tx_hash: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListOrdersQuery {
    pub status: Option<String>,
    pub page: Option<i32>,
    pub limit: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct CancelOrderRequest {
    pub onchain_tx_hash: Option<String>,
    pub plan_id: Option<String>,
    pub hide_balance: Option<bool>,
    pub privacy: Option<ModelPrivacyVerificationPayload>,
}

// Internal helper that supports `expiry_duration_for` operations in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn expiry_duration_for(expiry: &str) -> chrono::Duration {
    match expiry {
        "1d" => chrono::Duration::days(1),
        "7d" => chrono::Duration::days(7),
        "30d" => chrono::Duration::days(30),
        _ => chrono::Duration::days(7),
    }
}

// Internal helper that supports `estimate_limit_order_points_for_response` operations in the limit-order flow.
fn estimate_limit_order_points_for_response(
    usd_value: f64,
    nft_discount_percent: f64,
    is_testnet: bool,
    ai_level: u8,
    hide_mode: bool,
    usdt_equivalent_volume: f64,
) -> f64 {
    let sanitized = sanitize_points_usd_base(usd_value);
    let min_threshold = if is_testnet {
        POINTS_MIN_USD_LIMIT_ORDER_TESTNET
    } else {
        POINTS_MIN_USD_LIMIT_ORDER
    };
    if sanitized < min_threshold {
        return 0.0;
    }
    let nft_factor = 1.0 + (nft_discount_percent.clamp(0.0, 100.0) / 100.0);
    let ai_factor = 1.0 + (ai_level_points_bonus_percent(ai_level) / 100.0);
    let usdt_tier_factor = if hide_mode {
        1.0 + (usdt_tier_bonus_percent(usdt_equivalent_volume) / 100.0)
    } else {
        1.0
    };
    (sanitized * POINTS_PER_USD_LIMIT_ORDER * nft_factor * ai_factor * usdt_tier_factor).max(0.0)
}

// Internal helper that supports `ai_level_points_bonus_percent` operations in the limit-order flow.
fn ai_level_points_bonus_percent(level: u8) -> f64 {
    match level {
        2 => AI_LEVEL_2_POINTS_BONUS_PERCENT,
        3 => AI_LEVEL_3_POINTS_BONUS_PERCENT,
        _ => 0.0,
    }
}

fn usdt_tier_bonus_percent(usdt_equivalent_volume: f64) -> f64 {
    let amount = usdt_equivalent_volume.max(0.0);
    if amount >= 250.0 {
        50.0
    } else if amount >= 100.0 {
        30.0
    } else if amount >= 50.0 {
        20.0
    } else if amount >= 10.0 {
        10.0
    } else if amount >= 5.0 {
        5.0
    } else {
        0.0
    }
}

const NFT_DISCOUNT_LOCAL_STALE_SECS: u64 = 1_800;

// Internal helper that supports `discount_contract_address` operations in the limit-order flow.
fn discount_contract_address(state: &AppState) -> Option<&str> {
    state
        .config
        .discount_soulbound_address
        .as_deref()
        .filter(|addr| !addr.trim().is_empty() && !addr.starts_with("0x0000"))
}

// Internal helper that supports `current_nft_period_epoch` operations in the limit-order flow.
fn current_nft_period_epoch() -> i64 {
    let now = chrono::Utc::now().timestamp();
    let period = (EPOCH_DURATION_SECONDS as i64).max(1);
    if now <= 0 {
        0
    } else {
        now / period
    }
}

// Internal helper that fetches data for `fallback_nft_discount_from_local_state` in the limit-order flow.
async fn fallback_nft_discount_from_local_state(state: &AppState, user_address: &str) -> f64 {
    let Some(contract) = discount_contract_address(state) else {
        return 0.0;
    };
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
            if age_secs > NFT_DISCOUNT_LOCAL_STALE_SECS {
                return 0.0;
            }
            let effective_used = row.local_used_in_period.max(row.chain_used_in_period);
            let has_remaining_usage =
                row.max_usage == i64::MAX || (row.max_usage > 0 && effective_used < row.max_usage);
            if row.is_active && has_remaining_usage {
                row.discount_percent.clamp(0.0, 100.0)
            } else {
                0.0
            }
        }
        Ok(None) => 0.0,
        Err(err) => {
            tracing::warn!(
                "Limit-order local NFT discount fallback failed for user={}: {}",
                user_address,
                err
            );
            0.0
        }
    }
}

// Internal helper that supports `active_nft_discount_percent_for_response` operations in the limit-order flow.
async fn active_nft_discount_percent_for_response(state: &AppState, user_address: &str) -> f64 {
    match read_active_discount_rate(&state.config, user_address).await {
        Ok(discount) => {
            let normalized = discount.clamp(0.0, 100.0);
            if normalized > 0.0 {
                normalized
            } else {
                fallback_nft_discount_from_local_state(state, user_address).await
            }
        }
        Err(err) => {
            tracing::warn!(
                "Limit-order response NFT discount check failed for user={}: {}",
                user_address,
                err
            );
            fallback_nft_discount_from_local_state(state, user_address).await
        }
    }
}

// Internal helper that fetches data for `latest_limit_order_price`.
async fn latest_limit_order_price(state: &AppState, symbol: &str) -> Result<f64> {
    let token = symbol.to_ascii_uppercase();
    for candidate in symbol_candidates_for(&token) {
        let prices: Vec<f64> = sqlx::query_scalar(
            "SELECT close::FLOAT FROM price_history WHERE token = $1 ORDER BY timestamp DESC LIMIT 16",
        )
        .bind(&candidate)
        .fetch_all(state.db.pool())
        .await?;

        if let Some(value) = first_sane_price(&candidate, &prices) {
            return Ok(value);
        }
    }
    Ok(fallback_price_for(&token))
}

// Internal helper that builds inputs for `build_order_id` in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn build_order_id(
    user_address: &str,
    from_token: &str,
    to_token: &str,
    amount: f64,
    now_ts: i64,
) -> String {
    let order_data = format!(
        "{}{}{}{}{}",
        user_address, from_token, to_token, amount, now_ts
    );
    // Keep length <= 66 to fit DB (varchar(66))
    hash::hash_string(&order_data)
}

// Internal helper that checks conditions for `is_supported_limit_order_token` in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn is_supported_limit_order_token(token: &str) -> bool {
    matches!(
        token.trim().to_ascii_uppercase().as_str(),
        "USDT" | "USDC" | "STRK" | "WBTC" | "CAREL"
    )
}

// Internal helper that runs side-effecting logic for `ensure_supported_limit_order_pair` in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn ensure_supported_limit_order_pair(from_token: &str, to_token: &str) -> Result<()> {
    if from_token.trim().eq_ignore_ascii_case(to_token.trim()) {
        return Err(crate::error::AppError::BadRequest(
            "Source and destination tokens cannot be the same.".to_string(),
        ));
    }
    if !is_supported_limit_order_token(from_token) || !is_supported_limit_order_token(to_token) {
        return Err(crate::error::AppError::BadRequest(
            "Limit order token is not listed. Supported symbols: USDT, USDC, STRK, WBTC, CAREL."
                .to_string(),
        ));
    }
    Ok(())
}

// Internal helper that supports `map_privacy_payload` operations in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn map_privacy_payload(
    payload: Option<&ModelPrivacyVerificationPayload>,
) -> Option<OnchainPrivacyPayload> {
    payload.map(|value| OnchainPrivacyPayload {
        verifier: value.verifier.clone(),
        note_version: value.note_version.clone(),
        root: value.root.clone(),
        nullifier: value.nullifier.clone(),
        commitment: value.commitment.clone(),
        proof: value.proof.clone(),
        public_inputs: value.public_inputs.clone(),
    })
}

// Internal helper that parses or transforms values for `normalize_order_id` in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn normalize_order_id(
    raw: Option<&str>,
) -> std::result::Result<Option<String>, crate::error::AppError> {
    let Some(value) = raw.map(str::trim).filter(|item| !item.is_empty()) else {
        return Ok(None);
    };
    if !value.starts_with("0x") {
        return Err(crate::error::AppError::BadRequest(
            "client_order_id must start with 0x".to_string(),
        ));
    }
    if value.len() > 66 {
        return Err(crate::error::AppError::BadRequest(
            "client_order_id exceeds maximum length (66)".to_string(),
        ));
    }
    if !value[2..].chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(crate::error::AppError::BadRequest(
            "client_order_id must be hex-encoded".to_string(),
        ));
    }
    Ok(Some(value.to_ascii_lowercase()))
}

// Internal helper that supports `env_flag` operations in the limit-order flow.
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

// Internal helper that supports `hide_balance_relayer_pool_enabled` operations in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn hide_balance_relayer_pool_enabled() -> bool {
    static VALUE: OnceLock<bool> = OnceLock::new();
    *VALUE.get_or_init(|| env_flag("HIDE_BALANCE_RELAYER_POOL_ENABLED", false))
}

// Internal helper that supports `hide_balance_limit_order_relayer_pool_enabled` operations in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn hide_balance_limit_order_relayer_pool_enabled() -> bool {
    static VALUE: OnceLock<bool> = OnceLock::new();
    *VALUE.get_or_init(|| {
        hide_balance_relayer_pool_enabled()
            && env_flag("HIDE_BALANCE_RELAYER_POOL_LIMIT_ENABLED", false)
    })
}

fn hide_balance_min_note_age_secs() -> u64 {
    static VALUE: OnceLock<u64> = OnceLock::new();
    *VALUE.get_or_init(|| {
        std::env::var("HIDE_BALANCE_MIN_NOTE_AGE_SECS")
            .or_else(|_| std::env::var("NEXT_PUBLIC_HIDE_BALANCE_MIN_NOTE_AGE_SECS"))
            .ok()
            .and_then(|value| value.trim().parse::<u64>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(60)
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum HideExecutorKind {
    PrivateActionExecutorV1,
    ShieldedPoolV4,
}

// Internal helper that supports `hide_executor_kind` operations in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn hide_executor_kind() -> HideExecutorKind {
    static VALUE: OnceLock<HideExecutorKind> = OnceLock::new();
    *VALUE.get_or_init(|| {
        let raw = std::env::var("HIDE_BALANCE_EXECUTOR_KIND")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        if matches!(raw.as_str(), "shielded_pool_v4" | "shielded-v4" | "v4") {
            HideExecutorKind::ShieldedPoolV4
        } else {
            HideExecutorKind::PrivateActionExecutorV1
        }
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum HidePoolVersion {
    V4,
}

fn hide_balance_pool_version_default() -> HidePoolVersion {
    static VALUE: OnceLock<HidePoolVersion> = OnceLock::new();
    *VALUE.get_or_init(|| {
        let _ = std::env::var("HIDE_BALANCE_POOL_VERSION_DEFAULT")
            .unwrap_or_else(|_| "v4".to_string())
            .trim()
            .to_ascii_lowercase();
        HidePoolVersion::V4
    })
}

fn resolve_hide_pool_version(
    payload: Option<&ModelPrivacyVerificationPayload>,
) -> Result<HidePoolVersion> {
    if let Some(note_version) = payload
        .and_then(|value| value.note_version.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if note_version.eq_ignore_ascii_case("v4") {
            return Ok(HidePoolVersion::V4);
        }
        return Err(crate::error::AppError::BadRequest(
            "Hide Balance V4 only. Update note_version to v4.".to_string(),
        ));
    }
    Ok(hide_balance_pool_version_default())
}

// Internal helper that fetches data for `resolve_private_action_executor_candidates` in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn resolve_private_action_executor_candidates(config: &crate::config::Config) -> Result<Vec<Felt>> {
    static CACHED: OnceLock<Vec<Felt>> = OnceLock::new();
    if let Some(cached) = CACHED.get() {
        return Ok(cached.clone());
    }
    let mut out: Vec<Felt> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for raw in [
        std::env::var("PRIVATE_ACTION_EXECUTOR_ADDRESS").ok(),
        std::env::var("NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS").ok(),
        config.privacy_router_address.clone(),
    ]
    .into_iter()
    .flatten()
    {
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
                    "Ignoring invalid PrivateActionExecutor candidate '{}' for limit hide mode: {}",
                    trimmed,
                    err
                );
            }
        }
    }
    if !out.is_empty() {
        let _ = CACHED.set(out.clone());
        return Ok(out);
    }
    Err(crate::error::AppError::BadRequest(
        "PrivateActionExecutor is not configured. Set PRIVATE_ACTION_EXECUTOR_ADDRESS.".to_string(),
    ))
}

// Internal helper that fetches data for `resolve_limit_order_target_felt` in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn resolve_limit_order_target_felt(state: &AppState) -> Result<Felt> {
    parse_felt(state.config.limit_order_book_address.trim()).map_err(|e| {
        crate::error::AppError::BadRequest(format!(
            "LIMIT_ORDER_BOOK_ADDRESS invalid for hide-mode executor: {}",
            e
        ))
    })
}

fn is_missing_entrypoint_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    if lower.contains("entry_point_not_found") || lower.contains("entrypoint_not_found") {
        return true;
    }
    let mentions_entrypoint =
        lower.contains("entrypoint") || lower.contains("entry point") || lower.contains("selector");
    let mentions_missing = lower.contains("does not exist")
        || lower.contains("not found")
        || lower.contains("missing");
    mentions_entrypoint && mentions_missing
}

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

fn is_contract_revert_probe_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("contracterror")
        || lower.contains("contract error")
        || lower.contains("revert_error")
        || lower.contains("execution_error")
        || lower.contains("innercontractexecutionerror")
        || lower.contains("invalid caller")
}

async fn contract_supports_selector(
    state: &AppState,
    contract: Felt,
    selector: Felt,
) -> Result<bool> {
    let reader = OnchainReader::from_config(&state.config)?;
    let probe = reader
        .call(FunctionCall {
            contract_address: contract,
            entry_point_selector: selector,
            calldata: vec![Felt::ONE],
        })
        .await;
    match probe {
        Ok(_) => Ok(true),
        Err(crate::error::AppError::BlockchainRPC(message)) => {
            if is_missing_entrypoint_error(&message) {
                Ok(false)
            } else if is_contract_revert_probe_error(&message) {
                Ok(true)
            } else if is_transient_probe_error(&message) {
                Err(crate::error::AppError::BlockchainRPC(format!(
                    "Failed to probe selector support on {}: {}",
                    contract, message
                )))
            } else {
                Err(crate::error::AppError::BlockchainRPC(format!(
                    "Unexpected selector probe error on {}: {}",
                    contract, message
                )))
            }
        }
        Err(err) => Err(err),
    }
}

async fn executor_supports_selectors(
    state: &AppState,
    executor: Felt,
    selectors: &[&str],
) -> Result<bool> {
    for name in selectors {
        let selector = get_selector_from_name(name)
            .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
        if !contract_supports_selector(state, executor, selector).await? {
            return Ok(false);
        }
    }
    Ok(true)
}

async fn resolve_private_action_executor_felt_for_limit_hide(state: &AppState) -> Result<Felt> {
    let candidates = resolve_private_action_executor_candidates(&state.config)?;
    let required_selectors: &[&str] = match hide_executor_kind() {
        HideExecutorKind::PrivateActionExecutorV1 => &[
            "preview_limit_intent_hash",
            "submit_private_intent",
            "execute_private_limit_order",
        ],
        HideExecutorKind::ShieldedPoolV4 => &[
            "deposit_fixed_v4",
            "preview_limit_action_hash",
            "submit_private_limit",
            "execute_private_limit_v4",
        ],
    };

    let mut unsupported: Vec<String> = Vec::new();
    for candidate in candidates {
        if executor_supports_selectors(state, candidate, required_selectors).await? {
            tracing::info!(
                "Using compatible limit-order hide executor {} (kind={:?})",
                candidate,
                hide_executor_kind()
            );
            return Ok(candidate);
        }
        unsupported.push(candidate.to_string());
    }

    Err(crate::error::AppError::BadRequest(format!(
        "No compatible hide executor found for limit-order flow (kind={:?}). Checked: {}",
        hide_executor_kind(),
        unsupported.join(", ")
    )))
}

async fn resolve_limit_order_action_selector(
    state: &AppState,
    action_target: Felt,
    candidates: &[&str],
) -> Result<Felt> {
    for name in candidates {
        let selector = get_selector_from_name(name)
            .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
        if contract_supports_selector(state, action_target, selector).await? {
            return Ok(selector);
        }
    }
    Err(crate::error::AppError::BadRequest(format!(
        "Limit order contract {} does not expose supported entrypoint (tried: {}).",
        state.config.limit_order_book_address.trim(),
        candidates.join(", ")
    )))
}

// Internal helper that supports `payload_from_request` operations in the limit-order flow.
// Delegates to the shared swap helper so V4 payload normalization stays consistent.
fn payload_from_request(
    payload: Option<&ModelPrivacyVerificationPayload>,
    verifier: &str,
) -> Option<AutoPrivacyPayloadResponse> {
    let payload = payload?;
    let mapped = super::swap::PrivacyVerificationPayload {
        verifier: payload.verifier.clone(),
        note_version: payload.note_version.clone(),
        root: payload.root.clone(),
        nullifier: payload.nullifier.clone(),
        commitment: payload.commitment.clone(),
        note_commitment: payload.note_commitment.clone(),
        note_ciphertext: payload.note_ciphertext.clone(),
        note_cid: payload.note_cid.clone(),
        noir_inputs: payload.noir_inputs.clone(),
        denom_id: payload.denom_id.clone(),
        spendable_at_unix: payload.spendable_at_unix,
        proof: payload.proof.clone(),
        public_inputs: payload.public_inputs.clone(),
    };
    swap_payload_from_request(Some(&mapped), verifier)
}

struct LimitActionCallInput<'a> {
    action_target: Felt,
    action_selector: Felt,
    action_calldata: &'a [Felt],
    approval_token: Felt,
    approval_amount_low: Felt,
    approval_amount_high: Felt,
    payout_token: Felt,
    min_payout_low: Felt,
    min_payout_high: Felt,
}

// Internal helper that supports `compute_limit_intent_hash_on_executor` operations in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn compute_limit_intent_hash_on_executor(
    state: &AppState,
    executor: Felt,
    input: &LimitActionCallInput<'_>,
) -> Result<String> {
    let reader = OnchainReader::from_config(&state.config)?;
    let selector_name = match hide_executor_kind() {
        HideExecutorKind::PrivateActionExecutorV1 => "preview_limit_intent_hash",
        HideExecutorKind::ShieldedPoolV4 => "preview_limit_action_hash",
    };
    let selector = get_selector_from_name(selector_name)
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    let kind = hide_executor_kind();
    let mut calldata: Vec<Felt> = Vec::with_capacity(12 + input.action_calldata.len());
    if kind == HideExecutorKind::ShieldedPoolV4 {
        calldata.push(input.action_target);
    }
    calldata.push(input.action_selector);
    calldata.push(Felt::from(input.action_calldata.len() as u64));
    calldata.extend_from_slice(input.action_calldata);
    if kind == HideExecutorKind::ShieldedPoolV4 {
        calldata.push(input.approval_token);
    }
    if kind == HideExecutorKind::ShieldedPoolV4 {
        calldata.push(input.approval_amount_low);
        calldata.push(input.approval_amount_high);
        calldata.push(input.payout_token);
        calldata.push(input.min_payout_low);
        calldata.push(input.min_payout_high);
    }

    let out = reader
        .call(FunctionCall {
            contract_address: executor,
            entry_point_selector: selector,
            calldata,
        })
        .await?;
    let intent_hash = out.first().ok_or_else(|| {
        crate::error::AppError::BadRequest(
            "PrivateActionExecutor preview returned empty response".to_string(),
        )
    })?;
    Ok(intent_hash.to_string())
}

// Internal helper that builds inputs for `build_submit_private_intent_call` in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn build_submit_private_intent_call(
    executor: Felt,
    payload: &AutoPrivacyPayloadResponse,
) -> Result<Call> {
    let kind = hide_executor_kind();
    let selector_name = match kind {
        HideExecutorKind::PrivateActionExecutorV1 => "submit_private_intent",
        HideExecutorKind::ShieldedPoolV4 => "submit_private_limit",
    };
    let selector = get_selector_from_name(selector_name)
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    let proof: Vec<Felt> = payload
        .proof
        .iter()
        .map(|felt| parse_felt(felt))
        .collect::<Result<Vec<_>>>()?;
    let calldata = if kind == HideExecutorKind::ShieldedPoolV4 {
        let root = payload.root.as_deref().ok_or_else(|| {
            crate::error::AppError::BadRequest("Hide Balance V4 requires privacy.root".to_string())
        })?;
        let mut calldata: Vec<Felt> = Vec::with_capacity(3 + proof.len());
        calldata.push(parse_felt(root.trim())?);
        calldata.push(parse_felt(payload.nullifier.trim())?);
        calldata.push(Felt::from(proof.len() as u64));
        calldata.extend(proof);
        calldata
    } else {
        let public_inputs: Vec<Felt> = payload
            .public_inputs
            .iter()
            .map(|felt| parse_felt(felt))
            .collect::<Result<Vec<_>>>()?;
        let mut calldata: Vec<Felt> = Vec::with_capacity(4 + proof.len() + public_inputs.len());
        calldata.push(parse_felt(payload.nullifier.trim())?);
        calldata.push(parse_felt(payload.commitment.trim())?);
        calldata.push(Felt::from(proof.len() as u64));
        calldata.extend(proof);
        calldata.push(Felt::from(public_inputs.len() as u64));
        calldata.extend(public_inputs);
        calldata
    };

    Ok(Call {
        to: executor,
        selector,
        calldata,
    })
}

// Internal helper that builds inputs for `build_execute_private_limit_call` in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn build_execute_private_limit_call(
    executor: Felt,
    payload: &AutoPrivacyPayloadResponse,
    input: &LimitActionCallInput<'_>,
) -> Result<Call> {
    let kind = hide_executor_kind();
    let selector_name = match kind {
        HideExecutorKind::PrivateActionExecutorV1 => "execute_private_limit_order",
        HideExecutorKind::ShieldedPoolV4 => "execute_private_limit_v4",
    };
    let selector = get_selector_from_name(selector_name)
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    if kind == HideExecutorKind::ShieldedPoolV4 {
        let root = payload.root.as_deref().ok_or_else(|| {
            crate::error::AppError::BadRequest("Hide Balance V4 requires privacy.root".to_string())
        })?;
        let nullifier = payload.nullifier.trim();
        if nullifier.is_empty() {
            return Err(crate::error::AppError::BadRequest(
                "Hide Balance V4 requires non-empty nullifier".to_string(),
            ));
        }
        let proof: Vec<Felt> = payload
            .proof
            .iter()
            .map(|felt| parse_felt(felt))
            .collect::<Result<Vec<_>>>()?;
        let public_inputs: Vec<Felt> = payload
            .public_inputs
            .iter()
            .map(|felt| parse_felt(felt))
            .collect::<Result<Vec<_>>>()?;
        let mut calldata: Vec<Felt> = Vec::with_capacity(
            12 + input.action_calldata.len() + proof.len() + public_inputs.len(),
        );
        calldata.push(parse_felt(root.trim())?);
        calldata.push(parse_felt(nullifier)?);
        calldata.push(Felt::from(proof.len() as u64));
        calldata.extend(proof);
        calldata.push(Felt::from(public_inputs.len() as u64));
        calldata.extend(public_inputs);
        calldata.push(input.action_target);
        calldata.push(input.action_selector);
        calldata.push(Felt::from(input.action_calldata.len() as u64));
        calldata.extend_from_slice(input.action_calldata);
        calldata.push(input.approval_token);
        calldata.push(input.approval_amount_low);
        calldata.push(input.approval_amount_high);
        calldata.push(input.payout_token);
        calldata.push(input.min_payout_low);
        calldata.push(input.min_payout_high);
        return Ok(Call {
            to: executor,
            selector,
            calldata,
        });
    }

    let mut calldata: Vec<Felt> = Vec::with_capacity(6 + input.action_calldata.len());
    calldata.push(parse_felt(payload.commitment.trim())?);
    calldata.push(input.action_selector);
    calldata.push(Felt::from(input.action_calldata.len() as u64));
    calldata.extend_from_slice(input.action_calldata);

    Ok(Call {
        to: executor,
        selector,
        calldata,
    })
}

async fn shielded_current_root(state: &AppState, executor: Felt) -> Result<Felt> {
    let reader = OnchainReader::from_config(&state.config)?;
    let selector = get_selector_from_name("get_root")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    let out = reader
        .call(FunctionCall {
            contract_address: executor,
            entry_point_selector: selector,
            calldata: vec![],
        })
        .await?;
    let root = out.first().copied().unwrap_or(Felt::ZERO);
    if root == Felt::ZERO {
        return Err(crate::error::AppError::BadRequest(
            "ShieldedPoolV4 root belum diinisialisasi (get_root=0).".to_string(),
        ));
    }
    Ok(root)
}

// Struct bantuan untuk menghitung total
#[derive(sqlx::FromRow)]
struct CountResult {
    count: i64,
}

/// POST /api/v1/limit-order/create
pub async fn create_order(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateLimitOrderRequest>,
) -> Result<Json<ApiResponse<CreateOrderResponse>>> {
    let auth_subject = require_user(&headers, &state).await?;
    let user_address = require_starknet_user(&headers, &state).await?;
    if let Some(plan_id) = req.plan_id.as_deref() {
        ensure_plan_active_for_user(&state.config, plan_id, &user_address).await?;
    }
    if let Some(plan_id) = req.plan_id.as_deref() {
        ensure_plan_active_for_user(&state.config, plan_id, &user_address).await?;
    }
    let _ = state
        .db
        .expire_limit_orders_for_owner(&user_address)
        .await?;

    let amount: f64 = req
        .amount
        .parse()
        .map_err(|_| crate::error::AppError::BadRequest("Invalid amount".to_string()))?;

    let price: f64 = req
        .price
        .parse()
        .map_err(|_| crate::error::AppError::BadRequest("Invalid price".to_string()))?;

    if amount <= 0.0 || price <= 0.0 {
        return Err(crate::error::AppError::BadRequest(
            "Amount and price must be greater than 0".to_string(),
        ));
    }
    let from_token_symbol = req.from_token.trim().to_ascii_uppercase();
    let nft_discount_percent =
        active_nft_discount_percent_for_response(&state, &user_address).await;
    let user_ai_level = match state.db.get_user_ai_level(&user_address).await {
        Ok(level) => level,
        Err(err) => {
            tracing::warn!(
                "Failed to resolve user AI level for limit-order points bonus (user={}): {}",
                user_address,
                err
            );
            1
        }
    };
    let should_hide = should_run_privacy_verification(req.hide_balance.unwrap_or(false));
    let from_token_price = latest_limit_order_price(&state, &from_token_symbol).await?;
    let estimated_usd_value = sanitize_usd_notional(amount * from_token_price);
    let estimated_points_earned = estimate_limit_order_points_for_response(
        estimated_usd_value,
        nft_discount_percent,
        state.config.is_testnet(),
        user_ai_level,
        should_hide,
        estimated_usd_value,
    );

    ensure_supported_limit_order_pair(&req.from_token, &req.to_token)?;
    let hide_pool_version = if should_hide {
        Some(resolve_hide_pool_version(req.privacy.as_ref())?)
    } else {
        None
    };
    if should_hide && !matches!(hide_executor_kind(), HideExecutorKind::ShieldedPoolV4) {
        return Err(crate::error::AppError::BadRequest(
            "Hide Balance V4 requires HIDE_BALANCE_EXECUTOR_KIND=shielded_pool_v4.".to_string(),
        ));
    }
    let expiry_duration = expiry_duration_for(&req.expiry);
    let now = chrono::Utc::now();
    let expiry = now + expiry_duration;
    let expiry_ts = expiry.timestamp();
    // 2. GUNAKAN HASHER untuk membuat Order ID (Menghilangkan warning di hash.rs)
    let order_id = normalize_order_id(req.client_order_id.as_deref())?.unwrap_or_else(|| {
        build_order_id(
            &user_address,
            &req.from_token,
            &req.to_token,
            amount,
            now.timestamp(),
        )
    });
    let normalized_onchain_tx_hash = normalize_onchain_tx_hash(req.onchain_tx_hash.as_deref())?;
    let use_relayer_pool_hide = should_hide
        && hide_balance_limit_order_relayer_pool_enabled()
        && normalized_onchain_tx_hash.is_none();
    let tx_hash = if use_relayer_pool_hide {
        let executor = resolve_private_action_executor_felt_for_limit_hide(&state).await?;
        let is_v4 = matches!(hide_pool_version, Some(HidePoolVersion::V4));
        let note_version_label = if is_v4 { Some("v4".to_string()) } else { None };
        let action_target = resolve_limit_order_target_felt(&state)?;
        let verifier_kind = parse_privacy_verifier_kind(
            req.privacy
                .as_ref()
                .and_then(|payload| payload.verifier.as_deref()),
        )?;
        let from_token = token_address_for(&req.from_token)
            .ok_or(crate::error::AppError::InvalidToken)
            .and_then(parse_felt)?;
        let to_token = token_address_for(&req.to_token)
            .ok_or(crate::error::AppError::InvalidToken)
            .and_then(parse_felt)?;
        let order_id_felt = parse_felt(&order_id)?;
        let (amount_low, amount_high) =
            parse_decimal_to_u256_parts(&req.amount, token_decimals(&req.from_token))?;
        let (price_low, price_high) = parse_decimal_to_u256_parts(&req.price, 18)?;
        let action_selector = resolve_limit_order_action_selector(
            &state,
            action_target,
            &["create_limit_order", "create_order"],
        )
        .await?;
        let action_calldata = vec![
            order_id_felt,
            from_token,
            to_token,
            amount_low,
            amount_high,
            price_low,
            price_high,
            Felt::from(expiry_ts as u64),
        ];
        let limit_input = LimitActionCallInput {
            action_target,
            action_selector,
            action_calldata: &action_calldata,
            approval_token: from_token,
            approval_amount_low: amount_low,
            approval_amount_high: amount_high,
            payout_token: to_token,
            min_payout_low: Felt::ZERO,
            min_payout_high: Felt::ZERO,
        };
        let request_payload = payload_from_request(req.privacy.as_ref(), verifier_kind.as_str());
        let payload_from_auto = request_payload.is_none();
        let mut payload = if let Some(request_payload) = request_payload {
            if is_v4 {
                tracing::info!(
                    "Reusing client-provided Hide Balance V4 proof/public_inputs for limit order create"
                );
            }
            request_payload
        } else {
            let mut tx_context = AutoPrivacyTxContext {
                flow: Some("limit_order".to_string()),
                from_token: Some(req.from_token.clone()),
                to_token: Some(req.to_token.clone()),
                amount: Some(req.amount.clone()),
                recipient: req.recipient.clone(),
                from_network: Some("starknet".to_string()),
                to_network: Some("starknet".to_string()),
                noir_inputs: req
                    .privacy
                    .as_ref()
                    .and_then(|value| value.noir_inputs.clone()),
                note_version: note_version_label.clone(),
                ..Default::default()
            };
            if is_v4 {
                tx_context.note_commitment = req
                    .privacy
                    .as_ref()
                    .and_then(|value| value.note_commitment.clone());
                tx_context.note_ciphertext = req
                    .privacy
                    .as_ref()
                    .and_then(|value| value.note_ciphertext.clone());
                tx_context.note_cid = req
                    .privacy
                    .as_ref()
                    .and_then(|value| value.note_cid.clone());
                tx_context.denom_id = req
                    .privacy
                    .as_ref()
                    .and_then(|value| value.denom_id.clone());
                tx_context.nullifier = req
                    .privacy
                    .as_ref()
                    .and_then(|value| value.nullifier.clone());
            }
            generate_auto_garaga_payload(
                &state.config,
                &user_address,
                verifier_kind.as_str(),
                Some(&tx_context),
            )
            .await?
        };

        let mut relayer_calls: Vec<Call> = Vec::new();
        if is_v4 {
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
                    crate::error::AppError::BadRequest(
                        "Hide Balance V4 requires privacy.note_commitment in payload".to_string(),
                    )
                })?;
            let note_commitment_felt = parse_felt(note_commitment_raw.trim())?;
            let deposit_ts = wait_for_shielded_note_deposit_timestamp(
                &state,
                executor,
                note_commitment_felt,
                "limit order create",
            )
            .await?;
            payload.spendable_at_unix =
                Some(deposit_ts.saturating_add(hide_balance_min_note_age_secs()));
        }

        let intent_hash =
            compute_limit_intent_hash_on_executor(&state, executor, &limit_input).await?;
        if is_v4 && payload_from_auto {
            let root = shielded_current_root(&state, executor).await?;
            let tx_context = AutoPrivacyTxContext {
                flow: Some("limit_order".to_string()),
                from_token: Some(req.from_token.clone()),
                to_token: Some(req.to_token.clone()),
                amount: Some(req.amount.clone()),
                recipient: req.recipient.clone(),
                from_network: Some("starknet".to_string()),
                to_network: Some("starknet".to_string()),
                noir_inputs: req
                    .privacy
                    .as_ref()
                    .and_then(|value| value.noir_inputs.clone()),
                note_version: note_version_label.clone(),
                root: Some(format!("{root:#x}")),
                intent_hash: Some(intent_hash.clone()),
                action_hash: Some(intent_hash.clone()),
                action_target: Some(format!("{action_target:#x}")),
                action_selector: Some(format!("{action_selector:#x}")),
                approval_token: Some(format!("{from_token:#x}")),
                payout_token: Some(format!("{to_token:#x}")),
                min_payout: Some("0x0:0x0".to_string()),
                note_commitment: req
                    .privacy
                    .as_ref()
                    .and_then(|value| value.note_commitment.clone()),
                note_ciphertext: req
                    .privacy
                    .as_ref()
                    .and_then(|value| value.note_ciphertext.clone()),
                note_cid: req
                    .privacy
                    .as_ref()
                    .and_then(|value| value.note_cid.clone()),
                denom_id: req
                    .privacy
                    .as_ref()
                    .and_then(|value| value.denom_id.clone()),
                nullifier: req
                    .privacy
                    .as_ref()
                    .and_then(|value| value.nullifier.clone()),
                ..Default::default()
            };
            payload = generate_auto_garaga_payload(
                &state.config,
                &user_address,
                verifier_kind.as_str(),
                Some(&tx_context),
            )
            .await?;
        }
        bind_intent_hash_into_payload(&mut payload, &intent_hash)?;
        if is_v4 {
            payload.note_version = note_version_label.clone();
            let root = payload.root.as_deref().ok_or_else(|| {
                crate::error::AppError::BadRequest(
                    "Hide Balance V4 requires privacy.root in prover payload".to_string(),
                )
            })?;
            ensure_public_inputs_bind_root_nullifier(
                root,
                &payload.nullifier,
                &payload.public_inputs,
                "limit order hide payload (bound)",
            )?;
            ensure_public_inputs_bind_v3_shape(
                &payload.public_inputs,
                "limit order hide payload (bound)",
            )?;
        } else {
            ensure_public_inputs_bind_nullifier_commitment(
                &payload.nullifier,
                &payload.commitment,
                &payload.public_inputs,
                "limit order hide payload (bound)",
            )?;
        }

        if hide_executor_kind() == HideExecutorKind::ShieldedPoolV4 {
            let nullifier = payload.nullifier.trim().to_string();
            if nullifier.is_empty() {
                return Err(crate::error::AppError::BadRequest(
                    "Hide Balance V4 requires non-empty nullifier".to_string(),
                ));
            }
            ensure_nullifier_unused(&state, executor, &nullifier, "limit order hide").await?;
        }

        let relayer = RelayerService::from_config(&state.config)?;
        if hide_executor_kind() == HideExecutorKind::ShieldedPoolV4 {
            let execute_call = build_execute_private_limit_call(executor, &payload, &limit_input)?;
            relayer_calls.push(execute_call);
        } else {
            let submit_call = build_submit_private_intent_call(executor, &payload)?;
            relayer_calls.push(submit_call);
            let execute_call = build_execute_private_limit_call(executor, &payload, &limit_input)?;
            relayer_calls.push(execute_call);
        }
        let submitted = relayer.submit_calls(relayer_calls).await?;
        submitted.tx_hash
    } else {
        let tx_hash = normalized_onchain_tx_hash.ok_or_else(|| {
            crate::error::AppError::BadRequest(
                "Create order requires onchain_tx_hash from user-signed Starknet transaction"
                    .to_string(),
            )
        })?;
        let privacy_payload = map_privacy_payload(req.privacy.as_ref());
        if should_hide {
            verify_onchain_hide_balance_invoke_tx(
                &state,
                &tx_hash,
                &auth_subject,
                &user_address,
                privacy_payload.as_ref(),
                Some(HideBalanceFlow::Limit),
            )
            .await?;
        }
        tx_hash
    };

    let order = LimitOrder {
        order_id: order_id.clone(),
        owner: user_address.to_string(),
        from_token: req.from_token,
        to_token: req.to_token,
        amount: rust_decimal::Decimal::from_f64_retain(amount).unwrap(),
        filled: rust_decimal::Decimal::ZERO,
        price: rust_decimal::Decimal::from_f64_retain(price).unwrap(),
        expiry,
        recipient: req.recipient,
        status: 0,
        created_at: now,
    };

    state.db.create_limit_order(&order).await?;
    if let Err(err) =
        consume_nft_usage_if_active(&state.config, &user_address, "limit_order_create").await
    {
        tracing::warn!(
            "Failed to consume NFT discount usage after limit order create: user={} order_id={} err={}",
            user_address,
            order_id,
            err
        );
    }
    let notification_service = NotificationService::new(state.db.clone(), state.config.clone());
    let _ = notification_service
        .send_notification(
            &user_address,
            NotificationType::System,
            "Limit order submitted".to_string(),
            "Order submitted on-chain and queued for execution.".to_string(),
            Some(serde_json::json!({
                "source": "limit_order.create",
                "order_id": order_id,
                "onchain_tx_hash": tx_hash,
                "privacy_tx_hash": if should_hide { Some(tx_hash.clone()) } else { None::<String> },
            })),
        )
        .await;

    let response = CreateOrderResponse {
        order_id,
        status: if use_relayer_pool_hide {
            "submitted_relayer".to_string()
        } else {
            "submitted_onchain".to_string()
        },
        created_at: order.created_at,
        nft_discount_percent: Some(nft_discount_percent.to_string()),
        estimated_points_earned: Some(estimated_points_earned.to_string()),
        points_pending: Some(true),
        privacy_tx_hash: if should_hide { Some(tx_hash) } else { None },
    };

    Ok(Json(ApiResponse::success(response)))
}

/// GET /api/v1/limit-order/list
pub async fn list_orders(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(query): axum::extract::Query<ListOrdersQuery>,
) -> Result<Json<ApiResponse<PaginatedResponse<LimitOrder>>>> {
    let user_address = require_starknet_user(&headers, &state).await?;
    let _ = state
        .db
        .expire_limit_orders_for_owner(&user_address)
        .await?;
    let page = query.page.unwrap_or(1);
    let limit = query.limit.unwrap_or(10);
    let offset = (page - 1) * limit;

    // Logika penggunaan status agar tidak dead code
    let status_int = query.status.as_ref().map(|s| match s.as_str() {
        "active" => 0,
        "filled" => 2,
        "cancelled" => 3,
        _ => 0,
    });

    // Menggunakan query dinamis sederhana
    let orders = if let Some(s) = status_int {
        sqlx::query_as::<_, LimitOrder>(
            "SELECT * FROM limit_orders WHERE owner = $1 AND status = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4"
        )
        .bind(&user_address)
        .bind(s)
        .bind(limit as i64)
        .bind(offset as i64)
        .fetch_all(state.db.pool())
        .await?
    } else {
        sqlx::query_as::<_, LimitOrder>(
            "SELECT * FROM limit_orders WHERE owner = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3"
        )
        .bind(&user_address)
        .bind(limit as i64)
        .bind(offset as i64)
        .fetch_all(state.db.pool())
        .await?
    };

    // Hitung total dengan filter status juga jika ada
    let total_query = if let Some(s) = status_int {
        sqlx::query_as::<_, CountResult>(
            "SELECT COUNT(*) as count FROM limit_orders WHERE owner = $1 AND status = $2",
        )
        .bind(&user_address)
        .bind(s)
    } else {
        sqlx::query_as::<_, CountResult>(
            "SELECT COUNT(*) as count FROM limit_orders WHERE owner = $1",
        )
        .bind(&user_address)
    };

    let total_res = total_query.fetch_one(state.db.pool()).await?;

    let response = PaginatedResponse {
        items: orders,
        page,
        limit,
        total: total_res.count,
    };

    Ok(Json(ApiResponse::success(response)))
}

/// DELETE /api/v1/limit-order/:order_id
pub async fn cancel_order(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(order_id): Path<String>,
    Json(req): Json<CancelOrderRequest>,
) -> Result<Json<ApiResponse<String>>> {
    let auth_subject = require_user(&headers, &state).await?;
    let user_address = require_starknet_user(&headers, &state).await?;
    if let Some(plan_id) = req.plan_id.as_deref() {
        ensure_plan_active_for_user(&state.config, plan_id, &user_address).await?;
    }
    let _ = state
        .db
        .expire_limit_orders_for_owner(&user_address)
        .await?;
    let should_hide = should_run_privacy_verification(req.hide_balance.unwrap_or(false));
    let hide_pool_version = if should_hide {
        Some(resolve_hide_pool_version(req.privacy.as_ref())?)
    } else {
        None
    };
    if should_hide && !matches!(hide_executor_kind(), HideExecutorKind::ShieldedPoolV4) {
        return Err(crate::error::AppError::BadRequest(
            "Hide Balance V4 requires HIDE_BALANCE_EXECUTOR_KIND=shielded_pool_v4.".to_string(),
        ));
    }
    let order = state
        .db
        .get_limit_order(&order_id)
        .await?
        .ok_or(crate::error::AppError::OrderNotFound)?;

    if order.owner != user_address {
        return Err(crate::error::AppError::AuthError(
            "Not allowed to cancel this order".to_string(),
        ));
    }

    if order.status == 2 {
        return Err(crate::error::AppError::BadRequest(
            "Order already filled".to_string(),
        ));
    }
    if order.status == 4 {
        return Err(crate::error::AppError::BadRequest(
            "Order already expired. Create a new order if you still want to trade.".to_string(),
        ));
    }

    let normalized_onchain_tx_hash = normalize_onchain_tx_hash(req.onchain_tx_hash.as_deref())?;
    let use_relayer_pool_hide = should_hide
        && hide_balance_limit_order_relayer_pool_enabled()
        && normalized_onchain_tx_hash.is_none();
    let tx_hash = if use_relayer_pool_hide {
        let executor = resolve_private_action_executor_felt_for_limit_hide(&state).await?;
        let is_v4 = matches!(hide_pool_version, Some(HidePoolVersion::V4));
        let note_version_label = if is_v4 { Some("v4".to_string()) } else { None };
        let action_target = resolve_limit_order_target_felt(&state)?;
        let verifier_kind = parse_privacy_verifier_kind(
            req.privacy
                .as_ref()
                .and_then(|payload| payload.verifier.as_deref()),
        )?;
        let action_selector = resolve_limit_order_action_selector(
            &state,
            action_target,
            &["cancel_limit_order", "cancel_order"],
        )
        .await?;
        let action_calldata = vec![parse_felt(&order_id)?];
        let approval_token = if hide_executor_kind() == HideExecutorKind::ShieldedPoolV4 {
            token_address_for(&order.from_token)
                .ok_or(crate::error::AppError::InvalidToken)
                .and_then(parse_felt)?
        } else {
            Felt::ZERO
        };
        let limit_input = LimitActionCallInput {
            action_target,
            action_selector,
            action_calldata: &action_calldata,
            approval_token,
            approval_amount_low: Felt::ZERO,
            approval_amount_high: Felt::ZERO,
            payout_token: Felt::ZERO,
            min_payout_low: Felt::ZERO,
            min_payout_high: Felt::ZERO,
        };
        let request_payload = payload_from_request(req.privacy.as_ref(), verifier_kind.as_str());
        let payload_from_auto = request_payload.is_none();
        let mut payload = if let Some(request_payload) = request_payload {
            if is_v4 {
                tracing::info!(
                    "Reusing client-provided Hide Balance V4 proof/public_inputs for limit order cancel"
                );
            }
            request_payload
        } else {
            let mut tx_context = AutoPrivacyTxContext {
                flow: Some("limit_order_cancel".to_string()),
                from_network: Some("starknet".to_string()),
                to_network: Some("starknet".to_string()),
                noir_inputs: req
                    .privacy
                    .as_ref()
                    .and_then(|value| value.noir_inputs.clone()),
                note_version: note_version_label.clone(),
                ..Default::default()
            };
            if is_v4 {
                tx_context.note_commitment = req
                    .privacy
                    .as_ref()
                    .and_then(|value| value.note_commitment.clone());
                tx_context.note_ciphertext = req
                    .privacy
                    .as_ref()
                    .and_then(|value| value.note_ciphertext.clone());
                tx_context.note_cid = req
                    .privacy
                    .as_ref()
                    .and_then(|value| value.note_cid.clone());
                tx_context.denom_id = req
                    .privacy
                    .as_ref()
                    .and_then(|value| value.denom_id.clone());
                tx_context.nullifier = req
                    .privacy
                    .as_ref()
                    .and_then(|value| value.nullifier.clone());
            }
            generate_auto_garaga_payload(
                &state.config,
                &user_address,
                verifier_kind.as_str(),
                Some(&tx_context),
            )
            .await?
        };
        let intent_hash =
            compute_limit_intent_hash_on_executor(&state, executor, &limit_input).await?;
        if is_v4 && payload_from_auto {
            let root = shielded_current_root(&state, executor).await?;
            let tx_context = AutoPrivacyTxContext {
                flow: Some("limit_order_cancel".to_string()),
                from_network: Some("starknet".to_string()),
                to_network: Some("starknet".to_string()),
                noir_inputs: req
                    .privacy
                    .as_ref()
                    .and_then(|value| value.noir_inputs.clone()),
                note_version: note_version_label.clone(),
                root: Some(format!("{root:#x}")),
                intent_hash: Some(intent_hash.clone()),
                action_hash: Some(intent_hash.clone()),
                action_target: Some(format!("{action_target:#x}")),
                action_selector: Some(format!("{action_selector:#x}")),
                approval_token: Some(format!("{approval_token:#x}")),
                payout_token: Some("0x0".to_string()),
                min_payout: Some("0x0:0x0".to_string()),
                note_commitment: req
                    .privacy
                    .as_ref()
                    .and_then(|value| value.note_commitment.clone()),
                note_ciphertext: req
                    .privacy
                    .as_ref()
                    .and_then(|value| value.note_ciphertext.clone()),
                note_cid: req
                    .privacy
                    .as_ref()
                    .and_then(|value| value.note_cid.clone()),
                denom_id: req
                    .privacy
                    .as_ref()
                    .and_then(|value| value.denom_id.clone()),
                nullifier: req
                    .privacy
                    .as_ref()
                    .and_then(|value| value.nullifier.clone()),
                ..Default::default()
            };
            payload = generate_auto_garaga_payload(
                &state.config,
                &user_address,
                verifier_kind.as_str(),
                Some(&tx_context),
            )
            .await?;
        }
        bind_intent_hash_into_payload(&mut payload, &intent_hash)?;
        if is_v4 {
            payload.note_version = note_version_label.clone();
            let root = payload.root.as_deref().ok_or_else(|| {
                crate::error::AppError::BadRequest(
                    "Hide Balance V4 requires privacy.root in prover payload".to_string(),
                )
            })?;
            ensure_public_inputs_bind_root_nullifier(
                root,
                &payload.nullifier,
                &payload.public_inputs,
                "limit cancel hide payload (bound)",
            )?;
            ensure_public_inputs_bind_v3_shape(
                &payload.public_inputs,
                "limit cancel hide payload (bound)",
            )?;
        } else {
            ensure_public_inputs_bind_nullifier_commitment(
                &payload.nullifier,
                &payload.commitment,
                &payload.public_inputs,
                "limit cancel hide payload (bound)",
            )?;
        }

        if hide_executor_kind() == HideExecutorKind::ShieldedPoolV4 {
            let nullifier = payload.nullifier.trim().to_string();
            if nullifier.is_empty() {
                return Err(crate::error::AppError::BadRequest(
                    "Hide Balance V4 requires non-empty nullifier".to_string(),
                ));
            }
            ensure_nullifier_unused(&state, executor, &nullifier, "limit cancel hide").await?;
        }
        let mut relayer_calls: Vec<Call> = Vec::new();
        if is_v4 {
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
                    crate::error::AppError::BadRequest(
                        "Hide Balance V4 requires privacy.note_commitment in payload".to_string(),
                    )
                })?;
            let note_commitment_felt = parse_felt(note_commitment_raw.trim())?;
            let deposit_ts = wait_for_shielded_note_deposit_timestamp(
                &state,
                executor,
                note_commitment_felt,
                "limit order cancel",
            )
            .await?;
            payload.spendable_at_unix =
                Some(deposit_ts.saturating_add(hide_balance_min_note_age_secs()));
        }
        let relayer = RelayerService::from_config(&state.config)?;
        if hide_executor_kind() == HideExecutorKind::ShieldedPoolV4 {
            let execute_call = build_execute_private_limit_call(executor, &payload, &limit_input)?;
            relayer_calls.push(execute_call);
        } else {
            let submit_call = build_submit_private_intent_call(executor, &payload)?;
            relayer_calls.push(submit_call);
            let execute_call = build_execute_private_limit_call(executor, &payload, &limit_input)?;
            relayer_calls.push(execute_call);
        }
        let submitted = relayer.submit_calls(relayer_calls).await?;
        submitted.tx_hash
    } else {
        let tx_hash = normalized_onchain_tx_hash.ok_or_else(|| {
            crate::error::AppError::BadRequest(
                "Cancel order requires onchain_tx_hash from user-signed Starknet transaction"
                    .to_string(),
            )
        })?;
        let privacy_payload = map_privacy_payload(req.privacy.as_ref());
        if should_hide {
            verify_onchain_hide_balance_invoke_tx(
                &state,
                &tx_hash,
                &auth_subject,
                &user_address,
                privacy_payload.as_ref(),
                Some(HideBalanceFlow::Limit),
            )
            .await?;
        }
        tx_hash
    };

    state.db.update_order_status(&order_id, 3).await?;
    tracing::info!(
        "Limit order cancelled: user={}, order_id={}, onchain_tx_hash={}",
        user_address,
        order_id,
        tx_hash
    );

    Ok(Json(ApiResponse::success(
        "Order cancelled successfully".to_string(),
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_hide_pool_version_prefers_note_version_field() {
        let payload_v4 = ModelPrivacyVerificationPayload {
            verifier: None,
            note_version: Some("v4".to_string()),
            root: None,
            nullifier: None,
            commitment: None,
            note_commitment: None,
            note_ciphertext: None,
            note_cid: None,
            noir_inputs: None,
            denom_id: None,
            spendable_at_unix: None,
            proof: None,
            public_inputs: None,
        };
        let payload_v3 = ModelPrivacyVerificationPayload {
            verifier: None,
            note_version: Some("v3".to_string()),
            root: None,
            nullifier: None,
            commitment: None,
            note_commitment: None,
            note_ciphertext: None,
            note_cid: None,
            noir_inputs: None,
            denom_id: None,
            spendable_at_unix: None,
            proof: None,
            public_inputs: None,
        };
        assert!(matches!(
            resolve_hide_pool_version(Some(&payload_v4)).unwrap(),
            HidePoolVersion::V4
        ));
        assert!(resolve_hide_pool_version(Some(&payload_v3)).is_err());
    }

    #[test]
    fn payload_from_request_preserves_v4_metadata() {
        let payload = ModelPrivacyVerificationPayload {
            verifier: Some("garaga".to_string()),
            note_version: Some("v4".to_string()),
            root: Some("0x123".to_string()),
            nullifier: Some("0x456".to_string()),
            commitment: Some("0x789".to_string()),
            note_commitment: Some("0xabc".to_string()),
            note_ciphertext: None,
            note_cid: None,
            noir_inputs: None,
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
        assert_eq!(mapped.note_version.as_deref(), Some("v4"));
        assert_eq!(mapped.root.as_deref(), Some("0x123"));
        assert_eq!(mapped.note_commitment.as_deref(), Some("0xabc"));
        assert_eq!(mapped.denom_id.as_deref(), Some("10"));
        assert_eq!(mapped.spendable_at_unix, Some(1_777_777_777));
    }

    #[test]
    fn payload_from_request_infers_v4_root_from_public_inputs() {
        let payload = ModelPrivacyVerificationPayload {
            verifier: Some("garaga".to_string()),
            note_version: Some("v4".to_string()),
            root: None,
            nullifier: Some("0x456".to_string()),
            commitment: Some("0x789".to_string()),
            note_commitment: Some("0xabc".to_string()),
            note_ciphertext: None,
            note_cid: None,
            noir_inputs: None,
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
        assert_eq!(mapped.note_version.as_deref(), Some("v4"));
        assert_eq!(mapped.root.as_deref(), Some("0x123"));
    }

    #[test]
    fn ai_level_points_bonus_percent_matches_expected() {
        assert_eq!(ai_level_points_bonus_percent(1), 0.0);
        assert_eq!(ai_level_points_bonus_percent(2), 20.0);
        assert_eq!(ai_level_points_bonus_percent(3), 40.0);
    }

    #[test]
    fn usdt_tier_bonus_percent_applies_expected_tiers() {
        assert_eq!(usdt_tier_bonus_percent(4.99), 0.0);
        assert_eq!(usdt_tier_bonus_percent(5.0), 5.0);
        assert_eq!(usdt_tier_bonus_percent(10.0), 10.0);
        assert_eq!(usdt_tier_bonus_percent(50.0), 20.0);
        assert_eq!(usdt_tier_bonus_percent(100.0), 30.0);
        assert_eq!(usdt_tier_bonus_percent(250.0), 50.0);
    }

    #[test]
    fn usdt_tier_bonus_is_hide_mode_only_for_limit_order() {
        let normal = estimate_limit_order_points_for_response(100.0, 0.0, true, 1, false, 100.0);
        let hide = estimate_limit_order_points_for_response(100.0, 0.0, true, 1, true, 100.0);
        assert!(hide > normal);
    }

    #[test]
    // Internal helper that supports `expiry_duration_for_defaults_to_7d` operations in the limit-order flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn expiry_duration_for_defaults_to_7d() {
        // Memastikan input tidak dikenal memakai 7 hari
        let duration = expiry_duration_for("unknown");
        assert_eq!(duration.num_days(), 7);
    }

    #[test]
    // Internal helper that builds inputs for `build_order_id_is_stable` in the limit-order flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn build_order_id_is_stable() {
        // Memastikan order_id konsisten untuk input yang sama
        let id = build_order_id("0xabc", "ETH", "USDT", 10.0, 1_700_000_000);
        let order_data = format!("{}{}{}{}{}", "0xabc", "ETH", "USDT", 10.0, 1_700_000_000);
        let expected = hash::hash_string(&order_data);
        assert_eq!(id, expected);
    }

    #[test]
    // Internal helper that runs side-effecting logic for `ensure_supported_limit_order_pair_accepts_listed_tokens` in the limit-order flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn ensure_supported_limit_order_pair_accepts_listed_tokens() {
        assert!(ensure_supported_limit_order_pair("STRK", "USDT").is_ok());
        assert!(ensure_supported_limit_order_pair("CAREL", "USDC").is_ok());
        assert!(ensure_supported_limit_order_pair("WBTC", "USDT").is_ok());
        assert!(ensure_supported_limit_order_pair("USDC", "WBTC").is_ok());
        assert!(ensure_supported_limit_order_pair("ETH", "USDT").is_err());
        assert!(ensure_supported_limit_order_pair("USDT", "USDT").is_err());
    }
}
