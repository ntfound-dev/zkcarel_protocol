use crate::{config::Config, error::Result};
use starknet_accounts::{Account, ExecutionEncoding, SingleOwnerAccount};
use starknet_core::types::{
    BlockId, BlockTag, Call, ContractClass, Felt, FunctionCall, Transaction,
    TransactionReceiptWithBlockInfo,
};
use starknet_providers::jsonrpc::{HttpTransport, JsonRpcClient};
use starknet_providers::Provider;
use starknet_signers::{LocalWallet, SigningKey};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore};
use tokio::time::sleep;
use url::Url;

pub struct OnchainInvoker {
    account: SingleOwnerAccount<JsonRpcClient<HttpTransport>, LocalWallet>,
}

pub struct OnchainReader {
    providers: Vec<JsonRpcClient<HttpTransport>>,
    provider_urls: Vec<String>,
    rr_cursor: AtomicUsize,
}

const STARKNET_RPC_MAX_INFLIGHT_DEFAULT: usize = 6;
const STARKNET_RPC_BREAKER_THRESHOLD: u32 = 3;
const STARKNET_RPC_BREAKER_BASE_SECS: u64 = 2;
const STARKNET_RPC_BREAKER_MAX_SECS: u64 = 180;
const STARKNET_NONCE_RETRY_ATTEMPTS: usize = 2;
const STARKNET_NONCE_RETRY_DELAY_MS: u64 = 650;

#[derive(Default)]
struct RpcCircuitBreaker {
    consecutive_failures: u32,
    open_until: Option<Instant>,
}

static STARKNET_RPC_SEMAPHORE: OnceLock<Arc<Semaphore>> = OnceLock::new();
static STARKNET_RPC_BREAKER: OnceLock<tokio::sync::RwLock<RpcCircuitBreaker>> = OnceLock::new();
static STARKNET_TX_SUBMIT_MUTEX: OnceLock<Arc<Mutex<()>>> = OnceLock::new();

// Internal helper that supports `env_non_empty` operations.
fn env_non_empty(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

// Internal helper that supports `parse_rpc_url_list` operations.
fn parse_rpc_url_list(raw: &str) -> Vec<String> {
    raw.split([',', ';', '\n', '\r', ' '])
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect()
}

// Internal helper that supports `env_rpc_urls` operations.
fn env_rpc_urls(name: &str) -> Vec<String> {
    env_non_empty(name)
        .map(|raw| parse_rpc_url_list(&raw))
        .unwrap_or_default()
}

// Internal helper that supports `dedupe_rpc_urls` operations.
fn dedupe_rpc_urls(urls: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for url in urls {
        if !out.iter().any(|existing| existing == &url) {
            out.push(url);
        }
    }
    out
}

// Internal helper that supports `resolve_api_rpc_urls` operations.
fn resolve_api_rpc_urls(config: &Config) -> Vec<String> {
    let mut urls = env_rpc_urls("STARKNET_API_RPC_POOL");
    if urls.is_empty() {
        urls.extend(env_rpc_urls("STARKNET_API_RPC_URL"));
    }
    if urls.is_empty() {
        urls.extend(env_rpc_urls("STARKNET_RPC_POOL"));
    }
    if urls.is_empty() {
        urls.extend(env_rpc_urls("STARKNET_RPC_URL"));
    }
    if urls.is_empty() && !config.starknet_rpc_url.trim().is_empty() {
        urls.extend(parse_rpc_url_list(&config.starknet_rpc_url));
    }
    dedupe_rpc_urls(urls)
}

// Internal helper that supports `resolve_wallet_rpc_urls` operations.
fn resolve_wallet_rpc_urls(config: &Config) -> Vec<String> {
    let mut urls = env_rpc_urls("STARKNET_WALLET_RPC_POOL");
    if urls.is_empty() {
        urls.extend(env_rpc_urls("STARKNET_WALLET_RPC_URL"));
    }
    if urls.is_empty() {
        urls = resolve_api_rpc_urls(config);
    }
    dedupe_rpc_urls(urls)
}

// Internal helper that fetches data for `resolve_api_rpc_url`.
fn resolve_api_rpc_url(config: &Config) -> String {
    resolve_api_rpc_urls(config)
        .into_iter()
        .next()
        .unwrap_or_else(|| config.starknet_rpc_url.clone())
}

// Internal helper that supports `configured_max_inflight` operations.
fn configured_max_inflight() -> usize {
    std::env::var("STARKNET_RPC_MAX_INFLIGHT")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(STARKNET_RPC_MAX_INFLIGHT_DEFAULT)
}

// Internal helper that supports `rpc_semaphore` operations.
fn rpc_semaphore() -> &'static Arc<Semaphore> {
    STARKNET_RPC_SEMAPHORE.get_or_init(|| Arc::new(Semaphore::new(configured_max_inflight())))
}

