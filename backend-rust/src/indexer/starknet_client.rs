use crate::error::Result;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use starknet_core::utils::get_selector_from_name;
use tokio::time::{sleep, Duration};

// Internal helper that supports `rpc_request` operations.
fn rpc_request(method: &str, params: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
        "id": 1
    })
}

// Internal helper that supports `rpc_request_with_id` operations.
fn rpc_request_with_id(method: &str, params: serde_json::Value, id: u64) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
        "id": id
    })
}

// Internal helper that supports `parse_rpc_url_list` operations.
fn parse_rpc_url_list(raw: &str) -> Vec<String> {
    raw.split([',', ';', '\n', '\r', ' '])
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect()
}

// Internal helper that supports `call_contract_params` operations.
fn call_contract_params(
    contract_address: &str,
    entry_point_selector: &str,
    calldata: Vec<String>,
) -> serde_json::Value {
    serde_json::json!({
        "contract_address": contract_address,
        "entry_point_selector": entry_point_selector,
        "calldata": calldata
    })
}

// Internal helper that fetches data for `resolve_entry_point_selector`.
fn resolve_entry_point_selector(function: &str) -> Result<String> {
    if function.starts_with("0x") {
        return Ok(function.to_string());
    }
    let selector = get_selector_from_name(function)
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    Ok(format!("{selector:#x}"))
}

const RPC_MAX_RETRIES: usize = 2;
const RPC_RETRY_BACKOFF_MS: u64 = 1_000;
const RPC_RESPONSE_PREVIEW_LEN: usize = 220;
const EVENTS_MAX_PAGES: usize = 64;

// Internal helper that supports `preview_rpc_body` operations.
fn preview_rpc_body(raw: &str) -> String {
    let compact = raw.trim().replace(['\r', '\n', '\t'], " ");
    if compact.len() <= RPC_RESPONSE_PREVIEW_LEN {
        compact
    } else {
        format!("{}...", &compact[..RPC_RESPONSE_PREVIEW_LEN])
    }
}

// Internal helper that checks conditions for `is_transient_rpc_failure`.
fn is_transient_rpc_failure(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("timeout")
        || lower.contains("timed out")
        || lower.contains("too many requests")
        || lower.contains("429")
        || lower.contains("gateway")
        || lower.contains("temporarily unavailable")
        || lower.contains("connection reset")
        || lower.contains("eof while parsing")
        || lower.contains("error decoding response body")
}

// Internal helper that supports `retry_backoff_delay` operations.
fn retry_backoff_delay(attempt: usize) -> Duration {
    let exponent = attempt.min(5) as u32;
    let multiplier = 1_u64 << exponent;
    Duration::from_millis(RPC_RETRY_BACKOFF_MS.saturating_mul(multiplier))
}

/// Starknet RPC Client
pub struct StarknetClient {
    rpc_urls: Vec<String>,
    client: reqwest::Client,
}

impl StarknetClient {
    /// Constructs a new instance via `new`.
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
    pub fn new(rpc_url: String) -> Self {
        let rpc_urls = {
            let parsed = parse_rpc_url_list(&rpc_url);
            if parsed.is_empty() {
                vec![rpc_url]
            } else {
                parsed
            }
        };
        Self::new_with_urls(rpc_urls)
    }

    /// Constructs a new instance via `new_with_urls`.
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
    pub fn new_with_urls(rpc_urls: Vec<String>) -> Self {
        let sanitized: Vec<String> = rpc_urls
            .into_iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect();
        let rpc_urls = if sanitized.is_empty() {
            vec!["http://localhost:5050".to_string()]
        } else {
            sanitized
        };
        Self {
            rpc_urls,
            client: reqwest::Client::new(),
        }
    }

