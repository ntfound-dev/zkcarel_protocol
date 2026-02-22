use super::{require_starknet_user, require_user, AppState};
use crate::indexer::starknet_client::StarknetClient;
use crate::services::onchain::{
    felt_to_u128, parse_felt, resolve_backend_account, OnchainInvoker, OnchainReader,
};
use crate::{
    error::{AppError, Result},
    models::{ApiResponse, Transaction},
    services::ai_service::{
        classify_command_scope, has_llm_provider_configured, AIGuardScope, AIResponse, AIService,
    },
};
use axum::extract::Query;
use axum::{extract::State, http::HeaderMap, Json};
use chrono::Utc;
use redis::AsyncCommands;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use starknet_core::types::{
    Call, ExecutionResult, Felt as CoreFelt, FunctionCall, InvokeTransaction,
    Transaction as StarknetTransaction, TransactionFinalityStatus,
};
use starknet_core::utils::{get_selector_from_name, get_storage_var_address};
use starknet_crypto::{poseidon_hash_many, Felt as CryptoFelt};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::time::{sleep, Duration};

const DEFAULT_SIGNATURE_WINDOW_SECONDS: u64 = 30;
const MIN_SIGNATURE_WINDOW_SECONDS: u64 = 10;
const MAX_SIGNATURE_WINDOW_SECONDS: u64 = 90;
const SIGNATURE_PAST_SKEW_SECONDS: u64 = 2;
const AI_EXECUTE_TIMEOUT_MS: u64 = 12_000;
const AI_LEVEL_2_TOTAL_CAREL_WEI: u128 = 5_000_000_000_000_000_000;
const AI_LEVEL_3_TOTAL_CAREL_WEI: u128 = 10_000_000_000_000_000_000;
const AI_LEVEL_PAYMENT_DECIMALS: u32 = 18;
const AI_EXECUTOR_READY_POLL_ATTEMPTS: usize = 12;
const AI_EXECUTOR_READY_POLL_DELAY_MS: u64 = 1_500;
const AI_PREPARE_READY_POLL_ATTEMPTS: usize = 16;
const AI_PREPARE_READY_POLL_DELAY_MS: u64 = 900;
const DEFAULT_AI_EXECUTOR_TARGET_RATE_LIMIT: u128 = 1_000;

#[derive(Debug, Deserialize)]
pub struct AICommandRequest {
    pub command: String,
    pub context: Option<String>,
    pub level: Option<u8>,
    pub action_id: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct AICommandResponse {
    pub response: String,
    pub actions: Vec<String>,
    pub confidence: f64,
    pub level: u8,
    pub data: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct PendingActionsQuery {
    pub offset: Option<u64>,
    pub limit: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct PendingActionsResponse {
    pub pending: Vec<u64>,
}

#[derive(Debug, Serialize)]
pub struct AIRuntimeConfigResponse {
    pub executor_configured: bool,
    pub executor_address: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AIExecutorReadyResponse {
    pub ready: bool,
    pub burner_role_granted: bool,
    pub updated_onchain: bool,
    pub tx_hash: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone)]
struct RateLimitEnsureResult {
    ready: bool,
    message: String,
}

#[derive(Debug, Deserialize)]
pub struct PrepareAIActionRequest {
    pub level: u8,
    pub context: Option<String>,
    pub window_seconds: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct PrepareAIActionResponse {
    pub tx_hash: String,
    pub action_type: u64,
    pub params: String,
    pub hashes_prepared: u64,
    pub from_timestamp: u64,
    pub to_timestamp: u64,
}

#[derive(Debug, Serialize)]
pub struct AILevelResponse {
    pub current_level: u8,
    pub max_level: u8,
    pub next_level: Option<u8>,
    pub next_upgrade_cost_carel: Option<String>,
    pub payment_address_configured: bool,
    pub payment_address: Option<String>,
    // Backward-compatible alias for legacy frontend fields.
    pub burn_address_configured: bool,
    pub burn_address: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AIUpgradeLevelRequest {
    pub target_level: u8,
    pub onchain_tx_hash: String,
}

#[derive(Debug, Serialize)]
pub struct AIUpgradeLevelResponse {
    pub previous_level: u8,
    pub current_level: u8,
    pub target_level: u8,
    pub burned_carel: String,
    pub onchain_tx_hash: String,
    pub block_number: i64,
}

#[derive(Debug, Clone)]
struct ParsedExecuteCall {
    to: CoreFelt,
    selector: CoreFelt,
    calldata: Vec<CoreFelt>,
}

// Internal helper that builds inputs for `build_command`.
fn build_command(command: &str, context: &Option<String>) -> String {
    match context {
        Some(ctx) => format!("{} | context: {}", command, ctx),
        None => command.to_string(),
    }
}

// Internal helper that supports `confidence_score` operations.
fn confidence_score(has_llm_provider: bool) -> f64 {
    if has_llm_provider {
        0.9
    } else {
        0.6
    }
}

// Internal helper that supports `total_upgrade_cost_wei_for_level` operations.
fn total_upgrade_cost_wei_for_level(level: u8) -> Option<u128> {
    match level {
        1 => Some(0),
        2 => Some(AI_LEVEL_2_TOTAL_CAREL_WEI),
        3 => Some(AI_LEVEL_3_TOTAL_CAREL_WEI),
        _ => None,
    }
}

// Internal helper that supports `incremental_upgrade_cost_wei` operations.
fn incremental_upgrade_cost_wei(current_level: u8, target_level: u8) -> Option<u128> {
    let current_total = total_upgrade_cost_wei_for_level(current_level)?;
    let target_total = total_upgrade_cost_wei_for_level(target_level)?;
    Some(target_total.saturating_sub(current_total))
}

// Internal helper that supports `wei_to_carel_decimal` operations.
fn wei_to_carel_decimal(wei: u128) -> Decimal {
    let capped = i128::try_from(wei).unwrap_or(i128::MAX);
    Decimal::from_i128_with_scale(capped, AI_LEVEL_PAYMENT_DECIMALS)
}

// Internal helper that supports `wei_to_carel_string` operations.
fn wei_to_carel_string(wei: u128) -> String {
    wei_to_carel_decimal(wei).normalize().to_string()
}

// Internal helper that parses or transforms values for `normalize_onchain_tx_hash`.
fn normalize_onchain_tx_hash(raw: &str) -> Result<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest(
            "onchain_tx_hash is required".to_string(),
        ));
    }
    if !trimmed.starts_with("0x") {
        return Err(AppError::BadRequest(
            "onchain_tx_hash must start with 0x".to_string(),
        ));
    }
    if trimmed.len() > 66 {
        return Err(AppError::BadRequest(
            "onchain_tx_hash exceeds maximum length (66)".to_string(),
        ));
    }
    if !trimmed[2..].chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::BadRequest(
            "onchain_tx_hash must be hex-encoded".to_string(),
        ));
    }
    Ok(trimmed.to_ascii_lowercase())
}

// Internal helper that runs side-effecting logic for `ensure_ai_level_scope`.
fn ensure_ai_level_scope(level: u8, command: &str) -> Result<()> {
    let scope = classify_command_scope(command);
    if level >= 3
        && matches!(scope, AIGuardScope::SwapBridge)
        && is_bridge_command(command)
        && !ai_level3_bridge_enabled()
    {
        return Err(AppError::BadRequest(
            "Level 3 bridge is currently disabled because Garaga bridge flow is not implemented for public Garden API yet. Use Level 2 for bridge commands, or enable AI_LEVEL3_BRIDGE_ENABLED=true for custom provider."
                .to_string(),
        ));
    }
    match level {
        1 => {
            if matches!(
                scope,
                AIGuardScope::SwapBridge | AIGuardScope::PortfolioAlert
            ) {
                return Err(AppError::BadRequest(
                    "You need Level 2 (5 CAREL) for swap/bridge/stake/claim/limit execution, or Level 3 (10 CAREL) for unstake/portfolio/alerts."
                        .to_string(),
                ));
            }
        }
        2 => {
            if !matches!(
                scope,
                AIGuardScope::ReadOnly | AIGuardScope::SwapBridge | AIGuardScope::Unknown
            ) {
                return Err(AppError::BadRequest(
                    "You need Level 3 (10 CAREL) for unstake/portfolio/alert management commands."
                        .to_string(),
                ));
            }
        }
        3 => {
            if !matches!(
                scope,
                AIGuardScope::ReadOnly
                    | AIGuardScope::SwapBridge
                    | AIGuardScope::PortfolioAlert
                    | AIGuardScope::Unknown
            ) {
                return Err(AppError::BadRequest(
                    "Level 3 supports all AI commands: read-only, swap/bridge, portfolio, and alerts."
                        .to_string(),
                ));
            }
        }
        _ => {
            return Err(AppError::BadRequest("Invalid AI level".to_string()));
        }
    }
    Ok(())
}

