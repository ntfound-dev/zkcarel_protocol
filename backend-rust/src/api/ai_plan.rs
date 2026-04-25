use super::{require_starknet_user, require_user, AppState};
use crate::{
    error::{AppError, Result},
    models::ApiResponse,
    services::{
        ai_plan::{
            compute_plan_message_hash, compute_plan_payload_hash, fetch_plan_info,
            resolve_agent_operator, resolve_chain_id,
        },
        onchain::parse_felt,
        relayer::RelayerService,
    },
};
use axum::extract::State;
use axum::{extract::Query, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use starknet_core::types::{Call, Felt};
use starknet_core::utils::get_selector_from_name;
use std::time::{SystemTime, UNIX_EPOCH};

const DEFAULT_PLAN_ACTION_MASK: u64 = 1 | 2 | 4 | 8 | 32 | 64;
const DEFAULT_PLAN_MAX_ACTIONS: u64 = 50;
const DEFAULT_PLAN_EXPIRY_DAYS: u64 = 30;

#[derive(Debug, Deserialize)]
pub struct PreparePlanRequest {
    pub action_mask: Option<u64>,
    pub max_actions: Option<u64>,
    pub expires_at: Option<u64>,
    pub expiry_days: Option<u64>,
    pub nonce: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct PreparePlanResponse {
    pub user: String,
    pub agent_id: String,
    pub operator: String,
    pub plan_hash: String,
    pub action_mask: u64,
    pub max_actions: u64,
    pub expires_at: u64,
    pub nonce: u64,
    pub message_hash: String,
    pub plan_id: String,
}

#[derive(Debug, Deserialize)]
pub struct ApprovePlanRequest {
    pub user: String,
    pub agent_id: String,
    pub operator: Option<String>,
    pub plan_hash: String,
    pub action_mask: u64,
    pub max_actions: u64,
    pub expires_at: u64,
    pub nonce: u64,
    pub signature: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ApprovePlanResponse {
    pub plan_id: String,
    pub tx_hash: String,
}

#[derive(Debug, Deserialize)]
pub struct PlanStatusQuery {
    pub plan_id: String,
}

#[derive(Debug, Serialize)]
pub struct PlanStatusResponse {
    pub plan_id: String,
    pub user: String,
    pub agent_id: String,
    pub operator: String,
    pub plan_hash: String,
    pub action_mask: u64,
    pub max_actions: u64,
    pub used_actions: u64,
    pub expires_at: u64,
    pub created_at: u64,
    pub status: u64,
    pub active: bool,
}

fn read_u64_env(name: &str, fallback: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(fallback)
}

fn read_action_mask_env() -> u64 {
    if let Ok(raw) = std::env::var("AI_PLAN_ACTION_MASK") {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return DEFAULT_PLAN_ACTION_MASK;
        }
        if let Some(hex) = trimmed.strip_prefix("0x") {
            if let Ok(parsed) = u64::from_str_radix(hex, 16) {
                return parsed;
            }
        }
        if let Ok(parsed) = trimmed.parse::<u64>() {
            return parsed;
        }
    }
    DEFAULT_PLAN_ACTION_MASK
}

fn compute_default_expires_at(expiry_days: u64) -> u64 {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    now.saturating_add(expiry_days.saturating_mul(86400))
}

/// POST /api/v1/ai/plan/prepare
pub async fn prepare_plan(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<PreparePlanRequest>,
) -> Result<Json<ApiResponse<PreparePlanResponse>>> {
    let _auth_subject = require_user(&headers, &state).await?;
    let user_address = require_starknet_user(&headers, &state).await?;
    let agent_id = state
        .config
        .ai_agent_id
        .as_ref()
        .ok_or_else(|| AppError::BadRequest("AI_AGENT_ID is not configured".to_string()))?;
    let plan_router = state
        .config
        .ai_plan_router_address
        .as_ref()
        .ok_or_else(|| {
            AppError::BadRequest("AI_PLAN_ROUTER_ADDRESS is not configured".to_string())
        })?;

    let action_mask = req.action_mask.unwrap_or_else(read_action_mask_env);
    if action_mask == 0 {
        return Err(AppError::BadRequest(
            "action_mask must be non-zero".to_string(),
        ));
    }
    let max_actions = req
        .max_actions
        .filter(|value| *value > 0)
        .unwrap_or_else(|| read_u64_env("AI_PLAN_MAX_ACTIONS", DEFAULT_PLAN_MAX_ACTIONS));
    let expiry_days = req
        .expiry_days
        .filter(|value| *value > 0)
        .unwrap_or_else(|| read_u64_env("AI_PLAN_EXPIRY_DAYS", DEFAULT_PLAN_EXPIRY_DAYS));
    let expires_at = req
        .expires_at
        .unwrap_or_else(|| compute_default_expires_at(expiry_days));
    let nonce = req.nonce.unwrap_or_else(|| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .min(u128::from(u64::MAX)) as u64
    });

    let operator_felt = resolve_agent_operator(&state.config, agent_id).await?;
    let operator_hex = format!("{:#x}", operator_felt);
    let plan_hash_felt = compute_plan_payload_hash(action_mask, max_actions, expires_at);
    let plan_hash = format!("{:#x}", plan_hash_felt);
    let chain_id = resolve_chain_id(&state.config)?;
    let message_hash = compute_plan_message_hash(
        &chain_id,
        plan_router,
        &user_address,
        agent_id,
        operator_hex.as_str(),
        plan_hash_felt,
        action_mask,
        max_actions,
        expires_at,
        nonce,
    )?;
    let message_hash_hex = format!("{:#x}", message_hash);

    Ok(Json(ApiResponse::success(PreparePlanResponse {
        user: user_address,
        agent_id: agent_id.to_string(),
        operator: operator_hex,
        plan_hash,
        action_mask,
        max_actions,
        expires_at,
        nonce,
        message_hash: message_hash_hex.clone(),
        plan_id: message_hash_hex,
    })))
}

/// POST /api/v1/ai/plan/approve
pub async fn approve_plan(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ApprovePlanRequest>,
) -> Result<Json<ApiResponse<ApprovePlanResponse>>> {
    let _auth_subject = require_user(&headers, &state).await?;
    let user_address = require_starknet_user(&headers, &state).await?;
    if req.signature.is_empty() {
        return Err(AppError::BadRequest("Signature is required".to_string()));
    }
    if req.user.trim().to_ascii_lowercase() != user_address.trim().to_ascii_lowercase() {
        return Err(AppError::BadRequest(
            "Plan user does not match authenticated wallet".to_string(),
        ));
    }

    let plan_router = state
        .config
        .ai_plan_router_address
        .as_ref()
        .ok_or_else(|| {
            AppError::BadRequest("AI_PLAN_ROUTER_ADDRESS is not configured".to_string())
        })?;
    let agent_id = state
        .config
        .ai_agent_id
        .as_ref()
        .ok_or_else(|| AppError::BadRequest("AI_AGENT_ID is not configured".to_string()))?;
    if req.agent_id.trim().to_ascii_lowercase() != agent_id.trim().to_ascii_lowercase() {
        return Err(AppError::BadRequest("agent_id mismatch".to_string()));
    }

    let operator_felt = resolve_agent_operator(&state.config, agent_id).await?;
    let operator_hex = format!("{:#x}", operator_felt);
    if let Some(operator) = req.operator.as_ref() {
        if operator.trim().to_ascii_lowercase() != operator_hex.trim().to_ascii_lowercase() {
            return Err(AppError::BadRequest("operator mismatch".to_string()));
        }
    }

    let expected_plan_hash =
        compute_plan_payload_hash(req.action_mask, req.max_actions, req.expires_at);
    let expected_plan_hash_hex = format!("{:#x}", expected_plan_hash);
    if req.plan_hash.trim().to_ascii_lowercase()
        != expected_plan_hash_hex.trim().to_ascii_lowercase()
    {
        return Err(AppError::BadRequest("plan_hash mismatch".to_string()));
    }

    let chain_id = resolve_chain_id(&state.config)?;
    let message_hash = compute_plan_message_hash(
        &chain_id,
        plan_router,
        &user_address,
        agent_id,
        operator_hex.as_str(),
        expected_plan_hash,
        req.action_mask,
        req.max_actions,
        req.expires_at,
        req.nonce,
    )?;
    let message_hash_hex = format!("{:#x}", message_hash);

    let selector = get_selector_from_name("approve_plan")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let mut calldata = vec![
        parse_felt(&req.user)?,
        parse_felt(agent_id)?,
        parse_felt(&req.plan_hash)?,
        Felt::from(req.action_mask),
        Felt::from(req.max_actions),
        Felt::from(req.expires_at),
        Felt::from(req.nonce),
        Felt::from(req.signature.len() as u64),
    ];
    for value in &req.signature {
        calldata.push(parse_felt(value)?);
    }
    let call = Call {
        to: parse_felt(plan_router)?,
        selector,
        calldata,
    };

    let relayer = RelayerService::from_config(&state.config)?;
    let submitted = relayer.submit_call(call).await?;

    Ok(Json(ApiResponse::success(ApprovePlanResponse {
        plan_id: message_hash_hex,
        tx_hash: submitted.tx_hash,
    })))
}

/// GET /api/v1/ai/plan/status
pub async fn get_plan_status(
    State(state): State<AppState>,
    Query(query): Query<PlanStatusQuery>,
) -> Result<Json<ApiResponse<PlanStatusResponse>>> {
    let plan = fetch_plan_info(&state.config, &query.plan_id).await?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let active = plan.status == 0 && plan.expires_at > now && plan.used_actions < plan.max_actions;

    Ok(Json(ApiResponse::success(PlanStatusResponse {
        plan_id: query.plan_id,
        user: format!("{:#x}", plan.user),
        agent_id: format!("{:#x}", plan.agent_id),
        operator: format!("{:#x}", plan.operator),
        plan_hash: format!("{:#x}", plan.plan_hash),
        action_mask: plan.action_mask,
        max_actions: plan.max_actions,
        used_actions: plan.used_actions,
        expires_at: plan.expires_at,
        created_at: plan.created_at,
        status: plan.status,
        active,
    })))
}
