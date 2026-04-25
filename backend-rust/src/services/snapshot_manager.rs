use crate::{
    config::Config,
    constants::EPOCH_DURATION_SECONDS,
    db::Database,
    error::Result,
    services::{
        merkle_generator::MerkleGenerator,
        onchain::{parse_felt, u256_to_felts, OnchainInvoker},
    },
};
use rust_decimal::prelude::ToPrimitive;
use sqlx::Row;
use starknet_core::types::{Call, Felt};
use starknet_core::utils::get_selector_from_name;
use starknet_crypto::Felt as CryptoFelt;

// Internal helper that supports `epoch_from_timestamp` operations.
fn epoch_from_timestamp(timestamp: i64) -> i64 {
    timestamp / EPOCH_DURATION_SECONDS
}

/// Snapshot Manager - Finalizes epochs and prepares for distribution
pub struct SnapshotManager {
    db: Database,
    config: Config,
}

impl SnapshotManager {
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
    pub fn new(db: Database, config: Config) -> Self {
        Self { db, config }
    }

    /// Finalize epoch - called at end of each month
    pub async fn finalize_epoch(&self, epoch: i64) -> Result<()> {
        if self.config.is_testnet() {
            tracing::debug!("Finalizing epoch in testnet mode");
        }
        tracing::info!("Finalizing epoch {}...", epoch);

        // 1. Mark all points as finalized
        sqlx::query("UPDATE points SET finalized = true WHERE epoch = $1")
            .bind(epoch)
            .execute(self.db.pool())
            .await?;

        // 2. Calculate total rewards
        let row = sqlx::query("SELECT SUM(total_points) as total FROM points WHERE epoch = $1")
            .bind(epoch)
            .fetch_one(self.db.pool())
            .await?;

        let total_points: rust_decimal::Decimal = row
            .get::<Option<rust_decimal::Decimal>, _>("total")
            .unwrap_or(rust_decimal::Decimal::ZERO);
        let total_points_u128 = total_points
            .max(rust_decimal::Decimal::ZERO)
            .trunc()
            .to_u128()
            .unwrap_or(0);

        // 3. Save snapshot
        sqlx::query(
            "INSERT INTO epoch_snapshots (epoch, total_points, total_users, finalized_at)
             VALUES ($1, $2, (SELECT COUNT(*) FROM points WHERE epoch = $1), NOW())",
        )
        .bind(epoch)
        .bind(total_points)
        .execute(self.db.pool())
        .await?;

        tracing::info!(
            "Epoch {} finalized with {} total points",
            epoch,
            total_points
        );

        self.submit_onchain_snapshot(epoch, total_points_u128)
            .await?;

        Ok(())
    }

    /// Start new epoch
    pub async fn start_new_epoch(&self, epoch: i64) -> Result<()> {
        tracing::info!("Starting new epoch {}...", epoch);

        // Initialize points table for new epoch
        sqlx::query("INSERT INTO epoch_metadata (epoch, started_at) VALUES ($1, NOW())")
            .bind(epoch)
            .execute(self.db.pool())
            .await?;

        Ok(())
    }

    /// Get current epoch
    pub fn get_current_epoch(&self) -> i64 {
        epoch_from_timestamp(chrono::Utc::now().timestamp())
    }

    // Internal helper that supports `submit_onchain_snapshot` operations.
    async fn submit_onchain_snapshot(&self, epoch: i64, total_points: u128) -> Result<()> {
        let snapshot_contract = configured_address(&self.config.snapshot_distributor_address);
        let point_storage_contract = configured_address(&self.config.point_storage_address);
        if snapshot_contract.is_none() && point_storage_contract.is_none() {
            return Ok(());
        }

        let Some(invoker) = OnchainInvoker::from_config(&self.config)? else {
            tracing::debug!("On-chain invoker not configured; skipping epoch {}", epoch);
            return Ok(());
        };

        let mut calls: Vec<Call> = Vec::new();

        if let Some(contract) = snapshot_contract {
            let merkle = MerkleGenerator::new(self.db.clone(), self.config.clone());
            match merkle.get_merkle_root(epoch).await {
                Ok(root) => {
                    let root_core = crypto_felt_to_core(&root)?;
                    calls.push(build_submit_root_call(contract, epoch as u64, root_core)?);
                }
                Err(err) => {
                    tracing::warn!(
                        "Merkle root missing for epoch {} (skipping on-chain root submit): {}",
                        epoch,
                        err
                    );
                }
            }
        }

        if let Some(contract) = point_storage_contract {
            calls.push(build_point_storage_finalize_call(
                contract,
                epoch as u64,
                total_points,
            )?);
        }

        if calls.is_empty() {
            return Ok(());
        }

        let tx_hash = if calls.len() == 1 {
            invoker.invoke(calls.pop().unwrap()).await?
        } else {
            invoker.invoke_many(calls).await?
        };

        tracing::info!("Epoch {} submitted on-chain: {}", epoch, tx_hash);
        Ok(())
    }
}

// Internal helper that supports `configured_address` operations.
fn configured_address(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.starts_with("0x0000") {
        return None;
    }
    Some(trimmed)
}

// Internal helper that supports `crypto_felt_to_core` operations.
fn crypto_felt_to_core(value: &CryptoFelt) -> Result<Felt> {
    let hex = value.to_fixed_hex_string();
    Felt::from_hex(&hex)
        .map_err(|e| crate::error::AppError::Internal(format!("Invalid felt hex: {}", e)))
}

// Internal helper that builds inputs for `build_submit_root_call`.
fn build_submit_root_call(contract: &str, epoch: u64, root: Felt) -> Result<Call> {
    let to = parse_felt(contract)?;
    let selector = get_selector_from_name("submit_merkle_root")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    let calldata = vec![Felt::from(epoch as u128), root];
    Ok(Call {
        to,
        selector,
        calldata,
    })
}

// Internal helper that builds inputs for `build_point_storage_finalize_call`.
fn build_point_storage_finalize_call(
    contract: &str,
    epoch: u64,
    total_points: u128,
) -> Result<Call> {
    let to = parse_felt(contract)?;
    let selector = get_selector_from_name("finalize_epoch")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    let (low, high) = u256_to_felts(total_points);
    let calldata = vec![Felt::from(epoch as u128), low, high];
    Ok(Call {
        to,
        selector,
        calldata,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    // Internal helper that supports `epoch_from_timestamp_calculates_epoch` operations.
    fn epoch_from_timestamp_calculates_epoch() {
        // Memastikan epoch dihitung dari timestamp
        let timestamp = EPOCH_DURATION_SECONDS * 2 + 10;
        assert_eq!(epoch_from_timestamp(timestamp), 2);
    }
}
