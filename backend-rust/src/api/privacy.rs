use crate::{
    error::{AppError, Result},
    models::{ApiResponse, StarknetWalletCall},
    services::{
        onchain::parse_felt,
        relayer::RelayerService,
    },
    services::privacy_verifier::{
        parse_privacy_verifier_kind, resolve_privacy_router_for_verifier,
    },
};
use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use starknet_core::types::{Call, Felt, FunctionCall};
use starknet_core::utils::get_selector_from_name;
use starknet_crypto::poseidon_hash_many;
use std::{process::Stdio, time::Duration};
use tokio::{io::AsyncWriteExt, process::Command};

use super::{require_starknet_user, require_user, AppState};

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
    pub token: Option<String>,
    pub amount_low: Option<String>,
    pub amount_high: Option<String>,
    pub signature_selector: Option<String>,
    pub nonce: Option<String>,
    pub deadline: Option<u64>,
    #[serde(default)]
    pub tx_context: Option<AutoPrivacyTxContext>,
}

#[derive(Debug, Serialize)]
pub struct PreparePrivateExecutionRelayerDraft {
    pub user: String,
    pub token: String,
    pub amount_low: String,
    pub amount_high: String,
    pub signature_selector: String,
    pub submit_selector: String,
    pub execute_selector: String,
    pub nullifier: String,
    pub commitment: String,
    pub action_selector: String,
    pub nonce: String,
    pub deadline: u64,
    pub proof: Vec<String>,
    pub public_inputs: Vec<String>,
    pub action_calldata: Vec<String>,
    pub message_hash: String,
}

#[derive(Debug, Serialize)]
pub struct PreparePrivateExecutionResponse {
    pub payload: AutoPrivacyPayloadResponse,
    pub intent_hash: String,
    pub onchain_calls: Vec<StarknetWalletCall>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relayer: Option<PreparePrivateExecutionRelayerDraft>,
}

#[derive(Debug, Deserialize)]
pub struct RelayerPrivateExecutionRequest {
    pub user: String,
    pub token: String,
    pub amount_low: String,
    pub amount_high: String,
    pub signature: Vec<String>,
    pub signature_selector: String,
    pub submit_selector: String,
    pub execute_selector: String,
    pub nullifier: String,
    pub commitment: String,
    pub action_selector: String,
    pub nonce: String,
    pub deadline: u64,
    pub proof: Vec<String>,
    pub public_inputs: Vec<String>,
    pub action_calldata: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct RelayerPrivateExecutionResponse {
    pub tx_hash: String,
}

#[derive(Clone, Copy)]
enum PrivateExecutionFlow {
    Swap,
    Limit,
    Stake,
}

impl PrivateExecutionFlow {
    // Parses user-provided flow labels into the internal flow enum used by the executor path.
    // This keeps API input validation centralized for Hide Mode request handling.
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

    // Resolves the preview entrypoint name used to compute intent_hash off-chain before submission.
    fn preview_entrypoint(self) -> &'static str {
        match self {
            Self::Swap => "preview_swap_intent_hash",
            Self::Limit => "preview_limit_intent_hash",
            Self::Stake => "preview_stake_intent_hash",
        }
    }

    // Resolves the executor entrypoint used for the final private execution call.
    fn execute_entrypoint(self) -> &'static str {
        match self {
            Self::Swap => "execute_private_swap",
            Self::Limit => "execute_private_limit_order",
            Self::Stake => "execute_private_stake",
        }
    }
}

/// Submits a Hide Mode privacy action through the configured router.
///
/// # Arguments
/// * `state` - Shared application state containing config, DB, and relayer dependencies.
/// * `headers` - Request headers used to authenticate and resolve the caller address.
/// * `req` - Privacy payload that includes verifier choice and Garaga proof fields.
///
/// # Returns
/// * `Ok(Json<ApiResponse<PrivacyActionResponse>>)` - API success payload containing on-chain tx hash.
/// * `Err(AppError)` - Validation/auth/on-chain failures during private action submission.
///
/// # Notes
/// - Hide Mode routes through relayer execution instead of direct wallet execution.
/// - For V1 flow, `public_inputs[0]` must bind to nullifier and `public_inputs[1]` to commitment.
/// - Dummy payloads (`0x1`) are explicitly rejected to avoid mock proof usage.
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

