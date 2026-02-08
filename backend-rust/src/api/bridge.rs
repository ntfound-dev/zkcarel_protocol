use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};

use crate::{
    constants::{token_address_for, BRIDGE_ATOMIQ, BRIDGE_LAYERSWAP, BRIDGE_STARKGATE, POINTS_PER_USD_BRIDGE},
    error::Result,
    models::{ApiResponse, BridgeQuoteRequest, BridgeQuoteResponse},
    services::RouteOptimizer,
    integrations::bridge::LayerSwapClient,
    integrations::bridge::LayerSwapQuote,
    // Mengimpor hasher untuk menghilangkan warning unused di crypto/hash.rs
    crypto::hash,
};

use super::{AppState, require_user};

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

fn estimate_time(provider: &str) -> &'static str {
    match provider {
        BRIDGE_LAYERSWAP => "~15-20 min",
        BRIDGE_STARKGATE => "~10-15 min",
        BRIDGE_ATOMIQ => "~20-30 min",
        _ => "~15-20 min",
    }
}

fn build_bridge_id(user_address: &str, from_chain: &str, to_chain: &str, amount: &str) -> String {
    let bridge_data = format!("{}{}{}{}", user_address, from_chain, to_chain, amount);
    format!("BR_{}", hash::hash_string(&bridge_data))
}

/// POST /api/v1/bridge/quote
pub async fn get_bridge_quote(
    State(state): State<AppState>,
    Json(req): Json<BridgeQuoteRequest>,
) -> Result<Json<ApiResponse<BridgeQuoteResponse>>> {
    let amount: f64 = req.amount.parse()
        .map_err(|_| crate::error::AppError::BadRequest("Invalid amount".to_string()))?;

    if token_address_for(&req.token).is_none() {
        return Err(crate::error::AppError::InvalidToken);
    }

    let optimizer = RouteOptimizer::new(state.config.clone());
    let best_route = optimizer
        .find_best_bridge_route(
            &req.from_chain,
            &req.to_chain,
            &req.token,
            amount,
        )
        .await?;

    let provider = best_route.provider.as_str();
    let bridge_fee = best_route.fee;
    let estimated_receive = best_route.amount_out;
    let estimated_time = estimate_time(provider);

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
    headers: HeaderMap,
    Json(req): Json<ExecuteBridgeRequest>,
) -> Result<Json<ApiResponse<ExecuteBridgeResponse>>> {
    let user_address = require_user(&headers, &state).await?;

    let amount: f64 = req.amount.parse()
        .map_err(|_| crate::error::AppError::BadRequest("Invalid amount".to_string()))?;

    if token_address_for(&req.token).is_none() {
        return Err(crate::error::AppError::InvalidToken);
    }

    // MENGGUNAKAN crypto::hash di sini agar warning di hash.rs hilang
    let mut bridge_id = build_bridge_id(&user_address, &req.from_chain, &req.to_chain, &req.amount);

    let optimizer = RouteOptimizer::new(state.config.clone());
    let best_route = optimizer
        .find_best_bridge_route(
            &req.from_chain,
            &req.to_chain,
            &req.token,
            amount,
        )
        .await?;

    let estimated_receive = best_route.amount_out;

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
        fee_paid: Some(rust_decimal::Decimal::from_f64_retain(best_route.fee).unwrap()),
        points_earned: Some(
            rust_decimal::Decimal::from_f64_retain(amount * POINTS_PER_USD_BRIDGE).unwrap()
        ),
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

    if best_route.provider.as_str() == BRIDGE_LAYERSWAP {
        let client = LayerSwapClient::new(String::new());
        let quote = LayerSwapQuote {
            from_chain: req.from_chain.clone(),
            to_chain: req.to_chain.clone(),
            token: req.token.clone(),
            amount_in: amount,
            amount_out: estimated_receive,
            fee: best_route.fee,
            estimated_time_minutes: 15,
        };
        if let Ok(id) = client.execute_bridge(&quote, &req.recipient).await {
            bridge_id = id;
        }
    }

    let response = ExecuteBridgeResponse {
        bridge_id,
        status: "pending".to_string(),
        from_chain: req.from_chain,
        to_chain: req.to_chain,
        amount: req.amount,
        estimated_receive: estimated_receive.to_string(),
        estimated_time: estimate_time(best_route.provider.as_str()).to_string(),
    };

    Ok(Json(ApiResponse::success(response)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estimate_time_maps_providers() {
        // Memastikan estimasi waktu sesuai provider
        assert_eq!(estimate_time(BRIDGE_LAYERSWAP), "~15-20 min");
        assert_eq!(estimate_time(BRIDGE_STARKGATE), "~10-15 min");
        assert_eq!(estimate_time(BRIDGE_ATOMIQ), "~20-30 min");
        assert_eq!(estimate_time("Unknown"), "~15-20 min");
    }

    #[test]
    fn build_bridge_id_is_deterministic() {
        // Memastikan format bridge_id konsisten
        let id = build_bridge_id("0xabc", "eth", "starknet", "10");
        let expected = format!("BR_{}", hash::hash_string("0xabcethstarknet10"));
        assert_eq!(id, expected);
        assert!(id.starts_with("BR_0x"));
    }
}
