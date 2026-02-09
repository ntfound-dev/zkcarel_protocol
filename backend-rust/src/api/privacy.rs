use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use crate::{error::Result, models::ApiResponse, services::onchain::{OnchainInvoker, parse_felt}};
use starknet_core::types::Call;
use starknet_core::utils::get_selector_from_name;

use super::{AppState, require_user};

#[derive(Debug, Deserialize)]
pub struct PrivacyActionRequest {
    pub nullifier: String,
    pub commitment: String,
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
    let _user_address = require_user(&headers, &state).await?;

    let router = state.config.zk_privacy_router_address.trim();
    if router.is_empty() || router.starts_with("0x0000") {
        return Err(crate::error::AppError::BadRequest("Privacy router not configured".into()));
    }

    let Some(invoker) = OnchainInvoker::from_config(&state.config).ok().flatten() else {
        return Err(crate::error::AppError::BadRequest("On-chain invoker not configured".into()));
    };

    let call = build_submit_call(router, &req)?;
    let tx_hash = invoker.invoke(call).await?;

    Ok(Json(ApiResponse::success(PrivacyActionResponse {
        tx_hash: tx_hash.to_string(),
    })))
}

fn build_submit_call(router: &str, req: &PrivacyActionRequest) -> Result<Call> {
    let to = parse_felt(router)?;
    let selector = get_selector_from_name("submit_private_action")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;

    let nullifier = parse_felt(&req.nullifier)?;
    let commitment = parse_felt(&req.commitment)?;

    let mut calldata = vec![nullifier, commitment];

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
