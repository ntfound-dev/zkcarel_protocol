use anyhow::{anyhow, Context, Result};
use num_bigint::BigUint;
use num_traits::Num;
use rand::RngCore;
use redis::AsyncCommands;
use serde::Serialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::process::Command;

use garaga_rs::calldata::full_proof_with_hints::groth16::{
    get_groth16_calldata, Groth16Proof, Groth16VerificationKey,
};
use garaga_rs::calldata::full_proof_with_hints::zk_honk::{
    get_zk_honk_calldata, HonkVerificationKey, ZKHonkProof,
};
use garaga_rs::definitions::CurveID;

use crate::garaga::honk_calldata::normalize_zk_honk_proof_calldata;

#[derive(Debug, Serialize)]
struct GaragaPayload {
    nullifier: String,
    commitment: String,
    intent_hash: String,
    proof: Vec<String>,
    public_inputs: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    note_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    note_commitment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    denom_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    spendable_at_unix: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    vk_path_used: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    vk_n_public: Option<u64>,
}

pub async fn run_cli() -> Result<()> {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.iter().any(|arg| arg == "--warmup") {
        run_warmup_mode().await?;
        return Ok(());
    }
    if args.iter().any(|arg| arg == "--prove") {
        run_prove_mode().await?;
        return Ok(());
    }
    if args.iter().any(|arg| arg == "--test") {
        run_test_mode().await?;
        return Ok(());
    }

    let stdin_payload = parse_stdin_payload()?;
    let payload = build_payload(&stdin_payload).await?;
    println!("{}", serde_json::to_string(&payload)?);
    Ok(())
}

fn parse_stdin_payload() -> Result<Value> {
    let mut buffer = String::new();
    io::stdin().read_to_string(&mut buffer)?;
    let trimmed = buffer.trim();
    if trimmed.is_empty() {
        return Ok(Value::Object(Map::new()));
    }
    let value: Value =
        serde_json::from_str(trimmed).map_err(|error| anyhow!("Invalid stdin JSON: {error}"))?;
    if !value.is_object() {
        return Err(anyhow!("stdin JSON must be an object"));
    }
    Ok(value)
}

fn getenv_clean(name: &str) -> String {
    let value = env::var(name).unwrap_or_default();
    let trimmed = value.trim();
    if trimmed.len() >= 2 {
        let bytes = trimmed.as_bytes();
        if (bytes[0] == b'\'' && bytes[trimmed.len() - 1] == b'\'')
            || (bytes[0] == b'"' && bytes[trimmed.len() - 1] == b'"')
        {
            return trimmed[1..trimmed.len() - 1].trim().to_string();
        }
    }
    trimmed.to_string()
}

fn getenv_required(name: &str) -> Result<String> {
    let value = getenv_clean(name);
    if value.is_empty() {
        return Err(anyhow!("Missing required env: {name}"));
    }
    Ok(value)
}

fn bool_env(name: &str, default: bool) -> bool {
    let raw = getenv_clean(name).to_ascii_lowercase();
    if raw.is_empty() {
        return default;
    }
    matches!(raw.as_str(), "1" | "true" | "yes" | "on")
}

fn is_production_env(raw: &str) -> bool {
    let env = raw.trim().to_ascii_lowercase();
    env == "production" || env == "prod" || env == "mainnet" || env.contains("mainnet")
}

fn select_precomputed_payload_path(flow: &str) -> Option<PathBuf> {
    let flow = flow.trim().to_ascii_lowercase();
    let flow_override = if flow == "swap" {
        getenv_clean("GARAGA_PRECOMPUTED_PAYLOAD_PATH_SWAP")
    } else if matches!(flow.as_str(), "limit" | "limit_order" | "limit-order") {
        getenv_clean("GARAGA_PRECOMPUTED_PAYLOAD_PATH_LIMIT")
    } else if flow == "stake" {
        getenv_clean("GARAGA_PRECOMPUTED_PAYLOAD_PATH_STAKE")
    } else {
        String::new()
    };
    if !flow_override.is_empty() {
        return Some(PathBuf::from(flow_override));
    }
    let fallback = getenv_clean("GARAGA_PRECOMPUTED_PAYLOAD_PATH");
    if fallback.is_empty() {
        None
    } else {
        Some(PathBuf::from(fallback))
    }
}

fn clean_optional_text(value: Option<&Value>) -> String {
    let Some(value) = value else {
        return String::new();
    };
    let text = match value {
        Value::String(value) => value.clone(),
        Value::Number(value) => value.to_string(),
        Value::Bool(value) => value.to_string(),
        _ => value.to_string(),
    };
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let lowered = trimmed.to_ascii_lowercase();
    if matches!(lowered.as_str(), "none" | "null" | "undefined" | "nan") {
        return String::new();
    }
    trimmed.to_string()
}

fn tx_field(tx_context: &Map<String, Value>, keys: &[&str]) -> String {
    for key in keys {
        if let Some(value) = tx_context.get(*key) {
            let text = clean_optional_text(Some(value));
            if !text.is_empty() {
                return text;
            }
        }
    }
    String::new()
}

fn resolve_chain_id_felt(tx_context: &Map<String, Value>) -> Option<String> {
    let ctx = tx_field(tx_context, &["chain_id", "chainId"]);
    let raw = if ctx.is_empty() {
        let env_override = getenv_clean("GARAGA_CHAIN_ID");
        if env_override.is_empty() {
            getenv_clean("STARKNET_CHAIN_ID")
        } else {
            env_override
        }
    } else {
        ctx
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with("0x") {
        return Some(trimmed.to_string());
    }
    let hex = hex::encode(trimmed.as_bytes());
    Some(format!("0x{hex}"))
}

fn resolve_contract_address(tx_context: &Map<String, Value>) -> Option<String> {
    let ctx = tx_field(
        tx_context,
        &[
            "contract_address",
            "pool_address",
            "shielded_pool_address",
            "executor_address",
        ],
    );
    if !ctx.is_empty() {
        return Some(ctx);
    }
    for key in [
        "HIDE_BALANCE_POOL_ADDRESS",
        "SHIELDED_POOL_V4_ADDRESS",
        "PRIVATE_ACTION_EXECUTOR_ADDRESS",
        "DARK_POOL_ADDRESS",
    ] {
        let value = getenv_clean(key);
        if !value.is_empty() {
            return Some(value);
        }
    }
    None
}

fn current_time_ns_string() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0));
    now.as_nanos().to_string()
}

fn compute_intent_hash(stdin_payload: &Value) -> Result<(String, String)> {
    let tx_context = stdin_payload
        .get("tx_context")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let flow = tx_field(&tx_context, &["flow", "action_type"]).to_ascii_lowercase();
    let user_address = clean_optional_text(stdin_payload.get("user_address")).to_ascii_lowercase();
    let mut nonce = tx_field(&tx_context, &["nonce"]);
    if nonce.is_empty() {
        nonce = clean_optional_text(stdin_payload.get("requested_at_unix"));
    }
    if nonce.is_empty() {
        nonce = current_time_ns_string();
    }

    let preimage = if flow == "swap" {
        vec![
            user_address,
            tx_field(&tx_context, &["from_token"]),
            tx_field(&tx_context, &["to_token"]),
            tx_field(&tx_context, &["amount"]),
            nonce.clone(),
        ]
    } else if matches!(flow.as_str(), "limit" | "limit_order" | "limit-order") {
        vec![
            user_address,
            tx_field(&tx_context, &["from_token"]),
            tx_field(&tx_context, &["to_token"]),
            tx_field(&tx_context, &["amount"]),
            tx_field(&tx_context, &["price"]),
            nonce.clone(),
        ]
    } else if flow == "stake" {
        let token = tx_field(&tx_context, &["token", "from_token"]);
        let mut pool = tx_field(&tx_context, &["pool"]);
        if pool.is_empty() {
            pool = token.clone();
        }
        vec![
            user_address,
            token,
            tx_field(&tx_context, &["amount"]),
            pool,
            nonce.clone(),
        ]
    } else {
        let sorted = sort_json_value(&Value::Object(tx_context));
        let json_blob = serde_json::to_string(&sorted).unwrap_or_default();
        vec![user_address, json_blob, nonce.clone()]
    };

    let joined = preimage.join("|");
    let digest = Sha256::digest(joined.as_bytes());
    let intent_hash = to_hex_felt_from_bytes(&digest)?;
    Ok((intent_hash, nonce))
}