// Internal helper that supports `ai_level3_bridge_enabled` operations.
fn ai_level3_bridge_enabled() -> bool {
    std::env::var("AI_LEVEL3_BRIDGE_ENABLED")
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

// Internal helper that supports `is_bridge_command` operations.
fn is_bridge_command(command: &str) -> bool {
    let lower = command.to_ascii_lowercase();
    lower.contains("bridge") || lower.contains("jembatan")
}

// Internal helper that supports `resolve_effective_ai_level` operations.
async fn resolve_effective_ai_level(
    state: &AppState,
    user_address: &str,
    requested_level: Option<u8>,
) -> Result<(u8, u8)> {
    let unlocked_level = state.db.get_user_ai_level(user_address).await?;
    let selected_level = requested_level.unwrap_or(unlocked_level);
    if !(1..=3).contains(&selected_level) {
        return Err(AppError::BadRequest("Invalid AI level".to_string()));
    }
    if selected_level > unlocked_level {
        return Err(AppError::BadRequest(format!(
            "Your AI level is {}. Upgrade first to use Level {} commands.",
            unlocked_level, selected_level
        )));
    }
    Ok((unlocked_level, selected_level))
}

// Internal helper that supports `requires_onchain_action_id` operations.
fn requires_onchain_action_id(level: u8, command: &str) -> bool {
    if level < 2 {
        return false;
    }
    matches!(
        classify_command_scope(command),
        AIGuardScope::SwapBridge | AIGuardScope::PortfolioAlert
    )
}

// Internal helper that supports `should_consume_onchain_action` operations.
fn should_consume_onchain_action(command: &str) -> bool {
    requires_onchain_action_id(2, command) || requires_onchain_action_id(3, command)
}

// Internal helper that supports `ai_action_consumed_key` operations.
fn ai_action_consumed_key(executor_address: &str, user_address: &str, action_id: u64) -> String {
    format!(
        "ai:action:consumed:{}:{}:{}",
        executor_address.trim().to_ascii_lowercase(),
        user_address.trim().to_ascii_lowercase(),
        action_id
    )
}

// Internal helper that supports `is_ai_action_consumed` operations.
async fn is_ai_action_consumed(state: &AppState, user_address: &str, action_id: u64) -> bool {
    let mut conn = state.redis.clone();
    let key = ai_action_consumed_key(&state.config.ai_executor_address, user_address, action_id);
    match conn.exists::<_, bool>(&key).await {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(
                "AI consumed-action check skipped user={} action_id={} err={}",
                user_address,
                action_id,
                err
            );
            false
        }
    }
}

// Internal helper that runs side-effecting logic for `mark_ai_action_consumed`.
async fn mark_ai_action_consumed(state: &AppState, user_address: &str, action_id: u64) {
    let mut conn = state.redis.clone();
    let key = ai_action_consumed_key(&state.config.ai_executor_address, user_address, action_id);
    let result: std::result::Result<(), redis::RedisError> = conn.set(&key, 1_i32).await;
    if let Err(err) = result {
        tracing::warn!(
            "AI consumed-action mark failed user={} action_id={} err={}",
            user_address,
            action_id,
            err
        );
    }
}

// Internal helper that runs side-effecting logic for `consume_onchain_action_via_backend`.
async fn consume_onchain_action_via_backend(state: &AppState, action_id: u64) -> Result<CoreFelt> {
    if action_id == 0 {
        return Err(AppError::BadRequest(
            "Invalid on-chain AI action_id".to_string(),
        ));
    }
    let contract = state.config.ai_executor_address.trim();
    if contract.is_empty() || contract.starts_with("0x0000") {
        return Err(AppError::BadRequest(
            "AI executor not configured".to_string(),
        ));
    }
    let onchain = OnchainInvoker::from_config(&state.config)?.ok_or_else(|| {
        AppError::BadRequest(
            "Backend on-chain signer is not configured. Set BACKEND_ACCOUNT_ADDRESS and BACKEND_PRIVATE_KEY."
                .to_string(),
        )
    })?;
    let to = parse_felt(contract)?;
    let selector = get_selector_from_name("execute_action")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let execute_call = Call {
        to,
        selector,
        // execute_action(action_id: u64, backend_signature: Span<felt252>)
        calldata: vec![CoreFelt::from(action_id), CoreFelt::from(0_u8)],
    };
    match onchain.invoke(execute_call.clone()).await {
        Ok(tx_hash) => return Ok(tx_hash),
        Err(err) => {
            let lower = err.to_string().to_ascii_lowercase();
            if lower.contains("invalid backend signature")
                && ai_executor_auto_disable_signature_verification()
            {
                let disable_tx = backend_disable_ai_executor_signature_verification(state).await?;
                tracing::warn!(
                    "AI executor signature verification disabled on-chain: tx={:#x}",
                    disable_tx
                );
                return onchain.invoke(execute_call).await.map_err(|retry_err| {
                    let retry_text = retry_err.to_string();
                    if retry_text
                        .to_ascii_lowercase()
                        .contains("invalid backend signature")
                    {
                        return AppError::BadRequest(
                            "AI setup signature window is stale/mismatched. Click Auto Setup On-Chain once, then retry the command."
                                .to_string(),
                        );
                    }
                    AppError::BlockchainRPC(format!(
                        "Failed to consume AI action on-chain after disabling signature verification: {}",
                        retry_err
                    ))
                });
            }
            let msg = err.to_string();
            let lower = msg.to_ascii_lowercase();
            if lower.contains("unauthorized backend signer") || lower.contains("missing role") {
                return Err(AppError::BadRequest(
                    "Backend signer is not authorized on AI executor. Set AI backend signer correctly on contract deployment."
                        .to_string(),
                ));
            }
            if lower.contains("action not pending") || lower.contains("action not found") {
                return Err(AppError::BadRequest(
                    "AI action is no longer pending. Please click Auto Setup On-Chain and retry."
                        .to_string(),
                ));
            }
            if lower.contains("invalid backend signature") {
                return Err(AppError::BadRequest(
                    "AI executor still requires backend signature. Disable signature verification on AI executor or enable AI_EXECUTOR_AUTO_DISABLE_SIGNATURE_VERIFICATION=true."
                        .to_string(),
                ));
            }
            return Err(AppError::BlockchainRPC(format!(
                "Failed to consume AI action on-chain: {}",
                msg
            )));
        }
    }
}

// Internal helper that supports `ai_executor_auto_disable_signature_verification` operations.
fn ai_executor_auto_disable_signature_verification() -> bool {
    std::env::var("AI_EXECUTOR_AUTO_DISABLE_SIGNATURE_VERIFICATION")
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(true)
}

// Internal helper that runs side-effecting logic for `backend_disable_ai_executor_signature_verification`.
async fn backend_disable_ai_executor_signature_verification(state: &AppState) -> Result<CoreFelt> {
    let contract = state.config.ai_executor_address.trim();
    if contract.is_empty() || contract.starts_with("0x0000") {
        return Err(AppError::BadRequest(
            "AI executor not configured".to_string(),
        ));
    }
    let onchain = OnchainInvoker::from_config(&state.config)?.ok_or_else(|| {
        AppError::BadRequest(
            "Backend on-chain signer is not configured. Set BACKEND_ACCOUNT_ADDRESS and BACKEND_PRIVATE_KEY."
                .to_string(),
        )
    })?;
    let to = parse_felt(contract)?;
    let selector = get_selector_from_name("set_signature_verification")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    onchain
        .invoke(Call {
            to,
            selector,
            // set_signature_verification(verifier, enabled=false)
            calldata: vec![CoreFelt::from(0_u8), CoreFelt::from(0_u8)],
        })
        .await
        .map_err(|err| {
            let msg = err.to_string();
            let lower = msg.to_ascii_lowercase();
            if lower.contains("unauthorized admin")
                || lower.contains("unauthorized backend signer")
                || lower.contains("missing role")
            {
                AppError::BadRequest(
                    "Backend signer is not AI executor admin, cannot disable signature verification automatically."
                        .to_string(),
                )
            } else {
                AppError::BlockchainRPC(format!(
                    "Failed to disable AI executor signature verification on-chain: {}",
                    msg
                ))
            }
        })
}

