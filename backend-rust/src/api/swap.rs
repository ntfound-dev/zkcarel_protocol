use super::{require_starknet_user, AppState};
use crate::services::onchain::{parse_felt, OnchainInvoker};
use crate::{
    constants::{token_address_for, DEX_EKUBO, DEX_HAIKO},
    // 1. IMPORT MODUL HASH AGAR TERPAKAI
    crypto::hash,
    error::{AppError, Result},
    models::{ApiResponse, SwapQuoteRequest, SwapQuoteResponse},
    services::gas_optimizer::GasOptimizer,
    services::notification_service::NotificationType,
    services::LiquidityAggregator,
    services::NotificationService,
};
use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use starknet_core::types::{Call, Felt};
use starknet_core::utils::get_selector_from_name;

#[derive(Debug, Deserialize)]
pub struct PrivacyVerificationPayload {
    pub nullifier: Option<String>,
    pub commitment: Option<String>,
    pub proof: Option<Vec<String>>,
    pub public_inputs: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct ExecuteSwapRequest {
    pub from_token: String,
    pub to_token: String,
    pub amount: String,
    pub min_amount_out: String,
    pub slippage: f64,
    pub deadline: i64,
    pub recipient: Option<String>,
    pub onchain_tx_hash: Option<String>,
    pub hide_balance: Option<bool>,
    pub privacy: Option<PrivacyVerificationPayload>,
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
    if mode == "private" {
        amount_in * 0.01
    } else {
        0.0
    }
}

fn total_fee(amount_in: f64, mode: &str) -> f64 {
    base_fee(amount_in) + mev_fee_for_mode(mode, amount_in)
}

fn normalize_usd_volume(usd_in: f64, usd_out: f64) -> f64 {
    let in_valid = usd_in.is_finite() && usd_in > 0.0;
    let out_valid = usd_out.is_finite() && usd_out > 0.0;
    match (in_valid, out_valid) {
        (true, true) => (usd_in + usd_out) / 2.0,
        (true, false) => usd_in,
        (false, true) => usd_out,
        (false, false) => 0.0,
    }
}

fn is_private_trade(mode: &str, hide_balance: bool) -> bool {
    hide_balance || mode.eq_ignore_ascii_case("private")
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

fn estimated_time_for_dex(dex: &str) -> &'static str {
    match dex {
        DEX_EKUBO => "~2 min",
        DEX_HAIKO => "~3 min",
        _ => "~2-3 min",
    }
}

fn normalize_onchain_tx_hash(tx_hash: Option<&str>) -> Result<Option<String>> {
    let Some(raw) = tx_hash.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    if !raw.starts_with("0x") {
        return Err(AppError::BadRequest(
            "onchain_tx_hash must start with 0x".to_string(),
        ));
    }
    if raw.len() > 66 {
        return Err(AppError::BadRequest(
            "onchain_tx_hash exceeds maximum length (66)".to_string(),
        ));
    }
    if !raw[2..].chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::BadRequest(
            "onchain_tx_hash must be hex-encoded".to_string(),
        ));
    }
    Ok(Some(raw.to_ascii_lowercase()))
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
        return Err(AppError::BadRequest(
            "ZK privacy router (Garaga) is not configured".to_string(),
        ));
    }
    let Some(invoker) = OnchainInvoker::from_config(&state.config).ok().flatten() else {
        return Err(AppError::BadRequest(
            "On-chain invoker is not configured for Garaga verification".to_string(),
        ));
    };

    let (nullifier, commitment, proof, public_inputs) = resolve_privacy_inputs(seed, payload);

    let to = parse_felt(router)?;
    let selector = get_selector_from_name("submit_private_action")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;

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

