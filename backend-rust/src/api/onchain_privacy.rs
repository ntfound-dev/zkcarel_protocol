use super::AppState;
use crate::{
    crypto::hash,
    error::{AppError, Result},
    services::{
        onchain::{felt_to_u128, parse_felt, OnchainReader},
        privacy_verifier::{parse_privacy_verifier_kind, resolve_privacy_router_for_verifier},
    },
};
use serde::Deserialize;
use starknet_core::{
    types::{ExecutionResult, Felt, InvokeTransaction, Transaction, TransactionFinalityStatus},
    utils::get_selector_from_name,
};
use tokio::time::{sleep, Duration};

#[derive(Debug, Clone, Copy)]
pub enum HideBalanceFlow {
    Swap,
    Limit,
    Stake,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

#[derive(Debug, Deserialize, Clone)]
pub struct PrivacyVerificationPayload {
    pub verifier: Option<String>,
    pub nullifier: Option<String>,
    pub commitment: Option<String>,
    pub proof: Option<Vec<String>>,
    pub public_inputs: Option<Vec<String>>,
}

#[derive(Debug, Clone)]
struct ParsedExecuteCall {
    to: Felt,
    selector: Felt,
    calldata: Vec<Felt>,
}

/// Checks conditions for `should_run_privacy_verification`.
///
/// # Arguments
/// * Uses function parameters as validated input and runtime context.
///
/// # Returns
/// * `Ok(...)` when processing succeeds.
/// * `Err(AppError)` when validation, authorization, or integration checks fail.
///
/// # Notes
/// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
pub fn should_run_privacy_verification(hide_balance: bool) -> bool {
    hide_balance
}

/// Parses or transforms values for `normalize_onchain_tx_hash`.
///
/// # Arguments
/// * Uses function parameters as validated input and runtime context.
///
/// # Returns
/// * `Ok(...)` when processing succeeds.
/// * `Err(AppError)` when validation, authorization, or integration checks fail.
///
/// # Notes
/// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
pub fn normalize_onchain_tx_hash(tx_hash: Option<&str>) -> Result<Option<String>> {
    let Some(raw) = tx_hash.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    if !raw.starts_with("0x") {
        return Err(AppError::BadRequest(
            "onchain_tx_hash must start with 0x".to_string(),
        ));
    }
    if raw.len() > 66 {
        return Err(AppError::BadRequest(
            "onchain_tx_hash exceeds maximum length (66)".to_string(),
        ));
    }
    if !raw[2..].chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::BadRequest(
            "onchain_tx_hash must be hex-encoded".to_string(),
        ));
    }
    Ok(Some(raw.to_ascii_lowercase()))
}

// Internal helper that checks conditions for `is_dummy_garaga_payload`.
fn is_dummy_garaga_payload(proof: &[String], public_inputs: &[String]) -> bool {
    if proof.len() != 1 || public_inputs.len() != 1 {
        return false;
    }
    proof[0].trim().eq_ignore_ascii_case("0x1")
        && public_inputs[0].trim().eq_ignore_ascii_case("0x1")
}

// Internal helper that fetches data for `resolve_privacy_inputs`.
fn resolve_privacy_inputs(
    seed: &str,
    payload: Option<&PrivacyVerificationPayload>,
) -> Result<(String, String, Vec<String>, Vec<String>)> {
    let payload = payload.ok_or_else(|| {
        AppError::BadRequest("privacy payload is required when hide_balance=true".to_string())
    })?;

    let nullifier = payload
        .nullifier
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| seed.to_string());
    let commitment = payload
        .commitment
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| hash::hash_string(&format!("commitment:{seed}")));
    let proof = payload
        .proof
        .clone()
        .filter(|items| !items.is_empty())
        .ok_or_else(|| {
            AppError::BadRequest(
                "privacy.proof must be provided and non-empty when hide_balance=true".to_string(),
            )
        })?;
    let public_inputs = payload
        .public_inputs
        .clone()
        .filter(|items| !items.is_empty())
        .ok_or_else(|| {
            AppError::BadRequest(
                "privacy.public_inputs must be provided and non-empty when hide_balance=true"
                    .to_string(),
            )
        })?;
    if is_dummy_garaga_payload(&proof, &public_inputs) {
        return Err(AppError::BadRequest(
            "privacy.proof/public_inputs dummy payload (0x1) is not allowed; submit a real Garaga proof"
                .to_string(),
        ));
    }
    Ok((nullifier, commitment, proof, public_inputs))
}

