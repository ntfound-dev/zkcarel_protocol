use crate::{
    config::Config,
    db::Database,
    error::{AppError, Result},
};
use reqwest::redirect::Policy;
use sqlx::Row;
use std::net::IpAddr;
use std::time::Duration;
use tokio::net::lookup_host;
use url::Url;

const MAX_WEBHOOKS_PER_USER: i64 = 20;
const WEBHOOK_VERIFY_EVENT: &str = "webhook.verify";

// Internal helper that parses or transforms values for `format_webhook_secret`.
fn format_webhook_secret(bytes: [u8; 32]) -> String {
    format!("whsec_{}", hex::encode(bytes))
}

// Internal helper that checks whether an IP address is local/private.
fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_multicast()
                || v4.is_broadcast()
                || v4.is_unspecified()
                || v4.octets()[0] == 0
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || v6.is_unicast_link_local()
                || v6.is_unique_local()
        }
    }
}

// Internal helper that rejects localhost-style hostnames.
fn is_blocked_hostname(host: &str) -> bool {
    let lower = host.trim().to_ascii_lowercase();
    lower == "localhost"
        || lower.ends_with(".localhost")
        || lower.ends_with(".local")
        || lower.ends_with(".internal")
}

// Internal helper that validates webhook URLs to mitigate SSRF.
async fn validate_webhook_url(raw: &str) -> Result<Url> {
    let url = Url::parse(raw)
        .map_err(|err| AppError::BadRequest(format!("Invalid webhook URL: {}", err)))?;
    if url.scheme() != "https" {
        return Err(AppError::BadRequest(
            "Webhook URL must use https".to_string(),
        ));
    }
    let host = url
        .host()
        .ok_or_else(|| AppError::BadRequest("Webhook URL must include a host".to_string()))?;

    match host {
        url::Host::Ipv4(addr) => {
            if is_blocked_ip(IpAddr::V4(addr)) {
                return Err(AppError::BadRequest(
                    "Webhook URL cannot target local/private IPs".to_string(),
                ));
            }
        }
        url::Host::Ipv6(addr) => {
            if is_blocked_ip(IpAddr::V6(addr)) {
                return Err(AppError::BadRequest(
                    "Webhook URL cannot target local/private IPs".to_string(),
                ));
            }
        }
        url::Host::Domain(domain) => {
            if is_blocked_hostname(domain) {
                return Err(AppError::BadRequest(
                    "Webhook URL cannot target localhost domains".to_string(),
                ));
            }
            let port = url.port_or_known_default().unwrap_or(443);
            let resolved = lookup_host((domain, port)).await.map_err(|err| {
                AppError::BadRequest(format!("Webhook host resolution failed: {}", err))
            })?;
            for addr in resolved {
                if is_blocked_ip(addr.ip()) {
                    return Err(AppError::BadRequest(
                        "Webhook URL resolves to local/private IPs".to_string(),
                    ));
                }
            }
        }
    }

    Ok(url)
}

/// Webhook Service - Manages webhook subscriptions and deliveries
pub struct WebhookService {
    db: Database,
    config: Config,
    http: reqwest::Client,
}

