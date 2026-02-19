use crate::{
    error::{AppError, Result},
    models::{ApiResponse, StarknetWalletCall},
    services::onchain::{parse_felt, OnchainInvoker},
    services::privacy_verifier::{
        parse_privacy_verifier_kind, resolve_privacy_router_for_verifier,
    },
};
use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use starknet_core::types::{Call, Felt, FunctionCall};
use starknet_core::utils::get_selector_from_name;
use std::{process::Stdio, time::Duration};
use tokio::{io::AsyncWriteExt, process::Command};

use super::{require_user, AppState};

#[derive(Debug, Deserialize)]
pub struct PrivacyActionRequest {
    pub verifier: Option<String>,
    // V2: PrivacyRouter.submit_action(...)
    pub action_type: Option<String>,
    pub old_root: Option<String>,
    pub new_root: Option<String>,
    pub nullifiers: Option<Vec<String>>,
    pub commitments: Option<Vec<String>>,
    // V1: ZkPrivacyRouter.submit_private_action(...)
    pub nullifier: Option<String>,
    pub commitment: Option<String>,
    // Shared
    pub proof: Vec<String>,
    pub public_inputs: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct PrivacyActionResponse {
    pub tx_hash: String,
}

#[derive(Debug, Deserialize, Default)]
pub struct AutoPrivacyActionRequest {
    pub verifier: Option<String>,
    pub submit_onchain: Option<bool>,
    #[serde(default)]
    pub tx_context: Option<AutoPrivacyTxContext>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AutoPrivacyTxContext {
    pub flow: Option<String>,
    pub from_token: Option<String>,
    pub to_token: Option<String>,
    pub amount: Option<String>,
    pub recipient: Option<String>,
    pub from_network: Option<String>,
    pub to_network: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AutoPrivacyPayloadResponse {
    pub verifier: String,
    pub nullifier: String,
    pub commitment: String,
    pub proof: Vec<String>,
    pub public_inputs: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct AutoPrivacyActionResponse {
    pub payload: AutoPrivacyPayloadResponse,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx_hash: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PreparePrivateExecutionRequest {
    pub verifier: Option<String>,
    pub flow: String,
    pub action_entrypoint: String,
    pub action_calldata: Vec<String>,
    #[serde(default)]
    pub tx_context: Option<AutoPrivacyTxContext>,
}

#[derive(Debug, Serialize)]
pub struct PreparePrivateExecutionResponse {
    pub payload: AutoPrivacyPayloadResponse,
    pub intent_hash: String,
    pub onchain_calls: Vec<StarknetWalletCall>,
}

#[derive(Clone, Copy)]
enum PrivateExecutionFlow {
    Swap,
    Limit,
    Stake,
}

impl PrivateExecutionFlow {
    fn parse(raw: &str) -> Result<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "swap" => Ok(Self::Swap),
            "limit" | "limit_order" => Ok(Self::Limit),
            "stake" => Ok(Self::Stake),
            _ => Err(AppError::BadRequest(
                "flow must be one of: swap, limit, stake".to_string(),
            )),
        }
    }

    fn preview_entrypoint(self) -> &'static str {
        match self {
            Self::Swap => "preview_swap_intent_hash",
            Self::Limit => "preview_limit_intent_hash",
            Self::Stake => "preview_stake_intent_hash",
        }
    }

    fn execute_entrypoint(self) -> &'static str {
        match self {
            Self::Swap => "execute_private_swap",
            Self::Limit => "execute_private_limit_order",
            Self::Stake => "execute_private_stake",
        }
    }
}

/// POST /api/v1/privacy/submit
pub async fn submit_private_action(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<PrivacyActionRequest>,
) -> Result<Json<ApiResponse<PrivacyActionResponse>>> {
    let user_address = require_user(&headers, &state).await?;
    let tx_hash = submit_private_action_internal(&state, &user_address, &req).await?;

    Ok(Json(ApiResponse::success(PrivacyActionResponse {
        tx_hash: tx_hash.to_string(),
    })))
}

/// POST /api/v1/privacy/auto-submit
pub async fn auto_submit_private_action(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AutoPrivacyActionRequest>,
) -> Result<Json<ApiResponse<AutoPrivacyActionResponse>>> {
    let user_address = require_user(&headers, &state).await?;
    let verifier_kind = parse_privacy_verifier_kind(req.verifier.as_deref())?;
    let payload = generate_auto_garaga_payload(
        &state.config,
        &user_address,
        verifier_kind.as_str(),
        req.tx_context.as_ref(),
    )
    .await?;

    let tx_hash = if req.submit_onchain.unwrap_or(false) {
        let submit_req = PrivacyActionRequest {
            verifier: Some(payload.verifier.clone()),
            action_type: None,
            old_root: None,
            new_root: None,
            nullifiers: None,
            commitments: None,
            nullifier: Some(payload.nullifier.clone()),
            commitment: Some(payload.commitment.clone()),
            proof: payload.proof.clone(),
            public_inputs: payload.public_inputs.clone(),
        };
        Some(submit_private_action_internal(&state, &user_address, &submit_req).await?)
    } else {
        None
    };

    Ok(Json(ApiResponse::success(AutoPrivacyActionResponse {
        payload,
        tx_hash,
    })))
}

/// POST /api/v1/privacy/prepare-private-execution
pub async fn prepare_private_execution(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<PreparePrivateExecutionRequest>,
) -> Result<Json<ApiResponse<PreparePrivateExecutionResponse>>> {
    let user_address = require_user(&headers, &state).await?;
    let verifier_kind = parse_privacy_verifier_kind(req.verifier.as_deref())?;
    let flow = PrivateExecutionFlow::parse(&req.flow)?;
    if req.action_calldata.is_empty() {
        return Err(AppError::BadRequest(
            "action_calldata must be non-empty".to_string(),
        ));
    }

    let executor_address = resolve_private_action_executor_address(&state.config)?;
    let action_selector = parse_selector_or_felt(&req.action_entrypoint)?;

    let intent_hash = compute_intent_hash_on_executor(
        &state,
        &executor_address,
        flow,
        action_selector,
        &req.action_calldata,
    )
    .await?;

    let mut payload = generate_auto_garaga_payload(
        &state.config,
        &user_address,
        verifier_kind.as_str(),
        req.tx_context.as_ref(),
    )
    .await?;
    bind_intent_hash_into_payload(&mut payload, &intent_hash)?;
    ensure_public_inputs_bind_nullifier_commitment(
        &payload.nullifier,
        &payload.commitment,
        &payload.public_inputs,
        "prepared private execution payload",
    )?;

    let onchain_calls = build_private_executor_wallet_calls(
        &executor_address,
        flow,
        action_selector,
        &req.action_calldata,
        &payload,
    )?;

    Ok(Json(ApiResponse::success(
        PreparePrivateExecutionResponse {
            payload,
            intent_hash,
            onchain_calls,
        },
    )))
}

async fn submit_private_action_internal(
    state: &AppState,
    user_address: &str,
    req: &PrivacyActionRequest,
) -> Result<String> {
    let verifier_kind = parse_privacy_verifier_kind(req.verifier.as_deref())?;

    let router_v2 = state
        .config
        .privacy_router_address
        .as_deref()
        .unwrap_or("")
        .trim();
    let router_v1 = state.config.zk_privacy_router_address.trim();
    let has_v2 = !router_v2.is_empty() && !router_v2.starts_with("0x0000");
    let has_v1 = !router_v1.is_empty() && !router_v1.starts_with("0x0000");
    if !has_v2 && !has_v1 {
        return Err(crate::error::AppError::BadRequest(
            "Privacy router not configured".into(),
        ));
    }

    let wants_v2 = req.action_type.is_some()
        || req.old_root.is_some()
        || req.new_root.is_some()
        || req.nullifiers.is_some()
        || req.commitments.is_some();

    let nullifiers_len = req.nullifiers.as_ref().map(|v| v.len()).unwrap_or(0);
    let commitments_len = req.commitments.as_ref().map(|v| v.len()).unwrap_or(0);
    tracing::info!(
        "Privacy submit: user={}, v2={}, v1={}, verifier={}, action_type={:?}, nullifiers={}, commitments={}, proof={}, public_inputs={}",
        user_address,
        has_v2,
        has_v1,
        verifier_kind.as_str(),
        req.action_type,
        nullifiers_len,
        commitments_len,
        req.proof.len(),
        req.public_inputs.len()
    );
    if req.proof.is_empty() || req.public_inputs.is_empty() {
        tracing::warn!(
            "Privacy submit has empty proof/public_inputs for user={}",
            user_address
        );
    }
    if is_dummy_garaga_payload(&req.proof, &req.public_inputs) {
        return Err(crate::error::AppError::BadRequest(
            "privacy.proof/public_inputs dummy payload (0x1) is not allowed; submit a real Garaga proof"
                .into(),
        ));
    }
    if !wants_v2 {
        let nullifier = req
            .nullifier
            .as_deref()
            .ok_or_else(|| crate::error::AppError::BadRequest("Missing nullifier".into()))?;
        let commitment = req
            .commitment
            .as_deref()
            .ok_or_else(|| crate::error::AppError::BadRequest("Missing commitment".into()))?;
        ensure_public_inputs_bind_nullifier_commitment(
            nullifier,
            commitment,
            &req.public_inputs,
            "privacy submit",
        )?;
    }

    let Some(invoker) = OnchainInvoker::from_config(&state.config).ok().flatten() else {
        return Err(crate::error::AppError::BadRequest(
            "On-chain invoker not configured".into(),
        ));
    };

    let call = if wants_v2 {
        if !has_v2 {
            return Err(AppError::BadRequest(
                "Privacy router V2 is not configured".into(),
            ));
        }
        tracing::debug!(
            "Submitting privacy action via V2 router with verifier={}",
            verifier_kind.as_str()
        );
        build_submit_call_v2(router_v2, &req)?
    } else {
        let router_v1 = if has_v1 {
            resolve_privacy_router_for_verifier(&state.config, verifier_kind)?
        } else {
            return Err(AppError::BadRequest(
                "Privacy router V1 is not configured".into(),
            ));
        };
        tracing::debug!(
            "Submitting privacy action via V1 router with verifier={}",
            verifier_kind.as_str()
        );
        build_submit_call_v1(&router_v1, &req)?
    };
    let tx_hash = invoker.invoke(call).await?;
    Ok(tx_hash.to_string())
}

fn is_dummy_garaga_payload(proof: &[String], public_inputs: &[String]) -> bool {
    if proof.len() != 1 || public_inputs.len() != 1 {
        return false;
    }
    proof[0].trim().eq_ignore_ascii_case("0x1")
        && public_inputs[0].trim().eq_ignore_ascii_case("0x1")
}

fn build_submit_call_v2(router: &str, req: &PrivacyActionRequest) -> Result<Call> {
    let to = parse_felt(router)?;
    let selector = get_selector_from_name("submit_action")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;

    let action_type = req
        .action_type
        .as_ref()
        .ok_or_else(|| crate::error::AppError::BadRequest("Missing action_type".into()))?;
    let old_root = req
        .old_root
        .as_ref()
        .ok_or_else(|| crate::error::AppError::BadRequest("Missing old_root".into()))?;
    let new_root = req
        .new_root
        .as_ref()
        .ok_or_else(|| crate::error::AppError::BadRequest("Missing new_root".into()))?;

    let nullifiers = req.nullifiers.clone().unwrap_or_default();
    let commitments = req.commitments.clone().unwrap_or_default();

    let mut calldata = vec![
        parse_action_type(action_type)?,
        parse_felt(old_root)?,
        parse_felt(new_root)?,
    ];

    calldata.push(starknet_core::types::Felt::from(nullifiers.len() as u64));
    for item in &nullifiers {
        calldata.push(parse_felt(item)?);
    }

    calldata.push(starknet_core::types::Felt::from(commitments.len() as u64));
    for item in &commitments {
        calldata.push(parse_felt(item)?);
    }

    calldata.push(starknet_core::types::Felt::from(
        req.public_inputs.len() as u64
    ));
    for item in &req.public_inputs {
        calldata.push(parse_felt(item)?);
    }

    calldata.push(starknet_core::types::Felt::from(req.proof.len() as u64));
    for item in &req.proof {
        calldata.push(parse_felt(item)?);
    }

    Ok(Call {
        to,
        selector,
        calldata,
    })
}

fn build_submit_call_v1(router: &str, req: &PrivacyActionRequest) -> Result<Call> {
    let to = parse_felt(router)?;
    let selector = get_selector_from_name("submit_private_action")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;

    let nullifier = req
        .nullifier
        .as_ref()
        .ok_or_else(|| crate::error::AppError::BadRequest("Missing nullifier".into()))?;
    let commitment = req
        .commitment
        .as_ref()
        .ok_or_else(|| crate::error::AppError::BadRequest("Missing commitment".into()))?;

    let mut calldata = vec![parse_felt(nullifier)?, parse_felt(commitment)?];

    calldata.push(starknet_core::types::Felt::from(req.proof.len() as u64));
    for item in &req.proof {
        calldata.push(parse_felt(item)?);
    }

    calldata.push(starknet_core::types::Felt::from(
        req.public_inputs.len() as u64
    ));
    for item in &req.public_inputs {
        calldata.push(parse_felt(item)?);
    }

    Ok(Call {
        to,
        selector,
        calldata,
    })
}

fn parse_action_type(value: &str) -> Result<starknet_core::types::Felt> {
    if value.starts_with("0x") || value.chars().all(|c| c.is_ascii_digit()) {
        return parse_felt(value);
    }
    let hex = hex::encode(value.as_bytes());
    parse_felt(&format!("0x{hex}"))
}

pub(crate) async fn generate_auto_garaga_payload(
    config: &crate::config::Config,
    user_address: &str,
    verifier: &str,
    tx_context: Option<&AutoPrivacyTxContext>,
) -> Result<AutoPrivacyPayloadResponse> {
    let cmd = config
        .privacy_auto_garaga_prover_cmd
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::BadRequest(
                "Auto Garaga payload requires PRIVACY_AUTO_GARAGA_PROVER_CMD (real per-request prover)"
                    .to_string(),
            )
        })?;

    load_auto_garaga_payload_from_prover_cmd(
        cmd,
        config.privacy_auto_garaga_prover_timeout_ms,
        user_address,
        verifier,
        tx_context,
    )
    .await
}