// Internal helper that supports `felt_to_usize` operations.
fn felt_to_usize(value: &Felt, field_name: &str) -> Result<usize> {
    let raw = felt_to_u128(value).map_err(|_| {
        AppError::BadRequest(format!(
            "Invalid invoke calldata: {field_name} is not a valid number"
        ))
    })?;
    usize::try_from(raw).map_err(|_| {
        AppError::BadRequest(format!(
            "Invalid invoke calldata: {field_name} exceeds supported size"
        ))
    })
}

// Internal helper that parses or transforms values for `parse_execute_calls_offset`.
fn parse_execute_calls_offset(calldata: &[Felt]) -> Result<Vec<ParsedExecuteCall>> {
    if calldata.is_empty() {
        return Err(AppError::BadRequest(
            "Invalid invoke calldata: empty calldata".to_string(),
        ));
    }

    let calls_len = felt_to_usize(&calldata[0], "calls_len")?;
    let header_start = 1usize;
    let header_width = 4usize;
    let headers_end = header_start
        .checked_add(calls_len.checked_mul(header_width).ok_or_else(|| {
            AppError::BadRequest("Invalid invoke calldata: calls_len overflow".to_string())
        })?)
        .ok_or_else(|| {
            AppError::BadRequest("Invalid invoke calldata: malformed headers".to_string())
        })?;

    if calldata.len() <= headers_end {
        return Err(AppError::BadRequest(
            "Invalid invoke calldata: missing calldata length".to_string(),
        ));
    }

    let flattened_len = felt_to_usize(&calldata[headers_end], "flattened_len")?;
    let flattened_start = headers_end + 1;
    let flattened_end = flattened_start.checked_add(flattened_len).ok_or_else(|| {
        AppError::BadRequest("Invalid invoke calldata: flattened overflow".to_string())
    })?;

    if calldata.len() < flattened_end {
        return Err(AppError::BadRequest(
            "Invalid invoke calldata: flattened segment out of bounds".to_string(),
        ));
    }

    let flattened = &calldata[flattened_start..flattened_end];
    let mut calls = Vec::with_capacity(calls_len);

    for idx in 0..calls_len {
        let offset = header_start + idx * header_width;
        let to = calldata[offset];
        let selector = calldata[offset + 1];
        let data_offset = felt_to_usize(&calldata[offset + 2], "data_offset")?;
        let data_len = felt_to_usize(&calldata[offset + 3], "data_len")?;
        let data_end = data_offset.checked_add(data_len).ok_or_else(|| {
            AppError::BadRequest("Invalid invoke calldata: data segment overflow".to_string())
        })?;
        if data_end > flattened.len() {
            return Err(AppError::BadRequest(
                "Invalid invoke calldata: call segment out of bounds".to_string(),
            ));
        }

        calls.push(ParsedExecuteCall {
            to,
            selector,
            calldata: flattened[data_offset..data_end].to_vec(),
        });
    }

    Ok(calls)
}

