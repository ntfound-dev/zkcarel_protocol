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
use starknet_core::types::FunctionCall;
use starknet_core::utils::get_selector_from_name;

#[derive(Debug, Serialize)]
pub struct NFT {
    pub token_id: String,
    pub tier: i32,
    pub discount: f64,
    pub expiry: i64,
    pub used: bool,
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
    if discount <= 0.0 {
        return 0;
    }
    if discount <= 5.0 {
        return 1;
    }
    if discount <= 10.0 {
        return 2;
    }
    if discount <= 25.0 {
        return 3;
    }
    if discount <= 35.0 {
        return 4;
    }
    5
}

fn short_user_key(user_address: &str) -> String {
    let trimmed = user_address.trim_start_matches("0x");
    trimmed.chars().take(8).collect::<String>()
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
        expiry: chrono::Utc::now().timestamp() + EPOCH_DURATION_SECONDS,
        used: false,
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

    let (active, discount) = read_discount_state_onchain(&state, contract, &user_address).await?;
    if discount <= 0.0 {
        return Ok(Json(ApiResponse::success(Vec::new())));
    }

    let tier = tier_for_discount(discount);
    let now = chrono::Utc::now().timestamp();
    let nfts = vec![NFT {
        token_id: format!("NFT_ONCHAIN_{}", short_user_key(&user_address)),
        tier,
        discount,
        expiry: if active {
            now + EPOCH_DURATION_SECONDS
        } else {
            now
        },
        used: !active,
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