// Internal helper that supports `ai_level_limit` operations.
fn ai_level_limit(state: &AppState, level: u8) -> u32 {
    match level {
        1 => state.config.ai_rate_limit_level_1_per_window,
        2 => state.config.ai_rate_limit_level_2_per_window,
        3 => state.config.ai_rate_limit_level_3_per_window,
        _ => 1,
    }
}

// Internal helper that supports `time_bucket` operations.
fn time_bucket(window_seconds: u64) -> u64 {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let window = window_seconds.max(1);
    now / window
}

// Internal helper that supports `enforce_ai_rate_limit` operations.
async fn enforce_ai_rate_limit(
    state: &AppState,
    user_address: &str,
    level: u8,
    onchain: bool,
) -> Result<()> {
    let mode = if onchain { "onchain" } else { "offchain" };
    let window_seconds = state.config.ai_rate_limit_window_seconds.max(10);
    let level_limit = ai_level_limit(state, level).max(1) as i64;
    let global_limit = state.config.ai_rate_limit_global_per_window.max(1) as i64;
    let bucket = time_bucket(window_seconds);
    let normalized_user = user_address.trim().to_ascii_lowercase();

    let level_key = format!("ai:rl:l{}:{}:{}:{}", level, mode, normalized_user, bucket);
    let global_key = format!("ai:rl:all:{}:{}", normalized_user, bucket);

    let mut conn = state.redis.clone();

    let level_count: i64 = match conn.incr(&level_key, 1_i64).await {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!("AI rate limiter skipped (level incr failed): {}", err);
            return Ok(());
        }
    };
    if level_count == 1 {
        let _: std::result::Result<bool, redis::RedisError> =
            conn.expire(&level_key, window_seconds as i64).await;
    }

    let global_count: i64 = match conn.incr(&global_key, 1_i64).await {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!("AI rate limiter skipped (global incr failed): {}", err);
            return Ok(());
        }
    };
    if global_count == 1 {
        let _: std::result::Result<bool, redis::RedisError> =
            conn.expire(&global_key, window_seconds as i64).await;
    }

    if level_count > level_limit || global_count > global_limit {
        tracing::warn!(
            "AI rate limit exceeded user={} level={} mode={} level_count={} global_count={}",
            user_address,
            level,
            mode,
            level_count,
            global_count
        );
        return Err(AppError::RateLimitExceeded);
    }

    Ok(())
}

/// POST /api/v1/ai/execute
pub async fn execute_command(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AICommandRequest>,
) -> Result<Json<ApiResponse<AICommandResponse>>> {
    let auth_subject = require_user(&headers, &state).await?;
    let config = state.config.clone();
    let service = AIService::new(state.db.clone(), config.clone());

    let command = build_command(&req.command, &req.context);
    let (unlocked_level, level) =
        resolve_effective_ai_level(&state, &auth_subject, req.level).await?;
    tracing::info!(
        "AI execute: user={}, level={}, unlocked_level={}, action_id={:?}",
        auth_subject,
        level,
        unlocked_level,
        req.action_id
    );
    ensure_ai_level_scope(level, &command)?;

    let needs_onchain_action = requires_onchain_action_id(level, &command);
    let mut resolved_action_id: Option<u64> = None;
    let mut onchain_action_user: Option<String> = None;
    if needs_onchain_action {
        let starknet_user = require_starknet_user(&headers, &state).await?;
        let resolved = if let Some(requested_action_id) = req.action_id {
            ensure_onchain_action(&state, &starknet_user, requested_action_id).await?
        } else {
            let contract = state.config.ai_executor_address.trim();
            if contract.is_empty() || contract.starts_with("0x0000") {
                return Err(crate::error::AppError::BadRequest(
                    "AI executor not configured".into(),
                ));
            }
            let client = StarknetClient::new(state.config.starknet_rpc_url.clone());
            latest_unconsumed_pending_action(&state, &starknet_user, contract, &client)
                .await?
                .ok_or_else(|| {
                    crate::error::AppError::BadRequest(
                        "Please click Auto Setup On-Chain first, then retry your command.".into(),
                    )
                })?
        };
        resolved_action_id = Some(resolved);
        onchain_action_user = Some(starknet_user);
    }
    enforce_ai_rate_limit(&state, &auth_subject, level, needs_onchain_action).await?;

    let ai_response = match tokio::time::timeout(
        std::time::Duration::from_millis(AI_EXECUTE_TIMEOUT_MS),
        service.execute_command(&auth_subject, &command, level),
    )
    .await
    {
        Ok(Ok(response)) => response,
        Ok(Err(err)) => return Err(err),
        Err(_) => {
            tracing::warn!(
                "AI execute timed out after {}ms for user={} level={}",
                AI_EXECUTE_TIMEOUT_MS,
                auth_subject,
                level
            );
            AIResponse {
                message: "AI service is taking too long right now. Please retry in a few seconds."
                    .to_string(),
                actions: vec![],
                data: None,
            }
        }
    };
    if needs_onchain_action && should_consume_onchain_action(&command) {
        if let Some(action_id) = resolved_action_id {
            if let Some(action_user) = onchain_action_user.as_deref() {
                let consumed_tx = consume_onchain_action_via_backend(&state, action_id).await?;
                tracing::info!(
                    "AI action consumed on-chain: user={} action_id={} tx={:#x}",
                    auth_subject,
                    action_id,
                    consumed_tx
                );
                mark_ai_action_consumed(&state, action_user, action_id).await;
            }
        }
    }
    let confidence = confidence_score(has_llm_provider_configured(&config));

    let response = AICommandResponse {
        response: ai_response.message,
        actions: ai_response.actions,
        confidence,
        level,
        data: ai_response.data,
    };

    Ok(Json(ApiResponse::success(response)))
}

// Internal helper that supports `action_type_for_level` operations.
fn action_type_for_level(level: u8) -> Option<u64> {
    match level {
        2 => Some(0), // Swap
        3 => Some(5), // MultiStep
        _ => None,
    }
}

// Internal helper that parses or transforms values for `encode_bytes_as_felt`.
fn encode_bytes_as_felt(chunk: &[u8]) -> Result<CryptoFelt> {
    if chunk.is_empty() {
        return Ok(CryptoFelt::from(0_u8));
    }
    let hex = hex::encode(chunk);
    CryptoFelt::from_hex(&format!("0x{hex}"))
        .map_err(|e| crate::error::AppError::BadRequest(format!("Invalid byte chunk: {}", e)))
}

// Internal helper that supports `serialize_byte_array` operations.
fn serialize_byte_array(value: &str) -> Result<Vec<CryptoFelt>> {
    let bytes = value.as_bytes();
    let mut data = Vec::new();
    let full_words = bytes.len() / 31;
    let pending_len = bytes.len() % 31;

    data.push(CryptoFelt::from(full_words as u64));

    for idx in 0..full_words {
        let start = idx * 31;
        let end = start + 31;
        data.push(encode_bytes_as_felt(&bytes[start..end])?);
    }

    if pending_len > 0 {
        let start = full_words * 31;
        data.push(encode_bytes_as_felt(&bytes[start..])?);
    } else {
        data.push(CryptoFelt::from(0_u8));
    }

    data.push(CryptoFelt::from(pending_len as u64));
    Ok(data)
}

// Internal helper that parses or transforms values for `parse_crypto_felt`.
fn parse_crypto_felt(value: &str) -> Result<CryptoFelt> {
    let trimmed = value.trim();
    let normalized = if trimmed.starts_with("0x") {
        trimmed.to_string()
    } else {
        format!("0x{trimmed}")
    };
    CryptoFelt::from_hex(&normalized)
        .map_err(|e| crate::error::AppError::BadRequest(format!("Invalid felt value: {}", e)))
}

// Internal helper that supports `compute_action_hash` operations.
fn compute_action_hash(
    user_address: &str,
    action_type: u64,
    params: &str,
    timestamp: u64,
) -> Result<CryptoFelt> {
    let user = parse_crypto_felt(user_address)?;
    let mut data = vec![user, CryptoFelt::from(action_type)];
    data.extend(serialize_byte_array(params)?);
    data.push(CryptoFelt::from(timestamp));
    Ok(poseidon_hash_many(&data))
}