async fn load_auto_garaga_payload_from_prover_cmd(
    cmd: &str,
    timeout_ms: u64,
    user_address: &str,
    verifier: &str,
    tx_context: Option<&AutoPrivacyTxContext>,
) -> Result<AutoPrivacyPayloadResponse> {
    let timeout_ms = if timeout_ms == 0 { 45_000 } else { timeout_ms };
    let stdin_payload = serde_json::json!({
        "user_address": user_address,
        "verifier": verifier,
        "requested_at_unix": chrono::Utc::now().timestamp(),
        "tx_context": tx_context,
    });

    let mut child = Command::new("sh")
        .arg("-lc")
        .arg(cmd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            AppError::BadRequest(format!(
                "Failed to start auto Garaga prover command '{}': {}",
                cmd, error
            ))
        })?;

    if let Some(mut stdin) = child.stdin.take() {
        let payload = stdin_payload.to_string();
        stdin.write_all(payload.as_bytes()).await.map_err(|error| {
            AppError::BadRequest(format!(
                "Failed to send stdin payload to auto Garaga prover command: {}",
                error
            ))
        })?;
    }

    let output = tokio::time::timeout(Duration::from_millis(timeout_ms), child.wait_with_output())
        .await
        .map_err(|_| {
            AppError::BadRequest(format!(
                "Auto Garaga prover command timeout after {} ms",
                timeout_ms
            ))
        })?
        .map_err(|error| {
            AppError::BadRequest(format!(
                "Failed waiting auto Garaga prover command result: {}",
                error
            ))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let reason = if stderr.is_empty() {
            format!("exit status {}", output.status)
        } else {
            stderr
        };
        return Err(AppError::BadRequest(format!(
            "Auto Garaga prover command failed: {}",
            reason
        )));
    }

    let stdout = String::from_utf8(output.stdout).map_err(|error| {
        AppError::BadRequest(format!(
            "Auto Garaga prover command returned non-utf8 stdout: {}",
            error
        ))
    })?;
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest(
            "Auto Garaga prover command returned empty stdout".to_string(),
        ));
    }

    let raw: Value = serde_json::from_str(trimmed).map_err(|error| {
        AppError::BadRequest(format!(
            "Auto Garaga prover command returned invalid JSON: {}",
            error
        ))
    })?;

    let nullifier = raw
        .get("nullifier")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::BadRequest(
                "Auto Garaga prover response must contain non-empty 'nullifier'".to_string(),
            )
        })?
        .to_string();
    let commitment = raw
        .get("commitment")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::BadRequest(
                "Auto Garaga prover response must contain non-empty 'commitment'".to_string(),
            )
        })?
        .to_string();

    let proof = extract_hex_array(&raw, &["proof", "full_proof_with_hints"], "proof")?;
    let public_inputs = extract_hex_array(&raw, &["public_inputs"], "public_inputs")?;
    if proof.is_empty() || public_inputs.is_empty() {
        return Err(AppError::BadRequest(
            "Auto Garaga prover response has empty proof/public_inputs".to_string(),
        ));
    }
    if is_dummy_garaga_payload(&proof, &public_inputs) {
        return Err(AppError::BadRequest(
            "Auto Garaga prover response is still dummy (0x1). Provide real proof/public inputs."
                .to_string(),
        ));
    }
    ensure_public_inputs_bind_nullifier_commitment(
        &nullifier,
        &commitment,
        &public_inputs,
        "auto Garaga prover response",
    )?;

    Ok(AutoPrivacyPayloadResponse {
        verifier: verifier.to_string(),
        nullifier,
        commitment,
        proof,
        public_inputs,
    })
}