fn make_dynamic_binding(
    stdin_payload: &Value,
    intent_hash: &str,
    nonce: &str,
) -> Result<(String, String)> {
    let requested_at = clean_optional_text(stdin_payload.get("requested_at_unix"));
    let verifier = clean_optional_text(stdin_payload.get("verifier"));
    let seed = format!("{intent_hash}|{nonce}|{requested_at}|{verifier}");
    let nullifier_hash = Sha256::digest(format!("{seed}:nullifier").as_bytes());
    let commitment_hash = Sha256::digest(format!("{seed}:commitment").as_bytes());
    let nullifier = to_hex_felt_from_bytes(&nullifier_hash)?;
    let commitment = to_hex_felt_from_bytes(&commitment_hash)?;
    Ok((nullifier, commitment))
}

fn apply_binding_to_public_inputs(
    mut public_inputs: Vec<String>,
    nullifier: &str,
    commitment: &str,
) -> Result<Vec<String>> {
    let nullifier_idx = parse_index("GARAGA_NULLIFIER_PUBLIC_INPUT_INDEX", 0)?;
    let commitment_idx = parse_index("GARAGA_COMMITMENT_PUBLIC_INPUT_INDEX", 1)?;
    let required_len = std::cmp::max(nullifier_idx, commitment_idx) + 1;
    while public_inputs.len() < required_len {
        public_inputs.push("0x0".to_string());
    }
    public_inputs[nullifier_idx] = to_hex_felt_from_str(nullifier)?;
    public_inputs[commitment_idx] = to_hex_felt_from_str(commitment)?;
    Ok(public_inputs)
}

fn bind_nullifier_commitment_from_public_inputs(
    public_inputs: &[String],
) -> Result<(String, String)> {
    let nullifier_idx = parse_index("GARAGA_NULLIFIER_PUBLIC_INPUT_INDEX", 0)?;
    let commitment_idx = parse_index("GARAGA_COMMITMENT_PUBLIC_INPUT_INDEX", 1)?;
    let required_len = std::cmp::max(nullifier_idx, commitment_idx) + 1;
    if public_inputs.len() < required_len {
        return Err(anyhow!(
            "public_inputs too short to bind nullifier/commitment: len={}, required>={}, nullifier_idx={}, commitment_idx={}",
            public_inputs.len(),
            required_len,
            nullifier_idx,
            commitment_idx
        ));
    }
    let nullifier = to_hex_felt_from_str(&public_inputs[nullifier_idx])?;
    let commitment = to_hex_felt_from_str(&public_inputs[commitment_idx])?;
    Ok((nullifier, commitment))
}

fn parse_index(name: &str, default: usize) -> Result<usize> {
    let raw = getenv_clean(name);
    let value = if raw.is_empty() {
        default
    } else {
        raw.parse::<i64>()
            .map_err(|_| anyhow!("Invalid integer env {name}={raw:?}"))?
            .try_into()
            .map_err(|_| anyhow!("{name} must be >= 0"))?
    };
    Ok(value)
}

fn sort_json_value(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut sorted: BTreeMap<String, Value> = BTreeMap::new();
            for (key, value) in map {
                sorted.insert(key.clone(), sort_json_value(value));
            }
            let mut new_map = Map::new();
            for (key, value) in sorted {
                new_map.insert(key, value);
            }
            Value::Object(new_map)
        }
        Value::Array(values) => Value::Array(values.iter().map(sort_json_value).collect()),
        _ => value.clone(),
    }
}

fn to_hex_felt_from_bytes(bytes: &[u8]) -> Result<String> {
    let value = BigUint::from_bytes_be(bytes);
    Ok(format!("0x{:x}", value % starknet_prime()))
}

fn to_hex_felt_from_str(raw: &str) -> Result<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("Empty felt string encountered"));
    }
    let value = if trimmed.starts_with("0x") || trimmed.starts_with("0X") {
        let digits = trimmed.trim_start_matches("0x").trim_start_matches("0X");
        BigUint::parse_bytes(digits.as_bytes(), 16)
            .ok_or_else(|| anyhow!("Invalid hex felt: {raw}"))?
    } else {
        BigUint::parse_bytes(trimmed.as_bytes(), 10)
            .ok_or_else(|| anyhow!("Invalid decimal felt: {raw}"))?
    };
    Ok(format!("0x{:x}", value % starknet_prime()))
}

fn to_hex_felt_from_value(value: &Value) -> Result<String> {
    match value {
        Value::String(raw) => to_hex_felt_from_str(raw),
        Value::Number(raw) => to_hex_felt_from_str(&raw.to_string()),
        Value::Bool(raw) => to_hex_felt_from_str(&raw.to_string()),
        _ => Err(anyhow!(
            "Unsupported felt type: {}",
            value.as_object().map(|_| "object").unwrap_or("unknown")
        )),
    }
}

fn parse_json_array_file(path: &Path, expected_key: Option<&str>) -> Result<Vec<String>> {
    let raw = fs::read_to_string(path)
        .with_context(|| format!("File not found or unreadable: {}", path.display()))?;
    let value: Value = serde_json::from_str(&raw)
        .with_context(|| format!("Invalid JSON in {}", path.display()))?;
    let payload = if let Value::Array(values) = value {
        Value::Array(values)
    } else if let Value::Object(map) = value {
        if let Some(key) = expected_key {
            map.get(key).cloned().unwrap_or(Value::Null)
        } else if let Some(value) = map.get("public_inputs") {
            value.clone()
        } else if let Some(value) = map.get("proof") {
            value.clone()
        } else {
            return Err(anyhow!(
                "JSON object in {} does not contain expected array field",
                path.display()
            ));
        }
    } else {
        return Err(anyhow!(
            "JSON in {} must be array or object",
            path.display()
        ));
    };

    let Value::Array(values) = payload else {
        return Err(anyhow!("Array in {} is empty or invalid", path.display()));
    };
    if values.is_empty() {
        return Err(anyhow!("Array in {} is empty or invalid", path.display()));
    }
    values
        .iter()
        .map(to_hex_felt_from_value)
        .collect::<Result<Vec<String>>>()
}

fn value_to_raw_string(value: &Value) -> Result<String> {
    match value {
        Value::String(raw) => Ok(raw.trim().to_string()),
        Value::Number(raw) => Ok(raw.to_string()),
        Value::Bool(raw) => Ok(raw.to_string()),
        _ => Err(anyhow!(
            "Unsupported numeric type: {}",
            value.as_object().map(|_| "object").unwrap_or("unknown")
        )),
    }
}

fn parse_json_array_file_raw(path: &Path, expected_key: Option<&str>) -> Result<Vec<String>> {
    let raw = fs::read_to_string(path)
        .with_context(|| format!("File not found or unreadable: {}", path.display()))?;
    let value: Value = serde_json::from_str(&raw)
        .with_context(|| format!("Invalid JSON in {}", path.display()))?;
    let payload = if let Value::Array(values) = value {
        Value::Array(values)
    } else if let Value::Object(map) = value {
        if let Some(key) = expected_key {
            map.get(key).cloned().unwrap_or(Value::Null)
        } else if let Some(value) = map.get("public_inputs") {
            value.clone()
        } else if let Some(value) = map.get("proof") {
            value.clone()
        } else {
            return Err(anyhow!(
                "JSON object in {} does not contain expected array field",
                path.display()
            ));
        }
    } else {
        return Err(anyhow!(
            "JSON in {} must be array or object",
            path.display()
        ));
    };

    let Value::Array(values) = payload else {
        return Err(anyhow!("Array in {} is empty or invalid", path.display()));
    };
    if values.is_empty() {
        return Err(anyhow!("Array in {} is empty or invalid", path.display()));
    }
    values.iter().map(value_to_raw_string).collect()
}

