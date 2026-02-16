use super::{require_starknet_user, require_user, AppState};
use crate::services::onchain::{
    felt_to_u128, parse_felt, u256_from_felts, OnchainInvoker, OnchainReader,
};
use crate::services::privacy_verifier::{
    parse_privacy_verifier_kind, resolve_privacy_router_for_verifier, PrivacyVerifierKind,
};
use crate::{
    constants::{token_address_for, CONTRACT_SWAP_AGGREGATOR, DEX_EKUBO, DEX_HAIKO},
    // 1. IMPORT MODUL HASH AGAR TERPAKAI
    crypto::hash,
    error::{AppError, Result},
    models::{ApiResponse, StarknetWalletCall, SwapQuoteRequest, SwapQuoteResponse},
    services::gas_optimizer::GasOptimizer,
    services::nft_discount::consume_nft_usage_if_active,
    services::notification_service::NotificationType,
    services::LiquidityAggregator,
    services::NotificationService,
};
use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use starknet_core::types::{
    Call, ExecutionResult, Felt, FunctionCall, InvokeTransaction, Transaction,
    TransactionFinalityStatus,
};
use starknet_core::utils::get_selector_from_name;
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Instant;
use tokio::time::{sleep, timeout, Duration};

const ORACLE_ROUTE_DEX_ID_HEX: &str = "0x4f52434c"; // 'ORCL'
const ONCHAIN_DISCOUNT_TIMEOUT_MS: u64 = 2_500;
const NFT_DISCOUNT_CACHE_TTL_SECS: u64 = 30;
const NFT_DISCOUNT_CACHE_STALE_SECS: u64 = 600;
const NFT_DISCOUNT_CACHE_MAX_ENTRIES: usize = 100_000;

#[derive(Clone, Copy)]
struct CachedNftDiscount {
    fetched_at: Instant,
    discount: f64,
}

static NFT_DISCOUNT_CACHE: OnceLock<tokio::sync::RwLock<HashMap<String, CachedNftDiscount>>> =
    OnceLock::new();

fn nft_discount_cache() -> &'static tokio::sync::RwLock<HashMap<String, CachedNftDiscount>> {
    NFT_DISCOUNT_CACHE.get_or_init(|| tokio::sync::RwLock::new(HashMap::new()))
}

fn nft_discount_cache_key(contract: &str, user: &str) -> String {
    format!(
        "{}|{}",
        contract.trim().to_ascii_lowercase(),
        user.trim().to_ascii_lowercase()
    )
}

async fn get_cached_nft_discount(key: &str, max_age: Duration) -> Option<f64> {
    let cache = nft_discount_cache();
    let guard = cache.read().await;
    let entry = guard.get(key)?;
    if entry.fetched_at.elapsed() <= max_age {
        return Some(entry.discount);
    }
    None
}

async fn cache_nft_discount(key: &str, discount: f64) {
    let cache = nft_discount_cache();
    let mut guard = cache.write().await;
    guard.insert(
        key.to_string(),
        CachedNftDiscount {
            fetched_at: Instant::now(),
            discount,
        },
    );
    if guard.len() > NFT_DISCOUNT_CACHE_MAX_ENTRIES {
        let stale_after = Duration::from_secs(NFT_DISCOUNT_CACHE_STALE_SECS);
        guard.retain(|_, entry| entry.fetched_at.elapsed() <= stale_after);
    }
}

#[derive(Debug, Deserialize)]
pub struct PrivacyVerificationPayload {
    pub verifier: Option<String>,
    pub nullifier: Option<String>,
    pub commitment: Option<String>,
    pub proof: Option<Vec<String>>,
    pub public_inputs: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct ExecuteSwapRequest {
    pub from_token: String,
    pub to_token: String,
    pub amount: String,
    pub min_amount_out: String,
    pub slippage: f64,
    pub deadline: i64,
    pub recipient: Option<String>,
    pub onchain_tx_hash: Option<String>,
    pub hide_balance: Option<bool>,
    pub privacy: Option<PrivacyVerificationPayload>,
    pub mode: String, // "private" or "transparent"
}

#[derive(Debug, Serialize)]
pub struct ExecuteSwapResponse {
    pub tx_hash: String,
    pub status: String,
    pub from_amount: String,
    pub to_amount: String,
    pub actual_rate: String,
    pub fee_paid: String,
}

fn is_deadline_valid(deadline: i64, now: i64) -> bool {
    deadline >= now
}

fn base_fee(amount_in: f64) -> f64 {
    amount_in * 0.003
}

fn mev_fee_for_mode(mode: &str, amount_in: f64) -> f64 {
    if mode == "private" {
        amount_in * 0.01
    } else {
        0.0
    }
}

fn total_fee(amount_in: f64, mode: &str, nft_discount_percent: f64) -> f64 {
    let undiscounted = base_fee(amount_in) + mev_fee_for_mode(mode, amount_in);
    let discount_factor = 1.0 - (nft_discount_percent.clamp(0.0, 100.0) / 100.0);
    undiscounted * discount_factor
}

fn discount_contract_address(state: &AppState) -> Option<&str> {
    state
        .config
        .discount_soulbound_address
        .as_deref()
        .filter(|addr| !addr.trim().is_empty() && !addr.starts_with("0x0000"))
}

async fn active_nft_discount_percent(state: &AppState, user_address: &str) -> f64 {
    let Some(contract) = discount_contract_address(state) else {
        return 0.0;
    };
    let cache_key = nft_discount_cache_key(contract, user_address);
    if let Some(cached) =
        get_cached_nft_discount(&cache_key, Duration::from_secs(NFT_DISCOUNT_CACHE_TTL_SECS)).await
    {
        return cached.clamp(0.0, 100.0);
    }

    let reader = match OnchainReader::from_config(&state.config) {
        Ok(reader) => reader,
        Err(err) => {
            tracing::warn!(
                "Failed to initialize on-chain reader for NFT discount in swap: {}",
                err
            );
            if let Some(stale) = get_cached_nft_discount(
                &cache_key,
                Duration::from_secs(NFT_DISCOUNT_CACHE_STALE_SECS),
            )
            .await
            {
                tracing::debug!(
                    "Using stale NFT discount cache in swap for user={} discount={}",
                    user_address,
                    stale
                );
                return stale.clamp(0.0, 100.0);
            }
            return 0.0;
        }
    };

    let contract_address = match parse_felt(contract) {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(
                "Invalid discount contract address while calculating swap fee discount: {}",
                err
            );
            return 0.0;
        }
    };
    let user_felt = match parse_felt(user_address) {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(
                "Invalid user address while calculating swap fee discount: user={}, err={}",
                user_address,
                err
            );
            return 0.0;
        }
    };

    let selector = match get_selector_from_name("has_active_discount") {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(
                "Selector resolution failed for has_active_discount: {}",
                err
            );
            return 0.0;
        }
    };

    let call = FunctionCall {
        contract_address,
        entry_point_selector: selector,
        calldata: vec![user_felt],
    };

    let result = match timeout(
        Duration::from_millis(ONCHAIN_DISCOUNT_TIMEOUT_MS),
        reader.call(call),
    )
    .await
    {
        Ok(Ok(value)) => value,
        Ok(Err(err)) => {
            tracing::warn!(
                "Failed on-chain NFT discount check in swap for user={}: {}",
                user_address,
                err
            );
            if let Some(stale) = get_cached_nft_discount(
                &cache_key,
                Duration::from_secs(NFT_DISCOUNT_CACHE_STALE_SECS),
            )
            .await
            {
                tracing::debug!(
                    "Using stale NFT discount cache in swap for user={} discount={}",
                    user_address,
                    stale
                );
                return stale.clamp(0.0, 100.0);
            }
            return 0.0;
        }
        Err(_) => {
            tracing::warn!(
                "Timeout on-chain NFT discount check in swap for user={}",
                user_address
            );
            if let Some(stale) = get_cached_nft_discount(
                &cache_key,
                Duration::from_secs(NFT_DISCOUNT_CACHE_STALE_SECS),
            )
            .await
            {
                tracing::debug!(
                    "Using stale NFT discount cache in swap for user={} discount={}",
                    user_address,
                    stale
                );
                return stale.clamp(0.0, 100.0);
            }
            return 0.0;
        }
    };

    if result.len() < 3 {
        return 0.0;
    }

    let is_active = felt_to_u128(&result[0]).unwrap_or(0) > 0;
    if !is_active {
        cache_nft_discount(&cache_key, 0.0).await;
        return 0.0;
    }

    let discount = u256_from_felts(&result[1], &result[2]).unwrap_or(0) as f64;
    let normalized = discount.clamp(0.0, 100.0);
    cache_nft_discount(&cache_key, normalized).await;
    normalized
}

