use crate::{
    config::Config,
    db::Database,
    error::{AppError, Result},
    models::{Notification, NotificationPreferences},
};
use sqlx::Row;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock}; // Pastikan digunakan di get_unread_count

pub struct NotificationService {
    db: Database,
    config: Config,
    connections: Arc<RwLock<HashMap<String, broadcast::Sender<Notification>>>>,
}

// Internal helper that checks conditions for `notification_channel_enabled`.
fn notification_channel_enabled(name: &str) -> bool {
    std::env::var(name)
        .ok()
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            normalized == "1" || normalized == "true" || normalized == "yes" || normalized == "on"
        })
        .unwrap_or(false)
}

// Internal helper that supports `notification_webhook_url` operations.
fn notification_webhook_url(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

impl NotificationService {
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
        Self {
            db,
            config,
            connections: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Runs `send_notification` and handles related side effects.
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
    pub async fn send_notification(
        &self,
        user_address: &str,
        notif_type: NotificationType,
        title: String,
        message: String,
        data: Option<serde_json::Value>,
    ) -> Result<()> {
        let _ = NotificationType::all();
        self.db
            .create_notification(
                user_address,
                &notif_type.to_string(),
                &title,
                &message,
                data.clone(),
            )
            .await?;

        let notification = Notification {
            id: 0,
            user_address: user_address.to_string(),
            notif_type: notif_type.to_string(),
            title: title.clone(),
            message: message.clone(),
            data,
            read: false,
            created_at: chrono::Utc::now(),
        };

        self.send_to_websocket(user_address, notification.clone())
            .await;
        self.send_via_other_channels(user_address, &notification)
            .await?;

        tracing::info!(
            "Notification sent to {}: {} - {}",
            user_address,
            title,
            message
        );
        Ok(())
    }

    /// Runs `register_connection` and handles related side effects.
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
    pub async fn register_connection(
        &self,
        user_address: String,
    ) -> broadcast::Receiver<Notification> {
        let mut connections = self.connections.write().await;
        if let Some(sender) = connections.get(&user_address) {
            sender.subscribe()
        } else {
            let (tx, rx) = broadcast::channel(100);
            connections.insert(user_address.clone(), tx);
            rx
        }
    }

    /// Runs `unregister_connection` and handles related side effects.
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
    pub async fn unregister_connection(&self, user_address: &str) {
        let mut connections = self.connections.write().await;
        connections.remove(user_address);
    }

    // Internal helper that runs side-effecting logic for `send_to_websocket`.
    async fn send_to_websocket(&self, user_address: &str, notification: Notification) {
        let connections = self.connections.read().await;
        if let Some(sender) = connections.get(user_address) {
            let _ = sender.send(notification);
        }
    }

    // Internal helper that runs side-effecting logic for `send_via_other_channels`.
    async fn send_via_other_channels(
        &self,
        user_address: &str,
        notification: &Notification,
    ) -> Result<()> {
        if self.config.is_testnet() {
            tracing::debug!(
                "Testnet mode: skip external notifications for {}",
                user_address
            );
            return Ok(());
        }
        let prefs = self.get_user_preferences(user_address).await?;
        if prefs.email_enabled {
            self.send_email(user_address, notification).await?;
        }
        if prefs.push_enabled {
            self.send_push(user_address, notification).await?;
        }
        if prefs.telegram_enabled {
            self.send_telegram(user_address, notification).await?;
        }
        Ok(())
    }

    // Internal helper that fetches data for `get_user_preferences`.
    async fn get_user_preferences(&self, user_address: &str) -> Result<NotificationPreferences> {
        let prefs = sqlx::query_as::<_, NotificationPreferences>(
            "SELECT email_enabled, push_enabled, telegram_enabled, discord_enabled
             FROM notification_preferences WHERE user_address = $1",
        )
        .bind(user_address)
        .fetch_optional(self.db.pool())
        .await?;
        Ok(prefs.unwrap_or_default())
    }

    // Internal helper that runs side-effecting logic for `send_email`.
    async fn send_email(&self, user_address: &str, notification: &Notification) -> Result<()> {
        if !notification_channel_enabled("NOTIFICATION_EMAIL_ENABLED") {
            return Err(AppError::BadRequest(
                "Email notifications are not configured".to_string(),
            ));
        }
        let Some(webhook) = notification_webhook_url("NOTIFICATION_EMAIL_WEBHOOK_URL") else {
            return Err(AppError::BadRequest(
                "Email webhook is not configured".to_string(),
            ));
        };
        let payload = serde_json::json!({
            "channel": "email",
            "user_address": user_address,
            "title": notification.title,
            "message": notification.message,
            "data": notification.data,
        });
        let response = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .map_err(|err| AppError::Internal(format!("Failed to build email client: {}", err)))?
            .post(webhook)
            .json(&payload)
            .send()
            .await
            .map_err(|err| AppError::ExternalAPI(format!("Email webhook failed: {}", err)))?;
        if !response.status().is_success() {
            return Err(AppError::ExternalAPI(format!(
                "Email webhook returned {}",
                response.status()
            )));
        }
        Ok(())
    }

    // Internal helper that runs side-effecting logic for `send_push`.
    async fn send_push(&self, user_address: &str, notification: &Notification) -> Result<()> {
        if !notification_channel_enabled("NOTIFICATION_PUSH_ENABLED") {
            return Err(AppError::BadRequest(
                "Push notifications are not configured".to_string(),
            ));
        }
        let Some(webhook) = notification_webhook_url("NOTIFICATION_PUSH_WEBHOOK_URL") else {
            return Err(AppError::BadRequest(
                "Push webhook is not configured".to_string(),
            ));
        };
        let payload = serde_json::json!({
            "channel": "push",
            "user_address": user_address,
            "title": notification.title,
            "message": notification.message,
            "data": notification.data,
        });
        let response = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .map_err(|err| AppError::Internal(format!("Failed to build push client: {}", err)))?
            .post(webhook)
            .json(&payload)
            .send()
            .await
            .map_err(|err| AppError::ExternalAPI(format!("Push webhook failed: {}", err)))?;
        if !response.status().is_success() {
            return Err(AppError::ExternalAPI(format!(
                "Push webhook returned {}",
                response.status()
            )));
        }
        Ok(())
    }

    // Internal helper that runs side-effecting logic for `send_telegram`.
    async fn send_telegram(&self, user_address: &str, notification: &Notification) -> Result<()> {
        if self.config.telegram_bot_token.is_none()
            || !notification_channel_enabled("NOTIFICATION_TELEGRAM_ENABLED")
        {
            return Err(AppError::BadRequest(
                "Telegram notifications are not configured".to_string(),
            ));
        }
        let username =
            sqlx::query("SELECT telegram_username FROM users WHERE LOWER(address) = LOWER($1)")
                .bind(user_address)
                .fetch_optional(self.db.pool())
                .await?
                .and_then(|row| row.try_get::<Option<String>, _>("telegram_username").ok())
                .flatten()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    AppError::BadRequest("Telegram username is not linked".to_string())
                })?;

        let chat_id = if username.starts_with('@') {
            username
        } else {
            format!("@{}", username)
        };
        let token = self
            .config
            .telegram_bot_token
            .as_ref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                AppError::BadRequest("Telegram bot token is not configured".to_string())
            })?;
        let message = format!("{}: {}", notification.title, notification.message);
        let url = format!("https://api.telegram.org/bot{}/sendMessage", token);
        let response = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .map_err(|err| AppError::Internal(format!("Failed to build Telegram client: {}", err)))?
            .post(url)
            .json(&serde_json::json!({
                "chat_id": chat_id,
                "text": message,
                "parse_mode": "HTML"
            }))
            .send()
            .await
            .map_err(|err| AppError::ExternalAPI(format!("Telegram send failed: {}", err)))?;
        if !response.status().is_success() {
            return Err(AppError::ExternalAPI(format!(
                "Telegram send returned {}",
                response.status()
            )));
        }
        Ok(())
    }

    /// Fetches data for `get_user_notifications`.
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
    pub async fn get_user_notifications(
        &self,
        user_address: &str,
        page: i32,
        limit: i32,
    ) -> Result<Vec<Notification>> {
        let offset = (page - 1) * limit;
        self.db
            .get_user_notifications(user_address, limit as i64, offset as i64)
            .await
    }

    /// Updates state for `mark_as_read`.
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
    pub async fn mark_as_read(&self, notification_id: i64, user_address: &str) -> Result<()> {
        self.db
            .mark_notification_read(notification_id, user_address)
            .await
    }

    /// Updates state for `mark_all_as_read`.
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
    pub async fn mark_all_as_read(&self, user_address: &str) -> Result<()> {
        let limit = mark_all_limit();
        if limit == 0 {
            sqlx::query(
                "UPDATE notifications SET read = true WHERE user_address = $1 AND read = false",
            )
            .bind(user_address)
            .execute(self.db.pool())
            .await?;
        } else {
            sqlx::query(
                r#"
                WITH target AS (
                    SELECT id
                    FROM notifications
                    WHERE user_address = $1 AND read = false
                    ORDER BY created_at DESC
                    LIMIT $2
                )
                UPDATE notifications
                SET read = true
                WHERE id IN (SELECT id FROM target)
                "#,
            )
            .bind(user_address)
            .bind(limit)
            .execute(self.db.pool())
            .await?;
        }
        Ok(())
    }

    // PERBAIKAN: Urutan yang benar adalah pub async fn
    pub async fn get_unread_count(&self, user_address: &str) -> Result<i64> {
        let row = sqlx::query(
            "SELECT COUNT(*) as count FROM notifications WHERE user_address = $1 AND read = false",
        )
        .bind(user_address)
        .fetch_one(self.db.pool())
        .await?;

        // Menggunakan sqlx::Row di sini
        Ok(row.get::<i64, _>("count"))
    }

    /// Deletes notifications older than `retention_days`.
    pub async fn cleanup_old_notifications(&self, retention_days: i64) -> Result<u64> {
        if retention_days <= 0 {
            return Ok(0);
        }
        let result = sqlx::query(
            "DELETE FROM notifications
             WHERE created_at < NOW() - ($1::double precision * INTERVAL '1 day')",
        )
        .bind(retention_days)
        .execute(self.db.pool())
        .await?;
        Ok(result.rows_affected())
    }
}

