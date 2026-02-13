use crate::{config::Config, constants::EPOCH_DURATION_SECONDS, db::Database, error::Result};
use sqlx::Row;

fn epoch_from_timestamp(timestamp: i64) -> i64 {
    timestamp / EPOCH_DURATION_SECONDS
}

/// Snapshot Manager - Finalizes epochs and prepares for distribution
pub struct SnapshotManager {
    db: Database,
    config: Config,
}

impl SnapshotManager {
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_from_timestamp_calculates_epoch() {
        // Memastikan epoch dihitung dari timestamp
        let timestamp = EPOCH_DURATION_SECONDS * 2 + 10;
        assert_eq!(epoch_from_timestamp(timestamp), 2);
    }
}
