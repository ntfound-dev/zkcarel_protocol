use crate::indexer::starknet_client::StarknetClient;
use crate::{
    config::Config,
    error::{AppError, Result},
    models::{ApiResponse, StarknetWalletCall},
    services::privacy_verifier::{
        parse_privacy_verifier_kind, resolve_privacy_router_for_verifier, verify_proof,
    },
    services::{
        filecoin::FilecoinService,
        onchain::{parse_chain_id, parse_felt},
        relayer::RelayerService,
    },
};
use axum::{extract::State, http::HeaderMap, Json};
use num_bigint::BigUint;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use starknet_core::types::{Call, Felt, FunctionCall};
use starknet_core::utils::{get_selector_from_name, get_storage_var_address};
use starknet_crypto::poseidon_hash_many;
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{io::AsyncWriteExt, process::Command};

use super::{
    require_starknet_user, require_user,
    swap::{
        hide_balance_note_index_wait_attempts, hide_balance_note_index_wait_delay_ms,
        payload_from_request, PrivacyVerificationPayload,
    },
    AppState,
};

fn env_non_empty(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn is_production_environment(config: &Config) -> bool {
    matches!(
        config.environment.trim().to_ascii_lowercase().as_str(),
        "production" | "prod" | "mainnet"
    )
}

fn allow_nonproduction_proof_shortcuts() -> bool {
    matches!(
        env_non_empty("GARAGA_ENABLE_NONPROD_PROOF_SHORTCUTS")
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "yes" | "on"
    )
}

struct StaticHonkArtifacts {
    proof_path: String,
    public_inputs_path: String,
    honk_vk_env_key: Option<&'static str>,
    honk_vk_path: Option<String>,
}

struct PrebuiltHonkWitnessFallback {
    circuit: &'static str,
    honk_vk_env_key: &'static str,
    honk_vk_path: String,
}

fn resolve_prebuilt_honk_witness_fallback(
    config: &Config,
    tx_context: Option<&AutoPrivacyTxContext>,
) -> Option<PrebuiltHonkWitnessFallback> {
    if is_production_environment(config)
        || env_non_empty("GARAGA_NOIR_PROVER_URL").is_some()
        || !allow_nonproduction_proof_shortcuts()
    {
        return None;
    }

    let flow = tx_context
        .and_then(|context| context.flow.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_ascii_lowercase();
    let (circuit, honk_vk_env_key) = match flow.as_str() {
        "swap" | "bridge" => ("carel_swap", "GARAGA_HONK_VK_PATH_SWAP"),
        "limit" | "limit_order" | "limit-order" => ("carel_limit", "GARAGA_HONK_VK_PATH_LIMIT"),
        "stake" => ("carel_stake", "GARAGA_HONK_VK_PATH_STAKE"),
        "btc" | "shadow_btc" | "shadow-btc" => ("shadow_btc", "GARAGA_HONK_VK_PATH_BTC"),
        _ => return None,
    };

    for base in [
        "../smartcontract/starknet/garaga/circuits",
        "smartcontract/starknet/garaga/circuits",
    ] {
        let witness = PathBuf::from(format!("{base}/{circuit}/target/{circuit}.gz"));
        let bytecode = PathBuf::from(format!("{base}/{circuit}/target/{circuit}.json"));
        let vk = PathBuf::from(format!("{base}/{circuit}/target/vk/vk"));
        if witness.is_file() && bytecode.is_file() && vk.is_file() {
            return Some(PrebuiltHonkWitnessFallback {
                circuit,
                honk_vk_env_key,
                honk_vk_path: vk.to_string_lossy().to_string(),
            });
        }
    }

    None
}

fn resolve_static_honk_artifact_paths(
    config: &Config,
    tx_context: Option<&AutoPrivacyTxContext>,
) -> Option<StaticHonkArtifacts> {
    if is_production_environment(config)
        || env_non_empty("GARAGA_NOIR_PROVER_URL").is_some()
        || !allow_nonproduction_proof_shortcuts()
    {
        return None;
    }

    let configured_proof = config
        .privacy_auto_garaga_proof_file
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let configured_public_inputs = config
        .privacy_auto_garaga_public_inputs_file
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let (Some(proof), Some(public_inputs)) = (configured_proof, configured_public_inputs) {
        return Some(StaticHonkArtifacts {
            proof_path: proof.to_string(),
            public_inputs_path: public_inputs.to_string(),
            honk_vk_env_key: None,
            honk_vk_path: None,
        });
    }

    let flow = tx_context
        .and_then(|context| context.flow.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_ascii_lowercase();
    let (circuit, honk_vk_env_key) = match flow.as_str() {
        "swap" | "bridge" => ("carel_swap", "GARAGA_HONK_VK_PATH_SWAP"),
        "limit" | "limit_order" | "limit-order" => ("carel_limit", "GARAGA_HONK_VK_PATH_LIMIT"),
        "stake" => ("carel_stake", "GARAGA_HONK_VK_PATH_STAKE"),
        "btc" | "shadow_btc" | "shadow-btc" => ("shadow_btc", "GARAGA_HONK_VK_PATH_BTC"),
        _ => return None,
    };

    for base in [
        "../smartcontract/starknet/garaga/artifacts",
        "smartcontract/starknet/garaga/artifacts",
    ] {
        let proof = PathBuf::from(format!("{base}/{circuit}/proof/proof"));
        let public_inputs = PathBuf::from(format!("{base}/{circuit}/proof/public_inputs"));
        let vk = PathBuf::from(format!("{base}/{circuit}/proof/vk"));
        if proof.is_file() && public_inputs.is_file() && vk.is_file() {
            return Some(StaticHonkArtifacts {
                proof_path: proof.to_string_lossy().to_string(),
                public_inputs_path: public_inputs.to_string_lossy().to_string(),
                honk_vk_env_key: Some(honk_vk_env_key),
                honk_vk_path: Some(vk.to_string_lossy().to_string()),
            });
        }
    }

    None
}

fn parse_rpc_url_list(raw: &str) -> Vec<String> {
    raw.split([',', ';', '\n', '\r', ' '])
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect()
}

fn privacy_rpc_urls(config: &Config) -> Vec<String> {
    let candidates = [
        env_non_empty("STARKNET_API_RPC_POOL"),
        env_non_empty("STARKNET_API_RPC_URL"),
        env_non_empty("STARKNET_RPC_POOL"),
        env_non_empty("STARKNET_RPC_URL"),
        Some(config.starknet_rpc_url.clone()),
    ];

    let mut urls: Vec<String> = Vec::new();
    for candidate in candidates.into_iter().flatten() {
        for url in parse_rpc_url_list(&candidate) {
            if !urls.iter().any(|existing| existing == &url) {
                urls.push(url);
            }
        }
        if !urls.is_empty() {
            break;
        }
    }

    if urls.is_empty() {
        vec![config.starknet_rpc_url.clone()]
    } else {
        urls
    }
}

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

#[derive(Debug, Deserialize)]
pub struct CreatePrivateNoteRequest {
    pub note_secret: Option<String>,
    pub note_amount: String,
    pub note_token: String,
}

#[derive(Debug, Serialize)]
pub struct CreatePrivateNoteResponse {
    pub note_secret: String,
    pub note_commitment: String,
    pub nullifier: String,
}

#[derive(Debug, Deserialize, Default)]
pub struct NoirInputsRequest {
    #[serde(default)]
    pub tx_context: Option<AutoPrivacyTxContext>,
}

#[derive(Debug, Serialize)]
pub struct NoirInputsResponse {
    pub noir_inputs: Value,
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
    #[serde(default, alias = "noirInputs")]
    pub noir_inputs: Option<Value>,
    // Optional V4 context bindings used by the real prover.
    pub note_version: Option<String>,
    pub root: Option<String>,
    pub intent_hash: Option<String>,
    pub action_hash: Option<String>,
    pub action_target: Option<String>,
    pub action_selector: Option<String>,
    #[serde(default)]
    pub action_calldata: Option<Vec<String>>,
    pub calldata_hash: Option<String>,
    pub approval_token: Option<String>,
    #[serde(alias = "approvalAmountLow")]
    pub approval_amount_low: Option<String>,
    #[serde(alias = "approvalAmountHigh")]
    pub approval_amount_high: Option<String>,
    pub payout_token: Option<String>,
    pub min_payout: Option<String>,
    #[serde(alias = "minPayoutLow")]
    pub min_payout_low: Option<String>,
    #[serde(alias = "minPayoutHigh")]
    pub min_payout_high: Option<String>,
    pub contract_address: Option<String>,
    pub executor_address: Option<String>,
    pub note_commitment: Option<String>,
    #[serde(default, alias = "deposit_tx_hash", alias = "noteDepositTxHash")]
    pub note_deposit_tx_hash: Option<String>,
    pub note_ciphertext: Option<String>,
    pub note_cid: Option<String>,
    pub denom_id: Option<String>,
    pub spendable_at_unix: Option<u64>,
    pub nullifier: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct NoirNoteRecord {
    note_secret: String,
    note_amount: String,
    note_token: String,
    created_at_unix: u64,
}

fn option_is_blank(value: &Option<String>) -> bool {
    value
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .is_none()
}

const NOIR_NOTE_REDIS_PREFIX: &str = "garaga:noir_note:v1";
const NOIR_NOTE_TTL_SECS: u64 = 60 * 60 * 24 * 30; // 30 days

fn getenv_clean(key: &str) -> String {
    env::var(key).unwrap_or_default().trim().to_string()
}

fn parse_u128_value(raw: &str) -> Result<u128> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest("note_amount is empty".to_string()));
    }
    let cleaned = if let Some((left, _right)) = trimmed.split_once(':') {
        left.trim()
    } else {
        trimmed
    };
    if cleaned.starts_with("0x") {
        u128::from_str_radix(cleaned.trim_start_matches("0x"), 16)
            .map_err(|_| AppError::BadRequest(format!("Invalid hex note_amount: {}", cleaned)))
    } else {
        cleaned
            .parse::<u128>()
            .map_err(|_| AppError::BadRequest(format!("Invalid note_amount: {}", cleaned)))
    }
}

fn parse_u64_value(raw: &str) -> Result<u64> {
    let trimmed = raw.trim();
    if trimmed.starts_with("0x") {
        u64::from_str_radix(trimmed.trim_start_matches("0x"), 16)
            .map_err(|_| AppError::BadRequest(format!("Invalid hex u64: {}", trimmed)))
    } else {
        trimmed
            .parse::<u64>()
            .map_err(|_| AppError::BadRequest(format!("Invalid u64: {}", trimmed)))
    }
}

fn pick_value_string(map: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = map.get(*key) {
            if let Some(text) = value.as_str() {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            } else if let Some(num) = value.as_u64() {
                return Some(num.to_string());
            } else if let Some(num) = value.as_i64() {
                return Some(num.to_string());
            } else if let Some(num) = value.as_f64() {
                return Some(num.trunc().to_string());
            }
        }
    }
    None
}

