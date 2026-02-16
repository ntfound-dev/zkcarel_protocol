use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::services::onchain::{
    felt_to_u128, parse_felt, u256_from_felts, OnchainInvoker, OnchainReader,
};
use crate::services::privacy_verifier::{
    parse_privacy_verifier_kind, resolve_privacy_router_for_verifier, PrivacyVerifierKind,
};
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
    models::{ApiResponse, BridgeQuoteRequest, BridgeQuoteResponse, LinkedWalletAddress},
    services::nft_discount::consume_nft_usage_if_active,
    services::RouteOptimizer,
};
use starknet_core::types::{Call, ExecutionResult, Felt, FunctionCall, TransactionFinalityStatus};
use starknet_core::utils::get_selector_from_name;
use tokio::time::{sleep, timeout, Duration};

use super::{require_user, AppState};

#[derive(Debug, Deserialize)]
pub struct PrivacyVerificationPayload {
    pub verifier: Option<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deposit_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deposit_amount: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BridgeStatusResponse {
    pub bridge_id: String,
    pub status: String,
    pub is_completed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_initiate_tx_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_redeem_tx_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination_initiate_tx_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination_redeem_tx_hash: Option<String>,
}

const ONCHAIN_DISCOUNT_TIMEOUT_MS: u64 = 2_500;

fn estimate_time(provider: &str) -> &'static str {
    match provider {
        BRIDGE_LAYERSWAP => "~15-20 min",
        BRIDGE_STARKGATE => "~10-15 min",
        BRIDGE_ATOMIQ => "~20-30 min",
        BRIDGE_GARDEN => "~25-35 min",
        _ => "~15-20 min",
    }
}

fn discount_contract_address(state: &AppState) -> Option<&str> {
    state
        .config
        .discount_soulbound_address
        .as_deref()
        .filter(|addr| !addr.trim().is_empty() && !addr.starts_with("0x0000"))
}

async fn active_nft_discount_percent(state: &AppState, user_address: &str) -> f64 {
    let Some(contract) = discount_contract_address(state) else {
        return 0.0;
    };

    let reader = match OnchainReader::from_config(&state.config) {
        Ok(reader) => reader,
        Err(err) => {
            tracing::warn!(
                "Failed to initialize on-chain reader for NFT discount in bridge: {}",
                err
            );
            return 0.0;
        }
    };

    let contract_address = match parse_felt(contract) {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(
                "Invalid discount contract address while calculating bridge fee discount: {}",
                err
            );
            return 0.0;
        }
    };
    let user_felt = match parse_felt(user_address) {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(
                "Invalid user address while calculating bridge fee discount: user={}, err={}",
                user_address,
                err
            );
            return 0.0;
        }
    };

    let selector = match get_selector_from_name("has_active_discount") {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(
                "Selector resolution failed for has_active_discount in bridge: {}",
                err
            );
            return 0.0;
        }
    };

    let call = FunctionCall {
        contract_address,
        entry_point_selector: selector,
        calldata: vec![user_felt],
    };

    let result = match timeout(
        Duration::from_millis(ONCHAIN_DISCOUNT_TIMEOUT_MS),
        reader.call(call),
    )
    .await
    {
        Ok(Ok(value)) => value,
        Ok(Err(err)) => {
            tracing::warn!(
                "Failed on-chain NFT discount check in bridge for user={}: {}",
                user_address,
                err
            );
            return 0.0;
        }
        Err(_) => {
            tracing::warn!(
                "Timeout on-chain NFT discount check in bridge for user={}",
                user_address
            );
            return 0.0;
        }
    };

    if result.len() < 3 {
        return 0.0;
    }

    let is_active = felt_to_u128(&result[0]).unwrap_or(0) > 0;
    if !is_active {
        return 0.0;
    }

    let discount = u256_from_felts(&result[1], &result[2]).unwrap_or(0) as f64;
    discount.clamp(0.0, 100.0)
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
    Ok(price
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or_else(|| fallback_price_for(&symbol)))
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
    let from_chain_normalized = from_chain.trim().to_ascii_lowercase();
    let raw = if let Some(value) = tx_hash.map(str::trim).filter(|v| !v.is_empty()) {
        value.to_string()
    } else if from_chain_normalized == "bitcoin" || from_chain_normalized == "btc" {
        // Garden-style BTC flow creates order first, then user deposits to generated address.
        // Keep internal tx_hash field non-empty for DB correlation even before real BTC txid exists.
        return Ok(hex::encode(rand::random::<[u8; 32]>()));
    } else {
        return Err(crate::error::AppError::BadRequest(
            "Bridge requires onchain_tx_hash from user-signed transaction".to_string(),
        ));
    };
    let body = raw.strip_prefix("0x").unwrap_or(&raw);
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

