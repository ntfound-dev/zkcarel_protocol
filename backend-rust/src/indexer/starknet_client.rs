use crate::error::Result;
use serde::{Deserialize, Serialize};

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
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "starknet_blockNumber",
            "params": [],
            "id": 1
        });

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
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "starknet_getBlockWithTxs",
            "params": [{
                "block_number": block_number
            }],
            "id": 1
        });

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
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "starknet_getTransactionReceipt",
            "params": [tx_hash],
            "id": 1
        });

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
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "starknet_getEvents",
            "params": [{
                "from_block": { "block_number": from_block },
                "to_block": { "block_number": to_block },
                "address": contract_address,
                "chunk_size": 100
            }],
            "id": 1
        });

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
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "starknet_call",
            "params": [{
                "contract_address": contract_address,
                "entry_point_selector": function,
                "calldata": calldata
            }, "latest"],
            "id": 1
        });

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