fn extract_hex_array(value: &Value, keys: &[&str], field_label: &str) -> Result<Vec<String>> {
    if let Some(array) = value.as_array() {
        return parse_hex_array(array, field_label);
    }
    if let Some(raw) = value.as_str() {
        return parse_hex_string(raw, field_label);
    }

    if let Some(object) = value.as_object() {
        for key in keys {
            if let Some(raw_value) = object.get(*key) {
                if let Some(array) = raw_value.as_array() {
                    return parse_hex_array(array, field_label);
                }
                if let Some(raw_string) = raw_value.as_str() {
                    return parse_hex_string(raw_string, field_label);
                }
                return Err(AppError::BadRequest(format!(
                    "Auto Garaga '{}' must be an array of felt strings",
                    field_label
                )));
            }
        }
    }

    Err(AppError::BadRequest(format!(
        "Auto Garaga '{}' is missing in configured file",
        field_label
    )))
}

pub(crate) fn ensure_public_inputs_bind_nullifier_commitment(
    nullifier: &str,
    commitment: &str,
    public_inputs: &[String],
    source_label: &str,
) -> Result<()> {
    let nullifier_index = privacy_binding_index("GARAGA_NULLIFIER_PUBLIC_INPUT_INDEX", 0)?;
    let commitment_index = privacy_binding_index("GARAGA_COMMITMENT_PUBLIC_INPUT_INDEX", 1)?;
    let required_len = std::cmp::max(nullifier_index, commitment_index) + 1;

    if public_inputs.len() < required_len {
        return Err(AppError::BadRequest(format!(
            "{} must expose nullifier/commitment in public_inputs indexes [{}, {}], but public_inputs length is {}",
            source_label,
            nullifier_index,
            commitment_index,
            public_inputs.len()
        )));
    }

    let expected_nullifier = parse_felt(nullifier)?;
    let expected_commitment = parse_felt(commitment)?;
    let bound_nullifier = parse_felt(public_inputs[nullifier_index].trim())?;
    let bound_commitment = parse_felt(public_inputs[commitment_index].trim())?;

    if bound_nullifier != expected_nullifier || bound_commitment != expected_commitment {
        return Err(AppError::BadRequest(format!(
            "{} public_inputs binding mismatch: expected public_inputs[{}]==nullifier and public_inputs[{}]==commitment",
            source_label,
            nullifier_index,
            commitment_index
        )));
    }
    Ok(())
}