// Internal helper that parses or transforms values for `parse_execute_calls_inline`.
fn parse_execute_calls_inline(calldata: &[Felt]) -> Result<Vec<ParsedExecuteCall>> {
    if calldata.is_empty() {
        return Err(AppError::BadRequest(
            "Invalid invoke calldata: empty calldata".to_string(),
        ));
    }
    let calls_len = felt_to_usize(&calldata[0], "calls_len")?;
    let mut cursor = 1usize;
    let mut calls = Vec::with_capacity(calls_len);

    for _ in 0..calls_len {
        let header_end = cursor.checked_add(3).ok_or_else(|| {
            AppError::BadRequest("Invalid invoke calldata: malformed call header".to_string())
        })?;
        if calldata.len() < header_end {
            return Err(AppError::BadRequest(
                "Invalid invoke calldata: missing inline call header".to_string(),
            ));
        }

        let to = calldata[cursor];
        let selector = calldata[cursor + 1];
        let data_len = felt_to_usize(&calldata[cursor + 2], "data_len")?;
        let data_start = cursor + 3;
        let data_end = data_start.checked_add(data_len).ok_or_else(|| {
            AppError::BadRequest("Invalid invoke calldata: inline data overflow".to_string())
        })?;
        if data_end > calldata.len() {
            return Err(AppError::BadRequest(
                "Invalid invoke calldata: inline data out of bounds".to_string(),
            ));
        }

        calls.push(ParsedExecuteCall {
            to,
            selector,
            calldata: calldata[data_start..data_end].to_vec(),
        });
        cursor = data_end;
    }

    Ok(calls)
}

// Internal helper that parses or transforms values for `parse_execute_calls`.
fn parse_execute_calls(calldata: &[Felt]) -> Result<Vec<ParsedExecuteCall>> {
    if let Ok(calls) = parse_execute_calls_offset(calldata) {
        return Ok(calls);
    }
    parse_execute_calls_inline(calldata)
}

// Internal helper that supports `extract_invoke_sender_and_calldata` operations.
fn extract_invoke_sender_and_calldata(tx: &Transaction) -> Result<(Felt, &[Felt])> {
    let invoke = match tx {
        Transaction::Invoke(invoke) => invoke,
        _ => {
            return Err(AppError::BadRequest(
                "onchain_tx_hash must be an INVOKE transaction".to_string(),
            ));
        }
    };

    match invoke {
        InvokeTransaction::V1(tx) => Ok((tx.sender_address, tx.calldata.as_slice())),
        InvokeTransaction::V3(tx) => Ok((tx.sender_address, tx.calldata.as_slice())),
        InvokeTransaction::V0(_) => Err(AppError::BadRequest(
            "onchain_tx_hash uses unsupported INVOKE v0".to_string(),
        )),
    }
}

// Internal helper that fetches data for `resolve_allowed_senders`.
async fn resolve_allowed_senders(
    state: &AppState,
    auth_subject: &str,
    resolved_starknet_user: &str,
) -> Result<Vec<Felt>> {
    let mut out: Vec<Felt> = Vec::new();
    for candidate in [resolved_starknet_user, auth_subject] {
        if let Ok(felt) = parse_felt(candidate) {
            if !out.contains(&felt) {
                out.push(felt);
            }
        }
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
            "No Starknet sender address resolved for hide_balance verification".to_string(),
        ));
    }
    Ok(out)
}

// Internal helper that supports `verify_sender_matches_invoke_payload` operations.
fn verify_sender_matches_invoke_payload(tx: &Transaction, allowed_senders: &[Felt]) -> Result<()> {
    if allowed_senders.is_empty() {
        return Err(AppError::BadRequest(
            "No Starknet sender allowed for hide_balance verification".to_string(),
        ));
    }
    let (sender, _) = extract_invoke_sender_and_calldata(tx)?;
    if allowed_senders.contains(&sender) {
        return Ok(());
    }
    let expected = allowed_senders
        .iter()
        .map(|felt| felt.to_string())
        .collect::<Vec<_>>()
        .join(", ");
    Err(AppError::BadRequest(format!(
        "onchain_tx_hash sender does not match authenticated Starknet user (expected one of [{}], got {})",
        expected, sender
    )))
}

