use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use serde::{Deserialize, Serialize};

use super::privacy::{
    bind_intent_hash_into_payload, ensure_public_inputs_bind_nullifier_commitment,
    generate_auto_garaga_payload, AutoPrivacyPayloadResponse, AutoPrivacyTxContext,
};
use super::swap::{parse_decimal_to_u256_parts, token_decimals};
use crate::services::notification_service::{NotificationService, NotificationType};
use crate::services::onchain::{felt_to_u128, parse_felt, OnchainInvoker, OnchainReader};
use crate::services::privacy_verifier::parse_privacy_verifier_kind;
use crate::{
    // 1. Import modul hash agar terpakai
    constants::token_address_for,
    crypto::hash,
    error::Result,
    models::{
        user::PrivacyVerificationPayload as ModelPrivacyVerificationPayload, ApiResponse,
        CreateLimitOrderRequest, LimitOrder, PaginatedResponse,
    },
    services::nft_discount::consume_nft_usage_if_active,
};
use starknet_core::types::{Call, Felt, FunctionCall};
use starknet_core::utils::get_selector_from_name;

use super::{
    onchain_privacy::{
        normalize_onchain_tx_hash, should_run_privacy_verification,
        verify_onchain_hide_balance_invoke_tx, HideBalanceFlow,
        PrivacyVerificationPayload as OnchainPrivacyPayload,
    },
    require_starknet_user, require_user, AppState,
};

#[derive(Debug, Serialize)]
pub struct CreateOrderResponse {
    pub order_id: String,
    pub status: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub privacy_tx_hash: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListOrdersQuery {
    pub status: Option<String>,
    pub page: Option<i32>,
    pub limit: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct CancelOrderRequest {
    pub onchain_tx_hash: Option<String>,
    pub hide_balance: Option<bool>,
    pub privacy: Option<ModelPrivacyVerificationPayload>,
}

// Internal helper that supports `expiry_duration_for` operations in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn expiry_duration_for(expiry: &str) -> chrono::Duration {
    match expiry {
        "1d" => chrono::Duration::days(1),
        "7d" => chrono::Duration::days(7),
        "30d" => chrono::Duration::days(30),
        _ => chrono::Duration::days(7),
    }
}

// Internal helper that builds inputs for `build_order_id` in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn build_order_id(
    user_address: &str,
    from_token: &str,
    to_token: &str,
    amount: f64,
    now_ts: i64,
) -> String {
    let order_data = format!(
        "{}{}{}{}{}",
        user_address, from_token, to_token, amount, now_ts
    );
    // Keep length <= 66 to fit DB (varchar(66))
    hash::hash_string(&order_data)
}

// Internal helper that checks conditions for `is_supported_limit_order_token` in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn is_supported_limit_order_token(token: &str) -> bool {
    matches!(
        token.trim().to_ascii_uppercase().as_str(),
        "USDT" | "USDC" | "STRK" | "CAREL"
    )
}

// Internal helper that runs side-effecting logic for `ensure_supported_limit_order_pair` in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn ensure_supported_limit_order_pair(from_token: &str, to_token: &str) -> Result<()> {
    if from_token.trim().eq_ignore_ascii_case(to_token.trim()) {
        return Err(crate::error::AppError::BadRequest(
            "Source and destination tokens cannot be the same.".to_string(),
        ));
    }
    if !is_supported_limit_order_token(from_token) || !is_supported_limit_order_token(to_token) {
        return Err(crate::error::AppError::BadRequest(
            "Limit order token is not listed. Supported symbols: USDT, USDC, STRK, CAREL."
                .to_string(),
        ));
    }
    Ok(())
}

// Internal helper that supports `map_privacy_payload` operations in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
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

// Internal helper that parses or transforms values for `normalize_order_id` in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn normalize_order_id(
    raw: Option<&str>,
) -> std::result::Result<Option<String>, crate::error::AppError> {
    let Some(value) = raw.map(str::trim).filter(|item| !item.is_empty()) else {
        return Ok(None);
    };
    if !value.starts_with("0x") {
        return Err(crate::error::AppError::BadRequest(
            "client_order_id must start with 0x".to_string(),
        ));
    }
    if value.len() > 66 {
        return Err(crate::error::AppError::BadRequest(
            "client_order_id exceeds maximum length (66)".to_string(),
        ));
    }
    if !value[2..].chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(crate::error::AppError::BadRequest(
            "client_order_id must be hex-encoded".to_string(),
        ));
    }
    Ok(Some(value.to_ascii_lowercase()))
}

