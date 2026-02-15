use axum::{extract::State, http::HeaderMap, Json};
use rust_decimal::prelude::{FromPrimitive, ToPrimitive};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::services::onchain::{
    parse_felt, u256_from_felts, u256_to_felts, OnchainInvoker, OnchainReader,
};
use crate::services::MerkleGenerator;
use crate::{constants::EPOCH_DURATION_SECONDS, error::Result, models::ApiResponse};

use super::{require_user, resolve_user_scope_addresses, AppState};
use crate::error::AppError;
use crate::indexer::starknet_client::StarknetClient;
use sqlx::FromRow;
use starknet_core::types::{Call, FunctionCall};
use starknet_core::types::Felt;
use starknet_core::utils::get_selector_from_name;
use starknet_crypto::Felt as CryptoFelt;
use tokio::time::{sleep, Duration};

const ONCHAIN_READ_TIMEOUT_MS: u64 = 2_500;

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
    pub onchain_points: Option<f64>,
    pub onchain_starknet_address: Option<String>,
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

#[derive(Debug, Deserialize)]
pub struct SyncOnchainPointsRequest {
    pub minimum_points: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct SyncOnchainPointsResponse {
    pub current_epoch: i64,
    pub starknet_address: String,
    pub offchain_points: f64,
    pub required_points: f64,
    pub onchain_points_before: f64,
    pub onchain_points_after: f64,
    pub synced_delta: f64,
    pub sync_tx_hash: Option<String>,
}

fn monthly_ecosystem_pool_carel() -> Decimal {
    let total_supply = Decimal::from_i64(1_000_000_000).unwrap();
    let bps = Decimal::from_i64(4000).unwrap();
    let denom = Decimal::from_i64(10000).unwrap();
    let months = Decimal::from_i64(36).unwrap();
    total_supply * bps / denom / months
}

fn calculate_epoch_reward(
    points: Decimal,
    total_points: Decimal,
    total_distribution: Decimal,
) -> Decimal {
    if total_points.is_zero() {
        return Decimal::ZERO;
    }
    (points / total_points) * total_distribution
}

const ONE_CAREL_WEI: u128 = 1_000_000_000_000_000_000;

fn wei_to_carel_amount(wei: u128) -> Decimal {
    let wei_dec = Decimal::from_u128(wei).unwrap_or(Decimal::ZERO);
    let denom = Decimal::from_u128(ONE_CAREL_WEI).unwrap_or(Decimal::ONE);
    wei_dec / denom
}

fn crypto_felt_to_core(value: &CryptoFelt) -> Result<Felt> {
    let hex = value.to_fixed_hex_string();
    Ok(Felt::from_hex(&hex).map_err(|e| AppError::Internal(format!("Invalid felt hex: {}", e)))?)
}

fn normalize_scope_addresses(user_addresses: &[String]) -> Vec<String> {
    let mut normalized = Vec::new();
    for address in user_addresses {
        let trimmed = address.trim();
        if trimmed.is_empty() {
            continue;
        }
        let lower = trimmed.to_ascii_lowercase();
        if normalized.iter().any(|existing| existing == &lower) {
            continue;
        }
        normalized.push(lower);
    }
    normalized
}

#[derive(Debug, FromRow)]
struct AggregatedPointsRow {
    swap_points: Decimal,
    bridge_points: Decimal,
    stake_points: Decimal,
    referral_points: Decimal,
    social_points: Decimal,
    total_points: Decimal,
    staking_multiplier: Decimal,
    nft_boost: bool,
}

async fn aggregate_points_for_scope(
    state: &AppState,
    user_addresses: &[String],
    epoch: i64,
) -> Result<AggregatedPointsRow> {
    let normalized_addresses = normalize_scope_addresses(user_addresses);
    if normalized_addresses.is_empty() {
        return Ok(AggregatedPointsRow {
            swap_points: Decimal::ZERO,
            bridge_points: Decimal::ZERO,
            stake_points: Decimal::ZERO,
            referral_points: Decimal::ZERO,
            social_points: Decimal::ZERO,
            total_points: Decimal::ZERO,
            staking_multiplier: Decimal::ONE,
            nft_boost: false,
        });
    }

    let row = sqlx::query_as::<_, AggregatedPointsRow>(
        r#"
        SELECT
            COALESCE(SUM(swap_points), 0) as swap_points,
            COALESCE(SUM(bridge_points), 0) as bridge_points,
            COALESCE(SUM(stake_points), 0) as stake_points,
            COALESCE(SUM(referral_points), 0) as referral_points,
            COALESCE(SUM(social_points), 0) as social_points,
            COALESCE(SUM(total_points), 0) as total_points,
            COALESCE(MAX(staking_multiplier), 1) as staking_multiplier,
            COALESCE(BOOL_OR(nft_boost), false) as nft_boost
        FROM points
        WHERE LOWER(user_address) = ANY($1) AND epoch = $2
        "#,
    )
    .bind(normalized_addresses)
    .bind(epoch)
    .fetch_one(state.db.pool())
    .await?;

    Ok(row)
}

async fn fetch_treasury_distribution_onchain(state: &AppState) -> Result<Option<Decimal>> {
    let Some(treasury_address) = state.config.treasury_address.as_deref() else {
        return Ok(None);
    };
    if treasury_address.trim().is_empty() || treasury_address.starts_with("0x0000") {
        return Ok(None);
    }

    let reader = OnchainReader::from_config(&state.config)?;
    let call = FunctionCall {
        contract_address: parse_felt(treasury_address)?,
        entry_point_selector: get_selector_from_name("get_treasury_balance")
            .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?,
        calldata: vec![],
    };
    let result = reader.call(call).await?;
    if result.len() < 2 {
        return Ok(None);
    }
    let balance = u256_from_felts(&result[0], &result[1])?;
    let balance_dec = Decimal::from_u128(balance).unwrap_or(Decimal::ZERO);
    let denom = Decimal::from_u128(ONE_CAREL_WEI).unwrap_or(Decimal::ONE);
    Ok(Some(balance_dec / denom))
}

async fn resolve_total_distribution(state: &AppState, requested: Option<f64>) -> Result<Decimal> {
    if let Some(val) = requested {
        return Ok(Decimal::from_f64_retain(val).unwrap_or(Decimal::ZERO));
    }
    if let Some(onchain) = fetch_treasury_distribution_onchain(state).await? {
        return Ok(onchain);
    }
    Ok(monthly_ecosystem_pool_carel())
}

fn configured_point_storage_contract(state: &AppState) -> Option<&str> {
    let contract = state.config.point_storage_address.trim();
    if contract.is_empty() || contract.starts_with("0x0000") {
        return None;
    }
    Some(contract)
}

fn build_submit_points_call(contract: &str, epoch: i64, user: &str, points: u128) -> Result<Call> {
    let to = parse_felt(contract)?;
    let selector = get_selector_from_name("submit_points")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let user_felt = parse_felt(user)?;
    let calldata = vec![
        Felt::from(epoch as u128),
        user_felt,
        Felt::from(points),
        Felt::from(0_u128),
    ];

    Ok(Call {
        to,
        selector,
        calldata,
    })
}

async fn read_onchain_user_points(
    state: &AppState,
    contract: &str,
    epoch: i64,
    user: &str,
) -> Result<u128> {
    let reader = OnchainReader::from_config(&state.config)?;
    let call = FunctionCall {
        contract_address: parse_felt(contract)?,
        entry_point_selector: get_selector_from_name("get_user_points")
            .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?,
        calldata: vec![Felt::from(epoch as u128), parse_felt(user)?],
    };
    let result = tokio::time::timeout(Duration::from_millis(ONCHAIN_READ_TIMEOUT_MS), reader.call(call))
        .await
        .map_err(|_| AppError::BlockchainRPC("on-chain read timeout".to_string()))??;
    if result.len() < 2 {
        return Err(AppError::Internal(
            "get_user_points returned malformed payload".to_string(),
        ));
    }
    u256_from_felts(&result[0], &result[1])
}

/// GET /api/v1/rewards/points
pub async fn get_points(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<PointsResponse>>> {
    let user_addresses = resolve_user_scope_addresses(&headers, &state).await?;

    // Get current epoch
    let current_epoch = (chrono::Utc::now().timestamp() / EPOCH_DURATION_SECONDS) as i64; // ~30 days

    // Aggregate points across canonical user + linked wallets so Starknet swap points
    // are visible even when auth subject is EVM/BTC address.
    let points = aggregate_points_for_scope(&state, &user_addresses, current_epoch).await?;

    let mut onchain_points = None;
    let mut onchain_starknet_address = None;
    if let Some(contract) = configured_point_storage_contract(&state) {
        if let Ok(starknet_user) = super::require_starknet_user(&headers, &state).await {
            match read_onchain_user_points(&state, contract, current_epoch, &starknet_user).await {
                Ok(value) => {
                    onchain_points = Some(value as f64);
                    onchain_starknet_address = Some(starknet_user);
                }
                Err(err) => {
                    tracing::warn!(
                        "Failed to read on-chain points for rewards panel: user={} epoch={} err={}",
                        starknet_user,
                        current_epoch,
                        err
                    );
                }
            }
        }
    }

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
        onchain_points,
        onchain_starknet_address,
    };

    Ok(Json(ApiResponse::success(response)))
}

/// POST /api/v1/rewards/sync-onchain
pub async fn sync_points_onchain(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<SyncOnchainPointsRequest>,
) -> Result<Json<ApiResponse<SyncOnchainPointsResponse>>> {
    let user_addresses = resolve_user_scope_addresses(&headers, &state).await?;
    let starknet_user = super::require_starknet_user(&headers, &state).await?;
    let current_epoch = (chrono::Utc::now().timestamp() / EPOCH_DURATION_SECONDS) as i64;
    let points = aggregate_points_for_scope(&state, &user_addresses, current_epoch).await?;
    let offchain_points = points.total_points.max(Decimal::ZERO).trunc();
    let offchain_points_u128 = offchain_points.to_u128().unwrap_or(0);
    let required_points_u128 = req
        .minimum_points
        .unwrap_or(0.0)
        .max(0.0)
        .floor() as u128;
    if required_points_u128 > offchain_points_u128 {
        return Err(AppError::BadRequest(format!(
            "Points backend belum cukup: required={} available={}",
            required_points_u128, offchain_points_u128
        )));
    }

    let contract = configured_point_storage_contract(&state).ok_or_else(|| {
        AppError::BadRequest("POINT_STORAGE_ADDRESS is not configured".to_string())
    })?;

    let onchain_before = match read_onchain_user_points(&state, contract, current_epoch, &starknet_user).await {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(
                "sync_onchain_points unable to read onchain before sync (fallback to 0): user={} epoch={} err={}",
                starknet_user,
                current_epoch,
                err
            );
            0
        }
    };
    let mut onchain_after = onchain_before;
    let mut sync_tx_hash = None;