// Internal helper that supports `verify_hide_balance_privacy_call_in_invoke_payload` operations.
struct HideBalanceCallExpectation<'a> {
    expected_router: Felt,
    expected_private_executor: Option<Felt>,
    flow: Option<HideBalanceFlow>,
    expected_nullifier: Felt,
    expected_commitment: Felt,
    expected_proof: &'a [Felt],
    expected_public_inputs: &'a [Felt],
}

fn verify_hide_balance_privacy_call_in_invoke_payload(
    tx: &Transaction,
    expected: &HideBalanceCallExpectation<'_>,
) -> Result<()> {
    let submit_selector = get_selector_from_name("submit_private_action")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let (_, calldata) = extract_invoke_sender_and_calldata(tx)?;
    let calls = parse_execute_calls(calldata).map_err(|err| {
        AppError::BadRequest(format!(
            "Failed to parse invoke calldata for hide_balance privacy verification: {}",
            err
        ))
    })?;

    let v1_matched = calls
        .into_iter()
        .find(|call| call.to == expected.expected_router && call.selector == submit_selector)
        .map(|matched| {
            let mut expected_calldata = Vec::with_capacity(
                4 + expected.expected_proof.len() + expected.expected_public_inputs.len(),
            );
            expected_calldata.push(expected.expected_nullifier);
            expected_calldata.push(expected.expected_commitment);
            expected_calldata.push(Felt::from(expected.expected_proof.len() as u64));
            expected_calldata.extend_from_slice(expected.expected_proof);
            expected_calldata.push(Felt::from(expected.expected_public_inputs.len() as u64));
            expected_calldata.extend_from_slice(expected.expected_public_inputs);
            matched.calldata == expected_calldata
        })
        .unwrap_or(false);

    if v1_matched {
        return Ok(());
    }

    let Some(private_executor) = expected.expected_private_executor else {
        return Err(AppError::BadRequest(
            "onchain_tx_hash does not include submit_private_action call to configured privacy router"
                .to_string(),
        ));
    };
    let Some(flow) = expected.flow else {
        return Err(AppError::BadRequest(
            "onchain_tx_hash privacy call payload does not match submitted Hide Balance proof payload"
                .to_string(),
        ));
    };

    let executor_kind = hide_executor_kind();
    let submit_selector_name = match executor_kind {
        HideExecutorKind::PrivateActionExecutorV1 => "submit_private_intent",
        HideExecutorKind::ShieldedPoolV2 => "submit_private_action",
    };
    let submit_private_selector = get_selector_from_name(submit_selector_name)
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let execute_entrypoints: &[&str] = match (executor_kind, flow) {
        (HideExecutorKind::ShieldedPoolV2, HideBalanceFlow::Swap) => {
            &["execute_private_swap_with_payout"]
        }
        (HideExecutorKind::PrivateActionExecutorV1, HideBalanceFlow::Swap) => {
            &["execute_private_swap_with_payout", "execute_private_swap"]
        }
        (_, HideBalanceFlow::Limit) => &["execute_private_limit_order"],
        (_, HideBalanceFlow::Stake) => &["execute_private_stake"],
    };
    let execute_private_selectors: Vec<Felt> = execute_entrypoints
        .iter()
        .map(|name| get_selector_from_name(name))
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let (_, calldata) = extract_invoke_sender_and_calldata(tx)?;
    let calls = parse_execute_calls(calldata).map_err(|err| {
        AppError::BadRequest(format!(
            "Failed to parse invoke calldata for private executor verification: {}",
            err
        ))
    })?;

    let submit_call = calls
        .iter()
        .find(|call| call.to == private_executor && call.selector == submit_private_selector)
        .ok_or_else(|| {
            AppError::BadRequest(format!(
                "onchain_tx_hash does not include {} call to configured PrivateActionExecutor",
                submit_selector_name
            ))
        })?;

    let submit_mismatch_err = match executor_kind {
        HideExecutorKind::PrivateActionExecutorV1 => {
            "onchain_tx_hash submit_private_intent payload does not match submitted Hide Balance proof payload"
                .to_string()
        }
        HideExecutorKind::ShieldedPoolV2 => {
            "onchain_tx_hash submit_private_action payload does not match submitted Hide Balance proof payload"
                .to_string()
        }
    };

    let mut expected_submit = Vec::with_capacity(
        4 + expected.expected_proof.len() + expected.expected_public_inputs.len(),
    );
    expected_submit.push(expected.expected_nullifier);
    expected_submit.push(expected.expected_commitment);
    expected_submit.push(Felt::from(expected.expected_proof.len() as u64));
    expected_submit.extend_from_slice(expected.expected_proof);
    expected_submit.push(Felt::from(expected.expected_public_inputs.len() as u64));
    expected_submit.extend_from_slice(expected.expected_public_inputs);

    if submit_call.calldata != expected_submit {
        return Err(AppError::BadRequest(submit_mismatch_err));
    }

    let execute_call = calls
        .iter()
        .find(|call| {
            call.to == private_executor && execute_private_selectors.contains(&call.selector)
        })
        .ok_or_else(|| {
            AppError::BadRequest(format!(
                "onchain_tx_hash does not include one of [{}] calls to configured PrivateActionExecutor",
                execute_entrypoints.join(", ")
            ))
        })?;

    if execute_call.calldata.is_empty() || execute_call.calldata[0] != expected.expected_commitment
    {
        return Err(AppError::BadRequest(
            "onchain_tx_hash private executor action does not bind the same commitment".to_string(),
        ));
    }

    Ok(())
}

