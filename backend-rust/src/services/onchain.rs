use crate::{config::Config, error::Result};
use starknet_accounts::{Account, ExecutionEncoding, SingleOwnerAccount};
use starknet_core::types::{
    BlockId, BlockTag, Call, Felt, FunctionCall, Transaction, TransactionReceiptWithBlockInfo,
};
use starknet_providers::jsonrpc::{HttpTransport, JsonRpcClient};
use starknet_providers::Provider;
use starknet_signers::{LocalWallet, SigningKey};
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use url::Url;

pub struct OnchainInvoker {
    account: SingleOwnerAccount<JsonRpcClient<HttpTransport>, LocalWallet>,
}

pub struct OnchainReader {
    provider: JsonRpcClient<HttpTransport>,
}

const STARKNET_RPC_MAX_INFLIGHT_DEFAULT: usize = 12;
const STARKNET_RPC_BREAKER_THRESHOLD: u32 = 3;
const STARKNET_RPC_BREAKER_BASE_SECS: u64 = 2;
const STARKNET_RPC_BREAKER_MAX_SECS: u64 = 60;

#[derive(Default)]
struct RpcCircuitBreaker {
    consecutive_failures: u32,
    open_until: Option<Instant>,
}

static STARKNET_RPC_SEMAPHORE: OnceLock<Arc<Semaphore>> = OnceLock::new();
static STARKNET_RPC_BREAKER: OnceLock<tokio::sync::RwLock<RpcCircuitBreaker>> = OnceLock::new();

fn env_non_empty(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn resolve_api_rpc_url(config: &Config) -> String {
    env_non_empty("STARKNET_API_RPC_URL").unwrap_or_else(|| config.starknet_rpc_url.clone())
}

fn configured_max_inflight() -> usize {
    std::env::var("STARKNET_RPC_MAX_INFLIGHT")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(STARKNET_RPC_MAX_INFLIGHT_DEFAULT)
}

fn rpc_semaphore() -> &'static Arc<Semaphore> {
    STARKNET_RPC_SEMAPHORE.get_or_init(|| Arc::new(Semaphore::new(configured_max_inflight())))
}

fn rpc_breaker() -> &'static tokio::sync::RwLock<RpcCircuitBreaker> {
    STARKNET_RPC_BREAKER.get_or_init(|| tokio::sync::RwLock::new(RpcCircuitBreaker::default()))
}

fn looks_like_transient_rpc_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("too many requests")
        || lower.contains("429")
        || lower.contains("timeout")
        || lower.contains("timed out")
        || lower.contains("gateway")
        || lower.contains("temporarily unavailable")
        || lower.contains("connection reset")
        || lower.contains("eof while parsing")
        || lower.contains("jsonrpcresponse")
        || lower.contains("error decoding response body")
        || lower.contains("unknown field `code`")
}

fn breaker_backoff_duration(failures: u32) -> Duration {
    if failures <= STARKNET_RPC_BREAKER_THRESHOLD {
        return Duration::from_secs(STARKNET_RPC_BREAKER_BASE_SECS);
    }
    let exponent = (failures - STARKNET_RPC_BREAKER_THRESHOLD).min(6);
    let multiplier = 1_u64 << exponent;
    let secs = STARKNET_RPC_BREAKER_BASE_SECS.saturating_mul(multiplier);
    Duration::from_secs(secs.min(STARKNET_RPC_BREAKER_MAX_SECS))
}

async fn rpc_preflight(method: &str) -> Result<OwnedSemaphorePermit> {
    let now = Instant::now();
    {
        let guard = rpc_breaker().read().await;
        if let Some(until) = guard.open_until {
            if until > now {
                let remain_ms = until.duration_since(now).as_millis();
                return Err(crate::error::AppError::BlockchainRPC(format!(
                    "{} skipped: Starknet RPC circuit open for {}ms",
                    method, remain_ms
                )));
            }
        }
    }

    rpc_semaphore()
        .clone()
        .acquire_owned()
        .await
        .map_err(|e| crate::error::AppError::Internal(format!("RPC semaphore closed: {}", e)))
}

async fn rpc_record_success() {
    let mut guard = rpc_breaker().write().await;
    if guard.consecutive_failures != 0 || guard.open_until.is_some() {
        guard.consecutive_failures = 0;
        guard.open_until = None;
    }
}

