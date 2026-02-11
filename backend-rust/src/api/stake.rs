use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};

use crate::{
    error::Result,
    models::ApiResponse,
    // 1. Import hasher agar fungsi di hash.rs terhitung "used"
    crypto::hash,
};
use crate::services::onchain::{OnchainReader, parse_felt, u256_from_felts, felt_to_u128};
use starknet_core::types::FunctionCall;
use starknet_core::utils::get_selector_from_name;

use super::{AppState, require_user};

#[derive(Debug, Serialize)]
pub struct StakingPool {
    pub pool_id: String,
    pub token: String,
    pub total_staked: f64,
    pub tvl_usd: f64,
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

fn build_position_id(user_address: &str, pool_id: &str, now_ts: i64) -> String {
    let pos_data = format!("{}{}{}", user_address, pool_id, now_ts);
    format!("POS_{}", hash::hash_string(&pos_data))
}

fn build_stake_tx_hash(user_address: &str, pool_id: &str, now_ts: i64) -> String {
    let pos_data = format!("{}{}{}", user_address, pool_id, now_ts);
    hash::hash_string(&format!("stake_{}", pos_data))
}

fn build_withdraw_tx_hash(user_address: &str, position_id: &str, now_ts: i64) -> String {
    hash::hash_string(&format!("withdraw_{}{}{}", user_address, position_id, now_ts))
}

fn fallback_price_for(token: &str) -> f64 {
    match token.to_uppercase().as_str() {
        "USDT" | "USDC" => 1.0,
        _ => 1.0,
    }
}

const CAREL_DECIMALS: f64 = 1_000_000_000_000_000_000.0;

fn u128_to_token_amount(value: u128) -> f64 {
    (value as f64) / CAREL_DECIMALS
}

async fn latest_price(state: &AppState, token: &str) -> Result<f64> {
    let token = token.to_uppercase();
    let price: Option<f64> = sqlx::query_scalar(
        "SELECT close::FLOAT FROM price_history WHERE token = $1 ORDER BY timestamp DESC LIMIT 1",
    )
    .bind(&token)
    .fetch_optional(state.db.pool())
    .await?;

    Ok(price.unwrap_or_else(|| fallback_price_for(&token)))
}

/// GET /api/v1/stake/pools
pub async fn get_pools(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<StakingPool>>>> {
    // Mock staking pools
    let mut pools = vec![
        StakingPool {
            pool_id: "CAREL".to_string(),
            token: "CAREL".to_string(),
            total_staked: 50_000_000.0,
            tvl_usd: 0.0,
            apy: 25.5,
            rewards_per_day: 3424.65,
            min_stake: 100.0,
            lock_period: None,
        },
        StakingPool {
            pool_id: "BTC".to_string(),
            token: "BTC".to_string(),
            total_staked: 150.5,
            tvl_usd: 0.0,
            apy: 8.2,
            rewards_per_day: 0.034,
            min_stake: 0.001,
            lock_period: Some(30),
        },
        StakingPool {
            pool_id: "STRK".to_string(),
            token: "STRK".to_string(),
            total_staked: 5_000_000.0,
            tvl_usd: 0.0,
            apy: 12.8,
            rewards_per_day: 1753.42,
            min_stake: 10.0,
            lock_period: Some(14),
        },
        StakingPool {
            pool_id: "USDC".to_string(),
            token: "USDC".to_string(),
            total_staked: 2_500_000.0,
            tvl_usd: 0.0,
            apy: 6.5,
            rewards_per_day: 445.21,
            min_stake: 100.0,
            lock_period: None,
        },
    ];

    for pool in &mut pools {
        let price = latest_price(&state, pool.token.as_str()).await?;
        pool.tvl_usd = pool.total_staked * price;
    }

    Ok(Json(ApiResponse::success(pools)))
}

/// POST /api/v1/stake/deposit
pub async fn deposit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<DepositRequest>,
) -> Result<Json<ApiResponse<DepositResponse>>> {
    let user_address = require_user(&headers, &state).await?;
    let now = chrono::Utc::now().timestamp();

    let amount: f64 = req.amount.parse()
        .map_err(|_| crate::error::AppError::BadRequest("Invalid amount".to_string()))?;

    // 2. Gunakan hasher untuk membuat Position ID (Menghilangkan warning di hash.rs)
    let position_id = build_position_id(&user_address, &req.pool_id, now);

    // 3. Gunakan hasher untuk Tx Hash
    let tx_hash = build_stake_tx_hash(&user_address, &req.pool_id, now);

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
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<WithdrawRequest>,
) -> Result<Json<ApiResponse<DepositResponse>>> {
    let user_address = require_user(&headers, &state).await?;
    let now = chrono::Utc::now().timestamp();

    let amount: f64 = req.amount.parse()
        .map_err(|_| crate::error::AppError::BadRequest("Invalid amount".to_string()))?;

    // Gunakan hasher untuk Tx Hash withdraw
    let tx_hash = build_withdraw_tx_hash(&user_address, &req.position_id, now);

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
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<StakingPosition>>>> {
    let user_address = require_user(&headers, &state).await?;

    tracing::debug!("Fetching staking positions for user: {}", user_address);

    let mut positions = Vec::new();
    let Some(contract) = state.config.staking_carel_address.as_deref() else {
        return Ok(Json(ApiResponse::success(positions)));
    };
    if contract.trim().is_empty() || contract.starts_with("0x0000") {
        return Ok(Json(ApiResponse::success(positions)));
    }

    let reader = OnchainReader::from_config(&state.config)?;
    if let Some(info) = fetch_carel_stake_info(&reader, contract, &user_address).await? {
        if info.amount > 0 {
            let rewards = fetch_carel_rewards(&reader, contract, &user_address).await.unwrap_or(0);
            let started_at = info.start_time as i64;
            let unlock_at = started_at + 604800; // 7 days lock period (contract constant)
            positions.push(StakingPosition {
                position_id: build_position_id(&user_address, "CAREL", started_at),
                pool_id: "CAREL".to_string(),
                token: "CAREL".to_string(),
                amount: u128_to_token_amount(info.amount),
                rewards_earned: u128_to_token_amount(rewards),
                started_at,
                unlock_at: Some(unlock_at),
            });
        }
    }

    Ok(Json(ApiResponse::success(positions)))
}

struct CarelStakeInfo {
    amount: u128,
    start_time: u64,
}

async fn fetch_carel_stake_info(
    reader: &OnchainReader,
    contract: &str,
    user_address: &str,
) -> Result<Option<CarelStakeInfo>> {
    let call = FunctionCall {
        contract_address: parse_felt(contract)?,
        entry_point_selector: get_selector_from_name("get_stake_info")
            .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?,
        calldata: vec![parse_felt(user_address)?],
    };

    let result = reader.call(call).await?;
    if result.len() < 7 {
        return Ok(None);
    }

    let amount = u256_from_felts(&result[0], &result[1])?;
    let start_time = felt_to_u128(&result[3])? as u64;

    Ok(Some(CarelStakeInfo {
        amount,
        start_time,
    }))
}

async fn fetch_carel_rewards(
    reader: &OnchainReader,
    contract: &str,
    user_address: &str,
) -> Result<u128> {
    let call = FunctionCall {
        contract_address: parse_felt(contract)?,
        entry_point_selector: get_selector_from_name("calculate_rewards")
            .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?,
        calldata: vec![parse_felt(user_address)?],
    };

    let result = reader.call(call).await?;
    if result.len() < 2 {
        return Ok(0);
    }

    u256_from_felts(&result[0], &result[1])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_position_id_has_prefix() {
        // Memastikan position_id memiliki prefix POS_
        let id = build_position_id("0xabc", "CAREL", 1_700_000_000);
        assert!(id.starts_with("POS_0x"));
    }

    #[test]
    fn build_withdraw_tx_hash_is_deterministic() {
        // Memastikan hash withdraw konsisten untuk input yang sama
        let hash1 = build_withdraw_tx_hash("0xabc", "POS_1", 1_700_000_000);
        let hash2 = build_withdraw_tx_hash("0xabc", "POS_1", 1_700_000_000);
        assert_eq!(hash1, hash2);
    }
}