// Internal helper that supports `env_flag` operations in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
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

// Internal helper that supports `hide_balance_relayer_pool_enabled` operations in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn hide_balance_relayer_pool_enabled() -> bool {
    env_flag("HIDE_BALANCE_RELAYER_POOL_ENABLED", false)
}

// Internal helper that supports `hide_balance_limit_order_relayer_pool_enabled` operations in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn hide_balance_limit_order_relayer_pool_enabled() -> bool {
    hide_balance_relayer_pool_enabled()
        && env_flag("HIDE_BALANCE_RELAYER_POOL_LIMIT_ENABLED", false)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum HideExecutorKind {
    PrivateActionExecutorV1,
    ShieldedPoolV2,
}

// Internal helper that supports `hide_executor_kind` operations in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
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

// Internal helper that fetches data for `resolve_private_action_executor_felt` in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
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

// Internal helper that fetches data for `resolve_limit_order_target_felt` in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn resolve_limit_order_target_felt(state: &AppState) -> Result<Felt> {
    parse_felt(state.config.limit_order_book_address.trim()).map_err(|e| {
        crate::error::AppError::BadRequest(format!(
            "LIMIT_ORDER_BOOK_ADDRESS invalid for hide-mode executor: {}",
            e
        ))
    })
}

// Internal helper that parses or transforms values for `normalize_hex_items` in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn normalize_hex_items(items: &[String]) -> Vec<String> {
    items
        .iter()
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

// Internal helper that supports `payload_from_request` operations in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
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

// Internal helper that supports `compute_limit_intent_hash_on_executor` operations in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn compute_limit_intent_hash_on_executor(
    state: &AppState,
    executor: Felt,
    action_target: Felt,
    action_selector: Felt,
    action_calldata: &[Felt],
    approval_token: Felt,
) -> Result<String> {
    let reader = OnchainReader::from_config(&state.config)?;
    let selector_name = match hide_executor_kind() {
        HideExecutorKind::PrivateActionExecutorV1 => "preview_limit_intent_hash",
        HideExecutorKind::ShieldedPoolV2 => "preview_limit_action_hash",
    };
    let selector = get_selector_from_name(selector_name)
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    let mut calldata: Vec<Felt> = Vec::with_capacity(5 + action_calldata.len());
    if hide_executor_kind() == HideExecutorKind::ShieldedPoolV2 {
        calldata.push(action_target);
    }
    calldata.push(action_selector);
    calldata.push(Felt::from(action_calldata.len() as u64));
    calldata.extend_from_slice(action_calldata);
    if hide_executor_kind() == HideExecutorKind::ShieldedPoolV2 {
        calldata.push(approval_token);
    }

    let out = reader
        .call(FunctionCall {
            contract_address: executor,
            entry_point_selector: selector,
            calldata,
        })
        .await?;
    let intent_hash = out.first().ok_or_else(|| {
        crate::error::AppError::BadRequest(
            "PrivateActionExecutor preview returned empty response".to_string(),
        )
    })?;
    Ok(intent_hash.to_string())
}

// Internal helper that builds inputs for `build_submit_private_intent_call` in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
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

// Internal helper that builds inputs for `build_execute_private_limit_call` in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn build_execute_private_limit_call(
    executor: Felt,
    payload: &AutoPrivacyPayloadResponse,
    action_target: Felt,
    action_selector: Felt,
    action_calldata: &[Felt],
    approval_token: Felt,
) -> Result<Call> {
    let selector = get_selector_from_name("execute_private_limit_order")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    let mut calldata: Vec<Felt> = Vec::with_capacity(6 + action_calldata.len());
    calldata.push(parse_felt(payload.commitment.trim())?);
    if hide_executor_kind() == HideExecutorKind::ShieldedPoolV2 {
        calldata.push(action_target);
    }
    calldata.push(action_selector);
    calldata.push(Felt::from(action_calldata.len() as u64));
    calldata.extend_from_slice(action_calldata);
    if hide_executor_kind() == HideExecutorKind::ShieldedPoolV2 {
        calldata.push(approval_token);
    }

    Ok(Call {
        to: executor,
        selector,
        calldata,
    })
}

