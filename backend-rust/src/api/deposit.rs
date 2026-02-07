use axum::{extract::{State, Path}, Json};
use serde::Deserialize;
use crate::{error::Result, models::ApiResponse, services::DepositService};
use super::AppState;

#[derive(Debug, Deserialize)]
pub struct BankTransferRequest {
    pub amount: f64,
    pub currency: String,
}

#[derive(Debug, Deserialize)]
pub struct QRISRequest {
    pub amount: f64,
}

#[derive(Debug, Deserialize)]
pub struct CardPaymentRequest {
    pub amount: f64,
    pub currency: String,
}

/// POST /api/v1/deposit/bank-transfer
pub async fn bank_transfer(
    State(state): State<AppState>,
    Json(req): Json<BankTransferRequest>,
) -> Result<Json<ApiResponse<crate::services::deposit_service::DepositInfo>>> {
    let user_address = "0x1234..."; // TODO: Extract from JWT
    
    let service = DepositService::new(state.db, state.config);
    let deposit = service.create_bank_transfer(user_address, req.amount, &req.currency).await?;
    
    Ok(Json(ApiResponse::success(deposit)))
}

/// POST /api/v1/deposit/qris
pub async fn qris(
    State(state): State<AppState>,
    Json(req): Json<QRISRequest>,
) -> Result<Json<ApiResponse<crate::services::deposit_service::DepositInfo>>> {
    let user_address = "0x1234..."; // TODO: Extract from JWT
    
    let service = DepositService::new(state.db, state.config);
    let deposit = service.create_qris(user_address, req.amount).await?;
    
    Ok(Json(ApiResponse::success(deposit)))
}

/// POST /api/v1/deposit/card
pub async fn card_payment(
    State(state): State<AppState>,
    Json(req): Json<CardPaymentRequest>,
) -> Result<Json<ApiResponse<crate::services::deposit_service::DepositInfo>>> {
    let user_address = "0x1234..."; // TODO: Extract from JWT
    
    let service = DepositService::new(state.db, state.config);
    let deposit = service.create_card_payment(user_address, req.amount, &req.currency).await?;
    
    Ok(Json(ApiResponse::success(deposit)))
}

/// GET /api/v1/deposit/status/:id
pub async fn get_status(
    State(state): State<AppState>,
    Path(deposit_id): Path<String>,
) -> Result<Json<ApiResponse<crate::services::deposit_service::DepositInfo>>> {
    let service = DepositService::new(state.db, state.config);
    let status = service.get_status(&deposit_id).await?;
    
    Ok(Json(ApiResponse::success(status)))
}