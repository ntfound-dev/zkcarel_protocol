use crate::{
    config::Config,
    db::Database,
    error::Result,
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

impl NotificationService {
    pub fn new(db: Database, config: Config) -> Self {
        Self {
            db,
            config,
            connections: Arc::new(RwLock::new(HashMap::new())),
        }
    }

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

    pub async fn unregister_connection(&self, user_address: &str) {
        let mut connections = self.connections.write().await;
        connections.remove(user_address);
    }

    async fn send_to_websocket(&self, user_address: &str, notification: Notification) {
        let connections = self.connections.read().await;
        if let Some(sender) = connections.get(user_address) {
            let _ = sender.send(notification);
        }
    }

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

    async fn send_email(&self, user_address: &str, notification: &Notification) -> Result<()> {
        tracing::debug!(
            "Email notification to {}: {}",
            user_address,
            notification.title
        );
        Ok(())
    }

    async fn send_push(&self, user_address: &str, notification: &Notification) -> Result<()> {
        tracing::debug!(
            "Push notification to {}: {}",
            user_address,
            notification.title
        );
        Ok(())
    }

    async fn send_telegram(&self, user_address: &str, notification: &Notification) -> Result<()> {
        tracing::debug!(
            "Telegram notification to {}: {}",
            user_address,
            notification.title
        );
        Ok(())
    }

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

    pub async fn mark_as_read(&self, notification_id: i64, user_address: &str) -> Result<()> {
        self.db
            .mark_notification_read(notification_id, user_address)
            .await
    }

    pub async fn mark_all_as_read(&self, user_address: &str) -> Result<()> {
        sqlx::query(
            "UPDATE notifications SET read = true WHERE user_address = $1 AND read = false",
        )
        .bind(user_address)
        .execute(self.db.pool())
        .await?;
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

impl ToString for NotificationType {
    fn to_string(&self) -> String {
        match self {
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
        }
        .to_string()
    }
}

impl NotificationType {
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
    fn notification_type_all_has_items() {
        // Memastikan daftar tipe notifikasi tidak kosong
        let all = NotificationType::all();
        assert!(all.len() >= 5);
    }
}
