use crate::{
    config::Config,
    error::{AppError, Result},
    services::onchain::{parse_felt, OnchainReader},
};
use starknet_core::types::{Felt, FunctionCall};
use starknet_core::utils::get_selector_from_name;
use starknet_crypto::{poseidon_hash_many, Felt as CryptoFelt};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone)]
pub struct PlanInfo {
    pub user: Felt,
    pub agent_id: Felt,
    pub operator: Felt,
    pub plan_hash: Felt,
    pub action_mask: u64,
    pub max_actions: u64,
    pub used_actions: u64,
    pub expires_at: u64,
    pub created_at: u64,
    pub status: u64,
}

// Internal helper that parses or transforms values for `parse_crypto_felt`.
fn parse_crypto_felt(value: &str) -> Result<CryptoFelt> {
    let trimmed = value.trim();
    let normalized = if trimmed.starts_with("0x") {
        trimmed.to_string()
    } else {
        format!("0x{trimmed}")
    };
    CryptoFelt::from_hex(&normalized)
        .map_err(|e| AppError::BadRequest(format!("Invalid felt value: {}", e)))
}

// Internal helper that parses or transforms values for `parse_crypto_chain_id`.
fn parse_crypto_chain_id(chain_id: &str) -> Result<CryptoFelt> {
    let trimmed = chain_id.trim();
    if trimmed.starts_with("0x") {
        return parse_crypto_felt(trimmed);
    }
    let hex = hex::encode(trimmed.as_bytes());
    CryptoFelt::from_hex(&format!("0x{hex}"))
        .map_err(|e| AppError::BadRequest(format!("Invalid chain_id: {}", e)))
}

// Internal helper that parses or transforms values for `parse_felt_u64`.
fn parse_felt_u64(value: &str) -> Option<u64> {
    if let Some(stripped) = value.strip_prefix("0x") {
        u64::from_str_radix(stripped, 16).ok()
    } else {
        value.parse::<u64>().ok()
    }
}

// Internal helper that supports `felt_to_u64` operations.
fn felt_to_u64(value: &Felt, label: &str) -> Result<u64> {
    let raw = format!("{:#x}", value);
    parse_felt_u64(&raw)
        .ok_or_else(|| AppError::BadRequest(format!("Invalid {} (expected u64)", label)))
}

pub fn compute_plan_payload_hash(
    action_mask: u64,
    max_actions: u64,
    expires_at: u64,
) -> CryptoFelt {
    let fields = vec![
        CryptoFelt::from(action_mask),
        CryptoFelt::from(max_actions),
        CryptoFelt::from(expires_at),
        CryptoFelt::from(1_u64), // plan version
    ];
    poseidon_hash_many(&fields)
}

pub fn compute_plan_message_hash(
    chain_id: &str,
    plan_router_address: &str,
    user_address: &str,
    agent_id: &str,
    operator: &str,
    plan_hash: CryptoFelt,
    action_mask: u64,
    max_actions: u64,
    expires_at: u64,
    nonce: u64,
) -> Result<CryptoFelt> {
    let chain_id_felt = parse_crypto_chain_id(chain_id)?;
    let plan_router_felt = parse_crypto_felt(plan_router_address)?;
    let user_felt = parse_crypto_felt(user_address)?;
    let agent_felt = parse_crypto_felt(agent_id)?;
    let operator_felt = parse_crypto_felt(operator)?;
    let fields = vec![
        chain_id_felt,
        plan_router_felt,
        user_felt,
        agent_felt,
        operator_felt,
        plan_hash,
        CryptoFelt::from(action_mask),
        CryptoFelt::from(max_actions),
        CryptoFelt::from(expires_at),
        CryptoFelt::from(nonce),
    ];
    Ok(poseidon_hash_many(&fields))
}

pub async fn resolve_agent_operator(config: &Config, agent_id: &str) -> Result<Felt> {
    let registry = config
        .ai_identity_registry_address
        .as_ref()
        .ok_or_else(|| {
            AppError::BadRequest("AI identity registry is not configured".to_string())
        })?;
    let reader = OnchainReader::from_config(config)?;
    let selector = get_selector_from_name("get_agent")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let agent_felt = parse_felt(agent_id)?;
    let registry_felt = parse_felt(registry)?;
    let result = reader
        .call(FunctionCall {
            contract_address: registry_felt,
            entry_point_selector: selector,
            calldata: vec![agent_felt],
        })
        .await?;
    if result.len() < 6 {
        return Err(AppError::BadRequest(
            "ERC8004 identity registry returned incomplete agent data".to_string(),
        ));
    }
    let operator = result[1];
    let active = result[5];
    if active == Felt::ZERO {
        return Err(AppError::BadRequest("Agent is not active".to_string()));
    }
    if operator == Felt::ZERO {
        return Err(AppError::BadRequest(
            "Agent operator is not configured".to_string(),
        ));
    }
    Ok(operator)
}

pub async fn fetch_plan_info(config: &Config, plan_id: &str) -> Result<PlanInfo> {
    let plan_router = config
        .ai_plan_router_address
        .as_ref()
        .ok_or_else(|| AppError::BadRequest("AI plan router is not configured".to_string()))?;
    let reader = OnchainReader::from_config(config)?;
    let selector = get_selector_from_name("get_plan")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let plan_felt = parse_felt(plan_id)?;
    let router_felt = parse_felt(plan_router)?;
    let result = reader
        .call(FunctionCall {
            contract_address: router_felt,
            entry_point_selector: selector,
            calldata: vec![plan_felt],
        })
        .await?;
    if result.len() < 10 {
        return Err(AppError::BadRequest(
            "Plan lookup returned incomplete data".to_string(),
        ));
    }
    let user = result[0];
    let agent_id = result[1];
    let operator = result[2];
    let plan_hash = result[3];
    let action_mask = felt_to_u64(&result[4], "action_mask")?;
    let max_actions = felt_to_u64(&result[5], "max_actions")?;
    let used_actions = felt_to_u64(&result[6], "used_actions")?;
    let expires_at = felt_to_u64(&result[7], "expires_at")?;
    let created_at = felt_to_u64(&result[8], "created_at")?;
    let status = felt_to_u64(&result[9], "status")?;

    Ok(PlanInfo {
        user,
        agent_id,
        operator,
        plan_hash,
        action_mask,
        max_actions,
        used_actions,
        expires_at,
        created_at,
        status,
    })
}

pub async fn ensure_plan_active_for_user(
    config: &Config,
    plan_id: &str,
    user_address: &str,
) -> Result<PlanInfo> {
    let plan = fetch_plan_info(config, plan_id).await?;
    let user_felt = parse_felt(user_address)?;
    if plan.user != user_felt {
        return Err(AppError::BadRequest(
            "Plan owner does not match authenticated user".to_string(),
        ));
    }
    if plan.status != 0 {
        return Err(AppError::BadRequest("Plan is not active".to_string()));
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    if plan.expires_at <= now {
        return Err(AppError::BadRequest("Plan expired".to_string()));
    }
    if plan.used_actions >= plan.max_actions {
        return Err(AppError::BadRequest("Plan exhausted".to_string()));
    }
    Ok(plan)
}

pub fn resolve_chain_id(config: &Config) -> Result<String> {
    let chain_id = config.starknet_chain_id.trim();
    if chain_id.is_empty() {
        return Ok("SN_SEPOLIA".to_string());
    }
    Ok(chain_id.to_string())
}