fn intent_hash_public_input_index() -> Result<usize> {
    let raw =
        std::env::var("GARAGA_INTENT_HASH_PUBLIC_INPUT_INDEX").unwrap_or_else(|_| "2".to_string());
    let parsed = raw.trim().parse::<usize>().map_err(|_| {
        AppError::BadRequest(format!(
            "GARAGA_INTENT_HASH_PUBLIC_INPUT_INDEX must be a non-negative integer, got '{}'",
            raw
        ))
    })?;
    Ok(parsed)
}

pub(crate) fn bind_intent_hash_into_payload(
    payload: &mut AutoPrivacyPayloadResponse,
    intent_hash: &str,
) -> Result<()> {
    let intent_hash_felt = parse_felt(intent_hash)?;
    let index = intent_hash_public_input_index()?;
    while payload.public_inputs.len() <= index {
        payload.public_inputs.push("0x0".to_string());
    }
    payload.public_inputs[index] = intent_hash_felt.to_string();
    Ok(())
}

fn parse_selector_or_felt(value: &str) -> Result<Felt> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest(
            "action_entrypoint must be non-empty".to_string(),
        ));
    }
    if trimmed.starts_with("0x") || trimmed.chars().all(|c| c.is_ascii_digit()) {
        return parse_felt(trimmed);
    }
    get_selector_from_name(trimmed)
        .map_err(|e| AppError::Internal(format!("Selector error for '{}': {}", trimmed, e)))
}