fn normalize_usd_volume(usd_in: f64, usd_out: f64) -> f64 {
    let in_valid = usd_in.is_finite() && usd_in > 0.0;
    let out_valid = usd_out.is_finite() && usd_out > 0.0;
    match (in_valid, out_valid) {
        (true, true) => (usd_in + usd_out) / 2.0,
        (true, false) => usd_in,
        (false, true) => usd_out,
        (false, false) => 0.0,
    }
}

fn is_private_trade(mode: &str, hide_balance: bool) -> bool {
    hide_balance || mode.eq_ignore_ascii_case("private")
}

fn fallback_price_for(token: &str) -> f64 {
    match token.to_ascii_uppercase().as_str() {
        "BTC" | "WBTC" => 65_000.0,
        "ETH" => 1_900.0,
        "STRK" => 0.05,
        "USDT" | "USDC" => 1.0,
        "CAREL" => 1.0,
        _ => 0.0,
    }
}

fn is_supported_starknet_swap_token(token: &str) -> bool {
    matches!(
        token.to_ascii_uppercase().as_str(),
        "STRK" | "WBTC" | "USDT" | "USDC" | "CAREL"
    )
}

fn ensure_supported_starknet_swap_pair(from_token: &str, to_token: &str) -> Result<()> {
    if !is_supported_starknet_swap_token(from_token) || !is_supported_starknet_swap_token(to_token)
    {
        return Err(AppError::BadRequest(
            "On-chain swap currently supports STRK/WBTC/USDT/USDC/CAREL only".to_string(),
        ));
    }
    Ok(())
}

#[derive(Debug, Clone)]
struct ParsedExecuteCall {
    to: Felt,
    selector: Felt,
    calldata: Vec<Felt>,
}

#[derive(Debug, Clone)]
struct OnchainSwapRoute {
    dex_id: Felt,
    expected_amount_out_low: Felt,
    expected_amount_out_high: Felt,
    min_amount_out_low: Felt,
    min_amount_out_high: Felt,
}

#[derive(Debug, Clone)]
struct OnchainSwapContext {
    swap_contract: Felt,
    from_token: Felt,
    to_token: Felt,
    amount_low: Felt,
    amount_high: Felt,
    route: OnchainSwapRoute,
}

fn token_decimals(symbol: &str) -> u32 {
    match symbol.to_ascii_uppercase().as_str() {
        "BTC" | "WBTC" => 8,
        "USDT" | "USDC" => 6,
        _ => 18,
    }
}

fn pow10_u128(exp: u32) -> Result<u128> {
    let mut out = 1_u128;
    for _ in 0..exp {
        out = out.checked_mul(10).ok_or_else(|| {
            AppError::BadRequest("Token decimals overflow while scaling amount".to_string())
        })?;
    }
    Ok(out)
}

fn parse_decimal_to_scaled_u128(raw: &str, decimals: u32) -> Result<u128> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest("Amount is empty".to_string()));
    }
    if trimmed.starts_with('-') {
        return Err(AppError::BadRequest(
            "Amount must be non-negative".to_string(),
        ));
    }

    let (whole_raw, frac_raw) = trimmed
        .split_once('.')
        .map(|(whole, frac)| (whole, frac))
        .unwrap_or((trimmed, ""));
    if !whole_raw.chars().all(|c| c.is_ascii_digit())
        || !frac_raw.chars().all(|c| c.is_ascii_digit())
    {
        return Err(AppError::BadRequest(
            "Amount must be a decimal number".to_string(),
        ));
    }

    let whole = if whole_raw.is_empty() {
        0_u128
    } else {
        whole_raw
            .parse::<u128>()
            .map_err(|_| AppError::BadRequest("Amount is too large".to_string()))?
    };
    let scale = pow10_u128(decimals)?;
    let whole_scaled = whole
        .checked_mul(scale)
        .ok_or_else(|| AppError::BadRequest("Amount is too large".to_string()))?;

    let frac_cut = if frac_raw.len() > decimals as usize {
        &frac_raw[..decimals as usize]
    } else {
        frac_raw
    };
    let mut frac_padded = frac_cut.to_string();
    while frac_padded.len() < decimals as usize {
        frac_padded.push('0');
    }
    let frac_scaled = if frac_padded.is_empty() {
        0_u128
    } else {
        frac_padded
            .parse::<u128>()
            .map_err(|_| AppError::BadRequest("Amount is too large".to_string()))?
    };

    whole_scaled
        .checked_add(frac_scaled)
        .ok_or_else(|| AppError::BadRequest("Amount is too large".to_string()))
}

fn parse_decimal_to_u256_parts(raw: &str, decimals: u32) -> Result<(Felt, Felt)> {
    let scaled = parse_decimal_to_scaled_u128(raw, decimals)?;
    Ok((Felt::from(scaled), Felt::ZERO))
}

fn onchain_u256_to_f64(low: Felt, high: Felt, decimals: u32) -> Result<f64> {
    let low_u = felt_to_u128(&low).map_err(|_| {
        AppError::BadRequest("Invalid on-chain amount: low limb is not numeric".to_string())
    })?;
    let high_u = felt_to_u128(&high).map_err(|_| {
        AppError::BadRequest("Invalid on-chain amount: high limb is not numeric".to_string())
    })?;

    let value_raw = (high_u as f64) * 2_f64.powi(128) + (low_u as f64);
    let scale = 10_f64.powi(decimals as i32);
    if scale <= 0.0 {
        return Err(AppError::BadRequest(
            "Invalid token decimals for on-chain conversion".to_string(),
        ));
    }
    let out = value_raw / scale;
    if !out.is_finite() {
        return Err(AppError::BadRequest(
            "On-chain quote is out of supported range".to_string(),
        ));
    }
    Ok(out)
}