fn parse_hex_u64(value: &str) -> Option<u64> {
    let body = value.trim().strip_prefix("0x").unwrap_or(value.trim());
    if body.is_empty() {
        return Some(0);
    }
    u64::from_str_radix(body, 16).ok()
}

async fn verify_starknet_bridge_tx_hash(state: &AppState, tx_hash: &str) -> Result<i64> {
    let reader = OnchainReader::from_config(&state.config)?;
    let tx_hash_felt = parse_felt(tx_hash)?;
    let mut last_rpc_error = String::new();

    for attempt in 0..5 {
        match reader.get_transaction_receipt(&tx_hash_felt).await {
            Ok(receipt) => {
                if let ExecutionResult::Reverted { reason } = receipt.receipt.execution_result() {
                    return Err(crate::error::AppError::BadRequest(format!(
                        "onchain_tx_hash reverted on Starknet: {}",
                        reason
                    )));
                }
                if matches!(
                    receipt.receipt.finality_status(),
                    TransactionFinalityStatus::PreConfirmed
                ) {
                    last_rpc_error = "transaction still pre-confirmed".to_string();
                    if attempt < 4 {
                        sleep(Duration::from_millis(1000)).await;
                        continue;
                    }
                    break;
                }
                let block_number = receipt.block.block_number() as i64;
                tracing::info!(
                    "Verified Starknet bridge tx {} at block {} with finality {:?}",
                    tx_hash,
                    block_number,
                    receipt.receipt.finality_status()
                );
                return Ok(block_number);
            }
            Err(err) => {
                last_rpc_error = err.to_string();
                if attempt < 4 {
                    sleep(Duration::from_millis(1000)).await;
                }
            }
        }
    }

    Err(crate::error::AppError::BadRequest(format!(
        "onchain_tx_hash not found/confirmed on Starknet RPC: {}",
        last_rpc_error
    )))
}

async fn verify_ethereum_bridge_tx_hash(state: &AppState, tx_hash: &str) -> Result<i64> {
    let rpc_url = state.config.ethereum_rpc_url.trim();
    if rpc_url.is_empty() {
        return Err(crate::error::AppError::BadRequest(
            "ETHEREUM_RPC_URL is empty".to_string(),
        ));
    }

    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_getTransactionReceipt",
        "params": [tx_hash],
    });

    let client = reqwest::Client::new();
    let response = client
        .post(rpc_url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| {
            crate::error::AppError::BadRequest(format!(
                "Failed to query Ethereum RPC for onchain_tx_hash: {}",
                e
            ))
        })?;

    let body: serde_json::Value = response.json().await.map_err(|e| {
        crate::error::AppError::BadRequest(format!(
            "Failed to parse Ethereum RPC response for onchain_tx_hash: {}",
            e
        ))
    })?;

    if let Some(err) = body.get("error") {
        return Err(crate::error::AppError::BadRequest(format!(
            "Ethereum RPC returned error for onchain_tx_hash: {}",
            err
        )));
    }

    let receipt = body.get("result").ok_or_else(|| {
        crate::error::AppError::BadRequest(
            "Ethereum RPC response missing result for onchain_tx_hash".to_string(),
        )
    })?;
    if receipt.is_null() {
        return Err(crate::error::AppError::BadRequest(
            "onchain_tx_hash not found yet on Ethereum RPC".to_string(),
        ));
    }

    let status = receipt.get("status").and_then(|value| value.as_str());
    if matches!(status, Some("0x0") | Some("0x00")) {
        return Err(crate::error::AppError::BadRequest(
            "onchain_tx_hash reverted on Ethereum".to_string(),
        ));
    }

    let block_number_hex = receipt
        .get("blockNumber")
        .and_then(|value| value.as_str())
        .ok_or_else(|| {
            crate::error::AppError::BadRequest("Ethereum receipt missing blockNumber".to_string())
        })?;

    let block_number = parse_hex_u64(block_number_hex).ok_or_else(|| {
        crate::error::AppError::BadRequest("Invalid Ethereum blockNumber format".to_string())
    })? as i64;

    tracing::info!(
        "Verified Ethereum bridge tx {} at block {}",
        tx_hash,
        block_number
    );

    Ok(block_number)
}