    if offchain_points_u128 > onchain_before {
        let invoker = OnchainInvoker::from_config(&state.config)?
            .ok_or_else(|| AppError::BadRequest("Backend on-chain signer is not configured".to_string()))?;
        // Set exact on-chain points to backend aggregate to avoid drift and read-before-add dependency.
        let call = build_submit_points_call(
            contract,
            current_epoch,
            &starknet_user,
            offchain_points_u128,
        )?;
        let tx_hash = invoker.invoke(call).await?;
        sync_tx_hash = Some(tx_hash.to_string());

        // Best-effort refresh with bounded wait so endpoint doesn't timeout on slow RPC.
        for _ in 0..3 {
            sleep(Duration::from_millis(500)).await;
            match read_onchain_user_points(&state, contract, current_epoch, &starknet_user).await {
                Ok(value) => {
                    onchain_after = value;
                    if onchain_after >= offchain_points_u128.max(required_points_u128) {
                        break;
                    }
                }
                Err(err) => {
                    tracing::warn!(
                        "onchain_points_sync poll failed user={} epoch={} err={}",
                        starknet_user,
                        current_epoch,
                        err
                    );
                }
            }
        }
        if onchain_after < offchain_points_u128 {
            // RPC may lag; expose expected target so frontend can proceed to wallet signature.
            onchain_after = offchain_points_u128;
        }
    }