fn felt_hex(value: Felt) -> String {
    value.to_string()
}

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

fn parse_execute_calls(calldata: &[Felt]) -> Result<Vec<ParsedExecuteCall>> {
    if let Ok(calls) = parse_execute_calls_offset(calldata) {
        return Ok(calls);
    }
    parse_execute_calls_inline(calldata)
}

fn configured_swap_contract(state: &AppState) -> Result<Option<Felt>> {
    let mut candidates = vec![
        std::env::var("STARKNET_SWAP_CONTRACT_ADDRESS").ok(),
        std::env::var("NEXT_PUBLIC_STARKNET_SWAP_CONTRACT_ADDRESS").ok(),
        std::env::var("SWAP_AGGREGATOR_ADDRESS").ok(),
        std::env::var("CAREL_PROTOCOL_ADDRESS").ok(),
        std::env::var("NEXT_PUBLIC_CAREL_PROTOCOL_ADDRESS").ok(),
        Some(state.config.limit_order_book_address.clone()),
        Some(CONTRACT_SWAP_AGGREGATOR.to_string()),
    ];
    for candidate in candidates.drain(..).flatten() {
        let trimmed = candidate.trim();
        if trimmed.is_empty() || trimmed.starts_with("0x0000") {
            continue;
        }
        return Ok(Some(parse_felt(trimmed)?));
    }
    Ok(None)
}

fn env_truthy(name: &str) -> bool {
    matches!(
        std::env::var(name)
            .ok()
            .map(|value| value.trim().to_ascii_lowercase()),
        Some(value) if value == "1" || value == "true" || value == "yes"
    )
}

fn is_event_only_swap_contract_configured(state: &AppState) -> Result<bool> {
    if env_truthy("SWAP_CONTRACT_EVENT_ONLY") || env_truthy("NEXT_PUBLIC_SWAP_CONTRACT_EVENT_ONLY")
    {
        return Ok(true);
    }

    let Some(configured_swap) = configured_swap_contract(state)? else {
        return Ok(false);
    };

    let carel_candidates = [
        std::env::var("CAREL_PROTOCOL_ADDRESS").ok(),
        std::env::var("NEXT_PUBLIC_CAREL_PROTOCOL_ADDRESS").ok(),
    ];

    for candidate in carel_candidates.into_iter().flatten() {
        let trimmed = candidate.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(carel_protocol) = parse_felt(trimmed) {
            if configured_swap == carel_protocol {
                return Ok(true);
            }
        }
    }

    Ok(false)
}