// Internal helper that supports `rpc_breaker` operations.
fn rpc_breaker() -> &'static tokio::sync::RwLock<RpcCircuitBreaker> {
    STARKNET_RPC_BREAKER.get_or_init(|| tokio::sync::RwLock::new(RpcCircuitBreaker::default()))
}

// Internal helper that supports `tx_submit_mutex` operations.
fn tx_submit_mutex() -> &'static Arc<Mutex<()>> {
    STARKNET_TX_SUBMIT_MUTEX.get_or_init(|| Arc::new(Mutex::new(())))
}

// Internal helper that supports `looks_like_transient_rpc_error` operations.
fn looks_like_transient_rpc_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("too many requests")
        || lower.contains("429")
        || lower.contains("cu limit exceeded")
        || lower.contains("request too fast")
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

// Internal helper that checks conditions for `is_invalid_nonce_error`.
fn is_invalid_nonce_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("invalid transaction nonce")
        || lower.contains("invalid nonce")
        || lower.contains("nonce too low")
        || lower.contains("nonce has already been used")
}

// Internal helper that supports `breaker_backoff_duration` operations.
fn breaker_backoff_duration(failures: u32) -> Duration {
    if failures <= STARKNET_RPC_BREAKER_THRESHOLD {
        return Duration::from_secs(STARKNET_RPC_BREAKER_BASE_SECS);
    }
    let exponent = (failures - STARKNET_RPC_BREAKER_THRESHOLD).min(6);
    let multiplier = 1_u64 << exponent;
    let secs = STARKNET_RPC_BREAKER_BASE_SECS.saturating_mul(multiplier);
    Duration::from_secs(secs.min(STARKNET_RPC_BREAKER_MAX_SECS))
}

// Internal helper that supports `rpc_preflight` operations.
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

// Internal helper that supports `rpc_record_success` operations.
async fn rpc_record_success() {
    let mut guard = rpc_breaker().write().await;
    if guard.consecutive_failures != 0 || guard.open_until.is_some() {
        guard.consecutive_failures = 0;
        guard.open_until = None;
    }
}

// Internal helper that supports `rpc_record_failure` operations.
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
    /// Handles `from_config` logic.
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

    /// Runs `invoke` and handles related side effects.
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
    pub async fn invoke(&self, call: Call) -> Result<Felt> {
        let _permit = rpc_preflight("starknet_invoke").await?;
        let _submit_guard = tx_submit_mutex().lock().await;
        for attempt in 0..=STARKNET_NONCE_RETRY_ATTEMPTS {
            let response = self
                .account
                .execute_v3(vec![call.clone()])
                .send()
                .await
                .map_err(|e| crate::error::AppError::BlockchainRPC(e.to_string()));
            match response {
                Ok(result) => {
                    rpc_record_success().await;
                    return Ok(result.transaction_hash);
                }
                Err(crate::error::AppError::BlockchainRPC(err_text)) => {
                    if attempt < STARKNET_NONCE_RETRY_ATTEMPTS && is_invalid_nonce_error(&err_text)
                    {
                        tracing::warn!(
                            "starknet_invoke invalid nonce (attempt {}), retrying in {}ms: {}",
                            attempt + 1,
                            STARKNET_NONCE_RETRY_DELAY_MS,
                            err_text
                        );
                        sleep(Duration::from_millis(STARKNET_NONCE_RETRY_DELAY_MS)).await;
                        continue;
                    }
                    rpc_record_failure("starknet_invoke", &err_text).await;
                    return Err(crate::error::AppError::BlockchainRPC(err_text));
                }
                Err(err) => {
                    return Err(err);
                }
            }
        }
        Err(crate::error::AppError::BlockchainRPC(
            "Failed to submit Starknet invoke after nonce retries".to_string(),
        ))
    }

    /// Runs `invoke_many` and handles related side effects.
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
    pub async fn invoke_many(&self, calls: Vec<Call>) -> Result<Felt> {
        if calls.is_empty() {
            return Err(crate::error::AppError::BadRequest(
                "No on-chain calls to execute".to_string(),
            ));
        }
        let _permit = rpc_preflight("starknet_invoke_many").await?;
        let _submit_guard = tx_submit_mutex().lock().await;
        for attempt in 0..=STARKNET_NONCE_RETRY_ATTEMPTS {
            let response = self
                .account
                .execute_v3(calls.clone())
                .send()
                .await
                .map_err(|e| crate::error::AppError::BlockchainRPC(e.to_string()));
            match response {
                Ok(result) => {
                    rpc_record_success().await;
                    return Ok(result.transaction_hash);
                }
                Err(crate::error::AppError::BlockchainRPC(err_text)) => {
                    if attempt < STARKNET_NONCE_RETRY_ATTEMPTS && is_invalid_nonce_error(&err_text)
                    {
                        tracing::warn!(
                            "starknet_invoke_many invalid nonce (attempt {}), retrying in {}ms: {}",
                            attempt + 1,
                            STARKNET_NONCE_RETRY_DELAY_MS,
                            err_text
                        );
                        sleep(Duration::from_millis(STARKNET_NONCE_RETRY_DELAY_MS)).await;
                        continue;
                    }
                    rpc_record_failure("starknet_invoke_many", &err_text).await;
                    return Err(crate::error::AppError::BlockchainRPC(err_text));
                }
                Err(err) => {
                    return Err(err);
                }
            }
        }
        Err(crate::error::AppError::BlockchainRPC(
            "Failed to submit Starknet multicall after nonce retries".to_string(),
        ))
    }
}

