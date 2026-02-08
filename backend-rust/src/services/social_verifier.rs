use crate::{config::Config, constants::EPOCH_DURATION_SECONDS, db::Database, error::{AppError, Result}};

fn proof_is_valid(proof: &str) -> bool {
    proof.len() > 10
}

/// Social Verifier - Verifies social media tasks
pub struct SocialVerifier {
    db: Database,
    config: Config,
}

impl SocialVerifier {
    pub fn new(db: Database, config: Config) -> Self {
        Self { db, config }
    }

    /// Verify Twitter task
    pub async fn verify_twitter(&self, user_address: &str, task: &str, proof: &str) -> Result<bool> {
        if self.config.twitter_bearer_token.is_none() {
            return Err(AppError::ExternalAPI("Twitter API key not configured".into()));
        }
        // TODO: Integrate with Twitter API
        tracing::info!("Verifying Twitter task: {} for {}", task, user_address);
        
        // Mock verification
        Ok(proof_is_valid(proof))
    }

    /// Verify Telegram task
    pub async fn verify_telegram(&self, user_address: &str, task: &str, proof: &str) -> Result<bool> {
        if self.config.telegram_bot_token.is_none() {
            return Err(AppError::ExternalAPI("Telegram bot token not configured".into()));
        }
        // TODO: Integrate with Telegram Bot API
        tracing::info!("Verifying Telegram task: {} for {}", task, user_address);
        
        Ok(proof_is_valid(proof))
    }

    /// Verify Discord task
    pub async fn verify_discord(&self, user_address: &str, task: &str, proof: &str) -> Result<bool> {
        if self.config.discord_bot_token.is_none() {
            return Err(AppError::ExternalAPI("Discord bot token not configured".into()));
        }
        // TODO: Integrate with Discord API
        tracing::info!("Verifying Discord task: {} for {}", task, user_address);
        
        Ok(proof_is_valid(proof))
    }

    /// Award social points
    pub async fn award_points(&self, user_address: &str, points: f64) -> Result<()> {
        let epoch = (chrono::Utc::now().timestamp() / EPOCH_DURATION_SECONDS) as i64;
        
        // Gunakan from_f64_retain atau unwrap_or_default untuk keamanan
        let points_decimal = rust_decimal::Decimal::from_f64_retain(points)
            .unwrap_or(rust_decimal::Decimal::ZERO);

        // Perbaikan: Gunakan sqlx::query (runtime) untuk menghindari error DATABASE_URL
        sqlx::query(
            "UPDATE points SET social_points = social_points + $1 
             WHERE user_address = $2 AND epoch = $3"
        )
        .bind(points_decimal)
        .bind(user_address)
        .bind(epoch)
        .execute(self.db.pool())
        .await?;

        Ok(())
    }
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