fn looks_like_groth16_proof(value: &Map<String, Value>) -> bool {
    let keys: Vec<String> = value.keys().map(|key| key.to_ascii_lowercase()).collect();
    let has_a = keys
        .iter()
        .any(|key| matches!(key.as_str(), "a" | "pi_a" | "ar"));
    let has_b = keys
        .iter()
        .any(|key| matches!(key.as_str(), "b" | "pi_b" | "bs"));
    let has_c = keys
        .iter()
        .any(|key| matches!(key.as_str(), "c" | "pi_c" | "krs"));
    has_a && has_b && has_c
}

fn validate_proof_json_file(path: &Path) -> Result<()> {
    let raw = fs::read_to_string(path)
        .with_context(|| format!("File not found or unreadable: {}", path.display()))?;
    let value: Value = serde_json::from_str(&raw)
        .with_context(|| format!("Invalid JSON in {}", path.display()))?;

    match value {
        Value::Array(values) if !values.is_empty() => Ok(()),
        Value::Object(map) => {
            if let Some(Value::Array(values)) = map.get("proof") {
                if !values.is_empty() {
                    return Ok(());
                }
            }
            if looks_like_groth16_proof(&map) {
                return Ok(());
            }
            if let Some(Value::Object(inner)) = map.get("proof") {
                if looks_like_groth16_proof(inner) {
                    return Ok(());
                }
            }
            Err(anyhow!(
                "Unsupported proof JSON format. Expected felt-array format or a Groth16 proof object (snarkjs/gnark style). file={}",
                path.display()
            ))
        }
        _ => Err(anyhow!(
            "Unsupported proof JSON format. Expected felt-array format or a Groth16 proof object (snarkjs/gnark style). file={}",
            path.display()
        )),
    }
}

fn resolve_public_inputs(
    public_inputs_path: Option<&Path>,
    proof_path: &Path,
) -> Result<Vec<String>> {
    if let Some(path) = public_inputs_path {
        return parse_json_array_file_raw(path, Some("public_inputs"));
    }
    parse_json_array_file_raw(proof_path, Some("public_inputs")).map_err(|_| {
        anyhow!(
            "public_inputs not found. Set GARAGA_PUBLIC_INPUTS_PATH, or include public_inputs inside proof JSON."
        )
    })
}

fn to_hex_felt_vec(values: &[String]) -> Result<Vec<String>> {
    values
        .iter()
        .map(|value| to_hex_felt_from_str(value))
        .collect()
}

fn read_vk_n_public(path: &Path) -> Option<u64> {
    if !path.is_file() {
        return None;
    }
    let raw = fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    let map = value.as_object()?;
    match map.get("nPublic")? {
        Value::Number(value) => value.as_u64(),
        Value::String(value) => value.trim().parse::<u64>().ok(),
        _ => None,
    }
}

fn resolve_vk_path(vk_raw: &str, public_inputs: &[String]) -> Result<PathBuf> {
    let expected_n_public = public_inputs.len() as u64;
    let mut candidates: Vec<PathBuf> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    let mut add_candidate = |raw_path: &str| {
        if raw_path.is_empty() {
            return;
        }
        let path = PathBuf::from(raw_path).expand();
        let key = if path.exists() {
            path.canonicalize()
                .unwrap_or(path.clone())
                .to_string_lossy()
                .to_string()
        } else {
            path.to_string_lossy().to_string()
        };
        if seen.insert(key) {
            candidates.push(path);
        }
    };

    add_candidate(vk_raw);
    add_candidate("./garaga_vk.json");
    add_candidate("backend-rust/garaga_vk.json");
    add_candidate("/app/garaga_vk.json");

    let mut matching: Vec<(PathBuf, u64)> = Vec::new();
    let mut mismatched: Vec<(PathBuf, Option<u64>)> = Vec::new();
    for candidate in candidates {
        let n_public = read_vk_n_public(&candidate);
        if n_public == Some(expected_n_public) {
            matching.push((candidate, expected_n_public));
        } else {
            mismatched.push((candidate, n_public));
        }
    }

    if let Some((selected, _)) = matching.first() {
        return Ok(selected.clone());
    }

    let env_path = if vk_raw.is_empty() {
        None
    } else {
        Some(PathBuf::from(vk_raw).expand())
    };
    let env_n_public = env_path.as_ref().and_then(|path| read_vk_n_public(path));
    let mismatch_detail = mismatched
        .iter()
        .map(|(path, n_public)| {
            format!(
                "{}:{}",
                path.display(),
                n_public
                    .map(|value| format!("nPublic={value}"))
                    .unwrap_or_else(|| "missing".to_string())
            )
        })
        .collect::<Vec<String>>()
        .join(", ");
    if let Some(path) = env_path {
        return Err(anyhow!(
            "GARAGA_VK_PATH/public_inputs mismatch. selected_env={}, env_nPublic={:?}, prover_public_inputs_len={}. This causes 'scalars and points length mismatch'. Checked candidates: {}",
            path.display(),
            env_n_public,
            expected_n_public,
            mismatch_detail
        ));
    }

    Err(anyhow!(
        "No compatible Garaga VK found for current prover output. prover_public_inputs_len={}. Checked candidates: {}",
        expected_n_public,
        mismatch_detail
    ))
}

