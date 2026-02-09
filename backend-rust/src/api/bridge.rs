use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};

use crate::{
    constants::{token_address_for, BRIDGE_ATOMIQ, BRIDGE_LAYERSWAP, BRIDGE_STARKGATE, BRIDGE_GARDEN, POINTS_PER_USD_BRIDGE},
    error::Result,
    models::{ApiResponse, BridgeQuoteRequest, BridgeQuoteResponse},
    services::RouteOptimizer,
    integrations::bridge::{LayerSwapClient, LayerSwapQuote, AtomiqClient, AtomiqQuote, GardenClient, GardenQuote},
    // Mengimpor hasher untuk menghilangkan warning unused di crypto/hash.rs
    crypto::hash,
};
use crate::services::onchain::{OnchainInvoker, parse_felt};
use starknet_core::types::Call;
use starknet_core::utils::get_selector_from_name;

use super::{AppState, require_user};

#[derive(Debug, Deserialize)]
pub struct ExecuteBridgeRequest {
    pub from_chain: String,
    pub to_chain: String,
    pub token: String,
    pub amount: String,
    pub recipient: String,
    pub xverse_user_id: Option<String>,
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
        BRIDGE_GARDEN => "~25-35 min",
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

    let mut recipient = req.recipient.clone();
    if recipient.trim().is_empty() {
        if let Some(user_id) = req.xverse_user_id.as_ref() {
            let client = crate::integrations::xverse::XverseClient::new(
                state.config.xverse_api_url.clone(),
                state.config.xverse_api_key.clone(),
            );
            if let Some(addr) = client
                .get_btc_address(user_id)
                .await
                .map_err(|e| crate::error::AppError::BadRequest(format!("Xverse lookup failed: {}", e)))?
            {
                recipient = addr;
            } else {
                return Err(crate::error::AppError::BadRequest("Xverse address not found".into()));
            }
        }
    }
    if recipient.trim().is_empty() {
        return Err(crate::error::AppError::BadRequest("Recipient is required".into()));
    }

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
        recipient,
        amount,
        req.token,
        req.from_chain,
        req.to_chain,
        bridge_id
    );

    if best_route.provider.as_str() == BRIDGE_LAYERSWAP {
        let client = LayerSwapClient::new(
            state.config.layerswap_api_key.clone().unwrap_or_default(),
            state.config.layerswap_api_url.clone(),
        );
        let quote = LayerSwapQuote {
            from_chain: req.from_chain.clone(),
            to_chain: req.to_chain.clone(),
            token: req.token.clone(),
            amount_in: amount,
            amount_out: estimated_receive,
            fee: best_route.fee,
            estimated_time_minutes: 15,
        };
        if let Ok(id) = client.execute_bridge(&quote, &recipient).await {
            bridge_id = id;
        }
    } else if best_route.provider.as_str() == BRIDGE_ATOMIQ {
        let client = AtomiqClient::new(
            state.config.atomiq_api_key.clone().unwrap_or_default(),
            state.config.atomiq_api_url.clone(),
        );
        let quote = AtomiqQuote {
            from_chain: req.from_chain.clone(),
            to_chain: req.to_chain.clone(),
            token: req.token.clone(),
            amount_in: amount,
            amount_out: estimated_receive,
            fee: best_route.fee,
            estimated_time_minutes: 20,
        };
        if let Ok(id) = client.execute_bridge(&quote, &recipient).await {
            bridge_id = id;
        }
    } else if best_route.provider.as_str() == BRIDGE_GARDEN {
        let client = GardenClient::new(
            state.config.garden_api_key.clone().unwrap_or_default(),
            state.config.garden_api_url.clone(),
        );
        let quote = GardenQuote {
            from_chain: req.from_chain.clone(),
            to_chain: req.to_chain.clone(),
            token: req.token.clone(),
            amount_in: amount,
            amount_out: estimated_receive,
            fee: best_route.fee,
            estimated_time_minutes: 30,
        };
        if let Ok(id) = client.execute_bridge(&quote, &recipient).await {
            bridge_id = id;
        }
    }

    if let Err(err) = invoke_bridge_aggregator(
        &state,
        &best_route.provider,
        amount,
        best_route.fee,
        best_route.estimated_time_minutes,
    )
    .await
    {
        tracing::warn!("Bridge aggregator invoke failed: {}", err);
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

async fn invoke_bridge_aggregator(
    state: &AppState,
    provider: &str,
    amount: f64,
    fee: f64,
    estimated_time_minutes: u32,
) -> Result<()> {
    let aggregator = state.config.bridge_aggregator_address.trim();
    if aggregator.is_empty() || aggregator.starts_with("0x0000") {
        return Ok(());
    }

    let Some(provider_id) = state.config.bridge_provider_id_for(provider) else {
        return Ok(());
    };

    let Some(invoker) = OnchainInvoker::from_config(&state.config).ok().flatten() else {
        return Ok(());
    };

    let to = parse_felt(aggregator)?;
    let selector = get_selector_from_name("execute_bridge")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;

    let provider_felt = parse_felt(&provider_id)?;
    let total_cost = to_u256_felt(fee)?;
    let amount_u256 = to_u256_felt(amount)?;
    let estimated_time = starknet_core::types::Felt::from(estimated_time_minutes as u64);

    let calldata = vec![
        provider_felt,
        total_cost.0,
        total_cost.1,
        estimated_time,
        amount_u256.0,
        amount_u256.1,
    ];

    let call = Call { to, selector, calldata };
    let _ = invoker.invoke(call).await?;
    Ok(())
}

fn to_u256_felt(value: f64) -> Result<(starknet_core::types::Felt, starknet_core::types::Felt)> {
    let scaled = (value * 1e18_f64).round();
    let as_u128 = scaled as u128;
    Ok((starknet_core::types::Felt::from(as_u128), starknet_core::types::Felt::from(0_u128)))
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