impl OnchainReader {
    // Internal helper that supports `from_rpc_urls` operations.
    fn from_rpc_urls(rpc_urls: Vec<String>) -> Result<Self> {
        if rpc_urls.is_empty() {
            return Err(crate::error::AppError::Internal(
                "No Starknet RPC URL configured for OnchainReader".to_string(),
            ));
        }
        let mut providers = Vec::with_capacity(rpc_urls.len());
        for rpc in &rpc_urls {
            let rpc_url = Url::parse(rpc).map_err(|e| {
                crate::error::AppError::Internal(format!("Invalid RPC URL '{}': {}", rpc, e))
            })?;
            providers.push(JsonRpcClient::new(HttpTransport::new(rpc_url)));
        }
        Ok(Self {
            providers,
            provider_urls: rpc_urls,
            rr_cursor: AtomicUsize::new(0),
        })
    }

    // Internal helper that supports `provider_order` operations.
    fn provider_order(&self) -> Vec<usize> {
        let len = self.providers.len();
        if len <= 1 {
            return vec![0];
        }
        let start = self.rr_cursor.fetch_add(1, Ordering::Relaxed) % len;
        (0..len).map(|offset| (start + offset) % len).collect()
    }

    /// Handles `from_config` logic.
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
    pub fn from_config(config: &Config) -> Result<Self> {
        Self::from_rpc_urls(resolve_api_rpc_urls(config))
    }

    /// Handles `from_config_for_wallet` logic.
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
    pub fn from_config_for_wallet(config: &Config) -> Result<Self> {
        Self::from_rpc_urls(resolve_wallet_rpc_urls(config))
    }

    /// Handles `call` logic.
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
    pub async fn call(&self, call: FunctionCall) -> Result<Vec<Felt>> {
        let _permit = rpc_preflight("starknet_call").await?;
        let order = self.provider_order();
        let mut last_error_text: Option<String> = None;

        for (attempt, provider_index) in order.iter().enumerate() {
            let response = self.providers[*provider_index]
                .call(call.clone(), BlockId::Tag(BlockTag::Latest))
                .await
                .map_err(|e| crate::error::AppError::BlockchainRPC(e.to_string()));
            match response {
                Ok(values) => {
                    rpc_record_success().await;
                    return Ok(values);
                }
                Err(crate::error::AppError::BlockchainRPC(err_text)) => {
                    last_error_text = Some(err_text.clone());
                    let is_transient = looks_like_transient_rpc_error(&err_text);
                    let has_next = attempt + 1 < order.len();
                    if has_next && is_transient {
                        tracing::warn!(
                            "starknet_call failed on provider {} ({}), trying next RPC: {}",
                            provider_index,
                            self.provider_urls
                                .get(*provider_index)
                                .cloned()
                                .unwrap_or_else(|| "<unknown>".to_string()),
                            err_text
                        );
                        continue;
                    }
                    if has_next {
                        continue;
                    }
                }
                Err(err) => return Err(err),
            }
        }

        if let Some(err_text) = last_error_text {
            rpc_record_failure("starknet_call", &err_text).await;
            return Err(crate::error::AppError::BlockchainRPC(err_text));
        }
        Err(crate::error::AppError::BlockchainRPC(
            "starknet_call failed without detailed error".to_string(),
        ))
    }