// Internal helper that supports `mark_all_limit` operations.
fn mark_all_limit() -> i64 {
    std::env::var("NOTIFICATION_MARK_ALL_LIMIT")
        .ok()
        .and_then(|raw| raw.parse::<i64>().ok())
        .filter(|value| *value >= 0)
        .unwrap_or(1000)
}

#[derive(Debug, Clone)]
pub enum NotificationType {
    SwapCompleted,
    SwapFailed,
    OrderFilled,
    OrderExpired,
    PointsAwarded,
    StakeRewards,
    NFTExpired,
    RewardClaimable,
    PriceAlert,
    System,
}

impl std::fmt::Display for NotificationType {
    // Internal helper that supports formatted output and `to_string()`.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let value = match self {
            Self::SwapCompleted => "swap.completed",
            Self::SwapFailed => "swap.failed",
            Self::OrderFilled => "order.filled",
            Self::OrderExpired => "order.expired",
            Self::PointsAwarded => "points.awarded",
            Self::StakeRewards => "stake.rewards",
            Self::NFTExpired => "nft.expired",
            Self::RewardClaimable => "reward.claimable",
            Self::PriceAlert => "price.alert",
            Self::System => "system",
        };
        write!(f, "{}", value)
    }
}

impl NotificationType {
    /// Handles `all` logic.
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
    pub fn all() -> Vec<Self> {
        vec![
            Self::SwapCompleted,
            Self::SwapFailed,
            Self::OrderFilled,
            Self::OrderExpired,
            Self::PointsAwarded,
            Self::StakeRewards,
            Self::NFTExpired,
            Self::RewardClaimable,
            Self::PriceAlert,
            Self::System,
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    // Internal helper that supports `notification_type_to_string_maps` operations.
    fn notification_type_to_string_maps() {
        // Memastikan mapping enum ke string berjalan benar
        assert_eq!(
            NotificationType::SwapCompleted.to_string(),
            "swap.completed"
        );
        assert_eq!(
            NotificationType::PointsAwarded.to_string(),
            "points.awarded"
        );
        assert_eq!(NotificationType::System.to_string(), "system");
    }

    #[test]
    // Internal helper that supports `notification_type_all_has_items` operations.
    fn notification_type_all_has_items() {
        // Memastikan daftar tipe notifikasi tidak kosong
        let all = NotificationType::all();
        assert!(all.len() >= 5);
    }
}
