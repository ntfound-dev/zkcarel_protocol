use super::{require_starknet_user, AppState};
use crate::{
    constants::{
        EPOCH_DURATION_SECONDS, NFT_TIER_1_DISCOUNT, NFT_TIER_2_DISCOUNT, NFT_TIER_3_DISCOUNT,
        NFT_TIER_4_DISCOUNT, NFT_TIER_5_DISCOUNT, NFT_TIER_6_DISCOUNT,
    },
    error::Result,
    models::ApiResponse,
    services::onchain::{felt_to_u128, parse_felt, u256_from_felts, OnchainReader},
};
use axum::{extract::State, http::HeaderMap, Json};
use rust_decimal::prelude::FromPrimitive;
use serde::{Deserialize, Serialize};
use starknet_core::types::{Felt, FunctionCall};
use starknet_core::utils::{get_selector_from_name, get_storage_var_address};
use tokio::time::{timeout, Duration};

const ONCHAIN_NFT_READ_TIMEOUT_MS: u64 = 3_500;

#[derive(Debug, Serialize)]
pub struct NFT {
    pub token_id: String,
    pub tier: i32,
    pub discount: f64,
    pub expiry: i64,
    pub used: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_usage: Option<u128>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used_in_period: Option<u128>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining_usage: Option<u128>,
}

#[derive(Debug, Deserialize)]
pub struct MintRequest {
    pub tier: i32,
    pub onchain_tx_hash: Option<String>,
}

fn points_cost_for_tier(tier: i32) -> i64 {
    match tier {
        1 => 5_000,
        2 => 15_000,
        3 => 50_000,
        4 => 150_000,
        5 => 500_000,
        _ => 0,
    }
}

fn discount_for_tier(tier: i32) -> f64 {
    match tier {
        0 => 0.0,
        1 => NFT_TIER_1_DISCOUNT,
        2 => NFT_TIER_2_DISCOUNT,
        3 => NFT_TIER_3_DISCOUNT,
        4 => NFT_TIER_4_DISCOUNT,
        5 => NFT_TIER_5_DISCOUNT,
        6 => NFT_TIER_6_DISCOUNT,
        _ => 0.0,
    }
}

fn tier_for_discount(discount: f64) -> i32 {
    let rounded = discount.round() as i64;
    match rounded {
        i if i <= 0 => 0,
        1..=7 => 1,    // bronze ~5%
        8..=15 => 2,   // silver ~10%
        16..=25 => 3,  // gold 25%
        26..=35 => 4,  // platinum 35%
        _ => 5,        // onyx 50%+
    }
}

fn discount_contract_or_error(state: &AppState) -> Result<&str> {
    let Some(contract) = state.config.discount_soulbound_address.as_deref() else {
        return Err(crate::error::AppError::BadRequest(
            "DISCOUNT_SOULBOUND_ADDRESS is not configured".to_string(),
        ));
    };
    if contract.trim().is_empty() || contract.starts_with("0x0000") {
        return Err(crate::error::AppError::BadRequest(
            "DISCOUNT_SOULBOUND_ADDRESS is placeholder/invalid".to_string(),
        ));
    }
    Ok(contract)
}

fn discount_contract(state: &AppState) -> Option<&str> {
    state
        .config
        .discount_soulbound_address
        .as_deref()
        .filter(|addr| !addr.trim().is_empty() && !addr.starts_with("0x0000"))
}

fn normalize_onchain_tx_hash(
    tx_hash: Option<&str>,
) -> std::result::Result<Option<String>, crate::error::AppError> {
    let Some(raw) = tx_hash.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    if !raw.starts_with("0x") {
        return Err(crate::error::AppError::BadRequest(
            "onchain_tx_hash must start with 0x".to_string(),
        ));
    }
    if raw.len() > 66 {
        return Err(crate::error::AppError::BadRequest(
            "onchain_tx_hash exceeds maximum length (66)".to_string(),
        ));
    }
    if !raw[2..].chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(crate::error::AppError::BadRequest(
            "onchain_tx_hash must be hex-encoded".to_string(),
        ));
    }
    Ok(Some(raw.to_ascii_lowercase()))
}