    // Internal helper that supports `rpc_call` operations.
    async fn rpc_call<T>(&self, method: &str, params: serde_json::Value) -> Result<T>
    where
        T: DeserializeOwned,
    {
        let request = rpc_request(method, params);
        let mut last_error = format!("{} failed without additional details", method);

        for (rpc_index, rpc_url) in self.rpc_urls.iter().enumerate() {
            for attempt in 0..=RPC_MAX_RETRIES {
                let response = match self.client.post(rpc_url).json(&request).send().await {
                    Ok(response) => response,
                    Err(error) => {
                        last_error = format!("{} request failed on {}: {}", method, rpc_url, error);
                        if attempt < RPC_MAX_RETRIES && is_transient_rpc_failure(&last_error) {
                            sleep(retry_backoff_delay(attempt)).await;
                            continue;
                        }
                        break;
                    }
                };

                let status = response.status();
                let body = match response.text().await {
                    Ok(body) => body,
                    Err(error) => {
                        last_error =
                            format!("{} response read failed on {}: {}", method, rpc_url, error);
                        if attempt < RPC_MAX_RETRIES && is_transient_rpc_failure(&last_error) {
                            sleep(retry_backoff_delay(attempt)).await;
                            continue;
                        }
                        break;
                    }
                };

                if !status.is_success() {
                    last_error = format!(
                        "{} HTTP {} on {}: {}",
                        method,
                        status.as_u16(),
                        rpc_url,
                        preview_rpc_body(&body)
                    );
                    if attempt < RPC_MAX_RETRIES && is_transient_rpc_failure(&last_error) {
                        sleep(retry_backoff_delay(attempt)).await;
                        continue;
                    }
                    break;
                }

                let payload: RpcResponseEnvelope<T> = match serde_json::from_str(&body) {
                    Ok(payload) => payload,
                    Err(error) => {
                        last_error = format!(
                            "{} decode failed on {}: {} (body: {})",
                            method,
                            rpc_url,
                            error,
                            preview_rpc_body(&body)
                        );
                        if attempt < RPC_MAX_RETRIES && is_transient_rpc_failure(&last_error) {
                            sleep(retry_backoff_delay(attempt)).await;
                            continue;
                        }
                        break;
                    }
                };

                if let Some(error) = payload.error {
                    last_error = format!(
                        "{} RPC error {} on {}: {}",
                        method, error.code, rpc_url, error.message
                    );
                    if attempt < RPC_MAX_RETRIES && is_transient_rpc_failure(&last_error) {
                        sleep(retry_backoff_delay(attempt)).await;
                        continue;
                    }
                    break;
                }

                if let Some(result) = payload.result {
                    return Ok(result);
                }

                last_error = format!(
                    "{} RPC response missing result on {} (body: {})",
                    method,
                    rpc_url,
                    preview_rpc_body(&body)
                );
                if attempt < RPC_MAX_RETRIES && is_transient_rpc_failure(&last_error) {
                    sleep(retry_backoff_delay(attempt)).await;
                    continue;
                }
                break;
            }

            if rpc_index + 1 < self.rpc_urls.len() && is_transient_rpc_failure(&last_error) {
                tracing::warn!(
                    "{} failed on RPC {}. Falling back to next provider. err={}",
                    method,
                    rpc_url,
                    last_error
                );
            }
        }

        Err(crate::error::AppError::BlockchainRPC(last_error))
    }

