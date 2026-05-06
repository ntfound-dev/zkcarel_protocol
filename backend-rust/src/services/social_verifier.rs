use crate::services::onchain::{parse_felt, OnchainInvoker};
use crate::{
    config::Config,
    constants::EPOCH_DURATION_SECONDS,
    db::Database,
    error::{AppError, Result},
};
use rust_decimal::prelude::ToPrimitive;
use starknet_core::types::Call;
use starknet_core::utils::get_selector_from_name;

// Internal helper that supports `proof_is_valid` operations.
fn proof_is_valid(proof: &str) -> bool {
    proof.len() > 10
}

// Internal helper that supports `allow_mock_social_verification` operations.
fn allow_mock_social_verification(config: &Config) -> bool {
    if config.is_testnet() {
        return true;
    }
    let mode = std::env::var("SOCIAL_VERIFIER_MODE")
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    matches!(mode.as_str(), "mock" | "off" | "test" | "dev")
}

// Internal helper that guards production usage without real provider verification.
fn ensure_social_verifier_configured(config: &Config) -> Result<()> {
    if allow_mock_social_verification(config) {
        return Ok(());
    }
    if config.twitter_bearer_token.is_some()
        || config.telegram_bot_token.is_some()
        || config.discord_bot_token.is_some()
    {
        return Ok(());
    }
    Err(AppError::BadRequest(
        "Social verification is not configured for mainnet. Implement provider verification or set SOCIAL_VERIFIER_MODE=mock for testnet/dev.".to_string(),
    ))
}

/// Social Verifier - Verifies social media tasks
pub struct SocialVerifier {
    db: Database,
    config: Config,
    onchain: Option<OnchainInvoker>,
}

impl SocialVerifier {
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
        _user_address: &str,
        task: &str,
        proof: &str,
    ) -> Result<bool> {
        ensure_social_verifier_configured(&self.config)?;
        if allow_mock_social_verification(&self.config) {
            return Ok(proof_is_valid(proof));
        }
        if self.config.twitter_bearer_token.is_none() {
            return Err(AppError::BadRequest(
                "Twitter verification is not configured".to_string(),
            ));
        }
        return Err(AppError::BadRequest(format!(
            "Twitter verification is not implemented on backend (task={})",
            task
        )));
    }

    /// Verify Telegram task
    pub async fn verify_telegram(
        &self,
        _user_address: &str,
        task: &str,
        proof: &str,
    ) -> Result<bool> {
        ensure_social_verifier_configured(&self.config)?;
        if allow_mock_social_verification(&self.config) {
            return Ok(proof_is_valid(proof));
        }
        if self.config.telegram_bot_token.is_none() {
            return Err(AppError::BadRequest(
                "Telegram verification is not configured".to_string(),
            ));
        }
        return Err(AppError::BadRequest(format!(
            "Telegram verification is not implemented on backend (task={})",
            task
        )));
    }

    /// Verify Discord task
    pub async fn verify_discord(
        &self,
        _user_address: &str,
        task: &str,
        proof: &str,
    ) -> Result<bool> {
        ensure_social_verifier_configured(&self.config)?;
        if allow_mock_social_verification(&self.config) {
            return Ok(proof_is_valid(proof));
        }
        if self.config.discord_bot_token.is_none() {
            return Err(AppError::BadRequest(
                "Discord verification is not configured".to_string(),
            ));
        }
        return Err(AppError::BadRequest(format!(
            "Discord verification is not implemented on backend (task={})",
            task
        )));
    }

    /// Award social points
    pub async fn award_points(&self, user_address: &str, points: f64) -> Result<()> {
        let epoch = chrono::Utc::now().timestamp() / EPOCH_DURATION_SECONDS;

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
                total_points = points.total_points + (EXCLUDED.social_points * points.staking_multiplier),
                updated_at = NOW()
            "#,
        )
        .bind(user_address)
        .bind(epoch)
        .bind(points_decimal)
        .execute(self.db.pool())
        .await?;

        self.sync_points_onchain(epoch as u64, user_address).await?;

        Ok(())
    }

    // Internal helper that supports `sync_points_onchain` operations.
    // Reads the authoritative total from DB and sets it on-chain via submit_points (absolute write),
    // consistent with point_calculator which also uses submit_points. Using add_points (delta)
    // here would cause double-counting when point_calculator later overwrites the total.
    async fn sync_points_onchain(&self, epoch: u64, user_address: &str) -> Result<()> {
        let contract = self.config.point_storage_address.trim();
        if contract.is_empty() || contract.starts_with("0x0000") {
            return Ok(());
        }

        let Some(invoker) = &self.onchain else {
            return Ok(());
        };

        let total: rust_decimal::Decimal = sqlx::query_scalar(
            "SELECT COALESCE(total_points, 0) FROM points WHERE user_address = $1 AND epoch = $2",
        )
        .bind(user_address)
        .bind(epoch as i64)
        .fetch_optional(self.db.pool())
        .await?
        .unwrap_or(rust_decimal::Decimal::ZERO);

        let total_u128 = total.max(rust_decimal::Decimal::ZERO).trunc().to_u128().unwrap_or(0);
        if total_u128 == 0 {
            return Ok(());
        }

        let call = build_submit_points_call(contract, epoch, user_address, total_u128)?;
        let tx_hash = invoker.invoke(call).await?;
        tracing::info!(
            "Social points synced onchain: user={}, epoch={}, total={}, tx={}",
            user_address,
            epoch,
            total_u128,
            tx_hash
        );
        Ok(())
    }
}

// Internal helper that builds inputs for `build_submit_points_call`.
fn build_submit_points_call(contract: &str, epoch: u64, user: &str, points: u128) -> Result<Call> {
    let to = parse_felt(contract)?;
    let selector = get_selector_from_name("submit_points")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    let user_felt = parse_felt(user)?;

    let calldata = vec![
        starknet_core::types::Felt::from(epoch),
        user_felt,
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
    // Internal helper that supports `proof_is_valid_requires_length` operations.
    fn proof_is_valid_requires_length() {
        // Memastikan proof minimal 11 karakter
        assert!(!proof_is_valid("short"));
        assert!(proof_is_valid("this_is_long"));
    }
}
