use axum::{extract::State, http::HeaderMap, Json};
use ethers::{
    providers::{Http, Provider, Middleware},
    types::{Address, U256},
};
use serde::{Deserialize, Serialize};
use starknet_core::types::FunctionCall;
use starknet_core::utils::get_selector_from_name;
use std::str::FromStr;
use std::sync::Arc;

use crate::{
    config::Config,
    error::{AppError, Result},
    models::ApiResponse,
    services::onchain::{parse_felt, u256_from_felts, OnchainReader},
};

use super::{AppState, require_user};

#[derive(Debug, Deserialize)]
pub struct OnchainBalanceRequest {
    pub starknet_address: Option<String>,
    pub evm_address: Option<String>,
    pub btc_address: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LinkWalletAddressRequest {
    pub chain: String,
    pub address: String,
    pub provider: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LinkWalletAddressResponse {
    pub user_address: String,
    pub chain: String,
    pub address: String,
}

#[derive(Debug, Serialize, Default)]
pub struct LinkedWalletsResponse {
    pub starknet_address: Option<String>,
    pub evm_address: Option<String>,
    pub btc_address: Option<String>,
}

#[derive(Debug, Serialize, Default)]
pub struct OnchainBalanceResponse {
    pub strk_l2: Option<f64>,
    pub strk_l1: Option<f64>,
    pub eth: Option<f64>,
    pub btc: Option<f64>,
}

/// POST /api/v1/wallet/onchain-balances
pub async fn get_onchain_balances(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<OnchainBalanceRequest>,
) -> Result<Json<ApiResponse<OnchainBalanceResponse>>> {
    let user_address = require_user(&headers, &state).await?;
    let linked_wallets = state.db.list_wallet_addresses(&user_address).await.unwrap_or_default();

    let starknet_address = req.starknet_address.or_else(|| {
        linked_wallets
            .iter()
            .find(|item| item.chain == "starknet")
            .map(|item| item.wallet_address.clone())
    });
    let evm_address = req.evm_address.or_else(|| {
        linked_wallets
            .iter()
            .find(|item| item.chain == "evm")
            .map(|item| item.wallet_address.clone())
    });
    let btc_address = req.btc_address.or_else(|| {
        linked_wallets
            .iter()
            .find(|item| item.chain == "bitcoin")
            .map(|item| item.wallet_address.clone())
    });

    let mut response = OnchainBalanceResponse::default();

    if let (Some(addr), Some(token)) = (starknet_address.as_ref(), state.config.token_strk_address.as_ref()) {
        response.strk_l2 = fetch_starknet_erc20_balance(&state.config, addr, token).await?;
    }

    if let Some(evm_addr) = evm_address.as_ref() {
        response.eth = fetch_evm_native_balance(&state.config, evm_addr).await?;
        if let Some(token) = state.config.token_strk_l1_address.as_ref() {
            response.strk_l1 = fetch_evm_erc20_balance(&state.config, evm_addr, token).await?;
        }
    }

    if let Some(btc_addr) = btc_address.as_ref() {
        response.btc = fetch_btc_balance(&state.config, btc_addr).await?;
    }

    Ok(Json(ApiResponse::success(response)))
}

/// POST /api/v1/wallet/link
pub async fn link_wallet_address(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<LinkWalletAddressRequest>,
) -> Result<Json<ApiResponse<LinkWalletAddressResponse>>> {
    let user_address = require_user(&headers, &state).await?;
    let chain = normalize_wallet_chain(&req.chain)
        .ok_or_else(|| AppError::BadRequest("Unsupported wallet chain".to_string()))?;
    let wallet_address = req.address.trim();
    if wallet_address.is_empty() {
        return Err(AppError::BadRequest("Wallet address is required".to_string()));
    }

    state
        .db
        .upsert_wallet_address(&user_address, chain, wallet_address, req.provider.as_deref())
        .await?;

    Ok(Json(ApiResponse::success(LinkWalletAddressResponse {
        user_address,
        chain: chain.to_string(),
        address: wallet_address.to_string(),
    })))
}

/// GET /api/v1/wallet/linked
pub async fn get_linked_wallets(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<LinkedWalletsResponse>>> {
    let user_address = require_user(&headers, &state).await?;
    let linked_wallets = state.db.list_wallet_addresses(&user_address).await?;

    let mut response = LinkedWalletsResponse::default();
    for linked in linked_wallets {
        match linked.chain.as_str() {
            "starknet" => response.starknet_address = Some(linked.wallet_address),
            "evm" => response.evm_address = Some(linked.wallet_address),
            "bitcoin" => response.btc_address = Some(linked.wallet_address),
            _ => {}
        }
    }

    Ok(Json(ApiResponse::success(response)))
}

fn normalize_wallet_chain(chain: &str) -> Option<&'static str> {
    match chain.trim().to_ascii_lowercase().as_str() {
        "starknet" | "strk" => Some("starknet"),
        "evm" | "ethereum" | "eth" => Some("evm"),
        "bitcoin" | "btc" => Some("bitcoin"),
        _ => None,
    }
}

pub(crate) async fn fetch_starknet_erc20_balance(
    config: &Config,
    owner: &str,
    token: &str,
) -> Result<Option<f64>> {
    if token.trim().is_empty() || owner.trim().is_empty() {
        return Ok(None);
    }
    let reader = OnchainReader::from_config(config)?;
    let token_felt = parse_felt(token)?;
    let owner_felt = parse_felt(owner)?;
    let selector = get_selector_from_name("balanceOf")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let call = FunctionCall {
        contract_address: token_felt,
        entry_point_selector: selector,
        calldata: vec![owner_felt],
    };
    let values = reader.call(call).await?;
    let low = values.get(0).ok_or_else(|| AppError::Internal("Balance low missing".into()))?;
    let high = values.get(1).ok_or_else(|| AppError::Internal("Balance high missing".into()))?;
    let raw = u256_from_felts(low, high)?;
    let decimals = fetch_starknet_decimals(config, token).await.unwrap_or(18);
    Ok(Some(scale_u128(raw, decimals)))
}

pub(crate) async fn fetch_starknet_decimals(config: &Config, token: &str) -> Result<u8> {
    let reader = OnchainReader::from_config(config)?;
    let token_felt = parse_felt(token)?;
    let selector = get_selector_from_name("decimals")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let call = FunctionCall {
        contract_address: token_felt,
        entry_point_selector: selector,
        calldata: vec![],
    };
    let values = reader.call(call).await?;
    let value = values
        .get(0)
        .ok_or_else(|| AppError::Internal("Decimals missing".into()))?;
    let parsed = value
        .to_string()
        .trim_start_matches("0x")
        .parse::<u8>()
        .unwrap_or(18);
    Ok(parsed)
}

pub(crate) async fn fetch_evm_native_balance(config: &Config, address: &str) -> Result<Option<f64>> {
    if address.trim().is_empty() {
        return Ok(None);
    }
    let provider = Provider::<Http>::try_from(&config.ethereum_rpc_url)
        .map_err(|e| AppError::Internal(format!("Invalid EVM RPC URL: {}", e)))?;
    let provider = Arc::new(provider);
    let addr = Address::from_str(address)
        .map_err(|_| AppError::BadRequest("Invalid EVM address".to_string()))?;
    let balance = provider
        .get_balance(addr, None)
        .await
        .map_err(|e| AppError::BlockchainRPC(e.to_string()))?;
    Ok(Some(scale_u256(balance, 18)))
}

pub(crate) async fn fetch_evm_erc20_balance(
    config: &Config,
    address: &str,
    token: &str,
) -> Result<Option<f64>> {
    if token.trim().is_empty() || address.trim().is_empty() {
        return Ok(None);
    }
    let provider = Provider::<Http>::try_from(&config.ethereum_rpc_url)
        .map_err(|e| AppError::Internal(format!("Invalid EVM RPC URL: {}", e)))?;
    let provider = Arc::new(provider);
    let addr = Address::from_str(address)
        .map_err(|_| AppError::BadRequest("Invalid EVM address".to_string()))?;
    let token_addr = Address::from_str(token)
        .map_err(|_| AppError::BadRequest("Invalid ERC20 address".to_string()))?;
    let erc20 = Erc20::new(token_addr, provider.clone());
    let balance = erc20
        .balance_of(addr)
        .call()
        .await
        .map_err(|e| AppError::BlockchainRPC(e.to_string()))?;
    let decimals = erc20.decimals().call().await.unwrap_or(18);
    Ok(Some(scale_u256(balance, decimals)))
}

pub(crate) async fn fetch_btc_balance(config: &Config, address: &str) -> Result<Option<f64>> {
    if address.trim().is_empty() {
        return Ok(None);
    }
    if config.xverse_api_url.trim().is_empty() {
        return Ok(None);
    }
    let url = format!(
        "{}/address/{}/balance",
        config.xverse_api_url.trim_end_matches('/'),
        address
    );
    let client = reqwest::Client::new();
    let mut req = client.get(url);
    if let Some(key) = &config.xverse_api_key {
        req = req.bearer_auth(key);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| AppError::ExternalAPI(e.to_string()))?;
    if !resp.status().is_success() {
        return Ok(None);
    }
    let payload: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::ExternalAPI(e.to_string()))?;
    let candidate = payload
        .get("balance")
        .or_else(|| payload.get("sats"))
        .or_else(|| payload.get("confirmed"))
        .or_else(|| payload.get("total"))
        .and_then(|v| v.as_f64());
    Ok(candidate.map(|sats| sats / 100_000_000.0))
}

fn scale_u128(value: u128, decimals: u8) -> f64 {
    let base = 10_f64.powi(decimals as i32);
    (value as f64) / base
}

fn scale_u256(value: U256, decimals: u8) -> f64 {
    let base = 10_f64.powi(decimals as i32);
    let raw = value.as_u128() as f64;
    raw / base
}

ethers::contract::abigen!(
    Erc20,
    r#"[
        function balanceOf(address) view returns (uint256)
        function decimals() view returns (uint8)
    ]"#
);