// Internal helper that supports `configured_privacy_intermediary` operations.
fn configured_privacy_intermediary() -> Option<Felt> {
    for key in [
        "PRIVACY_INTERMEDIARY_ADDRESS",
        "NEXT_PUBLIC_PRIVACY_INTERMEDIARY_ADDRESS",
    ] {
        let Some(raw) = std::env::var(key)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        match parse_felt(&raw) {
            Ok(parsed) => return Some(parsed),
            Err(err) => {
                tracing::warn!("Ignoring invalid {} address '{}': {}", key, raw, err);
            }
        }
    }
    None
}

fn verify_hide_balance_privacy_call_via_intermediary(
    tx: &Transaction,
    intermediary: Felt,
    allowed_users: &[Felt],
    expected_nullifier: Felt,
    expected_commitment: Felt,
    expected_proof: &[Felt],
    expected_public_inputs: &[Felt],
) -> Result<bool> {
    let execute_selector =
        get_selector_from_name("execute").map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let (_, calldata) = extract_invoke_sender_and_calldata(tx)?;
    let calls = parse_execute_calls(calldata).map_err(|err| {
        AppError::BadRequest(format!(
            "Failed to parse invoke calldata for intermediary verification: {}",
            err
        ))
    })?;

    let Some(call) = calls
        .iter()
        .find(|call| call.to == intermediary && call.selector == execute_selector)
    else {
        return Ok(false);
    };

    // PrivacyIntermediary.execute calldata format:
    // user, token, amount_low, amount_high,
    // signature_len, signature...,
    // signature_selector, submit_selector, execute_selector,
    // nullifier, commitment, action_selector, nonce, deadline,
    // proof_len, proof..., public_inputs_len, public_inputs..., action_calldata_len, action_calldata...
    let data = &call.calldata;
    if data.len() < 16 {
        return Err(AppError::BadRequest(
            "onchain_tx_hash intermediary execute calldata too short".to_string(),
        ));
    }

    let user = data[0];
    if allowed_users.is_empty() || !allowed_users.contains(&user) {
        let expected = allowed_users
            .iter()
            .map(|felt| felt.to_string())
            .collect::<Vec<_>>()
            .join(", ");
        return Err(AppError::BadRequest(format!(
            "onchain_tx_hash intermediary user does not match authenticated Starknet user (expected one of [{}], got {})",
            expected, user
        )));
    }

    let mut cursor = 4usize;
    let signature_len = felt_to_usize(data.get(cursor).ok_or_else(|| {
        AppError::BadRequest("onchain_tx_hash intermediary calldata missing signature_len".to_string())
    })?, "signature_len")?;
    cursor += 1;
    let signature_end = cursor.checked_add(signature_len).ok_or_else(|| {
        AppError::BadRequest("onchain_tx_hash intermediary signature length overflow".to_string())
    })?;
    if signature_end > data.len() {
        return Err(AppError::BadRequest(
            "onchain_tx_hash intermediary signature out of bounds".to_string(),
        ));
    }
    cursor = signature_end;

    let params_fields_needed = 8usize;
    if cursor + params_fields_needed > data.len() {
        return Err(AppError::BadRequest(
            "onchain_tx_hash intermediary params header is incomplete".to_string(),
        ));
    }

    // Skip signature_selector, submit_selector, execute_selector.
    cursor += 3;
    let nullifier = data[cursor];
    cursor += 1;
    let commitment = data[cursor];
    cursor += 1;
    // Skip action_selector, nonce, deadline.
    cursor += 3;

    if nullifier != expected_nullifier || commitment != expected_commitment {
        return Err(AppError::BadRequest(
            "onchain_tx_hash intermediary payload does not bind expected nullifier/commitment"
                .to_string(),
        ));
    }

    let proof_len = felt_to_usize(
        data.get(cursor).ok_or_else(|| {
            AppError::BadRequest("onchain_tx_hash intermediary missing proof_len".to_string())
        })?,
        "proof_len",
    )?;
    cursor += 1;
    let proof_end = cursor.checked_add(proof_len).ok_or_else(|| {
        AppError::BadRequest("onchain_tx_hash intermediary proof length overflow".to_string())
    })?;
    if proof_end > data.len() {
        return Err(AppError::BadRequest(
            "onchain_tx_hash intermediary proof out of bounds".to_string(),
        ));
    }
    if data[cursor..proof_end] != expected_proof[..] {
        return Err(AppError::BadRequest(
            "onchain_tx_hash intermediary proof payload does not match submitted Hide Balance proof payload"
                .to_string(),
        ));
    }
    cursor = proof_end;

    let public_len = felt_to_usize(
        data.get(cursor).ok_or_else(|| {
            AppError::BadRequest(
                "onchain_tx_hash intermediary missing public_inputs_len".to_string(),
            )
        })?,
        "public_inputs_len",
    )?;
    cursor += 1;
    let public_end = cursor.checked_add(public_len).ok_or_else(|| {
        AppError::BadRequest(
            "onchain_tx_hash intermediary public_inputs length overflow".to_string(),
        )
    })?;
    if public_end > data.len() {
        return Err(AppError::BadRequest(
            "onchain_tx_hash intermediary public_inputs out of bounds".to_string(),
        ));
    }
    if data[cursor..public_end] != expected_public_inputs[..] {
        return Err(AppError::BadRequest(
            "onchain_tx_hash intermediary public_inputs payload does not match submitted Hide Balance proof payload"
                .to_string(),
        ));
    }

    Ok(true)
}