async fn rpc_record_failure(method: &str, error_text: &str) {
    if !looks_like_transient_rpc_error(error_text) {
        return;
    }

    let mut guard = rpc_breaker().write().await;
    guard.consecutive_failures = guard.consecutive_failures.saturating_add(1);
    if guard.consecutive_failures < STARKNET_RPC_BREAKER_THRESHOLD {
        return;
    }

    let backoff = breaker_backoff_duration(guard.consecutive_failures);
    let open_until = Instant::now() + backoff;
    let backoff_secs = backoff.as_secs();
    guard.open_until = Some(open_until);
    tracing::warn!(
        "{} transient RPC failure triggered circuit backoff={}s failures={}",
        method,
        backoff_secs,
        guard.consecutive_failures
    );
}

impl OnchainInvoker {
    pub fn from_config(config: &Config) -> Result<Option<Self>> {
        let account_address = resolve_backend_account(config);
        let Some(account_address) = account_address else {
            return Ok(None);
        };

        let rpc_url = Url::parse(&resolve_api_rpc_url(config))
            .map_err(|e| crate::error::AppError::Internal(format!("Invalid RPC URL: {}", e)))?;
        let provider = JsonRpcClient::new(HttpTransport::new(rpc_url));

        let private_key = parse_felt(&config.backend_private_key)?;
        let signer = LocalWallet::from_signing_key(SigningKey::from_secret_scalar(private_key));

        let account_address = parse_felt(account_address)?;
        let chain_id = parse_chain_id(&config.starknet_chain_id)?;

        let mut account = SingleOwnerAccount::new(
            provider,
            signer,
            account_address,
            chain_id,
            ExecutionEncoding::New,
        );
        // Some public RPC providers don't support "pre_confirmed" yet.
        // Force latest block tag for nonce/fee simulation compatibility.
        account.set_block_id(BlockId::Tag(BlockTag::Latest));

        Ok(Some(Self { account }))
    }

    pub async fn invoke(&self, call: Call) -> Result<Felt> {
        let _permit = rpc_preflight("starknet_invoke").await?;
        let response = self
            .account
            .execute_v3(vec![call])
            .send()
            .await
            .map_err(|e| crate::error::AppError::BlockchainRPC(e.to_string()));
        match &response {
            Ok(_) => rpc_record_success().await,
            Err(crate::error::AppError::BlockchainRPC(err_text)) => {
                rpc_record_failure("starknet_invoke", err_text).await;
            }
            Err(_) => {}
        }
        let result = response?;
        Ok(result.transaction_hash)
    }

    pub async fn invoke_many(&self, calls: Vec<Call>) -> Result<Felt> {
        if calls.is_empty() {
            return Err(crate::error::AppError::BadRequest(
                "No on-chain calls to execute".to_string(),
            ));
        }
        let _permit = rpc_preflight("starknet_invoke_many").await?;
        let response = self
            .account
            .execute_v3(calls)
            .send()
            .await
            .map_err(|e| crate::error::AppError::BlockchainRPC(e.to_string()));
        match &response {
            Ok(_) => rpc_record_success().await,
            Err(crate::error::AppError::BlockchainRPC(err_text)) => {
                rpc_record_failure("starknet_invoke_many", err_text).await;
            }
            Err(_) => {}
        }
        let result = response?;
        Ok(result.transaction_hash)
    }
}

impl OnchainReader {
    pub fn from_config(config: &Config) -> Result<Self> {
        let rpc_url = Url::parse(&resolve_api_rpc_url(config))
            .map_err(|e| crate::error::AppError::Internal(format!("Invalid RPC URL: {}", e)))?;
        let provider = JsonRpcClient::new(HttpTransport::new(rpc_url));
        Ok(Self { provider })
    }

    pub async fn call(&self, call: FunctionCall) -> Result<Vec<Felt>> {
        let _permit = rpc_preflight("starknet_call").await?;
        let response = self
            .provider
            .call(call, BlockId::Tag(BlockTag::Latest))
            .await
            .map_err(|e| crate::error::AppError::BlockchainRPC(e.to_string()));
        match &response {
            Ok(_) => rpc_record_success().await,
            Err(crate::error::AppError::BlockchainRPC(err_text)) => {
                rpc_record_failure("starknet_call", err_text).await;
            }
            Err(_) => {}
        }
        response
    }

