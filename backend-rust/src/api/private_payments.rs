use crate::{
    error::Result,
    models::ApiResponse,
    services::onchain::{parse_felt, OnchainInvoker, OnchainReader},
};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use serde::{Deserialize, Serialize};
use starknet_core::types::{Call, FunctionCall};
use starknet_core::utils::get_selector_from_name;

use super::{require_user, AppState};

#[derive(Debug, Deserialize)]
pub struct SubmitPrivatePaymentRequest {
    pub ciphertext: String,
    pub commitment: String,
    pub amount_commitment: String,
    pub proof: Vec<String>,
    pub public_inputs: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct FinalizePrivatePaymentRequest {
    pub payment_id: u64,
    pub recipient: String,
    pub nullifier: String,
    pub proof: Vec<String>,
    pub public_inputs: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct PrivatePaymentResponse {
    pub tx_hash: String,
}

#[derive(Debug, Serialize)]
pub struct NullifierStatusResponse {
    pub nullifier: String,
    pub used: bool,
}

/// POST /api/v1/private-payments/submit
pub async fn submit_private_payment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<SubmitPrivatePaymentRequest>,
) -> Result<Json<ApiResponse<PrivatePaymentResponse>>> {
    let _user = require_user(&headers, &state).await?;
    let contract = state.config.private_payments_address.trim();
    if contract.is_empty() || contract.starts_with("0x0000") {
        return Err(crate::error::AppError::BadRequest(
            "Private payments not configured".into(),
        ));
    }

    let Some(invoker) = OnchainInvoker::from_config(&state.config).ok().flatten() else {
        return Err(crate::error::AppError::BadRequest(
            "On-chain invoker not configured".into(),
        ));
    };

    let call = build_submit_call(contract, &req)?;
    let tx_hash = invoker.invoke(call).await?;

    Ok(Json(ApiResponse::success(PrivatePaymentResponse {
        tx_hash: tx_hash.to_string(),
    })))
}

/// POST /api/v1/private-payments/finalize
pub async fn finalize_private_payment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<FinalizePrivatePaymentRequest>,
) -> Result<Json<ApiResponse<PrivatePaymentResponse>>> {
    let _user = require_user(&headers, &state).await?;
    let contract = state.config.private_payments_address.trim();
    if contract.is_empty() || contract.starts_with("0x0000") {
        return Err(crate::error::AppError::BadRequest(
            "Private payments not configured".into(),
        ));
    }

    let Some(invoker) = OnchainInvoker::from_config(&state.config).ok().flatten() else {
        return Err(crate::error::AppError::BadRequest(
            "On-chain invoker not configured".into(),
        ));
    };

    let call = build_finalize_call(contract, &req)?;
    let tx_hash = invoker.invoke(call).await?;

    Ok(Json(ApiResponse::success(PrivatePaymentResponse {
        tx_hash: tx_hash.to_string(),
    })))
}

/// GET /api/v1/private-payments/nullifier/{nullifier}
pub async fn is_nullifier_used(
    State(state): State<AppState>,
    Path(nullifier): Path<String>,
) -> Result<Json<ApiResponse<NullifierStatusResponse>>> {
    let contract = state.config.private_payments_address.trim();
    if contract.is_empty() || contract.starts_with("0x0000") {
        return Err(crate::error::AppError::BadRequest(
            "Private payments not configured".into(),
        ));
    }

    let reader = OnchainReader::from_config(&state.config)?;
    let to = parse_felt(contract)?;
    let selector = get_selector_from_name("is_nullifier_used")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;

    let calldata = vec![parse_felt(&nullifier)?];
    let result = reader
        .call(FunctionCall {
            contract_address: to,
            entry_point_selector: selector,
            calldata,
        })
        .await?;

    let used = result
        .get(0)
        .map(|v| v == &starknet_core::types::Felt::from(1_u8))
        .unwrap_or(false);

    Ok(Json(ApiResponse::success(NullifierStatusResponse {
        nullifier,
        used,
    })))
}

// Internal helper that builds inputs for `build_submit_call`.
fn build_submit_call(contract: &str, req: &SubmitPrivatePaymentRequest) -> Result<Call> {
    let to = parse_felt(contract)?;
    let selector = get_selector_from_name("submit_private_payment")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;

    let ciphertext = parse_felt(&req.ciphertext)?;
    let commitment = parse_felt(&req.commitment)?;
    let amount_commitment = parse_felt(&req.amount_commitment)?;

    let mut calldata = vec![
        ciphertext,
        commitment,
        amount_commitment,
        starknet_core::types::Felt::from(0_u128),
    ];

    calldata.push(starknet_core::types::Felt::from(req.proof.len() as u64));
    for item in &req.proof {
        calldata.push(parse_felt(item)?);
    }

    calldata.push(starknet_core::types::Felt::from(
        req.public_inputs.len() as u64
    ));
    for item in &req.public_inputs {
        calldata.push(parse_felt(item)?);
    }

    Ok(Call {
        to,
        selector,
        calldata,
    })
}

// Internal helper that builds inputs for `build_finalize_call`.
fn build_finalize_call(contract: &str, req: &FinalizePrivatePaymentRequest) -> Result<Call> {
    let to = parse_felt(contract)?;
    let selector = get_selector_from_name("finalize_private_payment")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;

    let recipient = parse_felt(&req.recipient)?;
    let nullifier = parse_felt(&req.nullifier)?;

    let mut calldata = vec![
        starknet_core::types::Felt::from(req.payment_id),
        recipient,
        nullifier,
    ];

    calldata.push(starknet_core::types::Felt::from(req.proof.len() as u64));
    for item in &req.proof {
        calldata.push(parse_felt(item)?);
    }

    calldata.push(starknet_core::types::Felt::from(
        req.public_inputs.len() as u64
    ));
    for item in &req.public_inputs {
        calldata.push(parse_felt(item)?);
    }

    Ok(Call {
        to,
        selector,
        calldata,
    })
}