fn looks_like_transient_rpc_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("jsonrpcresponse")
        || lower.contains("error decoding response body")
        || lower.contains("too many requests")
        || lower.contains("429")
        || lower.contains("timeout")
        || lower.contains("timed out")
}

#[derive(Debug, Clone, Copy)]
struct OnchainNftState {
    token_id: u128,
    tier: i32,
    discount_rate: f64,
    max_usage: u128,
    used_in_period: u128,
}

async fn read_discount_state_onchain(
    state: &AppState,
    contract: &str,
    user_address: &str,
) -> Result<(bool, f64)> {
    let reader = OnchainReader::from_config(&state.config)?;
    let call = FunctionCall {
        contract_address: parse_felt(contract)?,
        entry_point_selector: get_selector_from_name("has_active_discount")
            .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?,
        calldata: vec![parse_felt(user_address)?],
    };
    let result = reader.call(call).await?;
    if result.len() < 3 {
        return Ok((false, 0.0));
    }
    let active = felt_to_u128(&result[0]).unwrap_or(0) > 0;
    let discount_u128 = u256_from_felts(&result[1], &result[2]).unwrap_or(0);
    Ok((active, discount_u128 as f64))
}

async fn read_user_nft_token_id_onchain(
    state: &AppState,
    contract: &str,
    user_address: &str,
) -> Result<u128> {
    let reader = OnchainReader::from_config(&state.config)?;
    let contract_felt = parse_felt(contract)?;
    let user_felt = parse_felt(user_address)?;
    let storage_key = get_storage_var_address("user_nft", &[user_felt]).map_err(|e| {
        crate::error::AppError::Internal(format!("Storage key resolution error: {}", e))
    })?;
    let raw_value = reader.get_storage_at(contract_felt, storage_key).await?;
    Ok(felt_to_u128(&raw_value).unwrap_or(0))
}

fn u256_calldata(value: u128) -> [Felt; 2] {
    [Felt::from(value), Felt::from(0_u8)]
}

async fn read_nft_info_onchain(state: &AppState, contract: &str, token_id: u128) -> Result<OnchainNftState> {
    let reader = OnchainReader::from_config(&state.config)?;
    let [token_low, token_high] = u256_calldata(token_id);
    let call = FunctionCall {
        contract_address: parse_felt(contract)?,
        entry_point_selector: get_selector_from_name("get_nft_info")
            .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?,
        calldata: vec![token_low, token_high],
    };
    let result = reader.call(call).await?;
    if result.len() < 9 {
        return Err(crate::error::AppError::Internal(
            "get_nft_info returned malformed payload".to_string(),
        ));
    }

    let tier = felt_to_u128(&result[0]).unwrap_or(0) as i32;
    let discount_rate = u256_from_felts(&result[1], &result[2]).unwrap_or(0) as f64;
    let max_usage = u256_from_felts(&result[3], &result[4]).unwrap_or(0);
    let used_in_period = u256_from_felts(&result[5], &result[6]).unwrap_or(0);
    let _last_reset = felt_to_u128(&result[8]).unwrap_or(0) as i64;

    Ok(OnchainNftState {
        token_id,
        tier,
        discount_rate,
        max_usage,
        used_in_period,
    })
}

async fn fallback_owned_nft_from_discount_state(
    state: &AppState,
    contract: &str,
    user_address: &str,
) -> Option<NFT> {
    let read = timeout(
        Duration::from_millis(ONCHAIN_NFT_READ_TIMEOUT_MS),
        read_discount_state_onchain(state, contract, user_address),
    )
    .await;

    let (active, discount) = match read {
        Ok(Ok(value)) => value,
        Ok(Err(err)) => {
            tracing::warn!(
                "nft_owned_discount_fallback failed user={} contract={} err={}",
                user_address,
                contract,
                err
            );
            return None;
        }
        Err(_) => {
            tracing::warn!(
                "nft_owned_discount_fallback timeout user={} contract={}",
                user_address,
                contract
            );
            return None;
        }
    };

    if !active && discount <= 0.0 {
        return None;
    }

    let mut tier = tier_for_discount(discount);
    if tier <= 0 && active {
        tier = 1;
    }

    Some(NFT {
        token_id: "0x0".to_string(),
        tier,
        discount,
        expiry: 0,
        used: !active,
        max_usage: None,
        used_in_period: None,
        remaining_usage: None,
    })
}

