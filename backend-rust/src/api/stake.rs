use axum::{extract::State, http::HeaderMap, Json};
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use crate::services::onchain::{felt_to_u128, parse_felt, u256_from_felts, OnchainReader};
use crate::{
    // 1. Import hasher agar fungsi di hash.rs terhitung "used"
    crypto::hash,
    error::Result,
    models::ApiResponse,
    services::nft_discount::consume_nft_usage_if_active,
};
use starknet_core::types::FunctionCall;
use starknet_core::utils::get_selector_from_name;

use super::{require_starknet_user, AppState};

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
    pub onchain_tx_hash: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct WithdrawRequest {
    pub position_id: String,
    pub amount: String,
    pub onchain_tx_hash: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DepositResponse {
    pub position_id: String,
    pub tx_hash: String,
    pub amount: f64,
}

const STARKNET_ONCHAIN_STAKE_POOLS: &[&str] = &["CAREL", "USDC", "USDT", "WBTC", "STRK"];
const BTC_GARDEN_POOL: &str = "BTC";

fn normalize_pool_id(pool_id: &str) -> String {
    pool_id.trim().to_ascii_uppercase()
}

fn resolve_pool_token(pool_id: &str) -> Option<&'static str> {
    match normalize_pool_id(pool_id).as_str() {
        "CAREL" => Some("CAREL"),
        "USDC" => Some("USDC"),
        "USDT" => Some("USDT"),
        "WBTC" => Some("WBTC"),
        "STRK" => Some("STRK"),
        "BTC" => Some("BTC"),
        _ => None,
    }
}

fn is_starknet_onchain_pool(token: &str) -> bool {
    STARKNET_ONCHAIN_STAKE_POOLS
        .iter()
        .any(|supported| supported.eq_ignore_ascii_case(token))
}

fn parse_pool_from_position_id(position_id: &str) -> Option<String> {
    // New format: POS_<POOL>_<HASH>
    let mut parts = position_id.splitn(3, '_');
    let Some(prefix) = parts.next() else {
        return None;
    };
    if prefix != "POS" {
        return None;
    }
    let Some(pool) = parts.next() else {
        return None;
    };
    resolve_pool_token(pool).map(|token| token.to_string())
}