fn env_value(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn push_token_candidate(raw: Option<String>, out: &mut Vec<Felt>) {
    let Some(candidate) = raw else {
        return;
    };
    match parse_felt(&candidate) {
        Ok(felt) => {
            if !out.iter().any(|existing| *existing == felt) {
                out.push(felt);
            }
        }
        Err(err) => {
            tracing::warn!(
                "Ignoring invalid token address candidate '{}': {}",
                candidate,
                err
            );
        }
    }
}

fn configured_token_candidates(state: &AppState, token: &str) -> Vec<Felt> {
    let token = token.to_ascii_uppercase();
    let mut candidates = Vec::new();
    match token.as_str() {
        "CAREL" => {
            push_token_candidate(env_value("TOKEN_CAREL_ADDRESS"), &mut candidates);
            push_token_candidate(
                env_value("NEXT_PUBLIC_TOKEN_CAREL_ADDRESS"),
                &mut candidates,
            );
            push_token_candidate(
                Some(state.config.carel_token_address.clone()),
                &mut candidates,
            );
        }
        "STRK" => {
            push_token_candidate(env_value("TOKEN_STRK_ADDRESS"), &mut candidates);
            push_token_candidate(env_value("NEXT_PUBLIC_TOKEN_STRK_ADDRESS"), &mut candidates);
            push_token_candidate(state.config.token_strk_address.clone(), &mut candidates);
        }
        "WBTC" | "BTC" => {
            push_token_candidate(env_value("TOKEN_WBTC_ADDRESS"), &mut candidates);
            push_token_candidate(env_value("NEXT_PUBLIC_TOKEN_WBTC_ADDRESS"), &mut candidates);
            push_token_candidate(env_value("TOKEN_BTC_ADDRESS"), &mut candidates);
            push_token_candidate(env_value("NEXT_PUBLIC_TOKEN_BTC_ADDRESS"), &mut candidates);
            push_token_candidate(state.config.token_btc_address.clone(), &mut candidates);
        }
        "USDT" => {
            push_token_candidate(env_value("TOKEN_USDT_ADDRESS"), &mut candidates);
            push_token_candidate(env_value("NEXT_PUBLIC_TOKEN_USDT_ADDRESS"), &mut candidates);
        }
        "USDC" => {
            push_token_candidate(env_value("TOKEN_USDC_ADDRESS"), &mut candidates);
            push_token_candidate(env_value("NEXT_PUBLIC_TOKEN_USDC_ADDRESS"), &mut candidates);
        }
        "ETH" => {
            push_token_candidate(env_value("TOKEN_ETH_ADDRESS"), &mut candidates);
            push_token_candidate(env_value("NEXT_PUBLIC_TOKEN_ETH_ADDRESS"), &mut candidates);
            push_token_candidate(state.config.token_eth_address.clone(), &mut candidates);
        }
        _ => {}
    }

    push_token_candidate(
        token_address_for(&token).map(|value| value.to_string()),
        &mut candidates,
    );
    candidates
}

fn resolve_primary_token_address(state: &AppState, token: &str) -> Result<Felt> {
    configured_token_candidates(state, token)
        .into_iter()
        .next()
        .ok_or_else(|| {
            AppError::BadRequest(format!("Token address is not configured for {}", token))
        })
}

fn parse_onchain_route(raw: &[Felt]) -> Result<OnchainSwapRoute> {
    if raw.len() < 5 {
        return Err(AppError::BadRequest(
            "Invalid on-chain route response: expected 5 felts".to_string(),
        ));
    }
    Ok(OnchainSwapRoute {
        dex_id: raw[0],
        expected_amount_out_low: raw[1],
        expected_amount_out_high: raw[2],
        min_amount_out_low: raw[3],
        min_amount_out_high: raw[4],
    })
}

fn u256_limbs_to_u128_parts(low: Felt, high: Felt, label: &str) -> Result<(u128, u128)> {
    let low_u = felt_to_u128(&low).map_err(|_| {
        AppError::BadRequest(format!(
            "Invalid on-chain {} amount: low limb is not numeric",
            label
        ))
    })?;
    let high_u = felt_to_u128(&high).map_err(|_| {
        AppError::BadRequest(format!(
            "Invalid on-chain {} amount: high limb is not numeric",
            label
        ))
    })?;
    Ok((low_u, high_u))
}

fn u256_is_greater(
    left_low: Felt,
    left_high: Felt,
    right_low: Felt,
    right_high: Felt,
    left_label: &str,
    right_label: &str,
) -> Result<bool> {
    let (left_low_u, left_high_u) = u256_limbs_to_u128_parts(left_low, left_high, left_label)?;
    let (right_low_u, right_high_u) = u256_limbs_to_u128_parts(right_low, right_high, right_label)?;
    Ok(left_high_u > right_high_u || (left_high_u == right_high_u && left_low_u > right_low_u))
}

async fn read_erc20_balance_parts(
    reader: &OnchainReader,
    token: Felt,
    owner: Felt,
) -> Result<(Felt, Felt)> {
    for selector_name in ["balance_of", "balanceOf"] {
        let selector = get_selector_from_name(selector_name)
            .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
        let response = reader
            .call(FunctionCall {
                contract_address: token,
                entry_point_selector: selector,
                calldata: vec![owner],
            })
            .await;
        if let Ok(values) = response {
            if values.len() >= 2 {
                return Ok((values[0], values[1]));
            }
        }
    }
    Err(AppError::BadRequest(
        "Failed to read on-chain token liquidity (balance_of)".to_string(),
    ))
}

fn is_oracle_route(route: &OnchainSwapRoute) -> bool {
    parse_felt(ORACLE_ROUTE_DEX_ID_HEX)
        .map(|oracle_id| route.dex_id == oracle_id)
        .unwrap_or(false)
}

async fn ensure_oracle_route_liquidity(
    state: &AppState,
    context: &OnchainSwapContext,
    from_token: &str,
    to_token: &str,
    from_amount: &str,
) -> Result<()> {
    if !is_oracle_route(&context.route) {
        return Ok(());
    }

    let reader = OnchainReader::from_config(&state.config)?;
    let (available_low, available_high) =
        read_erc20_balance_parts(&reader, context.to_token, context.swap_contract).await?;

    let required_is_higher = u256_is_greater(
        context.route.expected_amount_out_low,
        context.route.expected_amount_out_high,
        available_low,
        available_high,
        "required output",
        "available liquidity",
    )?;
    if !required_is_higher {
        return Ok(());
    }

    let required = onchain_u256_to_f64(
        context.route.expected_amount_out_low,
        context.route.expected_amount_out_high,
        token_decimals(to_token),
    )?;
    let available = onchain_u256_to_f64(available_low, available_high, token_decimals(to_token))?;
    let input_amount = from_amount.trim().parse::<f64>().unwrap_or(0.0);
    let max_input = if required > 0.0 && available > 0.0 && input_amount > 0.0 {
        input_amount * (available / required)
    } else {
        0.0
    };

    Err(AppError::BadRequest(format!(
        "Likuiditas on-chain {} tidak cukup untuk {} -> {} via oracle route. Butuh sekitar {:.6} {}, tersedia sekitar {:.6} {} di swap aggregator. Kurangi amount (maks sekitar {:.6} {}) atau top-up liquidity.",
        to_token.to_ascii_uppercase(),
        from_token.to_ascii_uppercase(),
        to_token.to_ascii_uppercase(),
        required,
        to_token.to_ascii_uppercase(),
        available,
        to_token.to_ascii_uppercase(),
        max_input.max(0.0),
        from_token.to_ascii_uppercase(),
    )))
}

async fn fetch_onchain_swap_context(
    state: &AppState,
    from_token: &str,
    to_token: &str,
    amount: &str,
) -> Result<OnchainSwapContext> {
    let swap_contract = configured_swap_contract(state)?.ok_or_else(|| {
        AppError::BadRequest(
            "STARKNET_SWAP_CONTRACT_ADDRESS is not configured for on-chain swap".to_string(),
        )
    })?;
    let from_token_felt = resolve_primary_token_address(state, from_token)?;
    let to_token_felt = resolve_primary_token_address(state, to_token)?;
    let (amount_low, amount_high) =
        parse_decimal_to_u256_parts(amount, token_decimals(from_token))?;

    let reader = OnchainReader::from_config(&state.config)?;
    let route_selector = get_selector_from_name("get_best_swap_route")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let route_raw = reader
        .call(FunctionCall {
            contract_address: swap_contract,
            entry_point_selector: route_selector,
            calldata: vec![from_token_felt, to_token_felt, amount_low, amount_high],
        })
        .await
        .map_err(|err| {
            let message = err.to_string();
            if message.to_ascii_lowercase().contains("no active dex found") {
                AppError::BadRequest(
                    "Swap aggregator on-chain belum siap: belum ada DEX router aktif / oracle quote."
                        .to_string(),
                )
            } else {
                AppError::BadRequest(format!(
                    "Failed to fetch on-chain swap route from configured contract: {}",
                    message
                ))
            }
        })?;
    let route = parse_onchain_route(&route_raw)?;

    Ok(OnchainSwapContext {
        swap_contract,
        from_token: from_token_felt,
        to_token: to_token_felt,
        amount_low,
        amount_high,
        route,
    })
}

fn build_onchain_swap_wallet_calls(
    context: &OnchainSwapContext,
    mev_protected: bool,
) -> Vec<StarknetWalletCall> {
    let mev_flag = if mev_protected { Felt::ONE } else { Felt::ZERO };
    vec![
        StarknetWalletCall {
            contract_address: felt_hex(context.from_token),
            entrypoint: "approve".to_string(),
            calldata: vec![
                felt_hex(context.swap_contract),
                felt_hex(context.amount_low),
                felt_hex(context.amount_high),
            ],
        },
        StarknetWalletCall {
            contract_address: felt_hex(context.swap_contract),
            entrypoint: "execute_swap".to_string(),
            calldata: vec![
                felt_hex(context.route.dex_id),
                felt_hex(context.route.expected_amount_out_low),
                felt_hex(context.route.expected_amount_out_high),
                felt_hex(context.route.min_amount_out_low),
                felt_hex(context.route.min_amount_out_high),
                felt_hex(context.from_token),
                felt_hex(context.to_token),
                felt_hex(context.amount_low),
                felt_hex(context.amount_high),
                felt_hex(mev_flag),
            ],
        },
    ]
}

fn first_index_of_any(calldata: &[Felt], candidates: &[Felt]) -> Option<usize> {
    calldata
        .iter()
        .position(|felt| candidates.iter().any(|candidate| candidate == felt))
}

fn first_index_of_any_from(calldata: &[Felt], candidates: &[Felt], start: usize) -> Option<usize> {
    calldata
        .iter()
        .enumerate()
        .skip(start)
        .find_map(|(idx, felt)| {
            if candidates.iter().any(|candidate| candidate == felt) {
                Some(idx)
            } else {
                None
            }
        })
}

async fn resolve_allowed_swap_senders(
    state: &AppState,
    auth_subject: &str,
    resolved_starknet_user: &str,
) -> Result<Vec<Felt>> {
    let mut out: Vec<Felt> = Vec::new();
    for candidate in [resolved_starknet_user, auth_subject] {
        if let Ok(felt) = parse_felt(candidate) {
            if !out.iter().any(|existing| *existing == felt) {
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
                if !out.iter().any(|existing| *existing == felt) {
                    out.push(felt);
                }
            }
        }
    }

    if out.is_empty() {
        return Err(AppError::BadRequest(
            "No Starknet sender address resolved for swap verification".to_string(),
        ));
    }
    Ok(out)
}

fn verify_swap_invoke_payload_fallback_raw(
    calldata: &[Felt],
    swap_selectors: &[Felt],
    expected_swap_contract: Option<Felt>,
    from_token_candidates: &[Felt],
    to_token_candidates: &[Felt],
) -> bool {
    for (idx, felt) in calldata.iter().enumerate() {
        if !swap_selectors.iter().any(|selector| selector == felt) {
            continue;
        }

        let contract_matches = match expected_swap_contract {
            Some(expected) => {
                (idx > 0 && calldata[idx - 1] == expected) || calldata.contains(&expected)
            }
            None => true,
        };
        if !contract_matches {
            continue;
        }

        let from_idx = first_index_of_any_from(calldata, from_token_candidates, idx + 1);
        let to_idx = from_idx.and_then(|from_idx| {
            first_index_of_any_from(calldata, to_token_candidates, from_idx + 1)
        });
        if from_idx.is_some() && to_idx.is_some() {
            return true;
        }
    }

    false
}

fn verify_swap_invoke_payload(
    tx: &Transaction,
    allowed_senders: &[Felt],
    expected_swap_contract: Option<Felt>,
    from_token_candidates: &[Felt],
    to_token_candidates: &[Felt],
) -> Result<()> {
    if allowed_senders.is_empty() {
        return Err(AppError::BadRequest(
            "No Starknet sender allowed for swap verification".to_string(),
        ));
    }
    if from_token_candidates.is_empty() {
        return Err(AppError::BadRequest(
            "from_token address candidates are empty".to_string(),
        ));
    }
    if to_token_candidates.is_empty() {
        return Err(AppError::BadRequest(
            "to_token address candidates are empty".to_string(),
        ));
    }
    let swap_selector = get_selector_from_name("swap")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let execute_swap_selector = get_selector_from_name("execute_swap")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let approve_selector = get_selector_from_name("approve")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let swap_selectors = [swap_selector, execute_swap_selector];

    let invoke = match tx {
        Transaction::Invoke(invoke) => invoke,
        _ => {
            return Err(AppError::BadRequest(
                "onchain_tx_hash must be an INVOKE transaction".to_string(),
            ));
        }
    };

    let (sender, calldata) = match invoke {
        InvokeTransaction::V1(tx) => (tx.sender_address, tx.calldata.as_slice()),
        InvokeTransaction::V3(tx) => (tx.sender_address, tx.calldata.as_slice()),
        InvokeTransaction::V0(_) => {
            return Err(AppError::BadRequest(
                "onchain_tx_hash uses unsupported INVOKE v0".to_string(),
            ));
        }
    };

    if !allowed_senders.iter().any(|candidate| *candidate == sender) {
        let expected = allowed_senders
            .iter()
            .map(|felt| felt.to_string())
            .collect::<Vec<_>>()
            .join(", ");
        return Err(AppError::BadRequest(format!(
            "onchain_tx_hash sender does not match authenticated Starknet user (expected one of [{}], got {})",
            expected, sender
        )));
    }

    let calls = match parse_execute_calls(calldata) {
        Ok(calls) => Some(calls),
        Err(err) => {
            tracing::warn!(
                "Failed to parse invoke calldata with structured parser, fallback to raw heuristic: {}",
                err
            );
            None
        }
    };
    let mut saw_swap_selector = false;
    let mut saw_expected_contract = expected_swap_contract.is_none();
    let mut matched_swap_call = false;
    let mut saw_approve_from_token = false;
    let mut saw_valid_approve = false;

    if let Some(calls) = calls {
        for call in calls {
            if call.selector == approve_selector {
                if !from_token_candidates
                    .iter()
                    .any(|candidate| *candidate == call.to)
                {
                    continue;
                }
                saw_approve_from_token = true;
                let approve_spender = call.calldata.first().copied();
                let approve_matches = match expected_swap_contract {
                    Some(expected_contract) => approve_spender == Some(expected_contract),
                    None => approve_spender.is_some(),
                };
                if approve_matches {
                    saw_valid_approve = true;
                }
                continue;
            }
            if !swap_selectors
                .iter()
                .any(|selector| *selector == call.selector)
            {
                continue;
            }
            saw_swap_selector = true;

            if let Some(expected_contract) = expected_swap_contract {
                if call.to != expected_contract {
                    continue;
                }
                saw_expected_contract = true;
            }

            let from_idx = first_index_of_any(&call.calldata, &from_token_candidates);
            let to_idx = from_idx.and_then(|idx| {
                first_index_of_any_from(&call.calldata, &to_token_candidates, idx + 1)
            });

            if let (Some(from_idx), Some(to_idx)) = (from_idx, to_idx) {
                if from_idx < to_idx {
                    matched_swap_call = true;
                }
            }
        }
    } else if verify_swap_invoke_payload_fallback_raw(
        calldata,
        &swap_selectors,
        expected_swap_contract,
        from_token_candidates,
        to_token_candidates,
    ) {
        matched_swap_call = true;
    } else {
        saw_swap_selector = swap_selectors
            .iter()
            .any(|selector| calldata.contains(selector));
        saw_expected_contract = expected_swap_contract
            .map(|expected| calldata.contains(&expected))
            .unwrap_or(true);
    }

    if matched_swap_call {
        if saw_approve_from_token && !saw_valid_approve {
            return Err(AppError::BadRequest(
                "onchain_tx_hash approve call does not target configured Starknet swap contract"
                    .to_string(),
            ));
        }
        return Ok(());
    }

    if !saw_swap_selector {
        return Err(AppError::BadRequest(
            "onchain_tx_hash does not contain execute_swap/swap call".to_string(),
        ));
    }
    if !saw_expected_contract {
        return Err(AppError::BadRequest(
            "onchain_tx_hash execute_swap/swap call is not targeting configured Starknet swap contract"
                .to_string(),
        ));
    }

    Err(AppError::BadRequest(
        "onchain_tx_hash swap call does not match requested token pair".to_string(),
    ))
}

async fn verify_onchain_swap_tx_hash(
    state: &AppState,
    tx_hash: &str,
    auth_subject: &str,
    resolved_starknet_user: &str,
    from_token: &str,
    to_token: &str,
) -> Result<i64> {
    let reader = OnchainReader::from_config(&state.config)?;
    let tx_hash_felt = parse_felt(tx_hash)?;
    let expected_swap_contract = configured_swap_contract(state)?;
    let allowed_senders =
        resolve_allowed_swap_senders(state, auth_subject, resolved_starknet_user).await?;
    let from_token_candidates = configured_token_candidates(state, from_token);
    if from_token_candidates.is_empty() {
        return Err(AppError::BadRequest(format!(
            "Token address is not configured for {}",
            from_token
        )));
    }
    let to_token_candidates = configured_token_candidates(state, to_token);
    if to_token_candidates.is_empty() {
        return Err(AppError::BadRequest(format!(
            "Token address is not configured for {}",
            to_token
        )));
    }
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

        verify_swap_invoke_payload(
            &tx,
            &allowed_senders,
            expected_swap_contract,
            &from_token_candidates,
            &to_token_candidates,
        )?;

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
                let block_number = receipt.block.block_number() as i64;
                tracing::info!(
                    "Verified Starknet swap tx {} at block {} with finality {:?}",
                    tx_hash,
                    block_number,
                    receipt.receipt.finality_status()
                );
                return Ok(block_number);
            }
            Err(err) => {
                last_rpc_error = err.to_string();
                if attempt < 4 {
                    sleep(Duration::from_millis(1000)).await;
                }
            }
        }
    }

    Err(AppError::BadRequest(format!(
        "onchain_tx_hash not found/confirmed on Starknet RPC: {}",
        last_rpc_error
    )))
}