    /// Runs `call_contract_batch` and handles related side effects.
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
    pub async fn call_contract_batch(
        &self,
        calls: Vec<ContractBatchCall>,
    ) -> Result<Vec<Vec<String>>> {
        if calls.is_empty() {
            return Ok(Vec::new());
        }

        let mut last_error = "starknet_call batch failed without additional details".to_string();
        for (rpc_index, rpc_url) in self.rpc_urls.iter().enumerate() {
            for attempt in 0..=RPC_MAX_RETRIES {
                let payload: Vec<serde_json::Value> = calls
                    .iter()
                    .enumerate()
                    .map(|(idx, call)| {
                        let selector = resolve_entry_point_selector(&call.function)
                            .unwrap_or_else(|_| call.function.clone());
                        let params = serde_json::json!([
                            call_contract_params(
                                &call.contract_address,
                                &selector,
                                call.calldata.clone()
                            ),
                            "latest"
                        ]);
                        rpc_request_with_id("starknet_call", params, (idx as u64) + 1)
                    })
                    .collect();

                let response = match self.client.post(rpc_url).json(&payload).send().await {
                    Ok(response) => response,
                    Err(error) => {
                        last_error = format!(
                            "starknet_call batch request failed on {}: {}",
                            rpc_url, error
                        );
                        if attempt < RPC_MAX_RETRIES && is_transient_rpc_failure(&last_error) {
                            sleep(retry_backoff_delay(attempt)).await;
                            continue;
                        }
                        break;
                    }
                };

                let status = response.status();
                let body = match response.text().await {
                    Ok(body) => body,
                    Err(error) => {
                        last_error = format!(
                            "starknet_call batch response read failed on {}: {}",
                            rpc_url, error
                        );
                        if attempt < RPC_MAX_RETRIES && is_transient_rpc_failure(&last_error) {
                            sleep(retry_backoff_delay(attempt)).await;
                            continue;
                        }
                        break;
                    }
                };

                if !status.is_success() {
                    last_error = format!(
                        "starknet_call batch HTTP {} on {}: {}",
                        status.as_u16(),
                        rpc_url,
                        preview_rpc_body(&body)
                    );
                    if attempt < RPC_MAX_RETRIES && is_transient_rpc_failure(&last_error) {
                        sleep(retry_backoff_delay(attempt)).await;
                        continue;
                    }
                    break;
                }

                let mut items: Vec<RpcBatchEnvelope<Vec<String>>> =
                    match serde_json::from_str::<Vec<RpcBatchEnvelope<Vec<String>>>>(&body) {
                        Ok(value) => value,
                        Err(error) => {
                            last_error = format!(
                                "starknet_call batch decode failed on {}: {} (body: {})",
                                rpc_url,
                                error,
                                preview_rpc_body(&body)
                            );
                            if attempt < RPC_MAX_RETRIES && is_transient_rpc_failure(&last_error) {
                                sleep(retry_backoff_delay(attempt)).await;
                                continue;
                            }
                            break;
                        }
                    };

                items.sort_by_key(|item| item.id.unwrap_or(0));
                let mut out: Vec<Vec<String>> = Vec::with_capacity(calls.len());
                let mut batch_ok = true;
                for item in items {
                    if let Some(err) = item.error {
                        last_error = format!(
                            "starknet_call batch rpc error {} on {}: {}",
                            err.code, rpc_url, err.message
                        );
                        batch_ok = false;
                        break;
                    }
                    if let Some(result) = item.result {
                        out.push(result);
                    } else {
                        last_error =
                            format!("starknet_call batch response missing result on {}", rpc_url);
                        batch_ok = false;
                        break;
                    }
                }
                if batch_ok && out.len() == calls.len() {
                    return Ok(out);
                }
                if attempt < RPC_MAX_RETRIES && is_transient_rpc_failure(&last_error) {
                    sleep(retry_backoff_delay(attempt)).await;
                    continue;
                }
                break;
            }

            if rpc_index + 1 < self.rpc_urls.len() && is_transient_rpc_failure(&last_error) {
                tracing::warn!(
                    "starknet_call batch failed on RPC {}. Falling back to next provider. err={}",
                    rpc_url,
                    last_error
                );
            }
        }

        Err(crate::error::AppError::BlockchainRPC(last_error))
    }

    /// Get current block number
    pub async fn get_block_number(&self) -> Result<u64> {
        self.rpc_call("starknet_blockNumber", serde_json::json!([]))
            .await
    }

    /// Get block by number
    pub async fn get_block(&self, block_number: u64) -> Result<Block> {
        self.rpc_call(
            "starknet_getBlockWithTxs",
            serde_json::json!([{
                "block_number": block_number
            }]),
        )
        .await
    }

    /// Get transaction receipt
    pub async fn get_transaction_receipt(&self, tx_hash: &str) -> Result<TransactionReceipt> {
        self.rpc_call(
            "starknet_getTransactionReceipt",
            serde_json::json!([tx_hash]),
        )
        .await
    }

