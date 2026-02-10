use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use crate::{error::Result, models::ApiResponse, services::onchain::{OnchainInvoker, parse_felt}};
use starknet_core::types::Call;
use starknet_core::utils::get_selector_from_name;

use super::{AppState, require_user};

#[derive(Debug, Deserialize)]
pub struct PrivacyActionRequest {
    // V2: PrivacyRouter.submit_action(...)
    pub action_type: Option<String>,
    pub old_root: Option<String>,
    pub new_root: Option<String>,
    pub nullifiers: Option<Vec<String>>,
    pub commitments: Option<Vec<String>>,
    // V1: ZkPrivacyRouter.submit_private_action(...)
    pub nullifier: Option<String>,
    pub commitment: Option<String>,
    // Shared
    pub proof: Vec<String>,
    pub public_inputs: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct PrivacyActionResponse {
    pub tx_hash: String,
}

/// POST /api/v1/privacy/submit
pub async fn submit_private_action(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<PrivacyActionRequest>,
) -> Result<Json<ApiResponse<PrivacyActionResponse>>> {
    let user_address = require_user(&headers, &state).await?;

    let router_v2 = state.config.privacy_router_address.as_deref().unwrap_or("").trim();
    let router_v1 = state.config.zk_privacy_router_address.trim();
    let has_v2 = !router_v2.is_empty() && !router_v2.starts_with("0x0000");
    let has_v1 = !router_v1.is_empty() && !router_v1.starts_with("0x0000");
    if !has_v2 && !has_v1 {
        return Err(crate::error::AppError::BadRequest("Privacy router not configured".into()));
    }

    let nullifiers_len = req.nullifiers.as_ref().map(|v| v.len()).unwrap_or(0);
    let commitments_len = req.commitments.as_ref().map(|v| v.len()).unwrap_or(0);
    tracing::info!(
        "Privacy submit: user={}, v2={}, v1={}, action_type={:?}, nullifiers={}, commitments={}, proof={}, public_inputs={}",
        user_address,
        has_v2,
        has_v1,
        req.action_type,
        nullifiers_len,
        commitments_len,
        req.proof.len(),
        req.public_inputs.len()
    );
    if req.proof.is_empty() || req.public_inputs.is_empty() {
        tracing::warn!("Privacy submit has empty proof/public_inputs for user={}", user_address);
    }

    let Some(invoker) = OnchainInvoker::from_config(&state.config).ok().flatten() else {
        return Err(crate::error::AppError::BadRequest("On-chain invoker not configured".into()));
    };

    let call = if has_v2 {
        tracing::debug!("Submitting privacy action via V2 router");
        build_submit_call_v2(router_v2, &req)?
    } else {
        tracing::debug!("Submitting privacy action via V1 router");
        build_submit_call_v1(router_v1, &req)?
    };
    let tx_hash = invoker.invoke(call).await?;

    Ok(Json(ApiResponse::success(PrivacyActionResponse {
        tx_hash: tx_hash.to_string(),
    })))
}

fn build_submit_call_v2(router: &str, req: &PrivacyActionRequest) -> Result<Call> {
    let to = parse_felt(router)?;
    let selector = get_selector_from_name("submit_action")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;

    let action_type = req
        .action_type
        .as_ref()
        .ok_or_else(|| crate::error::AppError::BadRequest("Missing action_type".into()))?;
    let old_root = req
        .old_root
        .as_ref()
        .ok_or_else(|| crate::error::AppError::BadRequest("Missing old_root".into()))?;
    let new_root = req
        .new_root
        .as_ref()
        .ok_or_else(|| crate::error::AppError::BadRequest("Missing new_root".into()))?;

    let nullifiers = req.nullifiers.clone().unwrap_or_default();
    let commitments = req.commitments.clone().unwrap_or_default();

    let mut calldata = vec![
        parse_action_type(action_type)?,
        parse_felt(old_root)?,
        parse_felt(new_root)?,
    ];

    calldata.push(starknet_core::types::Felt::from(nullifiers.len() as u64));
    for item in &nullifiers {
        calldata.push(parse_felt(item)?);
    }

    calldata.push(starknet_core::types::Felt::from(commitments.len() as u64));
    for item in &commitments {
        calldata.push(parse_felt(item)?);
    }

    calldata.push(starknet_core::types::Felt::from(req.public_inputs.len() as u64));
    for item in &req.public_inputs {
        calldata.push(parse_felt(item)?);
    }

    calldata.push(starknet_core::types::Felt::from(req.proof.len() as u64));
    for item in &req.proof {
        calldata.push(parse_felt(item)?);
    }

    Ok(Call { to, selector, calldata })
}

fn build_submit_call_v1(router: &str, req: &PrivacyActionRequest) -> Result<Call> {
    let to = parse_felt(router)?;
    let selector = get_selector_from_name("submit_private_action")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;

    let nullifier = req
        .nullifier
        .as_ref()
        .ok_or_else(|| crate::error::AppError::BadRequest("Missing nullifier".into()))?;
    let commitment = req
        .commitment
        .as_ref()
        .ok_or_else(|| crate::error::AppError::BadRequest("Missing commitment".into()))?;

    let mut calldata = vec![parse_felt(nullifier)?, parse_felt(commitment)?];

    calldata.push(starknet_core::types::Felt::from(req.proof.len() as u64));
    for item in &req.proof {
        calldata.push(parse_felt(item)?);
    }

    calldata.push(starknet_core::types::Felt::from(req.public_inputs.len() as u64));
    for item in &req.public_inputs {
        calldata.push(parse_felt(item)?);
    }

    Ok(Call { to, selector, calldata })
}

fn parse_action_type(value: &str) -> Result<starknet_core::types::Felt> {
    if value.starts_with("0x") || value.chars().all(|c| c.is_ascii_digit()) {
        return parse_felt(value);
    }
    let hex = hex::encode(value.as_bytes());
    parse_felt(&format!("0x{hex}"))
}