fn resolve_honk_vk_path(flow: &str) -> Result<PathBuf> {
    let flow_key = match flow {
        "swap" | "bridge" => "GARAGA_HONK_VK_PATH_SWAP",
        "limit" | "limit_order" | "limit-order" => "GARAGA_HONK_VK_PATH_LIMIT",
        "stake" => "GARAGA_HONK_VK_PATH_STAKE",
        "btc" | "shadow_btc" | "shadow-btc" => "GARAGA_HONK_VK_PATH_BTC",
        _ => "GARAGA_HONK_VK_PATH",
    };

    let mut candidates: Vec<PathBuf> = Vec::new();
    for key in [flow_key, "GARAGA_HONK_VK_PATH", "GARAGA_VK_PATH"] {
        let raw = getenv_clean(key);
        if raw.is_empty() {
            continue;
        }
        candidates.push(PathBuf::from(raw).expand());
    }

    for path in candidates.iter() {
        if path.is_file() {
            return Ok(path.clone());
        }
    }

    Err(anyhow!(
        "Missing Honk VK path. Set {} (or GARAGA_HONK_VK_PATH). Tried: {}",
        flow_key,
        candidates
            .iter()
            .map(|path| path.to_string_lossy())
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

fn parse_exec_command(cmd: &str) -> Result<(String, Vec<String>)> {
    let trimmed = cmd.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("Command is not configured"));
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
        return Err(anyhow!("Command has unclosed quote"));
    }
    if !current.is_empty() {
        parts.push(current);
    }
    if parts.is_empty() {
        return Err(anyhow!("Command is not configured"));
    }
    let binary = parts.remove(0);
    Ok((binary, parts))
}

fn substitute_env_vars(input: &str, replacements: &BTreeMap<String, String>) -> String {
    let mut output = input.to_string();
    for (key, value) in replacements.iter() {
        output = output.replace(&format!("${key}"), value);
        output = output.replace(&format!("${{{key}}}"), value);
    }
    output
}

fn generate_full_proof_with_hints_rust(
    vk_path: &Path,
    proof_path: &Path,
    public_inputs: &[String],
) -> Result<Vec<String>> {
    let vk_json = fs::read_to_string(vk_path)
        .with_context(|| format!("Failed to read VK JSON: {}", vk_path.display()))?;
    let proof_json = fs::read_to_string(proof_path)
        .with_context(|| format!("Failed to read proof JSON: {}", proof_path.display()))?;

    let vk_value: Value = serde_json::from_str(&vk_json)
        .with_context(|| format!("Invalid VK JSON: {}", vk_path.display()))?;
    let proof_value: Value = serde_json::from_str(&proof_json)
        .with_context(|| format!("Invalid proof JSON: {}", proof_path.display()))?;

    let vk_values = flatten_snarkjs_vk(&vk_value)?;
    let proof_values = flatten_snarkjs_proof(&proof_value, public_inputs)?;

    let vk = Groth16VerificationKey::from(vk_values);
    let proof = Groth16Proof::from(proof_values, None, None);

    let calldata = get_groth16_calldata(&proof, &vk, CurveID::BLS12_381)
        .map_err(|err| anyhow!("Garaga calldata generation failed: {err}"))?;

    let mut hex_calldata = Vec::with_capacity(calldata.len());
    for felt in calldata {
        hex_calldata.push(format!("0x{}", felt.to_str_radix(16)));
    }
    Ok(hex_calldata)
}

fn biguint_to_hex(value: &BigUint) -> String {
    format!("0x{}", value.to_str_radix(16))
}

fn bytes_to_hex_words(bytes: &[u8]) -> Result<Vec<String>> {
    if bytes.len() % 32 != 0 {
        return Err(anyhow!(
            "public inputs length {} is not a multiple of 32",
            bytes.len()
        ));
    }
    Ok(bytes
        .chunks(32)
        .map(|chunk| biguint_to_hex(&BigUint::from_bytes_be(chunk)))
        .collect())
}

fn read_public_inputs_bytes(path: &Path) -> Result<Vec<u8>> {
    fs::read(path)
        .with_context(|| format!("Failed to read public inputs bytes: {}", path.display()))
}

fn generate_full_proof_with_hints_honk(
    vk_path: &Path,
    proof_path: &Path,
    public_inputs_bytes: &[u8],
) -> Result<Vec<String>> {
    let vk_bytes = fs::read(vk_path)
        .with_context(|| format!("Failed to read Honk VK bytes: {}", vk_path.display()))?;
    let proof_bytes = fs::read(proof_path)
        .with_context(|| format!("Failed to read Honk proof bytes: {}", proof_path.display()))?;
    let vk = HonkVerificationKey::from_bytes(&vk_bytes).map_err(|err| anyhow!(err))?;
    let proof = ZKHonkProof::from_bytes(&proof_bytes, public_inputs_bytes, vk.log_circuit_size)
        .map_err(|err| anyhow!(err))?;
    let calldata = normalize_zk_honk_proof_calldata(
        get_zk_honk_calldata(&proof, &vk).map_err(|err| anyhow!(err))?,
    );
    Ok(calldata
        .into_iter()
        .map(|item| biguint_to_hex(&item))
        .collect())
}

fn flatten_snarkjs_vk(value: &Value) -> Result<Vec<BigUint>> {
    let object = value
        .as_object()
        .ok_or_else(|| anyhow!("VK JSON must be an object"))?;
    let alpha = parse_snarkjs_g1(
        object
            .get("vk_alpha_1")
            .ok_or_else(|| anyhow!("VK JSON missing vk_alpha_1"))?,
        "vk_alpha_1",
    )?;
    let beta = parse_snarkjs_g2(
        object
            .get("vk_beta_2")
            .ok_or_else(|| anyhow!("VK JSON missing vk_beta_2"))?,
        "vk_beta_2",
    )?;
    let gamma = parse_snarkjs_g2(
        object
            .get("vk_gamma_2")
            .ok_or_else(|| anyhow!("VK JSON missing vk_gamma_2"))?,
        "vk_gamma_2",
    )?;
    let delta = parse_snarkjs_g2(
        object
            .get("vk_delta_2")
            .ok_or_else(|| anyhow!("VK JSON missing vk_delta_2"))?,
        "vk_delta_2",
    )?;
    let ic_values = object
        .get("IC")
        .ok_or_else(|| anyhow!("VK JSON missing IC"))?
        .as_array()
        .ok_or_else(|| anyhow!("VK JSON IC must be array"))?;

    let mut values = Vec::with_capacity(14 + ic_values.len() * 2);
    values.extend(alpha);
    values.extend(beta);
    values.extend(gamma);
    values.extend(delta);
    for (idx, entry) in ic_values.iter().enumerate() {
        let g1 = parse_snarkjs_g1(entry, &format!("IC[{idx}]"))?;
        values.extend(g1);
    }
    Ok(values)
}

fn flatten_snarkjs_proof(value: &Value, public_inputs: &[String]) -> Result<Vec<BigUint>> {
    if let Some(array) = value.as_array() {
        let mut values = Vec::with_capacity(array.len());
        for item in array {
            values.push(parse_biguint(item, "proof")?);
        }
        return Ok(values);
    }

    let object = value
        .as_object()
        .ok_or_else(|| anyhow!("Proof JSON must be object or array"))?;
    let proof_obj = if let Some(inner) = object.get("proof") {
        inner
    } else {
        value
    };
    let proof_object = proof_obj
        .as_object()
        .ok_or_else(|| anyhow!("Proof JSON missing proof object"))?;

    let a = parse_snarkjs_g1(
        proof_object
            .get("pi_a")
            .or_else(|| proof_object.get("a"))
            .ok_or_else(|| anyhow!("Proof JSON missing pi_a"))?,
        "pi_a",
    )?;
    let b = parse_snarkjs_g2(
        proof_object
            .get("pi_b")
            .or_else(|| proof_object.get("b"))
            .ok_or_else(|| anyhow!("Proof JSON missing pi_b"))?,
        "pi_b",
    )?;
    let c = parse_snarkjs_g1(
        proof_object
            .get("pi_c")
            .or_else(|| proof_object.get("c"))
            .ok_or_else(|| anyhow!("Proof JSON missing pi_c"))?,
        "pi_c",
    )?;

    let mut values = Vec::with_capacity(8 + public_inputs.len());
    values.extend(a);
    values.extend(b);
    values.extend(c);
    for (idx, input) in public_inputs.iter().enumerate() {
        values.push(parse_biguint_str(input, &format!("public_inputs[{idx}]"))?);
    }
    Ok(values)
}

fn parse_snarkjs_g1(value: &Value, label: &str) -> Result<[BigUint; 2]> {
    let array = value
        .as_array()
        .ok_or_else(|| anyhow!("{} must be an array", label))?;
    if array.len() < 2 {
        return Err(anyhow!("{} must have at least 2 elements", label));
    }
    let x = parse_biguint(&array[0], label)?;
    let y = parse_biguint(&array[1], label)?;
    Ok([x, y])
}

fn parse_snarkjs_g2(value: &Value, label: &str) -> Result<[BigUint; 4]> {
    let array = value
        .as_array()
        .ok_or_else(|| anyhow!("{} must be an array", label))?;
    if array.len() < 2 {
        return Err(anyhow!("{} must have at least 2 elements", label));
    }
    let x_pair = array[0]
        .as_array()
        .ok_or_else(|| anyhow!("{}[0] must be an array", label))?;
    let y_pair = array[1]
        .as_array()
        .ok_or_else(|| anyhow!("{}[1] must be an array", label))?;
    if x_pair.len() < 2 || y_pair.len() < 2 {
        return Err(anyhow!("{} must contain 2-limb pairs", label));
    }
    let x0 = parse_biguint(&x_pair[0], label)?;
    let x1 = parse_biguint(&x_pair[1], label)?;
    let y0 = parse_biguint(&y_pair[0], label)?;
    let y1 = parse_biguint(&y_pair[1], label)?;
    Ok([x0, x1, y0, y1])
}

fn parse_biguint(value: &Value, label: &str) -> Result<BigUint> {
    match value {
        Value::String(raw) => parse_biguint_str(raw, label),
        Value::Number(raw) => parse_biguint_str(&raw.to_string(), label),
        _ => Err(anyhow!("{} contains non-numeric value", label)),
    }
}

fn parse_biguint_str(raw: &str, label: &str) -> Result<BigUint> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("{} contains empty string", label));
    }
    let (digits, radix) = if trimmed.starts_with("0x") || trimmed.starts_with("0X") {
        (
            trimmed.trim_start_matches("0x").trim_start_matches("0X"),
            16,
        )
    } else {
        (trimmed, 10)
    };
    BigUint::from_str_radix(digits, radix)
        .map_err(|_| anyhow!("{} contains invalid numeric value", label))
}

