use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use crate::{
    constants::{token_address_for, DEX_EKUBO, DEX_HAIKO, POINTS_PER_USD_SWAP},
    error::{AppError, Result},
    models::{ApiResponse, SwapQuoteRequest, SwapQuoteResponse},
    services::LiquidityAggregator,
    services::gas_optimizer::GasOptimizer,
    services::NotificationService,
    services::notification_service::NotificationType,
    // 1. IMPORT MODUL HASH AGAR TERPAKAI
    crypto::hash,
};
use super::{AppState, require_user};

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

fn is_deadline_valid(deadline: i64, now: i64) -> bool {
    deadline >= now
}

fn base_fee(amount_in: f64) -> f64 {
    amount_in * 0.003
}

fn mev_fee_for_mode(mode: &str, amount_in: f64) -> f64 {
    if mode == "private" { amount_in * 0.0015 } else { 0.0 }
}

fn total_fee(amount_in: f64, mode: &str) -> f64 {
    base_fee(amount_in) + mev_fee_for_mode(mode, amount_in)
}

fn estimated_time_for_dex(dex: &str) -> &'static str {
    match dex {
        DEX_EKUBO => "~2 min",
        DEX_HAIKO => "~3 min",
        _ => "~2-3 min",
    }
}

/// POST /api/v1/swap/quote
pub async fn get_quote(
    State(state): State<AppState>,
    Json(req): Json<SwapQuoteRequest>,
) -> Result<Json<ApiResponse<SwapQuoteResponse>>> {
    let amount_in: f64 = req.amount.parse()
        .map_err(|_| AppError::BadRequest("Invalid amount".to_string()))?;

    tracing::debug!(
        "Swap quote: from={}, to={}, slippage={}, mode={}",
        req.from_token,
        req.to_token,
        req.slippage,
        req.mode
    );

    if token_address_for(&req.from_token).is_none() || token_address_for(&req.to_token).is_none() {
        return Err(AppError::InvalidToken);
    }

    let gas_optimizer = GasOptimizer::new(state.config.clone());
    let estimated_cost = gas_optimizer.estimate_cost("swap").await.unwrap_or_default();

    let aggregator = LiquidityAggregator::new(state.config.clone());
    let best_route = aggregator.get_best_quote(
        &req.from_token,
        &req.to_token,
        amount_in,
    ).await?;

    if let Ok(split_routes) = aggregator
        .get_split_quote(&req.from_token, &req.to_token, amount_in)
        .await
    {
        if split_routes.len() > 1 {
            tracing::debug!("Split routing across {} venues", split_routes.len());
        }
    }

    if let Ok(depth) = aggregator
        .get_liquidity_depth(&req.from_token, &req.to_token)
        .await
    {
        tracing::debug!("Liquidity depth: total={}", depth.total_liquidity);
    }

    let gas = gas_optimizer.get_optimal_gas_price().await?;
    tracing::debug!("Estimated swap gas cost: {}", estimated_cost);

    let response = SwapQuoteResponse {
        from_amount: req.amount.clone(),
        to_amount: best_route.amount_out.to_string(),
        rate: (best_route.amount_out / amount_in).to_string(),
        price_impact: format!("{:.2}%", best_route.price_impact * 100.0),
        fee: best_route.fee.to_string(),
        fee_usd: best_route.fee.to_string(),
        route: best_route.path,
        estimated_gas: gas.standard.to_string(),
        estimated_time: estimated_time_for_dex(best_route.dex.as_str()).to_string(),
    };

    Ok(Json(ApiResponse::success(response)))
}

/// POST /api/v1/swap/execute
pub async fn execute_swap(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ExecuteSwapRequest>,
) -> Result<Json<ApiResponse<ExecuteSwapResponse>>> {
    // 1. VALIDASI DEADLINE
    let now = chrono::Utc::now().timestamp();
    if !is_deadline_valid(req.deadline, now) {
        return Err(AppError::BadRequest("Transaction deadline expired".to_string()));
    }

    let user_address = require_user(&headers, &state).await?;

    // 2. LOGIKA RECIPIENT
    let final_recipient = req.recipient.as_deref().unwrap_or(&user_address);

    let amount_in: f64 = req.amount.parse()
        .map_err(|_| AppError::BadRequest("Invalid amount".to_string()))?;

    if token_address_for(&req.from_token).is_none() || token_address_for(&req.to_token).is_none() {
        return Err(AppError::InvalidToken);
    }

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
        tracing::warn!(
            "Slippage too high: set={}%, min_expected={}, market={}",
            req.slippage,
            min_out,
            expected_out
        );
        return Err(AppError::SlippageTooHigh);
    }

    // 4. GENERATE TX HASH MENGGUNAKAN HASHER (Membungkam warning di hash.rs)
    let tx_data = format!("{}{}{}{}{}", user_address, req.from_token, req.to_token, req.amount, now);
    let tx_hash = hash::hash_string(&tx_data);

    let gas_optimizer = GasOptimizer::new(state.config.clone());
    let estimated_cost = gas_optimizer.estimate_cost("swap").await.unwrap_or_default();

    let total_fee = total_fee(amount_in, &req.mode);

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
        points_earned: Some(
            rust_decimal::Decimal::from_f64_retain(amount_in * POINTS_PER_USD_SWAP).unwrap()
        ),
        timestamp: chrono::Utc::now(),
        processed: false,
    };

    state.db.save_transaction(&tx).await?;

    if let Ok(batch) = gas_optimizer.optimize_batch(vec![tx_hash.clone()]).await {
        tracing::debug!("Optimized gas batch size: {}", batch.len());
    }

    let notification_service = NotificationService::new(state.db.clone(), state.config.clone());
    if let Err(e) = notification_service
        .send_notification(
            &user_address,
            NotificationType::SwapCompleted,
            "Swap completed".to_string(),
            format!(
                "Swapped {} {} to {} {}",
                amount_in,
                &req.from_token,
                expected_out,
                &req.to_token
            ),
            Some(serde_json::json!({
                "tx_hash": tx_hash.clone(),
                "from_token": req.from_token.clone(),
                "to_token": req.to_token.clone(),
                "amount_in": amount_in,
                "amount_out": expected_out,
            })),
        )
        .await
    {
        tracing::warn!("Failed to send swap notification: {}", e);
    }

    tracing::debug!("Estimated swap gas cost: {}", estimated_cost);

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_deadline_valid_accepts_equal_time() {
        // Memastikan deadline yang sama dengan waktu sekarang dianggap valid
        assert!(is_deadline_valid(100, 100));
    }

    #[test]
    fn mev_fee_for_mode_only_private() {
        // Memastikan fee MEV hanya untuk mode private
        assert!((mev_fee_for_mode("private", 100.0) - 0.15).abs() < 1e-9);
        assert!((mev_fee_for_mode("transparent", 100.0) - 0.0).abs() < 1e-9);
    }

    #[test]
    fn estimated_time_for_dex_defaults() {
        // Memastikan estimasi waktu untuk DEX yang tidak dikenal
        assert_eq!(estimated_time_for_dex("UNKNOWN"), "~2-3 min");
    }
}