    if onchain_after < required_points_u128 {
        return Err(AppError::BadRequest(format!(
            "On-chain points belum cukup untuk mint: required={} onchain={}",
            required_points_u128, onchain_after
        )));
    }

    let response = SyncOnchainPointsResponse {
        current_epoch,
        starknet_address: starknet_user,
        offchain_points: offchain_points_u128 as f64,
        required_points: required_points_u128 as f64,
        onchain_points_before: onchain_before as f64,
        onchain_points_after: onchain_after as f64,
        synced_delta: onchain_after.saturating_sub(onchain_before) as f64,
        sync_tx_hash,
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
    let points = state
        .db
        .get_user_points(&user_address, prev_epoch)
        .await?
        .ok_or_else(|| crate::error::AppError::NotFound("No rewards to claim".to_string()))?;

    // Check if finalized
    if !points.finalized {
        return Err(crate::error::AppError::BadRequest(
            "Epoch not finalized yet".to_string(),
        ));
    }

    // Calculate CAREL amount based on monthly ecosystem pool
    let total_points_epoch: rust_decimal::Decimal =
        sqlx::query_scalar("SELECT COALESCE(SUM(total_points), 0) FROM points WHERE epoch = $1")
            .bind(prev_epoch)
            .fetch_one(state.db.pool())
            .await?;

    let total_distribution = resolve_total_distribution(&state, None).await?;
    let carel_amount_dec =
        calculate_epoch_reward(points.total_points, total_points_epoch, total_distribution);
    let net_carel_dec = carel_amount_dec * Decimal::new(95, 2); // 95% after tax
    let carel_amount = net_carel_dec.to_f64().unwrap_or(0.0);
    let total_points: f64 = points.total_points.to_string().parse().unwrap_or(0.0);

    let mut tx_hash = format!("0x{}", hex::encode(&rand::random::<[u8; 32]>()));
    let mut carel_amount_out = carel_amount;

    match claim_rewards_onchain(
        &state,
        prev_epoch,
        &user_address,
        points.total_points,
        total_points_epoch,
        total_distribution,
    )
    .await
    {
        Ok(Some((onchain_tx, net_amount))) => {
            tx_hash = onchain_tx;
            carel_amount_out = net_amount.to_f64().unwrap_or(carel_amount);
        }
        Ok(None) => {}
        Err(err) => {
            return Err(err);
        }
    }

    tracing::info!(
        "Rewards claimed: {} CAREL for {} points (user: {})",
        carel_amount,
        total_points,
        user_address
    );

    let response = ClaimResponse {
        tx_hash,
        amount_carel: carel_amount_out,
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
            return Err(AppError::BadRequest(
                "Invalid total_distribution_carel".into(),
            ));
        }
    }