fn resolve_private_action_executor_address(config: &crate::config::Config) -> Result<String> {
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
        let _ = parse_felt(trimmed)?;
        return Ok(trimmed.to_string());
    }

    Err(AppError::BadRequest(
        "PrivateActionExecutor is not configured. Set PRIVATE_ACTION_EXECUTOR_ADDRESS.".to_string(),
    ))
}

async fn compute_intent_hash_on_executor(
    state: &AppState,
    executor_address: &str,
    flow: PrivateExecutionFlow,
    action_selector: Felt,
    action_calldata: &[String],
) -> Result<String> {
    let reader = crate::services::onchain::OnchainReader::from_config(&state.config)?;
    let contract_address = parse_felt(executor_address)?;
    let preview_selector = get_selector_from_name(flow.preview_entrypoint())
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;

    let mut calldata: Vec<Felt> = Vec::with_capacity(2 + action_calldata.len());
    calldata.push(action_selector);
    calldata.push(Felt::from(action_calldata.len() as u64));
    for felt in action_calldata {
        calldata.push(parse_felt(felt)?);
    }

    let out = reader
        .call(FunctionCall {
            contract_address,
            entry_point_selector: preview_selector,
            calldata,
        })
        .await?;
    let intent_hash = out.first().ok_or_else(|| {
        AppError::BadRequest("PrivateActionExecutor preview returned empty response".to_string())
    })?;
    Ok(intent_hash.to_string())
}

