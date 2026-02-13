use crate::services::onchain::{parse_felt, OnchainInvoker};
use crate::{config::Config, constants::EPOCH_DURATION_SECONDS, db::Database, error::Result};
use rust_decimal::prelude::ToPrimitive;
use starknet_core::types::Call;
use starknet_core::utils::get_selector_from_name;

fn proof_is_valid(proof: &str) -> bool {
    proof.len() > 10
}

/// Social Verifier - Verifies social media tasks
pub struct SocialVerifier {
    db: Database,
    config: Config,
    onchain: Option<OnchainInvoker>,
}

impl SocialVerifier {
    pub fn new(db: Database, config: Config) -> Self {
        let onchain = OnchainInvoker::from_config(&config).ok().flatten();
        Self {
            db,
            config,
            onchain,
        }
    }

    /// Verify Twitter task
    pub async fn verify_twitter(
        &self,
        user_address: &str,
        task: &str,
        proof: &str,
    ) -> Result<bool> {
        if self.config.twitter_bearer_token.is_none() {
            tracing::warn!(
                "Twitter API key not configured; falling back to local proof check for {}",
                user_address
            );
            return Ok(proof_is_valid(proof));
        }
        // TODO: Integrate with Twitter API
        tracing::info!("Verifying Twitter task: {} for {}", task, user_address);

        // Mock verification
        Ok(proof_is_valid(proof))
    }

    /// Verify Telegram task
    pub async fn verify_telegram(
        &self,
        user_address: &str,
        task: &str,
        proof: &str,
    ) -> Result<bool> {
        if self.config.telegram_bot_token.is_none() {
            tracing::warn!(
                "Telegram bot token not configured; falling back to local proof check for {}",
                user_address
            );
            return Ok(proof_is_valid(proof));
        }
        // TODO: Integrate with Telegram Bot API
        tracing::info!("Verifying Telegram task: {} for {}", task, user_address);

        Ok(proof_is_valid(proof))
    }

    /// Verify Discord task
    pub async fn verify_discord(
        &self,
        user_address: &str,
        task: &str,
        proof: &str,
    ) -> Result<bool> {
        if self.config.discord_bot_token.is_none() {
            tracing::warn!(
                "Discord bot token not configured; falling back to local proof check for {}",
                user_address
            );
            return Ok(proof_is_valid(proof));
        }
        // TODO: Integrate with Discord API
        tracing::info!("Verifying Discord task: {} for {}", task, user_address);

        Ok(proof_is_valid(proof))
    }

    /// Award social points
    pub async fn award_points(&self, user_address: &str, points: f64) -> Result<()> {
        let epoch = (chrono::Utc::now().timestamp() / EPOCH_DURATION_SECONDS) as i64;

        // Gunakan from_f64_retain atau unwrap_or_default untuk keamanan
        let points_decimal =
            rust_decimal::Decimal::from_f64_retain(points).unwrap_or(rust_decimal::Decimal::ZERO);

        // Upsert agar social points tidak hilang saat row points epoch belum ada.
        // total_points dijaga konsisten dengan formula berbasis multiplier.
        sqlx::query(
            r#"
            INSERT INTO points (user_address, epoch, social_points, total_points)
            VALUES ($1, $2, $3, $3)
            ON CONFLICT (user_address, epoch) DO UPDATE
            SET social_points = points.social_points + EXCLUDED.social_points,
                total_points =
                    (points.swap_points
                    + points.bridge_points
                    + points.stake_points
                    + points.referral_points
                    + points.social_points
                    + EXCLUDED.social_points) * points.staking_multiplier,
                updated_at = NOW()
            "#,
        )
        .bind(user_address)
        .bind(epoch)
        .bind(points_decimal)
        .execute(self.db.pool())
        .await?;

        self.sync_points_onchain(epoch as u64, user_address, points_decimal)
            .await?;

        Ok(())
    }

    async fn sync_points_onchain(
        &self,
        epoch: u64,
        user_address: &str,
        points: rust_decimal::Decimal,
    ) -> Result<()> {
        let contract = self.config.point_storage_address.trim();
        if contract.is_empty() {
            return Ok(());
        }

        let Some(invoker) = &self.onchain else {
            return Ok(());
        };

        let points_u128 = points.trunc().to_u128().unwrap_or(0);
        if points_u128 == 0 {
            return Ok(());
        }

        let call = build_add_points_call(contract, epoch, user_address, points_u128)?;
        let tx_hash = invoker.invoke(call).await?;
        tracing::info!(
            "Social points synced onchain: user={}, epoch={}, tx={}",
            user_address,
            epoch,
            tx_hash
        );
        Ok(())
    }
}

fn build_add_points_call(contract: &str, epoch: u64, user: &str, points: u128) -> Result<Call> {
    let to = parse_felt(contract)?;
    let selector = get_selector_from_name("add_points")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    let user_felt = parse_felt(user)?;

    let calldata = vec![
        starknet_core::types::Felt::from(epoch),
        user_felt,
        // u256 low/high
        starknet_core::types::Felt::from(points),
        starknet_core::types::Felt::from(0_u128),
    ];

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
    fn proof_is_valid_requires_length() {
        // Memastikan proof minimal 11 karakter
        assert!(!proof_is_valid("short"));
        assert!(proof_is_valid("this_is_long"));
    }
}