async fn verify_bridge_onchain_tx_hash(
    state: &AppState,
    tx_hash: &str,
    from_chain: &str,
) -> Result<i64> {
    match from_chain.trim().to_ascii_lowercase().as_str() {
        "starknet" => verify_starknet_bridge_tx_hash(state, tx_hash).await,
        "ethereum" => verify_ethereum_bridge_tx_hash(state, tx_hash).await,
        // Native BTC settles asynchronously via bridge providers; txid is validated format-wise above.
        "bitcoin" | "btc" => Ok(0),
        _ => Ok(0),
    }
}

fn find_linked_wallet_for_chain(wallets: &[LinkedWalletAddress], chain: &str) -> Option<String> {
    if chain.eq_ignore_ascii_case("bitcoin") || chain.eq_ignore_ascii_case("btc") {
        return wallets
            .iter()
            .find(|wallet| {
                wallet.chain.eq_ignore_ascii_case("bitcoin")
                    || wallet.chain.eq_ignore_ascii_case("btc")
            })
            .map(|wallet| wallet.wallet_address.clone());
    }

    wallets
        .iter()
        .find(|wallet| wallet.chain.eq_ignore_ascii_case(chain))
        .map(|wallet| wallet.wallet_address.clone())
}

async fn lookup_xverse_btc_address(state: &AppState, user_id: &str) -> Result<Option<String>> {
    let normalized = user_id.trim();
    if normalized.is_empty() {
        return Ok(None);
    }

    let client = crate::integrations::xverse::XverseClient::new(
        state.config.xverse_api_url.clone(),
        state.config.xverse_api_key.clone(),
    );
    client
        .get_btc_address(normalized)
        .await
        .map_err(|e| crate::error::AppError::BadRequest(format!("Xverse lookup failed: {}", e)))
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
) -> Result<(String, String, Vec<String>, Vec<String>)> {
    let payload = payload.ok_or_else(|| {
        crate::error::AppError::BadRequest(
            "privacy payload is required when mode=private or hide_balance=true".to_string(),
        )
    })?;

    let nullifier = payload
        .nullifier
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| seed.to_string());
    let commitment = payload
        .commitment
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| hash::hash_string(&format!("commitment:{seed}")));
    let proof = payload
        .proof
        .clone()
        .filter(|items| !items.is_empty())
        .ok_or_else(|| {
            crate::error::AppError::BadRequest(
                "privacy.proof must be provided and non-empty in private mode".to_string(),
            )
        })?;
    let public_inputs = payload
        .public_inputs
        .clone()
        .filter(|items| !items.is_empty())
        .ok_or_else(|| {
            crate::error::AppError::BadRequest(
                "privacy.public_inputs must be provided and non-empty in private mode".to_string(),
            )
        })?;
    Ok((nullifier, commitment, proof, public_inputs))
}