fn build_private_executor_wallet_calls(
    executor_address: &str,
    flow: PrivateExecutionFlow,
    action_selector: Felt,
    action_calldata: &[String],
    payload: &AutoPrivacyPayloadResponse,
) -> Result<Vec<StarknetWalletCall>> {
    let mut submit_calldata: Vec<String> =
        Vec::with_capacity(4 + payload.proof.len() + payload.public_inputs.len());
    submit_calldata.push(payload.nullifier.clone());
    submit_calldata.push(payload.commitment.clone());
    submit_calldata.push(format!("0x{:x}", payload.proof.len()));
    submit_calldata.extend(payload.proof.iter().cloned());
    submit_calldata.push(format!("0x{:x}", payload.public_inputs.len()));
    submit_calldata.extend(payload.public_inputs.iter().cloned());

    let mut execute_calldata: Vec<String> = Vec::with_capacity(3 + action_calldata.len());
    execute_calldata.push(payload.commitment.clone());
    execute_calldata.push(action_selector.to_string());
    execute_calldata.push(format!("0x{:x}", action_calldata.len()));
    execute_calldata.extend(action_calldata.iter().cloned());

    Ok(vec![
        StarknetWalletCall {
            contract_address: executor_address.to_string(),
            entrypoint: "submit_private_intent".to_string(),
            calldata: submit_calldata,
        },
        StarknetWalletCall {
            contract_address: executor_address.to_string(),
            entrypoint: flow.execute_entrypoint().to_string(),
            calldata: execute_calldata,
        },
    ])
}

fn privacy_binding_index(env_key: &str, default_value: usize) -> Result<usize> {
    let raw = std::env::var(env_key).unwrap_or_else(|_| default_value.to_string());
    let parsed = raw.trim().parse::<usize>().map_err(|_| {
        AppError::BadRequest(format!(
            "{} must be a non-negative integer, got '{}'",
            env_key, raw
        ))
    })?;
    Ok(parsed)
}

fn parse_hex_string(raw: &str, field_label: &str) -> Result<Vec<String>> {
    let values: Vec<String> = raw
        .split(|c| c == ',' || c == '\n')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .collect();
    if values.is_empty() {
        return Err(AppError::BadRequest(format!(
            "Auto Garaga '{}' is empty",
            field_label
        )));
    }
    Ok(values)
}

fn parse_hex_array(array: &[Value], field_label: &str) -> Result<Vec<String>> {
    let mut values = Vec::with_capacity(array.len());
    for item in array {
        let normalized = match item {
            Value::String(value) => value.trim().to_string(),
            Value::Number(value) => value.to_string(),
            _ => {
                return Err(AppError::BadRequest(format!(
                    "Auto Garaga '{}' contains a non-string felt value",
                    field_label
                )));
            }
        };
        if normalized.is_empty() {
            continue;
        }
        values.push(normalized);
    }
    if values.is_empty() {
        return Err(AppError::BadRequest(format!(
            "Auto Garaga '{}' is empty",
            field_label
        )));
    }
    Ok(values)
}