fn resolved_v4_root_from_noir_inputs(tx_context: &AutoPrivacyTxContext) -> Option<String> {
    let root_from_inputs = match tx_context.noir_inputs.as_ref() {
        Some(Value::Object(map)) => pick_value_string(map, &["merkle_root", "root"]),
        _ => None,
    };
    root_from_inputs.or_else(|| {
        tx_context
            .root
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

fn resolved_v4_nullifier_from_noir_inputs(tx_context: &AutoPrivacyTxContext) -> Option<String> {
    let nullifier_from_inputs = match tx_context.noir_inputs.as_ref() {
        Some(Value::Object(map)) => pick_value_string(map, &["nullifier"]),
        _ => None,
    };
    nullifier_from_inputs.or_else(|| {
        tx_context
            .nullifier
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

pub(crate) fn sync_v4_statement_fields_from_noir_inputs(tx_context: &mut AutoPrivacyTxContext) {
    let (root, nullifier, note_commitment) = match tx_context.noir_inputs.as_ref() {
        Some(Value::Object(map)) => (
            pick_value_string(map, &["merkle_root", "root"]),
            pick_value_string(map, &["nullifier"]),
            pick_value_string(map, &["note_commitment", "noteCommitment", "commitment"]),
        ),
        _ => (None, None, None),
    };

    if let Some(root) = root {
        tx_context.root = Some(root);
    }
    if let Some(nullifier) = nullifier {
        tx_context.nullifier = Some(nullifier);
    }
    if let Some(note_commitment) = note_commitment {
        tx_context.note_commitment = Some(note_commitment);
    }
}

fn compute_nullifier(note_secret: Felt) -> Felt {
    poseidon_hash_many(&[note_secret, Felt::ZERO])
}

fn compute_note_commitment(note_secret: Felt, note_amount: u128, note_token: Felt) -> Felt {
    let amount_felt = Felt::from(note_amount);
    let h1 = poseidon_hash_many(&[note_secret, amount_felt]);
    poseidon_hash_many(&[h1, note_token])
}

async fn store_noir_note_record(
    state: &AppState,
    note_commitment: &str,
    record: &NoirNoteRecord,
) -> Result<()> {
    let mut conn = state.redis.clone();
    let key = format!(
        "{}:{}",
        NOIR_NOTE_REDIS_PREFIX,
        note_commitment.to_lowercase()
    );
    let payload = serde_json::to_string(record)
        .map_err(|err| AppError::Internal(format!("Failed to serialize note record: {}", err)))?;
    conn.set_ex::<_, _, ()>(key, payload, NOIR_NOTE_TTL_SECS)
        .await
        .map_err(AppError::Redis)?;
    Ok(())
}

async fn load_noir_note_record(state: &AppState, note_commitment: &str) -> Option<NoirNoteRecord> {
    let mut conn = state.redis.clone();
    let key = format!(
        "{}:{}",
        NOIR_NOTE_REDIS_PREFIX,
        note_commitment.to_lowercase()
    );
    let raw: Option<String> = conn.get(key).await.ok()?;
    raw.and_then(|value| serde_json::from_str::<NoirNoteRecord>(&value).ok())
}

struct MerklePathResult {
    root: Felt,
    path: Vec<Felt>,
    index_bits: Vec<bool>,
}

const MERKLE_DEPTH_U64: u64 = 20;
const MAX_LEAVES_SCAN: u64 = 50_000;
const NOTE_INDEX_SCAN_WINDOW: u64 = 512;
const RECEIPT_EVENT_SCAN_BACKTRACK_BLOCKS: u64 = 8;

fn compute_zero_nodes(depth: u32) -> Vec<Felt> {
    let mut nodes = Vec::with_capacity(depth as usize + 1);
    let mut current = Felt::ZERO;
    nodes.push(current);
    for _ in 0..depth {
        current = poseidon_hash_many(&[current, current]);
        nodes.push(current);
    }
    nodes
}

fn storage_key_for_var(name: &str, keys: &[Felt]) -> Result<String> {
    let key = get_storage_var_address(name, keys)
        .map_err(|e| AppError::Internal(format!("Storage key resolution error: {}", e)))?;
    Ok(format!("{:#x}", key))
}

async fn read_merkle_node_storage(
    client: &StarknetClient,
    executor_address: &str,
    level: u64,
    index: u64,
    zero_nodes: &[Felt],
) -> Result<Felt> {
    let key = storage_key_for_var("merkle_nodes", &[Felt::from(level), Felt::from(index)])?;
    let raw = client.get_storage_at(executor_address, &key).await?;
    let value = parse_felt(&raw)?;
    if value == Felt::ZERO {
        Ok(zero_nodes[level as usize])
    } else {
        Ok(value)
    }
}

async fn find_note_index_via_contract(
    client: &StarknetClient,
    executor_address: &str,
    note_commitment: Felt,
) -> Result<Option<u64>> {
    let next_leaf = match client
        .call_contract(executor_address, "get_next_leaf_index", vec![])
        .await
    {
        Ok(next_leaf_raw) => next_leaf_raw
            .get(0)
            .ok_or_else(|| AppError::Internal("Missing get_next_leaf_index response".to_string()))
            .and_then(|value| parse_u64_value(value))?,
        Err(err) => {
            tracing::warn!(
                "get_next_leaf_index call failed; falling back to storage read: {}",
                err
            );
            let key = storage_key_for_var("next_leaf_index", &[])?;
            let raw = client.get_storage_at(executor_address, &key).await?;
            parse_u64_value(&raw)?
        }
    };

    let total_leaves = next_leaf.min(MAX_LEAVES_SCAN);
    if next_leaf > MAX_LEAVES_SCAN {
        tracing::warn!(
            "ShieldedPoolV4 leaf scan capped: next_leaf_index={} cap={}",
            next_leaf,
            MAX_LEAVES_SCAN
        );
    }

    if total_leaves == 0 {
        return Ok(None);
    }

    let zero_nodes = compute_zero_nodes(MERKLE_DEPTH_U64 as u32);
    let mut scanned: u64 = 0;
    let mut window = NOTE_INDEX_SCAN_WINDOW.min(total_leaves);

    while scanned < total_leaves && scanned < MAX_LEAVES_SCAN {
        let end = total_leaves.saturating_sub(scanned);
        let start = end.saturating_sub(window);

        for index in start..end {
            let leaf =
                read_merkle_node_storage(client, executor_address, 0, index, &zero_nodes).await?;
            if leaf == note_commitment {
                return Ok(Some(index));
            }
        }

        scanned = scanned.saturating_add(window);
        window = (window.saturating_mul(2)).min(total_leaves.saturating_sub(scanned));
        if window == 0 {
            break;
        }
    }

    Ok(None)
}

async fn build_merkle_path_via_contract(
    client: &StarknetClient,
    executor_address: &str,
    note_index: u64,
) -> Result<MerklePathResult> {
    let root_key = storage_key_for_var("merkle_root", &[])?;
    let root_raw = client.get_storage_at(executor_address, &root_key).await?;
    let root = parse_felt(&root_raw)?;

    let zero_nodes = compute_zero_nodes(MERKLE_DEPTH_U64 as u32);

    let mut path: Vec<Felt> = Vec::with_capacity(MERKLE_DEPTH_U64 as usize);
    let mut index_bits: Vec<bool> = Vec::with_capacity(MERKLE_DEPTH_U64 as usize);
    let mut idx = note_index;
    for level in 0..MERKLE_DEPTH_U64 {
        let is_right = idx % 2 == 1;
        let sibling_index = if is_right { idx - 1 } else { idx + 1 };
        let sibling =
            read_merkle_node_storage(client, executor_address, level, sibling_index, &zero_nodes)
                .await?;
        path.push(sibling);
        index_bits.push(is_right);
        idx /= 2;
    }

    Ok(MerklePathResult {
        root,
        path,
        index_bits,
    })
}

async fn find_note_index_via_receipt(
    client: &StarknetClient,
    executor_address: &str,
    note_commitment: Felt,
    tx_hash: &str,
) -> Result<(Option<u64>, Option<u64>)> {
    let receipt = client.get_transaction_receipt(tx_hash).await?;
    let selector = get_selector_from_name("MerkleLeafInserted")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let selector_hex = format!("{:#x}", selector);
    let receipt_block_number = receipt.block_number;

    for event in receipt.events {
        if !event.from_address.eq_ignore_ascii_case(executor_address) {
            continue;
        }
        let selector_matches = event
            .keys
            .iter()
            .any(|value| value.trim().eq_ignore_ascii_case(&selector_hex));

        if event.data.len() >= 2 {
            let index = parse_u64_value(&event.data[0])?;
            let commitment_matches = event
                .data
                .iter()
                .skip(1)
                .filter_map(|value| parse_felt(value).ok())
                .any(|value| value == note_commitment);
            if commitment_matches {
                return Ok((Some(index), receipt_block_number));
            }
        }

        if selector_matches {
            // Receipt event was from the expected variant but did not carry the target commitment.
            continue;
        }
    }

    Ok((None, receipt_block_number))
}

async fn read_note_deposit_timestamp_via_contract(
    client: &StarknetClient,
    executor_address: &str,
    note_commitment: Felt,
) -> Result<u64> {
    let out = client
        .call_contract(
            executor_address,
            "get_note_deposit_timestamp",
            vec![format!("{:#x}", note_commitment)],
        )
        .await?;
    let raw = out.first().ok_or_else(|| {
        AppError::Internal("Missing get_note_deposit_timestamp response".to_string())
    })?;
    parse_u64_value(raw)
}

async fn wait_for_note_deposit_timestamp_via_contract(
    client: &StarknetClient,
    executor_address: &str,
    note_commitment: Felt,
) -> Result<u64> {
    let attempts = hide_balance_note_index_wait_attempts();
    let delay_ms = hide_balance_note_index_wait_delay_ms();

    for attempt in 0..attempts {
        match read_note_deposit_timestamp_via_contract(client, executor_address, note_commitment)
            .await
        {
            Ok(timestamp) if timestamp > 0 => return Ok(timestamp),
            Ok(_) => {
                if attempt + 1 >= attempts {
                    return Err(AppError::BadRequest(
                        "Note deposit belum terindeks di shielded pool. Backend sudah menunggu sinkronisasi, tapi note belum muncul. Tunggu sebentar lalu coba lagi."
                            .to_string(),
                    ));
                }
                tracing::warn!(
                    "ShieldedPoolV4 note deposit timestamp masih 0 for {:#x} on attempt {}/{}; retrying in {} ms",
                    note_commitment,
                    attempt + 1,
                    attempts,
                    delay_ms
                );
            }
            Err(err) => {
                if attempt + 1 >= attempts {
                    return Err(err);
                }
                tracing::warn!(
                    "ShieldedPoolV4 note deposit timestamp lookup failed for {:#x} on attempt {}/{}: {}; retrying in {} ms",
                    note_commitment,
                    attempt + 1,
                    attempts,
                    err,
                    delay_ms
                );
            }
        }

        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
    }

    Err(AppError::BadRequest(
        "Note deposit belum terindeks di shielded pool. Tunggu beberapa detik lalu coba lagi."
            .to_string(),
    ))
}

async fn wait_for_note_index_via_contract(
    client: &StarknetClient,
    executor_address: &str,
    note_commitment: Felt,
) -> Result<Option<u64>> {
    let attempts = hide_balance_note_index_wait_attempts();
    let delay_ms = hide_balance_note_index_wait_delay_ms();

    for attempt in 0..attempts {
        match find_note_index_via_contract(client, executor_address, note_commitment).await {
            Ok(Some(index)) => return Ok(Some(index)),
            Ok(None) => {
                if attempt + 1 >= attempts {
                    return Ok(None);
                }
                tracing::warn!(
                    "ShieldedPoolV4 note index not found for {:#x} on attempt {}/{}; retrying in {} ms",
                    note_commitment,
                    attempt + 1,
                    attempts,
                    delay_ms
                );
            }
            Err(err) => {
                if attempt + 1 >= attempts {
                    return Err(err);
                }
                tracing::warn!(
                    "ShieldedPoolV4 note index lookup failed for {:#x} on attempt {}/{}: {}; retrying in {} ms",
                    note_commitment,
                    attempt + 1,
                    attempts,
                    err,
                    delay_ms
                );
            }
        }

        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
    }

    Ok(None)
}

async fn build_merkle_path_for_note(
    state: &AppState,
    executor_address: &str,
    note_commitment: &str,
    note_deposit_tx_hash: Option<&str>,
) -> Result<MerklePathResult> {
    let client = StarknetClient::new_with_urls(privacy_rpc_urls(&state.config));
    let note_commitment_felt = parse_felt(note_commitment)?;
    let mut receipt_block_number: Option<u64> = None;

    if let Some(tx_hash) = note_deposit_tx_hash {
        match find_note_index_via_receipt(&client, executor_address, note_commitment_felt, tx_hash)
            .await
        {
            Ok((Some(index), _block_number)) => {
                return build_merkle_path_via_contract(&client, executor_address, index).await;
            }
            Ok((None, block_number)) => {
                receipt_block_number = block_number;
                tracing::warn!(
                    "Deposit tx receipt did not include note commitment {}; falling back to onchain scan",
                    note_commitment
                );
            }
            Err(err) => {
                tracing::warn!(
                    "Deposit tx receipt lookup failed; falling back to onchain scan: {}",
                    err
                );
            }
        }
    }

    let _deposit_timestamp = wait_for_note_deposit_timestamp_via_contract(
        &client,
        executor_address,
        note_commitment_felt,
    )
    .await?;

    let latest_block = client.block_number().await.unwrap_or_else(|_| 0);
    let selector = get_selector_from_name("MerkleLeafInserted")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let selector_hex = format!("{:#x}", selector);
    let from_block = receipt_block_number
        .map(|block| block.saturating_sub(RECEIPT_EVENT_SCAN_BACKTRACK_BLOCKS))
        .unwrap_or(0);
    let events = match if receipt_block_number.is_some() {
        client
            .get_events(Some(executor_address), from_block, latest_block)
            .await
    } else {
        client
            .get_events_with_keys(
                Some(executor_address),
                from_block,
                latest_block,
                Some(vec![vec![selector_hex.clone()]]),
            )
            .await
    } {
        Ok(events) => events,
        Err(err) => {
            tracing::warn!(
                "MerkleLeafInserted event scan failed; falling back to onchain leaf scan: {}",
                err
            );
            Vec::new()
        }
    };

    let mut note_index: Option<u64> = None;

    for event in events {
        let key_matches = event
            .keys
            .iter()
            .any(|value| value.trim().eq_ignore_ascii_case(&selector_hex));
        if receipt_block_number.is_none() && !key_matches {
            continue;
        }
        if event.data.len() < 2 {
            continue;
        }
        let index = parse_u64_value(&event.data[0])?;
        let commitment_matches = event
            .data
            .iter()
            .skip(1)
            .filter_map(|value| parse_felt(value).ok())
            .any(|value| value == note_commitment_felt);
        if commitment_matches {
            note_index = Some(index);
            break;
        }
    }

    let note_index = match note_index {
        Some(index) => index,
        None => {
            if let Some(index) =
                wait_for_note_index_via_contract(&client, executor_address, note_commitment_felt)
                    .await?
            {
                index
            } else {
                return Err(AppError::BadRequest(
                    "Note commitment not found in shielded pool tree".to_string(),
                ));
            }
        }
    };

    build_merkle_path_via_contract(&client, executor_address, note_index).await
}

fn ensure_v4_only(note_version: &str) -> Result<()> {
    if note_version.eq_ignore_ascii_case("v4") {
        return Ok(());
    }
    Err(AppError::BadRequest(
        "Hide Balance only supports V4/Noir. Please upgrade payloads to V4.".to_string(),
    ))
}

#[derive(Debug, Serialize)]
pub struct AutoPrivacyPayloadResponse {
    pub verifier: String,
    pub nullifier: String,
    pub commitment: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executor_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note_commitment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note_cid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub denom_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spendable_at_unix: Option<u64>,
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
    pub privacy_payload: Option<PrivacyVerificationPayload>,
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
pub struct PreparePrivateExitRequest {
    pub verifier: Option<String>,
    pub executor_address: Option<String>,
    #[allow(dead_code)]
    pub root: String,
    pub nullifier: String,
    pub note_commitment: Option<String>,
    pub denom_id: Option<String>,
    pub token: String,
    pub amount_low: String,
    pub amount_high: String,
    pub recipient: String,
    #[serde(default)]
    pub tx_context: Option<AutoPrivacyTxContext>,
}

#[derive(Debug, Serialize)]
pub struct PreparePrivateExitResponse {
    pub payload: AutoPrivacyPayloadResponse,
    pub exit_hash: String,
    pub onchain_calls: Vec<StarknetWalletCall>,
}

#[derive(Debug, Deserialize)]
pub struct PrivacyFixedAmountRequest {
    pub executor_address: Option<String>,
    pub token: String,
    pub denom_id: String,
}

#[derive(Debug, Serialize)]
pub struct PrivacyFixedAmountResponse {
    pub amount_low: String,
    pub amount_high: String,
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

// Validates that a string looks like a hex felt (0x prefixed or raw hex).
fn is_hex_felt(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return false;
    }
    let hex = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
        .unwrap_or(trimmed);
    if hex.is_empty() {
        return false;
    }
    hex.chars().all(|ch| ch.is_ascii_hexdigit())
}

// Enforces strict hex felt inputs to prevent malformed calldata and command injection.
fn ensure_hex_felt(value: &str, label: &str) -> Result<()> {
    if is_hex_felt(value) {
        Ok(())
    } else {
        Err(AppError::BadRequest(format!(
            "Invalid {label}: expected hex felt string"
        )))
    }
}

// Enforces strict hex felt inputs for a list of items.
fn ensure_hex_felt_list(values: &[String], label: &str) -> Result<()> {
    for (idx, value) in values.iter().enumerate() {
        ensure_hex_felt(value, &format!("{label}[{idx}]"))?;
    }
    Ok(())
}

fn starknet_prime() -> &'static BigUint {
    static PRIME: std::sync::OnceLock<BigUint> = std::sync::OnceLock::new();
    PRIME.get_or_init(|| {
        let one = BigUint::from(1u8);
        let term_a = &one << 251;
        let term_b = BigUint::from(17u8) << 192;
        term_a + term_b + one
    })
}

fn normalize_hash_like_felt_hex(value: &str, label: &str) -> Result<String> {
    let trimmed = value.trim().trim_matches('"').trim_matches('\'');
    if trimmed.is_empty() {
        return Err(AppError::BadRequest(format!("{label} must be non-empty")));
    }
    let lowered = trimmed.to_ascii_lowercase();
    if matches!(lowered.as_str(), "none" | "null" | "undefined" | "nan") {
        return Err(AppError::BadRequest(format!(
            "Invalid {label} placeholder '{}'",
            trimmed
        )));
    }
    if let Ok(parsed) = parse_felt(trimmed) {
        return Ok(format!("{:#x}", parsed));
    }
    let value = if trimmed.starts_with("0x") || trimmed.starts_with("0X") {
        let digits = trimmed.trim_start_matches("0x").trim_start_matches("0X");
        BigUint::parse_bytes(digits.as_bytes(), 16).ok_or_else(|| {
            AppError::BadRequest(format!("Invalid {label}: expected hex or decimal integer"))
        })?
    } else if trimmed.chars().any(|ch| ch.is_ascii_alphabetic())
        && trimmed.chars().all(|ch| ch.is_ascii_hexdigit())
    {
        BigUint::parse_bytes(trimmed.as_bytes(), 16).ok_or_else(|| {
            AppError::BadRequest(format!("Invalid {label}: expected hex or decimal integer"))
        })?
    } else {
        BigUint::parse_bytes(trimmed.replace('_', "").as_bytes(), 10).ok_or_else(|| {
            AppError::BadRequest(format!("Invalid {label}: expected hex or decimal integer"))
        })?
    };
    let normalized = format!("0x{:x}", value % starknet_prime());
    let felt = Felt::from_hex(&normalized).map_err(|error| {
        AppError::Internal(format!(
            "Failed to normalize {label} into Starknet felt '{}': {}",
            normalized, error
        ))
    })?;
    Ok(format!("{:#x}", felt))
}

// Guards against dangerous shell metacharacters when executing configured prover commands.
fn ensure_safe_shell_command(cmd: &str) -> Result<()> {
    let trimmed = cmd.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest(
            "Auto prover command is not configured".to_string(),
        ));
    }
    let forbidden = [';', '|', '&', '`', '<', '>', '\n', '\r'];
    if trimmed.chars().any(|ch| forbidden.contains(&ch)) {
        return Err(AppError::BadRequest(
            "Auto prover command contains forbidden shell characters".to_string(),
        ));
    }
    if trimmed.contains("$(") {
        return Err(AppError::BadRequest(
            "Auto prover command contains forbidden shell substitutions".to_string(),
        ));
    }
    Ok(())
}

// Parses the configured prover command into a binary and args without shell expansion.
fn parse_exec_command(cmd: &str) -> Result<(String, Vec<String>)> {
    let trimmed = cmd.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest(
            "Auto prover command is not configured".to_string(),
        ));
    }

    let mut parts: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut chars = trimmed.chars().peekable();
    let mut in_single = false;
    let mut in_double = false;

    while let Some(ch) = chars.next() {
        if in_single {
            if ch == '\'' {
                in_single = false;
            } else {
                current.push(ch);
            }
            continue;
        }

        if in_double {
            match ch {
                '"' => in_double = false,
                '\\' => {
                    if let Some(next) = chars.next() {
                        current.push(next);
                    }
                }
                _ => current.push(ch),
            }
            continue;
        }

        match ch {
            '\'' => in_single = true,
            '"' => in_double = true,
            '\\' => {
                if let Some(next) = chars.next() {
                    current.push(next);
                }
            }
            ch if ch.is_whitespace() => {
                if !current.is_empty() {
                    parts.push(current);
                    current = String::new();
                }
            }
            _ => current.push(ch),
        }
    }

    if in_single || in_double {
        return Err(AppError::BadRequest(
            "Auto prover command has unclosed quote".to_string(),
        ));
    }
    if !current.is_empty() {
        parts.push(current);
    }
    if parts.is_empty() {
        return Err(AppError::BadRequest(
            "Auto prover command is not configured".to_string(),
        ));
    }

    let binary = parts.remove(0);
    Ok((binary, parts))
}

fn resolve_exec_binary_path(binary: &str) -> Option<PathBuf> {
    let path = Path::new(binary);
    let has_separator = binary.contains('/') || binary.contains('\\');
    if path.is_absolute() || has_separator {
        if path.is_file() {
            return Some(path.to_path_buf());
        }
    }

    let Ok(paths) = env::var("PATH") else {
        return None;
    };
    for candidate_dir in env::split_paths(&paths) {
        let candidate = candidate_dir.join(binary);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn resolve_exec_target_path(binary: &str, args: &[String]) -> Option<PathBuf> {
    if let Some(first) = args.first() {
        let candidate = Path::new(first);
        if candidate.is_file() {
            return Some(candidate.to_path_buf());
        }
    }
    resolve_exec_binary_path(binary)
}

fn decode_sha256_hex(raw: &str) -> Result<Vec<u8>> {
    let trimmed = raw.trim().trim_start_matches("0x");
    if trimmed.len() != 64 {
        return Err(AppError::BadRequest(
            "PRIVACY_AUTO_GARAGA_PROVER_SHA256 must be a 64-character hex string".to_string(),
        ));
    }
    hex::decode(trimmed).map_err(|_| {
        AppError::BadRequest(
            "PRIVACY_AUTO_GARAGA_PROVER_SHA256 must be a valid hex string".to_string(),
        )
    })
}

fn verify_prover_target_checksum(config: &Config, binary: &str, args: &[String]) -> Result<()> {
    static VERIFIED: std::sync::OnceLock<()> = std::sync::OnceLock::new();
    if VERIFIED.get().is_some() {
        return Ok(());
    }

    let Some(expected_raw) = config
        .privacy_auto_garaga_prover_sha256
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        if config.is_testnet() {
            tracing::warn!(
                "Auto Garaga prover checksum is not configured; skipping verification in testnet."
            );
            return Ok(());
        }
        return Err(AppError::BadRequest(
            "PRIVACY_AUTO_GARAGA_PROVER_SHA256 is required for auto prover integrity checks."
                .to_string(),
        ));
    };

    let expected = decode_sha256_hex(expected_raw)?;
    let Some(target_path) = resolve_exec_target_path(binary, args) else {
        return Err(AppError::BadRequest(format!(
            "Unable to resolve auto prover executable path for checksum verification: {}",
            binary
        )));
    };
    let bytes = fs::read(&target_path).map_err(|error| {
        AppError::BadRequest(format!(
            "Failed to read auto prover executable for checksum verification ({}): {}",
            target_path.display(),
            error
        ))
    })?;
    let actual = Sha256::digest(&bytes);
    if actual.as_slice() != expected.as_slice() {
        return Err(AppError::BadRequest(format!(
            "Auto Garaga prover checksum mismatch for {}. Update PRIVACY_AUTO_GARAGA_PROVER_SHA256.",
            target_path.display()
        )));
    }

    let _ = VERIFIED.set(());
    Ok(())
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
            Self::Swap => "preview_swap_action_hash",
            Self::Limit => "preview_limit_action_hash",
            Self::Stake => "preview_stake_action_hash",
        }
    }

    // Resolves the flow-specific proof-submission entrypoint used by ShieldedPoolV4.
    fn submit_entrypoint(self) -> &'static str {
        match self {
            Self::Swap => "submit_private_swap",
            Self::Limit => "submit_private_limit",
            Self::Stake => "submit_private_stake",
        }
    }

    // Resolves the executor entrypoint used for the final private execution call.
    fn execute_entrypoint(self) -> &'static str {
        match self {
            Self::Swap => "execute_private_swap_v4",
            Self::Limit => "execute_private_limit_v4",
            Self::Stake => "execute_private_stake_external_v4",
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
    let mut tx_context = req.tx_context.unwrap_or_default();
    let requested_note_version = tx_context
        .note_version
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("v4");
    ensure_v4_only(requested_note_version)?;
    let is_v4 = requested_note_version.eq_ignore_ascii_case("v4");
    let executor_address = resolve_private_action_executor_address_from_context(
        &state.config,
        &tx_context,
        &serde_json::Map::new(),
    )
    .ok();
    if is_v4 {
        if let Some(executor) = executor_address.as_deref() {
            tx_context.contract_address = Some(executor.to_string());
            tx_context.executor_address = Some(executor.to_string());
        }
        sync_v4_statement_fields_from_noir_inputs(&mut tx_context);
        if option_is_blank(&tx_context.root) {
            let executor = executor_address.as_deref().ok_or_else(|| {
                AppError::BadRequest("Missing executor address for auto-proof root".to_string())
            })?;
            let executor_root = shielded_current_root(&state, executor).await?;
            tx_context.root = Some(executor_root.to_string());
        }
        if option_is_blank(&tx_context.nullifier) {
            tx_context.nullifier = Some(random_felt_hex());
        }
        if option_is_blank(&tx_context.action_hash) {
            if let (Some(selector), Some(calldata), Some(executor)) = (
                tx_context.action_selector.clone(),
                tx_context.action_calldata.clone(),
                executor_address.clone(),
            ) {
                if let Some(flow_raw) = tx_context.flow.as_deref() {
                    if matches!(
                        flow_raw.trim().to_ascii_lowercase().as_str(),
                        "swap" | "limit" | "limit_order" | "stake"
                    ) {
                        let flow = PrivateExecutionFlow::parse(flow_raw)?;
                        let action_selector = parse_selector_or_felt(&selector)?;
                        let intent_hash = compute_intent_hash_on_executor(
                            &state,
                            &executor,
                            flow,
                            &tx_context,
                            action_selector,
                            &calldata,
                        )
                        .await?;
                        tx_context.intent_hash = Some(intent_hash.clone());
                        tx_context.action_hash = Some(intent_hash);
                    }
                }
            }
            if option_is_blank(&tx_context.action_hash) {
                tx_context.action_hash = tx_context.intent_hash.clone();
            }
        }
        if option_is_blank(&tx_context.recipient) {
            tx_context.recipient = Some(user_address.clone());
        }
    }

    let mut payload = generate_auto_garaga_payload(
        &state.config,
        &user_address,
        verifier_kind.as_str(),
        Some(&tx_context),
    )
    .await?;
    if let Some(executor_address) = executor_address {
        payload.executor_address = Some(executor_address);
    }

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

pub async fn create_private_note(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreatePrivateNoteRequest>,
) -> Result<Json<ApiResponse<CreatePrivateNoteResponse>>> {
    let user_result = require_user(&headers, &state).await;
    let is_prod = matches!(
        state
            .config
            .environment
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "production" | "prod" | "mainnet"
    );
    if is_prod {
        user_result?;
    }
    let note_secret_raw = req
        .note_secret
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .unwrap_or_else(random_felt_hex);

    let note_secret_felt = parse_felt(note_secret_raw.trim())?;
    let note_amount = parse_u128_value(&req.note_amount)?;
    let note_token_felt = parse_felt(req.note_token.trim())?;

    let nullifier_felt = compute_nullifier(note_secret_felt);
    let commitment_felt = compute_note_commitment(note_secret_felt, note_amount, note_token_felt);

    let note_secret = format!("{:#x}", note_secret_felt);
    let nullifier = format!("{:#x}", nullifier_felt);
    let note_commitment = format!("{:#x}", commitment_felt);

    let record = NoirNoteRecord {
        note_secret: note_secret.clone(),
        note_amount: note_amount.to_string(),
        note_token: format!("{:#x}", note_token_felt),
        created_at_unix: chrono::Utc::now().timestamp() as u64,
    };
    store_noir_note_record(&state, &note_commitment, &record).await?;

    Ok(Json(ApiResponse::success(CreatePrivateNoteResponse {
        note_secret,
        note_commitment,
        nullifier,
    })))
}

pub async fn resolve_noir_inputs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<NoirInputsRequest>,
) -> Result<Json<ApiResponse<NoirInputsResponse>>> {
    let user_address = require_user(&headers, &state).await.ok();
    let tx_context = req.tx_context.unwrap_or_default();

    let mut inputs = match tx_context.noir_inputs.clone() {
        Some(Value::Object(map)) => map,
        _ => serde_json::Map::new(),
    };

    let mut note_commitment = pick_value_string(&inputs, &["note_commitment", "noteCommitment"])
        .or_else(|| tx_context.note_commitment.clone());
    let note_deposit_tx_hash = pick_value_string(
        &inputs,
        &[
            "note_deposit_tx_hash",
            "noteDepositTxHash",
            "deposit_tx_hash",
        ],
    )
    .or_else(|| tx_context.note_deposit_tx_hash.clone());

    let mut note_secret = pick_value_string(&inputs, &["note_secret", "noteSecret"]);
    let mut note_amount = pick_value_string(&inputs, &["note_amount", "noteAmount"]);
    let mut note_token = pick_value_string(&inputs, &["note_token", "noteToken", "token"]);

    if let Some(commitment) = note_commitment.as_deref() {
        if let Some(record) = load_noir_note_record(&state, commitment).await {
            if note_secret.is_none() {
                note_secret = Some(record.note_secret.clone());
            }
            if note_amount.is_none() {
                note_amount = Some(record.note_amount.clone());
            }
            if note_token.is_none() {
                note_token = Some(record.note_token.clone());
            }
        }
    }

    if note_commitment.is_none() {
        if let (Some(secret_raw), Some(amount_raw), Some(token_raw)) = (
            note_secret.as_deref(),
            note_amount.as_deref(),
            note_token.as_deref(),
        ) {
            let secret_felt = parse_felt(secret_raw)?;
            let amount_val = parse_u128_value(amount_raw)?;
            let token_felt = parse_felt(token_raw)?;
            let commitment_felt = compute_note_commitment(secret_felt, amount_val, token_felt);
            note_commitment = Some(format!("{:#x}", commitment_felt));
        }
    }

    let note_secret = note_secret.ok_or_else(|| {
        AppError::BadRequest("Missing note_secret (create/deposit note first)".to_string())
    })?;
    let note_amount = note_amount.ok_or_else(|| {
        AppError::BadRequest("Missing note_amount (create/deposit note first)".to_string())
    })?;
    let note_token = note_token.ok_or_else(|| {
        AppError::BadRequest("Missing note_token (create/deposit note first)".to_string())
    })?;
    let note_commitment = note_commitment.ok_or_else(|| {
        AppError::BadRequest("Missing note_commitment (create/deposit note first)".to_string())
    })?;

    let note_secret_felt = parse_felt(&note_secret)?;
    let note_amount_val = parse_u128_value(&note_amount)?;
    let _note_token_felt = parse_felt(&note_token)?;
    let nullifier_felt = compute_nullifier(note_secret_felt);

    let executor_address =
        resolve_private_action_executor_address_from_context(&state.config, &tx_context, &inputs)?;
    let merkle = build_merkle_path_for_note(
        &state,
        &executor_address,
        &note_commitment,
        note_deposit_tx_hash.as_deref(),
    )
    .await?;

    // Note witness fields must follow the selected commitment, not any cached noir_inputs from
    // older notes or older quotes. Overwrite them every time we resolve fresh inputs.
    inputs.insert(
        "note_secret".to_string(),
        Value::String(note_secret.clone()),
    );
    inputs.insert(
        "note_amount".to_string(),
        Value::String(note_amount.clone()),
    );
    inputs.insert("note_token".to_string(), Value::String(note_token.clone()));
    inputs.insert(
        "nullifier".to_string(),
        Value::String(format!("{:#x}", nullifier_felt)),
    );
    inputs.insert(
        "note_commitment".to_string(),
        Value::String(note_commitment.clone()),
    );
    inputs.insert(
        "merkle_root".to_string(),
        Value::String(format!("{:#x}", merkle.root)),
    );
    inputs.insert(
        "root".to_string(),
        Value::String(format!("{:#x}", merkle.root)),
    );
    inputs.insert(
        "merkle_path".to_string(),
        Value::Array(
            merkle
                .path
                .iter()
                .map(|value| Value::String(format!("{:#x}", value)))
                .collect(),
        ),
    );
    inputs.insert(
        "merkle_index".to_string(),
        Value::Array(
            merkle
                .index_bits
                .iter()
                .map(|value| Value::Bool(*value))
                .collect(),
        ),
    );

    if let Some(action_hash) = tx_context
        .action_hash
        .clone()
        .or_else(|| tx_context.intent_hash.clone())
    {
        inputs.insert("action_hash".to_string(), Value::String(action_hash));
    }

    let recipient = tx_context
        .recipient
        .clone()
        .or_else(|| user_address.clone())
        .unwrap_or_default();
    if !recipient.is_empty() {
        inputs.insert("recipient".to_string(), Value::String(recipient));
    }

    let chain_id_raw = getenv_clean("GARAGA_CHAIN_ID");
    let chain_id_raw = if !chain_id_raw.is_empty() {
        chain_id_raw
    } else {
        state.config.starknet_chain_id.clone()
    };
    if !chain_id_raw.is_empty() {
        let chain_id_felt = parse_chain_id(&chain_id_raw)?;
        inputs.insert(
            "chain_id".to_string(),
            Value::String(format!("{:#x}", chain_id_felt)),
        );
    }
    inputs.insert(
        "contract_address".to_string(),
        Value::String(executor_address.clone()),
    );

    let amount_in = tx_context
        .approval_amount_low
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| note_amount_val.to_string());
    inputs.insert("amount_in".to_string(), Value::String(amount_in));

    let min_amount_out = tx_context
        .min_payout_low
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "0".to_string());
    inputs.insert("min_amount_out".to_string(), Value::String(min_amount_out));

    let target_dex = tx_context
        .action_target
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "0x0".to_string());
    inputs.insert("target_dex".to_string(), Value::String(target_dex));

    if let Some(value) = tx_context
        .approval_token
        .clone()
        .or_else(|| tx_context.from_token.clone())
        .filter(|value| !value.trim().is_empty())
    {
        inputs.insert("swap_token_in".to_string(), Value::String(value));
    }
    if let Some(value) = tx_context
        .payout_token
        .clone()
        .or_else(|| tx_context.to_token.clone())
        .filter(|value| !value.trim().is_empty())
    {
        inputs.insert("swap_token_out".to_string(), Value::String(value));
    }

    Ok(Json(ApiResponse::success(NoirInputsResponse {
        noir_inputs: Value::Object(inputs),
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

    let mut tx_context = req.tx_context.clone().unwrap_or_default();
    let executor_address = resolve_private_action_executor_address_from_context(
        &state.config,
        &tx_context,
        &serde_json::Map::new(),
    )?;
    let action_selector = parse_selector_or_felt(&req.action_entrypoint)?;

    let intent_hash = compute_intent_hash_on_executor(
        &state,
        &executor_address,
        flow,
        &tx_context,
        action_selector,
        &req.action_calldata,
    )
    .await?;

    let requested_note_version = tx_context
        .note_version
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("v4");
    ensure_v4_only(requested_note_version)?;
    let is_v4 = requested_note_version.eq_ignore_ascii_case("v4");
    if is_v4 {
        tx_context.contract_address = Some(executor_address.clone());
        tx_context.executor_address = Some(executor_address.clone());
        sync_v4_statement_fields_from_noir_inputs(&mut tx_context);
        if option_is_blank(&tx_context.root) {
            let executor_root = shielded_current_root(&state, &executor_address).await?;
            tx_context.root = Some(executor_root.to_string());
        }
        if option_is_blank(&tx_context.nullifier) {
            tx_context.nullifier = Some(random_felt_hex());
        }
        if option_is_blank(&tx_context.intent_hash) {
            tx_context.intent_hash = Some(intent_hash.clone());
        }
        if option_is_blank(&tx_context.action_hash) {
            tx_context.action_hash = Some(intent_hash.clone());
        }
        if option_is_blank(&tx_context.recipient) {
            tx_context.recipient = Some(user_address.clone());
        }
    }

    let request_payload =
        payload_from_request(req.privacy_payload.as_ref(), verifier_kind.as_str());
    let mut payload = if let Some(payload) = request_payload {
        tracing::info!("Reusing client-provided Hide Balance payload for private executor flow");
        payload
    } else {
        generate_auto_garaga_payload(
            &state.config,
            &user_address,
            verifier_kind.as_str(),
            Some(&tx_context),
        )
        .await?
    };
    payload.executor_address = Some(executor_address.clone());
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
        &tx_context,
        action_selector,
        &req.action_calldata,
        &payload,
    )?;

    let relayer = match (
        req.token.as_deref(),
        req.amount_low.as_deref(),
        req.amount_high.as_deref(),
    ) {
        (Some(token), Some(amount_low), Some(amount_high)) => {
            Some(build_relayer_private_execution_draft(
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
            )?)
        }
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

pub async fn prepare_private_exit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<PreparePrivateExitRequest>,
) -> Result<Json<ApiResponse<PreparePrivateExitResponse>>> {
    let user_address = require_starknet_user(&headers, &state).await?;
    let verifier_kind = parse_privacy_verifier_kind(req.verifier.as_deref())?;

    let executor_address = req
        .executor_address
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or(resolve_private_action_executor_address(&state.config)?);

    let executor_root_felt = shielded_current_root(&state, &executor_address).await?;
    let nullifier_felt = parse_felt(req.nullifier.trim())?;
    let token_felt = parse_felt(req.token.trim())?;
    let amount_low_felt = parse_felt(req.amount_low.trim())?;
    let amount_high_felt = parse_felt(req.amount_high.trim())?;
    let recipient_felt = parse_felt(req.recipient.trim())?;

    let exit_hash = compute_exit_hash_on_executor(
        &state,
        &executor_address,
        token_felt,
        amount_low_felt,
        amount_high_felt,
        recipient_felt,
    )
    .await?;

    let mut tx_context = req.tx_context.unwrap_or_default();
    let requested_note_version = tx_context
        .note_version
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("v4");
    ensure_v4_only(requested_note_version)?;
    let note_version = "v4";
    tx_context.flow = Some(
        tx_context
            .flow
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("exit")
            .to_string(),
    );
    tx_context.note_version = Some(note_version.to_string());
    // For V4 private exit, never trust a cached frontend root.
    // Always bind the proof to the executor's current on-chain root so wallet
    // calldata cannot be built with a stale root that would revert as "Unknown root".
    tx_context.root = Some(executor_root_felt.to_string());
    tx_context.intent_hash = Some(exit_hash.clone());
    tx_context.action_hash = Some(exit_hash.clone());
    tx_context.nullifier = Some(nullifier_felt.to_string());
    tx_context.recipient = Some(recipient_felt.to_string());
    tx_context.from_token = Some(token_felt.to_string());
    tx_context.amount = Some(format!("{}:{}", amount_low_felt, amount_high_felt));
    if let Some(note_commitment) = req
        .note_commitment
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        tx_context.note_commitment = Some(note_commitment.to_string());
    }
    if let Some(denom_id) = req
        .denom_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        tx_context.denom_id = Some(denom_id.to_string());
    }

    let mut payload = generate_auto_garaga_payload(
        &state.config,
        &user_address,
        verifier_kind.as_str(),
        Some(&tx_context),
    )
    .await?;
    payload.executor_address = Some(executor_address.clone());
    payload.note_version = Some(note_version.to_string());

    bind_intent_hash_into_payload(&mut payload, &exit_hash)?;
    ensure_public_inputs_bind_v3_shape(&payload.public_inputs, "prepared private exit payload")?;
    ensure_public_inputs_bind_root_nullifier(
        &executor_root_felt.to_string(),
        &nullifier_felt.to_string(),
        &payload.public_inputs,
        "prepared private exit payload",
    )?;

    let payload_root = payload.root.as_deref().ok_or_else(|| {
        AppError::BadRequest("Hide Balance V4 private exit payload requires root".to_string())
    })?;
    let payload_root_felt = parse_felt(payload_root)?;
    if payload_root_felt != executor_root_felt {
        return Err(AppError::BadRequest(
            "Private exit payload root mismatch with executor current root".to_string(),
        ));
    }
    let payload_nullifier_felt = parse_felt(payload.nullifier.trim())?;
    if payload_nullifier_felt != nullifier_felt {
        return Err(AppError::BadRequest(
            "Private exit payload nullifier mismatch with requested nullifier".to_string(),
        ));
    }

    let call = build_private_exit_wallet_call(
        &executor_address,
        executor_root_felt,
        nullifier_felt,
        &payload.proof,
        token_felt,
        amount_low_felt,
        amount_high_felt,
        recipient_felt,
    )?;

    Ok(Json(ApiResponse::success(PreparePrivateExitResponse {
        payload,
        exit_hash,
        onchain_calls: vec![call],
    })))
}

pub async fn get_private_fixed_amount(
    State(state): State<AppState>,
    Json(req): Json<PrivacyFixedAmountRequest>,
) -> Result<Json<ApiResponse<PrivacyFixedAmountResponse>>> {
    let executor_address = req
        .executor_address
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or(resolve_private_action_executor_address(&state.config)?);
    let reader = crate::services::onchain::OnchainReader::from_config(&state.config)?;
    let contract_address = parse_felt(&executor_address)?;
    let token_felt = parse_felt(req.token.trim())?;
    let denom_felt = parse_felt(req.denom_id.trim())?;
    let selector = get_selector_from_name("fixed_amount")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let out = reader
        .call(FunctionCall {
            contract_address,
            entry_point_selector: selector,
            calldata: vec![token_felt, denom_felt],
        })
        .await?;
    let amount_low = out.first().copied().ok_or_else(|| {
        AppError::BadRequest("ShieldedPoolV4 fixed_amount returned empty response".to_string())
    })?;
    let amount_high = out.get(1).copied().unwrap_or(Felt::ZERO);
    Ok(Json(ApiResponse::success(PrivacyFixedAmountResponse {
        amount_low: amount_low.to_string(),
        amount_high: amount_high.to_string(),
    })))
}

async fn shielded_current_root(state: &AppState, executor_address: &str) -> Result<Felt> {
    let reader = crate::services::onchain::OnchainReader::from_config(&state.config)?;
    let contract_address = parse_felt(executor_address)?;
    let selector = get_selector_from_name("get_root")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;

    let out = reader
        .call(FunctionCall {
            contract_address,
            entry_point_selector: selector,
            calldata: vec![],
        })
        .await?;
    let root = out.first().copied().unwrap_or(Felt::ZERO);
    if root == Felt::ZERO {
        return Err(AppError::BadRequest(
            "ShieldedPoolV4 root is not initialized yet (get_root=0).".to_string(),
        ));
    }
    Ok(root)
}

fn random_felt_hex() -> String {
    let bytes: [u8; 32] = rand::random();
    let felt = Felt::from_bytes_be(&bytes);
    format!("{:#x}", felt)
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
    let submitted = relayer
        .submit_call(Call {
            to,
            selector,
            calldata,
        })
        .await?;

    Ok(Json(ApiResponse::success(
        RelayerPrivateExecutionResponse {
            tx_hash: submitted.tx_hash,
        },
    )))
}

// Routes privacy submissions to V1 (`submit_private_action`) or V2 (`submit_action`) based on payload shape.
// Enforces payload integrity (including nullifier/commitment binding) before relayer execution.
async fn submit_private_action_internal(
    state: &AppState,
    user_address: &str,
    req: &PrivacyActionRequest,
) -> Result<String> {
    ensure_hex_felt(user_address, "user_address")?;
    ensure_hex_felt_list(&req.proof, "proof")?;
    ensure_hex_felt_list(&req.public_inputs, "public_inputs")?;
    if let Some(nullifier) = req.nullifier.as_deref() {
        ensure_hex_felt(nullifier, "nullifier")?;
    }
    if let Some(commitment) = req.commitment.as_deref() {
        ensure_hex_felt(commitment, "commitment")?;
    }
    if let Some(old_root) = req.old_root.as_deref() {
        ensure_hex_felt(old_root, "old_root")?;
    }
    if let Some(new_root) = req.new_root.as_deref() {
        ensure_hex_felt(new_root, "new_root")?;
    }
    if let Some(nullifiers) = req.nullifiers.as_ref() {
        ensure_hex_felt_list(nullifiers, "nullifiers")?;
    }
    if let Some(commitments) = req.commitments.as_ref() {
        ensure_hex_felt_list(commitments, "commitments")?;
    }

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

    // Local verifier guard to avoid relayer gas drains on invalid proofs.
    verify_proof(&state.config, verifier_kind, &req.proof, &req.public_inputs)?;

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

    let mut payload = load_auto_garaga_payload_from_prover_cmd(
        config,
        cmd,
        config.privacy_auto_garaga_prover_timeout_ms,
        user_address,
        verifier,
        tx_context,
    )
    .await?;

    maybe_attach_note_cid(&mut payload, tx_context, config).await?;

    Ok(payload)
}

async fn maybe_attach_note_cid(
    payload: &mut AutoPrivacyPayloadResponse,
    tx_context: Option<&AutoPrivacyTxContext>,
    config: &crate::config::Config,
) -> Result<()> {
    let Some(context) = tx_context else {
        return Ok(());
    };
    if payload
        .note_cid
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
    {
        return Ok(());
    }
    if let Some(cid) = context
        .note_cid
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        payload.note_cid = Some(cid.to_string());
        return Ok(());
    }
    let Some(ciphertext) = context
        .note_ciphertext
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(());
    };

    let note_commitment = context
        .note_commitment
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            payload
                .note_commitment
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .or_else(|| {
            let commitment = payload.commitment.trim();
            if commitment.is_empty() || commitment.eq_ignore_ascii_case("0x0") {
                None
            } else {
                Some(commitment)
            }
        })
        .ok_or_else(|| {
            AppError::BadRequest(
                "note_commitment is required to upload encrypted note to Filecoin".to_string(),
            )
        })?;

    let service = FilecoinService::from_config(config)?;
    let cid = service
        .upload_encrypted_note(ciphertext, note_commitment)
        .await?;
    payload.note_cid = Some(cid);
    Ok(())
}

