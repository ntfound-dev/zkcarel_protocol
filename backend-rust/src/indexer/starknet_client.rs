use crate::error::Result;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use starknet_core::utils::get_selector_from_name;
use tokio::time::{sleep, Duration};

fn rpc_request(method: &str, params: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
        "id": 1
    })
}

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

fn preview_rpc_body(raw: &str) -> String {
    let compact = raw.trim().replace(['\r', '\n', '\t'], " ");
    if compact.len() <= RPC_RESPONSE_PREVIEW_LEN {
        compact
    } else {
        format!("{}...", &compact[..RPC_RESPONSE_PREVIEW_LEN])
    }
}

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

fn retry_backoff_delay(attempt: usize) -> Duration {
    let exponent = attempt.min(5) as u32;
    let multiplier = 1_u64 << exponent;
    Duration::from_millis(RPC_RETRY_BACKOFF_MS.saturating_mul(multiplier))
}

/// Starknet RPC Client
pub struct StarknetClient {
    rpc_url: String,
    client: reqwest::Client,
}

impl StarknetClient {
    pub fn new(rpc_url: String) -> Self {
        Self {
            rpc_url,
            client: reqwest::Client::new(),
        }
    }

    async fn rpc_call<T>(&self, method: &str, params: serde_json::Value) -> Result<T>
    where
        T: DeserializeOwned,
    {
        let request = rpc_request(method, params);
        let mut last_error = format!("{} failed without additional details", method);

        for attempt in 0..=RPC_MAX_RETRIES {
            let response = match self.client.post(&self.rpc_url).json(&request).send().await {
                Ok(response) => response,
                Err(error) => {
                    last_error = format!("{} request failed: {}", method, error);
                    if attempt < RPC_MAX_RETRIES && is_transient_rpc_failure(&last_error) {
                        sleep(retry_backoff_delay(attempt)).await;
                        continue;
                    }
                    return Err(crate::error::AppError::BlockchainRPC(last_error));
                }
            };

            let status = response.status();
            let body = match response.text().await {
                Ok(body) => body,
                Err(error) => {
                    last_error = format!("{} response read failed: {}", method, error);
                    if attempt < RPC_MAX_RETRIES && is_transient_rpc_failure(&last_error) {
                        sleep(retry_backoff_delay(attempt)).await;
                        continue;
                    }
                    return Err(crate::error::AppError::BlockchainRPC(last_error));
                }
            };

            if !status.is_success() {
                last_error = format!(
                    "{} HTTP {}: {}",
                    method,
                    status.as_u16(),
                    preview_rpc_body(&body)
                );
                if attempt < RPC_MAX_RETRIES && is_transient_rpc_failure(&last_error) {
                    sleep(retry_backoff_delay(attempt)).await;
                    continue;
                }
                return Err(crate::error::AppError::BlockchainRPC(last_error));
            }

            let payload: RpcResponseEnvelope<T> = match serde_json::from_str(&body) {
                Ok(payload) => payload,
                Err(error) => {
                    last_error = format!(
                        "{} decode failed: {} (body: {})",
                        method,
                        error,
                        preview_rpc_body(&body)
                    );
                    if attempt < RPC_MAX_RETRIES && is_transient_rpc_failure(&last_error) {
                        sleep(retry_backoff_delay(attempt)).await;
                        continue;
                    }
                    return Err(crate::error::AppError::BlockchainRPC(last_error));
                }
            };

            if let Some(error) = payload.error {
                last_error = format!("{} RPC error {}: {}", method, error.code, error.message);
                if attempt < RPC_MAX_RETRIES && is_transient_rpc_failure(&last_error) {
                    sleep(retry_backoff_delay(attempt)).await;
                    continue;
                }
                return Err(crate::error::AppError::BlockchainRPC(last_error));
            }

            if let Some(result) = payload.result {
                return Ok(result);
            }

            last_error = format!(
                "{} RPC response missing result (body: {})",
                method,
                preview_rpc_body(&body)
            );
            if attempt < RPC_MAX_RETRIES && is_transient_rpc_failure(&last_error) {
                sleep(retry_backoff_delay(attempt)).await;
                continue;
            }
            return Err(crate::error::AppError::BlockchainRPC(last_error));
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
}

#[derive(Debug, Deserialize)]
struct RpcResponseEnvelope<T> {
    result: Option<T>,
    error: Option<RpcErrorObject>,
}

#[derive(Debug, Deserialize)]
struct RpcErrorObject {
    code: i64,
    message: String,
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
