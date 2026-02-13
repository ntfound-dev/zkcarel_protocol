use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};

use crate::services::onchain::{parse_felt, OnchainInvoker};
use crate::{
    constants::{
        token_address_for, BRIDGE_ATOMIQ, BRIDGE_GARDEN, BRIDGE_LAYERSWAP, BRIDGE_STARKGATE,
    },
    // Mengimpor hasher untuk menghilangkan warning unused di crypto/hash.rs
    crypto::hash,
    error::Result,
    integrations::bridge::{
        AtomiqClient, AtomiqQuote, GardenClient, GardenQuote, LayerSwapClient, LayerSwapQuote,
    },
    models::{ApiResponse, BridgeQuoteRequest, BridgeQuoteResponse},
    services::RouteOptimizer,
};
use starknet_core::types::{Call, Felt};
use starknet_core::utils::get_selector_from_name;

use super::{require_user, AppState};

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
    pub to_token: Option<String>,
    pub estimated_out_amount: Option<String>,
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

fn fallback_price_for(token: &str) -> f64 {
    match token.to_ascii_uppercase().as_str() {
        "BTC" | "WBTC" => 65_000.0,
        "ETH" => 1_900.0,
        "STRK" => 0.05,
        "USDT" | "USDC" => 1.0,
        "CAREL" => 1.0,
        _ => 0.0,
    }
}

async fn latest_price_usd(state: &AppState, token: &str) -> Result<f64> {
    let symbol = token.to_ascii_uppercase();
    let price: Option<f64> = sqlx::query_scalar(
        "SELECT close::FLOAT FROM price_history WHERE token = $1 ORDER BY timestamp DESC LIMIT 1",
    )
    .bind(&symbol)
    .fetch_optional(state.db.pool())
    .await?;
    Ok(price.unwrap_or_else(|| fallback_price_for(&symbol)))
}

fn build_bridge_id(tx_hash: &str) -> String {
    let short = tx_hash.strip_prefix("0x").unwrap_or(tx_hash);
    let suffix = if short.len() >= 12 {
        &short[..12]
    } else {
        short
    };
    format!("BR_{}", suffix)
}

fn normalize_bridge_onchain_tx_hash(
    tx_hash: Option<&str>,
    from_chain: &str,
) -> std::result::Result<String, crate::error::AppError> {
    let raw = tx_hash
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| {
            crate::error::AppError::BadRequest(
                "Bridge requires onchain_tx_hash from user-signed transaction".to_string(),
            )
        })?;
    let from_chain_normalized = from_chain.trim().to_ascii_lowercase();
    let body = raw.strip_prefix("0x").unwrap_or(raw);
    if body.is_empty() || body.len() > 64 || !body.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(crate::error::AppError::BadRequest(
            "onchain_tx_hash must be hex-encoded and max 64 chars (without 0x)".to_string(),
        ));
    }

    if from_chain_normalized == "bitcoin" || from_chain_normalized == "btc" {
        // Store BTC txid in explorer-friendly format (no 0x).
        return Ok(body.to_ascii_lowercase());
    }

    Ok(format!("0x{}", body.to_ascii_lowercase()))
}

fn privacy_seed_from_tx_hash(tx_hash: &str) -> String {
    let raw = tx_hash.trim();
    if raw.starts_with("0x")
        && raw.len() <= 66
        && raw.len() > 2
        && raw[2..].chars().all(|c| c.is_ascii_hexdigit())
    {
        return raw.to_ascii_lowercase();
    }
    let body = raw.strip_prefix("0x").unwrap_or(raw);
    if !body.is_empty() && body.len() <= 64 && body.chars().all(|c| c.is_ascii_hexdigit()) {
        return format!("0x{}", body.to_ascii_lowercase());
    }
    hash::hash_string(raw)
}

fn is_private_trade(mode: Option<&str>, hide_balance: bool) -> bool {
    hide_balance || mode.unwrap_or_default().eq_ignore_ascii_case("private")
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
    let tx_hash = invoker
        .invoke(Call {
            to,
            selector,
            calldata,
        })
        .await?;
    Ok(tx_hash.to_string())
}

