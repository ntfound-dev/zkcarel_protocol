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
use starknet_core::types::{Call, Felt};
use starknet_core::utils::get_selector_from_name;

use super::{AppState, require_user};

#[derive(Debug, Deserialize)]
pub struct PrivacyVerificationPayload {
    pub nullifier: Option<String>,
    pub commitment: Option<String>,
    pub proof: Option<Vec<String>>,
    pub public_inputs: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct ExecuteBridgeRequest {
    pub from_chain: String,
    pub to_chain: String,
    pub token: String,
    pub amount: String,
    pub recipient: String,
    pub xverse_user_id: Option<String>,
    pub onchain_tx_hash: Option<String>,
    pub mode: Option<String>,
    pub hide_balance: Option<bool>,
    pub privacy: Option<PrivacyVerificationPayload>,
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

fn build_bridge_tx_hash(user_address: &str, from_chain: &str, to_chain: &str, amount: &str) -> String {
    let bridge_data = format!("{}{}{}{}", user_address, from_chain, to_chain, amount);
    hash::hash_string(&bridge_data)
}

fn build_bridge_id(tx_hash: &str) -> String {
    let short = tx_hash.strip_prefix("0x").unwrap_or(tx_hash);
    let suffix = if short.len() >= 12 { &short[..12] } else { short };
    format!("BR_{}", suffix)
}

fn normalize_onchain_tx_hash(tx_hash: Option<&str>) -> std::result::Result<Option<String>, crate::error::AppError> {
    let Some(raw) = tx_hash.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None)
    };
    if !raw.starts_with("0x") {
        return Err(crate::error::AppError::BadRequest(
            "onchain_tx_hash must start with 0x".to_string(),
        ))
    }
    if raw.len() > 66 {
        return Err(crate::error::AppError::BadRequest(
            "onchain_tx_hash exceeds maximum length (66)".to_string(),
        ))
    }
    if !raw[2..].chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(crate::error::AppError::BadRequest(
            "onchain_tx_hash must be hex-encoded".to_string(),
        ))
    }
    Ok(Some(raw.to_ascii_lowercase()))
}

fn is_private_trade(mode: Option<&str>, hide_balance: bool) -> bool {
    let _ = hide_balance;
    mode.unwrap_or_default().eq_ignore_ascii_case("private")
}

fn resolve_privacy_inputs(
    seed: &str,
    payload: Option<&PrivacyVerificationPayload>,
) -> (String, String, Vec<String>, Vec<String>) {
    let nullifier = payload
        .and_then(|item| item.nullifier.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| seed.to_string());
    let commitment = payload
        .and_then(|item| item.commitment.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| hash::hash_string(&format!("commitment:{seed}")));
    let proof = payload
        .and_then(|item| item.proof.clone())
        .filter(|items| !items.is_empty())
        .unwrap_or_else(|| vec![seed.to_string()]);
    let public_inputs = payload
        .and_then(|item| item.public_inputs.clone())
        .filter(|items| !items.is_empty())
        .unwrap_or_else(|| vec![commitment.clone()]);
    (nullifier, commitment, proof, public_inputs)
}

async fn verify_private_trade_with_garaga(
    state: &AppState,
    seed: &str,
    payload: Option<&PrivacyVerificationPayload>,
) -> Result<String> {
    let router = state.config.zk_privacy_router_address.trim();
    if router.is_empty() || router.starts_with("0x0000") {
        return Err(crate::error::AppError::BadRequest(
            "ZK privacy router (Garaga) is not configured".to_string(),
        ));
    }
    let Some(invoker) = OnchainInvoker::from_config(&state.config).ok().flatten() else {
        return Err(crate::error::AppError::BadRequest(
            "On-chain invoker is not configured for Garaga verification".to_string(),
        ));
    };
    let (nullifier, commitment, proof, public_inputs) = resolve_privacy_inputs(seed, payload);

    let to = parse_felt(router)?;
    let selector = get_selector_from_name("submit_private_action")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    let mut calldata = vec![parse_felt(&nullifier)?, parse_felt(&commitment)?];
    calldata.push(Felt::from(proof.len() as u64));
    for item in proof {
        calldata.push(parse_felt(&item)?);
    }
    calldata.push(Felt::from(public_inputs.len() as u64));
    for item in public_inputs {
        calldata.push(parse_felt(&item)?);
    }
    let tx_hash = invoker.invoke(Call { to, selector, calldata }).await?;
    Ok(tx_hash.to_string())
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

    let onchain_tx_hash = normalize_onchain_tx_hash(req.onchain_tx_hash.as_deref())?;
    let is_user_signed_onchain = onchain_tx_hash.is_some();
    let should_hide = is_private_trade(req.mode.as_deref(), req.hide_balance.unwrap_or(false));

    // Keep DB tx_hash within varchar(66), while exposing a human-friendly bridge_id.
    let tx_hash = onchain_tx_hash
        .unwrap_or_else(|| build_bridge_tx_hash(&user_address, &req.from_chain, &req.to_chain, &req.amount));
    let mut bridge_id = build_bridge_id(&tx_hash);
    let mut privacy_verification_tx: Option<String> = None;
    if should_hide {
        let privacy_tx = verify_private_trade_with_garaga(&state, &tx_hash, req.privacy.as_ref())
            .await
            .map_err(|e| crate::error::AppError::BadRequest(format!(
                "Garaga privacy verification failed: {}",
                e
            )))?;
        privacy_verification_tx = Some(privacy_tx);
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

    let estimated_receive = best_route.amount_out;

    let tx = crate::models::Transaction {
        tx_hash: tx_hash.clone(),
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
    if should_hide {
        state.db.mark_transaction_private(&tx_hash).await?;
    }

    if is_user_signed_onchain {
        let response = ExecuteBridgeResponse {
            bridge_id: tx_hash.clone(),
            status: "submitted_onchain".to_string(),
            from_chain: req.from_chain,
            to_chain: req.to_chain,
            amount: req.amount,
            estimated_receive: estimated_receive.to_string(),
            estimated_time: estimate_time(best_route.provider.as_str()).to_string(),
        };
        return Ok(Json(ApiResponse::success(response)));
    }

    // MENGGUNAKAN 'recipient' agar tidak dead_code
    tracing::info!(
        "Bridge initiated to {}: {} {} from {} to {} (id: {}, privacy={:?})",
        recipient,
        amount,
        req.token,
        req.from_chain,
        req.to_chain,
        bridge_id,
        privacy_verification_tx
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
    fn build_bridge_tx_hash_is_66_chars() {
        let tx_hash = build_bridge_tx_hash("0xabc", "eth", "starknet", "10");
        assert!(tx_hash.starts_with("0x"));
        assert_eq!(tx_hash.len(), 66);
    }

    #[test]
    fn build_bridge_id_uses_short_hash_prefix() {
        let id = build_bridge_id("0x1234567890abcdef");
        assert_eq!(id, "BR_1234567890ab");
    }
}