/// POST /api/v1/swap/quote
pub async fn get_quote(
    State(state): State<AppState>,
    Json(req): Json<SwapQuoteRequest>,
) -> Result<Json<ApiResponse<SwapQuoteResponse>>> {
    let amount_in: f64 = req
        .amount
        .parse()
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
    let estimated_cost = gas_optimizer
        .estimate_cost("swap")
        .await
        .unwrap_or_default();

    let aggregator = LiquidityAggregator::new(state.config.clone());
    let best_route = aggregator
        .get_best_quote(&req.from_token, &req.to_token, amount_in)
        .await?;

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
        return Err(AppError::BadRequest(
            "Transaction deadline expired".to_string(),
        ));
    }

    let user_address = require_starknet_user(&headers, &state).await?;

    // 2. LOGIKA RECIPIENT
    let final_recipient = req.recipient.as_deref().unwrap_or(&user_address);

    let amount_in: f64 = req
        .amount
        .parse()
        .map_err(|_| AppError::BadRequest("Invalid amount".to_string()))?;

    if token_address_for(&req.from_token).is_none() || token_address_for(&req.to_token).is_none() {
        return Err(AppError::InvalidToken);
    }

    let aggregator = LiquidityAggregator::new(state.config.clone());
    let best_route = aggregator
        .get_best_quote(&req.from_token, &req.to_token, amount_in)
        .await?;

    // 3. VALIDASI SLIPPAGE
    let expected_out = best_route.amount_out;
    let min_out: f64 = req
        .min_amount_out
        .parse()
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

    let onchain_tx_hash = normalize_onchain_tx_hash(req.onchain_tx_hash.as_deref())?;
    let onchain_tx_hash = onchain_tx_hash.ok_or_else(|| {
        AppError::BadRequest(
            "Swap requires onchain_tx_hash. Frontend must submit user-signed Starknet tx."
                .to_string(),
        )
    })?;
    let is_user_signed_onchain = true;
    let should_hide = is_private_trade(&req.mode, req.hide_balance.unwrap_or(false));

    // 4. Use wallet-submitted onchain tx hash when available; otherwise fallback.
    let tx_hash = onchain_tx_hash;

    let mut privacy_verification_tx: Option<String> = None;
    if should_hide {
        let privacy_tx = verify_private_trade_with_garaga(&state, &tx_hash, req.privacy.as_ref())
            .await
            .map_err(|e| {
                AppError::BadRequest(format!("Garaga privacy verification failed: {}", e))
            })?;
        privacy_verification_tx = Some(privacy_tx);
    }

    let gas_optimizer = GasOptimizer::new(state.config.clone());
    let estimated_cost = gas_optimizer
        .estimate_cost("swap")
        .await
        .unwrap_or_default();

    let total_fee = total_fee(amount_in, &req.mode);
    let from_price = latest_price_usd(&state, &req.from_token).await?;
    let to_price = latest_price_usd(&state, &req.to_token).await?;
    let volume_usd = normalize_usd_volume(amount_in * from_price, expected_out * to_price);

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
        usd_value: Some(rust_decimal::Decimal::from_f64_retain(volume_usd).unwrap_or_default()),
        fee_paid: Some(rust_decimal::Decimal::from_f64_retain(total_fee).unwrap()),
        points_earned: Some(rust_decimal::Decimal::ZERO),
        timestamp: chrono::Utc::now(),
        processed: false,
    };

    state.db.save_transaction(&tx).await?;
    if should_hide {
        state.db.mark_transaction_private(&tx_hash).await?;
    }

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
                amount_in, &req.from_token, expected_out, &req.to_token
            ),
            Some(serde_json::json!({
                "tx_hash": tx_hash.clone(),
                "privacy_tx_hash": privacy_verification_tx,
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
        user_address,
        amount_in,
        req.from_token,
        expected_out,
        req.to_token,
        final_recipient
    );

    Ok(Json(ApiResponse::success(ExecuteSwapResponse {
        tx_hash,
        status: if is_user_signed_onchain {
            "submitted_onchain".to_string()
        } else {
            "success".to_string()
        },
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
        assert!((mev_fee_for_mode("private", 100.0) - 1.0).abs() < 1e-9);
        assert!((mev_fee_for_mode("transparent", 100.0) - 0.0).abs() < 1e-9);
    }

    #[test]
    fn estimated_time_for_dex_defaults() {
        // Memastikan estimasi waktu untuk DEX yang tidak dikenal
        assert_eq!(estimated_time_for_dex("UNKNOWN"), "~2-3 min");
    }
}
