use super::{require_starknet_user, require_user, AppState};
use crate::indexer::starknet_client::StarknetClient;
use crate::services::ipfs_service::IpfsLogService;
use crate::services::onchain::{felt_to_u128, parse_felt, OnchainReader};
use crate::services::relayer::RelayerService;
use crate::{
    error::{AppError, Result},
    models::ApiResponse,
    services::ai_service::{
        classify_command_scope, has_llm_provider_configured, AIGuardScope, AIResponse, AIService,
    },
};
use axum::extract::Query;
use axum::{extract::State, http::HeaderMap, Json};
use chrono::Utc;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use starknet_core::types::typed_data::TypedData;
use starknet_core::types::{Felt as CoreFelt, FunctionCall};
use starknet_core::utils::{get_selector_from_name, get_storage_var_address};
use starknet_crypto::{poseidon_hash_many, Felt as CryptoFelt};
use std::time::{SystemTime, UNIX_EPOCH};
const AI_EXECUTE_TIMEOUT_MS: u64 = 12_000;

#[derive(Debug, Deserialize)]
pub struct AICommandRequest {
    pub command: String,
    pub context: Option<String>,
    pub level: Option<u8>,
    pub action_id: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct AICommandResponse {
    pub action_type: u64,
    pub params: String,
    pub tier_required: String,
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
    pub signature_verification_enabled: Option<bool>,
    pub updated_onchain: bool,
    pub tx_hash: Option<String>,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct PrepareAIActionRequest {
    pub level: u8,
    pub context: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PrepareAIActionResponse {
    pub action_type: u64,
    pub params: String,
    pub nonce: u64,
    pub message_hash: String,
    pub typed_data: serde_json::Value,
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

// Internal helper that builds inputs for `build_command`.
fn build_command(command: &str, context: &Option<String>) -> String {
    match context {
        Some(ctx) => format!("{} | context: {}", command, ctx),
        None => command.to_string(),
    }
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

// Internal helper that supports `tier_required_for_command` operations.
fn tier_required_for_command(command: &str) -> u8 {
    if requires_privacy_relayer(command) {
        return 3;
    }
    match classify_command_scope(command) {
        AIGuardScope::ReadOnly => 1,
        AIGuardScope::SwapBridge => 2,
        AIGuardScope::PortfolioAlert => 3,
        AIGuardScope::Unknown => 1,
    }
}

// Internal helper that supports `format_tier_label` operations.
fn format_tier_label(level: u8) -> String {
    format!("L{}", level)
}

// Internal helper that runs side-effecting logic for `ensure_ai_level_scope`.
fn ensure_ai_level_scope(level: u8, command: &str) -> Result<()> {
    let scope = classify_command_scope(command);
    if level >= 3 && matches!(scope, AIGuardScope::SwapBridge) && is_bridge_command(command) {
        return Err(AppError::BadRequest(
            "Level 3 bridge is not available yet. Use Level 2 for bridge commands for now; private L3 bridge will be added later."
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
                    "You need Level 2 for swap/bridge/stake/claim/limit execution, or Level 3 for unstake/portfolio/alerts."
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
                    "You need Level 3 for unstake/portfolio/alert management commands.".to_string(),
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
                    "Level 3 supports read-only, private swap/stake/limit execution, portfolio, and alerts. Bridge stays on Level 2 for now."
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

// Internal helper that supports `is_bridge_command` operations.
fn is_bridge_command(command: &str) -> bool {
    let lower = command.to_ascii_lowercase();
    lower.contains("bridge") || lower.contains("jembatan")
}

// Internal helper that supports `requires_privacy_relayer` operations.
fn requires_privacy_relayer(command: &str) -> bool {
    let lower = command.to_ascii_lowercase();
    let privacy_intent = lower.contains("hide") || lower.contains("private");
    let executable_intent = lower.contains("swap")
        || lower.contains("stake")
        || lower.contains("limit")
        || lower.contains("order");
    privacy_intent && executable_intent
}

// Internal helper that supports `ensure_privacy_level_scope` operations.
fn ensure_privacy_level_scope(level: u8, command: &str) -> Result<()> {
    if level < 3 && requires_privacy_relayer(command) {
        return Err(AppError::BadRequest(
            "Hide/private execution is only available on AI Level 3.".to_string(),
        ));
    }
    Ok(())
}

// Internal helper that fetches data for `fetch_onchain_user_tier`.
async fn fetch_onchain_user_tier(state: &AppState, user_address: &str) -> Option<u8> {
    let contract = state.config.ai_executor_address.trim();
    if contract.is_empty() || contract.starts_with("0x0000") {
        return None;
    }
    let reader = OnchainReader::from_config(&state.config).ok()?;
    let selector = get_selector_from_name("get_user_tier").ok()?;
    let contract_address = parse_felt(contract).ok()?;
    let user = parse_felt(user_address).ok()?;
    let values = reader
        .call(FunctionCall {
            contract_address,
            entry_point_selector: selector,
            calldata: vec![user],
        })
        .await
        .ok()?;
    let raw = values.first()?;
    let tier = felt_to_u128(raw).ok()? as u8;
    if tier == 0 {
        Some(1)
    } else {
        Some(tier)
    }
}

// Internal helper that supports `resolve_effective_ai_level` operations.
async fn resolve_effective_ai_level(
    state: &AppState,
    user_address: &str,
    requested_level: Option<u8>,
    starknet_user: Option<&str>,
) -> Result<(u8, u8)> {
    let db_level = match state.db.get_user_ai_level(user_address).await {
        Ok(level) => level,
        Err(err) => {
            tracing::warn!(
                "Failed to read cached AI level for user {}: {}",
                user_address,
                err
            );
            1
        }
    };
    let onchain_level = if let Some(starknet_user) = starknet_user {
        fetch_onchain_user_tier(state, starknet_user).await
    } else {
        None
    };
    let unlocked_level = onchain_level.unwrap_or(db_level);
    if unlocked_level != db_level {
        let _ = state
            .db
            .upsert_user_ai_level(user_address, unlocked_level)
            .await;
    }
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

// Internal helper that supports `resolve_starknet_user_optional` operations.
async fn resolve_starknet_user_optional(headers: &HeaderMap, state: &AppState) -> Option<String> {
    require_starknet_user(headers, state).await.ok()
}

// Internal helper that supports `legacy_allowlist_verifier_mode_enabled` operations.
fn legacy_allowlist_verifier_mode_enabled() -> bool {
    std::env::var("AI_SIGNATURE_VERIFIER_MODE")
        .unwrap_or_else(|_| "account".to_string())
        .trim()
        .eq_ignore_ascii_case("allowlist")
}

// Internal helper that runs side-effecting logic for `ensure_executor_hash_window`.
async fn ensure_executor_hash_window(
    state: &AppState,
    user_address: &str,
    message_hash: CoreFelt,
    message_hash_hex: &str,
) -> Result<()> {
    if !legacy_allowlist_verifier_mode_enabled() {
        return Ok(());
    }
    let _ = message_hash;
    let _ = message_hash_hex;
    let verifier = state
        .config
        .ai_signature_verifier_address
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default();
    Err(AppError::BadRequest(format!(
        "AI_SIGNATURE_VERIFIER_MODE=allowlist requires manual on-chain allowlist. Call set_valid_hash on verifier {} for user {} and retry.",
        verifier,
        user_address
    )))
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
    let scope_command = req.command.as_str();
    let starknet_user = resolve_starknet_user_optional(&headers, &state).await;
    let (unlocked_level, level) =
        resolve_effective_ai_level(&state, &auth_subject, req.level, starknet_user.as_deref())
            .await?;
    let tier_required = tier_required_for_command(scope_command);
    tracing::info!(
        "AI execute: user={}, level={}, unlocked_level={}, action_id={:?}",
        auth_subject,
        level,
        unlocked_level,
        req.action_id
    );
    if level < tier_required {
        return Err(AppError::BadRequest(format!(
            "This command requires {} access. Upgrade first to continue.",
            format_tier_label(tier_required)
        )));
    }
    ensure_ai_level_scope(level, scope_command)?;
    ensure_privacy_level_scope(level, scope_command)?;
    if requires_privacy_relayer(scope_command) {
        let _ = RelayerService::from_config(&state.config)?;
    }
    let needs_onchain_action = tier_required >= 2;
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
    let action_type = action_type_for_ai_response(scope_command, &ai_response);
    let tier_label = format_tier_label(tier_required);
    let ai_message = ai_response.message.clone();
    let ai_actions = ai_response.actions.clone();
    let ai_data = ai_response.data.clone();

    let should_log_onchain = needs_onchain_action && !ai_response.actions.is_empty();
    let ipfs_cid = if should_log_onchain {
        let ipfs_service = IpfsLogService::from_config(&state.config)?;
        let ai_log = serde_json::json!({
            "message": ai_message.clone(),
            "actions": ai_actions.clone(),
            "data": ai_data.clone(),
            "level": level,
            "tier_required": tier_label.clone(),
            "action_type": action_type,
            "llm_available": has_llm_provider_configured(&config),
        });
        Some(
            ipfs_service
                .upload_ai_log_to_ipfs(&command, &ai_log)
                .await?,
        )
    } else {
        None
    };

    let params_payload = serde_json::json!({
        "ipfs_cid": ipfs_cid,
        "command": req.command,
        "context": req.context,
        "response": ai_message,
        "actions": ai_actions,
        "data": ai_data,
        "tier_required": tier_label.clone(),
        "action_type": action_type,
        "timestamp": Utc::now().timestamp_millis(),
    });
    let params = serde_json::to_string(&params_payload).map_err(|err| {
        AppError::Internal(format!("Failed to serialize AI params payload: {}", err))
    })?;

    Ok(Json(ApiResponse::success(AICommandResponse {
        action_type,
        params,
        tier_required: tier_label,
    })))
}

// Internal helper that supports `action_type_for_ai_response` operations.
fn action_type_for_ai_response(command: &str, response: &AIResponse) -> u64 {
    let lower = command.to_ascii_lowercase();
    let actions = &response.actions;

    if actions.iter().any(|action| action == "get_bridge_quote") || is_bridge_command(command) {
        return 1; // Bridge
    }
    if actions
        .iter()
        .any(|action| action == "prepare_limit_order" || action == "prepare_limit_order_cancel")
        || lower.contains("limit")
    {
        return 5; // MultiStep (limit order flow)
    }
    if actions.iter().any(|action| action == "prepare_stake_claim") || lower.contains("claim") {
        return 3; // ClaimReward
    }
    if actions
        .iter()
        .any(|action| action == "show_staking_pools" || action == "prepare_unstake")
        || lower.contains("stake")
    {
        return 2; // Stake
    }
    if actions.iter().any(|action| action == "get_swap_quote") || lower.contains("swap") {
        return 0; // Swap
    }
    if lower.contains("nft") || lower.contains("mint") {
        return 4; // MintNFT
    }
    6 // Basic / read-only
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

// Internal helper that supports `parse_crypto_chain_id` operations.
fn parse_crypto_chain_id(chain_id: &str) -> Result<CryptoFelt> {
    let trimmed = chain_id.trim();
    if trimmed.starts_with("0x") {
        return parse_crypto_felt(trimmed);
    }
    let hex = hex::encode(trimmed.as_bytes());
    CryptoFelt::from_hex(&format!("0x{hex}"))
        .map_err(|e| crate::error::AppError::BadRequest(format!("Invalid chain_id: {}", e)))
}

// Internal helper that supports `compute_action_hash` operations.
fn compute_action_hash(
    user_address: &str,
    action_type: u64,
    params: &str,
    nonce: u64,
    chain_id: &str,
    executor_address: &str,
) -> Result<CryptoFelt> {
    let user = parse_crypto_felt(user_address)?;
    let params_hash = poseidon_hash_many(&serialize_byte_array(params)?);
    let chain_id_felt = parse_crypto_chain_id(chain_id)?;
    let executor_felt = parse_crypto_felt(executor_address)?;
    let data = vec![
        user,
        CryptoFelt::from(action_type),
        params_hash,
        CryptoFelt::from(nonce),
        chain_id_felt,
        executor_felt,
    ];
    Ok(poseidon_hash_many(&data))
}

// Internal helper that supports `build_ai_setup_typed_data` operations.
fn build_ai_setup_typed_data(
    chain_id: &str,
    user_address: &str,
    level: u8,
    action_type: u64,
    params: &str,
    nonce: u64,
    executor_address: &str,
) -> Result<(serde_json::Value, CryptoFelt)> {
    let action_hash = compute_action_hash(
        user_address,
        action_type,
        params,
        nonce,
        chain_id,
        executor_address,
    )?;
    let typed_data = serde_json::json!({
        "types": {
            "StarkNetDomain": [
                { "name": "name", "type": "felt" },
                { "name": "version", "type": "felt" },
                { "name": "chainId", "type": "felt" }
            ],
            "CarelAISetup": [
                { "name": "purpose", "type": "felt" },
                { "name": "level", "type": "felt" },
                { "name": "actionType", "type": "felt" },
                { "name": "nonce", "type": "felt" },
                { "name": "actionHash", "type": "felt" }
            ]
        },
        "primaryType": "CarelAISetup",
        "domain": {
            "name": "CAREL Protocol",
            "version": "1",
            "chainId": chain_id
        },
        "message": {
            "purpose": "AI_SETUP",
            "level": level,
            "actionType": action_type,
            "nonce": nonce,
            "actionHash": format!("{:#x}", action_hash)
        }
    });
    Ok((typed_data, action_hash))
}

// Internal helper that supports `compute_typed_data_message_hash` operations.
fn compute_typed_data_message_hash(
    typed_data: &serde_json::Value,
    user_address: &str,
) -> Result<CoreFelt> {
    let data: TypedData = serde_json::from_value(typed_data.clone()).map_err(|err| {
        AppError::Internal(format!(
            "Failed to parse AI setup typed data for message hash: {}",
            err
        ))
    })?;
    let account = parse_felt(user_address)?;
    data.message_hash(account).map_err(|err| {
        AppError::Internal(format!(
            "Failed to compute AI setup typed-data message hash: {}",
            err
        ))
    })
}

/// POST /api/v1/ai/prepare-action
pub async fn prepare_action_signature(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<PrepareAIActionRequest>,
) -> Result<Json<ApiResponse<PrepareAIActionResponse>>> {
    let auth_subject = require_user(&headers, &state).await?;
    let user_address = require_starknet_user(&headers, &state).await?;
    let db_level = state.db.get_user_ai_level(&auth_subject).await.unwrap_or(1);
    let onchain_level = fetch_onchain_user_tier(&state, &user_address).await;
    let unlocked_level = onchain_level.unwrap_or(db_level);
    if unlocked_level != db_level {
        let _ = state
            .db
            .upsert_user_ai_level(&auth_subject, unlocked_level)
            .await;
    }
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
    enforce_ai_rate_limit(&state, &auth_subject, req.level, true).await?;

    let params = req
        .context
        .clone()
        .unwrap_or_else(|| format!("tier:{}", req.level));
    if params.trim().is_empty() {
        return Err(crate::error::AppError::BadRequest(
            "Context cannot be empty".to_string(),
        ));
    }

    let nonce = Utc::now()
        .timestamp_millis()
        .max(0)
        .try_into()
        .unwrap_or(u64::MAX);
    let chain_id = state.config.starknet_chain_id.trim();
    let chain_id = if chain_id.is_empty() {
        "SN_SEPOLIA"
    } else {
        chain_id
    };
    let executor_address = state.config.ai_executor_address.trim();
    if executor_address.is_empty() || executor_address.starts_with("0x0000") {
        return Err(crate::error::AppError::BadRequest(
            "AI executor not configured".to_string(),
        ));
    }
    let (typed_data, _action_hash) = build_ai_setup_typed_data(
        chain_id,
        &user_address,
        req.level,
        action_type,
        &params,
        nonce,
        executor_address,
    )?;
    let message_hash = compute_typed_data_message_hash(&typed_data, &user_address)?;
    let message_hash_hex = format!("{:#x}", message_hash);
    ensure_executor_hash_window(&state, &user_address, message_hash, &message_hash_hex).await?;
    let response = PrepareAIActionResponse {
        action_type,
        params,
        nonce,
        message_hash: message_hash_hex,
        typed_data,
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
    if let Some(len_hex) = result.first() {
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

/// POST /api/v1/ai/ensure-executor
pub async fn ensure_executor_ready(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<AIExecutorReadyResponse>>> {
    let _ = require_user(&headers, &state).await?;
    let executor_address = state.config.ai_executor_address.trim().to_string();
    if executor_address.is_empty() || executor_address.starts_with("0x0000") {
        return Ok(Json(ApiResponse::success(AIExecutorReadyResponse {
            ready: false,
            burner_role_granted: false,
            signature_verification_enabled: None,
            updated_onchain: false,
            tx_hash: None,
            message: "AI executor not configured.".to_string(),
        })));
    }

    let signature_verification_enabled =
        fetch_ai_executor_signature_verification_enabled(&state, &executor_address).await;
    let carel_token_address = state.config.carel_token_address.trim().to_string();
    let burner_role_granted =
        if carel_token_address.is_empty() || carel_token_address.starts_with("0x0000") {
            false
        } else {
            has_executor_burner_role(&state, &carel_token_address, &executor_address)
                .await
                .unwrap_or(false)
        };

    let mut status_notes: Vec<String> = Vec::new();
    if let Ok(limit) = read_ai_executor_rate_limit(&state, &executor_address).await {
        status_notes.push(format!("on-chain rate_limit={}", limit));
    }
    if signature_verification_enabled.is_some() {
        status_notes.push(format!(
            "signature_verification={}",
            signature_verification_enabled.unwrap_or(false)
        ));
    }
    let message = if burner_role_granted {
        if status_notes.is_empty() {
            "AI executor is ready.".to_string()
        } else {
            format!("AI executor is ready. {}", status_notes.join(" "))
        }
    } else if carel_token_address.is_empty() || carel_token_address.starts_with("0x0000") {
        "CAREL token not configured; cannot verify burner role. Configure CAREL_TOKEN_ADDRESS and grant burner role manually."
            .to_string()
    } else {
        "AI executor not ready. Grant burner role and configure rate limit manually on-chain."
            .to_string()
    };

    Ok(Json(ApiResponse::success(AIExecutorReadyResponse {
        ready: burner_role_granted,
        burner_role_granted,
        signature_verification_enabled,
        updated_onchain: false,
        tx_hash: None,
        message,
    })))
}

/// GET /api/v1/ai/level
pub async fn get_ai_level(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<AILevelResponse>>> {
    let user_address = require_user(&headers, &state).await?;
    let starknet_user = resolve_starknet_user_optional(&headers, &state).await;
    let current_level = if let Some(starknet_user) = starknet_user.as_deref() {
        let onchain_level = fetch_onchain_user_tier(&state, starknet_user)
            .await
            .unwrap_or(1);
        let db_level = state.db.get_user_ai_level(&user_address).await.unwrap_or(1);
        if onchain_level != db_level {
            let _ = state
                .db
                .upsert_user_ai_level(&user_address, onchain_level)
                .await;
        }
        onchain_level
    } else {
        state.db.get_user_ai_level(&user_address).await.unwrap_or(1)
    };
    let next_level = if current_level < 3 {
        Some(current_level + 1)
    } else {
        None
    };
    Ok(Json(ApiResponse::success(AILevelResponse {
        current_level,
        max_level: 3,
        next_level,
        next_upgrade_cost_carel: None,
        payment_address_configured: false,
        payment_address: None,
        burn_address_configured: false,
        burn_address: None,
    })))
}

/// POST /api/v1/ai/upgrade
pub async fn upgrade_ai_level(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AIUpgradeLevelRequest>,
) -> Result<Json<ApiResponse<AIUpgradeLevelResponse>>> {
    let auth_subject = require_user(&headers, &state).await?;
    let previous_level = state.db.get_user_ai_level(&auth_subject).await.unwrap_or(1);
    if !(2..=3).contains(&req.target_level) {
        return Err(AppError::BadRequest(
            "target_level must be 2 or 3".to_string(),
        ));
    }
    let tx_hash = normalize_onchain_tx_hash(&req.onchain_tx_hash)?;
    let starknet_user = require_starknet_user(&headers, &state).await?;
    let onchain_level = fetch_onchain_user_tier(&state, &starknet_user)
        .await
        .ok_or_else(|| {
            AppError::BadRequest(
                "AI executor not configured or on-chain tier unavailable.".to_string(),
            )
        })?;
    if onchain_level < req.target_level {
        return Err(AppError::BadRequest(
            "On-chain tier not upgraded yet. Call upgrade_to_l2/upgrade_to_l3 on AIExecutor from your wallet, then retry."
                .to_string(),
        ));
    }
    let current_level = state
        .db
        .upsert_user_ai_level(&auth_subject, onchain_level)
        .await
        .unwrap_or(onchain_level);
    Ok(Json(ApiResponse::success(AIUpgradeLevelResponse {
        previous_level,
        current_level,
        target_level: req.target_level,
        burned_carel: "0".to_string(),
        onchain_tx_hash: tx_hash,
        block_number: 0,
    })))
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

// Internal helper that fetches data for `fetch_ai_executor_signature_verification_enabled`.
async fn fetch_ai_executor_signature_verification_enabled(
    state: &AppState,
    contract: &str,
) -> Option<bool> {
    let client = StarknetClient::new(state.config.starknet_rpc_url.clone());
    let storage_key = get_storage_var_address("signature_verification_enabled", &[]).ok()?;
    let storage_key_hex = format!("{:#x}", storage_key);
    let raw_value = client
        .get_storage_at(contract, &storage_key_hex)
        .await
        .ok()?;
    parse_felt_u64(&raw_value).map(|value| value != 0)
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
    // Internal helper that supports `action_type_for_level_matches_expected` operations.
    fn action_type_for_level_matches_expected() {
        // Memastikan level AI dipetakan ke action_type executor
        assert_eq!(action_type_for_level(2), Some(0));
        assert_eq!(action_type_for_level(3), Some(5));
        assert_eq!(action_type_for_level(1), None);
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
    // Internal helper that supports `level_2_rejects_hide_private_execution_scope` operations.
    fn level_2_rejects_hide_private_execution_scope() {
        let err =
            ensure_privacy_level_scope(2, "private swap 10 STRK to WBTC").expect_err("must reject");
        assert!(err.to_string().to_ascii_lowercase().contains("level 3"));
    }

    #[test]
    // Internal helper that supports `level_3_allows_hide_private_execution_scope` operations.
    fn level_3_allows_hide_private_execution_scope() {
        assert!(ensure_privacy_level_scope(3, "hide stake 10 USDT").is_ok());
        assert!(
            ensure_privacy_level_scope(3, "private limit order STRK/USDC amount 10 at 1.2").is_ok()
        );
    }

    #[test]
    // Internal helper that supports `level_3_allows_generic_chat_prompt` operations.
    fn level_3_allows_generic_chat_prompt() {
        // Memastikan level 3 tetap menerima prompt umum/non-intent.
        assert!(ensure_ai_level_scope(3, "what do you think about market mood today?").is_ok());
    }

    #[test]
    // Internal helper that supports `level_3_rejects_bridge_scope_until_private_bridge_exists` operations.
    fn level_3_rejects_bridge_scope_until_private_bridge_exists() {
        let err = ensure_ai_level_scope(3, "bridge 0.05 ETH to WBTC").expect_err("must reject");
        assert!(err.to_string().to_ascii_lowercase().contains("level 2"));
    }

    #[test]
    // Internal helper that supports `tier_required_for_command` operations.
    fn tier_required_for_command_handles_limit_order() {
        assert_eq!(tier_required_for_command("swap 1 STRK to CAREL"), 2);
        assert_eq!(
            tier_required_for_command("create limit order 10 STRK to USDC at 1.2"),
            2
        );
        assert_eq!(
            tier_required_for_command("private limit order STRK/USDC amount 10 at 1.2"),
            3
        );
    }

    #[test]
    // Internal helper that supports `action_type_for_ai_response` operations.
    fn action_type_for_ai_response_covers_limit_order() {
        let response = AIResponse {
            message: "ok".to_string(),
            actions: vec!["prepare_limit_order".to_string()],
            data: None,
        };
        assert_eq!(action_type_for_ai_response("limit order", &response), 5);
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
        let hash_a =
            compute_action_hash("0x123", 0, "tier:2", 10, "SN_SEPOLIA", "0x456").expect("hash A");
        let hash_b =
            compute_action_hash("0x123", 0, "tier:2", 10, "SN_SEPOLIA", "0x456").expect("hash B");
        assert_eq!(hash_a, hash_b);
    }
}