/// POST /api/v1/nft/mint
pub async fn mint_nft(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<MintRequest>,
) -> Result<Json<ApiResponse<NFT>>> {
    let user_address = require_starknet_user(&headers, &state).await?;
    if !(1..=5).contains(&req.tier) {
        return Err(crate::error::AppError::BadRequest(
            "Invalid tier".to_string(),
        ));
    }
    let current_epoch = (chrono::Utc::now().timestamp() / EPOCH_DURATION_SECONDS) as i64;
    let _ = discount_contract_or_error(&state)?;
    let onchain_tx_hash = normalize_onchain_tx_hash(req.onchain_tx_hash.as_deref())?;
    let tx_hash = onchain_tx_hash.ok_or_else(|| {
        crate::error::AppError::BadRequest(
            "NFT mint requires onchain_tx_hash from user-signed Starknet transaction".to_string(),
        )
    })?;

    let cost_points = points_cost_for_tier(req.tier);
    if cost_points > 0 {
        if let Err(err) = state
            .db
            .consume_points(
                &user_address,
                current_epoch,
                rust_decimal::Decimal::from_i64(cost_points).unwrap(),
            )
            .await
        {
            tracing::warn!(
                "NFT minted on-chain but failed to consume off-chain points: user={}, tier={}, error={}",
                user_address,
                req.tier,
                err
            );
        }
    }

    let discount = discount_for_tier(req.tier);
    let nft = NFT {
        token_id: format!("NFT_{}", tx_hash.trim_start_matches("0x")),
        tier: req.tier,
        discount,
        expiry: 0,
        used: false,
        max_usage: None,
        used_in_period: None,
        remaining_usage: None,
    };

    Ok(Json(ApiResponse::success(nft)))
}