async fn latest_price_usd(state: &AppState, token: &str) -> Result<f64> {
    let symbol = token.to_ascii_uppercase();
    let price: Option<f64> = sqlx::query_scalar(
        "SELECT close::FLOAT FROM price_history WHERE token = $1 ORDER BY timestamp DESC LIMIT 1",
    )
    .bind(&symbol)
    .fetch_optional(state.db.pool())
    .await?;
    Ok(price
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or_else(|| fallback_price_for(&symbol)))
}

fn estimated_time_for_dex(dex: &str) -> &'static str {
    match dex {
        DEX_EKUBO => "~2 min",
        DEX_HAIKO => "~3 min",
        _ => "~2-3 min",
    }
}

fn normalize_onchain_tx_hash(tx_hash: Option<&str>) -> Result<Option<String>> {
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

fn resolve_privacy_inputs(
    seed: &str,
    payload: Option<&PrivacyVerificationPayload>,
) -> Result<(String, String, Vec<String>, Vec<String>)> {
    let payload = payload.ok_or_else(|| {
        AppError::BadRequest(
            "privacy payload is required when mode=private or hide_balance=true".to_string(),
        )
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
                "privacy.proof must be provided and non-empty in private mode".to_string(),
            )
        })?;
    let public_inputs = payload
        .public_inputs
        .clone()
        .filter(|items| !items.is_empty())
        .ok_or_else(|| {
            AppError::BadRequest(
                "privacy.public_inputs must be provided and non-empty in private mode".to_string(),
            )
        })?;
    Ok((nullifier, commitment, proof, public_inputs))
}