// Internal helper that supports `configured_private_action_executor` operations.
fn configured_private_action_executor() -> Option<Felt> {
    for key in [
        "PRIVATE_ACTION_EXECUTOR_ADDRESS",
        "NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS",
    ] {
        let Some(raw) = std::env::var(key)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        match parse_felt(&raw) {
            Ok(parsed) => return Some(parsed),
            Err(err) => {
                tracing::warn!("Ignoring invalid {} address '{}': {}", key, raw, err);
            }
        }
    }
    None
}

/// Handles `verify_onchain_hide_balance_invoke_tx` logic.
///
/// # Arguments
/// * Uses function parameters as validated input and runtime context.
///
/// # Returns
/// * `Ok(...)` when processing succeeds.
/// * `Err(AppError)` when validation, authorization, or integration checks fail.
///
/// # Notes
/// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
pub async fn verify_onchain_hide_balance_invoke_tx(
    state: &AppState,
    tx_hash: &str,
    auth_subject: &str,
    resolved_starknet_user: &str,
    payload: Option<&PrivacyVerificationPayload>,
    flow: Option<HideBalanceFlow>,
) -> Result<()> {
    let verifier = parse_privacy_verifier_kind(payload.and_then(|p| p.verifier.as_deref()))?;
    let router = resolve_privacy_router_for_verifier(&state.config, verifier)?;
    let expected_router = parse_felt(&router)?;
    let (nullifier, commitment, proof, public_inputs) = resolve_privacy_inputs(tx_hash, payload)?;
    let allowed_senders =
        resolve_allowed_senders(state, auth_subject, resolved_starknet_user).await?;

    let expected_nullifier = parse_felt(&nullifier)?;
    let expected_commitment = parse_felt(&commitment)?;
    let expected_proof: Vec<Felt> = proof
        .iter()
        .map(|value| parse_felt(value))
        .collect::<Result<Vec<_>>>()?;
    let expected_public_inputs: Vec<Felt> = public_inputs
        .iter()
        .map(|value| parse_felt(value))
        .collect::<Result<Vec<_>>>()?;
    let expected_private_executor = configured_private_action_executor();
    let expected_intermediary = configured_privacy_intermediary();

    let reader = OnchainReader::from_config(&state.config)?;
    let tx_hash_felt = parse_felt(tx_hash)?;
    let mut last_rpc_error = String::new();

    for attempt in 0..5 {
        let tx = match reader.get_transaction(&tx_hash_felt).await {
            Ok(tx) => tx,
            Err(err) => {
                last_rpc_error = err.to_string();
                if attempt < 4 {
                    sleep(Duration::from_millis(1000)).await;
                    continue;
                }
                break;
            }
        };

        let matched_intermediary = if let Some(intermediary) = expected_intermediary {
            verify_hide_balance_privacy_call_via_intermediary(
                &tx,
                intermediary,
                &allowed_senders,
                expected_nullifier,
                expected_commitment,
                &expected_proof,
                &expected_public_inputs,
            )?
        } else {
            false
        };

        if !matched_intermediary {
            verify_sender_matches_invoke_payload(&tx, &allowed_senders)?;
            let expectation = HideBalanceCallExpectation {
                expected_router,
                expected_private_executor,
                flow,
                expected_nullifier,
                expected_commitment,
                expected_proof: &expected_proof,
                expected_public_inputs: &expected_public_inputs,
            };
            verify_hide_balance_privacy_call_in_invoke_payload(&tx, &expectation)?;
        }

        match reader.get_transaction_receipt(&tx_hash_felt).await {
            Ok(receipt) => {
                if let ExecutionResult::Reverted { reason } = receipt.receipt.execution_result() {
                    return Err(AppError::BadRequest(format!(
                        "onchain_tx_hash reverted on Starknet: {}",
                        reason
                    )));
                }
                if matches!(
                    receipt.receipt.finality_status(),
                    TransactionFinalityStatus::PreConfirmed
                ) {
                    last_rpc_error = "transaction still pre-confirmed".to_string();
                    if attempt < 4 {
                        sleep(Duration::from_millis(1000)).await;
                        continue;
                    }
                    break;
                }
                return Ok(());
            }
            Err(err) => {
                last_rpc_error = err.to_string();
                if attempt < 4 {
                    sleep(Duration::from_millis(1000)).await;
                    continue;
                }
                break;
            }
        }
    }

    Err(AppError::BadRequest(format!(
        "onchain_tx_hash not found/confirmed on Starknet RPC: {}",
        last_rpc_error
    )))
}