    /// Get events for a contract
    pub async fn get_events(
        &self,
        contract_address: Option<&str>,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<Event>> {
        let mut all_events = Vec::new();
        let mut continuation_token: Option<String> = None;

        for _ in 0..EVENTS_MAX_PAGES {
            let mut filter = serde_json::Map::new();
            filter.insert(
                "from_block".to_string(),
                serde_json::json!({ "block_number": from_block }),
            );
            filter.insert(
                "to_block".to_string(),
                serde_json::json!({ "block_number": to_block }),
            );
            filter.insert("chunk_size".to_string(), serde_json::json!(200));
            if let Some(address) = contract_address {
                filter.insert("address".to_string(), serde_json::json!(address));
            }
            if let Some(token) = continuation_token.as_ref() {
                filter.insert("continuation_token".to_string(), serde_json::json!(token));
            }

            let result: EventsResponse = self
                .rpc_call("starknet_getEvents", serde_json::json!([filter]))
                .await?;

            all_events.extend(result.events);

            continuation_token = result.continuation_token.and_then(|token| {
                if token.trim().is_empty() {
                    None
                } else {
                    Some(token)
                }
            });

            if continuation_token.is_none() {
                break;
            }
        }

        if continuation_token.is_some() {
            tracing::warn!(
                "starknet_getEvents hit page limit ({} pages) for range {}..{}",
                EVENTS_MAX_PAGES,
                from_block,
                to_block
            );
        }

        Ok(all_events)
    }

    /// Call contract view function
    pub async fn call_contract(
        &self,
        contract_address: &str,
        function: &str,
        calldata: Vec<String>,
    ) -> Result<Vec<String>> {
        let entry_point_selector = resolve_entry_point_selector(function)?;
        self.rpc_call(
            "starknet_call",
            serde_json::json!([
                call_contract_params(contract_address, &entry_point_selector, calldata),
                "latest"
            ]),
        )
        .await
    }

    /// Read raw storage value at key
    pub async fn get_storage_at(
        &self,
        contract_address: &str,
        storage_key: &str,
    ) -> Result<String> {
        self.rpc_call(
            "starknet_getStorageAt",
            serde_json::json!([contract_address, storage_key, "latest"]),
        )
        .await
    }
}

#[derive(Debug, Deserialize)]
struct RpcResponseEnvelope<T> {
    result: Option<T>,
    error: Option<RpcErrorObject>,
}

#[derive(Debug, Deserialize)]
struct RpcBatchEnvelope<T> {
    id: Option<u64>,
    result: Option<T>,
    error: Option<RpcErrorObject>,
}

#[derive(Debug, Deserialize)]
struct RpcErrorObject {
    code: i64,
    message: String,
}

#[derive(Debug, Clone)]
pub struct ContractBatchCall {
    pub contract_address: String,
    pub function: String,
    pub calldata: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Block {
    pub block_number: u64,
    pub block_hash: String,
    pub timestamp: u64,
    pub transactions: Vec<Transaction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub transaction_hash: String,
    #[serde(rename = "type")]
    pub tx_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionReceipt {
    pub transaction_hash: String,
    pub status: String,
    pub events: Vec<Event>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub from_address: String,
    pub keys: Vec<String>,
    pub data: Vec<String>,
    #[serde(default)]
    pub transaction_hash: Option<String>,
    #[serde(default)]
    pub block_number: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct EventsResponse {
    events: Vec<Event>,
    continuation_token: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    // Internal helper that supports `rpc_request_sets_method_and_id` operations.
    fn rpc_request_sets_method_and_id() {
        // Memastikan payload RPC berisi method dan id default
        let req = rpc_request("starknet_blockNumber", serde_json::json!([]));
        assert_eq!(
            req.get("method").and_then(|v| v.as_str()),
            Some("starknet_blockNumber")
        );
        assert_eq!(req.get("id").and_then(|v| v.as_i64()), Some(1));
    }

    #[test]
    // Internal helper that supports `call_contract_params_contains_fields` operations.
    fn call_contract_params_contains_fields() {
        // Memastikan parameter call_contract terbentuk lengkap
        let params = call_contract_params("0xabc", "balance", vec!["1".to_string()]);
        assert_eq!(
            params.get("contract_address").and_then(|v| v.as_str()),
            Some("0xabc")
        );
        assert_eq!(
            params.get("entry_point_selector").and_then(|v| v.as_str()),
            Some("balance")
        );
    }
}