// Internal helper that builds inputs for `build_shielded_set_asset_rule_call` in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
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

// Internal helper that builds inputs for `build_shielded_deposit_fixed_for_call` in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn build_shielded_deposit_fixed_for_call(
    executor: Felt,
    depositor: Felt,
    token: Felt,
    note_commitment: Felt,
) -> Result<Call> {
    let selector = get_selector_from_name("deposit_fixed_for")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    Ok(Call {
        to: executor,
        selector,
        calldata: vec![depositor, token, note_commitment],
    })
}

// Internal helper that supports `shielded_note_registered` operations in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
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

// Internal helper that supports `shielded_fixed_amount` operations in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
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

// Internal helper that supports `u256_is_greater` operations in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
fn u256_is_greater(
    left_low: Felt,
    left_high: Felt,
    right_low: Felt,
    right_high: Felt,
    left_label: &str,
    right_label: &str,
) -> Result<bool> {
    let left_low_u128 = felt_to_u128(&left_low).map_err(|_| {
        crate::error::AppError::BadRequest(format!(
            "Invalid {} (low) from on-chain response",
            left_label
        ))
    })?;
    let left_high_u128 = felt_to_u128(&left_high).map_err(|_| {
        crate::error::AppError::BadRequest(format!(
            "Invalid {} (high) from on-chain response",
            left_label
        ))
    })?;
    let right_low_u128 = felt_to_u128(&right_low).map_err(|_| {
        crate::error::AppError::BadRequest(format!(
            "Invalid {} (low) from on-chain response",
            right_label
        ))
    })?;
    let right_high_u128 = felt_to_u128(&right_high).map_err(|_| {
        crate::error::AppError::BadRequest(format!(
            "Invalid {} (high) from on-chain response",
            right_label
        ))
    })?;
    Ok((left_high_u128, left_low_u128) > (right_high_u128, right_low_u128))
}

// Internal helper that fetches data for `read_erc20_balance_parts` in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn read_erc20_balance_parts(
    reader: &OnchainReader,
    token: Felt,
    owner: Felt,
) -> Result<(Felt, Felt)> {
    let selector = get_selector_from_name("balance_of")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    let out = reader
        .call(FunctionCall {
            contract_address: token,
            entry_point_selector: selector,
            calldata: vec![owner],
        })
        .await?;
    if out.len() < 2 {
        return Err(crate::error::AppError::BadRequest(
            "ERC20 balance_of returned invalid response".to_string(),
        ));
    }
    Ok((out[0], out[1]))
}

// Internal helper that fetches data for `read_erc20_allowance_parts` in the limit-order flow.
// Keeps validation, normalization, and intent-binding logic centralized.
async fn read_erc20_allowance_parts(
    reader: &OnchainReader,
    token: Felt,
    owner: Felt,
    spender: Felt,
) -> Result<(Felt, Felt)> {
    let selector = get_selector_from_name("allowance")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    let out = reader
        .call(FunctionCall {
            contract_address: token,
            entry_point_selector: selector,
            calldata: vec![owner, spender],
        })
        .await?;
    if out.len() < 2 {
        return Err(crate::error::AppError::BadRequest(
            "ERC20 allowance returned invalid response".to_string(),
        ));
    }
    Ok((out[0], out[1]))
}

// Struct bantuan untuk menghitung total
#[derive(sqlx::FromRow)]
struct CountResult {
    count: i64,
}