    /// Fetches data for `get_transaction_receipt`.
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
    pub async fn get_transaction_receipt(
        &self,
        tx_hash: &Felt,
    ) -> Result<TransactionReceiptWithBlockInfo> {
        let _permit = rpc_preflight("starknet_getTransactionReceipt").await?;
        let order = self.provider_order();
        let mut last_error_text: Option<String> = None;

        for (attempt, provider_index) in order.iter().enumerate() {
            let response = self.providers[*provider_index]
                .get_transaction_receipt(tx_hash)
                .await
                .map_err(|e| crate::error::AppError::BlockchainRPC(e.to_string()));
            match response {
                Ok(receipt) => {
                    rpc_record_success().await;
                    return Ok(receipt);
                }
                Err(crate::error::AppError::BlockchainRPC(err_text)) => {
                    last_error_text = Some(err_text.clone());
                    if attempt + 1 < order.len() && looks_like_transient_rpc_error(&err_text) {
                        continue;
                    }
                    if attempt + 1 < order.len() {
                        continue;
                    }
                }
                Err(err) => return Err(err),
            }
        }

        if let Some(err_text) = last_error_text {
            rpc_record_failure("starknet_getTransactionReceipt", &err_text).await;
            return Err(crate::error::AppError::BlockchainRPC(err_text));
        }
        Err(crate::error::AppError::BlockchainRPC(
            "starknet_getTransactionReceipt failed without detailed error".to_string(),
        ))
    }

    /// Fetches data for `get_transaction`.
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
    pub async fn get_transaction(&self, tx_hash: &Felt) -> Result<Transaction> {
        let _permit = rpc_preflight("starknet_getTransactionByHash").await?;
        let order = self.provider_order();
        let mut last_error_text: Option<String> = None;

        for (attempt, provider_index) in order.iter().enumerate() {
            let response = self.providers[*provider_index]
                .get_transaction_by_hash(tx_hash)
                .await
                .map_err(|e| crate::error::AppError::BlockchainRPC(e.to_string()));
            match response {
                Ok(tx) => {
                    rpc_record_success().await;
                    return Ok(tx);
                }
                Err(crate::error::AppError::BlockchainRPC(err_text)) => {
                    last_error_text = Some(err_text.clone());
                    if attempt + 1 < order.len() && looks_like_transient_rpc_error(&err_text) {
                        continue;
                    }
                    if attempt + 1 < order.len() {
                        continue;
                    }
                }
                Err(err) => return Err(err),
            }
        }

        if let Some(err_text) = last_error_text {
            rpc_record_failure("starknet_getTransactionByHash", &err_text).await;
            return Err(crate::error::AppError::BlockchainRPC(err_text));
        }
        Err(crate::error::AppError::BlockchainRPC(
            "starknet_getTransactionByHash failed without detailed error".to_string(),
        ))
    }

    /// Fetches data for `get_class_at`.
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
    pub async fn get_class_at(&self, contract_address: Felt) -> Result<ContractClass> {
        let _permit = rpc_preflight("starknet_getClassAt").await?;
        let order = self.provider_order();
        let mut last_error_text: Option<String> = None;

        for (attempt, provider_index) in order.iter().enumerate() {
            let response = self.providers[*provider_index]
                .get_class_at(BlockId::Tag(BlockTag::Latest), contract_address)
                .await
                .map_err(|e| crate::error::AppError::BlockchainRPC(e.to_string()));
            match response {
                Ok(class_data) => {
                    rpc_record_success().await;
                    return Ok(class_data);
                }
                Err(crate::error::AppError::BlockchainRPC(err_text)) => {
                    last_error_text = Some(err_text.clone());
                    if attempt + 1 < order.len() && looks_like_transient_rpc_error(&err_text) {
                        continue;
                    }
                    if attempt + 1 < order.len() {
                        continue;
                    }
                }
                Err(err) => return Err(err),
            }
        }

        if let Some(err_text) = last_error_text {
            rpc_record_failure("starknet_getClassAt", &err_text).await;
            return Err(crate::error::AppError::BlockchainRPC(err_text));
        }
        Err(crate::error::AppError::BlockchainRPC(
            "starknet_getClassAt failed without detailed error".to_string(),
        ))
    }

