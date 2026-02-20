use axum::{extract::State, http::HeaderMap, Json};
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use crate::services::onchain::{
    felt_to_u128, parse_felt, u256_from_felts, OnchainInvoker, OnchainReader,
};
use crate::{
    constants::token_address_for,
    // 1. Import hasher agar fungsi di hash.rs terhitung "used"
    crypto::hash,
    error::Result,
    models::{user::PrivacyVerificationPayload as ModelPrivacyVerificationPayload, ApiResponse},
    services::nft_discount::consume_nft_usage_if_active,
    services::privacy_verifier::parse_privacy_verifier_kind,
};
use starknet_core::types::{Call, Felt, FunctionCall};
use starknet_core::utils::get_selector_from_name;

use super::{
    onchain_privacy::{
        normalize_onchain_tx_hash, should_run_privacy_verification,
        verify_onchain_hide_balance_invoke_tx, HideBalanceFlow,
        PrivacyVerificationPayload as OnchainPrivacyPayload,
    },
    privacy::{
        bind_intent_hash_into_payload, ensure_public_inputs_bind_nullifier_commitment,
        generate_auto_garaga_payload, AutoPrivacyPayloadResponse, AutoPrivacyTxContext,
    },
    require_starknet_user, require_user,
    swap::{parse_decimal_to_u256_parts, token_decimals},
    AppState,
};
use tokio::time::{sleep, Duration};

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
    pub hide_balance: Option<bool>,
    pub privacy: Option<ModelPrivacyVerificationPayload>,
}

#[derive(Debug, Deserialize)]
pub struct WithdrawRequest {
    pub position_id: String,
    pub amount: String,
    pub onchain_tx_hash: Option<String>,
    pub hide_balance: Option<bool>,
    pub privacy: Option<ModelPrivacyVerificationPayload>,
}

#[derive(Debug, Deserialize)]
pub struct ClaimRequest {
    pub position_id: String,
    pub onchain_tx_hash: Option<String>,
    pub hide_balance: Option<bool>,
    pub privacy: Option<ModelPrivacyVerificationPayload>,
}

#[derive(Debug, Serialize)]
pub struct DepositResponse {
    pub position_id: String,
    pub tx_hash: String,
    pub amount: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub privacy_tx_hash: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ClaimResponse {
    pub position_id: String,
    pub tx_hash: String,
    pub claimed_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub privacy_tx_hash: Option<String>,
}

const STARKNET_ONCHAIN_STAKE_POOLS: &[&str] = &["CAREL", "USDC", "USDT", "WBTC", "STRK"];
const BTC_GARDEN_POOL: &str = "BTC";

// Internal helper that parses or transforms values for `normalize_pool_id`.
fn normalize_pool_id(pool_id: &str) -> String {
    pool_id.trim().to_ascii_uppercase()
}

// Internal helper that fetches data for `resolve_onchain_block_number_best_effort`.
async fn resolve_onchain_block_number_best_effort(state: &AppState, tx_hash: &str) -> i64 {
    let reader = match OnchainReader::from_config(&state.config) {
        Ok(reader) => reader,
        Err(err) => {
            tracing::warn!(
                "stake block-number lookup skipped (reader init failed): tx_hash={} err={}",
                tx_hash,
                err
            );
            return 0;
        }
    };
    let tx_hash_felt = match parse_felt(tx_hash) {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(
                "stake block-number lookup skipped (invalid tx hash): tx_hash={} err={}",
                tx_hash,
                err
            );
            return 0;
        }
    };

    for attempt in 0..3 {
        match reader.get_transaction_receipt(&tx_hash_felt).await {
            Ok(receipt) => {
                if let starknet_core::types::ExecutionResult::Reverted { reason } =
                    receipt.receipt.execution_result()
                {
                    tracing::warn!(
                        "stake tx reverted while resolving block number: tx_hash={} reason={}",
                        tx_hash,
                        reason
                    );
                    return 0;
                }
                let block_number = receipt.block.block_number() as i64;
                if block_number > 0 {
                    return block_number;
                }
            }
            Err(err) => {
                if attempt == 2 {
                    tracing::warn!(
                        "stake block-number lookup failed: tx_hash={} err={}",
                        tx_hash,
                        err
                    );
                } else {
                    sleep(Duration::from_millis(700)).await;
                }
            }
        }
    }
    0
}

// Internal helper that fetches data for `resolve_pool_token`.
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

// Internal helper that checks conditions for `is_starknet_onchain_pool`.
fn is_starknet_onchain_pool(token: &str) -> bool {
    STARKNET_ONCHAIN_STAKE_POOLS
        .iter()
        .any(|supported| supported.eq_ignore_ascii_case(token))
}

// Internal helper that parses or transforms values for `parse_pool_from_position_id`.
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

// Internal helper that builds inputs for `build_position_id`.
fn build_position_id(user_address: &str, pool_id: &str, now_ts: i64) -> String {
    let pos_data = format!("{}{}{}", user_address, pool_id, now_ts);
    format!(
        "POS_{}_{}",
        normalize_pool_id(pool_id),
        hash::hash_string(&pos_data)
    )
}

// Internal helper that supports `map_privacy_payload` operations.
fn map_privacy_payload(
    payload: Option<&ModelPrivacyVerificationPayload>,
) -> Option<OnchainPrivacyPayload> {
    payload.map(|value| OnchainPrivacyPayload {
        verifier: value.verifier.clone(),
        nullifier: value.nullifier.clone(),
        commitment: value.commitment.clone(),
        proof: value.proof.clone(),
        public_inputs: value.public_inputs.clone(),
    })
}

