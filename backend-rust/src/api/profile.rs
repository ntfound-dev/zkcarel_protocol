use axum::{extract::State, http::HeaderMap, Json};
use chrono::Utc;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use starknet_core::types::{
    ExecutionResult, Felt, InvokeTransaction, Transaction as StarknetTransaction,
    TransactionFinalityStatus,
};
use starknet_core::utils::get_selector_from_name;
use tokio::time::{sleep, Duration};

use crate::{
    error::{AppError, Result},
    models::{ApiResponse, Transaction},
    services::{
        invoke_parser::parse_execute_calls,
        onchain::{felt_to_u128, parse_felt, OnchainReader},
    },
};

use super::{require_user, AppState};

#[derive(Debug, Deserialize)]
pub struct SetDisplayNameRequest {
    pub display_name: String,
    pub rename_onchain_tx_hash: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ProfileResponse {
    pub address: String,
    pub display_name: Option<String>,
    pub referrer: Option<String>,
}

/// GET /api/v1/profile/me
pub async fn get_profile(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<ProfileResponse>>> {
    let user_address = require_user(&headers, &state).await?;
    let user = state
        .db
        .get_user(&user_address)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    Ok(Json(ApiResponse::success(ProfileResponse {
        address: user.address,
        display_name: user.display_name,
        referrer: user.referrer,
    })))
}

/// PUT /api/v1/profile/display-name
pub async fn set_display_name(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<SetDisplayNameRequest>,
) -> Result<Json<ApiResponse<ProfileResponse>>> {
    let user_address = require_user(&headers, &state).await?;
    let normalized = normalize_display_name(&req.display_name)?;
    let existing_user = state
        .db
        .get_user(&user_address)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    // No-op update is always allowed.
    if existing_user.display_name.as_deref() == Some(normalized.as_str()) {
        return Ok(Json(ApiResponse::success(ProfileResponse {
            address: existing_user.address,
            display_name: existing_user.display_name,
            referrer: existing_user.referrer,
        })));
    }

    let first_time_set = existing_user
        .display_name
        .as_deref()
        .map(str::trim)
        .map(|value| value.is_empty())
        .unwrap_or(true);

    // First set is free and auto-saved.
    if !first_time_set {
        let tx_hash = normalize_onchain_tx_hash(req.rename_onchain_tx_hash.as_deref())?.ok_or_else(|| {
            AppError::BadRequest(
                "Changing display name requires 1 CAREL payment to DEV wallet. Provide rename_onchain_tx_hash."
                    .to_string(),
            )
        })?;

        let block_number = verify_rename_payment_tx_hash(&state, &user_address, &tx_hash).await?;

        // Persist fee payment tx hash to prevent replay.
        let inserted = state
            .db
            .insert_transaction_once(&Transaction {
                tx_hash: tx_hash.clone(),
                block_number,
                user_address: user_address.clone(),
                tx_type: "rename_fee".to_string(),
                token_in: Some("CAREL".to_string()),
                token_out: None,
                amount_in: Some(Decimal::new(1, 0)),
                amount_out: None,
                usd_value: Some(Decimal::new(1, 0)),
                fee_paid: Some(Decimal::new(1, 0)),
                points_earned: Some(Decimal::ZERO),
                is_private: false,
                timestamp: Utc::now(),
                processed: true,
            })
            .await?;
        if !inserted {
            return Err(AppError::BadRequest(
                "rename_onchain_tx_hash has already been used".to_string(),
            ));
        }
    }

    let user = state
        .db
        .set_display_name(&user_address, &normalized)
        .await
        .map_err(map_display_name_error)?;

    Ok(Json(ApiResponse::success(ProfileResponse {
        address: user.address,
        display_name: user.display_name,
        referrer: user.referrer,
    })))
}

// Internal helper that parses or transforms values for `normalize_display_name`.
fn normalize_display_name(raw: &str) -> Result<String> {
    let value = raw.trim();
    if value.len() < 3 || value.len() > 24 {
        return Err(AppError::BadRequest(
            "display_name must be 3-24 characters".to_string(),
        ));
    }
    if !value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(AppError::BadRequest(
            "display_name only allows letters, numbers, '_' and '-'".to_string(),
        ));
    }
    Ok(value.to_string())
}

// Internal helper that supports `map_display_name_error` operations.
fn map_display_name_error(err: AppError) -> AppError {
    match err {
        AppError::Database(sqlx::Error::Database(db_err))
            if db_err.code().as_deref() == Some("23505") =>
        {
            AppError::BadRequest("display_name already taken".to_string())
        }
        other => other,
    }
}

const RENAME_FEE_CAREL_WEI: u128 = 1_000_000_000_000_000_000;

// Internal helper that parses or transforms values for `normalize_onchain_tx_hash`.
fn normalize_onchain_tx_hash(
    tx_hash: Option<&str>,
) -> std::result::Result<Option<String>, AppError> {
    let Some(raw) = tx_hash.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if !raw.starts_with("0x") {
        return Err(AppError::BadRequest(
            "rename_onchain_tx_hash must start with 0x".to_string(),
        ));
    }
    if raw.len() > 66 {
        return Err(AppError::BadRequest(
            "rename_onchain_tx_hash exceeds maximum length (66)".to_string(),
        ));
    }
    if !raw[2..].chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::BadRequest(
            "rename_onchain_tx_hash must be hex-encoded".to_string(),
        ));
    }
    Ok(Some(raw.to_ascii_lowercase()))
}