/// Generates Garaga payload automatically and optionally submits it on-chain.
///
/// # Arguments
/// * `state` - Shared application state with privacy wiring and prover configuration.
/// * `headers` - Auth headers used to identify the requesting user.
/// * `req` - Auto-submit options (`verifier`, `submit_onchain`, and optional tx context).
///
/// # Returns
/// * `Ok(Json<ApiResponse<AutoPrivacyActionResponse>>)` - Generated payload and optional tx hash.
/// * `Err(AppError)` - Returned when auth fails, prover command fails, or submission fails.
///
/// # Notes
/// - This endpoint is the primary relayer entrypoint used by one-click Hide Mode in the frontend.
/// - If `submit_onchain=false`, only payload generation is performed and no chain write occurs.
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

/// Prepares executor calldata for private execution with intent-hash binding.
///
/// # Arguments
/// * `state` - Shared app state used to resolve executor and on-chain reader.
/// * `headers` - Auth headers used to resolve the submitting wallet identity.
/// * `req` - Flow, target entrypoint, calldata, verifier choice, and optional tx context.
///
/// # Returns
/// * `Ok(Json<ApiResponse<PreparePrivateExecutionResponse>>)` - Bound payload, intent_hash, and wallet calls.
/// * `Err(AppError)` - Validation, resolver, or on-chain preview failures.
///
/// # Notes
/// - Binds `intent_hash` into `public_inputs` before creating executor calls.
/// - Ensures nullifier/commitment binding remains valid after payload mutation.
/// - Used by Hide Mode flows (`swap`, `limit`, `stake`) that execute via private executor.
pub async fn prepare_private_execution(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<PreparePrivateExecutionRequest>,
) -> Result<Json<ApiResponse<PreparePrivateExecutionResponse>>> {
    let user_address = require_starknet_user(&headers, &state).await?;
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

    let relayer = match (
        req.token.as_deref(),
        req.amount_low.as_deref(),
        req.amount_high.as_deref(),
    ) {
        (Some(token), Some(amount_low), Some(amount_high)) => Some(
            build_relayer_private_execution_draft(
                &state,
                &user_address,
                token,
                amount_low,
                amount_high,
                req.signature_selector.as_deref(),
                req.nonce.as_deref(),
                req.deadline,
                flow,
                action_selector,
                &req.action_calldata,
                &payload,
            )?,
        ),
        _ => None,
    };

    Ok(Json(ApiResponse::success(
        PreparePrivateExecutionResponse {
            payload,
            intent_hash,
            onchain_calls,
            relayer,
        },
    )))
}

pub async fn relay_private_execution(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<RelayerPrivateExecutionRequest>,
) -> Result<Json<ApiResponse<RelayerPrivateExecutionResponse>>> {
    let signed_user = require_starknet_user(&headers, &state).await?;
    let signed_user_felt = parse_felt(&signed_user)?;
    let req_user_felt = parse_felt(&req.user)?;
    if signed_user_felt != req_user_felt {
        return Err(AppError::BadRequest(
            "signed params user does not match authenticated Starknet wallet".to_string(),
        ));
    }

    if req.signature.is_empty() || req.proof.is_empty() || req.public_inputs.is_empty() {
        return Err(AppError::BadRequest(
            "signature/proof/public_inputs must be non-empty".to_string(),
        ));
    }

    let intermediary_address = std::env::var("PRIVACY_INTERMEDIARY_ADDRESS")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::BadRequest(
                "PRIVACY_INTERMEDIARY_ADDRESS is not configured for relayer execution".to_string(),
            )
        })?;

    let to = parse_felt(&intermediary_address)?;
    let selector = get_selector_from_name("execute")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;

    let mut calldata = vec![
        parse_felt(&req.user)?,
        parse_felt(&req.token)?,
        parse_felt(&req.amount_low)?,
        parse_felt(&req.amount_high)?,
    ];

    calldata.push(Felt::from(req.signature.len() as u64));
    for value in &req.signature {
        calldata.push(parse_felt(value)?);
    }

    calldata.push(parse_felt(&req.signature_selector)?);
    calldata.push(parse_felt(&req.submit_selector)?);
    calldata.push(parse_felt(&req.execute_selector)?);
    calldata.push(parse_felt(&req.nullifier)?);
    calldata.push(parse_felt(&req.commitment)?);
    calldata.push(parse_felt(&req.action_selector)?);
    calldata.push(parse_felt(&req.nonce)?);
    calldata.push(Felt::from(req.deadline));

    calldata.push(Felt::from(req.proof.len() as u64));
    for value in &req.proof {
        calldata.push(parse_felt(value)?);
    }

    calldata.push(Felt::from(req.public_inputs.len() as u64));
    for value in &req.public_inputs {
        calldata.push(parse_felt(value)?);
    }

    calldata.push(Felt::from(req.action_calldata.len() as u64));
    for value in &req.action_calldata {
        calldata.push(parse_felt(value)?);
    }

    let relayer = RelayerService::from_config(&state.config)?;
    let submitted = relayer.submit_call(Call {
        to,
        selector,
        calldata,
    })
    .await?;

    Ok(Json(ApiResponse::success(RelayerPrivateExecutionResponse {
        tx_hash: submitted.tx_hash,
    })))
}