#[derive(Clone, Copy)]
enum StakeAction {
    Deposit,
    Withdraw,
    Claim,
}

#[derive(Clone, Copy)]
enum StakeExecuteMode {
    TargetWithApproval,
    TargetNoApproval,
    LegacyNoApproval,
    ShieldedPoolV2,
}

// Internal helper that supports `env_flag` operations.
fn env_flag(name: &str, default: bool) -> bool {
    std::env::var(name)
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(default)
}

// Internal helper that supports `hide_balance_relayer_pool_enabled` operations.
fn hide_balance_relayer_pool_enabled() -> bool {
    env_flag("HIDE_BALANCE_RELAYER_POOL_ENABLED", true)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum HideExecutorKind {
    PrivateActionExecutorV1,
    ShieldedPoolV2,
}

// Internal helper that supports `hide_executor_kind` operations.
fn hide_executor_kind() -> HideExecutorKind {
    let raw = std::env::var("HIDE_BALANCE_EXECUTOR_KIND")
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if matches!(raw.as_str(), "shielded_pool_v2" | "shielded-v2" | "v2") {
        HideExecutorKind::ShieldedPoolV2
    } else {
        HideExecutorKind::PrivateActionExecutorV1
    }
}

// Internal helper that fetches data for `resolve_private_action_executor_felt`.
fn resolve_private_action_executor_felt(config: &crate::config::Config) -> Result<Felt> {
    for raw in [
        std::env::var("PRIVATE_ACTION_EXECUTOR_ADDRESS").ok(),
        std::env::var("NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS").ok(),
        config.privacy_router_address.clone(),
    ]
    .into_iter()
    .flatten()
    {
        let trimmed = raw.trim();
        if trimmed.is_empty() || trimmed.starts_with("0x0000") {
            continue;
        }
        return parse_felt(trimmed);
    }
    Err(crate::error::AppError::BadRequest(
        "PrivateActionExecutor is not configured. Set PRIVATE_ACTION_EXECUTOR_ADDRESS.".to_string(),
    ))
}

// Internal helper that fetches data for `resolve_staking_target_felt`.
fn resolve_staking_target_felt(state: &AppState, pool_token: &str) -> Result<Felt> {
    let normalized = pool_token.trim().to_ascii_uppercase();
    let candidates: Vec<Option<String>> = match normalized.as_str() {
        "CAREL" => vec![
            state.config.staking_carel_address.clone(),
            std::env::var("STAKING_CAREL_ADDRESS").ok(),
            std::env::var("NEXT_PUBLIC_STARKNET_STAKING_CAREL_ADDRESS").ok(),
        ],
        "USDC" | "USDT" | "STRK" => vec![
            std::env::var("STAKING_STABLECOIN_ADDRESS").ok(),
            std::env::var("NEXT_PUBLIC_STARKNET_STAKING_STABLECOIN_ADDRESS").ok(),
        ],
        "WBTC" => vec![
            std::env::var("STAKING_BTC_ADDRESS").ok(),
            std::env::var("NEXT_PUBLIC_STARKNET_STAKING_BTC_ADDRESS").ok(),
        ],
        _ => {
            return Err(crate::error::AppError::BadRequest(format!(
                "Pool {} is not supported for hide-mode staking relayer",
                pool_token
            )));
        }
    };

    for raw in candidates.into_iter().flatten() {
        let trimmed = raw.trim();
        if trimmed.is_empty() || trimmed.starts_with("0x0000") {
            continue;
        }
        return parse_felt(trimmed);
    }

    Err(crate::error::AppError::BadRequest(format!(
        "Staking contract address is not configured for pool {}. Set staking target env for hide mode.",
        pool_token
    )))
}

// Internal helper that runs side-effecting logic for `stake_entrypoint_for_action`.
fn stake_entrypoint_for_action(action: StakeAction) -> &'static str {
    match action {
        StakeAction::Deposit => "stake",
        StakeAction::Withdraw => "unstake",
        StakeAction::Claim => "claim_rewards",
    }
}

