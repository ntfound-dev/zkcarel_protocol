use crate::{config::Config, db::Database, error::Result};
use sqlx::Row;

/// Webhook Service - Manages webhook subscriptions and deliveries
pub struct WebhookService {
    db: Database,
    config: Config,
}

impl WebhookService {
    pub fn new(db: Database, config: Config) -> Self {
        Self { db, config }
    }

    /// Register webhook
    pub async fn register(&self, user_address: &str, url: &str, events: Vec<String>) -> Result<i64> {
        let secret = format!("whsec_{}", hex::encode(&rand::random::<[u8; 32]>()));

        // Ganti query! ke runtime query
        let row = sqlx::query(
            "INSERT INTO webhooks (user_address, url, events, secret, active)
             VALUES ($1, $2, $3, $4, true)
             RETURNING id"
        )
        .bind(user_address)
        .bind(url)
        .bind(&events)
        .bind(secret)
        .fetch_one(self.db.pool())
        .await?;

        Ok(row.get("id"))
    }

    /// Send webhook
    pub async fn send(&self, user_address: &str, event: &str, data: serde_json::Value) -> Result<()> {
        // Ganti query! ke runtime query
        let rows = sqlx::query(
            "SELECT id, url, secret FROM webhooks
             WHERE user_address = $1 AND $2 = ANY(events) AND active = true"
        )
        .bind(user_address)
        .bind(event)
        .fetch_all(self.db.pool())
        .await?;

        for row in rows {
            let id: i64 = row.get("id");
            let url: String = row.get("url");
            let secret: String = row.get("secret");
            
            self.deliver_webhook(id, &url, &secret, event, &data).await?;
        }

        Ok(())
    }

    async fn deliver_webhook(&self, id: i64, url: &str, _secret: &str, event: &str, data: &serde_json::Value) -> Result<()> {
        // TODO: Implement actual HTTP POST with retry logic
        tracing::info!("Delivering webhook {} to {}: {}", id, url, event);

        // Ganti query! ke runtime query
        sqlx::query(
            "INSERT INTO webhook_logs (webhook_id, event, payload, status, delivered_at)
             VALUES ($1, $2, $3, 'success', NOW())"
        )
        .bind(id)
        .bind(event)
        .bind(data)
        .execute(self.db.pool())
        .await?;

        Ok(())
    }

    /// Deactivate webhook
    pub async fn deactivate(&self, id: i64, user_address: &str) -> Result<()> {
        // Ganti query! ke runtime query
        sqlx::query("UPDATE webhooks SET active = false WHERE id = $1 AND user_address = $2")
            .bind(id)
            .bind(user_address)
            .execute(self.db.pool())
            .await?;

        Ok(())
    }
}