// Routes privacy submissions to V1 (`submit_private_action`) or V2 (`submit_action`) based on payload shape.
// Enforces payload integrity (including nullifier/commitment binding) before relayer execution.
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

    let relayer = RelayerService::from_config(&state.config)?;

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
        build_submit_call_v2(router_v2, req)?
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
        build_submit_call_v1(&router_v1, req)?
    };
    let submitted = relayer.submit_call(call).await?;
    Ok(submitted.tx_hash)
}

// Detects mock placeholder payloads (`proof=[0x1]`, `public_inputs=[0x1]`) and rejects them in real Hide Mode.
fn is_dummy_garaga_payload(proof: &[String], public_inputs: &[String]) -> bool {
    if proof.len() != 1 || public_inputs.len() != 1 {
        return false;
    }
    proof[0].trim().eq_ignore_ascii_case("0x1")
        && public_inputs[0].trim().eq_ignore_ascii_case("0x1")
}

// Encodes V2 router calldata including root transition metadata plus nullifier/commitment arrays and proof data.
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

// Encodes legacy V1 calldata for `submit_private_action` with a single nullifier/commitment pair.
// Preserves V1 compatibility while still relying on upstream binding checks in `public_inputs`.
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

// Normalizes action type input into felt values expected by the V2 privacy router.
// Accepts literal felts (`0x...` or decimal) and plain ASCII labels.
fn parse_action_type(value: &str) -> Result<starknet_core::types::Felt> {
    if value.starts_with("0x") || value.chars().all(|c| c.is_ascii_digit()) {
        return parse_felt(value);
    }
    let hex = hex::encode(value.as_bytes());
    parse_felt(&format!("0x{hex}"))
}

/// Generates a Garaga payload for Hide Mode using the configured prover command.
///
/// # Arguments
/// * `config` - Runtime configuration used to resolve prover command and timeout.
/// * `user_address` - Wallet address used as contextual input for payload generation.
/// * `verifier` - Selected verifier label (`garaga`, `tongo`, `semaphore`, etc.).
/// * `tx_context` - Optional action metadata to bind intent-specific payload generation.
///
/// # Returns
/// * `Ok(AutoPrivacyPayloadResponse)` - Parsed and validated payload ready for submission.
/// * `Err(AppError)` - Missing prover config, invalid response, or binding mismatch.
///
/// # Notes
/// - Requires `PRIVACY_AUTO_GARAGA_PROVER_CMD` to be configured.
/// - Returned payload is validated against nullifier/commitment public input binding.
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

// Executes the external prover command and parses the returned proof/public_inputs payload.
// Applies strict timeout/error handling and validates nullifier/commitment field presence.
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

// Reads felt arrays from prover JSON output using fallback keys and normalizes supported representations.
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

/// Verifies that `public_inputs` bind the submitted `nullifier` and `commitment`.
///
/// # Arguments
/// * `nullifier` - Expected single-use hash for replay protection.
/// * `commitment` - Expected commitment hash associated with the private intent.
/// * `public_inputs` - Public inputs array returned by prover payload.
/// * `source_label` - Human-readable source label used in validation errors.
///
/// # Returns
/// * `Ok(())` - Binding is valid for configured indices.
/// * `Err(AppError)` - Binding is missing, index out-of-range, or values mismatch.
///
/// # Notes
/// - Index positions come from `GARAGA_NULLIFIER_PUBLIC_INPUT_INDEX` and `GARAGA_COMMITMENT_PUBLIC_INPUT_INDEX`.
/// - This check is mandatory before relayer submits Hide Mode actions on-chain.
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

// Reads and validates the configured public input index reserved for intent-hash binding.
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

/// Binds executor `intent_hash` into the configured public input slot.
///
/// # Arguments
/// * `payload` - Mutable Garaga payload that will be executed by the private executor.
/// * `intent_hash` - Felt-encoded hash previewed from the executor contract.
///
/// # Returns
/// * `Ok(())` - Payload updated successfully.
/// * `Err(AppError)` - Invalid felt value or index configuration.
///
/// # Notes
/// - Pads `public_inputs` with `0x0` when the configured index exceeds current length.
/// - Used to couple off-chain generated proof payload with on-chain private execution intent.
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

// Parses executor entrypoint input as either a felt selector or a selector name string.
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

