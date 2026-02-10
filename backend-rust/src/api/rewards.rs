use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use rust_decimal::prelude::{FromPrimitive, ToPrimitive};
use rust_decimal::Decimal;

use crate::{
    constants::EPOCH_DURATION_SECONDS,
    error::Result,
    models::ApiResponse,
};

use super::{AppState, require_user};
use crate::indexer::starknet_client::StarknetClient;
use crate::error::AppError;

#[derive(Debug, Serialize)]
pub struct PointsResponse {
    pub current_epoch: i64,
    pub total_points: f64,
    pub swap_points: f64,
    pub bridge_points: f64,
    pub stake_points: f64,
    pub referral_points: f64,
    pub social_points: f64,
    pub multiplier: f64,
    pub nft_boost: bool,
}

#[derive(Debug, Serialize)]
pub struct ClaimResponse {
    pub tx_hash: String,
    pub amount_carel: f64,
    pub points_converted: f64,
}

#[derive(Debug, Deserialize)]
pub struct ConvertRequest {
    pub epoch: Option<i64>,
    pub points: Option<f64>,
    pub total_distribution_carel: Option<f64>,
}

fn monthly_ecosystem_pool_carel() -> Decimal {
    let total_supply = Decimal::from_i64(1_000_000_000).unwrap();
    let bps = Decimal::from_i64(4000).unwrap();
    let denom = Decimal::from_i64(10000).unwrap();
    let months = Decimal::from_i64(36).unwrap();
    total_supply * bps / denom / months
}

fn calculate_epoch_reward(points: Decimal, total_points: Decimal, total_distribution: Decimal) -> Decimal {
    if total_points.is_zero() {
        return Decimal::ZERO;
    }
    (points / total_points) * total_distribution
}

/// GET /api/v1/rewards/points
pub async fn get_points(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<PointsResponse>>> {
    let user_address = require_user(&headers, &state).await?;

    // Get current epoch
    let current_epoch = (chrono::Utc::now().timestamp() / EPOCH_DURATION_SECONDS) as i64; // ~30 days

    // Get user points
    let points = state.db.get_user_points(&user_address, current_epoch).await?
        .unwrap_or_else(|| crate::models::UserPoints {
            user_address: user_address.to_string(),
            epoch: current_epoch,
            swap_points: rust_decimal::Decimal::ZERO,
            bridge_points: rust_decimal::Decimal::ZERO,
            stake_points: rust_decimal::Decimal::ZERO,
            referral_points: rust_decimal::Decimal::ZERO,
            social_points: rust_decimal::Decimal::ZERO,
            total_points: rust_decimal::Decimal::ZERO,
            staking_multiplier: rust_decimal::Decimal::ONE,
            nft_boost: false,
            wash_trading_flagged: false,
            finalized: false,
        });

    let response = PointsResponse {
        current_epoch,
        total_points: points.total_points.to_string().parse().unwrap_or(0.0),
        swap_points: points.swap_points.to_string().parse().unwrap_or(0.0),
        bridge_points: points.bridge_points.to_string().parse().unwrap_or(0.0),
        stake_points: points.stake_points.to_string().parse().unwrap_or(0.0),
        referral_points: points.referral_points.to_string().parse().unwrap_or(0.0),
        social_points: points.social_points.to_string().parse().unwrap_or(0.0),
        multiplier: points.staking_multiplier.to_string().parse().unwrap_or(1.0),
        nft_boost: points.nft_boost,
    };

    Ok(Json(ApiResponse::success(response)))
}

/// POST /api/v1/rewards/claim
pub async fn claim_rewards(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<ClaimResponse>>> {
    let user_address = require_user(&headers, &state).await?;

    // Get previous epoch (finalized)
    let current_epoch = (chrono::Utc::now().timestamp() / EPOCH_DURATION_SECONDS) as i64;
    let prev_epoch = current_epoch - 1;

    // Get user points from previous epoch
    let points = state.db.get_user_points(&user_address, prev_epoch).await?
        .ok_or_else(|| crate::error::AppError::NotFound("No rewards to claim".to_string()))?;

    // Check if finalized
    if !points.finalized {
        return Err(crate::error::AppError::BadRequest(
            "Epoch not finalized yet".to_string()
        ));
    }

    // Calculate CAREL amount based on monthly ecosystem pool
    let total_points_epoch: rust_decimal::Decimal = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_points), 0) FROM points WHERE epoch = $1"
    )
    .bind(prev_epoch)
    .fetch_one(state.db.pool())
    .await?;

    let carel_amount_dec = calculate_epoch_reward(points.total_points, total_points_epoch, monthly_ecosystem_pool_carel());
    let net_carel_dec = carel_amount_dec * Decimal::new(95, 2); // 95% after tax
    let carel_amount = net_carel_dec.to_f64().unwrap_or(0.0);
    let total_points: f64 = points.total_points.to_string().parse().unwrap_or(0.0);

    // Execute claim transaction (mock)
    let tx_hash = format!("0x{}", hex::encode(&rand::random::<[u8; 32]>()));

    tracing::info!(
        "Rewards claimed: {} CAREL for {} points (user: {})",
        carel_amount,
        total_points,
        user_address
    );

    let response = ClaimResponse {
        tx_hash,
        amount_carel: carel_amount,
        points_converted: total_points,
    };

    Ok(Json(ApiResponse::success(response)))
}

