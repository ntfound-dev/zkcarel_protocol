use crate::{config::Config, error::Result};
use starknet_accounts::{Account, ExecutionEncoding, SingleOwnerAccount};
use starknet_core::types::{BlockId, BlockTag, Call, Felt, FunctionCall};
use starknet_providers::jsonrpc::{HttpTransport, JsonRpcClient};
use starknet_providers::Provider;
use starknet_signers::{LocalWallet, SigningKey};
use url::Url;

pub struct OnchainInvoker {
    account: SingleOwnerAccount<JsonRpcClient<HttpTransport>, LocalWallet>,
}

pub struct OnchainReader {
    provider: JsonRpcClient<HttpTransport>,
}

impl OnchainInvoker {
    pub fn from_config(config: &Config) -> Result<Option<Self>> {
        let account_address = resolve_backend_account(config);
        let Some(account_address) = account_address else {
            return Ok(None);
        };

        let rpc_url = Url::parse(&config.starknet_rpc_url)
            .map_err(|e| crate::error::AppError::Internal(format!("Invalid RPC URL: {}", e)))?;
        let provider = JsonRpcClient::new(HttpTransport::new(rpc_url));

        let private_key = parse_felt(&config.backend_private_key)?;
        let signer = LocalWallet::from_signing_key(SigningKey::from_secret_scalar(private_key));

        let account_address = parse_felt(account_address)?;
        let chain_id = parse_chain_id(&config.starknet_chain_id)?;

        let account = SingleOwnerAccount::new(
            provider,
            signer,
            account_address,
            chain_id,
            ExecutionEncoding::New,
        );

        Ok(Some(Self { account }))
    }

    pub async fn invoke(&self, call: Call) -> Result<Felt> {
        let result = self
            .account
            .execute_v3(vec![call])
            .send()
            .await
            .map_err(|e| crate::error::AppError::BlockchainRPC(e.to_string()))?;
        Ok(result.transaction_hash)
    }
}

impl OnchainReader {
    pub fn from_config(config: &Config) -> Result<Self> {
        let rpc_url = Url::parse(&config.starknet_rpc_url)
            .map_err(|e| crate::error::AppError::Internal(format!("Invalid RPC URL: {}", e)))?;
        let provider = JsonRpcClient::new(HttpTransport::new(rpc_url));
        Ok(Self { provider })
    }

    pub async fn call(&self, call: FunctionCall) -> Result<Vec<Felt>> {
        self.provider
            .call(call, BlockId::Tag(BlockTag::Latest))
            .await
            .map_err(|e| crate::error::AppError::BlockchainRPC(e.to_string()))
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
        return Err(crate::error::AppError::Internal("Empty field element".to_string()));
    }
    if trimmed.starts_with("0x") {
        return Felt::from_hex(trimmed)
            .map_err(|e| crate::error::AppError::Internal(format!("Invalid felt hex: {}", e)));
    }
    Felt::from_dec_str(trimmed)
        .map_err(|e| crate::error::AppError::Internal(format!("Invalid felt dec: {}", e)))
}