impl WebhookService {
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
    pub fn new(db: Database, config: Config) -> Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .connect_timeout(Duration::from_secs(3))
            .redirect(Policy::none())
            .build()
            .map_err(|err| {
                AppError::Internal(format!("Failed to build webhook HTTP client: {}", err))
            })?;
        Ok(Self { db, config, http })
    }

    /// Register webhook
    pub async fn register(
        &self,
        user_address: &str,
        url: &str,
        events: Vec<String>,
    ) -> Result<i64> {
        let validated = match validate_webhook_url(url).await {
            Ok(validated) => validated,
            Err(err) => {
                return Err(err);
            }
        };
        self.enforce_webhook_limit(user_address).await?;
        self.verify_webhook_ownership(&validated).await?;
        let canonical_url = validated.to_string();
        let secret = format_webhook_secret(rand::random::<[u8; 32]>());

        // Ganti query! ke runtime query
        let row = sqlx::query(
            "INSERT INTO webhooks (user_address, url, events, secret, active)
             VALUES ($1, $2, $3, $4, true)
             RETURNING id::bigint as id",
        )
        .bind(user_address)
        .bind(canonical_url)
        .bind(&events)
        .bind(secret)
        .fetch_one(self.db.pool())
        .await?;

        Ok(row.get("id"))
    }

    // Internal helper that supports `register` operations.
    async fn enforce_webhook_limit(&self, user_address: &str) -> Result<()> {
        let row = sqlx::query("SELECT COUNT(*) as total FROM webhooks WHERE user_address = $1")
            .bind(user_address)
            .fetch_one(self.db.pool())
            .await?;
        let total: i64 = row.get("total");
        if total >= MAX_WEBHOOKS_PER_USER {
            return Err(AppError::BadRequest(format!(
                "Webhook limit reached (max {})",
                MAX_WEBHOOKS_PER_USER
            )));
        }
        Ok(())
    }

    // Internal helper that supports `register` operations.
    async fn verify_webhook_ownership(&self, url: &Url) -> Result<()> {
        let challenge = hex::encode(rand::random::<[u8; 16]>());
        let payload = serde_json::json!({
            "event": WEBHOOK_VERIFY_EVENT,
            "challenge": challenge,
            "sent_at": chrono::Utc::now().to_rfc3339(),
        });

        let response = self
            .http
            .post(url.clone())
            .json(&payload)
            .send()
            .await
            .map_err(|err| {
                AppError::ExternalAPI(format!("Webhook verification failed: {}", err))
            })?;

        if !response.status().is_success() {
            return Err(AppError::BadRequest(format!(
                "Webhook verification failed with status {}",
                response.status()
            )));
        }

        let body = response.text().await.map_err(|err| {
            AppError::ExternalAPI(format!("Webhook verification failed: {}", err))
        })?;

        let mut verified = false;
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
            if json.get("challenge").and_then(|v| v.as_str()) == Some(challenge.as_str()) {
                verified = true;
            }
        }
        if !verified && body.contains(&challenge) {
            verified = true;
        }

        if !verified {
            return Err(AppError::BadRequest(
                "Webhook verification failed: invalid challenge response".to_string(),
            ));
        }

        Ok(())
    }

    /// Send webhook
    pub async fn send(
        &self,
        user_address: &str,
        event: &str,
        data: serde_json::Value,
    ) -> Result<()> {
        // Ganti query! ke runtime query
        let rows = sqlx::query(
            "SELECT id, url, secret FROM webhooks
             WHERE user_address = $1 AND $2 = ANY(events) AND active = true",
        )
        .bind(user_address)
        .bind(event)
        .fetch_all(self.db.pool())
        .await?;

        for row in rows {
            let id: i64 = row.get("id");
            let url: String = row.get("url");
            let secret: String = row.get("secret");

            self.deliver_webhook(id, &url, &secret, event, &data)
                .await?;
        }

        Ok(())
    }

    // Internal helper that supports `deliver_webhook` operations.
    async fn deliver_webhook(
        &self,
        id: i64,
        url: &str,
        _secret: &str,
        event: &str,
        data: &serde_json::Value,
    ) -> Result<()> {
        let validated = validate_webhook_url(url).await?;
        let payload = serde_json::json!({
            "event": event,
            "data": data,
            "sent_at": chrono::Utc::now().to_rfc3339(),
        });

        tracing::info!("Delivering webhook {} to {}: {}", id, validated, event);
        if self.config.is_testnet() {
            tracing::debug!("Testnet webhook payload: {}", payload);
        }

        let response = self.http.post(validated).json(&payload).send().await;

        let (status, error_message) = match response {
            Ok(resp) if resp.status().is_success() => ("success".to_string(), None),
            Ok(resp) => (
                "failed".to_string(),
                Some(format!("HTTP {}", resp.status())),
            ),
            Err(err) => ("failed".to_string(), Some(err.to_string())),
        };

        sqlx::query(
            "INSERT INTO webhook_logs (webhook_id, event, payload, status, delivered_at, error_message)
             VALUES ($1, $2, $3, $4, NOW(), $5)",
        )
        .bind(id)
        .bind(event)
        .bind(&payload)
        .bind(&status)
        .bind(&error_message)
        .execute(self.db.pool())
        .await?;

        if status == "success" {
            Ok(())
        } else {
            Err(AppError::ExternalAPI(format!(
                "Webhook delivery failed for {}",
                url
            )))
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    // Internal helper that parses or transforms values for `format_webhook_secret_has_prefix`.
    fn format_webhook_secret_has_prefix() {
        // Memastikan secret webhook memakai prefix whsec_
        let secret = format_webhook_secret([0u8; 32]);
        assert!(secret.starts_with("whsec_"));
        assert_eq!(secret.len(), "whsec_".len() + 64);
    }
}