    pub async fn get_transaction_receipt(
        &self,
        tx_hash: &Felt,
    ) -> Result<TransactionReceiptWithBlockInfo> {
        let _permit = rpc_preflight("starknet_getTransactionReceipt").await?;
        let response = self
            .provider
            .get_transaction_receipt(tx_hash)
            .await
            .map_err(|e| crate::error::AppError::BlockchainRPC(e.to_string()));
        match &response {
            Ok(_) => rpc_record_success().await,
            Err(crate::error::AppError::BlockchainRPC(err_text)) => {
                rpc_record_failure("starknet_getTransactionReceipt", err_text).await;
            }
            Err(_) => {}
        }
        response
    }

    pub async fn get_transaction(&self, tx_hash: &Felt) -> Result<Transaction> {
        let _permit = rpc_preflight("starknet_getTransactionByHash").await?;
        let response = self
            .provider
            .get_transaction_by_hash(tx_hash)
            .await
            .map_err(|e| crate::error::AppError::BlockchainRPC(e.to_string()));
        match &response {
            Ok(_) => rpc_record_success().await,
            Err(crate::error::AppError::BlockchainRPC(err_text)) => {
                rpc_record_failure("starknet_getTransactionByHash", err_text).await;
            }
            Err(_) => {}
        }
        response
    }

    pub async fn get_storage_at(&self, contract_address: Felt, key: Felt) -> Result<Felt> {
        let _permit = rpc_preflight("starknet_getStorageAt").await?;
        let response = self
            .provider
            .get_storage_at(contract_address, key, BlockId::Tag(BlockTag::Latest))
            .await
            .map_err(|e| crate::error::AppError::BlockchainRPC(e.to_string()));
        match &response {
            Ok(_) => rpc_record_success().await,
            Err(crate::error::AppError::BlockchainRPC(err_text)) => {
                rpc_record_failure("starknet_getStorageAt", err_text).await;
            }
            Err(_) => {}
        }
        response
    }
}

pub fn resolve_backend_account(config: &Config) -> Option<&str> {
    if let Some(addr) = &config.backend_account_address {
        return Some(addr.as_str());
    }
    if config.backend_public_key.starts_with("0x") {
        return Some(config.backend_public_key.as_str());
    }
    None
}

pub fn parse_chain_id(chain_id: &str) -> Result<Felt> {
    if chain_id.starts_with("0x") {
        return parse_felt(chain_id);
    }
    let hex = hex::encode(chain_id.as_bytes());
    parse_felt(&format!("0x{hex}"))
}

pub fn parse_felt(value: &str) -> Result<Felt> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(crate::error::AppError::Internal(
            "Empty field element".to_string(),
        ));
    }
    if trimmed.starts_with("0x") {
        return Felt::from_hex(trimmed)
            .map_err(|e| crate::error::AppError::Internal(format!("Invalid felt hex: {}", e)));
    }
    Felt::from_dec_str(trimmed)
        .map_err(|e| crate::error::AppError::Internal(format!("Invalid felt dec: {}", e)))
}

pub fn felt_to_u128(value: &Felt) -> Result<u128> {
    let text = value.to_string();
    if let Some(stripped) = text.strip_prefix("0x") {
        u128::from_str_radix(stripped, 16)
            .map_err(|e| crate::error::AppError::Internal(format!("Invalid felt hex: {}", e)))
    } else {
        text.parse::<u128>()
            .map_err(|e| crate::error::AppError::Internal(format!("Invalid felt dec: {}", e)))
    }
}

pub fn u256_from_felts(low: &Felt, high: &Felt) -> Result<u128> {
    let low = felt_to_u128(low)?;
    let high = felt_to_u128(high)?;
    if high != 0 {
        return Err(crate::error::AppError::Internal(
            "u256 value too large".to_string(),
        ));
    }
    Ok(low)
}

pub fn u256_to_felts(value: u128) -> (Felt, Felt) {
    (Felt::from(value), Felt::from(0_u128))
}