/// GET /api/v1/nft/owned
pub async fn get_owned_nfts(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<NFT>>>> {
    let user_address = require_starknet_user(&headers, &state).await?;
    let Some(contract) = discount_contract(&state) else {
        return Ok(Json(ApiResponse::success(Vec::new())));
    };

    let token_id = match timeout(
        Duration::from_millis(ONCHAIN_NFT_READ_TIMEOUT_MS),
        read_user_nft_token_id_onchain(&state, contract, &user_address),
    )
    .await
    {
        Ok(Ok(value)) => value,
        Ok(Err(err)) => {
            let message = err.to_string();
            if looks_like_transient_rpc_error(&message) {
                tracing::warn!(
                    "nft_owned_token_lookup transient rpc issue user={} contract={} err={}",
                    user_address,
                    contract,
                    message
                );
            } else {
                tracing::warn!(
                    "nft_owned_token_lookup failed user={} contract={} err={}",
                    user_address,
                    contract,
                    message
                );
            }
            if let Some(nft) = fallback_owned_nft_from_discount_state(&state, contract, &user_address).await {
                return Ok(Json(ApiResponse::success(vec![nft])));
            }
            return Ok(Json(ApiResponse::success(Vec::new())));
        }
        Err(_) => {
            tracing::warn!(
                "nft_owned_token_lookup timeout user={} contract={}",
                user_address,
                contract
            );
            if let Some(nft) = fallback_owned_nft_from_discount_state(&state, contract, &user_address).await {
                return Ok(Json(ApiResponse::success(vec![nft])));
            }
            return Ok(Json(ApiResponse::success(Vec::new())));
        }
    };
    if token_id == 0 {
        if let Some(nft) = fallback_owned_nft_from_discount_state(&state, contract, &user_address).await {
            return Ok(Json(ApiResponse::success(vec![nft])));
        }
        return Ok(Json(ApiResponse::success(Vec::new())));
    }

    let nft_state = match timeout(
        Duration::from_millis(ONCHAIN_NFT_READ_TIMEOUT_MS),
        read_nft_info_onchain(&state, contract, token_id),
    )
    .await
    {
        Ok(Ok(value)) => value,
        Ok(Err(err)) => {
            let message = err.to_string();
            if looks_like_transient_rpc_error(&message) {
                tracing::warn!(
                    "nft_owned_info transient rpc issue user={} contract={} token_id={} err={}",
                    user_address,
                    contract,
                    token_id,
                    message
                );
            } else {
                tracing::warn!(
                    "nft_owned_info failed user={} contract={} token_id={} err={}",
                    user_address,
                    contract,
                    token_id,
                    message
                );
            }
            if let Some(nft) = fallback_owned_nft_from_discount_state(&state, contract, &user_address).await {
                return Ok(Json(ApiResponse::success(vec![nft])));
            }
            return Ok(Json(ApiResponse::success(Vec::new())));
        }
        Err(_) => {
            tracing::warn!(
                "nft_owned_info timeout user={} contract={} token_id={}",
                user_address,
                contract,
                token_id
            );
            if let Some(nft) = fallback_owned_nft_from_discount_state(&state, contract, &user_address).await {
                return Ok(Json(ApiResponse::success(vec![nft])));
            }
            return Ok(Json(ApiResponse::success(Vec::new())));
        }
    };

    let fallback_active = nft_state.max_usage > 0 && nft_state.used_in_period < nft_state.max_usage;
    let fallback_discount = if fallback_active {
        nft_state.discount_rate
    } else {
        0.0
    };

    let (active, onchain_discount) = match timeout(
        Duration::from_millis(ONCHAIN_NFT_READ_TIMEOUT_MS),
        read_discount_state_onchain(&state, contract, &user_address),
    )
    .await
    {
        Ok(Ok(value)) => value,
        Ok(Err(err)) => {
            let message = err.to_string();
            if looks_like_transient_rpc_error(&message) {
                tracing::warn!(
                    "nft_owned_active_lookup transient rpc issue user={} contract={} token_id={} err={}",
                    user_address,
                    contract,
                    token_id,
                    message
                );
            } else {
                tracing::warn!(
                    "nft_owned_active_lookup failed user={} contract={} token_id={} err={}",
                    user_address,
                    contract,
                    token_id,
                    message
                );
            }
            (fallback_active, fallback_discount)
        }
        Err(_) => {
            tracing::warn!(
                "nft_owned_active_lookup timeout user={} contract={} token_id={}",
                user_address,
                contract,
                token_id
            );
            (fallback_active, fallback_discount)
        }
    };

    let tier = if nft_state.tier > 0 {
        nft_state.tier
    } else {
        tier_for_discount(nft_state.discount_rate)
    };
    let display_discount = if nft_state.discount_rate > 0.0 {
        nft_state.discount_rate
    } else {
        onchain_discount
    };
    tracing::info!(
        "nft_owned_check user={} token_id={} active={} tier={} discount={} used_in_period={} max_usage={}",
        user_address,
        nft_state.token_id,
        active,
        tier,
        display_discount,
        nft_state.used_in_period,
        nft_state.max_usage
    );

    let nfts = vec![NFT {
        token_id: format!("0x{:x}", nft_state.token_id),
        tier,
        discount: display_discount,
        expiry: 0,
        used: !active,
        max_usage: Some(nft_state.max_usage),
        used_in_period: Some(nft_state.used_in_period),
        remaining_usage: Some(nft_state.max_usage.saturating_sub(nft_state.used_in_period)),
    }];
    Ok(Json(ApiResponse::success(nfts)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discount_for_tier_defaults_to_zero() {
        // Memastikan tier di luar range memakai diskon 0
        assert_eq!(discount_for_tier(99), 0.0);
    }

    #[test]
    fn discount_for_tier_returns_exact_value() {
        // Memastikan tier 3 memakai konstanta yang benar
        assert_eq!(discount_for_tier(3), NFT_TIER_3_DISCOUNT);
    }
}