async fn build_payload(stdin_payload: &Value) -> Result<GaragaPayload> {
    let system = getenv_clean("GARAGA_SYSTEM");
    let system = if system.is_empty() {
        "groth16".to_string()
    } else {
        system
    };
    let system_lower = system.to_ascii_lowercase();
    if system_lower != "groth16" && system_lower != "honk" && system_lower != "zk_honk" {
        return Err(anyhow!(
            "Unsupported GARAGA_SYSTEM '{}'. Supported: groth16 | honk",
            system
        ));
    }
    let timeout_secs = getenv_clean("GARAGA_TIMEOUT_SECS")
        .parse::<u64>()
        .unwrap_or(90);

    let vk_raw = getenv_clean("GARAGA_VK_PATH");
    let proof_raw = getenv_clean("GARAGA_PROOF_PATH");
    let mut proof_path = if proof_raw.is_empty() {
        PathBuf::from("/tmp/garaga_auto_prover/proof.json")
    } else {
        PathBuf::from(&proof_raw)
    };
    let public_inputs_raw = getenv_clean("GARAGA_PUBLIC_INPUTS_PATH");
    let mut public_inputs_path = if public_inputs_raw.is_empty() {
        None
    } else {
        Some(PathBuf::from(public_inputs_raw))
    };
    let tx_context = stdin_payload
        .get("tx_context")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let flow = tx_field(&tx_context, &["flow", "action_type"]).to_ascii_lowercase();
    let precomputed_payload_path = select_precomputed_payload_path(&flow);
    let allow_precomputed_payload = bool_env("GARAGA_ALLOW_PRECOMPUTED_PAYLOAD", false);
    let use_static_artifacts = bool_env("GARAGA_USE_STATIC_ARTIFACTS", false);
    let runtime_env = {
        let env_primary = getenv_clean("ENVIRONMENT");
        if !env_primary.is_empty() {
            env_primary
        } else {
            let env_secondary = getenv_clean("APP_ENV");
            if !env_secondary.is_empty() {
                env_secondary
            } else {
                getenv_clean("APP_MODE")
            }
        }
    };
    if precomputed_payload_path.is_some() && is_production_env(&runtime_env) {
        return Err(anyhow!(
            "GARAGA_PRECOMPUTED_PAYLOAD_PATH is blocked in production environments."
        ));
    }
    if precomputed_payload_path.is_some() && !allow_precomputed_payload {
        return Err(anyhow!(
            "GARAGA_PRECOMPUTED_PAYLOAD_PATH is disabled in strict mode. Set GARAGA_PROVE_CMD for real per-request prover, or explicitly set GARAGA_ALLOW_PRECOMPUTED_PAYLOAD=true for developer mode."
        ));
    }
    let precomputed_payload = maybe_load_precomputed_payload(precomputed_payload_path)?;

    let prove_cmd = getenv_clean("GARAGA_PROVE_CMD");
    if prove_cmd.is_empty() && precomputed_payload.is_none() && !use_static_artifacts {
        return Err(anyhow!(
            "Missing required env: GARAGA_PROVE_CMD. Real per-request prover is mandatory."
        ));
    }
    if proof_raw.is_empty() && precomputed_payload.is_none() && !use_static_artifacts {
        return Err(anyhow!("Missing required env: GARAGA_PROOF_PATH"));
    }
    let output_dir = {
        let raw = getenv_clean("GARAGA_OUTPUT_DIR");
        if raw.is_empty() {
            PathBuf::from("/tmp/garaga_auto_prover")
        } else {
            PathBuf::from(raw)
        }
    };
    let keep_temp_files = bool_env("GARAGA_KEEP_TEMP_FILES", false);

    let note_version = {
        let explicit = getenv_clean("GARAGA_NOTE_VERSION");
        if !explicit.is_empty() {
            explicit
        } else {
            let ctx = tx_field(&tx_context, &["note_version"]);
            if !ctx.is_empty() {
                ctx
            } else {
                let stdin_note = clean_optional_text(stdin_payload.get("note_version"));
                if !stdin_note.is_empty() {
                    stdin_note
                } else {
                    getenv_clean("HIDE_BALANCE_POOL_VERSION_DEFAULT")
                }
            }
        }
    }
    .trim()
    .to_ascii_lowercase();
    let note_version = if note_version.is_empty() {
        "v4".to_string()
    } else {
        note_version
    };
    if note_version != "v4" {
        return Err(anyhow!(
            "Unsupported note_version '{}'. Hide Balance V4 only.",
            note_version
        ));
    }
    let uses_root_binding = true;
    let use_honk = note_version == "v4" && bool_env("GARAGA_USE_HONK", system_lower != "groth16");
    let allow_statement_override = bool_env("GARAGA_ALLOW_STATEMENT_OVERRIDE", false);

    let mut request_temp_dir: Option<PathBuf> = None;
    let mut vk_path_used: Option<String> = None;
    let mut vk_n_public: Option<u64> = None;

    if !prove_cmd.is_empty() {
        fs::create_dir_all(&output_dir).ok();
        let mut rng = rand::rng();
        let mut suffix = [0u8; 8];
        rng.fill_bytes(&mut suffix);
        let dir_name = format!("garaga_req_{:x}", u64::from_be_bytes(suffix));
        let temp_dir = output_dir.join(dir_name);
        fs::create_dir_all(&temp_dir)?;
        proof_path = temp_dir.join("proof.json");
        public_inputs_path = Some(temp_dir.join("public_inputs.json"));
        request_temp_dir = Some(temp_dir);

        maybe_run_external_prover(
            &prove_cmd,
            stdin_payload,
            &output_dir,
            &proof_path,
            public_inputs_path.as_deref(),
            timeout_secs,
        )
        .await?;
    }

    let (proof, public_inputs) = if let Some((proof, public_inputs)) = precomputed_payload {
        (proof, public_inputs)
    } else if use_honk {
        let public_inputs_path = public_inputs_path
            .as_deref()
            .ok_or_else(|| anyhow!("Missing GARAGA_PUBLIC_INPUTS_PATH for Honk payload"))?;
        let public_inputs_bytes = read_public_inputs_bytes(public_inputs_path)?;
        let public_inputs = bytes_to_hex_words(&public_inputs_bytes)?;
        let vk_path = resolve_honk_vk_path(&flow)?;
        vk_path_used = Some(vk_path.to_string_lossy().to_string());
        let proof =
            generate_full_proof_with_hints_honk(&vk_path, &proof_path, &public_inputs_bytes)?;
        (proof, public_inputs)
    } else {
        let public_inputs_raw = resolve_public_inputs(public_inputs_path.as_deref(), &proof_path)?;
        let vk_path = resolve_vk_path(&vk_raw, &public_inputs_raw)?;
        vk_path_used = Some(vk_path.to_string_lossy().to_string());
        vk_n_public = read_vk_n_public(&vk_path);
        let proof = generate_full_proof_with_hints_rust(&vk_path, &proof_path, &public_inputs_raw)?;
        let public_inputs = to_hex_felt_vec(&public_inputs_raw)?;
        (proof, public_inputs)
    };

    let (intent_hash, nonce) = compute_intent_hash(stdin_payload)?;

    let mut root: Option<String> = None;
    let mut note_commitment: Option<String> = None;
    let mut denom_id: Option<String> = None;
    let mut spendable_at_unix: Option<u64> = None;

    let (nullifier, commitment, public_inputs) = if uses_root_binding {
        let root_idx = parse_index("GARAGA_ROOT_PUBLIC_INPUT_INDEX", 0)?;
        let nullifier_idx = if std::env::var("GARAGA_NULLIFIER_PUBLIC_INPUT_INDEX").is_ok() {
            parse_index("GARAGA_NULLIFIER_PUBLIC_INPUT_INDEX", 1)?
        } else {
            parse_index("GARAGA_NULLIFIER_PUBLIC_INPUT_INDEX_V3", 1)?
        };
        let legacy_compat = bool_env("HIDE_BALANCE_V3_LEGACY_VERIFIER_COMPAT", false);
        let action_hash_idx = parse_index("GARAGA_INTENT_HASH_PUBLIC_INPUT_INDEX", 2)?;
        let recipient_idx = parse_index("GARAGA_RECIPIENT_PUBLIC_INPUT_INDEX", 3)?;
        let chain_id_idx = parse_index("GARAGA_CHAIN_ID_PUBLIC_INPUT_INDEX", 4)?;
        let contract_idx = parse_index("GARAGA_CONTRACT_PUBLIC_INPUT_INDEX", 5)?;
        let mut required_len = if legacy_compat {
            std::cmp::max(root_idx, nullifier_idx) + 1
        } else {
            *[root_idx, nullifier_idx, action_hash_idx]
                .iter()
                .max()
                .unwrap_or(&0)
                + 1
        };
        if allow_statement_override {
            let max_idx = *[
                root_idx,
                nullifier_idx,
                action_hash_idx,
                recipient_idx,
                chain_id_idx,
                contract_idx,
            ]
            .iter()
            .max()
            .unwrap_or(&0);
            required_len = required_len.max(max_idx + 1);
        }
        if public_inputs.len() < required_len {
            if legacy_compat {
                return Err(anyhow!(
                    "public_inputs too short for root/nullifier binding in legacy mode: len={}, required>={}, root_idx={}, nullifier_idx={}",
                    public_inputs.len(),
                    required_len,
                    root_idx,
                    nullifier_idx
                ));
            }
            return Err(anyhow!(
                "public_inputs too short for verifier output: len={}, required>={}, expected at least root/nullifier/action_hash indexes (root_idx={}, nullifier_idx={}, action_hash_idx={}). Regenerate Garaga PK/VK and redeploy verifier.",
                public_inputs.len(),
                required_len,
                root_idx,
                nullifier_idx,
                action_hash_idx
            ));
        }
        let mut public_inputs = public_inputs;
        if allow_statement_override {
            let root_override = tx_field(&tx_context, &["root"]);
            let nullifier_override = tx_field(&tx_context, &["nullifier"]);
            let mut action_hash_override = tx_field(&tx_context, &["action_hash", "intent_hash"]);
            if action_hash_override.is_empty() {
                action_hash_override = intent_hash.clone();
            }
            if root_override.is_empty()
                || nullifier_override.is_empty()
                || action_hash_override.is_empty()
            {
                return Err(anyhow!(
                    "Missing tx_context root/nullifier/action_hash for V4 statement override"
                ));
            }
            public_inputs[root_idx] = to_hex_felt_from_str(&root_override)?;
            public_inputs[nullifier_idx] = to_hex_felt_from_str(&nullifier_override)?;
            public_inputs[action_hash_idx] = to_hex_felt_from_str(&action_hash_override)?;

            let recipient_override = tx_field(&tx_context, &["recipient"]);
            if recipient_override.is_empty() {
                return Err(anyhow!(
                    "Missing tx_context recipient for V4 statement override"
                ));
            }
            public_inputs[recipient_idx] = to_hex_felt_from_str(&recipient_override)?;

            let chain_id_override = resolve_chain_id_felt(&tx_context)
                .ok_or_else(|| anyhow!("Missing chain_id for V4 statement override"))?;
            public_inputs[chain_id_idx] = to_hex_felt_from_str(&chain_id_override)?;

            let contract_override = resolve_contract_address(&tx_context)
                .ok_or_else(|| anyhow!("Missing contract_address for V4 statement override"))?;
            public_inputs[contract_idx] = to_hex_felt_from_str(&contract_override)?;
        }
        let payload_root = to_hex_felt_from_str(&public_inputs[root_idx])?;
        let payload_nullifier = to_hex_felt_from_str(&public_inputs[nullifier_idx])?;
        let seed = format!(
            "{}|{}|{}|{}",
            payload_root, payload_nullifier, intent_hash, nonce
        );
        let commitment_hash = Sha256::digest(seed.as_bytes());
        let commitment = to_hex_felt_from_bytes(&commitment_hash)?;
        root = Some(payload_root.clone());
        let note_commitment_raw = tx_field(&tx_context, &["note_commitment"]);
        note_commitment = if note_commitment_raw.is_empty() {
            Some(commitment.clone())
        } else {
            Some(note_commitment_raw)
        };
        let denom_raw = tx_field(&tx_context, &["denom_id"]);
        if !denom_raw.is_empty() {
            denom_id = Some(denom_raw);
        } else {
            let env_denom = getenv_clean("GARAGA_DENOM_ID");
            if !env_denom.is_empty() {
                denom_id = Some(env_denom);
            }
        }
        let spendable_raw = tx_field(&tx_context, &["spendable_at_unix"]);
        if !spendable_raw.is_empty() {
            spendable_at_unix = spendable_raw.parse::<u64>().ok();
        } else {
            let env_spendable = getenv_clean("GARAGA_SPENDABLE_AT_UNIX");
            if !env_spendable.is_empty() {
                spendable_at_unix = env_spendable.parse::<u64>().ok();
            }
        }
        (payload_nullifier, commitment, public_inputs)
    } else if bool_env("GARAGA_DYNAMIC_BINDING", false) {
        let (nullifier, commitment) = make_dynamic_binding(stdin_payload, &intent_hash, &nonce)?;
        let public_inputs = apply_binding_to_public_inputs(public_inputs, &nullifier, &commitment)?;
        (nullifier, commitment, public_inputs)
    } else {
        let (nullifier, commitment) = bind_nullifier_commitment_from_public_inputs(&public_inputs)?;
        (nullifier, commitment, public_inputs)
    };

    if let Some(temp_dir) = request_temp_dir {
        if !keep_temp_files {
            let _ = fs::remove_dir_all(temp_dir);
        }
    }

    let mut payload = GaragaPayload {
        nullifier,
        commitment,
        intent_hash,
        proof,
        public_inputs,
        note_version: None,
        root,
        note_commitment,
        denom_id,
        spendable_at_unix,
        vk_path_used,
        vk_n_public,
    };
    if uses_root_binding {
        payload.note_version = Some(note_version.to_string());
    }
    Ok(payload)
}

