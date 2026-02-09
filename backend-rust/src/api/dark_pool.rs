use axum::{extract::{Path, State}, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use crate::{error::Result, models::ApiResponse, services::onchain::{OnchainInvoker, OnchainReader, parse_felt}};
use starknet_core::types::{Call, FunctionCall};
use starknet_core::utils::get_selector_from_name;

use super::{AppState, require_user};

#[derive(Debug, Deserialize)]
pub struct SubmitDarkOrderRequest {
    pub ciphertext: String,
    pub commitment: String,
    pub proof: Vec<String>,
    pub public_inputs: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct MatchDarkOrderRequest {
    pub order_id: u64,
    pub nullifier: String,
    pub proof: Vec<String>,
    pub public_inputs: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct DarkPoolResponse {
    pub tx_hash: String,
}

#[derive(Debug, Serialize)]
pub struct NullifierStatusResponse {
    pub nullifier: String,
    pub used: bool,
}

/// POST /api/v1/dark-pool/order
pub async fn submit_order(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<SubmitDarkOrderRequest>,
) -> Result<Json<ApiResponse<DarkPoolResponse>>> {
    let _user = require_user(&headers, &state).await?;
    let contract = state.config.dark_pool_address.trim();
    if contract.is_empty() || contract.starts_with("0x0000") {
        return Err(crate::error::AppError::BadRequest("Dark pool not configured".into()));
    }

    let Some(invoker) = OnchainInvoker::from_config(&state.config).ok().flatten() else {
        return Err(crate::error::AppError::BadRequest("On-chain invoker not configured".into()));
    };

    let call = build_submit_call(contract, &req)?;
    let tx_hash = invoker.invoke(call).await?;

    Ok(Json(ApiResponse::success(DarkPoolResponse {
        tx_hash: tx_hash.to_string(),
    })))
}

/// POST /api/v1/dark-pool/match
pub async fn match_order(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<MatchDarkOrderRequest>,
) -> Result<Json<ApiResponse<DarkPoolResponse>>> {
    let _user = require_user(&headers, &state).await?;
    let contract = state.config.dark_pool_address.trim();
    if contract.is_empty() || contract.starts_with("0x0000") {
        return Err(crate::error::AppError::BadRequest("Dark pool not configured".into()));
    }

    let Some(invoker) = OnchainInvoker::from_config(&state.config).ok().flatten() else {
        return Err(crate::error::AppError::BadRequest("On-chain invoker not configured".into()));
    };

    let call = build_match_call(contract, &req)?;
    let tx_hash = invoker.invoke(call).await?;

    Ok(Json(ApiResponse::success(DarkPoolResponse {
        tx_hash: tx_hash.to_string(),
    })))
}

/// GET /api/v1/dark-pool/nullifier/{nullifier}
pub async fn is_nullifier_used(
    State(state): State<AppState>,
    Path(nullifier): Path<String>,
) -> Result<Json<ApiResponse<NullifierStatusResponse>>> {
    let contract = state.config.dark_pool_address.trim();
    if contract.is_empty() || contract.starts_with("0x0000") {
        return Err(crate::error::AppError::BadRequest("Dark pool not configured".into()));
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

fn build_submit_call(contract: &str, req: &SubmitDarkOrderRequest) -> Result<Call> {
    let to = parse_felt(contract)?;
    let selector = get_selector_from_name("submit_order")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;

    let ciphertext = parse_felt(&req.ciphertext)?;
    let commitment = parse_felt(&req.commitment)?;

    let mut calldata = vec![ciphertext, commitment, starknet_core::types::Felt::from(0_u128)];

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

fn build_match_call(contract: &str, req: &MatchDarkOrderRequest) -> Result<Call> {
    let to = parse_felt(contract)?;
    let selector = get_selector_from_name("match_order")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;

    let nullifier = parse_felt(&req.nullifier)?;

    let mut calldata = vec![
        starknet_core::types::Felt::from(req.order_id),
        nullifier,
    ];

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