/// POST /api/v1/rewards/convert
pub async fn convert_to_carel(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ConvertRequest>,
) -> Result<Json<ApiResponse<ClaimResponse>>> {
    let user_address = require_user(&headers, &state).await?;

    let current_epoch = (chrono::Utc::now().timestamp() / EPOCH_DURATION_SECONDS) as i64;
    let epoch = req.epoch.unwrap_or(current_epoch);
    if epoch < 0 {
        return Err(AppError::BadRequest("Invalid epoch".into()));
    }
    if let Some(points) = req.points {
        if points < 0.0 {
            return Err(AppError::BadRequest("Invalid points".into()));
        }
    }
    if let Some(total) = req.total_distribution_carel {
        if total < 0.0 {
            return Err(AppError::BadRequest("Invalid total_distribution_carel".into()));
        }
    }

    let points_value = if let Some(points) = req.points {
        Decimal::from_f64_retain(points).unwrap_or(Decimal::ZERO)
    } else {
        state.db
            .get_user_points(&user_address, epoch)
            .await?
            .map(|p| p.total_points)
            .unwrap_or(Decimal::ZERO)
    };

    let total_points_epoch: Decimal = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_points), 0) FROM points WHERE epoch = $1"
    )
    .bind(epoch)
    .fetch_one(state.db.pool())
    .await?;

    let total_distribution = req
        .total_distribution_carel
        .and_then(Decimal::from_f64)
        .unwrap_or_else(monthly_ecosystem_pool_carel);

    let mut carel_amount_dec = calculate_epoch_reward(points_value, total_points_epoch, total_distribution);
    tracing::info!(
        "Convert points: user={}, epoch={}, points={}, total_points_epoch={}, total_distribution={}",
        user_address,
        epoch,
        points_value,
        total_points_epoch,
        total_distribution
    );
    match convert_points_onchain(&state, epoch, points_value, total_distribution).await {
        Ok(Some(onchain_amount)) => {
            tracing::info!("Using on-chain conversion for user={} epoch={}", user_address, epoch);
            carel_amount_dec = onchain_amount;
        }
        Ok(None) => {
            tracing::debug!("Using off-chain conversion for user={} epoch={}", user_address, epoch);
        }
        Err(err) => {
            tracing::warn!("On-chain conversion failed, fallback to off-chain: {}", err);
        }
    }
    let carel_amount = carel_amount_dec.to_f64().unwrap_or(0.0);
    let points_converted = points_value.to_f64().unwrap_or(0.0);

    // Execute conversion (mock)
    let tx_hash = format!("0x{}", hex::encode(&rand::random::<[u8; 32]>()));

    let response = ClaimResponse {
        tx_hash,
        amount_carel: carel_amount,
        points_converted,
    };

    Ok(Json(ApiResponse::success(response)))
}

async fn convert_points_onchain(
    state: &AppState,
    epoch: i64,
    user_points: Decimal,
    total_distribution: Decimal,
) -> Result<Option<Decimal>> {
    let contract = state.config.point_storage_address.trim();
    if contract.is_empty() || contract.starts_with("0x0000") {
        return Ok(None);
    }

    let points_u128 = user_points.trunc().to_u128().unwrap_or(0);
    let dist_u128 = total_distribution.trunc().to_u128().unwrap_or(0);
    let (points_low, points_high) = to_u256_strings(points_u128);
    let (dist_low, dist_high) = to_u256_strings(dist_u128);

    let client = StarknetClient::new(state.config.starknet_rpc_url.clone());
    let calldata = vec![
        (epoch as u64).to_string(),
        points_low,
        points_high,
        dist_low,
        dist_high,
    ];

    let result = client
        .call_contract(contract, "convert_points_to_carel", calldata)
        .await?;

    let carel_u128 = parse_u256_low(&result)?;
    Ok(Some(Decimal::from_u128(carel_u128).unwrap_or(Decimal::ZERO)))
}

fn to_u256_strings(value: u128) -> (String, String) {
    (value.to_string(), "0".to_string())
}

fn parse_u256_low(values: &[String]) -> Result<u128> {
    if values.len() < 2 {
        return Err(AppError::Internal("Invalid u256 response".into()));
    }
    let low = parse_felt_u128(&values[0])?;
    let high = parse_felt_u128(&values[1])?;
    if high != 0 {
        return Err(AppError::Internal("u256 value too large".into()));
    }
    Ok(low)
}

fn parse_felt_u128(value: &str) -> Result<u128> {
    if let Some(stripped) = value.strip_prefix("0x") {
        u128::from_str_radix(stripped, 16)
            .map_err(|e| AppError::Internal(format!("Invalid felt hex: {}", e)))
    } else {
        value.parse::<u128>()
            .map_err(|e| AppError::Internal(format!("Invalid felt dec: {}", e)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calculate_epoch_reward_handles_zero() {
        let reward = calculate_epoch_reward(Decimal::from(100), Decimal::ZERO, Decimal::from(1000));
        assert_eq!(reward, Decimal::ZERO);
    }
}