async fn verify_private_trade_with_verifier(
    state: &AppState,
    seed: &str,
    payload: Option<&PrivacyVerificationPayload>,
    verifier: PrivacyVerifierKind,
) -> Result<String> {
    let router = resolve_privacy_router_for_verifier(&state.config, verifier)?;
    let Some(invoker) = OnchainInvoker::from_config(&state.config).ok().flatten() else {
        return Err(crate::error::AppError::BadRequest(format!(
            "On-chain invoker is not configured for '{}' verification",
            verifier.as_str()
        )));
    };
    let (nullifier, commitment, proof, public_inputs) = resolve_privacy_inputs(seed, payload)?;

    let to = parse_felt(&router)?;
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
    let linked_wallets = state
        .db
        .list_wallet_addresses(&user_address)
        .await
        .unwrap_or_default();

    let discount_usage_user = if parse_felt(&user_address).is_ok() {
        Some(user_address.clone())
    } else {
        linked_wallets
            .iter()
            .find(|wallet| {
                wallet.chain.eq_ignore_ascii_case("starknet")
                    && parse_felt(wallet.wallet_address.trim()).is_ok()
            })
            .map(|wallet| wallet.wallet_address.clone())
    };
    let from_chain_normalized = req.from_chain.trim().to_ascii_lowercase();
    let to_chain_normalized = req.to_chain.trim().to_ascii_lowercase();
    let is_from_btc = from_chain_normalized == "bitcoin" || from_chain_normalized == "btc";
    let is_to_btc = to_chain_normalized == "bitcoin" || to_chain_normalized == "btc";
    let is_to_starknet = to_chain_normalized == "starknet";

    let mut recipient = req.recipient.trim().to_string();
    if recipient.is_empty() {
        if is_to_btc {
            if let Some(user_id) = req.xverse_user_id.as_deref() {
                if let Some(addr) = lookup_xverse_btc_address(&state, user_id).await? {
                    recipient = addr;
                }
            }
            if recipient.is_empty() {
                if let Some(addr) = find_linked_wallet_for_chain(&linked_wallets, "bitcoin") {
                    recipient = addr;
                }
            }
        } else if is_to_starknet {
            if parse_felt(&user_address).is_ok() {
                recipient = user_address.clone();
            } else if let Some(addr) = find_linked_wallet_for_chain(&linked_wallets, "starknet") {
                recipient = addr;
            }
        } else if let Some(addr) =
            find_linked_wallet_for_chain(&linked_wallets, &to_chain_normalized)
        {
            recipient = addr;
        }
    }
    if recipient.is_empty() {
        return Err(crate::error::AppError::BadRequest(format!(
            "Recipient is required for destination chain '{}'",
            req.to_chain
        )));
    }

    let mut garden_source_owner = if is_from_btc {
        find_linked_wallet_for_chain(&linked_wallets, "bitcoin")
    } else {
        find_linked_wallet_for_chain(&linked_wallets, &from_chain_normalized)
    };
    if garden_source_owner.is_none() && is_from_btc {
        if let Some(user_id) = req.xverse_user_id.as_deref() {
            garden_source_owner = lookup_xverse_btc_address(&state, user_id).await?;
        }
    }
    if garden_source_owner.is_none()
        && (from_chain_normalized == "starknet" || from_chain_normalized == "ethereum")
    {
        garden_source_owner = Some(user_address.clone());
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
    let onchain_block_number =
        verify_bridge_onchain_tx_hash(&state, &tx_hash, &from_chain_normalized).await?;
    let should_hide = is_private_trade(req.mode.as_deref(), req.hide_balance.unwrap_or(false));

    // Keep DB tx_hash within varchar(66), while exposing a human-friendly bridge_id.
    let mut bridge_id = build_bridge_id(&tx_hash);
    let mut garden_deposit_address: Option<String> = None;
    let mut garden_deposit_amount: Option<String> = None;
    let mut privacy_verification_tx: Option<String> = None;
    if should_hide {
        let verifier =
            parse_privacy_verifier_kind(req.privacy.as_ref().and_then(|p| p.verifier.as_deref()))?;
        let privacy_seed = privacy_seed_from_tx_hash(&tx_hash);
        let privacy_tx = verify_private_trade_with_verifier(
            &state,
            &privacy_seed,
            req.privacy.as_ref(),
            verifier,
        )
        .await
        .map_err(|e| {
            crate::error::AppError::BadRequest(format!(
                "Privacy verification failed via '{}': {}",
                verifier.as_str(),
                e
            ))
        })?;
        privacy_verification_tx = Some(privacy_tx);
    }

    let optimizer = RouteOptimizer::new(state.config.clone());
    let best_route = optimizer
        .find_best_bridge_route(&req.from_chain, &req.to_chain, &req.token, amount)
        .await?;
    let applied_nft_discount_percent = if let Some(discount_user) = discount_usage_user.as_deref() {
        active_nft_discount_percent(&state, discount_user).await
    } else {
        0.0
    };
    let effective_bridge_fee =
        best_route.fee * (1.0 - (applied_nft_discount_percent.clamp(0.0, 100.0) / 100.0));
    if applied_nft_discount_percent > 0.0 {
        tracing::debug!(
            "Bridge fee discount applied: user={} discount_percent={} route_fee={} effective_fee={}",
            user_address,
            applied_nft_discount_percent,
            best_route.fee,
            effective_bridge_fee
        );
    }

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
        block_number: onchain_block_number,
        user_address: user_address.to_string(),
        tx_type: "bridge".to_string(),
        token_in: Some(from_token.clone()),
        token_out: Some(to_token.clone()),
        amount_in: Some(rust_decimal::Decimal::from_f64_retain(amount).unwrap()),
        amount_out: Some(rust_decimal::Decimal::from_f64_retain(estimated_receive).unwrap()),
        usd_value: Some(rust_decimal::Decimal::from_f64_retain(volume_usd).unwrap()),
        fee_paid: Some(rust_decimal::Decimal::from_f64_retain(effective_bridge_fee).unwrap()),
        points_earned: Some(rust_decimal::Decimal::ZERO),
        timestamp: chrono::Utc::now(),
        processed: false,
    };

    state.db.save_transaction(&tx).await?;
    if should_hide {
        state.db.mark_transaction_private(&tx_hash).await?;
    }
    if let Some(discount_user) = discount_usage_user.as_deref() {
        if let Err(err) = consume_nft_usage_if_active(&state.config, discount_user, "bridge").await
        {
            tracing::warn!(
                "Failed to consume NFT discount usage after bridge success: user={} tx_hash={} err={}",
                discount_user,
                tx_hash,
                err
            );
        }
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
                effective_bridge_fee,
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
            deposit_address: None,
            deposit_amount: None,
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
            fee: effective_bridge_fee,
            estimated_time_minutes: 15,
        };
        bridge_id = client.execute_bridge(&quote, &recipient).await?;
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
            fee: effective_bridge_fee,
            estimated_time_minutes: 20,
        };
        bridge_id = client.execute_bridge(&quote, &recipient).await?;
    } else if best_route.provider.as_str() == BRIDGE_GARDEN {
        let client = GardenClient::new(
            state.config.garden_api_key.clone().unwrap_or_default(),
            state.config.garden_api_url.clone(),
        );
        let source_owner = garden_source_owner.clone().ok_or_else(|| {
            crate::error::AppError::BadRequest(
                "Garden bridge requires source wallet address. Link source wallet (BTC/EVM/Starknet) or provide xverse_user_id for BTC."
                    .to_string(),
            )
        })?;
        let quote = GardenQuote {
            from_chain: req.from_chain.clone(),
            to_chain: req.to_chain.clone(),
            from_token: from_token.clone(),
            to_token: to_token.clone(),
            amount_in: amount,
            amount_out: estimated_receive,
            fee: effective_bridge_fee,
            estimated_time_minutes: 30,
        };
        let submission = client
            .execute_bridge(&quote, &source_owner, &recipient)
            .await?;
        bridge_id = submission.order_id;
        garden_deposit_address = submission.deposit_address;
        garden_deposit_amount = submission.deposit_amount;
    }

    if let Err(err) = invoke_bridge_aggregator(
        &state,
        &best_route.provider,
        amount,
        effective_bridge_fee,
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
        deposit_address: garden_deposit_address,
        deposit_amount: garden_deposit_amount,
    };

    Ok(Json(ApiResponse::success(response)))
}

