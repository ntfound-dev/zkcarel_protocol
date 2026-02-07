use crate::{config::Config, db::Database, error::Result};

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
        // TODO: Integrate with Twitter API
        tracing::info!("Verifying Twitter task: {} for {}", task, user_address);
        
        // Mock verification
        Ok(proof.len() > 10)
    }

    /// Verify Telegram task
    pub async fn verify_telegram(&self, user_address: &str, task: &str, proof: &str) -> Result<bool> {
        // TODO: Integrate with Telegram Bot API
        tracing::info!("Verifying Telegram task: {} for {}", task, user_address);
        
        Ok(proof.len() > 10)
    }

    /// Verify Discord task
    pub async fn verify_discord(&self, user_address: &str, task: &str, proof: &str) -> Result<bool> {
        // TODO: Integrate with Discord API
        tracing::info!("Verifying Discord task: {} for {}", task, user_address);
        
        Ok(proof.len() > 10)
    }

    /// Award social points
    pub async fn award_points(&self, user_address: &str, points: f64) -> Result<()> {
        let epoch = (chrono::Utc::now().timestamp() / 2592000) as i64;
        
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