fn build_position_id(user_address: &str, pool_id: &str, now_ts: i64) -> String {
    let pos_data = format!("{}{}{}", user_address, pool_id, now_ts);
    format!(
        "POS_{}_{}",
        normalize_pool_id(pool_id),
        hash::hash_string(&pos_data)
    )
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

fn fallback_price_for(token: &str) -> f64 {
    match token.to_uppercase().as_str() {
        "USDT" | "USDC" => 1.0,
        "BTC" | "WBTC" => 70_000.0,
        _ => 1.0,
    }
}

const CAREL_DECIMALS: f64 = 1_000_000_000_000_000_000.0;

fn u128_to_token_amount(value: u128) -> f64 {
    (value as f64) / CAREL_DECIMALS
}

async fn latest_price(state: &AppState, token: &str) -> Result<f64> {
    let token = token.to_uppercase();
    let mut candidates = vec![token.clone()];
    if token == "WBTC" {
        candidates.push("BTC".to_string());
    } else if token == "BTC" {
        candidates.push("WBTC".to_string());
    }

    for candidate in candidates {
        let price: Option<f64> = sqlx::query_scalar(
            "SELECT close::FLOAT FROM price_history WHERE token = $1 ORDER BY timestamp DESC LIMIT 1",
        )
        .bind(&candidate)
        .fetch_optional(state.db.pool())
        .await?;

        if let Some(value) = price.filter(|value| value.is_finite() && *value > 0.0) {
            return Ok(value);
        }
    }

    Ok(fallback_price_for(&token))
}

fn staking_contract_or_error(state: &AppState) -> Result<&str> {
    let Some(contract) = state.config.staking_carel_address.as_deref() else {
        return Err(crate::error::AppError::BadRequest(
            "STAKING_CAREL_ADDRESS is not configured".to_string(),
        ));
    };
    if contract.trim().is_empty() || contract.starts_with("0x0000") {
        return Err(crate::error::AppError::BadRequest(
            "STAKING_CAREL_ADDRESS is placeholder/invalid".to_string(),
        ));
    }
    Ok(contract)
}

/// GET /api/v1/stake/pools
pub async fn get_pools(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<StakingPool>>>> {
    // Current staking business model on testnet:
    // CAREL tiered APY (8/12/15), STRK 7, BTC 6, stablecoin 7.
    // API keeps one CAREL row; tier detail is rendered in frontend text.
    let mut pools = vec![
        StakingPool {
            pool_id: "CAREL".to_string(),
            token: "CAREL".to_string(),
            total_staked: 50_000_000.0,
            tvl_usd: 0.0,
            apy: 8.0,
            rewards_per_day: 10958.9,
            min_stake: 100.0,
            lock_period: None,
        },
        StakingPool {
            pool_id: "STRK".to_string(),
            token: "STRK".to_string(),
            total_staked: 250_000.0,
            tvl_usd: 0.0,
            apy: 7.0,
            rewards_per_day: 47.95,
            min_stake: 10.0,
            lock_period: None,
        },
        StakingPool {
            pool_id: "WBTC".to_string(),
            token: "WBTC".to_string(),
            total_staked: 10.43,
            tvl_usd: 0.0,
            apy: 6.0,
            rewards_per_day: 0.017,
            min_stake: 0.001,
            lock_period: Some(14),
        },
        StakingPool {
            pool_id: "USDT".to_string(),
            token: "USDT".to_string(),
            total_staked: 2_400_000.0,
            tvl_usd: 0.0,
            apy: 7.0,
            rewards_per_day: 460.27,
            min_stake: 100.0,
            lock_period: None,
        },
        StakingPool {
            pool_id: "USDC".to_string(),
            token: "USDC".to_string(),
            total_staked: 2_500_000.0,
            tvl_usd: 0.0,
            apy: 7.0,
            rewards_per_day: 479.45,
            min_stake: 100.0,
            lock_period: None,
        },
        StakingPool {
            // Native BTC staking route will be integrated through Garden API flow.
            pool_id: "BTC".to_string(),
            token: "BTC".to_string(),
            total_staked: 0.0,
            tvl_usd: 0.0,
            apy: 6.0,
            rewards_per_day: 0.0,
            min_stake: 0.001,
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
    let user_address = require_starknet_user(&headers, &state).await?;
    let now = chrono::Utc::now().timestamp();

    let amount: f64 = req
        .amount
        .parse()
        .map_err(|_| crate::error::AppError::BadRequest("Invalid amount".to_string()))?;
    if amount <= 0.0 {
        return Err(crate::error::AppError::BadRequest(
            "Amount must be greater than 0".to_string(),
        ));
    }
    let pool_token = resolve_pool_token(&req.pool_id).ok_or_else(|| {
        crate::error::AppError::BadRequest("Unsupported staking pool".to_string())
    })?;
    if pool_token == BTC_GARDEN_POOL {
        return Err(crate::error::AppError::BadRequest(
            "BTC staking native route is coming soon via Garden API.".to_string(),
        ));
    }
    if !is_starknet_onchain_pool(pool_token) {
        return Err(crate::error::AppError::BadRequest(
            "Pool belum didukung untuk on-chain staking".to_string(),
        ));
    }

    let onchain_tx_hash = normalize_onchain_tx_hash(req.onchain_tx_hash.as_deref())?;
    let tx_hash = onchain_tx_hash.ok_or_else(|| {
        crate::error::AppError::BadRequest(
            "Stake requires onchain_tx_hash from user-signed Starknet transaction".to_string(),
        )
    })?;

    // 2. Gunakan hasher untuk membuat Position ID (Menghilangkan warning di hash.rs)
    let position_id = build_position_id(&user_address, pool_token, now);
    if pool_token == "CAREL" {
        let _ = staking_contract_or_error(&state)?;
    }

    tracing::info!(
        "User {} staking deposit: {} in pool {} (position: {})",
        user_address,
        amount,
        pool_token,
        position_id
    );

    let price = latest_price(&state, pool_token).await?;
    let usd_value = amount * price;
    let tx = crate::models::Transaction {
        tx_hash: tx_hash.clone(),
        block_number: 0,
        user_address: user_address.clone(),
        tx_type: "stake".to_string(),
        token_in: Some(pool_token.to_string()),
        token_out: Some(pool_token.to_string()),
        amount_in: Some(rust_decimal::Decimal::from_f64_retain(amount).unwrap()),
        amount_out: Some(rust_decimal::Decimal::from_f64_retain(amount).unwrap()),
        usd_value: Some(rust_decimal::Decimal::from_f64_retain(usd_value).unwrap()),
        fee_paid: None,
        points_earned: Some(rust_decimal::Decimal::ZERO),
        timestamp: chrono::Utc::now(),
        processed: false,
    };
    state.db.save_transaction(&tx).await?;
    if let Err(err) = consume_nft_usage_if_active(&state.config, &user_address, "stake_deposit").await
    {
        tracing::warn!(
            "Failed to consume NFT discount usage after stake deposit: user={} tx_hash={} err={}",
            user_address,
            tx_hash,
            err
        );
    }

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
    let user_address = require_starknet_user(&headers, &state).await?;

    let amount: f64 = req
        .amount
        .parse()
        .map_err(|_| crate::error::AppError::BadRequest("Invalid amount".to_string()))?;
    if amount <= 0.0 {
        return Err(crate::error::AppError::BadRequest(
            "Amount must be greater than 0".to_string(),
        ));
    }

    let pool_token = parse_pool_from_position_id(&req.position_id).unwrap_or_else(|| "CAREL".to_string());
    if pool_token.eq_ignore_ascii_case(BTC_GARDEN_POOL) {
        return Err(crate::error::AppError::BadRequest(
            "BTC staking native route is coming soon via Garden API.".to_string(),
        ));
    }

    let onchain_tx_hash = normalize_onchain_tx_hash(req.onchain_tx_hash.as_deref())?;
    let tx_hash = onchain_tx_hash.ok_or_else(|| {
        crate::error::AppError::BadRequest(
            "Unstake requires onchain_tx_hash from user-signed Starknet transaction".to_string(),
        )
    })?;
    if pool_token.eq_ignore_ascii_case("CAREL") {
        let _ = staking_contract_or_error(&state)?;
    }

    tracing::info!(
        "User {} stake withdraw: {} from position {}",
        user_address,
        amount,
        req.position_id
    );

    let price = latest_price(&state, &pool_token).await?;
    let usd_value = amount * price;
    let tx = crate::models::Transaction {
        tx_hash: tx_hash.clone(),
        block_number: 0,
        user_address: user_address.clone(),
        tx_type: "unstake".to_string(),
        token_in: Some(pool_token.to_string()),
        token_out: Some(pool_token.to_string()),
        amount_in: Some(rust_decimal::Decimal::from_f64_retain(amount).unwrap()),
        amount_out: Some(rust_decimal::Decimal::from_f64_retain(amount).unwrap()),
        usd_value: Some(rust_decimal::Decimal::from_f64_retain(usd_value).unwrap()),
        fee_paid: None,
        points_earned: Some(rust_decimal::Decimal::ZERO),
        timestamp: chrono::Utc::now(),
        processed: false,
    };
    state.db.save_transaction(&tx).await?;
    if let Err(err) = consume_nft_usage_if_active(&state.config, &user_address, "stake_withdraw").await
    {
        tracing::warn!(
            "Failed to consume NFT discount usage after stake withdraw: user={} tx_hash={} err={}",
            user_address,
            tx_hash,
            err
        );
    }

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
    let user_address = require_starknet_user(&headers, &state).await?;

    tracing::debug!("Fetching staking positions for user: {}", user_address);

    let mut positions = Vec::new();
    if let Some(contract) = state.config.staking_carel_address.as_deref() {
        if !contract.trim().is_empty() && !contract.starts_with("0x0000") {
            match OnchainReader::from_config(&state.config) {
                Ok(reader) => {
                    let stake_info =
                        match fetch_carel_stake_info(&reader, contract, &user_address).await {
                            Ok(info) => info,
                            Err(err) => {
                                tracing::warn!(
                                    "Failed to read on-chain staking positions for {}: {}",
                                    user_address,
                                    err
                                );
                                None
                            }
                        };
                    if let Some(info) = stake_info {
                        if info.amount > 0 {
                            let rewards = match fetch_carel_rewards(&reader, contract, &user_address).await {
                                Ok(value) => value,
                                Err(err) => {
                                    tracing::warn!(
                                        "Failed to read on-chain staking rewards for {}: {}",
                                        user_address,
                                        err
                                    );
                                    0
                                }
                            };
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
                }
                Err(err) => {
                    tracing::warn!(
                        "Failed to initialize on-chain staking reader for {}: {}",
                        user_address,
                        err
                    );
                }
            }
        }
    }

    // Add non-CAREL Starknet staking positions from transaction ledger
    // (USDC/USDT/WBTC). This keeps UI positions in sync for pools handled
    // via user-signed wallet tx + backend verification flow.
    #[derive(Debug, FromRow)]
    struct StakeLedgerRow {
        token: String,
        net_amount: Decimal,
        last_activity: chrono::DateTime<chrono::Utc>,
    }

    let stake_rows = sqlx::query_as::<_, StakeLedgerRow>(
        r#"
        SELECT
            UPPER(token_in) AS token,
            COALESCE(
                SUM(
                    CASE
                        WHEN tx_type = 'stake' THEN amount_in
                        WHEN tx_type = 'unstake' THEN -amount_in
                        ELSE 0
                    END
                ),
                0
            ) AS net_amount,
            MAX(timestamp) AS last_activity
        FROM transactions
        WHERE LOWER(user_address) = LOWER($1)
          AND token_in IS NOT NULL
          AND tx_type IN ('stake', 'unstake')
        GROUP BY UPPER(token_in)
        "#,
    )
    .bind(&user_address)
    .fetch_all(state.db.pool())
    .await
    .unwrap_or_default();

    for row in stake_rows {
        let token = row.token.to_ascii_uppercase();
        if token == "CAREL" {
            continue;
        }
        if !is_starknet_onchain_pool(&token) {
            continue;
        }
        let Some(net_amount) = row.net_amount.to_f64() else {
            continue;
        };
        if net_amount <= 0.0 {
            continue;
        }
        let started_at = row.last_activity.timestamp();
        let unlock_at = if token == "WBTC" {
            Some(started_at + 14 * 24 * 60 * 60)
        } else {
            None
        };
        positions.push(StakingPosition {
            position_id: build_position_id(&user_address, &token, started_at),
            pool_id: token.clone(),
            token,
            amount: net_amount,
            rewards_earned: 0.0,
            started_at,
            unlock_at,
        });
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

    Ok(Some(CarelStakeInfo { amount, start_time }))
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
        // Memastikan position_id memiliki prefix POS_<POOL>_0x
        let id = build_position_id("0xabc", "CAREL", 1_700_000_000);
        assert!(id.starts_with("POS_CAREL_0x"));
    }

    #[test]
    fn normalize_onchain_tx_hash_rejects_non_hex() {
        // Memastikan hash non-hex ditolak
        let result = normalize_onchain_tx_hash(Some("0xZZ"));
        assert!(result.is_err());
    }
}