// Internal helper that fetches data for `resolve_allowed_starknet_senders_async`.
async fn resolve_allowed_starknet_senders_async(
    state: &AppState,
    auth_subject: &str,
) -> Result<Vec<Felt>> {
    let mut out: Vec<Felt> = Vec::new();
    if let Ok(subject_felt) = parse_felt(auth_subject) {
        out.push(subject_felt);
    }

    if let Ok(linked_wallets) = state.db.list_wallet_addresses(auth_subject).await {
        for wallet in linked_wallets {
            if !wallet.chain.eq_ignore_ascii_case("starknet") {
                continue;
            }
            if let Ok(felt) = parse_felt(wallet.wallet_address.trim()) {
                if !out.contains(&felt) {
                    out.push(felt);
                }
            }
        }
    }

    if out.is_empty() {
        return Err(AppError::BadRequest(
            "No Starknet sender resolved for profile rename verification".to_string(),
        ));
    }
    Ok(out)
}

// Internal helper that supports `verify_rename_fee_invoke_payload` operations.
fn verify_rename_fee_invoke_payload(
    tx: &StarknetTransaction,
    allowed_senders: &[Felt],
    carel_token: Felt,
    dev_wallet: Felt,
) -> Result<()> {
    let invoke = match tx {
        StarknetTransaction::Invoke(invoke) => invoke,
        _ => {
            return Err(AppError::BadRequest(
                "rename_onchain_tx_hash must be an INVOKE transaction".to_string(),
            ))
        }
    };

    let transfer_selector = get_selector_from_name("transfer")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;

    let (sender, calldata) = match invoke {
        InvokeTransaction::V1(tx) => (tx.sender_address, tx.calldata.as_slice()),
        InvokeTransaction::V3(tx) => (tx.sender_address, tx.calldata.as_slice()),
        InvokeTransaction::V0(_) => {
            return Err(AppError::BadRequest(
                "rename_onchain_tx_hash uses unsupported INVOKE v0".to_string(),
            ))
        }
    };

    if !allowed_senders.contains(&sender) {
        return Err(AppError::BadRequest(
            "rename_onchain_tx_hash sender does not match authenticated Starknet user".to_string(),
        ));
    }

    let calls = parse_execute_calls(calldata)?;
    for call in calls {
        if call.to != carel_token || call.selector != transfer_selector {
            continue;
        }
        if call.calldata.len() < 3 {
            continue;
        }
        let recipient = call.calldata[0];
        if recipient != dev_wallet {
            continue;
        }
        let low = felt_to_u128(&call.calldata[1]).unwrap_or(0);
        let high = felt_to_u128(&call.calldata[2]).unwrap_or(0);
        if high != 0 {
            continue;
        }
        if low >= RENAME_FEE_CAREL_WEI {
            return Ok(());
        }
    }

    Err(AppError::BadRequest(
        "rename_onchain_tx_hash must include transfer >= 1 CAREL to configured DEV wallet"
            .to_string(),
    ))
}

// Internal helper that supports `verify_rename_payment_tx_hash` operations.
async fn verify_rename_payment_tx_hash(
    state: &AppState,
    auth_subject: &str,
    tx_hash: &str,
) -> Result<i64> {
    let dev_wallet = state
        .config
        .dev_wallet_address
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.starts_with("0x0000"))
        .ok_or_else(|| {
            AppError::BadRequest(
                "DEV_WALLET_ADDRESS is not configured. Cannot verify rename payment.".to_string(),
            )
        })?;
    let carel_token = state.config.carel_token_address.trim();
    if carel_token.is_empty() || carel_token.starts_with("0x0000") {
        return Err(AppError::BadRequest(
            "CAREL_TOKEN_ADDRESS is not configured".to_string(),
        ));
    }

    let allowed_senders = resolve_allowed_starknet_senders_async(state, auth_subject).await?;
    let reader = OnchainReader::from_config(&state.config)?;
    let tx_hash_felt = parse_felt(tx_hash)?;
    let carel_token_felt = parse_felt(carel_token)?;
    let dev_wallet_felt = parse_felt(dev_wallet)?;
    let mut last_error = String::new();

    for attempt in 0..5 {
        let tx = match reader.get_transaction(&tx_hash_felt).await {
            Ok(value) => value,
            Err(err) => {
                last_error = err.to_string();
                if attempt < 4 {
                    sleep(Duration::from_millis(900)).await;
                    continue;
                }
                break;
            }
        };

        verify_rename_fee_invoke_payload(&tx, &allowed_senders, carel_token_felt, dev_wallet_felt)?;

        match reader.get_transaction_receipt(&tx_hash_felt).await {
            Ok(receipt) => {
                if let ExecutionResult::Reverted { reason } = receipt.receipt.execution_result() {
                    return Err(AppError::BadRequest(format!(
                        "rename_onchain_tx_hash reverted: {}",
                        reason
                    )));
                }
                if matches!(
                    receipt.receipt.finality_status(),
                    TransactionFinalityStatus::PreConfirmed
                ) {
                    last_error = "transaction still pre-confirmed".to_string();
                    if attempt < 4 {
                        sleep(Duration::from_millis(900)).await;
                        continue;
                    }
                    break;
                }
                return Ok(receipt.block.block_number() as i64);
            }
            Err(err) => {
                last_error = err.to_string();
                if attempt < 4 {
                    sleep(Duration::from_millis(900)).await;
                    continue;
                }
            }
        }
    }

    Err(AppError::BadRequest(format!(
        "rename_onchain_tx_hash not confirmed on Starknet RPC: {}",
        last_error
    )))
}