async fn verify_private_trade_with_verifier(
    state: &AppState,
    seed: &str,
    payload: Option<&PrivacyVerificationPayload>,
    verifier: PrivacyVerifierKind,
) -> Result<String> {
    let router = resolve_privacy_router_for_verifier(&state.config, verifier)?;
    let Some(invoker) = OnchainInvoker::from_config(&state.config).ok().flatten() else {
        return Err(AppError::BadRequest(format!(
            "On-chain invoker is not configured for '{}' verification",
            verifier.as_str()
        )));
    };

    let (nullifier, commitment, proof, public_inputs) = resolve_privacy_inputs(seed, payload)?;

    let to = parse_felt(&router)?;
    let selector = get_selector_from_name("submit_private_action")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;

    let mut calldata = vec![parse_felt(&nullifier)?, parse_felt(&commitment)?];
    calldata.push(Felt::from(proof.len() as u64));
    for item in proof {
        calldata.push(parse_felt(&item)?);
    }
    calldata.push(Felt::from(public_inputs.len() as u64));
    for item in public_inputs {
        calldata.push(parse_felt(&item)?);
    }

    let tx_hash = invoker
        .invoke(Call {
            to,
            selector,
            calldata,
        })
        .await?;
    Ok(tx_hash.to_string())
}

/// POST /api/v1/swap/quote
pub async fn get_quote(
    State(state): State<AppState>,
    Json(req): Json<SwapQuoteRequest>,
) -> Result<Json<ApiResponse<SwapQuoteResponse>>> {
    let amount_in: f64 = req
        .amount
        .parse()
        .map_err(|_| AppError::BadRequest("Invalid amount".to_string()))?;
    if !amount_in.is_finite() || amount_in <= 0.0 {
        return Err(AppError::BadRequest(
            "Amount must be greater than zero".to_string(),
        ));
    }

    tracing::debug!(
        "Swap quote: from={}, to={}, slippage={}, mode={}",
        req.from_token,
        req.to_token,
        req.slippage,
        req.mode
    );

    ensure_supported_starknet_swap_pair(&req.from_token, &req.to_token)?;
    if is_event_only_swap_contract_configured(&state)? {
        return Err(AppError::BadRequest(
            "Swap real token belum aktif: kontrak swap terkonfigurasi masih event-only. Deploy/aktifkan router swap on-chain yang memindahkan token real terlebih dulu.".to_string(),
        ));
    }

    if token_address_for(&req.from_token).is_none() || token_address_for(&req.to_token).is_none() {
        return Err(AppError::InvalidToken);
    }

    let gas_optimizer = GasOptimizer::new(state.config.clone());
    let estimated_cost = gas_optimizer
        .estimate_cost("swap")
        .await
        .unwrap_or_default();

    let aggregator = LiquidityAggregator::new(state.config.clone());
    let best_route = aggregator
        .get_best_quote(&req.from_token, &req.to_token, amount_in)
        .await?;
    let onchain_context =
        fetch_onchain_swap_context(&state, &req.from_token, &req.to_token, &req.amount).await?;
    ensure_oracle_route_liquidity(
        &state,
        &onchain_context,
        &req.from_token,
        &req.to_token,
        &req.amount,
    )
    .await?;
    let onchain_calls =
        build_onchain_swap_wallet_calls(&onchain_context, req.mode.eq_ignore_ascii_case("private"));
    let onchain_to_amount = onchain_u256_to_f64(
        onchain_context.route.expected_amount_out_low,
        onchain_context.route.expected_amount_out_high,
        token_decimals(&req.to_token),
    )?;
    let quoted_to_amount = if onchain_to_amount > 0.0 {
        onchain_to_amount
    } else {
        best_route.amount_out
    };

    if let Ok(split_routes) = aggregator
        .get_split_quote(&req.from_token, &req.to_token, amount_in)
        .await
    {
        if split_routes.len() > 1 {
            tracing::debug!("Split routing across {} venues", split_routes.len());
        }
    }

    if let Ok(depth) = aggregator
        .get_liquidity_depth(&req.from_token, &req.to_token)
        .await
    {
        tracing::debug!("Liquidity depth: total={}", depth.total_liquidity);
    }

    let gas = gas_optimizer.get_optimal_gas_price().await?;
    tracing::debug!("Estimated swap gas cost: {}", estimated_cost);

    let response = SwapQuoteResponse {
        from_amount: req.amount.clone(),
        to_amount: quoted_to_amount.to_string(),
        rate: (quoted_to_amount / amount_in).to_string(),
        price_impact: format!("{:.2}%", best_route.price_impact * 100.0),
        fee: best_route.fee.to_string(),
        fee_usd: best_route.fee.to_string(),
        route: best_route.path,
        estimated_gas: gas.standard.to_string(),
        estimated_time: estimated_time_for_dex(best_route.dex.as_str()).to_string(),
        onchain_calls: Some(onchain_calls),
    };

    Ok(Json(ApiResponse::success(response)))
}