// Executes the external prover command and parses the returned proof/public_inputs payload.
// Applies strict timeout/error handling and validates nullifier/commitment field presence.
async fn load_auto_garaga_payload_from_prover_cmd(
    config: &Config,
    cmd: &str,
    timeout_ms: u64,
    user_address: &str,
    verifier: &str,
    tx_context: Option<&AutoPrivacyTxContext>,
) -> Result<AutoPrivacyPayloadResponse> {
    ensure_safe_shell_command(cmd)?;
    ensure_hex_felt(user_address, "user_address")?;
    let (binary, args) = parse_exec_command(cmd)?;
    verify_prover_target_checksum(config, &binary, &args)?;

    let timeout_ms = if timeout_ms == 0 { 45_000 } else { timeout_ms };
    let stdin_payload = serde_json::json!({
        "user_address": user_address,
        "verifier": verifier,
        "requested_at_unix": chrono::Utc::now().timestamp(),
        "tx_context": tx_context,
    });

    let mut command = Command::new(binary);
    command
        .kill_on_drop(true)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(fallback) = resolve_prebuilt_honk_witness_fallback(config, tx_context) {
        let flow = tx_context
            .and_then(|context| context.flow.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("unknown");
        tracing::warn!(
            flow,
            circuit = fallback.circuit,
            honk_vk_path = %fallback.honk_vk_path,
            "Auto Garaga using non-production prebuilt witness fallback"
        );
        command.env("GARAGA_USE_PREBUILT_WITNESS", "true");
        command.env("GARAGA_ALLOW_STATEMENT_OVERRIDE", "true");
        command.env(fallback.honk_vk_env_key, &fallback.honk_vk_path);
    } else if let Some(artifacts) =
        resolve_static_honk_artifact_paths(config, tx_context)
    {
        let flow = tx_context
            .and_then(|context| context.flow.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("unknown");
        tracing::warn!(
            flow,
            proof_path = %artifacts.proof_path,
            public_inputs_path = %artifacts.public_inputs_path,
            honk_vk_path = ?artifacts.honk_vk_path,
            "Auto Garaga using non-production static Honk artifacts fallback"
        );
        command.env("GARAGA_USE_STATIC_ARTIFACTS", "true");
        command.env("GARAGA_PROVE_CMD", "");
        command.env("GARAGA_ALLOW_STATEMENT_OVERRIDE", "true");
        command.env("GARAGA_PROOF_PATH", &artifacts.proof_path);
        command.env("GARAGA_PUBLIC_INPUTS_PATH", &artifacts.public_inputs_path);
        if let (Some(env_key), Some(vk_path)) = (artifacts.honk_vk_env_key, artifacts.honk_vk_path)
        {
            command.env(env_key, vk_path);
        }
    } else if let Some(payload_path) = config
        .privacy_auto_garaga_payload_file
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .filter(|_| !is_production_environment(config))
    {
        tracing::warn!(
            payload_path = %payload_path,
            "Auto Garaga using non-production precomputed payload fallback"
        );
        command.env("GARAGA_ALLOW_PRECOMPUTED_PAYLOAD", "true");
        command.env("GARAGA_PRECOMPUTED_PAYLOAD_PATH", payload_path);
        command.env("GARAGA_PROVE_CMD", "");
    }

    let mut child = command.spawn().map_err(|error| {
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

    let mut nullifier = raw
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
    let mut public_inputs = extract_hex_array(&raw, &["public_inputs"], "public_inputs")?;
    let mut root = extract_optional_string(&raw, &["root"]);
    let mut note_version = extract_optional_string(&raw, &["note_version"]);
    let note_commitment = extract_optional_string(&raw, &["note_commitment"]);
    let note_cid = extract_optional_string(&raw, &["note_cid", "noteCid"]);
    let denom_id = extract_optional_string(&raw, &["denom_id"]);
    let spendable_at_unix = extract_optional_u64(&raw, &["spendable_at_unix"]);
    let vk_path_used = extract_optional_string(&raw, &["vk_path_used"]);
    let vk_n_public = extract_optional_u64(&raw, &["vk_n_public"]);
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
    if note_version
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
    {
        note_version = tx_context
            .and_then(|context| context.note_version.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
    }
    let is_v3_payload = note_version
        .as_deref()
        .map(|value| {
            let trimmed = value.trim();
            trimmed.eq_ignore_ascii_case("v3") || trimmed.eq_ignore_ascii_case("v4")
        })
        .unwrap_or(false)
        || root.is_some()
        || tx_context
            .and_then(|context| context.root.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_some();
    if is_v3_payload {
        bind_v4_statement_overrides_to_public_inputs(
            &mut public_inputs,
            &mut root,
            &mut nullifier,
            tx_context,
        )?;
        let payload_root = root.as_deref().ok_or_else(|| {
            AppError::BadRequest(
                "Auto Garaga prover response V4 must contain non-empty 'root'".to_string(),
            )
        })?;
        ensure_public_inputs_bind_root_nullifier(
            payload_root,
            &nullifier,
            &public_inputs,
            "auto Garaga prover response",
        )?;
        ensure_public_inputs_bind_v3_shape(&public_inputs, "auto Garaga prover response")?;
    } else {
        ensure_public_inputs_bind_nullifier_commitment(
            &nullifier,
            &commitment,
            &public_inputs,
            "auto Garaga prover response",
        )?;
    }

    tracing::info!(
        "Auto Garaga payload parsed: verifier={}, note_version={:?}, proof_len={}, public_inputs_len={}, vk_path_used={:?}, vk_n_public={:?}",
        verifier,
        note_version,
        proof.len(),
        public_inputs.len(),
        vk_path_used,
        vk_n_public
    );

    Ok(AutoPrivacyPayloadResponse {
        verifier: verifier.to_string(),
        nullifier,
        commitment,
        executor_address: None,
        root,
        note_version,
        note_commitment,
        note_cid,
        denom_id,
        spendable_at_unix,
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

fn extract_optional_string(value: &Value, keys: &[&str]) -> Option<String> {
    let object = value.as_object()?;
    for key in keys {
        let raw = object.get(*key)?;
        let text = raw.as_str()?.trim();
        let lowered = text.to_ascii_lowercase();
        if !text.is_empty() && !matches!(lowered.as_str(), "none" | "null" | "undefined" | "nan") {
            return Some(text.to_string());
        }
    }
    None
}

fn extract_optional_u64(value: &Value, keys: &[&str]) -> Option<u64> {
    let object = value.as_object()?;
    for key in keys {
        let raw = object.get(*key)?;
        if let Some(val) = raw.as_u64() {
            return Some(val);
        }
        if let Some(text) = raw.as_str() {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(parsed) = trimmed.parse::<u64>() {
                return Some(parsed);
            }
        }
    }
    None
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

pub(crate) fn ensure_public_inputs_bind_root_nullifier(
    root: &str,
    nullifier: &str,
    public_inputs: &[String],
    source_label: &str,
) -> Result<()> {
    let root_index = privacy_binding_index("GARAGA_ROOT_PUBLIC_INPUT_INDEX", 0)?;
    let nullifier_index = resolve_nullifier_public_input_index_v3_like()?;
    let required_len = std::cmp::max(root_index, nullifier_index) + 1;

    if public_inputs.len() < required_len {
        return Err(AppError::BadRequest(format!(
            "{} must expose root/nullifier in public_inputs indexes [{}, {}], but public_inputs length is {}",
            source_label,
            root_index,
            nullifier_index,
            public_inputs.len()
        )));
    }

    let expected_root = parse_felt(root)?;
    let expected_nullifier = parse_felt(nullifier)?;
    let bound_root = parse_felt(public_inputs[root_index].trim())?;
    let bound_nullifier = parse_felt(public_inputs[nullifier_index].trim())?;

    if bound_root != expected_root || bound_nullifier != expected_nullifier {
        return Err(AppError::BadRequest(format!(
            "{} public_inputs binding mismatch: expected public_inputs[{}]==root and public_inputs[{}]==nullifier",
            source_label, root_index, nullifier_index
        )));
    }
    Ok(())
}

pub(crate) fn ensure_public_inputs_bind_v3_shape(
    public_inputs: &[String],
    source_label: &str,
) -> Result<()> {
    let legacy_compat = std::env::var("HIDE_BALANCE_V3_LEGACY_VERIFIER_COMPAT")
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false);
    let root_index = privacy_binding_index("GARAGA_ROOT_PUBLIC_INPUT_INDEX", 0)?;
    let nullifier_index = resolve_nullifier_public_input_index_v3_like()?;
    if legacy_compat {
        let required_len = std::cmp::max(root_index, nullifier_index) + 1;
        if public_inputs.len() < required_len {
            return Err(AppError::BadRequest(format!(
                "{} must expose root/nullifier in public_inputs indexes [{}, {}], but public_inputs length is {}",
                source_label, root_index, nullifier_index, public_inputs.len()
            )));
        }
        return Ok(());
    }
    let action_hash_index = intent_hash_public_input_index()?;
    let required_len = std::cmp::max(
        std::cmp::max(root_index, nullifier_index),
        action_hash_index,
    ) + 1;
    if public_inputs.len() < required_len {
        return Err(AppError::BadRequest(format!(
            "{} V4 verifier output too short: public_inputs length is {}, required >= {} (root={}, nullifier={}, action_hash={}). Regenerate Garaga PK/VK and redeploy verifier.",
            source_label,
            public_inputs.len(),
            required_len,
            root_index,
            nullifier_index,
            action_hash_index
        )));
    }
    let _ = normalize_hash_like_felt_hex(
        public_inputs[action_hash_index].trim(),
        &format!("{source_label} action_hash"),
    )?;
    Ok(())
}

fn bind_v4_statement_overrides_to_public_inputs(
    public_inputs: &mut Vec<String>,
    root: &mut Option<String>,
    nullifier: &mut String,
    tx_context: Option<&AutoPrivacyTxContext>,
) -> Result<()> {
    let Some(tx_context) = tx_context else {
        return Ok(());
    };

    let root_index = privacy_binding_index("GARAGA_ROOT_PUBLIC_INPUT_INDEX", 0)?;
    let nullifier_index = resolve_nullifier_public_input_index_v3_like()?;
    let action_hash_index = intent_hash_public_input_index()?;

    if let Some(root_override) = resolved_v4_root_from_noir_inputs(tx_context) {
        let normalized = format!("{:#x}", parse_felt(&root_override)?);
        while public_inputs.len() <= root_index {
            public_inputs.push("0x0".to_string());
        }
        let current = public_inputs[root_index].trim();
        if current != "0x0" && current != normalized {
            tracing::warn!(
                "Auto Garaga prover response root mismatch: public_inputs[{}]={} but tx_context.root={}; keeping prover root because ShieldedPoolV4 accepts any root_seen witness root",
                root_index,
                public_inputs[root_index],
                normalized
            );
            *root = Some(current.to_string());
            return Ok(());
        }
        public_inputs[root_index] = normalized.clone();
        *root = Some(normalized);
    }

    if let Some(nullifier_override) = resolved_v4_nullifier_from_noir_inputs(tx_context) {
        let normalized = format!("{:#x}", parse_felt(&nullifier_override)?);
        while public_inputs.len() <= nullifier_index {
            public_inputs.push("0x0".to_string());
        }
        let current = public_inputs[nullifier_index].trim();
        if current != "0x0" && current != normalized {
            return Err(AppError::BadRequest(format!(
                "Auto Garaga prover response nullifier mismatch: public_inputs[{}]={} but tx_context.nullifier={}",
                nullifier_index,
                public_inputs[nullifier_index],
                normalized
            )));
        }
        public_inputs[nullifier_index] = normalized.clone();
        *nullifier = normalized;
    }

    if let Some(action_hash_override) = tx_context
        .action_hash
        .as_deref()
        .or(tx_context.intent_hash.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let normalized = normalize_hash_like_felt_hex(action_hash_override, "action_hash")?;
        while public_inputs.len() <= action_hash_index {
            public_inputs.push("0x0".to_string());
        }
        let current = public_inputs[action_hash_index].trim();
        if current != "0x0" && current != normalized {
            return Err(AppError::BadRequest(format!(
                "Auto Garaga prover response action_hash mismatch: public_inputs[{}]={} but tx_context.action_hash={}",
                action_hash_index,
                public_inputs[action_hash_index],
                normalized
            )));
        }
        public_inputs[action_hash_index] = normalized;
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

fn resolve_nullifier_public_input_index_v3_like() -> Result<usize> {
    if std::env::var("GARAGA_NULLIFIER_PUBLIC_INPUT_INDEX").is_ok() {
        privacy_binding_index("GARAGA_NULLIFIER_PUBLIC_INPUT_INDEX", 1)
    } else {
        privacy_binding_index("GARAGA_NULLIFIER_PUBLIC_INPUT_INDEX_V3", 1)
    }
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
    let intent_hash_felt = normalize_hash_like_felt_hex(intent_hash, "intent_hash")?;
    let index = intent_hash_public_input_index()?;
    while payload.public_inputs.len() <= index {
        payload.public_inputs.push("0x0".to_string());
    }
    let current = payload.public_inputs[index].trim();
    if current != "0x0" && current != intent_hash_felt {
        return Err(AppError::BadRequest(format!(
            "Garaga payload action_hash mismatch: public_inputs[{}]={} but expected {}",
            index, payload.public_inputs[index], intent_hash_felt
        )));
    }
    payload.public_inputs[index] = intent_hash_felt;
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

// Resolves the active private executor address (PrivateActionExecutor / ShieldedPoolV4) from env/config fallbacks.
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

fn resolve_private_action_executor_address_from_context(
    config: &crate::config::Config,
    tx_context: &AutoPrivacyTxContext,
    inputs: &serde_json::Map<String, Value>,
) -> Result<String> {
    for raw in [
        pick_value_string(
            inputs,
            &[
                "executor_address",
                "executorAddress",
                "contract_address",
                "contractAddress",
            ],
        ),
        tx_context.executor_address.clone(),
        tx_context.contract_address.clone(),
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

    resolve_private_action_executor_address(config)
}

#[derive(Debug, Clone, Copy)]
struct ExecutorActionBinding {
    action_target: Felt,
    approval_token: Felt,
    approval_amount_low: Felt,
    approval_amount_high: Felt,
    payout_token: Felt,
    min_payout_low: Felt,
    min_payout_high: Felt,
}

fn parse_context_felt(label: &str, value: Option<&str>) -> Result<Felt> {
    let trimmed = value
        .map(str::trim)
        .filter(|raw| !raw.is_empty())
        .ok_or_else(|| {
            AppError::BadRequest(format!("Missing {} for private executor V4", label))
        })?;
    parse_felt(trimmed)
}

fn parse_context_or_calldata_felt(
    label: &str,
    context_value: Option<&str>,
    action_calldata: &[String],
    fallback_index: Option<usize>,
) -> Result<Felt> {
    if let Some(raw) = context_value
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return parse_felt(raw);
    }

    if let Some(index) = fallback_index {
        let raw = action_calldata.get(index).ok_or_else(|| {
            AppError::BadRequest(format!(
                "Missing {} for private executor V4 (action_calldata[{}])",
                label, index
            ))
        })?;
        return parse_felt(raw.trim());
    }

    Err(AppError::BadRequest(format!(
        "Missing {} for private executor V4",
        label
    )))
}

fn resolve_executor_action_binding(
    flow: PrivateExecutionFlow,
    tx_context: &AutoPrivacyTxContext,
    action_calldata: &[String],
) -> Result<ExecutorActionBinding> {
    let fallback = match flow {
        PrivateExecutionFlow::Swap => Some((5usize, 6usize, 7usize, 8usize, 3usize, 4usize)),
        PrivateExecutionFlow::Limit | PrivateExecutionFlow::Stake => None,
    };

    let action_target = parse_context_felt("action_target", tx_context.action_target.as_deref())?;
    let approval_token = parse_context_or_calldata_felt(
        "approval_token",
        tx_context.approval_token.as_deref(),
        action_calldata,
        fallback.map(|value| value.0),
    )?;
    let payout_token = parse_context_or_calldata_felt(
        "payout_token",
        tx_context.payout_token.as_deref(),
        action_calldata,
        fallback.map(|value| value.1),
    )?;
    let approval_amount_low = parse_context_or_calldata_felt(
        "approval_amount_low",
        tx_context.approval_amount_low.as_deref(),
        action_calldata,
        fallback.map(|value| value.2),
    )?;
    let approval_amount_high = parse_context_or_calldata_felt(
        "approval_amount_high",
        tx_context.approval_amount_high.as_deref(),
        action_calldata,
        fallback.map(|value| value.3),
    )?;
    let min_payout_low = parse_context_or_calldata_felt(
        "min_payout_low",
        tx_context.min_payout_low.as_deref(),
        action_calldata,
        fallback.map(|value| value.4),
    )?;
    let min_payout_high = parse_context_or_calldata_felt(
        "min_payout_high",
        tx_context.min_payout_high.as_deref(),
        action_calldata,
        fallback.map(|value| value.5),
    )?;

    Ok(ExecutorActionBinding {
        action_target,
        approval_token,
        approval_amount_low,
        approval_amount_high,
        payout_token,
        min_payout_low,
        min_payout_high,
    })
}

// Calls the executor preview entrypoint to compute the intent hash bound into Garaga public inputs.
async fn compute_intent_hash_on_executor(
    state: &AppState,
    executor_address: &str,
    flow: PrivateExecutionFlow,
    tx_context: &AutoPrivacyTxContext,
    action_selector: Felt,
    action_calldata: &[String],
) -> Result<String> {
    let reader = crate::services::onchain::OnchainReader::from_config(&state.config)?;
    let contract_address = parse_felt(executor_address)?;
    let preview_selector = get_selector_from_name(flow.preview_entrypoint())
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let binding = resolve_executor_action_binding(flow, tx_context, action_calldata)?;

    let mut calldata: Vec<Felt> = Vec::with_capacity(8 + action_calldata.len());
    calldata.push(binding.action_target);
    calldata.push(action_selector);
    calldata.push(Felt::from(action_calldata.len() as u64));
    for felt in action_calldata {
        calldata.push(parse_felt(felt)?);
    }
    calldata.push(binding.approval_token);
    calldata.push(binding.approval_amount_low);
    calldata.push(binding.approval_amount_high);
    calldata.push(binding.payout_token);
    calldata.push(binding.min_payout_low);
    calldata.push(binding.min_payout_high);

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

async fn compute_exit_hash_on_executor(
    state: &AppState,
    executor_address: &str,
    token: Felt,
    amount_low: Felt,
    amount_high: Felt,
    recipient: Felt,
) -> Result<String> {
    let reader = crate::services::onchain::OnchainReader::from_config(&state.config)?;
    let contract_address = parse_felt(executor_address)?;
    let preview_selector = get_selector_from_name("preview_exit_hash")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;

    let out = reader
        .call(FunctionCall {
            contract_address,
            entry_point_selector: preview_selector,
            calldata: vec![token, amount_low, amount_high, recipient],
        })
        .await?;
    let exit_hash = out.first().ok_or_else(|| {
        AppError::BadRequest("ShieldedPoolV4 preview_exit_hash returned empty response".to_string())
    })?;
    Ok(exit_hash.to_string())
}

// Builds a two-call wallet batch: first `submit_private_intent`, then the flow-specific `execute_private_*`.
// Carries forward commitment-bound calldata so execution matches the proven intent.
fn build_private_executor_wallet_calls(
    executor_address: &str,
    flow: PrivateExecutionFlow,
    tx_context: &AutoPrivacyTxContext,
    action_selector: Felt,
    action_calldata: &[String],
    payload: &AutoPrivacyPayloadResponse,
) -> Result<Vec<StarknetWalletCall>> {
    let binding = resolve_executor_action_binding(flow, tx_context, action_calldata)?;
    let root = payload
        .root
        .as_deref()
        .ok_or_else(|| AppError::BadRequest("Hide Balance V4 requires payload.root".to_string()))?;
    let nullifier = payload.nullifier.trim();
    if nullifier.is_empty() {
        return Err(AppError::BadRequest(
            "Hide Balance V4 requires non-empty payload.nullifier".to_string(),
        ));
    }

    let mut submit_calldata: Vec<String> =
        Vec::with_capacity(4 + payload.proof.len() + payload.public_inputs.len());
    submit_calldata.push(root.trim().to_string());
    submit_calldata.push(nullifier.to_string());
    submit_calldata.push(format!("0x{:x}", payload.proof.len()));
    submit_calldata.extend(payload.proof.iter().cloned());
    submit_calldata.push(format!("0x{:x}", payload.public_inputs.len()));
    submit_calldata.extend(payload.public_inputs.iter().cloned());

    let mut execute_calldata: Vec<String> = Vec::with_capacity(
        12 + action_calldata.len() + payload.proof.len() + payload.public_inputs.len(),
    );
    execute_calldata.push(root.trim().to_string());
    execute_calldata.push(nullifier.to_string());
    execute_calldata.push(format!("0x{:x}", payload.proof.len()));
    execute_calldata.extend(payload.proof.iter().cloned());
    execute_calldata.push(format!("0x{:x}", payload.public_inputs.len()));
    execute_calldata.extend(payload.public_inputs.iter().cloned());
    execute_calldata.push(format!("{:#x}", binding.action_target));
    execute_calldata.push(format!("{:#x}", action_selector));
    execute_calldata.push(format!("0x{:x}", action_calldata.len()));
    execute_calldata.extend(action_calldata.iter().cloned());
    execute_calldata.push(format!("{:#x}", binding.approval_token));
    execute_calldata.push(format!("{:#x}", binding.approval_amount_low));
    execute_calldata.push(format!("{:#x}", binding.approval_amount_high));
    execute_calldata.push(format!("{:#x}", binding.payout_token));
    execute_calldata.push(format!("{:#x}", binding.min_payout_low));
    execute_calldata.push(format!("{:#x}", binding.min_payout_high));

    Ok(vec![
        StarknetWalletCall {
            contract_address: executor_address.to_string(),
            entrypoint: flow.submit_entrypoint().to_string(),
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
    let submit_selector = get_selector_from_name(flow.submit_entrypoint())
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
    let action_calldata_hash = parse_felt(&format!(
        "{:#x}",
        poseidon_hash_many(&action_calldata_felts)
    ))?;

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

fn build_private_exit_wallet_call(
    executor_address: &str,
    root: Felt,
    nullifier: Felt,
    proof: &[String],
    token: Felt,
    amount_low: Felt,
    amount_high: Felt,
    recipient: Felt,
) -> Result<StarknetWalletCall> {
    if proof.is_empty() {
        return Err(AppError::BadRequest(
            "Private exit payload proof must be non-empty".to_string(),
        ));
    }

    let mut calldata: Vec<String> = Vec::with_capacity(8 + proof.len());
    calldata.push(root.to_string());
    calldata.push(nullifier.to_string());
    calldata.push(format!("0x{:x}", proof.len()));
    for value in proof {
        calldata.push(parse_felt(value)?.to_string());
    }
    calldata.push(token.to_string());
    calldata.push(amount_low.to_string());
    calldata.push(amount_high.to_string());
    calldata.push(recipient.to_string());

    Ok(StarknetWalletCall {
        contract_address: executor_address.to_string(),
        entrypoint: "private_exit_v3".to_string(),
        calldata,
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