// Internal helper that builds inputs for `build_stake_action`.
fn build_stake_action(
    pool_token: &str,
    action: StakeAction,
    amount: Option<&str>,
) -> Result<(Felt, Vec<Felt>, Felt)> {
    let entrypoint = stake_entrypoint_for_action(action);
    let selector = get_selector_from_name(entrypoint)
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    let token = pool_token.trim().to_ascii_uppercase();

    let shielded_mode = hide_executor_kind() == HideExecutorKind::ShieldedPoolV2;

    if token == "CAREL" {
        let carel_token = token_address_for("CAREL")
            .ok_or(crate::error::AppError::InvalidToken)
            .and_then(parse_felt)?;
        return match action {
            StakeAction::Claim => Ok((
                selector,
                vec![],
                if shielded_mode {
                    carel_token
                } else {
                    Felt::ZERO
                },
            )),
            StakeAction::Deposit | StakeAction::Withdraw => {
                let raw_amount = amount.ok_or_else(|| {
                    crate::error::AppError::BadRequest(
                        "Amount is required for staking action".to_string(),
                    )
                })?;
                let (amount_low, amount_high) =
                    parse_decimal_to_u256_parts(raw_amount, token_decimals(&token))?;
                let approval_token = if matches!(action, StakeAction::Deposit) || shielded_mode {
                    carel_token
                } else {
                    Felt::ZERO
                };
                Ok((selector, vec![amount_low, amount_high], approval_token))
            }
        };
    }

    let token_felt = token_address_for(&token)
        .ok_or(crate::error::AppError::InvalidToken)
        .and_then(parse_felt)?;

    match action {
        StakeAction::Claim => Ok((
            selector,
            vec![token_felt],
            if shielded_mode {
                token_felt
            } else {
                Felt::ZERO
            },
        )),
        StakeAction::Deposit | StakeAction::Withdraw => {
            let raw_amount = amount.ok_or_else(|| {
                crate::error::AppError::BadRequest(
                    "Amount is required for staking action".to_string(),
                )
            })?;
            let (amount_low, amount_high) =
                parse_decimal_to_u256_parts(raw_amount, token_decimals(&token))?;
            let approval_token = if matches!(action, StakeAction::Deposit) || shielded_mode {
                token_felt
            } else {
                Felt::ZERO
            };
            Ok((
                selector,
                vec![token_felt, amount_low, amount_high],
                approval_token,
            ))
        }
    }
}