    let points_value = if let Some(points) = req.points {
        Decimal::from_f64_retain(points).unwrap_or(Decimal::ZERO)
    } else {
        state
            .db
            .get_user_points(&user_address, epoch)
            .await?
            .map(|p| p.total_points)
            .unwrap_or(Decimal::ZERO)
    };

    let total_points_epoch: Decimal =
        sqlx::query_scalar("SELECT COALESCE(SUM(total_points), 0) FROM points WHERE epoch = $1")
            .bind(epoch)
            .fetch_one(state.db.pool())
            .await?;

    let total_distribution =
        resolve_total_distribution(&state, req.total_distribution_carel).await?;

    let mut carel_amount_dec =
        calculate_epoch_reward(points_value, total_points_epoch, total_distribution);
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
            tracing::info!(
                "Using on-chain conversion for user={} epoch={}",
                user_address,
                epoch
            );
            carel_amount_dec = onchain_amount;
        }
        Ok(None) => {
            tracing::debug!(
                "Using off-chain conversion for user={} epoch={}",
                user_address,
                epoch
            );
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

async fn claim_rewards_onchain(
    state: &AppState,
    epoch: i64,
    user_address: &str,
    user_points: Decimal,
    total_points_epoch: Decimal,
    total_distribution: Decimal,
) -> Result<Option<(String, Decimal)>> {
    let contract = state.config.snapshot_distributor_address.trim();
    if contract.is_empty() || contract.starts_with("0x0000") {
        return Ok(None);
    }

    let Some(invoker) = OnchainInvoker::from_config(&state.config).ok().flatten() else {
        return Ok(None);
    };

    let merkle = MerkleGenerator::new(state.db.clone(), state.config.clone());
    let tree = merkle
        .generate_for_epoch_with_distribution(epoch, total_distribution)
        .await?;
    let amount_wei = merkle.calculate_reward_amount_wei_with_distribution(
        user_points,
        total_points_epoch,
        total_distribution,
    );
    let proof = merkle
        .generate_proof(&tree, user_address, amount_wei, epoch)
        .await?;

    let proof_core: Vec<Felt> = proof
        .iter()
        .map(crypto_felt_to_core)
        .collect::<Result<Vec<_>>>()?;

    let root_core = crypto_felt_to_core(&tree.root)?;
    let submit_call = build_submit_root_call(contract, epoch as u64, root_core)?;
    let _ = invoker.invoke(submit_call).await?;

    let call = build_batch_claim_call(
        contract,
        epoch as u64,
        user_address,
        amount_wei,
        &proof_core,
    )?;
    let tx_hash = invoker.invoke(call).await?;

    let net_wei = amount_wei.saturating_mul(95).saturating_div(100);
    let net_amount = wei_to_carel_amount(net_wei);

    Ok(Some((tx_hash.to_string(), net_amount)))
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
    Ok(Some(
        Decimal::from_u128(carel_u128).unwrap_or(Decimal::ZERO),
    ))
}

fn to_u256_strings(value: u128) -> (String, String) {
    (value.to_string(), "0".to_string())
}

fn build_batch_claim_call(
    contract: &str,
    epoch: u64,
    user: &str,
    amount_wei: u128,
    proofs: &[Felt],
) -> Result<Call> {
    let to = parse_felt(contract)?;
    let selector = get_selector_from_name("batch_claim_rewards")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    let user_felt = parse_felt(user)?;
    let (amount_low, amount_high) = u256_to_felts(amount_wei);

    let mut calldata = Vec::new();
    calldata.push(Felt::from(epoch as u128));
    calldata.push(Felt::from(1_u128)); // claims length
    calldata.push(user_felt);
    calldata.push(amount_low);
    calldata.push(amount_high);
    calldata.push(Felt::from(0_u128)); // proof_offset
    calldata.push(Felt::from(proofs.len() as u128)); // proof_len
    calldata.push(Felt::from(proofs.len() as u128)); // proofs length
    calldata.extend_from_slice(proofs);

    Ok(Call {
        to,
        selector,
        calldata,
    })
}

fn build_submit_root_call(contract: &str, epoch: u64, root: Felt) -> Result<Call> {
    let to = parse_felt(contract)?;
    let selector = get_selector_from_name("submit_merkle_root")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;

    let calldata = vec![Felt::from(epoch as u128), root];
    Ok(Call {
        to,
        selector,
        calldata,
    })
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
        value
            .parse::<u128>()
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