fn maybe_load_precomputed_payload(
    path: Option<PathBuf>,
) -> Result<Option<(Vec<String>, Vec<String>)>> {
    let Some(path) = path else {
        return Ok(None);
    };
    let proof = parse_json_array_file(&path, Some("proof"))?;
    let public_inputs = parse_json_array_file(&path, Some("public_inputs"))?;
    Ok(Some((proof, public_inputs)))
}

async fn maybe_run_external_prover(
    prove_cmd: &str,
    stdin_payload: &Value,
    output_dir: &Path,
    proof_path: &Path,
    public_inputs_path: Option<&Path>,
    timeout_secs: u64,
) -> Result<()> {
    if prove_cmd.trim().is_empty() {
        return Ok(());
    }

    let context_path = write_temp_context(stdin_payload, output_dir)?;
    let mut env_values: BTreeMap<String, String> = BTreeMap::new();
    env_values.insert(
        "GARAGA_CONTEXT_PATH".to_string(),
        context_path.to_string_lossy().to_string(),
    );
    env_values.insert(
        "GARAGA_OUTPUT_DIR".to_string(),
        output_dir.to_string_lossy().to_string(),
    );
    env_values.insert(
        "GARAGA_PROOF_PATH".to_string(),
        proof_path.to_string_lossy().to_string(),
    );
    env_values.insert("GARAGA_QUEUE_SKIP".to_string(), "1".to_string());
    if let Some(path) = public_inputs_path {
        env_values.insert(
            "GARAGA_PUBLIC_INPUTS_PATH".to_string(),
            path.to_string_lossy().to_string(),
        );
    }

    let lease = if !bool_env("GARAGA_QUEUE_SKIP", false) {
        Some(acquire_prover_queue_slot(timeout_secs).await?)
    } else {
        None
    };

    let (binary, args) = parse_exec_command(prove_cmd)?;
    let args = args
        .into_iter()
        .map(|arg| substitute_env_vars(&arg, &env_values))
        .collect::<Vec<String>>();

    let mut command = Command::new(binary);
    command.kill_on_drop(true).args(args);
    for (key, value) in env_values.iter() {
        command.env(key, value);
    }

    let child = command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .context("Failed to spawn GARAGA_PROVE_CMD")?;

    let output_result =
        tokio::time::timeout(Duration::from_secs(timeout_secs), child.wait_with_output()).await;

    if let Some(lease) = &lease {
        lease.release().await;
    }

    let output = output_result
        .map_err(|_| anyhow!("Command timeout ({timeout_secs}s): GARAGA_PROVE_CMD"))??;

    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let diagnosis = diagnose_prover_failure(&stdout, &stderr)
            .map(|detail| format!("\nDiagnosis:\n{detail}\n"))
            .unwrap_or_default();
        return Err(anyhow!(
            "GARAGA_PROVE_CMD failed. stdout:\n{stdout}\nstderr:\n{stderr}{diagnosis}"
        ));
    }
    Ok(())
}

