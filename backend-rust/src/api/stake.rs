use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::{
    error::Result,
    models::ApiResponse,
    // 1. Import hasher agar fungsi di hash.rs terhitung "used"
    crypto::hash,
};

use super::AppState;

#[derive(Debug, Serialize)]
pub struct StakingPool {
    pub pool_id: String,
    pub token: String,
    pub total_staked: f64,
    pub apy: f64,
    pub rewards_per_day: f64,
    pub min_stake: f64,
    pub lock_period: Option<i64>, // days
}

#[derive(Debug, Serialize)]
pub struct StakingPosition {
    pub position_id: String,
    pub pool_id: String,
    pub token: String,
    pub amount: f64,
    pub rewards_earned: f64,
    pub started_at: i64,
    pub unlock_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct DepositRequest {
    pub pool_id: String,
    pub amount: String,
}

#[derive(Debug, Deserialize)]
pub struct WithdrawRequest {
    pub position_id: String,
    pub amount: String,
}

#[derive(Debug, Serialize)]
pub struct DepositResponse {
    pub position_id: String,
    pub tx_hash: String,
    pub amount: f64,
}

/// GET /api/v1/stake/pools
pub async fn get_pools(
    State(_state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<StakingPool>>>> {
    // Mock staking pools
    let pools = vec![
        StakingPool {
            pool_id: "CAREL".to_string(),
            token: "CAREL".to_string(),
            total_staked: 50_000_000.0,
            apy: 25.5,
            rewards_per_day: 3424.65,
            min_stake: 100.0,
            lock_period: None,
        },
        StakingPool {
            pool_id: "BTC".to_string(),
            token: "BTC".to_string(),
            total_staked: 150.5,
            apy: 8.2,
            rewards_per_day: 0.034,
            min_stake: 0.001,
            lock_period: Some(30),
        },
        StakingPool {
            pool_id: "STRK".to_string(),
            token: "STRK".to_string(),
            total_staked: 5_000_000.0,
            apy: 12.8,
            rewards_per_day: 1753.42,
            min_stake: 10.0,
            lock_period: Some(14),
        },
        StakingPool {
            pool_id: "USDC".to_string(),
            token: "USDC".to_string(),
            total_staked: 2_500_000.0,
            apy: 6.5,
            rewards_per_day: 445.21,
            min_stake: 100.0,
            lock_period: None,
        },
    ];

    Ok(Json(ApiResponse::success(pools)))
}

/// POST /api/v1/stake/deposit
pub async fn deposit(
    State(_state): State<AppState>,
    Json(req): Json<DepositRequest>,
) -> Result<Json<ApiResponse<DepositResponse>>> {
    let user_address = "0x1234...";
    let now = chrono::Utc::now().timestamp();

    let amount: f64 = req.amount.parse()
        .map_err(|_| crate::error::AppError::BadRequest("Invalid amount".to_string()))?;

    // 2. Gunakan hasher untuk membuat Position ID (Menghilangkan warning di hash.rs)
    let pos_data = format!("{}{}{}", user_address, req.pool_id, now);
    let position_id = format!("POS_{}", hash::hash_string(&pos_data));

    // 3. Gunakan hasher untuk Tx Hash
    let tx_hash = hash::hash_string(&format!("stake_{}", pos_data));

    tracing::info!(
        "User {} staking deposit: {} in pool {} (position: {})",
        user_address,
        amount,
        req.pool_id,
        position_id
    );

    Ok(Json(ApiResponse::success(DepositResponse {
        position_id,
        tx_hash,
        amount,
    })))
}

/// POST /api/v1/stake/withdraw
pub async fn withdraw(
    State(_state): State<AppState>,
    Json(req): Json<WithdrawRequest>,
) -> Result<Json<ApiResponse<DepositResponse>>> {
    let user_address = "0x1234...";
    let now = chrono::Utc::now().timestamp();

    let amount: f64 = req.amount.parse()
        .map_err(|_| crate::error::AppError::BadRequest("Invalid amount".to_string()))?;

    // Gunakan hasher untuk Tx Hash withdraw
    let tx_hash = hash::hash_string(&format!("withdraw_{}{}{}", user_address, req.position_id, now));

    tracing::info!(
        "User {} stake withdraw: {} from position {}",
        user_address,
        amount,
        req.position_id
    );

    Ok(Json(ApiResponse::success(DepositResponse {
        position_id: req.position_id,
        tx_hash,
        amount,
    })))
}

/// GET /api/v1/stake/positions
pub async fn get_positions(
    State(_state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<StakingPosition>>>> {
    let user_address = "0x1234...";
    
    tracing::debug!("Fetching staking positions for user: {}", user_address);

    let positions = vec![
        StakingPosition {
            position_id: "POS_001".to_string(),
            pool_id: "CAREL".to_string(),
            token: "CAREL".to_string(),
            amount: 10000.0,
            rewards_earned: 234.56,
            started_at: chrono::Utc::now().timestamp() - 86400 * 15,
            unlock_at: None,
        },
        StakingPosition {
            position_id: "POS_002".to_string(),
            pool_id: "BTC".to_string(),
            token: "BTC".to_string(),
            amount: 0.5,
            rewards_earned: 0.0023,
            started_at: chrono::Utc::now().timestamp() - 86400 * 7,
            unlock_at: Some(chrono::Utc::now().timestamp() + 86400 * 23),
        },
    ];

    Ok(Json(ApiResponse::success(positions)))
}
