use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use rust_decimal::prelude::{FromPrimitive, ToPrimitive};
use rust_decimal::Decimal;

use crate::{
    constants::{EPOCH_DURATION_SECONDS, POINTS_TO_CAREL_RATIO},
    error::Result,
    models::ApiResponse,
};

use super::{AppState, require_user};

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
    pub points: f64,
}

fn points_to_carel(points: f64) -> f64 {
    points * POINTS_TO_CAREL_RATIO
}

fn monthly_ecosystem_pool_carel() -> Decimal {
    let total_supply = Decimal::from_i64(1_000_000_000).unwrap();
    let bps = Decimal::from_i64(4000).unwrap();
    let denom = Decimal::from_i64(10000).unwrap();
    let months = Decimal::from_i64(36).unwrap();
    total_supply * bps / denom / months
}

fn calculate_epoch_reward(points: Decimal, total_points: Decimal) -> Decimal {
    if total_points.is_zero() {
        return Decimal::ZERO;
    }
    (points / total_points) * monthly_ecosystem_pool_carel()
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

    let carel_amount_dec = calculate_epoch_reward(points.total_points, total_points_epoch);
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
    let _user_address = require_user(&headers, &state).await?;

    // Calculate CAREL amount
    let carel_amount = points_to_carel(req.points);

    // Execute conversion (mock)
    let tx_hash = format!("0x{}", hex::encode(&rand::random::<[u8; 32]>()));

    let response = ClaimResponse {
        tx_hash,
        amount_carel: carel_amount,
        points_converted: req.points,
    };

    Ok(Json(ApiResponse::success(response)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn points_to_carel_uses_ratio() {
        // Memastikan konversi poin ke CAREL benar
        let carel = points_to_carel(100.0);
        assert!((carel - (100.0 * POINTS_TO_CAREL_RATIO)).abs() < f64::EPSILON);
    }
}
