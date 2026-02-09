use axum::{extract::{Path, State}, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use crate::{error::Result, models::ApiResponse, services::onchain::{OnchainInvoker, OnchainReader, parse_felt}};
use starknet_core::types::{Call, FunctionCall};
use starknet_core::utils::get_selector_from_name;

use super::{AppState, require_user};

#[derive(Debug, Deserialize)]
pub struct SubmitCredentialRequest {
    pub nullifier: String,
    pub proof: Vec<String>,
    pub public_inputs: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct CredentialResponse {
    pub tx_hash: String,
}

#[derive(Debug, Serialize)]
pub struct NullifierStatusResponse {
    pub nullifier: String,
    pub used: bool,
}

/// POST /api/v1/credentials/submit
pub async fn submit_credential_proof(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<SubmitCredentialRequest>,
) -> Result<Json<ApiResponse<CredentialResponse>>> {
    let _user = require_user(&headers, &state).await?;
    let contract = state.config.anonymous_credentials_address.trim();
    if contract.is_empty() || contract.starts_with("0x0000") {
        return Err(crate::error::AppError::BadRequest("Anonymous credentials not configured".into()));
    }

    let Some(invoker) = OnchainInvoker::from_config(&state.config).ok().flatten() else {
        return Err(crate::error::AppError::BadRequest("On-chain invoker not configured".into()));
    };

    let call = build_submit_call(contract, &req)?;
    let tx_hash = invoker.invoke(call).await?;

    Ok(Json(ApiResponse::success(CredentialResponse {
        tx_hash: tx_hash.to_string(),
    })))
}

/// GET /api/v1/credentials/nullifier/{nullifier}
pub async fn is_nullifier_used(
    State(state): State<AppState>,
    Path(nullifier): Path<String>,
) -> Result<Json<ApiResponse<NullifierStatusResponse>>> {
    let contract = state.config.anonymous_credentials_address.trim();
    if contract.is_empty() || contract.starts_with("0x0000") {
        return Err(crate::error::AppError::BadRequest("Anonymous credentials not configured".into()));
    }

    let reader = OnchainReader::from_config(&state.config)?;
    let to = parse_felt(contract)?;
    let selector = get_selector_from_name("is_nullifier_used")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;

    let calldata = vec![parse_felt(&nullifier)?];
    let result = reader
        .call(FunctionCall { contract_address: to, entry_point_selector: selector, calldata })
        .await?;

    let used = result.get(0).map(|v| v == &starknet_core::types::Felt::from(1_u8)).unwrap_or(false);

    Ok(Json(ApiResponse::success(NullifierStatusResponse {
        nullifier,
        used,
    })))
}

fn build_submit_call(contract: &str, req: &SubmitCredentialRequest) -> Result<Call> {
    let to = parse_felt(contract)?;
    let selector = get_selector_from_name("submit_credential_proof")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;

    let nullifier = parse_felt(&req.nullifier)?;

    let mut calldata = vec![nullifier];

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
