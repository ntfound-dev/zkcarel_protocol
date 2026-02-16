use super::{require_starknet_user, require_user, AppState};
use crate::indexer::starknet_client::StarknetClient;
use crate::services::onchain::{parse_felt, OnchainInvoker};
use crate::{
    error::{AppError, Result},
    models::ApiResponse,
    services::ai_service::{classify_command_scope, AIGuardScope, AIService},
};
use axum::extract::Query;
use axum::{extract::State, http::HeaderMap, Json};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use starknet_core::types::{Call, Felt as CoreFelt};
use starknet_core::utils::get_selector_from_name;
use starknet_crypto::{poseidon_hash_many, Felt as CryptoFelt};
use std::time::{SystemTime, UNIX_EPOCH};

const DEFAULT_SIGNATURE_WINDOW_SECONDS: u64 = 30;
const MIN_SIGNATURE_WINDOW_SECONDS: u64 = 10;
const MAX_SIGNATURE_WINDOW_SECONDS: u64 = 90;
const SIGNATURE_PAST_SKEW_SECONDS: u64 = 2;

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

fn build_command(command: &str, context: &Option<String>) -> String {
    match context {
        Some(ctx) => format!("{} | context: {}", command, ctx),
        None => command.to_string(),
    }
}

fn confidence_score(has_llm_provider: bool) -> f64 {
    if has_llm_provider {
        0.9
    } else {
        0.6
    }
}

fn ensure_ai_level_scope(level: u8, command: &str) -> Result<()> {
    let scope = classify_command_scope(command);
    match level {
        1 => {
            if scope != AIGuardScope::ReadOnly {
                return Err(AppError::BadRequest(
                    "Level 1 is read-only: price, balance, points, and market queries only."
                        .to_string(),
                ));
            }
        }
        2 => {
            if !matches!(scope, AIGuardScope::ReadOnly | AIGuardScope::SwapBridge) {
                return Err(AppError::BadRequest(
                    "Level 2 supports read-only + swap/bridge commands.".to_string(),
                ));
            }
        }
        3 => {
            if !matches!(
                scope,
                AIGuardScope::ReadOnly | AIGuardScope::SwapBridge | AIGuardScope::PortfolioAlert
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

fn ai_level_limit(state: &AppState, level: u8) -> u32 {
    match level {
        1 => state.config.ai_rate_limit_level_1_per_window,
        2 => state.config.ai_rate_limit_level_2_per_window,
        3 => state.config.ai_rate_limit_level_3_per_window,
        _ => 1,
    }
}

fn time_bucket(window_seconds: u64) -> u64 {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let window = window_seconds.max(1);
    now / window
}

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
    let user_address = require_user(&headers, &state).await?;
    let config = state.config.clone();
    let service = AIService::new(state.db.clone(), config.clone());

    let command = build_command(&req.command, &req.context);
    let level = req.level.unwrap_or(1);
    tracing::info!(
        "AI execute: user={}, level={}, action_id={:?}",
        user_address,
        level,
        req.action_id
    );

    if level == 0 || level > 3 {
        return Err(crate::error::AppError::BadRequest(
            "Invalid AI level".into(),
        ));
    }
    ensure_ai_level_scope(level, &command)?;

    if level >= 2 {
        let Some(action_id) = req.action_id else {
            return Err(crate::error::AppError::BadRequest(
                "Missing on-chain AI action_id".into(),
            ));
        };
        ensure_onchain_action(&config, &user_address, action_id).await?;
    }
    enforce_ai_rate_limit(&state, &user_address, level, level >= 2).await?;

    let ai_response = service
        .execute_command(&user_address, &command, level)
        .await?;
    let confidence =
        confidence_score(config.gemini_api_key.is_some() || config.openai_api_key.is_some());

    let response = AICommandResponse {
        response: ai_response.message,
        actions: ai_response.actions,
        confidence,
        level,
    };

    Ok(Json(ApiResponse::success(response)))
}

fn action_type_for_level(level: u8) -> Option<u64> {
    match level {
        2 => Some(0), // Swap
        3 => Some(5), // MultiStep
        _ => None,
    }
}

fn encode_bytes_as_felt(chunk: &[u8]) -> Result<CryptoFelt> {
    if chunk.is_empty() {
        return Ok(CryptoFelt::from(0_u8));
    }
    let hex = hex::encode(chunk);
    CryptoFelt::from_hex(&format!("0x{hex}"))
        .map_err(|e| crate::error::AppError::BadRequest(format!("Invalid byte chunk: {}", e)))
}

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

/// POST /api/v1/ai/prepare-action
pub async fn prepare_action_signature(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<PrepareAIActionRequest>,
) -> Result<Json<ApiResponse<PrepareAIActionResponse>>> {
    let user_address = require_starknet_user(&headers, &state).await?;
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
            &user_address,
            &hash,
        )?);
    }

    let tx_hash = onchain.invoke_many(calls).await?;
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
    let user_address = require_user(&headers, &state).await?;
    let contract = state.config.ai_executor_address.trim();
    if contract.is_empty() || contract.starts_with("0x0000") {
        return Err(crate::error::AppError::BadRequest(
            "AI executor not configured".into(),
        ));
    }

    let offset = query.offset.unwrap_or(0);
    let limit = query.limit.unwrap_or(10).min(50);
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

    Ok(Json(ApiResponse::success(PendingActionsResponse {
        pending,
    })))
}