// Internal helper that parses or transforms values for `normalize_hex_items`.
fn normalize_hex_items(items: &[String]) -> Vec<String> {
    items
        .iter()
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

// Internal helper that supports `payload_from_request` operations.
fn payload_from_request(
    payload: Option<&ModelPrivacyVerificationPayload>,
    verifier: &str,
) -> Option<AutoPrivacyPayloadResponse> {
    let payload = payload?;
    let nullifier = payload.nullifier.as_deref()?.trim();
    let commitment = payload.commitment.as_deref()?.trim();
    if nullifier.is_empty() || commitment.is_empty() {
        return None;
    }
    let proof = normalize_hex_items(payload.proof.as_ref()?);
    let public_inputs = normalize_hex_items(payload.public_inputs.as_ref()?);
    if proof.is_empty() || public_inputs.is_empty() {
        return None;
    }
    if proof.len() == 1
        && public_inputs.len() == 1
        && proof[0].eq_ignore_ascii_case("0x1")
        && public_inputs[0].eq_ignore_ascii_case("0x1")
    {
        return None;
    }
    Some(AutoPrivacyPayloadResponse {
        verifier: payload
            .verifier
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(verifier)
            .to_string(),
        nullifier: nullifier.to_string(),
        commitment: commitment.to_string(),
        proof,
        public_inputs,
    })
}

// Internal helper that supports `compute_stake_intent_hash_on_executor` operations.
async fn compute_stake_intent_hash_on_executor(
    state: &AppState,
    executor: Felt,
    target: Felt,
    action_selector: Felt,
    action_calldata: &[Felt],
    approval_token: Felt,
) -> Result<(String, StakeExecuteMode)> {
    let reader = OnchainReader::from_config(&state.config)?;
    if hide_executor_kind() == HideExecutorKind::ShieldedPoolV2 {
        let selector = get_selector_from_name("preview_stake_action_hash")
            .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
        let mut calldata: Vec<Felt> = Vec::with_capacity(5 + action_calldata.len());
        calldata.push(target);
        calldata.push(action_selector);
        calldata.push(Felt::from(action_calldata.len() as u64));
        calldata.extend_from_slice(action_calldata);
        calldata.push(approval_token);

        let out = reader
            .call(FunctionCall {
                contract_address: executor,
                entry_point_selector: selector,
                calldata,
            })
            .await?;
        let intent_hash = out.first().ok_or_else(|| {
            crate::error::AppError::BadRequest(
                "ShieldedPoolV2 preview returned empty response".to_string(),
            )
        })?;
        return Ok((intent_hash.to_string(), StakeExecuteMode::ShieldedPoolV2));
    }

    let approval_aware_selector =
        get_selector_from_name("preview_stake_target_intent_hash_with_approval")
            .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    let mut approval_aware_calldata: Vec<Felt> = Vec::with_capacity(4 + action_calldata.len());
    approval_aware_calldata.push(target);
    approval_aware_calldata.push(action_selector);
    approval_aware_calldata.push(Felt::from(action_calldata.len() as u64));
    approval_aware_calldata.extend_from_slice(action_calldata);
    approval_aware_calldata.push(approval_token);

    match reader
        .call(FunctionCall {
            contract_address: executor,
            entry_point_selector: approval_aware_selector,
            calldata: approval_aware_calldata,
        })
        .await
    {
        Ok(out) => {
            let intent_hash = out.first().ok_or_else(|| {
                crate::error::AppError::BadRequest(
                    "PrivateActionExecutor preview returned empty response".to_string(),
                )
            })?;
            return Ok((
                intent_hash.to_string(),
                StakeExecuteMode::TargetWithApproval,
            ));
        }
        Err(err) => {
            tracing::warn!(
                "preview_stake_target_intent_hash_with_approval unavailable/failing on executor {}; fallback preview path: {}",
                executor,
                err
            );
        }
    }

    if approval_token != Felt::ZERO {
        return Err(crate::error::AppError::BadRequest(
            "PrivateActionExecutor class is outdated for stake deposit hide mode. Deploy class with preview_stake_target_intent_hash_with_approval + execute_private_stake_with_target_and_approval.".to_string(),
        ));
    }

    let targeted_selector = get_selector_from_name("preview_stake_target_intent_hash")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    let mut targeted_calldata: Vec<Felt> = Vec::with_capacity(3 + action_calldata.len());
    targeted_calldata.push(target);
    targeted_calldata.push(action_selector);
    targeted_calldata.push(Felt::from(action_calldata.len() as u64));
    targeted_calldata.extend_from_slice(action_calldata);
    match reader
        .call(FunctionCall {
            contract_address: executor,
            entry_point_selector: targeted_selector,
            calldata: targeted_calldata,
        })
        .await
    {
        Ok(out) => {
            let intent_hash = out.first().ok_or_else(|| {
                crate::error::AppError::BadRequest(
                    "PrivateActionExecutor preview returned empty response".to_string(),
                )
            })?;
            return Ok((intent_hash.to_string(), StakeExecuteMode::TargetNoApproval));
        }
        Err(err) => {
            tracing::warn!(
                "preview_stake_target_intent_hash unavailable/failing on executor {}; fallback legacy preview_stake_intent_hash: {}",
                executor,
                err
            );
        }
    }

    let legacy_selector = get_selector_from_name("preview_stake_intent_hash")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    let mut legacy_calldata: Vec<Felt> = Vec::with_capacity(2 + action_calldata.len());
    legacy_calldata.push(action_selector);
    legacy_calldata.push(Felt::from(action_calldata.len() as u64));
    legacy_calldata.extend_from_slice(action_calldata);
    let out = reader
        .call(FunctionCall {
            contract_address: executor,
            entry_point_selector: legacy_selector,
            calldata: legacy_calldata,
        })
        .await?;
    let intent_hash = out.first().ok_or_else(|| {
        crate::error::AppError::BadRequest(
            "PrivateActionExecutor legacy preview returned empty response".to_string(),
        )
    })?;
    Ok((intent_hash.to_string(), StakeExecuteMode::LegacyNoApproval))
}

// Internal helper that builds inputs for `build_submit_private_intent_call`.
fn build_submit_private_intent_call(
    executor: Felt,
    payload: &AutoPrivacyPayloadResponse,
) -> Result<Call> {
    let selector_name = match hide_executor_kind() {
        HideExecutorKind::PrivateActionExecutorV1 => "submit_private_intent",
        HideExecutorKind::ShieldedPoolV2 => "submit_private_action",
    };
    let selector = get_selector_from_name(selector_name)
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    let proof: Vec<Felt> = payload
        .proof
        .iter()
        .map(|felt| parse_felt(felt))
        .collect::<Result<Vec<_>>>()?;
    let public_inputs: Vec<Felt> = payload
        .public_inputs
        .iter()
        .map(|felt| parse_felt(felt))
        .collect::<Result<Vec<_>>>()?;

    let mut calldata: Vec<Felt> = Vec::with_capacity(4 + proof.len() + public_inputs.len());
    calldata.push(parse_felt(payload.nullifier.trim())?);
    calldata.push(parse_felt(payload.commitment.trim())?);
    calldata.push(Felt::from(proof.len() as u64));
    calldata.extend(proof);
    calldata.push(Felt::from(public_inputs.len() as u64));
    calldata.extend(public_inputs);

    Ok(Call {
        to: executor,
        selector,
        calldata,
    })
}

// Internal helper that builds inputs for `build_execute_private_stake_call`.
fn build_execute_private_stake_call(
    executor: Felt,
    payload: &AutoPrivacyPayloadResponse,
    target: Felt,
    action_selector: Felt,
    action_calldata: &[Felt],
    execute_mode: StakeExecuteMode,
    approval_token: Felt,
) -> Result<Call> {
    let (entrypoint, estimated_capacity) = match execute_mode {
        StakeExecuteMode::TargetWithApproval => (
            "execute_private_stake_with_target_and_approval",
            5 + action_calldata.len(),
        ),
        StakeExecuteMode::TargetNoApproval => (
            "execute_private_stake_with_target",
            4 + action_calldata.len(),
        ),
        StakeExecuteMode::LegacyNoApproval => ("execute_private_stake", 3 + action_calldata.len()),
        StakeExecuteMode::ShieldedPoolV2 => ("execute_private_stake", 5 + action_calldata.len()),
    };
    let selector = get_selector_from_name(entrypoint)
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    let mut calldata: Vec<Felt> = Vec::with_capacity(estimated_capacity);
    calldata.push(parse_felt(payload.commitment.trim())?);
    if !matches!(execute_mode, StakeExecuteMode::LegacyNoApproval) {
        calldata.push(target);
    }
    calldata.push(action_selector);
    calldata.push(Felt::from(action_calldata.len() as u64));
    calldata.extend_from_slice(action_calldata);
    if matches!(
        execute_mode,
        StakeExecuteMode::TargetWithApproval | StakeExecuteMode::ShieldedPoolV2
    ) {
        calldata.push(approval_token);
    }

    Ok(Call {
        to: executor,
        selector,
        calldata,
    })
}

// Internal helper that builds inputs for `build_shielded_set_asset_rule_call`.
fn build_shielded_set_asset_rule_call(
    executor: Felt,
    token: Felt,
    amount_low: Felt,
    amount_high: Felt,
) -> Result<Call> {
    let selector = get_selector_from_name("set_asset_rule")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    Ok(Call {
        to: executor,
        selector,
        calldata: vec![token, amount_low, amount_high],
    })
}

// Internal helper that builds inputs for `build_shielded_deposit_fixed_call`.
fn build_shielded_deposit_fixed_call(
    executor: Felt,
    token: Felt,
    note_commitment: Felt,
) -> Result<Call> {
    let selector = get_selector_from_name("deposit_fixed")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    Ok(Call {
        to: executor,
        selector,
        calldata: vec![token, note_commitment],
    })
}

// Internal helper that builds inputs for `build_erc20_approve_call`.
fn build_erc20_approve_call(
    token: Felt,
    spender: Felt,
    amount_low: Felt,
    amount_high: Felt,
) -> Result<Call> {
    let selector = get_selector_from_name("approve")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    Ok(Call {
        to: token,
        selector,
        calldata: vec![spender, amount_low, amount_high],
    })
}

// Internal helper that supports `shielded_note_registered` operations.
async fn shielded_note_registered(
    state: &AppState,
    executor: Felt,
    note_commitment: Felt,
) -> Result<bool> {
    let reader = OnchainReader::from_config(&state.config)?;
    let selector = get_selector_from_name("is_note_registered")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    let out = reader
        .call(FunctionCall {
            contract_address: executor,
            entry_point_selector: selector,
            calldata: vec![note_commitment],
        })
        .await?;
    let flag = out.first().copied().unwrap_or(Felt::ZERO);
    Ok(flag != Felt::ZERO)
}

// Internal helper that supports `shielded_fixed_amount` operations.
async fn shielded_fixed_amount(
    state: &AppState,
    executor: Felt,
    token: Felt,
) -> Result<(Felt, Felt)> {
    let reader = OnchainReader::from_config(&state.config)?;
    let selector = get_selector_from_name("fixed_amount")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    let out = reader
        .call(FunctionCall {
            contract_address: executor,
            entry_point_selector: selector,
            calldata: vec![token],
        })
        .await?;
    if out.len() < 2 {
        return Err(crate::error::AppError::BadRequest(
            "ShieldedPoolV2 fixed_amount returned invalid response".to_string(),
        ));
    }
    Ok((out[0], out[1]))
}

// Internal helper that supports `append_shielded_note_registration_calls` operations.
async fn append_shielded_note_registration_calls(
    state: &AppState,
    relayer_calls: &mut Vec<Call>,
    executor: Felt,
    commitment: Felt,
    note_token: Felt,
    amount_low: Felt,
    amount_high: Felt,
) -> Result<()> {
    if note_token == Felt::ZERO {
        return Err(crate::error::AppError::BadRequest(
            "ShieldedPoolV2 requires non-zero note token".to_string(),
        ));
    }
    if amount_low == Felt::ZERO && amount_high == Felt::ZERO {
        return Err(crate::error::AppError::BadRequest(
            "ShieldedPoolV2 requires non-zero note amount".to_string(),
        ));
    }
    let note_registered = shielded_note_registered(state, executor, commitment).await?;
    if note_registered {
        return Ok(());
    }

    let (fixed_low, fixed_high) = shielded_fixed_amount(state, executor, note_token).await?;
    if fixed_low != amount_low || fixed_high != amount_high {
        relayer_calls.push(build_shielded_set_asset_rule_call(
            executor,
            note_token,
            amount_low,
            amount_high,
        )?);
    }
    relayer_calls.push(build_erc20_approve_call(
        note_token,
        executor,
        amount_low,
        amount_high,
    )?);
    relayer_calls.push(build_shielded_deposit_fixed_call(
        executor, note_token, commitment,
    )?);
    Ok(())
}

// Internal helper that supports `fallback_price_for` operations.
fn fallback_price_for(token: &str) -> f64 {
    match token.to_uppercase().as_str() {
        "USDT" | "USDC" => 1.0,
        "BTC" | "WBTC" => 70_000.0,
        _ => 1.0,
    }
}

const CAREL_DECIMALS: f64 = 1_000_000_000_000_000_000.0;

// Internal helper that supports `u128_to_token_amount` operations.
fn u128_to_token_amount(value: u128) -> f64 {
    (value as f64) / CAREL_DECIMALS
}

// Internal helper that supports `latest_price` operations.
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

// Internal helper that supports `staking_contract_or_error` operations.
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
    // CAREL tiered APY (8/12/15), STRK 7, WBTC 6, stablecoin 7.
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
            "BTC staking is disabled. Use Bridge via Garden for BTC<->WBTC transfers.".to_string(),
        ));
    }
    if !is_starknet_onchain_pool(pool_token) {
        return Err(crate::error::AppError::BadRequest(
            "Pool belum didukung untuk on-chain staking".to_string(),
        ));
    }

    let should_hide = should_run_privacy_verification(req.hide_balance.unwrap_or(false));
    let use_relayer_pool_hide = should_hide && hide_balance_relayer_pool_enabled();

    let tx_hash = if use_relayer_pool_hide {
        let executor = resolve_private_action_executor_felt(&state.config)?;
        let verifier_kind = parse_privacy_verifier_kind(
            req.privacy
                .as_ref()
                .and_then(|payload| payload.verifier.as_deref()),
        )?;
        let mut payload = if let Some(request_payload) =
            payload_from_request(req.privacy.as_ref(), verifier_kind.as_str())
        {
            request_payload
        } else {
            let tx_context = AutoPrivacyTxContext {
                flow: Some("stake".to_string()),
                from_token: Some(pool_token.to_string()),
                to_token: Some(pool_token.to_string()),
                amount: Some(req.amount.clone()),
                recipient: Some(user_address.clone()),
                from_network: Some("starknet".to_string()),
                to_network: Some("starknet".to_string()),
            };
            generate_auto_garaga_payload(
                &state.config,
                &user_address,
                verifier_kind.as_str(),
                Some(&tx_context),
            )
            .await?
        };
        ensure_public_inputs_bind_nullifier_commitment(
            &payload.nullifier,
            &payload.commitment,
            &payload.public_inputs,
            "stake hide payload",
        )?;

        let staking_target = resolve_staking_target_felt(&state, pool_token)?;
        let (action_selector, action_calldata, approval_token) =
            build_stake_action(pool_token, StakeAction::Deposit, Some(&req.amount))?;
        let (intent_hash, execute_mode) = compute_stake_intent_hash_on_executor(
            &state,
            executor,
            staking_target,
            action_selector,
            &action_calldata,
            approval_token,
        )
        .await?;
        bind_intent_hash_into_payload(&mut payload, &intent_hash)?;
        ensure_public_inputs_bind_nullifier_commitment(
            &payload.nullifier,
            &payload.commitment,
            &payload.public_inputs,
            "stake hide payload (bound)",
        )?;

        let Some(invoker) = OnchainInvoker::from_config(&state.config).ok().flatten() else {
            return Err(crate::error::AppError::BadRequest(
                "On-chain relayer account is not configured for hide mode".to_string(),
            ));
        };
        let mut relayer_calls: Vec<Call> = Vec::new();
        if hide_executor_kind() == HideExecutorKind::ShieldedPoolV2 {
            let commitment_felt = parse_felt(payload.commitment.trim())?;
            let (note_amount_low, note_amount_high) =
                parse_decimal_to_u256_parts(&req.amount, token_decimals(pool_token))?;
            append_shielded_note_registration_calls(
                &state,
                &mut relayer_calls,
                executor,
                commitment_felt,
                approval_token,
                note_amount_low,
                note_amount_high,
            )
            .await?;
        }
        let submit_call = build_submit_private_intent_call(executor, &payload)?;
        let execute_call = build_execute_private_stake_call(
            executor,
            &payload,
            staking_target,
            action_selector,
            &action_calldata,
            execute_mode,
            approval_token,
        )?;
        relayer_calls.push(submit_call);
        relayer_calls.push(execute_call);
        let tx_hash_felt = invoker.invoke_many(relayer_calls).await?;
        format!("{:#x}", tx_hash_felt)
    } else {
        let auth_subject = require_user(&headers, &state).await?;
        let onchain_tx_hash = normalize_onchain_tx_hash(req.onchain_tx_hash.as_deref())?;
        let tx_hash = onchain_tx_hash.ok_or_else(|| {
            crate::error::AppError::BadRequest(
                "Stake requires onchain_tx_hash from user-signed Starknet transaction".to_string(),
            )
        })?;
        let privacy_payload = map_privacy_payload(req.privacy.as_ref());
        if should_hide {
            verify_onchain_hide_balance_invoke_tx(
                &state,
                &tx_hash,
                &auth_subject,
                &user_address,
                privacy_payload.as_ref(),
                Some(HideBalanceFlow::Stake),
            )
            .await?;
        }
        tx_hash
    };

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
    let onchain_block_number = resolve_onchain_block_number_best_effort(&state, &tx_hash).await;
    let tx = crate::models::Transaction {
        tx_hash: tx_hash.clone(),
        block_number: onchain_block_number,
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
    if should_hide {
        state.db.mark_transaction_private(&tx_hash).await?;
    }
    if let Err(err) =
        consume_nft_usage_if_active(&state.config, &user_address, "stake_deposit").await
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
        privacy_tx_hash: if should_hide {
            Some(tx.tx_hash.clone())
        } else {
            None
        },
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

    let pool_token =
        parse_pool_from_position_id(&req.position_id).unwrap_or_else(|| "CAREL".to_string());
    if pool_token.eq_ignore_ascii_case(BTC_GARDEN_POOL) {
        return Err(crate::error::AppError::BadRequest(
            "BTC staking is disabled. Use Bridge via Garden for BTC<->WBTC transfers.".to_string(),
        ));
    }

    let should_hide = should_run_privacy_verification(req.hide_balance.unwrap_or(false));
    let use_relayer_pool_hide = should_hide && hide_balance_relayer_pool_enabled();
    let tx_hash = if use_relayer_pool_hide {
        let executor = resolve_private_action_executor_felt(&state.config)?;
        let verifier_kind = parse_privacy_verifier_kind(
            req.privacy
                .as_ref()
                .and_then(|payload| payload.verifier.as_deref()),
        )?;
        let mut payload = if let Some(request_payload) =
            payload_from_request(req.privacy.as_ref(), verifier_kind.as_str())
        {
            request_payload
        } else {
            let tx_context = AutoPrivacyTxContext {
                flow: Some("unstake".to_string()),
                from_token: Some(pool_token.clone()),
                to_token: Some(pool_token.clone()),
                amount: Some(req.amount.clone()),
                recipient: Some(user_address.clone()),
                from_network: Some("starknet".to_string()),
                to_network: Some("starknet".to_string()),
            };
            generate_auto_garaga_payload(
                &state.config,
                &user_address,
                verifier_kind.as_str(),
                Some(&tx_context),
            )
            .await?
        };
        ensure_public_inputs_bind_nullifier_commitment(
            &payload.nullifier,
            &payload.commitment,
            &payload.public_inputs,
            "unstake hide payload",
        )?;

        let staking_target = resolve_staking_target_felt(&state, &pool_token)?;
        let (action_selector, action_calldata, approval_token) =
            build_stake_action(&pool_token, StakeAction::Withdraw, Some(&req.amount))?;
        let (intent_hash, execute_mode) = compute_stake_intent_hash_on_executor(
            &state,
            executor,
            staking_target,
            action_selector,
            &action_calldata,
            approval_token,
        )
        .await?;
        bind_intent_hash_into_payload(&mut payload, &intent_hash)?;
        ensure_public_inputs_bind_nullifier_commitment(
            &payload.nullifier,
            &payload.commitment,
            &payload.public_inputs,
            "unstake hide payload (bound)",
        )?;

        let Some(invoker) = OnchainInvoker::from_config(&state.config).ok().flatten() else {
            return Err(crate::error::AppError::BadRequest(
                "On-chain relayer account is not configured for hide mode".to_string(),
            ));
        };
        let mut relayer_calls: Vec<Call> = Vec::new();
        if hide_executor_kind() == HideExecutorKind::ShieldedPoolV2 {
            let commitment_felt = parse_felt(payload.commitment.trim())?;
            let (note_amount_low, note_amount_high) =
                parse_decimal_to_u256_parts(&req.amount, token_decimals(&pool_token))?;
            append_shielded_note_registration_calls(
                &state,
                &mut relayer_calls,
                executor,
                commitment_felt,
                approval_token,
                note_amount_low,
                note_amount_high,
            )
            .await?;
        }
        let submit_call = build_submit_private_intent_call(executor, &payload)?;
        let execute_call = build_execute_private_stake_call(
            executor,
            &payload,
            staking_target,
            action_selector,
            &action_calldata,
            execute_mode,
            approval_token,
        )?;
        relayer_calls.push(submit_call);
        relayer_calls.push(execute_call);
        let tx_hash_felt = invoker.invoke_many(relayer_calls).await?;
        format!("{:#x}", tx_hash_felt)
    } else {
        let auth_subject = require_user(&headers, &state).await?;
        let onchain_tx_hash = normalize_onchain_tx_hash(req.onchain_tx_hash.as_deref())?;
        let tx_hash = onchain_tx_hash.ok_or_else(|| {
            crate::error::AppError::BadRequest(
                "Unstake requires onchain_tx_hash from user-signed Starknet transaction"
                    .to_string(),
            )
        })?;
        let privacy_payload = map_privacy_payload(req.privacy.as_ref());
        if should_hide {
            verify_onchain_hide_balance_invoke_tx(
                &state,
                &tx_hash,
                &auth_subject,
                &user_address,
                privacy_payload.as_ref(),
                Some(HideBalanceFlow::Stake),
            )
            .await?;
        }
        tx_hash
    };
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
    let onchain_block_number = resolve_onchain_block_number_best_effort(&state, &tx_hash).await;
    let tx = crate::models::Transaction {
        tx_hash: tx_hash.clone(),
        block_number: onchain_block_number,
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
    if should_hide {
        state.db.mark_transaction_private(&tx_hash).await?;
    }
    if let Err(err) =
        consume_nft_usage_if_active(&state.config, &user_address, "stake_withdraw").await
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
        privacy_tx_hash: if should_hide {
            Some(tx.tx_hash.clone())
        } else {
            None
        },
    })))
}