// Internal helper that builds inputs for `build_set_valid_hash_call`.
fn build_set_valid_hash_call(
    verifier_address: &str,
    user_address: &str,
    message_hash: &CryptoFelt,
) -> Result<Call> {
    let to = parse_felt(verifier_address)?;
    let selector = get_selector_from_name("set_valid_hash")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    let signer = parse_felt(user_address)?;
    let hash = parse_felt(&message_hash.to_string())?;

    Ok(Call {
        to,
        selector,
        calldata: vec![signer, hash, CoreFelt::from(1_u8)],
    })
}

// Internal helper that runs side-effecting logic for `wait_for_prepare_hashes_confirmation`.
async fn wait_for_prepare_hashes_confirmation(state: &AppState, tx_hash: CoreFelt) -> Result<()> {
    let reader = OnchainReader::from_config(&state.config)?;
    let mut last_error = String::new();

    for attempt in 0..AI_PREPARE_READY_POLL_ATTEMPTS {
        match reader.get_transaction_receipt(&tx_hash).await {
            Ok(receipt) => {
                if let ExecutionResult::Reverted { reason } = receipt.receipt.execution_result() {
                    return Err(AppError::BadRequest(format!(
                        "AI setup pre-signature transaction reverted: {}",
                        reason
                    )));
                }
                if matches!(
                    receipt.receipt.finality_status(),
                    TransactionFinalityStatus::PreConfirmed
                ) {
                    last_error = "transaction still pre-confirmed".to_string();
                    if attempt + 1 < AI_PREPARE_READY_POLL_ATTEMPTS {
                        sleep(Duration::from_millis(AI_PREPARE_READY_POLL_DELAY_MS)).await;
                        continue;
                    }
                    break;
                }
                return Ok(());
            }
            Err(err) => {
                last_error = err.to_string();
                if attempt + 1 < AI_PREPARE_READY_POLL_ATTEMPTS {
                    sleep(Duration::from_millis(AI_PREPARE_READY_POLL_DELAY_MS)).await;
                    continue;
                }
            }
        }
    }

    Err(AppError::BadRequest(format!(
        "AI setup signature window is not confirmed on-chain yet: {}",
        last_error
    )))
}

/// POST /api/v1/ai/prepare-action
pub async fn prepare_action_signature(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<PrepareAIActionRequest>,
) -> Result<Json<ApiResponse<PrepareAIActionResponse>>> {
    let auth_subject = require_user(&headers, &state).await?;
    let user_address = require_starknet_user(&headers, &state).await?;
    let unlocked_level = state.db.get_user_ai_level(&auth_subject).await?;
    if req.level > unlocked_level {
        return Err(crate::error::AppError::BadRequest(format!(
            "Your AI level is {}. Upgrade first to prepare Level {} action.",
            unlocked_level, req.level
        )));
    }
    let action_type = action_type_for_level(req.level).ok_or_else(|| {
        crate::error::AppError::BadRequest(
            "Only AI level 2/3 can prepare on-chain signature.".to_string(),
        )
    })?;

    let params = req
        .context
        .clone()
        .unwrap_or_else(|| format!("tier:{}", req.level));
    if params.trim().is_empty() {
        return Err(crate::error::AppError::BadRequest(
            "Context cannot be empty".to_string(),
        ));
    }

    let verifier_address = state
        .config
        .ai_signature_verifier_address
        .as_deref()
        .unwrap_or("")
        .trim();
    if verifier_address.is_empty() || verifier_address.starts_with("0x0000") {
        return Err(crate::error::AppError::BadRequest(
            "AI signature verifier not configured".to_string(),
        ));
    }

    let onchain = OnchainInvoker::from_config(&state.config)?.ok_or_else(|| {
        crate::error::AppError::BadRequest("Backend on-chain signer is not configured".to_string())
    })?;
    let backend_signer = resolve_backend_account(&state.config).ok_or_else(|| {
        crate::error::AppError::BadRequest(
            "Backend signer address is not configured. Set BACKEND_ACCOUNT_ADDRESS.".to_string(),
        )
    })?;

    let window_seconds = req
        .window_seconds
        .unwrap_or(DEFAULT_SIGNATURE_WINDOW_SECONDS)
        .clamp(MIN_SIGNATURE_WINDOW_SECONDS, MAX_SIGNATURE_WINDOW_SECONDS);
    let now = chrono::Utc::now().timestamp().max(0) as u64;
    let from_timestamp = now.saturating_sub(SIGNATURE_PAST_SKEW_SECONDS);
    let to_timestamp = from_timestamp.saturating_add(window_seconds);

    let mut calls = Vec::new();
    for ts in from_timestamp..=to_timestamp {
        let hash = compute_action_hash(&user_address, action_type, &params, ts)?;
        calls.push(build_set_valid_hash_call(
            verifier_address,
            backend_signer,
            &hash,
        )?);
    }

    let tx_hash = onchain.invoke_many(calls).await?;
    wait_for_prepare_hashes_confirmation(&state, tx_hash).await?;
    let response = PrepareAIActionResponse {
        tx_hash: format!("{:#x}", tx_hash),
        action_type,
        params,
        hashes_prepared: window_seconds + 1,
        from_timestamp,
        to_timestamp,
    };

    Ok(Json(ApiResponse::success(response)))
}

/// GET /api/v1/ai/pending?offset=0&limit=10
pub async fn get_pending_actions(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PendingActionsQuery>,
) -> Result<Json<ApiResponse<PendingActionsResponse>>> {
    let user_address = require_starknet_user(&headers, &state).await?;
    let contract = state.config.ai_executor_address.trim();
    if contract.is_empty() || contract.starts_with("0x0000") {
        return Err(crate::error::AppError::BadRequest(
            "AI executor not configured".into(),
        ));
    }

    let mut offset = query.offset.unwrap_or(0);
    let limit = query.limit.unwrap_or(10).min(50);
    if offset == 0 {
        if let Some(action_count) = fetch_ai_executor_action_count(&state, contract).await {
            // `get_pending_actions_page` scans only `max_pending_scan` entries from `start_offset`.
            // To keep newest setup actions discoverable, default to the latest page window.
            // This guarantees the newest action IDs are inside the scanned range.
            offset = action_count.saturating_sub(limit.max(1));
        }
    }
    let client = StarknetClient::new(state.config.starknet_rpc_url.clone());
    let result = client
        .call_contract(
            contract,
            "get_pending_actions_page",
            vec![
                user_address.to_string(),
                offset.to_string(),
                limit.to_string(),
            ],
        )
        .await?;

    let mut pending = vec![];
    if let Some(len_hex) = result.get(0) {
        let len = parse_felt_u64(len_hex).unwrap_or(0);
        for i in 0..len as usize {
            if let Some(val) = result.get(i + 1) {
                if let Some(parsed) = parse_felt_u64(val) {
                    pending.push(parsed);
                }
            }
        }
    }
    if !pending.is_empty() {
        let mut filtered = Vec::with_capacity(pending.len());
        for id in pending {
            if !is_ai_action_consumed(&state, &user_address, id).await {
                filtered.push(id);
            }
        }
        pending = filtered;
    }
    Ok(Json(ApiResponse::success(PendingActionsResponse {
        pending,
    })))
}