async fn ensure_onchain_action(
    config: &crate::config::Config,
    user_address: &str,
    action_id: u64,
) -> Result<()> {
    if action_id == 0 {
        return Err(crate::error::AppError::BadRequest(
            "Invalid on-chain AI action_id".into(),
        ));
    }

    let contract = config.ai_executor_address.trim();
    if contract.is_empty() || contract.starts_with("0x0000") {
        return Err(crate::error::AppError::BadRequest(
            "AI executor not configured".into(),
        ));
    }

    let client = StarknetClient::new(config.starknet_rpc_url.clone());
    let start_offset = action_id.saturating_sub(1).to_string();
    let result = client
        .call_contract(
            contract,
            "get_pending_actions_page",
            vec![user_address.to_string(), start_offset, "1".to_string()],
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

    if !pending.contains(&action_id) {
        return Err(crate::error::AppError::BadRequest(
            "Invalid or missing on-chain AI action".into(),
        ));
    }
    Ok(())
}

fn parse_felt_u64(value: &str) -> Option<u64> {
    if let Some(stripped) = value.strip_prefix("0x") {
        u64::from_str_radix(stripped, 16).ok()
    } else {
        value.parse::<u64>().ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_command_without_context() {
        // Memastikan command tidak berubah saat context kosong
        let command = build_command("ping", &None);
        assert_eq!(command, "ping");
    }

    #[test]
    fn build_command_with_context() {
        // Memastikan context ditambahkan ke command
        let command = build_command("ping", &Some("beta".to_string()));
        assert_eq!(command, "ping | context: beta");
    }

    #[test]
    fn confidence_score_depends_on_api_key() {
        // Memastikan skor confidence mengikuti status API key
        assert!((confidence_score(true) - 0.9).abs() < f64::EPSILON);
        assert!((confidence_score(false) - 0.6).abs() < f64::EPSILON);
    }

    #[test]
    fn action_type_for_level_matches_expected() {
        // Memastikan level AI dipetakan ke action_type executor
        assert_eq!(action_type_for_level(2), Some(0));
        assert_eq!(action_type_for_level(3), Some(5));
        assert_eq!(action_type_for_level(1), None);
    }

    #[test]
    fn serialize_byte_array_short_ascii_layout() {
        // Memastikan ByteArray pendek terserialisasi sebagai [len_words, pending, pending_len]
        let encoded = serialize_byte_array("tier:2").expect("serialize");
        assert_eq!(encoded.len(), 3);
        assert_eq!(encoded[0], CryptoFelt::from(0_u8));
        assert_eq!(encoded[2], CryptoFelt::from(6_u8));
    }

    #[test]
    fn compute_action_hash_is_deterministic() {
        // Memastikan hash action konsisten untuk input identik
        let hash_a = compute_action_hash("0x123", 0, "tier:2", 10).expect("hash A");
        let hash_b = compute_action_hash("0x123", 0, "tier:2", 10).expect("hash B");
        assert_eq!(hash_a, hash_b);
    }
}
