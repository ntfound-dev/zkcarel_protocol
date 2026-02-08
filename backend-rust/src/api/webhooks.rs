use axum::{extract::{State, Path}, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use crate::{error::Result, models::{ApiResponse, Webhook}, services::WebhookService};
use sqlx::Row;
use super::{AppState, require_user};

#[derive(Debug, Deserialize)]
pub struct RegisterWebhookRequest {
    pub url: String,
    pub events: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct WebhookInfo {
    pub id: i64,
    pub url: String,
    pub events: Vec<String>,
    pub active: bool,
    pub created_at: i64,
}

fn format_webhook_log(
    event: &str,
    status: &str,
    delivered_at: chrono::DateTime<chrono::Utc>,
) -> String {
    format!("{} | {} | {}", delivered_at.to_rfc3339(), event, status)
}

/// POST /api/v1/webhooks/register
pub async fn register(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<RegisterWebhookRequest>,
) -> Result<Json<ApiResponse<WebhookInfo>>> {
    let user_address = require_user(&headers, &state).await?;
    let service = WebhookService::new(state.db.clone(), state.config.clone());

    let id = service.register(&user_address, &req.url, req.events.clone()).await?;

    if let Some(first_event) = req.events.first() {
        let _ = service
            .send(
                &user_address,
                first_event,
                serde_json::json!({"status": "registered"}),
            )
            .await;
    }

    let webhook = WebhookInfo {
        id,
        url: req.url,
        events: req.events,
        active: true,
        created_at: chrono::Utc::now().timestamp(),
    };
    
    Ok(Json(ApiResponse::success(webhook)))
}

/// GET /api/v1/webhooks/list
pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<WebhookInfo>>>> {
    let user_address = require_user(&headers, &state).await?;

    let rows = sqlx::query_as::<_, Webhook>(
        "SELECT id, user_address, url, events, secret, active, created_at
         FROM webhooks WHERE user_address = $1 ORDER BY created_at DESC"
    )
    .bind(&user_address)
    .fetch_all(state.db.pool())
    .await?;

    let webhooks = rows
        .into_iter()
        .map(|w| WebhookInfo {
            id: w.id,
            url: w.url,
            events: w.events,
            active: w.active,
            created_at: w.created_at.timestamp(),
        })
        .collect();

    Ok(Json(ApiResponse::success(webhooks)))
}

/// DELETE /api/v1/webhooks/:id
pub async fn delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<ApiResponse<String>>> {
    let user_address = require_user(&headers, &state).await?;
    let service = WebhookService::new(state.db.clone(), state.config.clone());
    service.deactivate(id, &user_address).await?;
    Ok(Json(ApiResponse::success("Webhook deleted".to_string())))
}

/// GET /api/v1/webhooks/logs
pub async fn get_logs(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<String>>>> {
    let user_address = require_user(&headers, &state).await?;

    let rows = sqlx::query(
        "SELECT event, delivered_at, status
         FROM webhook_logs wl
         JOIN webhooks w ON wl.webhook_id = w.id
         WHERE w.user_address = $1
         ORDER BY delivered_at DESC
         LIMIT 50"
    )
    .bind(&user_address)
    .fetch_all(state.db.pool())
    .await?;

    let logs = rows
        .into_iter()
        .map(|row| {
            let event: String = row.get("event");
            let status: String = row.get("status");
            let delivered_at: chrono::DateTime<chrono::Utc> = row.get("delivered_at");
            format_webhook_log(&event, &status, delivered_at)
        })
        .collect();

    Ok(Json(ApiResponse::success(logs)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    #[test]
    fn format_webhook_log_includes_fields() {
        // Memastikan format log berisi waktu, event, dan status
        let ts = Utc.timestamp_opt(1_700_000_000, 0).unwrap();
        let log = format_webhook_log("swap", "ok", ts);
        assert!(log.contains("swap"));
        assert!(log.contains("ok"));
        assert!(log.contains("T"));
    }
}