/// POST /api/v1/limit-order/create
pub async fn create_order(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateLimitOrderRequest>,
) -> Result<Json<ApiResponse<CreateOrderResponse>>> {
    let auth_subject = require_user(&headers, &state).await?;
    let user_address = require_starknet_user(&headers, &state).await?;
    let _ = state
        .db
        .expire_limit_orders_for_owner(&user_address)
        .await?;

    let amount: f64 = req
        .amount
        .parse()
        .map_err(|_| crate::error::AppError::BadRequest("Invalid amount".to_string()))?;

    let price: f64 = req
        .price
        .parse()
        .map_err(|_| crate::error::AppError::BadRequest("Invalid price".to_string()))?;

    if amount <= 0.0 || price <= 0.0 {
        return Err(crate::error::AppError::BadRequest(
            "Amount and price must be greater than 0".to_string(),
        ));
    }
    ensure_supported_limit_order_pair(&req.from_token, &req.to_token)?;
    let should_hide = should_run_privacy_verification(req.hide_balance.unwrap_or(false));
    let expiry_duration = expiry_duration_for(&req.expiry);
    let now = chrono::Utc::now();
    let expiry = now + expiry_duration;
    let expiry_ts = expiry.timestamp();
    // 2. GUNAKAN HASHER untuk membuat Order ID (Menghilangkan warning di hash.rs)
    let order_id = normalize_order_id(req.client_order_id.as_deref())?.unwrap_or_else(|| {
        build_order_id(
            &user_address,
            &req.from_token,
            &req.to_token,
            amount,
            now.timestamp(),
        )
    });
    let use_relayer_pool_hide = should_hide && hide_balance_limit_order_relayer_pool_enabled();
    let tx_hash = if use_relayer_pool_hide {
        let executor = resolve_private_action_executor_felt(&state.config)?;
        let action_target = resolve_limit_order_target_felt(&state)?;
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
                flow: Some("limit_order".to_string()),
                from_token: Some(req.from_token.clone()),
                to_token: Some(req.to_token.clone()),
                amount: Some(req.amount.clone()),
                recipient: req.recipient.clone(),
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
            "limit order hide payload",
        )?;

        let from_token = token_address_for(&req.from_token)
            .ok_or(crate::error::AppError::InvalidToken)
            .and_then(parse_felt)?;
        let to_token = token_address_for(&req.to_token)
            .ok_or(crate::error::AppError::InvalidToken)
            .and_then(parse_felt)?;
        let order_id_felt = parse_felt(&order_id)?;
        let (amount_low, amount_high) =
            parse_decimal_to_u256_parts(&req.amount, token_decimals(&req.from_token))?;
        let (price_low, price_high) = parse_decimal_to_u256_parts(&req.price, 18)?;
        let action_selector = get_selector_from_name("create_limit_order")
            .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
        let action_calldata = vec![
            order_id_felt,
            from_token,
            to_token,
            amount_low,
            amount_high,
            price_low,
            price_high,
            Felt::from(expiry_ts as u64),
        ];
        let mut relayer_calls: Vec<Call> = Vec::new();
        if hide_executor_kind() == HideExecutorKind::ShieldedPoolV2 {
            let commitment_felt = parse_felt(payload.commitment.trim())?;
            let user_felt = parse_felt(&user_address)?;
            let note_registered =
                shielded_note_registered(&state, executor, commitment_felt).await?;
            if !note_registered {
                let (fixed_low, fixed_high) =
                    shielded_fixed_amount(&state, executor, from_token).await?;
                if fixed_low != amount_low || fixed_high != amount_high {
                    relayer_calls.push(build_shielded_set_asset_rule_call(
                        executor,
                        from_token,
                        amount_low,
                        amount_high,
                    )?);
                }
                let reader = OnchainReader::from_config(&state.config)?;
                let (balance_low, balance_high) =
                    read_erc20_balance_parts(&reader, from_token, user_felt).await?;
                if u256_is_greater(
                    amount_low,
                    amount_high,
                    balance_low,
                    balance_high,
                    "requested hide deposit",
                    "user balance",
                )? {
                    return Err(crate::error::AppError::BadRequest(format!(
                        "Shielded note funding failed: insufficient {} balance. Needed {}.",
                        req.from_token.to_ascii_uppercase(),
                        req.amount
                    )));
                }
                let (allowance_low, allowance_high) =
                    read_erc20_allowance_parts(&reader, from_token, user_felt, executor).await?;
                if u256_is_greater(
                    amount_low,
                    amount_high,
                    allowance_low,
                    allowance_high,
                    "requested hide deposit",
                    "token allowance",
                )? {
                    return Err(crate::error::AppError::BadRequest(format!(
                        "Shielded note funding failed: insufficient allowance. Approve {} {} to executor {} first.",
                        req.amount,
                        req.from_token.to_ascii_uppercase(),
                        format!("{:#x}", executor)
                    )));
                }
                relayer_calls.push(build_shielded_deposit_fixed_for_call(
                    executor,
                    user_felt,
                    from_token,
                    commitment_felt,
                )?);
            }
        }

        let intent_hash = compute_limit_intent_hash_on_executor(
            &state,
            executor,
            action_target,
            action_selector,
            &action_calldata,
            from_token,
        )
        .await?;
        bind_intent_hash_into_payload(&mut payload, &intent_hash)?;
        ensure_public_inputs_bind_nullifier_commitment(
            &payload.nullifier,
            &payload.commitment,
            &payload.public_inputs,
            "limit order hide payload (bound)",
        )?;

        let Some(invoker) = OnchainInvoker::from_config(&state.config).ok().flatten() else {
            return Err(crate::error::AppError::BadRequest(
                "On-chain relayer account is not configured for hide mode".to_string(),
            ));
        };
        let submit_call = build_submit_private_intent_call(executor, &payload)?;
        let execute_call = build_execute_private_limit_call(
            executor,
            &payload,
            action_target,
            action_selector,
            &action_calldata,
            from_token,
        )?;
        relayer_calls.push(submit_call);
        relayer_calls.push(execute_call);
        let tx_hash_felt = invoker.invoke_many(relayer_calls).await?;
        format!("{:#x}", tx_hash_felt)
    } else {
        let onchain_tx_hash = normalize_onchain_tx_hash(req.onchain_tx_hash.as_deref())?;
        let tx_hash = onchain_tx_hash.ok_or_else(|| {
            crate::error::AppError::BadRequest(
                "Create order requires onchain_tx_hash from user-signed Starknet transaction"
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
                Some(HideBalanceFlow::Limit),
            )
            .await?;
        }
        tx_hash
    };

    let order = LimitOrder {
        order_id: order_id.clone(),
        owner: user_address.to_string(),
        from_token: req.from_token,
        to_token: req.to_token,
        amount: rust_decimal::Decimal::from_f64_retain(amount).unwrap(),
        filled: rust_decimal::Decimal::ZERO,
        price: rust_decimal::Decimal::from_f64_retain(price).unwrap(),
        expiry,
        recipient: req.recipient,
        status: 0,
        created_at: now,
    };

    state.db.create_limit_order(&order).await?;
    if let Err(err) =
        consume_nft_usage_if_active(&state.config, &user_address, "limit_order_create").await
    {
        tracing::warn!(
            "Failed to consume NFT discount usage after limit order create: user={} order_id={} err={}",
            user_address,
            order_id,
            err
        );
    }
    let notification_service = NotificationService::new(state.db.clone(), state.config.clone());
    let _ = notification_service
        .send_notification(
            &user_address,
            NotificationType::System,
            "Limit order submitted".to_string(),
            "Order submitted on-chain and queued for execution.".to_string(),
            Some(serde_json::json!({
                "source": "limit_order.create",
                "order_id": order_id,
                "onchain_tx_hash": tx_hash,
                "privacy_tx_hash": if should_hide { Some(tx_hash.clone()) } else { None::<String> },
            })),
        )
        .await;

    let response = CreateOrderResponse {
        order_id,
        status: if use_relayer_pool_hide {
            "submitted_relayer".to_string()
        } else {
            "submitted_onchain".to_string()
        },
        created_at: order.created_at,
        privacy_tx_hash: if should_hide { Some(tx_hash) } else { None },
    };

    Ok(Json(ApiResponse::success(response)))
}