/// POST /api/v1/swap/execute
pub async fn execute_swap(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ExecuteSwapRequest>,
) -> Result<Json<ApiResponse<ExecuteSwapResponse>>> {
    // 1. VALIDASI DEADLINE
    let now = chrono::Utc::now().timestamp();
    if !is_deadline_valid(req.deadline, now) {
        return Err(AppError::BadRequest(
            "Transaction deadline expired".to_string(),
        ));
    }

    let auth_subject = require_user(&headers, &state).await?;
    let user_address = require_starknet_user(&headers, &state).await?;

    // 2. LOGIKA RECIPIENT
    let final_recipient = req.recipient.as_deref().unwrap_or(&user_address);

    let amount_in: f64 = req
        .amount
        .parse()
        .map_err(|_| AppError::BadRequest("Invalid amount".to_string()))?;
    if !amount_in.is_finite() || amount_in <= 0.0 {
        return Err(AppError::BadRequest(
            "Amount must be greater than zero".to_string(),
        ));
    }

    ensure_supported_starknet_swap_pair(&req.from_token, &req.to_token)?;
    if is_event_only_swap_contract_configured(&state)? {
        return Err(AppError::BadRequest(
            "Swap real token belum aktif: kontrak swap terkonfigurasi masih event-only. Deploy/aktifkan router swap on-chain yang memindahkan token real terlebih dulu.".to_string(),
        ));
    }

    if token_address_for(&req.from_token).is_none() || token_address_for(&req.to_token).is_none() {
        return Err(AppError::InvalidToken);
    }

    let onchain_context =
        fetch_onchain_swap_context(&state, &req.from_token, &req.to_token, &req.amount).await?;
    ensure_oracle_route_liquidity(
        &state,
        &onchain_context,
        &req.from_token,
        &req.to_token,
        &req.amount,
    )
    .await?;

    // 3. VALIDASI SLIPPAGE
    let expected_out = onchain_u256_to_f64(
        onchain_context.route.expected_amount_out_low,
        onchain_context.route.expected_amount_out_high,
        token_decimals(&req.to_token),
    )?;
    let min_out: f64 = req
        .min_amount_out
        .parse()
        .map_err(|_| AppError::BadRequest("Invalid min amount".to_string()))?;

    if expected_out < min_out {
        tracing::warn!(
            "Off-chain quote below client min_out (set={}%, min_expected={}, market={}). Continuing because final execution validity is enforced by user-signed on-chain calldata.",
            req.slippage,
            min_out,
            expected_out
        );
    }

    let onchain_tx_hash = normalize_onchain_tx_hash(req.onchain_tx_hash.as_deref())?;
    let onchain_tx_hash = onchain_tx_hash.ok_or_else(|| {
        AppError::BadRequest(
            "Swap requires onchain_tx_hash. Frontend must submit user-signed Starknet tx."
                .to_string(),
        )
    })?;
    let onchain_block_number = verify_onchain_swap_tx_hash(
        &state,
        &onchain_tx_hash,
        &auth_subject,
        &user_address,
        &req.from_token,
        &req.to_token,
    )
    .await?;
    let is_user_signed_onchain = true;
    let should_hide = is_private_trade(&req.mode, req.hide_balance.unwrap_or(false));

    // 4. Use wallet-submitted onchain tx hash when available; otherwise fallback.
    let tx_hash = onchain_tx_hash;

    let mut privacy_verification_tx: Option<String> = None;
    if should_hide {
        let verifier =
            parse_privacy_verifier_kind(req.privacy.as_ref().and_then(|p| p.verifier.as_deref()))?;
        let privacy_tx =
            verify_private_trade_with_verifier(&state, &tx_hash, req.privacy.as_ref(), verifier)
                .await
                .map_err(|e| {
                    AppError::BadRequest(format!(
                        "Privacy verification failed via '{}': {}",
                        verifier.as_str(),
                        e
                    ))
                })?;
        privacy_verification_tx = Some(privacy_tx);
    }

    let gas_optimizer = GasOptimizer::new(state.config.clone());
    let estimated_cost = gas_optimizer
        .estimate_cost("swap")
        .await
        .unwrap_or_default();

    let nft_discount_percent = active_nft_discount_percent(&state, &user_address).await;
    let total_fee = total_fee(amount_in, &req.mode, nft_discount_percent);
    let from_price = latest_price_usd(&state, &req.from_token).await?;
    let to_price = latest_price_usd(&state, &req.to_token).await?;
    let volume_usd = normalize_usd_volume(amount_in * from_price, expected_out * to_price);

    // Simpan ke database
    let tx = crate::models::Transaction {
        tx_hash: tx_hash.clone(),
        block_number: onchain_block_number,
        user_address: user_address.to_string(),
        tx_type: "swap".to_string(),
        token_in: Some(req.from_token.clone()),
        token_out: Some(req.to_token.clone()),
        amount_in: Some(rust_decimal::Decimal::from_f64_retain(amount_in).unwrap()),
        amount_out: Some(rust_decimal::Decimal::from_f64_retain(expected_out).unwrap()),
        usd_value: Some(rust_decimal::Decimal::from_f64_retain(volume_usd).unwrap_or_default()),
        fee_paid: Some(rust_decimal::Decimal::from_f64_retain(total_fee).unwrap()),
        points_earned: Some(rust_decimal::Decimal::ZERO),
        timestamp: chrono::Utc::now(),
        processed: false,
    };

    state.db.save_transaction(&tx).await?;
    if should_hide {
        state.db.mark_transaction_private(&tx_hash).await?;
    }
    if nft_discount_percent > 0.0 {
        if let Err(err) = consume_nft_usage_if_active(&state.config, &user_address, "swap").await {
            tracing::warn!(
                "Failed to consume NFT discount usage after swap success: user={} tx_hash={} err={}",
                user_address,
                tx_hash,
                err
            );
        }
    }

    if let Ok(batch) = gas_optimizer.optimize_batch(vec![tx_hash.clone()]).await {
        tracing::debug!("Optimized gas batch size: {}", batch.len());
    }

    let notification_service = NotificationService::new(state.db.clone(), state.config.clone());
    if let Err(e) = notification_service
        .send_notification(
            &user_address,
            NotificationType::SwapCompleted,
            "Swap completed".to_string(),
            format!(
                "Swapped {} {} to {} {}",
                amount_in, &req.from_token, expected_out, &req.to_token
            ),
            Some(serde_json::json!({
                "tx_hash": tx_hash.clone(),
                "privacy_tx_hash": privacy_verification_tx,
                "from_token": req.from_token.clone(),
                "to_token": req.to_token.clone(),
                "amount_in": amount_in,
                "amount_out": expected_out,
            })),
        )
        .await
    {
        tracing::warn!("Failed to send swap notification: {}", e);
    }

    tracing::debug!("Estimated swap gas cost: {}", estimated_cost);

    tracing::info!(
        "Swap success for {}: {} {} -> {} {}. Recipient: {}",
        user_address,
        amount_in,
        req.from_token,
        expected_out,
        req.to_token,
        final_recipient
    );

    Ok(Json(ApiResponse::success(ExecuteSwapResponse {
        tx_hash,
        status: if is_user_signed_onchain {
            "submitted_onchain".to_string()
        } else {
            "success".to_string()
        },
        from_amount: req.amount,
        to_amount: expected_out.to_string(),
        actual_rate: (expected_out / amount_in).to_string(),
        fee_paid: total_fee.to_string(),
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_deadline_valid_accepts_equal_time() {
        // Memastikan deadline yang sama dengan waktu sekarang dianggap valid
        assert!(is_deadline_valid(100, 100));
    }

    #[test]
    fn mev_fee_for_mode_only_private() {
        // Memastikan fee MEV hanya untuk mode private
        assert!((mev_fee_for_mode("private", 100.0) - 1.0).abs() < 1e-9);
        assert!((mev_fee_for_mode("transparent", 100.0) - 0.0).abs() < 1e-9);
    }

    #[test]
    fn estimated_time_for_dex_defaults() {
        // Memastikan estimasi waktu untuk DEX yang tidak dikenal
        assert_eq!(estimated_time_for_dex("UNKNOWN"), "~2-3 min");
    }

    #[test]
    fn ensure_supported_starknet_swap_pair_rejects_non_starknet_tokens() {
        assert!(ensure_supported_starknet_swap_pair("STRK", "USDT").is_ok());
        assert!(ensure_supported_starknet_swap_pair("WBTC", "CAREL").is_ok());
        assert!(ensure_supported_starknet_swap_pair("ETH", "USDT").is_err());
        assert!(ensure_supported_starknet_swap_pair("BTC", "STRK").is_err());
    }

    #[test]
    fn parse_execute_calls_parses_single_call() {
        let to = Felt::from(10_u64);
        let selector = Felt::from(20_u64);
        let calldata = vec![
            Felt::from(1_u64),
            to,
            selector,
            Felt::from(0_u64),
            Felt::from(2_u64),
            Felt::from(2_u64),
            Felt::from(111_u64),
            Felt::from(222_u64),
        ];

        let calls = parse_execute_calls(&calldata).expect("must parse execute calldata");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].to, to);
        assert_eq!(calls[0].selector, selector);
        assert_eq!(
            calls[0].calldata,
            vec![Felt::from(111_u64), Felt::from(222_u64)]
        );
    }

    #[test]
    fn parse_execute_calls_parses_inline_single_call() {
        let to = Felt::from(10_u64);
        let selector = Felt::from(20_u64);
        let calldata = vec![
            Felt::from(1_u64),
            to,
            selector,
            Felt::from(4_u64),
            Felt::from(25_u64),
            Felt::from(0_u64),
            Felt::from(111_u64),
            Felt::from(222_u64),
        ];

        let calls = parse_execute_calls(&calldata).expect("must parse inline execute calldata");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].to, to);
        assert_eq!(calls[0].selector, selector);
        assert_eq!(
            calls[0].calldata,
            vec![
                Felt::from(25_u64),
                Felt::from(0_u64),
                Felt::from(111_u64),
                Felt::from(222_u64),
            ]
        );
    }

    #[test]
    fn verify_swap_invoke_payload_requires_sender_match() {
        let swap_contract = Felt::from(0x123_u64);
        let swap_selector = get_selector_from_name("swap").expect("selector");
        let from_token = parse_felt(token_address_for("STRK").unwrap()).expect("token");
        let to_token = parse_felt(token_address_for("USDT").unwrap()).expect("token");
        let tx = Transaction::Invoke(InvokeTransaction::V1(
            starknet_core::types::InvokeTransactionV1 {
                transaction_hash: Felt::from(1_u64),
                sender_address: Felt::from(0xdead_u64),
                calldata: vec![
                    Felt::from(1_u64),
                    swap_contract,
                    swap_selector,
                    Felt::from(0_u64),
                    Felt::from(4_u64),
                    Felt::from(4_u64),
                    Felt::from(25_u64),
                    Felt::from(0_u64),
                    from_token,
                    to_token,
                ],
                max_fee: Felt::from(0_u64),
                signature: Vec::new(),
                nonce: Felt::from(0_u64),
            },
        ));

        let result = verify_swap_invoke_payload(
            &tx,
            &[Felt::from(0xbeef_u64)],
            Some(swap_contract),
            &[from_token],
            &[to_token],
        );
        assert!(result.is_err());
    }

    #[test]
    fn verify_swap_invoke_payload_accepts_execute_swap_selector() {
        let swap_contract = Felt::from(0x123_u64);
        let execute_swap_selector = get_selector_from_name("execute_swap").expect("selector");
        let from_token = parse_felt(token_address_for("STRK").unwrap()).expect("token");
        let to_token = parse_felt(token_address_for("USDT").unwrap()).expect("token");
        let tx = Transaction::Invoke(InvokeTransaction::V1(
            starknet_core::types::InvokeTransactionV1 {
                transaction_hash: Felt::from(2_u64),
                sender_address: Felt::from(0xbeef_u64),
                calldata: vec![
                    Felt::from(1_u64),
                    swap_contract,
                    execute_swap_selector,
                    Felt::from(0_u64),
                    Felt::from(10_u64),
                    Felt::from(10_u64),
                    Felt::from(0x454b_u64), // dex_id
                    Felt::from(100_u64),    // expected low
                    Felt::from(0_u64),      // expected high
                    Felt::from(99_u64),     // min low
                    Felt::from(0_u64),      // min high
                    from_token,
                    to_token,
                    Felt::from(25_u64), // amount low
                    Felt::from(0_u64),  // amount high
                    Felt::from(0_u64),  // mev flag
                ],
                max_fee: Felt::from(0_u64),
                signature: Vec::new(),
                nonce: Felt::from(0_u64),
            },
        ));

        let result = verify_swap_invoke_payload(
            &tx,
            &[Felt::from(0xbeef_u64)],
            Some(swap_contract),
            &[from_token],
            &[to_token],
        );
        assert!(result.is_ok());
    }

    #[test]
    fn verify_swap_invoke_payload_rejects_wrong_approve_spender() {
        let swap_contract = Felt::from(0x123_u64);
        let execute_swap_selector = get_selector_from_name("execute_swap").expect("selector");
        let approve_selector = get_selector_from_name("approve").expect("selector");
        let from_token = parse_felt(token_address_for("STRK").unwrap()).expect("token");
        let to_token = parse_felt(token_address_for("USDT").unwrap()).expect("token");
        let tx = Transaction::Invoke(InvokeTransaction::V1(
            starknet_core::types::InvokeTransactionV1 {
                transaction_hash: Felt::from(3_u64),
                sender_address: Felt::from(0xbeef_u64),
                calldata: vec![
                    Felt::from(2_u64),
                    from_token,
                    approve_selector,
                    Felt::from(0_u64),
                    Felt::from(3_u64),
                    swap_contract,
                    execute_swap_selector,
                    Felt::from(3_u64),
                    Felt::from(10_u64),
                    Felt::from(13_u64),
                    Felt::from(0x999_u64), // wrong approve spender
                    Felt::from(25_u64),    // approve amount low
                    Felt::from(0_u64),     // approve amount high
                    Felt::from(0x454b_u64),
                    Felt::from(100_u64),
                    Felt::from(0_u64),
                    Felt::from(99_u64),
                    Felt::from(0_u64),
                    from_token,
                    to_token,
                    Felt::from(25_u64),
                    Felt::from(0_u64),
                    Felt::from(0_u64),
                ],
                max_fee: Felt::from(0_u64),
                signature: Vec::new(),
                nonce: Felt::from(0_u64),
            },
        ));

        let result = verify_swap_invoke_payload(
            &tx,
            &[Felt::from(0xbeef_u64)],
            Some(swap_contract),
            &[from_token],
            &[to_token],
        );
        assert!(result.is_err());
    }
}