/// GET /api/v1/ai/config
pub async fn get_runtime_config(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<AIRuntimeConfigResponse>>> {
    let contract = state.config.ai_executor_address.trim();
    let configured = !contract.is_empty() && !contract.starts_with("0x0000");
    let response = AIRuntimeConfigResponse {
        executor_configured: configured,
        executor_address: configured.then(|| contract.to_string()),
    };
    Ok(Json(ApiResponse::success(response)))
}

// Internal helper that supports `resolve_ai_executor_and_carel_addresses` operations.
fn resolve_ai_executor_and_carel_addresses(
    config: &crate::config::Config,
) -> Result<(String, String)> {
    let executor = config.ai_executor_address.trim();
    if executor.is_empty() || executor.starts_with("0x0000") {
        return Err(AppError::BadRequest(
            "AI_EXECUTOR_ADDRESS is not configured".to_string(),
        ));
    }
    let carel = config.carel_token_address.trim();
    if carel.is_empty() || carel.starts_with("0x0000") {
        return Err(AppError::BadRequest(
            "CAREL_TOKEN_ADDRESS is not configured".to_string(),
        ));
    }
    Ok((executor.to_string(), carel.to_string()))
}

// Internal helper that checks conditions for `is_entrypoint_not_found_error`.
fn is_entrypoint_not_found_error(err: &AppError) -> bool {
    let msg = err.to_string().to_ascii_lowercase();
    msg.contains("entrypointnotfound")
        || msg.contains("entrypoint not found")
        || msg.contains("entrypoint_not_found")
}

// Internal helper that parses or transforms values for `desired_ai_executor_rate_limit`.
fn desired_ai_executor_rate_limit() -> u128 {
    std::env::var("AI_EXECUTOR_TARGET_RATE_LIMIT")
        .ok()
        .or_else(|| std::env::var("AI_EXECUTOR_RATE_LIMIT").ok())
        .and_then(|raw| raw.trim().parse::<u128>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_AI_EXECUTOR_TARGET_RATE_LIMIT)
}

// Internal helper that fetches data for `read_ai_executor_rate_limit`.
async fn read_ai_executor_rate_limit(state: &AppState, executor_address: &str) -> Result<u128> {
    let reader = OnchainReader::from_config(&state.config)?;
    let contract_address = parse_felt(executor_address)?;
    let selector = get_selector_from_name("rate_limit")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let result = reader
        .call(FunctionCall {
            contract_address,
            entry_point_selector: selector,
            calldata: vec![],
        })
        .await?;
    let Some(raw) = result.first() else {
        return Err(AppError::BlockchainRPC(
            "rate_limit returned empty payload".to_string(),
        ));
    };
    felt_to_u128(raw)
        .map_err(|_| AppError::BlockchainRPC("rate_limit response is not a valid u128".to_string()))
}

// Internal helper that runs side-effecting logic for `backend_set_ai_executor_rate_limit`.
async fn backend_set_ai_executor_rate_limit(
    state: &AppState,
    executor_address: &str,
    limit: u128,
) -> Result<CoreFelt> {
    let onchain = OnchainInvoker::from_config(&state.config)?.ok_or_else(|| {
        AppError::BadRequest(
            "Backend on-chain signer is not configured. Set BACKEND_ACCOUNT_ADDRESS and BACKEND_PRIVATE_KEY."
                .to_string(),
        )
    })?;
    let to = parse_felt(executor_address)?;
    let selector = get_selector_from_name("set_rate_limit")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    onchain
        .invoke(Call {
            to,
            selector,
            calldata: vec![CoreFelt::from(limit), CoreFelt::from(0_u8)],
        })
        .await
        .map_err(|err| {
            let lower = err.to_string().to_ascii_lowercase();
            if lower.contains("unauthorized admin") || lower.contains("missing role") {
                AppError::BadRequest(
                    "Backend signer is not AI executor admin. Cannot auto-adjust AI executor rate limit."
                        .to_string(),
                )
            } else {
                err
            }
        })
}

// Internal helper that runs side-effecting logic for `ensure_ai_executor_rate_limit`.
async fn ensure_ai_executor_rate_limit(
    state: &AppState,
    executor_address: &str,
) -> RateLimitEnsureResult {
    let target_limit = desired_ai_executor_rate_limit();
    let apply_target_limit = async || match backend_set_ai_executor_rate_limit(
        state,
        executor_address,
        target_limit,
    )
    .await
    {
        Ok(tx_hash) => RateLimitEnsureResult {
            ready: true,
            message: format!(
                "AI executor rate limit raised to {}. Tx: {:#x}",
                target_limit, tx_hash
            ),
        },
        Err(err) if is_entrypoint_not_found_error(&err) => {
            tracing::warn!(
                    "AI executor rate-limit auto-tune skipped: set_rate_limit entrypoint not found (executor={})",
                    executor_address
                );
            RateLimitEnsureResult {
                ready: false,
                message: "AI executor class mismatch: set_rate_limit entrypoint not found."
                    .to_string(),
            }
        }
        Err(err) => {
            tracing::warn!(
                    "AI executor rate-limit auto-tune skipped: failed setting target limit (executor={} err={})",
                    executor_address,
                    err
                );
            let reason = err.to_string().to_ascii_lowercase();
            let message =
                if reason.contains("unauthorized admin") || reason.contains("missing role") {
                    "Backend signer is not AI executor admin, cannot raise on-chain rate limit."
                        .to_string()
                } else {
                    format!("Failed to raise AI executor rate limit: {}", err)
                };
            RateLimitEnsureResult {
                ready: false,
                message,
            }
        }
    };

    let current_limit = match read_ai_executor_rate_limit(state, executor_address).await {
        Ok(value) => value,
        Err(err) if is_entrypoint_not_found_error(&err) => {
            tracing::warn!(
                "AI executor rate-limit getter not found (executor={}), falling back to set_rate_limit without readback",
                executor_address
            );
            let mut result = apply_target_limit().await;
            if result.ready {
                result.message = format!(
                    "AI executor rate_limit getter is unavailable; applied target {} via set_rate_limit.",
                    target_limit
                );
            }
            return result;
        }
        Err(err) => {
            tracing::warn!(
                "AI executor rate-limit auto-tune skipped: failed reading current limit (executor={} err={})",
                executor_address,
                err
            );
            return RateLimitEnsureResult {
                ready: false,
                message:
                    "Cannot read AI executor on-chain rate limit. Check RPC endpoint and executor address."
                        .to_string(),
            };
        }
    };
    if current_limit >= target_limit {
        return RateLimitEnsureResult {
            ready: true,
            message: format!(
                "AI executor rate limit is {} (target {}).",
                current_limit, target_limit
            ),
        };
    }
    match backend_set_ai_executor_rate_limit(state, executor_address, target_limit).await {
        Ok(tx_hash) => RateLimitEnsureResult {
            ready: true,
            message: format!(
                "AI executor rate limit raised to {}. Tx: {:#x}",
                target_limit, tx_hash
            ),
        },
        Err(err) if is_entrypoint_not_found_error(&err) => {
            tracing::warn!(
                "AI executor rate-limit auto-tune skipped: set_rate_limit entrypoint not found (executor={})",
                executor_address
            );
            RateLimitEnsureResult {
                ready: false,
                message: "AI executor class mismatch: set_rate_limit entrypoint not found."
                    .to_string(),
            }
        }
        Err(err) => {
            tracing::warn!(
                "AI executor rate-limit auto-tune skipped: failed setting target limit (executor={} err={})",
                executor_address,
                err
            );
            let reason = err.to_string().to_ascii_lowercase();
            let message =
                if reason.contains("unauthorized admin") || reason.contains("missing role") {
                    "Backend signer is not AI executor admin, cannot raise on-chain rate limit."
                        .to_string()
                } else {
                    format!("Failed to raise AI executor rate limit: {}", err)
                };
            RateLimitEnsureResult {
                ready: false,
                message,
            }
        }
    }
}

// Internal helper that supports `has_executor_burner_role` operations.
async fn has_executor_burner_role(
    state: &AppState,
    carel_token_address: &str,
    executor_address: &str,
) -> Result<bool> {
    let reader = OnchainReader::from_config(&state.config)?;
    let contract_address = parse_felt(carel_token_address)?;
    let role = get_selector_from_name("BURNER_ROLE")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let selector = get_selector_from_name("has_role")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let account = parse_felt(executor_address)?;
    let result = reader
        .call(FunctionCall {
            contract_address,
            entry_point_selector: selector,
            calldata: vec![role, account],
        })
        .await?;
    let Some(raw) = result.first() else {
        return Err(AppError::BlockchainRPC(
            "has_role returned empty payload".to_string(),
        ));
    };
    Ok(felt_to_u128(raw).unwrap_or(0) != 0)
}

// Internal helper that supports `backend_set_executor_burner_role` operations.
async fn backend_set_executor_burner_role(
    state: &AppState,
    carel_token_address: &str,
    executor_address: &str,
) -> Result<CoreFelt> {
    let onchain = OnchainInvoker::from_config(&state.config)?.ok_or_else(|| {
        AppError::BadRequest(
            "Backend on-chain signer is not configured. Set BACKEND_ACCOUNT_ADDRESS and BACKEND_PRIVATE_KEY."
                .to_string(),
        )
    })?;
    let to = parse_felt(carel_token_address)?;
    let selector = get_selector_from_name("set_burner")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let executor = parse_felt(executor_address)?;
    onchain
        .invoke(Call {
            to,
            selector,
            calldata: vec![executor],
        })
        .await
        .map_err(|err| {
            let lower = err.to_string().to_ascii_lowercase();
            if lower.contains("missing role")
                || lower.contains("unauthorized")
                || lower.contains("default_admin_role")
            {
                AppError::BadRequest(
                    "Backend signer is not CAREL token admin. Grant DEFAULT_ADMIN_ROLE to backend account or run token.set_burner(AI_EXECUTOR_ADDRESS) manually once."
                        .to_string(),
                )
            } else {
                err
            }
        })
}

/// POST /api/v1/ai/ensure-executor
pub async fn ensure_executor_ready(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<AIExecutorReadyResponse>>> {
    let _ = require_user(&headers, &state).await?;
    let (executor_address, carel_token_address) =
        resolve_ai_executor_and_carel_addresses(&state.config)?;
    let mut status_notes: Vec<String> = Vec::new();

    let burner_role_granted =
        has_executor_burner_role(&state, &carel_token_address, &executor_address).await?;
    if burner_role_granted {
        let rate_limit_check = ensure_ai_executor_rate_limit(&state, &executor_address).await;
        status_notes.push(rate_limit_check.message.clone());
        if !rate_limit_check.ready {
            return Ok(Json(ApiResponse::success(AIExecutorReadyResponse {
                ready: false,
                burner_role_granted: true,
                updated_onchain: false,
                tx_hash: None,
                message: format!("AI executor preflight blocked. {}", status_notes.join(" ")),
            })));
        }
        let message = if status_notes.is_empty() {
            "AI executor is ready.".to_string()
        } else {
            format!("AI executor is ready. {}", status_notes.join(" "))
        };
        return Ok(Json(ApiResponse::success(AIExecutorReadyResponse {
            ready: true,
            burner_role_granted: true,
            updated_onchain: false,
            tx_hash: None,
            message,
        })));
    }

    let tx_hash =
        backend_set_executor_burner_role(&state, &carel_token_address, &executor_address).await?;
    let tx_hash_hex = format!("{:#x}", tx_hash);

    for _ in 0..AI_EXECUTOR_READY_POLL_ATTEMPTS {
        sleep(Duration::from_millis(AI_EXECUTOR_READY_POLL_DELAY_MS)).await;
        if has_executor_burner_role(&state, &carel_token_address, &executor_address)
            .await
            .unwrap_or(false)
        {
            let rate_limit_check = ensure_ai_executor_rate_limit(&state, &executor_address).await;
            status_notes.push(rate_limit_check.message.clone());
            if !rate_limit_check.ready {
                return Ok(Json(ApiResponse::success(AIExecutorReadyResponse {
                    ready: false,
                    burner_role_granted: true,
                    updated_onchain: true,
                    tx_hash: Some(tx_hash_hex.clone()),
                    message: format!("AI executor preflight blocked. {}", status_notes.join(" ")),
                })));
            }
            let message = if status_notes.is_empty() {
                "AI executor burner role granted.".to_string()
            } else {
                format!(
                    "AI executor burner role granted. {}",
                    status_notes.join(" ")
                )
            };
            return Ok(Json(ApiResponse::success(AIExecutorReadyResponse {
                ready: true,
                burner_role_granted: true,
                updated_onchain: true,
                tx_hash: Some(tx_hash_hex),
                message,
            })));
        }
    }

    Ok(Json(ApiResponse::success(AIExecutorReadyResponse {
        ready: false,
        burner_role_granted: false,
        updated_onchain: true,
        tx_hash: Some(tx_hash_hex),
        message:
            "Burner role transaction submitted. Wait until confirmed, then retry Auto Setup On-Chain."
                .to_string(),
    })))
}

// Internal helper that supports `configured_ai_upgrade_payment_address` operations.
fn configured_ai_upgrade_payment_address(config: &crate::config::Config) -> Option<String> {
    config
        .dev_wallet_address
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.starts_with("0x0000"))
        .map(str::to_string)
        .or_else(|| {
            config
                .ai_level_burn_address
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty() && !value.starts_with("0x0000"))
                .map(str::to_string)
        })
}

