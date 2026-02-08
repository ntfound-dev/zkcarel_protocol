use axum::{extract::{State, Path}, http::HeaderMap, Json};
use serde::Deserialize;
use crate::{error::Result, models::ApiResponse, services::DepositService};
use super::{AppState, require_user};

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
    headers: HeaderMap,
    Json(req): Json<BankTransferRequest>,
) -> Result<Json<ApiResponse<crate::services::deposit_service::DepositInfo>>> {
    let user_address = require_user(&headers, &state).await?;
    
    let service = DepositService::new(state.db, state.config);
    let deposit = service.create_bank_transfer(&user_address, req.amount, &req.currency).await?;
    
    Ok(Json(ApiResponse::success(deposit)))
}

/// POST /api/v1/deposit/qris
pub async fn qris(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<QRISRequest>,
) -> Result<Json<ApiResponse<crate::services::deposit_service::DepositInfo>>> {
    let user_address = require_user(&headers, &state).await?;
    
    let service = DepositService::new(state.db, state.config);
    let deposit = service.create_qris(&user_address, req.amount).await?;
    
    Ok(Json(ApiResponse::success(deposit)))
}

/// POST /api/v1/deposit/card
pub async fn card_payment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CardPaymentRequest>,
) -> Result<Json<ApiResponse<crate::services::deposit_service::DepositInfo>>> {
    let user_address = require_user(&headers, &state).await?;
    
    let service = DepositService::new(state.db, state.config);
    let deposit = service.create_card_payment(&user_address, req.amount, &req.currency).await?;
    
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserialize_bank_transfer_request() {
        // Memastikan payload bank transfer ter-parse dengan benar
        let payload = r#"{"amount": 150.5, "currency": "IDR"}"#;
        let req: BankTransferRequest = serde_json::from_str(payload).expect("payload valid");
        assert_eq!(req.amount, 150.5);
        assert_eq!(req.currency, "IDR");
    }

    #[test]
    fn deserialize_qris_request() {
        // Memastikan payload QRIS ter-parse dengan benar
        let payload = r#"{"amount": 75.0}"#;
        let req: QRISRequest = serde_json::from_str(payload).expect("payload valid");
        assert_eq!(req.amount, 75.0);
    }

    #[test]
    fn deserialize_card_payment_request() {
        // Memastikan payload kartu ter-parse dengan benar
        let payload = r#"{"amount": 99.9, "currency": "USD"}"#;
        let req: CardPaymentRequest = serde_json::from_str(payload).expect("payload valid");
        assert_eq!(req.amount, 99.9);
        assert_eq!(req.currency, "USD");
    }
}
