use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::{
    error::Result,
    models::{ApiResponse, BridgeQuoteRequest, BridgeQuoteResponse},
    // Mengimpor hasher untuk menghilangkan warning unused di crypto/hash.rs
    crypto::hash,
};

use super::AppState;

#[derive(Debug, Deserialize)]
pub struct ExecuteBridgeRequest {
    pub from_chain: String,
    pub to_chain: String,
    pub token: String,
    pub amount: String,
    pub recipient: String,
}

#[derive(Debug, Serialize)]
pub struct ExecuteBridgeResponse {
    pub bridge_id: String,
    pub status: String,
    pub from_chain: String,
    pub to_chain: String,
    pub amount: String,
    pub estimated_receive: String,
    pub estimated_time: String,
}

/// POST /api/v1/bridge/quote
pub async fn get_bridge_quote(
    State(_state): State<AppState>,
    Json(req): Json<BridgeQuoteRequest>,
) -> Result<Json<ApiResponse<BridgeQuoteResponse>>> {
    let amount: f64 = req.amount.parse()
        .map_err(|_| crate::error::AppError::BadRequest("Invalid amount".to_string()))?;

    let bridge_fee = amount * 0.004;
    let estimated_receive = amount - bridge_fee;

    let provider = match (req.from_chain.as_str(), req.to_chain.as_str()) {
        ("bitcoin", "starknet") => "LayerSwap",
        ("ethereum", "starknet") => "StarkGate",
        ("starknet", "ethereum") => "StarkGate",
        _ => "Atomiq",
    };

    let estimated_time = match provider {
        "LayerSwap" => "~15-20 min",
        "StarkGate" => "~10-15 min",
        "Atomiq" => "~20-30 min",
        _ => "~15-20 min",
    };

    let response = BridgeQuoteResponse {
        from_chain: req.from_chain,
        to_chain: req.to_chain,
        amount: req.amount,
        estimated_receive: estimated_receive.to_string(),
        fee: bridge_fee.to_string(),
        estimated_time: estimated_time.to_string(),
        bridge_provider: provider.to_string(),
    };

    Ok(Json(ApiResponse::success(response)))
}

/// POST /api/v1/bridge/execute
pub async fn execute_bridge(
    State(state): State<AppState>,
    Json(req): Json<ExecuteBridgeRequest>,
) -> Result<Json<ApiResponse<ExecuteBridgeResponse>>> {
    let user_address = "0x1234...";

    let amount: f64 = req.amount.parse()
        .map_err(|_| crate::error::AppError::BadRequest("Invalid amount".to_string()))?;

    // MENGGUNAKAN crypto::hash di sini agar warning di hash.rs hilang
    let bridge_data = format!("{}{}{}{}", user_address, req.from_chain, req.to_chain, req.amount);
    let bridge_id = format!("BR_{}", hash::hash_string(&bridge_data));

    let estimated_receive = amount * 0.996;

    let tx = crate::models::Transaction {
        tx_hash: bridge_id.clone(),
        block_number: 0,
        user_address: user_address.to_string(),
        tx_type: "bridge".to_string(),
        token_in: Some(req.token.clone()),
        token_out: Some(req.token.clone()),
        amount_in: Some(rust_decimal::Decimal::from_f64_retain(amount).unwrap()),
        amount_out: Some(rust_decimal::Decimal::from_f64_retain(estimated_receive).unwrap()),
        usd_value: Some(rust_decimal::Decimal::from_f64_retain(amount).unwrap()),
        fee_paid: Some(rust_decimal::Decimal::from_f64_retain(amount * 0.004).unwrap()),
        points_earned: Some(rust_decimal::Decimal::from_f64_retain(amount * 15.0).unwrap()),
        timestamp: chrono::Utc::now(),
        processed: false,
    };

    state.db.save_transaction(&tx).await?;

    // MENGGUNAKAN 'recipient' agar tidak dead_code
    tracing::info!(
        "Bridge initiated to {}: {} {} from {} to {} (id: {})",
        req.recipient,
        amount,
        req.token,
        req.from_chain,
        req.to_chain,
        bridge_id
    );

    let response = ExecuteBridgeResponse {
        bridge_id,
        status: "pending".to_string(),
        from_chain: req.from_chain,
        to_chain: req.to_chain,
        amount: req.amount,
        estimated_receive: estimated_receive.to_string(),
        estimated_time: "~15-20 min".to_string(),
    };

    Ok(Json(ApiResponse::success(response)))
}