/// POST /api/v1/stake/claim
pub async fn claim(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ClaimRequest>,
) -> Result<Json<ApiResponse<ClaimResponse>>> {
    let user_address = require_starknet_user(&headers, &state).await?;

    let pool_token =
        parse_pool_from_position_id(&req.position_id).unwrap_or_else(|| "CAREL".to_string());
    if pool_token.eq_ignore_ascii_case(BTC_GARDEN_POOL) {
        return Err(crate::error::AppError::BadRequest(
            "BTC staking is disabled. Use Bridge via Garden for BTC<->WBTC transfers.".to_string(),
        ));
    }
    if !is_starknet_onchain_pool(&pool_token) {
        return Err(crate::error::AppError::BadRequest(
            "Pool belum didukung untuk on-chain staking".to_string(),
        ));
    }

    let should_hide = should_run_privacy_verification(req.hide_balance.unwrap_or(false));
    let use_relayer_pool_hide = should_hide && hide_balance_relayer_pool_enabled();
    let tx_hash = if use_relayer_pool_hide {
        let executor = resolve_private_action_executor_felt(&state.config)?;
        let verifier_kind = parse_privacy_verifier_kind(
            req.privacy
                .as_ref()
                .and_then(|payload| payload.verifier.as_deref()),
        )?;
        let mut payload = if let Some(request_payload) =
            payload_from_request(req.privacy.as_ref(), verifier_kind.as_str())
        {
            request_payload
        } else {
            let tx_context = AutoPrivacyTxContext {
                flow: Some("stake_claim".to_string()),
                from_token: Some(pool_token.clone()),
                to_token: Some(pool_token.clone()),
                recipient: Some(user_address.clone()),
                from_network: Some("starknet".to_string()),
                to_network: Some("starknet".to_string()),
                ..Default::default()
            };
            generate_auto_garaga_payload(
                &state.config,
                &user_address,
                verifier_kind.as_str(),
                Some(&tx_context),
            )
            .await?
        };
        ensure_public_inputs_bind_nullifier_commitment(
            &payload.nullifier,
            &payload.commitment,
            &payload.public_inputs,
            "stake claim hide payload",
        )?;

        let staking_target = resolve_staking_target_felt(&state, &pool_token)?;
        let (action_selector, action_calldata, approval_token) =
            build_stake_action(&pool_token, StakeAction::Claim, None)?;
        let (intent_hash, execute_mode) = compute_stake_intent_hash_on_executor(
            &state,
            executor,
            staking_target,
            action_selector,
            &action_calldata,
            approval_token,
        )
        .await?;
        bind_intent_hash_into_payload(&mut payload, &intent_hash)?;
        ensure_public_inputs_bind_nullifier_commitment(
            &payload.nullifier,
            &payload.commitment,
            &payload.public_inputs,
            "stake claim hide payload (bound)",
        )?;

        let Some(invoker) = OnchainInvoker::from_config(&state.config).ok().flatten() else {
            return Err(crate::error::AppError::BadRequest(
                "On-chain relayer account is not configured for hide mode".to_string(),
            ));
        };
        let mut relayer_calls: Vec<Call> = Vec::new();
        if hide_executor_kind() == HideExecutorKind::ShieldedPoolV2 {
            let commitment_felt = parse_felt(payload.commitment.trim())?;
            let (mut note_amount_low, mut note_amount_high) =
                shielded_fixed_amount(&state, executor, approval_token).await?;
            if note_amount_low == Felt::ZERO && note_amount_high == Felt::ZERO {
                note_amount_low = Felt::from(1_u8);
                note_amount_high = Felt::ZERO;
            }
            append_shielded_note_registration_calls(
                &state,
                &mut relayer_calls,
                executor,
                commitment_felt,
                approval_token,
                note_amount_low,
                note_amount_high,
            )
            .await?;
        }
        let submit_call = build_submit_private_intent_call(executor, &payload)?;
        let execute_call = build_execute_private_stake_call(
            executor,
            &payload,
            staking_target,
            action_selector,
            &action_calldata,
            execute_mode,
            approval_token,
        )?;
        relayer_calls.push(submit_call);
        relayer_calls.push(execute_call);
        let tx_hash_felt = invoker.invoke_many(relayer_calls).await?;
        format!("{:#x}", tx_hash_felt)
    } else {
        let auth_subject = require_user(&headers, &state).await?;
        let onchain_tx_hash = normalize_onchain_tx_hash(req.onchain_tx_hash.as_deref())?;
        let tx_hash = onchain_tx_hash.ok_or_else(|| {
            crate::error::AppError::BadRequest(
                "Claim requires onchain_tx_hash from user-signed Starknet transaction".to_string(),
            )
        })?;
        let privacy_payload = map_privacy_payload(req.privacy.as_ref());
        if should_hide {
            verify_onchain_hide_balance_invoke_tx(
                &state,
                &tx_hash,
                &auth_subject,
                &user_address,
                privacy_payload.as_ref(),
                Some(HideBalanceFlow::Stake),
            )
            .await?;
        }
        tx_hash
    };
    if pool_token.eq_ignore_ascii_case("CAREL") {
        let _ = staking_contract_or_error(&state)?;
    }

    tracing::info!(
        "User {} stake rewards claim in pool {} (position: {})",
        user_address,
        pool_token,
        req.position_id
    );

    let onchain_block_number = resolve_onchain_block_number_best_effort(&state, &tx_hash).await;
    let tx = crate::models::Transaction {
        tx_hash: tx_hash.clone(),
        block_number: onchain_block_number,
        user_address: user_address.clone(),
        tx_type: "claim".to_string(),
        token_in: Some(pool_token.clone()),
        token_out: Some(pool_token.clone()),
        amount_in: None,
        amount_out: None,
        usd_value: None,
        fee_paid: None,
        points_earned: Some(rust_decimal::Decimal::ZERO),
        timestamp: chrono::Utc::now(),
        processed: false,
    };
    state.db.save_transaction(&tx).await?;
    if should_hide {
        state.db.mark_transaction_private(&tx_hash).await?;
    }

    Ok(Json(ApiResponse::success(ClaimResponse {
        position_id: req.position_id,
        tx_hash,
        claimed_token: pool_token,
        privacy_tx_hash: if should_hide {
            Some(tx.tx_hash.clone())
        } else {
            None
        },
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
                            let rewards =
                                match fetch_carel_rewards(&reader, contract, &user_address).await {
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

// Internal helper that fetches data for `fetch_carel_stake_info`.
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

// Internal helper that fetches data for `fetch_carel_rewards`.
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
    // Internal helper that builds inputs for `build_position_id_has_prefix`.
    fn build_position_id_has_prefix() {
        // Memastikan position_id memiliki prefix POS_<POOL>_0x
        let id = build_position_id("0xabc", "CAREL", 1_700_000_000);
        assert!(id.starts_with("POS_CAREL_0x"));
    }

    #[test]
    // Internal helper that parses or transforms values for `normalize_onchain_tx_hash_rejects_non_hex`.
    fn normalize_onchain_tx_hash_rejects_non_hex() {
        // Memastikan hash non-hex ditolak
        let result = normalize_onchain_tx_hash(Some("0xZZ"));
        assert!(result.is_err());
    }
}