fn write_temp_context(stdin_payload: &Value, output_dir: &Path) -> Result<PathBuf> {
    fs::create_dir_all(output_dir).ok();
    let mut rng = rand::rng();
    let mut suffix = [0u8; 8];
    rng.fill_bytes(&mut suffix);
    let filename = format!("garaga_context_{:x}.json", u64::from_be_bytes(suffix));
    let path = output_dir.join(filename);
    let data = serde_json::to_vec(stdin_payload)?;
    fs::write(&path, data)?;
    Ok(path)
}

async fn run_warmup_mode() -> Result<()> {
    let system = getenv_clean("GARAGA_SYSTEM");
    let system = if system.is_empty() {
        "groth16".to_string()
    } else {
        system
    };
    if system.to_ascii_lowercase() != "groth16" {
        return Err(anyhow!(
            "Unsupported GARAGA_SYSTEM '{}'. Only groth16 is supported.",
            system
        ));
    }
    let vk_raw = getenv_required("GARAGA_VK_PATH")?;
    let proof_path = PathBuf::from(getenv_required("GARAGA_PROOF_PATH")?);
    let public_inputs_raw = getenv_clean("GARAGA_PUBLIC_INPUTS_PATH");
    let public_inputs_path = if public_inputs_raw.is_empty() {
        None
    } else {
        Some(PathBuf::from(public_inputs_raw))
    };
    let note_version = {
        let raw = getenv_clean("GARAGA_NOTE_VERSION");
        if !raw.is_empty() {
            raw
        } else {
            getenv_clean("HIDE_BALANCE_POOL_VERSION_DEFAULT")
        }
    }
    .trim()
    .to_ascii_lowercase();
    if !note_version.is_empty() && note_version != "v4" {
        return Err(anyhow!(
            "Unsupported note_version '{}'. Hide Balance V4 only.",
            note_version
        ));
    }

    validate_proof_json_file(&proof_path)?;
    let public_inputs = resolve_public_inputs(public_inputs_path.as_deref(), &proof_path)?;
    let vk_path = resolve_vk_path(&vk_raw, &public_inputs)?;

    let calldata = generate_full_proof_with_hints_rust(&vk_path, &proof_path, &public_inputs)?;
    let response = serde_json::json!({
        "ok": true,
        "warmed": true,
        "proof_len": calldata.len()
    });
    println!("{}", response.to_string());
    Ok(())
}

async fn run_test_mode() -> Result<()> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_secs();
    let sample_a = serde_json::json!({
        "user_address": "0x111",
        "verifier": "garaga",
        "requested_at_unix": now,
        "tx_context": {
            "flow": "swap",
            "from_token": "USDC",
            "to_token": "ETH",
            "amount": "100",
            "nonce": "n1"
        }
    });
    let sample_b = serde_json::json!({
        "user_address": "0x222",
        "verifier": "garaga",
        "requested_at_unix": now + 1,
        "tx_context": {
            "flow": "swap",
            "from_token": "USDC",
            "to_token": "ETH",
            "amount": "101",
            "nonce": "n2"
        }
    });

    let payload_a = build_payload(&sample_a).await?;
    let payload_b = build_payload(&sample_b).await?;
    if payload_a.proof == payload_b.proof {
        return Err(anyhow!(
            "Static proof detected in --test mode: proof arrays are identical for different inputs."
        ));
    }
    let proof_a_json = serde_json::to_string(&payload_a.proof)?;
    let proof_b_json = serde_json::to_string(&payload_b.proof)?;
    let proof_a_sha = Sha256::digest(proof_a_json.as_bytes());
    let proof_b_sha = Sha256::digest(proof_b_json.as_bytes());
    let response = serde_json::json!({
        "ok": true,
        "proof_a_len": payload_a.proof.len(),
        "proof_b_len": payload_b.proof.len(),
        "proof_a_sha256": hex::encode(proof_a_sha),
        "proof_b_sha256": hex::encode(proof_b_sha)
    });
    println!("{}", response.to_string());
    Ok(())
}

async fn run_prove_mode() -> Result<()> {
    let real_cmd_raw = getenv_clean("GARAGA_REAL_PROVER_CMD");
    if real_cmd_raw.is_empty() {
        return Err(anyhow!(
            "Missing GARAGA_REAL_PROVER_CMD for --prove mode. Configure real prover command to generate fresh proof files per request."
        ));
    }
    let mut real_cmd = resolve_real_prover_cmd(&real_cmd_raw)?;
    let context_raw = getenv_clean("GARAGA_CONTEXT_PATH");
    let proof_path = PathBuf::from(getenv_required("GARAGA_PROOF_PATH")?);
    let public_inputs_path = PathBuf::from(getenv_required("GARAGA_PUBLIC_INPUTS_PATH")?);
    if let Some(parent) = proof_path.parent() {
        fs::create_dir_all(parent).ok();
    }
    if let Some(parent) = public_inputs_path.parent() {
        fs::create_dir_all(parent).ok();
    }

    let mut replacements: BTreeMap<String, String> = BTreeMap::new();
    replacements.insert("GARAGA_CONTEXT_PATH".to_string(), context_raw.clone());
    replacements.insert(
        "GARAGA_PROOF_PATH".to_string(),
        proof_path.to_string_lossy().to_string(),
    );
    replacements.insert(
        "GARAGA_PUBLIC_INPUTS_PATH".to_string(),
        public_inputs_path.to_string_lossy().to_string(),
    );
    real_cmd = substitute_env_vars(&real_cmd, &replacements);

    let timeout_secs = getenv_clean("GARAGA_REAL_PROVER_TIMEOUT_SECS")
        .parse::<u64>()
        .unwrap_or(45);
    let (binary, args) = parse_exec_command(&real_cmd)?;
    let output = tokio::time::timeout(
        Duration::from_secs(timeout_secs),
        Command::new(binary).args(args).output(),
    )
    .await
    .map_err(|_| anyhow!("Command timeout ({timeout_secs}s): GARAGA_REAL_PROVER_CMD"))??;

    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!(
            "GARAGA_REAL_PROVER_CMD failed. stdout:\n{stdout}\nstderr:\n{stderr}"
        ));
    }

    if !proof_path.is_file() || !public_inputs_path.is_file() {
        return Err(anyhow!(
            "GARAGA_REAL_PROVER_CMD succeeded but output files are missing. expected_proof={} expected_public_inputs={}",
            proof_path.display(),
            public_inputs_path.display()
        ));
    }

    validate_proof_json_file(&proof_path)?;
    let _ = parse_json_array_file(&public_inputs_path, Some("public_inputs"))?;
    let response = serde_json::json!({"ok": true});
    println!("{}", response.to_string());
    Ok(())
}