/// GET /api/v1/limit-order/list
pub async fn list_orders(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(query): axum::extract::Query<ListOrdersQuery>,
) -> Result<Json<ApiResponse<PaginatedResponse<LimitOrder>>>> {
    let user_address = require_starknet_user(&headers, &state).await?;
    let _ = state
        .db
        .expire_limit_orders_for_owner(&user_address)
        .await?;
    let page = query.page.unwrap_or(1);
    let limit = query.limit.unwrap_or(10);
    let offset = (page - 1) * limit;

    // Logika penggunaan status agar tidak dead code
    let status_int = query.status.as_ref().map(|s| match s.as_str() {
        "active" => 0,
        "filled" => 2,
        "cancelled" => 3,
        _ => 0,
    });

    // Menggunakan query dinamis sederhana
    let orders = if let Some(s) = status_int {
        sqlx::query_as::<_, LimitOrder>(
            "SELECT * FROM limit_orders WHERE owner = $1 AND status = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4"
        )
        .bind(&user_address)
        .bind(s)
        .bind(limit as i64)
        .bind(offset as i64)
        .fetch_all(state.db.pool())
        .await?
    } else {
        sqlx::query_as::<_, LimitOrder>(
            "SELECT * FROM limit_orders WHERE owner = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3"
        )
        .bind(&user_address)
        .bind(limit as i64)
        .bind(offset as i64)
        .fetch_all(state.db.pool())
        .await?
    };

    // Hitung total dengan filter status juga jika ada
    let total_query = if let Some(s) = status_int {
        sqlx::query_as::<_, CountResult>(
            "SELECT COUNT(*) as count FROM limit_orders WHERE owner = $1 AND status = $2",
        )
        .bind(&user_address)
        .bind(s)
    } else {
        sqlx::query_as::<_, CountResult>(
            "SELECT COUNT(*) as count FROM limit_orders WHERE owner = $1",
        )
        .bind(&user_address)
    };

    let total_res = total_query.fetch_one(state.db.pool()).await?;

    let response = PaginatedResponse {
        items: orders,
        page,
        limit,
        total: total_res.count,
    };

    Ok(Json(ApiResponse::success(response)))
}