/// GET /api/v1/bridge/status/{bridge_id}
pub async fn get_bridge_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(bridge_id): Path<String>,
) -> Result<Json<ApiResponse<BridgeStatusResponse>>> {
    let _ = require_user(&headers, &state).await?;

    let client = GardenClient::new(
        state.config.garden_api_key.clone().unwrap_or_default(),
        state.config.garden_api_url.clone(),
    );
    let status = client.get_order_status(&bridge_id).await?;
    let is_completed = status.destination_redeem_tx_hash.is_some();

    Ok(Json(ApiResponse::success(BridgeStatusResponse {
        bridge_id: status.order_id,
        status: status.status,
        is_completed,
        version: status.version,
        source_initiate_tx_hash: status.source_initiate_tx_hash,
        source_redeem_tx_hash: status.source_redeem_tx_hash,
        destination_initiate_tx_hash: status.destination_initiate_tx_hash,
        destination_redeem_tx_hash: status.destination_redeem_tx_hash,
    })))
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

    #[test]
    fn normalize_bridge_hash_allows_missing_btc_hash() {
        let normalized = normalize_bridge_onchain_tx_hash(None, "bitcoin")
            .expect("missing btc hash should generate internal correlation id");
        assert_eq!(normalized.len(), 64);
        assert!(normalized.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn normalize_bridge_hash_requires_non_btc_hash() {
        let err = normalize_bridge_onchain_tx_hash(None, "starknet")
            .expect_err("non-btc bridge must require user tx hash");
        let message = err.to_string();
        assert!(
            message.contains("onchain_tx_hash"),
            "unexpected error message: {}",
            message
        );
    }

    #[test]
    fn parse_hex_u64_supports_prefixed_and_plain_values() {
        assert_eq!(parse_hex_u64("0x10"), Some(16));
        assert_eq!(parse_hex_u64("ff"), Some(255));
        assert_eq!(parse_hex_u64("0x"), Some(0));
        assert_eq!(parse_hex_u64("not-hex"), None);
    }
}