/// GET /api/v1/ai/level
pub async fn get_ai_level(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<AILevelResponse>>> {
    let user_address = require_user(&headers, &state).await?;
    let current_level = state.db.get_user_ai_level(&user_address).await?;
    let next_level = if current_level < 3 {
        Some(current_level + 1)
    } else {
        None
    };
    let next_upgrade_cost_carel = next_level
        .and_then(|target| incremental_upgrade_cost_wei(current_level, target))
        .map(wei_to_carel_string);
    let payment_address = configured_ai_upgrade_payment_address(&state.config);

    Ok(Json(ApiResponse::success(AILevelResponse {
        current_level,
        max_level: 3,
        next_level,
        next_upgrade_cost_carel,
        payment_address_configured: payment_address.is_some(),
        payment_address: payment_address.clone(),
        burn_address_configured: payment_address.is_some(),
        burn_address: payment_address,
    })))
}

/// POST /api/v1/ai/upgrade
pub async fn upgrade_ai_level(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AIUpgradeLevelRequest>,
) -> Result<Json<ApiResponse<AIUpgradeLevelResponse>>> {
    let auth_subject = require_user(&headers, &state).await?;
    let previous_level = state.db.get_user_ai_level(&auth_subject).await?;
    if !(2..=3).contains(&req.target_level) {
        return Err(AppError::BadRequest(
            "target_level must be 2 or 3".to_string(),
        ));
    }
    if req.target_level <= previous_level {
        return Err(AppError::BadRequest(format!(
            "AI Level {} is already active for this account.",
            previous_level
        )));
    }

    let required_wei = incremental_upgrade_cost_wei(previous_level, req.target_level)
        .ok_or_else(|| AppError::BadRequest("Invalid AI level upgrade path".to_string()))?;
    if required_wei == 0 {
        return Err(AppError::BadRequest(
            "No payment required for this upgrade path".to_string(),
        ));
    }

    let tx_hash = normalize_onchain_tx_hash(&req.onchain_tx_hash)?;
    if state.db.get_transaction(&tx_hash).await?.is_some() {
        return Err(AppError::BadRequest(
            "onchain_tx_hash has already been used".to_string(),
        ));
    }
    let block_number =
        verify_ai_upgrade_payment_tx_hash(&state, &auth_subject, &tx_hash, required_wei).await?;
    let payment_carel = wei_to_carel_decimal(required_wei);

    state
        .db
        .save_transaction(&Transaction {
            tx_hash: tx_hash.clone(),
            block_number,
            user_address: auth_subject.clone(),
            tx_type: "ai_level_upgrade".to_string(),
            token_in: Some("CAREL".to_string()),
            token_out: None,
            amount_in: Some(payment_carel),
            amount_out: None,
            usd_value: None,
            fee_paid: Some(payment_carel),
            points_earned: Some(Decimal::ZERO),
            timestamp: Utc::now(),
            processed: true,
        })
        .await?;

    if let Err(err) = state
        .db
        .record_ai_level_upgrade(
            &auth_subject,
            previous_level,
            req.target_level,
            payment_carel,
            &tx_hash,
            block_number,
        )
        .await
    {
        if is_unique_violation(&err) {
            return Err(AppError::BadRequest(
                "onchain_tx_hash has already been used for AI upgrade".to_string(),
            ));
        }
        return Err(err);
    }

    let current_level = state
        .db
        .upsert_user_ai_level(&auth_subject, req.target_level)
        .await?;
    Ok(Json(ApiResponse::success(AIUpgradeLevelResponse {
        previous_level,
        current_level,
        target_level: req.target_level,
        burned_carel: payment_carel.normalize().to_string(),
        onchain_tx_hash: tx_hash,
        block_number,
    })))
}

// Internal helper that checks conditions for `is_unique_violation`.
fn is_unique_violation(err: &AppError) -> bool {
    match err {
        AppError::Database(sqlx::Error::Database(db_err)) => {
            db_err.code().as_deref() == Some("23505")
        }
        _ => false,
    }
}

// Internal helper that supports `felt_to_usize` operations.
fn felt_to_usize(value: &CoreFelt, field_name: &str) -> Result<usize> {
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

// Internal helper that parses or transforms values for `parse_execute_calls_offset`.
fn parse_execute_calls_offset(calldata: &[CoreFelt]) -> Result<Vec<ParsedExecuteCall>> {
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

// Internal helper that parses or transforms values for `parse_execute_calls_inline`.
fn parse_execute_calls_inline(calldata: &[CoreFelt]) -> Result<Vec<ParsedExecuteCall>> {
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

// Internal helper that parses or transforms values for `parse_execute_calls`.
fn parse_execute_calls(calldata: &[CoreFelt]) -> Result<Vec<ParsedExecuteCall>> {
    if let Ok(calls) = parse_execute_calls_offset(calldata) {
        return Ok(calls);
    }
    parse_execute_calls_inline(calldata)
}

// Internal helper that fetches data for `resolve_allowed_starknet_senders_async`.
async fn resolve_allowed_starknet_senders_async(
    state: &AppState,
    auth_subject: &str,
) -> Result<Vec<CoreFelt>> {
    let mut out: Vec<CoreFelt> = Vec::new();
    if let Ok(subject_felt) = parse_felt(auth_subject) {
        out.push(subject_felt);
    }

    if let Ok(linked_wallets) = state.db.list_wallet_addresses(auth_subject).await {
        for wallet in linked_wallets {
            if !wallet.chain.eq_ignore_ascii_case("starknet") {
                continue;
            }
            if let Ok(felt) = parse_felt(wallet.wallet_address.trim()) {
                if !out.iter().any(|existing| *existing == felt) {
                    out.push(felt);
                }
            }
        }
    }

    if out.is_empty() {
        return Err(AppError::BadRequest(
            "No Starknet sender resolved for AI upgrade verification".to_string(),
        ));
    }
    Ok(out)
}

// Internal helper that supports `verify_ai_upgrade_fee_invoke_payload` operations.
fn verify_ai_upgrade_fee_invoke_payload(
    tx: &StarknetTransaction,
    allowed_senders: &[CoreFelt],
    carel_token: CoreFelt,
    payment_address: CoreFelt,
    min_amount_wei: u128,
) -> Result<()> {
    let invoke = match tx {
        StarknetTransaction::Invoke(invoke) => invoke,
        _ => {
            return Err(AppError::BadRequest(
                "onchain_tx_hash must be an INVOKE transaction".to_string(),
            ))
        }
    };

    let transfer_selector = get_selector_from_name("transfer")
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

    if !allowed_senders.iter().any(|candidate| *candidate == sender) {
        return Err(AppError::BadRequest(
            "onchain_tx_hash sender does not match authenticated Starknet user".to_string(),
        ));
    }

    let calls = parse_execute_calls(calldata)?;
    for call in calls {
        if call.to != carel_token || call.selector != transfer_selector {
            continue;
        }
        if call.calldata.len() < 3 {
            continue;
        }
        let recipient = call.calldata[0];
        if recipient != payment_address {
            continue;
        }
        let low = felt_to_u128(&call.calldata[1]).unwrap_or(0);
        let high = felt_to_u128(&call.calldata[2]).unwrap_or(0);
        if high != 0 {
            continue;
        }
        if low >= min_amount_wei {
            return Ok(());
        }
    }

    Err(AppError::BadRequest(format!(
        "onchain_tx_hash must include CAREL transfer >= {} to configured DEV wallet",
        wei_to_carel_string(min_amount_wei)
    )))
}

// Internal helper that supports `verify_ai_upgrade_payment_tx_hash` operations.
async fn verify_ai_upgrade_payment_tx_hash(
    state: &AppState,
    auth_subject: &str,
    tx_hash: &str,
    min_amount_wei: u128,
) -> Result<i64> {
    let payment_address =
        configured_ai_upgrade_payment_address(&state.config).ok_or_else(|| {
            AppError::BadRequest(
                "DEV_WALLET_ADDRESS is not configured. Cannot verify AI upgrade payment."
                    .to_string(),
            )
        })?;
    let carel_token = state.config.carel_token_address.trim();
    if carel_token.is_empty() || carel_token.starts_with("0x0000") {
        return Err(AppError::BadRequest(
            "CAREL_TOKEN_ADDRESS is not configured".to_string(),
        ));
    }

    let allowed_senders = resolve_allowed_starknet_senders_async(state, auth_subject).await?;
    let reader = OnchainReader::from_config(&state.config)?;
    let tx_hash_felt = parse_felt(tx_hash)?;
    let carel_token_felt = parse_felt(carel_token)?;
    let payment_felt = parse_felt(&payment_address)?;
    let mut last_error = String::new();

    for attempt in 0..5 {
        let tx = match reader.get_transaction(&tx_hash_felt).await {
            Ok(value) => value,
            Err(err) => {
                last_error = err.to_string();
                if attempt < 4 {
                    sleep(Duration::from_millis(900)).await;
                    continue;
                }
                break;
            }
        };

        verify_ai_upgrade_fee_invoke_payload(
            &tx,
            &allowed_senders,
            carel_token_felt,
            payment_felt,
            min_amount_wei,
        )?;

        match reader.get_transaction_receipt(&tx_hash_felt).await {
            Ok(receipt) => {
                if let ExecutionResult::Reverted { reason } = receipt.receipt.execution_result() {
                    return Err(AppError::BadRequest(format!(
                        "onchain_tx_hash reverted: {}",
                        reason
                    )));
                }
                if matches!(
                    receipt.receipt.finality_status(),
                    TransactionFinalityStatus::PreConfirmed
                ) {
                    last_error = "transaction still pre-confirmed".to_string();
                    if attempt < 4 {
                        sleep(Duration::from_millis(900)).await;
                        continue;
                    }
                    break;
                }
                return Ok(receipt.block.block_number() as i64);
            }
            Err(err) => {
                last_error = err.to_string();
                if attempt < 4 {
                    sleep(Duration::from_millis(900)).await;
                    continue;
                }
            }
        }
    }

    Err(AppError::BadRequest(format!(
        "onchain_tx_hash not confirmed on Starknet RPC: {}",
        last_error
    )))
}

// Internal helper that runs side-effecting logic for `ensure_onchain_action`.
async fn fetch_pending_actions_page(
    client: &StarknetClient,
    contract: &str,
    user_address: &str,
    start_offset: u64,
    limit: u64,
) -> Result<Vec<u64>> {
    let result = client
        .call_contract(
            contract,
            "get_pending_actions_page",
            vec![
                user_address.to_string(),
                start_offset.to_string(),
                limit.to_string(),
            ],
        )
        .await?;

    let mut pending = vec![];
    if let Some(len_hex) = result.get(0) {
        let len = parse_felt_u64(len_hex).unwrap_or(0);
        for i in 0..len as usize {
            if let Some(val) = result.get(i + 1) {
                if let Some(parsed) = parse_felt_u64(val) {
                    pending.push(parsed);
                }
            }
        }
    }
    Ok(pending)
}

// Internal helper that fetches data for `latest_unconsumed_pending_action`.
async fn latest_unconsumed_pending_action(
    state: &AppState,
    user_address: &str,
    contract: &str,
    client: &StarknetClient,
) -> Result<Option<u64>> {
    if let Some(action_count) = fetch_ai_executor_action_count(state, contract).await {
        let probe_window: u64 = 32;
        let lower_bound = action_count.saturating_sub(probe_window.saturating_sub(1));
        let mut current = action_count;
        while current >= lower_bound && current > 0 {
            let pending = fetch_pending_actions_page(
                client,
                contract,
                user_address,
                current.saturating_sub(1),
                1,
            )
            .await?;
            if let Some(found) = pending.first().copied() {
                if !is_ai_action_consumed(state, user_address, found).await {
                    return Ok(Some(found));
                }
            }
            if current == 1 {
                break;
            }
            current -= 1;
        }
    }

    let limit: u64 = 50;
    let mut offset = 0_u64;
    if let Some(action_count) = fetch_ai_executor_action_count(state, contract).await {
        offset = action_count.saturating_sub(limit.max(1));
    }
    let pending = fetch_pending_actions_page(client, contract, user_address, offset, limit).await?;
    if pending.is_empty() {
        return Ok(None);
    }
    let mut latest: Option<u64> = None;
    for id in pending {
        if is_ai_action_consumed(state, user_address, id).await {
            continue;
        }
        latest = Some(latest.map_or(id, |current| current.max(id)));
    }
    Ok(latest)
}

async fn ensure_onchain_action(
    state: &AppState,
    user_address: &str,
    action_id: u64,
) -> Result<u64> {
    if action_id == 0 {
        return Err(crate::error::AppError::BadRequest(
            "Invalid on-chain AI action_id".into(),
        ));
    }

    let config = &state.config;
    let contract = config.ai_executor_address.trim();
    if contract.is_empty() || contract.starts_with("0x0000") {
        return Err(crate::error::AppError::BadRequest(
            "AI executor not configured".into(),
        ));
    }

    let client = StarknetClient::new(config.starknet_rpc_url.clone());

    let action_consumed = is_ai_action_consumed(state, user_address, action_id).await;
    if !action_consumed {
        let around = fetch_pending_actions_page(
            &client,
            contract,
            user_address,
            action_id.saturating_sub(1),
            1,
        )
        .await?;
        if around.contains(&action_id) {
            return Ok(action_id);
        }
    }

    if let Some(latest_pending) =
        latest_unconsumed_pending_action(state, user_address, contract, &client).await?
    {
        tracing::warn!(
            "AI execute: requested action_id={} is stale/consumed for user={}, falling back to latest pending action_id={}",
            action_id,
            user_address,
            latest_pending
        );
        return Ok(latest_pending);
    }

    Err(crate::error::AppError::BadRequest(
        "Please click Auto Setup On-Chain first, then retry your command.".into(),
    ))
}

// Internal helper that parses or transforms values for `parse_felt_u64`.
fn parse_felt_u64(value: &str) -> Option<u64> {
    if let Some(stripped) = value.strip_prefix("0x") {
        u64::from_str_radix(stripped, 16).ok()
    } else {
        value.parse::<u64>().ok()
    }
}

// Internal helper that fetches data for `fetch_ai_executor_action_count`.
async fn fetch_ai_executor_action_count(state: &AppState, contract: &str) -> Option<u64> {
    let client = StarknetClient::new(state.config.starknet_rpc_url.clone());
    let storage_key = get_storage_var_address("action_count", &[]).ok()?;
    let storage_key_hex = format!("{:#x}", storage_key);
    let raw_value = client
        .get_storage_at(contract, &storage_key_hex)
        .await
        .ok()?;
    parse_felt_u64(&raw_value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    // Internal helper that builds inputs for `build_command_without_context`.
    fn build_command_without_context() {
        // Memastikan command tidak berubah saat context kosong
        let command = build_command("ping", &None);
        assert_eq!(command, "ping");
    }

    #[test]
    // Internal helper that builds inputs for `build_command_with_context`.
    fn build_command_with_context() {
        // Memastikan context ditambahkan ke command
        let command = build_command("ping", &Some("beta".to_string()));
        assert_eq!(command, "ping | context: beta");
    }

    #[test]
    // Internal helper that supports `confidence_score_depends_on_api_key` operations.
    fn confidence_score_depends_on_api_key() {
        // Memastikan skor confidence mengikuti status API key
        assert!((confidence_score(true) - 0.9).abs() < f64::EPSILON);
        assert!((confidence_score(false) - 0.6).abs() < f64::EPSILON);
    }

    #[test]
    // Internal helper that supports `action_type_for_level_matches_expected` operations.
    fn action_type_for_level_matches_expected() {
        // Memastikan level AI dipetakan ke action_type executor
        assert_eq!(action_type_for_level(2), Some(0));
        assert_eq!(action_type_for_level(3), Some(5));
        assert_eq!(action_type_for_level(1), None);
    }

    #[test]
    // Internal helper that supports `incremental_upgrade_cost_wei_matches_expected` operations.
    fn incremental_upgrade_cost_wei_matches_expected() {
        assert_eq!(
            incremental_upgrade_cost_wei(1, 2),
            Some(AI_LEVEL_2_TOTAL_CAREL_WEI)
        );
        assert_eq!(
            incremental_upgrade_cost_wei(1, 3),
            Some(AI_LEVEL_3_TOTAL_CAREL_WEI)
        );
        assert_eq!(
            incremental_upgrade_cost_wei(2, 3),
            Some(AI_LEVEL_3_TOTAL_CAREL_WEI - AI_LEVEL_2_TOTAL_CAREL_WEI)
        );
    }

    #[test]
    // Internal helper that supports `normalize_onchain_tx_hash_validates_hex_format` operations.
    fn normalize_onchain_tx_hash_validates_hex_format() {
        assert!(normalize_onchain_tx_hash("0xabc123").is_ok());
        assert!(normalize_onchain_tx_hash("abc123").is_err());
        assert!(normalize_onchain_tx_hash("0xzzzz").is_err());
    }

    #[test]
    // Internal helper that supports `level_1_allows_generic_chat_prompt` operations.
    fn level_1_allows_generic_chat_prompt() {
        // Memastikan level 1 tetap bisa dipakai untuk chat umum/non-trading
        assert!(ensure_ai_level_scope(1, "hello, can we chat?").is_ok());
    }

    #[test]
    // Internal helper that supports `level_1_rejects_swap_execution_scope` operations.
    fn level_1_rejects_swap_execution_scope() {
        // Memastikan level 1 tetap memblokir intent eksekusi trading
        let err = ensure_ai_level_scope(1, "swap 1 STRK to CAREL").expect_err("must reject");
        assert!(err.to_string().to_ascii_lowercase().contains("level 2"));
    }

    #[test]
    // Internal helper that supports `level_2_allows_generic_chat_prompt` operations.
    fn level_2_allows_generic_chat_prompt() {
        // Memastikan level 2 tetap bisa dipakai ngobrol umum tanpa intent trading.
        assert!(ensure_ai_level_scope(2, "hello, can we chat about strategy?").is_ok());
    }

    #[test]
    // Internal helper that supports `level_3_allows_generic_chat_prompt` operations.
    fn level_3_allows_generic_chat_prompt() {
        // Memastikan level 3 tetap menerima prompt umum/non-intent.
        assert!(ensure_ai_level_scope(3, "what do you think about market mood today?").is_ok());
    }

    #[test]
    // Internal helper that supports `requires_onchain_action_only_for_execution_scopes` operations.
    fn requires_onchain_action_only_for_execution_scopes() {
        // Memastikan action_id hanya diwajibkan untuk scope eksekusi.
        assert!(!requires_onchain_action_id(1, "hello"));
        assert!(!requires_onchain_action_id(2, "check my balance"));
        assert!(!requires_onchain_action_id(3, "beginner tutorial"));
        assert!(requires_onchain_action_id(2, "swap 1 STRK to CAREL"));
        assert!(requires_onchain_action_id(
            2,
            "create limit order 10 STRK to USDC at 1.2"
        ));
        assert!(requires_onchain_action_id(2, "unstake 50 USDT"));
        assert!(requires_onchain_action_id(2, "claim rewards USDT"));
        assert!(requires_onchain_action_id(3, "set price alert for STRK"));
    }

    #[test]
    // Internal helper that supports `should_consume_onchain_action_for_execution_scopes` operations.
    fn should_consume_onchain_action_for_execution_scopes() {
        assert!(should_consume_onchain_action("swap 25 STRK to WBTC"));
        assert!(should_consume_onchain_action("bridge 0.1 ETH to BTC"));
        assert!(should_consume_onchain_action("tukar 10 usdt ke carel"));
        assert!(should_consume_onchain_action("stake 100 USDT"));
        assert!(should_consume_onchain_action("cancel order 10"));
        assert!(!should_consume_onchain_action("check my balance"));
    }

    #[test]
    // Internal helper that supports `serialize_byte_array_short_ascii_layout` operations.
    fn serialize_byte_array_short_ascii_layout() {
        // Memastikan ByteArray pendek terserialisasi sebagai [len_words, pending, pending_len]
        let encoded = serialize_byte_array("tier:2").expect("serialize");
        assert_eq!(encoded.len(), 3);
        assert_eq!(encoded[0], CryptoFelt::from(0_u8));
        assert_eq!(encoded[2], CryptoFelt::from(6_u8));
    }

    #[test]
    // Internal helper that supports `compute_action_hash_is_deterministic` operations.
    fn compute_action_hash_is_deterministic() {
        // Memastikan hash action konsisten untuk input identik
        let hash_a = compute_action_hash("0x123", 0, "tier:2", 10).expect("hash A");
        let hash_b = compute_action_hash("0x123", 0, "tier:2", 10).expect("hash B");
        assert_eq!(hash_a, hash_b);
    }
}
