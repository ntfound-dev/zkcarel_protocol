use crate::{
    config::Config,
    error::{AppError, Result},
};
use starknet_core::types::{Call, ExecutionResult, Felt, TransactionFinalityStatus};
use tokio::time::{sleep, Duration};

use super::onchain::{OnchainInvoker, OnchainReader};

const DEFAULT_RELAYER_POLL_ATTEMPTS: usize = 20;
const DEFAULT_RELAYER_POLL_INTERVAL_MS: u64 = 1_500;

pub struct RelayerService {
    invoker: OnchainInvoker,
    reader: OnchainReader,
}

#[derive(Debug, Clone)]
pub struct RelayerSubmitResult {
    pub tx_hash: String,
}

impl RelayerService {
    pub fn from_config(config: &Config) -> Result<Self> {
        let Some(invoker) = OnchainInvoker::from_config(config).ok().flatten() else {
            return Err(AppError::BadRequest(
                "Relayer signer is not configured. Set BACKEND_ACCOUNT_ADDRESS and BACKEND_PRIVATE_KEY.".to_string(),
            ));
        };
        let reader = OnchainReader::from_config(config)?;
        Ok(Self { invoker, reader })
    }

    pub async fn submit_call(&self, call: Call) -> Result<RelayerSubmitResult> {
        let tx_hash = self.invoker.invoke(call).await?;
        self.wait_for_receipt(tx_hash).await
    }

    pub async fn submit_calls(&self, calls: Vec<Call>) -> Result<RelayerSubmitResult> {
        let tx_hash = self.invoker.invoke_many(calls).await?;
        self.wait_for_receipt(tx_hash).await
    }

    async fn wait_for_receipt(&self, tx_hash: Felt) -> Result<RelayerSubmitResult> {
        let poll_attempts = std::env::var("RELAYER_POLL_ATTEMPTS")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(DEFAULT_RELAYER_POLL_ATTEMPTS);
        let poll_interval_ms = std::env::var("RELAYER_POLL_INTERVAL_MS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(DEFAULT_RELAYER_POLL_INTERVAL_MS);

        let tx_hash_hex = format!("{:#x}", tx_hash);
        let mut last_error = String::new();

        for attempt in 0..poll_attempts {
            match self.reader.get_transaction_receipt(&tx_hash).await {
                Ok(receipt) => {
                    if let ExecutionResult::Reverted { reason } =
                        receipt.receipt.execution_result()
                    {
                        return Err(AppError::BadRequest(format!(
                            "Relayer transaction reverted: {}",
                            reason
                        )));
                    }
                    if matches!(
                        receipt.receipt.finality_status(),
                        TransactionFinalityStatus::PreConfirmed
                    ) {
                        last_error = "transaction still pre-confirmed".to_string();
                        if attempt + 1 < poll_attempts {
                            sleep(Duration::from_millis(poll_interval_ms)).await;
                            continue;
                        }
                        break;
                    }

                    return Ok(RelayerSubmitResult {
                        tx_hash: tx_hash_hex,
                    });
                }
                Err(err) => {
                    last_error = err.to_string();
                    if attempt + 1 < poll_attempts {
                        sleep(Duration::from_millis(poll_interval_ms)).await;
                        continue;
                    }
                }
            }
        }

        Err(AppError::BadRequest(format!(
            "Relayer transaction not confirmed on Starknet RPC: {}",
            last_error
        )))
    }
}