    /// Fetches data for `get_class_hash_at`.
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
    pub async fn get_class_hash_at(&self, contract_address: Felt) -> Result<Felt> {
        let _permit = rpc_preflight("starknet_getClassHashAt").await?;
        let order = self.provider_order();
        let mut last_error_text: Option<String> = None;

        for (attempt, provider_index) in order.iter().enumerate() {
            let response = self.providers[*provider_index]
                .get_class_hash_at(BlockId::Tag(BlockTag::Latest), contract_address)
                .await
                .map_err(|e| crate::error::AppError::BlockchainRPC(e.to_string()));
            match response {
                Ok(class_hash) => {
                    rpc_record_success().await;
                    return Ok(class_hash);
                }
                Err(crate::error::AppError::BlockchainRPC(err_text)) => {
                    last_error_text = Some(err_text.clone());
                    if attempt + 1 < order.len() && looks_like_transient_rpc_error(&err_text) {
                        continue;
                    }
                    if attempt + 1 < order.len() {
                        continue;
                    }
                }
                Err(err) => return Err(err),
            }
        }

        if let Some(err_text) = last_error_text {
            rpc_record_failure("starknet_getClassHashAt", &err_text).await;
            return Err(crate::error::AppError::BlockchainRPC(err_text));
        }
        Err(crate::error::AppError::BlockchainRPC(
            "starknet_getClassHashAt failed without detailed error".to_string(),
        ))
    }

    /// Fetches data for `get_storage_at`.
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
    pub async fn get_storage_at(&self, contract_address: Felt, key: Felt) -> Result<Felt> {
        let _permit = rpc_preflight("starknet_getStorageAt").await?;
        let order = self.provider_order();
        let mut last_error_text: Option<String> = None;

        for (attempt, provider_index) in order.iter().enumerate() {
            let response = self.providers[*provider_index]
                .get_storage_at(contract_address, key, BlockId::Tag(BlockTag::Latest))
                .await
                .map_err(|e| crate::error::AppError::BlockchainRPC(e.to_string()));
            match response {
                Ok(storage) => {
                    rpc_record_success().await;
                    return Ok(storage);
                }
                Err(crate::error::AppError::BlockchainRPC(err_text)) => {
                    last_error_text = Some(err_text.clone());
                    if attempt + 1 < order.len() && looks_like_transient_rpc_error(&err_text) {
                        continue;
                    }
                    if attempt + 1 < order.len() {
                        continue;
                    }
                }
                Err(err) => return Err(err),
            }
        }

        if let Some(err_text) = last_error_text {
            rpc_record_failure("starknet_getStorageAt", &err_text).await;
            return Err(crate::error::AppError::BlockchainRPC(err_text));
        }
        Err(crate::error::AppError::BlockchainRPC(
            "starknet_getStorageAt failed without detailed error".to_string(),
        ))
    }
}

/// Fetches data for `resolve_backend_account`.
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
pub fn resolve_backend_account(config: &Config) -> Option<&str> {
    if let Some(addr) = &config.backend_account_address {
        return Some(addr.as_str());
    }
    if config.backend_public_key.starts_with("0x") {
        return Some(config.backend_public_key.as_str());
    }
    None
}

/// Parses or transforms values for `parse_chain_id`.
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
pub fn parse_chain_id(chain_id: &str) -> Result<Felt> {
    if chain_id.starts_with("0x") {
        return parse_felt(chain_id);
    }
    let hex = hex::encode(chain_id.as_bytes());
    parse_felt(&format!("0x{hex}"))
}

/// Parses or transforms values for `parse_felt`.
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
pub fn parse_felt(value: &str) -> Result<Felt> {
    let trimmed = value.trim().trim_matches('"').trim_matches('\'');
    if trimmed.is_empty() {
        return Err(crate::error::AppError::Internal(
            "Empty field element".to_string(),
        ));
    }
    if trimmed.starts_with("0x") || trimmed.starts_with("0X") {
        let normalized = if trimmed.starts_with("0X") {
            format!("0x{}", &trimmed[2..])
        } else {
            trimmed.to_string()
        };
        return Felt::from_hex(&normalized).map_err(|e| {
            crate::error::AppError::Internal(format!(
                "Invalid felt hex '{}': {}",
                normalized, e
            ))
        });
    }
    // Some payload producers return hex without `0x` prefix.
    if trimmed.chars().any(|ch| ch.is_ascii_alphabetic())
        && trimmed.chars().all(|ch| ch.is_ascii_hexdigit())
    {
        let normalized = format!("0x{}", trimmed);
        if let Ok(parsed) = Felt::from_hex(&normalized) {
            return Ok(parsed);
        }
    }
    let dec = trimmed.replace('_', "");
    Felt::from_dec_str(&dec).map_err(|e| {
        crate::error::AppError::Internal(format!("Invalid felt dec '{}': {}", trimmed, e))
    })
}

/// Handles `felt_to_u128` logic.
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

/// Handles `u256_from_felts` logic.
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

/// Handles `u256_to_felts` logic.
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
pub fn u256_to_felts(value: u128) -> (Felt, Felt) {
    (Felt::from(value), Felt::from(0_u128))
}