/// DELETE /api/v1/limit-order/:order_id
pub async fn cancel_order(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(order_id): Path<String>,
    Json(req): Json<CancelOrderRequest>,
) -> Result<Json<ApiResponse<String>>> {
    let auth_subject = require_user(&headers, &state).await?;
    let user_address = require_starknet_user(&headers, &state).await?;
    let _ = state
        .db
        .expire_limit_orders_for_owner(&user_address)
        .await?;
    let should_hide = should_run_privacy_verification(req.hide_balance.unwrap_or(false));
    let order = state
        .db
        .get_limit_order(&order_id)
        .await?
        .ok_or(crate::error::AppError::OrderNotFound)?;

    if order.owner != user_address {
        return Err(crate::error::AppError::AuthError(
            "Not allowed to cancel this order".to_string(),
        ));
    }

    if order.status == 2 {
        return Err(crate::error::AppError::BadRequest(
            "Order already filled".to_string(),
        ));
    }
    if order.status == 4 {
        return Err(crate::error::AppError::BadRequest(
            "Order already expired. Create a new order if you still want to trade.".to_string(),
        ));
    }

    let use_relayer_pool_hide = should_hide && hide_balance_limit_order_relayer_pool_enabled();
    let tx_hash = if use_relayer_pool_hide {
        let executor = resolve_private_action_executor_felt(&state.config)?;
        let action_target = resolve_limit_order_target_felt(&state)?;
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
                flow: Some("limit_order_cancel".to_string()),
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
            "limit cancel hide payload",
        )?;
        let action_selector = get_selector_from_name("cancel_limit_order")
            .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
        let action_calldata = vec![parse_felt(&order_id)?];
        let approval_token = if hide_executor_kind() == HideExecutorKind::ShieldedPoolV2 {
            token_address_for(&order.from_token)
                .ok_or(crate::error::AppError::InvalidToken)
                .and_then(parse_felt)?
        } else {
            Felt::ZERO
        };
        let intent_hash = compute_limit_intent_hash_on_executor(
            &state,
            executor,
            action_target,
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
            "limit cancel hide payload (bound)",
        )?;
        let mut relayer_calls: Vec<Call> = Vec::new();
        if hide_executor_kind() == HideExecutorKind::ShieldedPoolV2 {
            let commitment_felt = parse_felt(payload.commitment.trim())?;
            let user_felt = parse_felt(&user_address)?;
            let note_registered =
                shielded_note_registered(&state, executor, commitment_felt).await?;
            if !note_registered {
                let (mut note_amount_low, mut note_amount_high) =
                    shielded_fixed_amount(&state, executor, approval_token).await?;
                if note_amount_low == Felt::ZERO && note_amount_high == Felt::ZERO {
                    note_amount_low = Felt::from(1_u8);
                    note_amount_high = Felt::ZERO;
                }
                let (fixed_low, fixed_high) =
                    shielded_fixed_amount(&state, executor, approval_token).await?;
                if fixed_low != note_amount_low || fixed_high != note_amount_high {
                    relayer_calls.push(build_shielded_set_asset_rule_call(
                        executor,
                        approval_token,
                        note_amount_low,
                        note_amount_high,
                    )?);
                }
                let reader = OnchainReader::from_config(&state.config)?;
                let (balance_low, balance_high) =
                    read_erc20_balance_parts(&reader, approval_token, user_felt).await?;
                if u256_is_greater(
                    note_amount_low,
                    note_amount_high,
                    balance_low,
                    balance_high,
                    "requested hide deposit",
                    "user balance",
                )? {
                    return Err(crate::error::AppError::BadRequest(format!(
                        "Shielded note funding failed: insufficient {} balance for cancel action.",
                        order.from_token.to_ascii_uppercase()
                    )));
                }
                let (allowance_low, allowance_high) =
                    read_erc20_allowance_parts(&reader, approval_token, user_felt, executor)
                        .await?;
                if u256_is_greater(
                    note_amount_low,
                    note_amount_high,
                    allowance_low,
                    allowance_high,
                    "requested hide deposit",
                    "token allowance",
                )? {
                    return Err(crate::error::AppError::BadRequest(format!(
                        "Shielded note funding failed: insufficient allowance. Approve one-time spending limit for token {} to executor {} first.",
                        order.from_token.to_ascii_uppercase(),
                        format!("{:#x}", executor)
                    )));
                }
                relayer_calls.push(build_shielded_deposit_fixed_for_call(
                    executor,
                    user_felt,
                    approval_token,
                    commitment_felt,
                )?);
            }
        }
        let Some(invoker) = OnchainInvoker::from_config(&state.config).ok().flatten() else {
            return Err(crate::error::AppError::BadRequest(
                "On-chain relayer account is not configured for hide mode".to_string(),
            ));
        };
        let submit_call = build_submit_private_intent_call(executor, &payload)?;
        let execute_call = build_execute_private_limit_call(
            executor,
            &payload,
            action_target,
            action_selector,
            &action_calldata,
            approval_token,
        )?;
        relayer_calls.push(submit_call);
        relayer_calls.push(execute_call);
        let tx_hash_felt = invoker.invoke_many(relayer_calls).await?;
        format!("{:#x}", tx_hash_felt)
    } else {
        let onchain_tx_hash = normalize_onchain_tx_hash(req.onchain_tx_hash.as_deref())?;
        let tx_hash = onchain_tx_hash.ok_or_else(|| {
            crate::error::AppError::BadRequest(
                "Cancel order requires onchain_tx_hash from user-signed Starknet transaction"
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
                Some(HideBalanceFlow::Limit),
            )
            .await?;
        }
        tx_hash
    };

    state.db.update_order_status(&order_id, 3).await?;
    tracing::info!(
        "Limit order cancelled: user={}, order_id={}, onchain_tx_hash={}",
        user_address,
        order_id,
        tx_hash
    );

    Ok(Json(ApiResponse::success(
        "Order cancelled successfully".to_string(),
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    // Internal helper that supports `expiry_duration_for_defaults_to_7d` operations in the limit-order flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn expiry_duration_for_defaults_to_7d() {
        // Memastikan input tidak dikenal memakai 7 hari
        let duration = expiry_duration_for("unknown");
        assert_eq!(duration.num_days(), 7);
    }

    #[test]
    // Internal helper that builds inputs for `build_order_id_is_stable` in the limit-order flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn build_order_id_is_stable() {
        // Memastikan order_id konsisten untuk input yang sama
        let id = build_order_id("0xabc", "ETH", "USDT", 10.0, 1_700_000_000);
        let order_data = format!("{}{}{}{}{}", "0xabc", "ETH", "USDT", 10.0, 1_700_000_000);
        let expected = hash::hash_string(&order_data);
        assert_eq!(id, expected);
    }

    #[test]
    // Internal helper that runs side-effecting logic for `ensure_supported_limit_order_pair_accepts_listed_tokens` in the limit-order flow.
    // Keeps validation, normalization, and intent-binding logic centralized.
    fn ensure_supported_limit_order_pair_accepts_listed_tokens() {
        assert!(ensure_supported_limit_order_pair("STRK", "USDT").is_ok());
        assert!(ensure_supported_limit_order_pair("CAREL", "USDC").is_ok());
        assert!(ensure_supported_limit_order_pair("WBTC", "USDT").is_err());
        assert!(ensure_supported_limit_order_pair("ETH", "USDT").is_err());
        assert!(ensure_supported_limit_order_pair("USDT", "USDT").is_err());
    }
}