// Resolves the active private executor address (PrivateActionExecutor / ShieldedPoolV2) from env/config fallbacks.
// Verifies that the resolved value is a valid felt address before building on-chain calls.
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

// Calls the executor preview entrypoint to compute the intent hash bound into Garaga public inputs.
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

// Builds a two-call wallet batch: first `submit_private_intent`, then the flow-specific `execute_private_*`.
// Carries forward commitment-bound calldata so execution matches the proven intent.
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

// Builds relayer draft payload (including message hash) so frontend can sign and submit via
// `/api/v1/privacy/relayer-execute`.
fn build_relayer_private_execution_draft(
    state: &AppState,
    user_address: &str,
    token: &str,
    amount_low: &str,
    amount_high: &str,
    signature_selector_raw: Option<&str>,
    nonce_raw: Option<&str>,
    deadline_raw: Option<u64>,
    flow: PrivateExecutionFlow,
    action_selector: Felt,
    action_calldata: &[String],
    payload: &AutoPrivacyPayloadResponse,
) -> Result<PreparePrivateExecutionRelayerDraft> {
    let executor = resolve_private_action_executor_address(&state.config)?;
    let executor_felt = parse_felt(&executor)?;
    let user_felt = parse_felt(user_address)?;
    let token_felt = parse_felt(token)?;
    let amount_low_felt = parse_felt(amount_low)?;
    let amount_high_felt = parse_felt(amount_high)?;

    let signature_selector = if let Some(raw) = signature_selector_raw {
        parse_selector_or_felt(raw)?
    } else {
        get_selector_from_name("is_valid_signature")
            .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?
    };
    let submit_selector = get_selector_from_name("submit_private_intent")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let execute_selector = get_selector_from_name(flow.execute_entrypoint())
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let nullifier = parse_felt(&payload.nullifier)?;
    let commitment = parse_felt(&payload.commitment)?;
    let nonce = if let Some(raw) = nonce_raw {
        parse_felt(raw)?
    } else {
        Felt::from(chrono::Utc::now().timestamp_millis() as u64)
    };
    let deadline = deadline_raw.unwrap_or_else(|| (chrono::Utc::now().timestamp() as u64) + 1200);
    let deadline_felt = Felt::from(deadline);

    let proof_felts: Vec<Felt> = payload
        .proof
        .iter()
        .map(|value| parse_felt(value))
        .collect::<Result<Vec<_>>>()?;
    let public_inputs_felts: Vec<Felt> = payload
        .public_inputs
        .iter()
        .map(|value| parse_felt(value))
        .collect::<Result<Vec<_>>>()?;
    let action_calldata_felts: Vec<Felt> = action_calldata
        .iter()
        .map(|value| parse_felt(value))
        .collect::<Result<Vec<_>>>()?;

    let proof_hash = parse_felt(&format!("{:#x}", poseidon_hash_many(&proof_felts)))?;
    let public_inputs_hash =
        parse_felt(&format!("{:#x}", poseidon_hash_many(&public_inputs_felts)))?;
    let action_calldata_hash =
        parse_felt(&format!("{:#x}", poseidon_hash_many(&action_calldata_felts)))?;

    let message_hash = parse_felt(&format!(
        "{:#x}",
        poseidon_hash_many(&[
            user_felt,
            token_felt,
            amount_low_felt,
            amount_high_felt,
            executor_felt,
            submit_selector,
            execute_selector,
            nullifier,
            commitment,
            action_selector,
            nonce,
            deadline_felt,
            proof_hash,
            public_inputs_hash,
            action_calldata_hash,
        ])
    ))?;

    Ok(PreparePrivateExecutionRelayerDraft {
        user: user_felt.to_string(),
        token: token_felt.to_string(),
        amount_low: amount_low_felt.to_string(),
        amount_high: amount_high_felt.to_string(),
        signature_selector: signature_selector.to_string(),
        submit_selector: submit_selector.to_string(),
        execute_selector: execute_selector.to_string(),
        nullifier: nullifier.to_string(),
        commitment: commitment.to_string(),
        action_selector: action_selector.to_string(),
        nonce: nonce.to_string(),
        deadline,
        proof: payload.proof.clone(),
        public_inputs: payload.public_inputs.clone(),
        action_calldata: action_calldata.to_vec(),
        message_hash: message_hash.to_string(),
    })
}

// Reads numeric binding indexes from env and validates they are usable for payload integrity checks.
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

// Parses textual felt lists (comma/newline-delimited) from prover outputs.
fn parse_hex_string(raw: &str, field_label: &str) -> Result<Vec<String>> {
    let values: Vec<String> = raw
        .split([',', '\n'])
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

// Parses JSON felt arrays from prover outputs and normalizes each entry into string form.
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
