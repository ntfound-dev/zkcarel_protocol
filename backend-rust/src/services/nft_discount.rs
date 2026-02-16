use crate::{
    config::Config,
    error::{AppError, Result},
    services::onchain::{felt_to_u128, parse_felt, u256_from_felts, OnchainInvoker, OnchainReader},
};
use starknet_core::types::{Call, FunctionCall};
use starknet_core::utils::get_selector_from_name;
use tokio::time::{timeout, Duration};

const DISCOUNT_READ_TIMEOUT_MS: u64 = 2_500;
const DISCOUNT_CONSUME_TIMEOUT_MS: u64 = 5_000;

fn discount_contract(config: &Config) -> Option<&str> {
    config
        .discount_soulbound_address
        .as_deref()
        .filter(|addr| !addr.trim().is_empty() && !addr.starts_with("0x0000"))
}

async fn active_discount_rate(config: &Config, user_address: &str) -> Result<f64> {
    let Some(contract) = discount_contract(config) else {
        return Ok(0.0);
    };

    let reader = OnchainReader::from_config(config)?;
    let call = FunctionCall {
        contract_address: parse_felt(contract)?,
        entry_point_selector: get_selector_from_name("has_active_discount")
            .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?,
        calldata: vec![parse_felt(user_address)?],
    };

    let result = timeout(
        Duration::from_millis(DISCOUNT_READ_TIMEOUT_MS),
        reader.call(call),
    )
    .await
    .map_err(|_| AppError::BlockchainRPC("NFT discount read timeout".to_string()))??;

    if result.len() < 3 {
        return Ok(0.0);
    }
    let active = felt_to_u128(&result[0]).unwrap_or(0) > 0;
    if !active {
        return Ok(0.0);
    }

    let discount = u256_from_felts(&result[1], &result[2]).unwrap_or(0) as f64;
    Ok(discount.max(0.0))
}

pub async fn consume_nft_usage_if_active(
    config: &Config,
    user_address: &str,
    action: &str,
) -> Result<Option<String>> {
    let Some(contract) = discount_contract(config) else {
        return Ok(None);
    };
    if parse_felt(user_address).is_err() {
        return Ok(None);
    }

    let active_discount = active_discount_rate(config, user_address).await?;
    if active_discount <= 0.0 {
        return Ok(None);
    }

    let Some(invoker) = OnchainInvoker::from_config(config)? else {
        return Ok(None);
    };

    let call = Call {
        to: parse_felt(contract)?,
        selector: get_selector_from_name("use_discount")
            .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?,
        calldata: vec![parse_felt(user_address)?],
    };

    let tx_hash = timeout(
        Duration::from_millis(DISCOUNT_CONSUME_TIMEOUT_MS),
        invoker.invoke(call),
    )
    .await
    .map_err(|_| AppError::BlockchainRPC("NFT discount consume timeout".to_string()))??;
    let tx_hash_text = tx_hash.to_string();
    tracing::info!(
        "nft_discount_usage_consumed action={} user={} discount={} tx_hash={}",
        action,
        user_address,
        active_discount,
        tx_hash_text
    );

    Ok(Some(tx_hash_text))
}