/// POST /api/v1/bridge/quote
pub async fn get_bridge_quote(
    State(state): State<AppState>,
    Json(req): Json<BridgeQuoteRequest>,
) -> Result<Json<ApiResponse<BridgeQuoteResponse>>> {
    let amount: f64 = req
        .amount
        .parse()
        .map_err(|_| crate::error::AppError::BadRequest("Invalid amount".to_string()))?;

    if token_address_for(&req.token).is_none() {
        return Err(crate::error::AppError::InvalidToken);
    }
    let optimizer = RouteOptimizer::new(state.config.clone());
    let best_route = optimizer
        .find_best_bridge_route(&req.from_chain, &req.to_chain, &req.token, amount)
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
    let from_chain_normalized = req.from_chain.trim().to_ascii_lowercase();

    let mut recipient = req.recipient.clone();
    if recipient.trim().is_empty() {
        if let Some(user_id) = req.xverse_user_id.as_ref() {
            let client = crate::integrations::xverse::XverseClient::new(
                state.config.xverse_api_url.clone(),
                state.config.xverse_api_key.clone(),
            );
            if let Some(addr) = client.get_btc_address(user_id).await.map_err(|e| {
                crate::error::AppError::BadRequest(format!("Xverse lookup failed: {}", e))
            })? {
                recipient = addr;
            } else {
                return Err(crate::error::AppError::BadRequest(
                    "Xverse address not found".into(),
                ));
            }
        }
    }
    if recipient.trim().is_empty() {
        return Err(crate::error::AppError::BadRequest(
            "Recipient is required".into(),
        ));
    }

    let amount: f64 = req
        .amount
        .parse()
        .map_err(|_| crate::error::AppError::BadRequest("Invalid amount".to_string()))?;

    if token_address_for(&req.token).is_none() {
        return Err(crate::error::AppError::InvalidToken);
    }
    if let Some(to_token) = req.to_token.as_deref() {
        if token_address_for(to_token).is_none() {
            return Err(crate::error::AppError::BadRequest(
                "Invalid to_token".to_string(),
            ));
        }
    }

    let tx_hash =
        normalize_bridge_onchain_tx_hash(req.onchain_tx_hash.as_deref(), &req.from_chain)?;
    let should_hide = is_private_trade(req.mode.as_deref(), req.hide_balance.unwrap_or(false));

    // Keep DB tx_hash within varchar(66), while exposing a human-friendly bridge_id.
    let mut bridge_id = build_bridge_id(&tx_hash);
    let mut privacy_verification_tx: Option<String> = None;
    if should_hide {
        let privacy_seed = privacy_seed_from_tx_hash(&tx_hash);
        let privacy_tx =
            verify_private_trade_with_garaga(&state, &privacy_seed, req.privacy.as_ref())
                .await
                .map_err(|e| {
                    crate::error::AppError::BadRequest(format!(
                        "Garaga privacy verification failed: {}",
                        e
                    ))
                })?;
        privacy_verification_tx = Some(privacy_tx);
    }

    let optimizer = RouteOptimizer::new(state.config.clone());
    let best_route = optimizer
        .find_best_bridge_route(&req.from_chain, &req.to_chain, &req.token, amount)
        .await?;

    let estimated_receive = if let Some(raw) = req.estimated_out_amount.as_deref() {
        raw.parse::<f64>().unwrap_or(best_route.amount_out)
    } else {
        best_route.amount_out
    };
    let to_token = req
        .to_token
        .as_deref()
        .unwrap_or(req.token.as_str())
        .trim()
        .to_ascii_uppercase();
    let from_token = req.token.trim().to_ascii_uppercase();
    let token_price = latest_price_usd(&state, &from_token).await?;
    let volume_usd = amount * token_price;

    let tx = crate::models::Transaction {
        tx_hash: tx_hash.clone(),
        block_number: 0,
        user_address: user_address.to_string(),
        tx_type: "bridge".to_string(),
        token_in: Some(from_token),
        token_out: Some(to_token),
        amount_in: Some(rust_decimal::Decimal::from_f64_retain(amount).unwrap()),
        amount_out: Some(rust_decimal::Decimal::from_f64_retain(estimated_receive).unwrap()),
        usd_value: Some(rust_decimal::Decimal::from_f64_retain(volume_usd).unwrap()),
        fee_paid: Some(rust_decimal::Decimal::from_f64_retain(best_route.fee).unwrap()),
        points_earned: Some(rust_decimal::Decimal::ZERO),
        timestamp: chrono::Utc::now(),
        processed: false,
    };

    state.db.save_transaction(&tx).await?;
    if should_hide {
        state.db.mark_transaction_private(&tx_hash).await?;
    }

    let is_direct_user_settlement =
        from_chain_normalized == "ethereum" || from_chain_normalized == "starknet";
    if is_direct_user_settlement {
        let mut response_provider = best_route.provider.as_str();
        // Ethereum -> Starknet flow is signed in user wallet via StarkGate.
        // Mirror it into bridge aggregator so on-chain CAREL accounting still runs.
        if from_chain_normalized == "ethereum" {
            response_provider = BRIDGE_STARKGATE;
            if let Err(err) = invoke_bridge_aggregator(
                &state,
                BRIDGE_STARKGATE,
                amount,
                best_route.fee,
                best_route.estimated_time_minutes,
            )
            .await
            {
                tracing::warn!("Bridge aggregator mirror invoke failed: {}", err);
            }
        }
        let response = ExecuteBridgeResponse {
            bridge_id: tx_hash.clone(),
            status: "submitted_onchain".to_string(),
            from_chain: req.from_chain,
            to_chain: req.to_chain,
            amount: req.amount,
            estimated_receive: estimated_receive.to_string(),
            estimated_time: estimate_time(response_provider).to_string(),
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

    let provider_id = state
        .config
        .bridge_provider_id_for(provider)
        .or_else(|| default_bridge_provider_id(provider).map(str::to_string));
    let Some(provider_id) = provider_id else {
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

    let call = Call {
        to,
        selector,
        calldata,
    };
    let _ = invoker.invoke(call).await?;
    Ok(())
}

fn default_bridge_provider_id(provider: &str) -> Option<&'static str> {
    if provider.eq_ignore_ascii_case(BRIDGE_LAYERSWAP) {
        return Some("0x4c535750"); // LSWP
    }
    if provider.eq_ignore_ascii_case(BRIDGE_ATOMIQ) {
        return Some("0x41544d51"); // ATMQ
    }
    if provider.eq_ignore_ascii_case(BRIDGE_GARDEN) {
        return Some("0x47415244"); // GARD
    }
    if provider.eq_ignore_ascii_case(BRIDGE_STARKGATE) {
        return Some("0x53544754"); // STGT
    }
    None
}

fn to_u256_felt(value: f64) -> Result<(starknet_core::types::Felt, starknet_core::types::Felt)> {
    let scaled = (value * 1e18_f64).round();
    let as_u128 = scaled as u128;
    Ok((
        starknet_core::types::Felt::from(as_u128),
        starknet_core::types::Felt::from(0_u128),
    ))
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
    fn build_bridge_id_uses_short_hash_prefix() {
        let id = build_bridge_id("0x1234567890abcdef");
        assert_eq!(id, "BR_1234567890ab");
    }

    #[test]
    fn normalize_bridge_hash_accepts_btc_txid_without_prefix() {
        let txid = "fa28fab8ae02404513796fbb4674347bff278e8806c8f5d29fecff534e94a07d";
        let normalized = normalize_bridge_onchain_tx_hash(Some(txid), "bitcoin")
            .expect("btc tx hash should be valid");
        assert_eq!(normalized, txid);
    }

    #[test]
    fn normalize_bridge_hash_prefixes_non_btc() {
        let txid = "185243a4591a33171141926dd90aa9c8a8100807dc6f0b7f42b19f261a0cd383";
        let normalized = normalize_bridge_onchain_tx_hash(Some(txid), "ethereum")
            .expect("evm tx hash should be valid");
        assert_eq!(normalized, format!("0x{}", txid));
    }
}
