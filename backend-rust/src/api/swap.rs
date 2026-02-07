use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use crate::{
    error::{AppError, Result},
    models::{ApiResponse, SwapQuoteRequest, SwapQuoteResponse},
    services::LiquidityAggregator,
    // 1. IMPORT MODUL HASH AGAR TERPAKAI
    crypto::hash,
};
use super::AppState;

#[derive(Debug, Deserialize)]
pub struct ExecuteSwapRequest {
    pub from_token: String,
    pub to_token: String,
    pub amount: String,
    pub min_amount_out: String,
    pub slippage: f64,
    pub deadline: i64,
    pub recipient: Option<String>,
    pub mode: String, // "private" or "transparent"
}

#[derive(Debug, Serialize)]
pub struct ExecuteSwapResponse {
    pub tx_hash: String,
    pub status: String,
    pub from_amount: String,
    pub to_amount: String,
    pub actual_rate: String,
    pub fee_paid: String,
}

/// POST /api/v1/swap/quote
pub async fn get_quote(
    State(state): State<AppState>,
    Json(req): Json<SwapQuoteRequest>,
) -> Result<Json<ApiResponse<SwapQuoteResponse>>> {
    let amount_in: f64 = req.amount.parse()
        .map_err(|_| AppError::BadRequest("Invalid amount".to_string()))?;

    let aggregator = LiquidityAggregator::new(state.config.clone());
    let best_route = aggregator.get_best_quote(
        &req.from_token,
        &req.to_token,
        amount_in,
    ).await?;

    let response = SwapQuoteResponse {
        from_amount: req.amount.clone(),
        to_amount: best_route.amount_out.to_string(),
        rate: (best_route.amount_out / amount_in).to_string(),
        price_impact: format!("{:.2}%", best_route.price_impact * 100.0),
        fee: best_route.fee.to_string(),
        fee_usd: best_route.fee.to_string(),
        route: best_route.path,
        estimated_gas: "0.002".to_string(),
        estimated_time: match best_route.dex.as_str() {
            "Ekubo" => "~2 min",
            "Haiko" => "~3 min",
            _ => "~2-3 min",
        }.to_string(),
    };

    Ok(Json(ApiResponse::success(response)))
}

/// POST /api/v1/swap/execute
pub async fn execute_swap(
    State(state): State<AppState>,
    Json(req): Json<ExecuteSwapRequest>,
) -> Result<Json<ApiResponse<ExecuteSwapResponse>>> {
    // 1. VALIDASI DEADLINE
    let now = chrono::Utc::now().timestamp();
    if req.deadline < now {
        return Err(AppError::BadRequest("Transaction deadline expired".to_string()));
    }

    let user_address = "0x1234..."; // Placeholder

    // 2. LOGIKA RECIPIENT
    let final_recipient = req.recipient.as_deref().unwrap_or(user_address);

    let amount_in: f64 = req.amount.parse()
        .map_err(|_| AppError::BadRequest("Invalid amount".to_string()))?;

    let aggregator = LiquidityAggregator::new(state.config.clone());
    let best_route = aggregator.get_best_quote(
        &req.from_token,
        &req.to_token,
        amount_in,
    ).await?;

    // 3. VALIDASI SLIPPAGE
    let expected_out = best_route.amount_out;
    let min_out: f64 = req.min_amount_out.parse()
        .map_err(|_| AppError::BadRequest("Invalid min amount".to_string()))?;

    if expected_out < min_out {
        return Err(AppError::BadRequest(
            format!("Slippage too high (Set: {}%). Min expected: {}, Market: {}", 
                req.slippage, min_out, expected_out)
        ));
    }

    // 4. GENERATE TX HASH MENGGUNAKAN HASHER (Membungkam warning di hash.rs)
    let tx_data = format!("{}{}{}{}{}", user_address, req.from_token, req.to_token, req.amount, now);
    let tx_hash = hash::hash_string(&tx_data);

    let base_fee = amount_in * 0.003;
    let mev_fee = if req.mode == "private" { amount_in * 0.0015 } else { 0.0 };
    let total_fee = base_fee + mev_fee;

    // Simpan ke database
    let tx = crate::models::Transaction {
        tx_hash: tx_hash.clone(),
        block_number: 0,
        user_address: user_address.to_string(),
        tx_type: "swap".to_string(),
        token_in: Some(req.from_token.clone()),
        token_out: Some(req.to_token.clone()),
        amount_in: Some(rust_decimal::Decimal::from_f64_retain(amount_in).unwrap()),
        amount_out: Some(rust_decimal::Decimal::from_f64_retain(expected_out).unwrap()),
        usd_value: Some(rust_decimal::Decimal::from_f64_retain(amount_in).unwrap()),
        fee_paid: Some(rust_decimal::Decimal::from_f64_retain(total_fee).unwrap()),
        points_earned: Some(rust_decimal::Decimal::from_f64_retain(amount_in * 10.0).unwrap()),
        timestamp: chrono::Utc::now(),
        processed: false,
    };

    state.db.save_transaction(&tx).await?;

    tracing::info!(
        "Swap success for {}: {} {} -> {} {}. Recipient: {}",
        user_address, amount_in, req.from_token, expected_out, req.to_token, final_recipient
    );

    Ok(Json(ApiResponse::success(ExecuteSwapResponse {
        tx_hash,
        status: "success".to_string(),
        from_amount: req.amount,
        to_amount: expected_out.to_string(),
        actual_rate: (expected_out / amount_in).to_string(),
        fee_paid: total_fee.to_string(),
    })))
}
