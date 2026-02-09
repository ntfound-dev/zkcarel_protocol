use crate::error::Result;
use serde::{Deserialize, Serialize};
use starknet_core::utils::get_selector_from_name;

fn rpc_request(method: &str, params: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
        "id": 1
    })
}

fn call_contract_params(contract_address: &str, entry_point_selector: &str, calldata: Vec<String>) -> serde_json::Value {
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

    /// Get current block number
    pub async fn get_block_number(&self) -> Result<u64> {
        let request = rpc_request("starknet_blockNumber", serde_json::json!([]));

        let response = self
            .client
            .post(&self.rpc_url)
            .json(&request)
            .send()
            .await
            .map_err(|e| crate::error::AppError::BlockchainRPC(e.to_string()))?;

        let result: RpcResponse<u64> = response
            .json()
            .await
            .map_err(|e| crate::error::AppError::BlockchainRPC(e.to_string()))?;

        Ok(result.result)
    }

    /// Get block by number
    pub async fn get_block(&self, block_number: u64) -> Result<Block> {
        let request = rpc_request(
            "starknet_getBlockWithTxs",
            serde_json::json!([{
                "block_number": block_number
            }]),
        );

        let response = self
            .client
            .post(&self.rpc_url)
            .json(&request)
            .send()
            .await
            .map_err(|e| crate::error::AppError::BlockchainRPC(e.to_string()))?;

        let result: RpcResponse<Block> = response
            .json()
            .await
            .map_err(|e| crate::error::AppError::BlockchainRPC(e.to_string()))?;

        Ok(result.result)
    }

    /// Get transaction receipt
    pub async fn get_transaction_receipt(&self, tx_hash: &str) -> Result<TransactionReceipt> {
        let request = rpc_request("starknet_getTransactionReceipt", serde_json::json!([tx_hash]));

        let response = self
            .client
            .post(&self.rpc_url)
            .json(&request)
            .send()
            .await
            .map_err(|e| crate::error::AppError::BlockchainRPC(e.to_string()))?;

        let result: RpcResponse<TransactionReceipt> = response
            .json()
            .await
            .map_err(|e| crate::error::AppError::BlockchainRPC(e.to_string()))?;

        Ok(result.result)
    }

    /// Get events for a contract
    pub async fn get_events(
        &self,
        contract_address: &str,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<Event>> {
        let request = rpc_request(
            "starknet_getEvents",
            serde_json::json!([{
                "from_block": { "block_number": from_block },
                "to_block": { "block_number": to_block },
                "address": contract_address,
                "chunk_size": 100
            }]),
        );

        let response = self
            .client
            .post(&self.rpc_url)
            .json(&request)
            .send()
            .await
            .map_err(|e| crate::error::AppError::BlockchainRPC(e.to_string()))?;

        let result: RpcResponse<EventsResponse> = response
            .json()
            .await
            .map_err(|e| crate::error::AppError::BlockchainRPC(e.to_string()))?;

        Ok(result.result.events)
    }

    /// Call contract view function
    pub async fn call_contract(
        &self,
        contract_address: &str,
        function: &str,
        calldata: Vec<String>,
    ) -> Result<Vec<String>> {
        let entry_point_selector = resolve_entry_point_selector(function)?;
        let request = rpc_request(
            "starknet_call",
            serde_json::json!([
                call_contract_params(contract_address, &entry_point_selector, calldata),
                "latest"
            ]),
        );

        let response = self
            .client
            .post(&self.rpc_url)
            .json(&request)
            .send()
            .await
            .map_err(|e| crate::error::AppError::BlockchainRPC(e.to_string()))?;

        let result: RpcResponse<Vec<String>> = response
            .json()
            .await
            .map_err(|e| crate::error::AppError::BlockchainRPC(e.to_string()))?;

        Ok(result.result)
    }
}

#[derive(Debug, Deserialize)]
struct RpcResponse<T> {
    result: T,
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
}

#[derive(Debug, Deserialize)]
struct EventsResponse {
    events: Vec<Event>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rpc_request_sets_method_and_id() {
        // Memastikan payload RPC berisi method dan id default
        let req = rpc_request("starknet_blockNumber", serde_json::json!([]));
        assert_eq!(req.get("method").and_then(|v| v.as_str()), Some("starknet_blockNumber"));
        assert_eq!(req.get("id").and_then(|v| v.as_i64()), Some(1));
    }

    #[test]
    fn call_contract_params_contains_fields() {
        // Memastikan parameter call_contract terbentuk lengkap
        let params = call_contract_params("0xabc", "balance", vec!["1".to_string()]);
        assert_eq!(params.get("contract_address").and_then(|v| v.as_str()), Some("0xabc"));
        assert_eq!(params.get("entry_point_selector").and_then(|v| v.as_str()), Some("balance"));
    }
}