fn resolve_real_prover_cmd(raw_cmd: &str) -> Result<String> {
    let cmd = raw_cmd.trim().to_string();
    if cmd.is_empty() {
        return Ok(cmd);
    }
    if cmd.contains("prove.py") {
        return Err(anyhow!(
            "GARAGA_REAL_PROVER_CMD points to prove.py, which is deprecated. Use a Noir prover wrapper instead."
        ));
    }
    Ok(cmd)
}

fn diagnose_prover_failure(stdout: &str, stderr: &str) -> Option<String> {
    let haystack = format!("{stdout}\n{stderr}");
    let saw_constraint_failure = haystack.contains("Cannot satisfy constraint")
        || haystack.contains("Failed to solve program");
    let saw_nullifier_assert = haystack.contains("computed_nullifier == nullifier");
    let saw_root_assert = haystack.contains("computed_root == merkle_root");

    if saw_constraint_failure && (saw_nullifier_assert || saw_root_assert) {
        return Some(
            "Detected Hide Mode witness mismatch: prover gagal memenuhi constraint nullifier/root. \
Periksa note witness, merkle path, root, dan public inputs yang dipakai untuk payload ini."
                .to_string(),
        );
    }

    None
}

struct RedisQueueLease {
    redis_url: Option<String>,
    key: String,
    acquired: bool,
}

impl RedisQueueLease {
    async fn release(&self) {
        if !self.acquired {
            return;
        }
        let Some(redis_url) = self.redis_url.as_ref() else {
            return;
        };
        if let Ok(client) = redis::Client::open(redis_url.as_str()) {
            if let Ok(mut conn) = client.get_connection_manager().await {
                let current: redis::RedisResult<i64> = conn.decr(&self.key, 1).await;
                if let Ok(current) = current {
                    if current <= 0 {
                        let _: redis::RedisResult<i32> = conn.del(&self.key).await;
                    }
                }
            }
        }
    }
}

async fn acquire_prover_queue_slot(job_timeout_secs: u64) -> Result<RedisQueueLease> {
    let redis_url = getenv_clean("GARAGA_REDIS_URL");
    let redis_url = if redis_url.is_empty() {
        getenv_clean("REDIS_URL")
    } else {
        redis_url
    };
    let fail_open = bool_env("GARAGA_PROVER_QUEUE_FAIL_OPEN", true);
    if redis_url.is_empty() {
        if fail_open {
            eprintln!(
                "[garaga-auto-prover] Redis queue disabled: REDIS_URL/GARAGA_REDIS_URL not set; continuing prover without queue lock."
            );
            return Ok(RedisQueueLease {
                redis_url: None,
                key: String::new(),
                acquired: false,
            });
        }
        return Err(anyhow!(
            "Missing REDIS_URL (or GARAGA_REDIS_URL) for Garaga prover Redis queue."
        ));
    }

    let max_concurrent = getenv_clean("GARAGA_PROVER_MAX_CONCURRENT")
        .parse::<i64>()
        .unwrap_or(2);
    let queue_timeout_secs = getenv_clean("GARAGA_PROVER_QUEUE_TIMEOUT_SECS")
        .parse::<u64>()
        .unwrap_or(30);
    let slot_ttl_default = std::cmp::max(job_timeout_secs + 30, 60);
    let slot_ttl_secs = getenv_clean("GARAGA_PROVER_QUEUE_SLOT_TTL_SECS")
        .parse::<u64>()
        .unwrap_or(slot_ttl_default);
    let key = getenv_clean("GARAGA_PROVER_QUEUE_KEY");
    let key = if key.is_empty() {
        "garaga:prover:active".to_string()
    } else {
        key
    };

    let client = match redis::Client::open(redis_url.as_str())
        .with_context(|| format!("Failed to connect to Redis at {redis_url}"))
    {
        Ok(client) => client,
        Err(err) => {
            if fail_open {
                eprintln!(
                    "[garaga-auto-prover] Redis queue unavailable ({err}); continuing prover without queue lock."
                );
                return Ok(RedisQueueLease {
                    redis_url: None,
                    key: String::new(),
                    acquired: false,
                });
            }
            return Err(err.into());
        }
    };
    let mut conn = match client.get_connection_manager().await {
        Ok(conn) => conn,
        Err(err) => {
            if fail_open {
                eprintln!(
                    "[garaga-auto-prover] Redis queue unavailable ({err}); continuing prover without queue lock."
                );
                return Ok(RedisQueueLease {
                    redis_url: None,
                    key: String::new(),
                    acquired: false,
                });
            }
            return Err(err.into());
        }
    };

    let deadline = tokio::time::Instant::now() + Duration::from_secs(queue_timeout_secs);
    loop {
        let incr: redis::RedisResult<i64> = conn.incr(&key, 1).await;
        let current = match incr {
            Ok(current) => current,
            Err(err) => {
                if fail_open {
                    eprintln!(
                        "[garaga-auto-prover] Redis queue unavailable ({err}); continuing prover without queue lock."
                    );
                    return Ok(RedisQueueLease {
                        redis_url: None,
                        key: String::new(),
                        acquired: false,
                    });
                }
                return Err(err.into());
            }
        };

        let expire: redis::RedisResult<bool> = conn.expire(&key, slot_ttl_secs as i64).await;
        if expire.is_err() {
            let _: redis::RedisResult<i64> = conn.decr(&key, 1).await;
            if fail_open {
                eprintln!(
                    "[garaga-auto-prover] Redis queue EXPIRE failed; continuing prover without queue lock."
                );
                return Ok(RedisQueueLease {
                    redis_url: None,
                    key: String::new(),
                    acquired: false,
                });
            }
            return Err(anyhow!(
                "Redis queue EXPIRE failed while queue lock is mandatory."
            ));
        }

        if current <= max_concurrent {
            return Ok(RedisQueueLease {
                redis_url: Some(redis_url),
                key,
                acquired: true,
            });
        }

        let _: redis::RedisResult<i64> = conn.decr(&key, 1).await;
        if tokio::time::Instant::now() >= deadline {
            if fail_open {
                eprintln!(
                    "[garaga-auto-prover] Garaga prover queue timeout after {queue_timeout_secs}s (max concurrent={max_concurrent}); continuing prover without queue lock."
                );
                return Ok(RedisQueueLease {
                    redis_url: None,
                    key: String::new(),
                    acquired: false,
                });
            }
            return Err(anyhow!(
                "Garaga prover queue timeout after {queue_timeout_secs}s (max concurrent={max_concurrent})."
            ));
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
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

trait PathExpand {
    fn expand(self) -> PathBuf;
}

impl PathExpand for PathBuf {
    fn expand(self) -> PathBuf {
        if let Some(path) = self.to_str() {
            if let Some(rest) = path.strip_prefix("~") {
                if let Some(home) = env::var_os("HOME") {
                    let mut expanded = PathBuf::from(home);
                    if rest.starts_with('/') {
                        expanded.push(&rest[1..]);
                    } else if !rest.is_empty() {
                        expanded.push(rest);
                    }
                    return expanded;
                }
            }
        }
        self
    }
}
