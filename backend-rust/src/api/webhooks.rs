use axum::{extract::{State, Path}, Json};
use serde::{Deserialize, Serialize};
use crate::{error::Result, models::ApiResponse};
use super::AppState;

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

/// POST /api/v1/webhooks/register
pub async fn register(
    State(_state): State<AppState>,
    Json(req): Json<RegisterWebhookRequest>,
) -> Result<Json<ApiResponse<WebhookInfo>>> {
    let webhook = WebhookInfo {
        id: 1,
        url: req.url,
        events: req.events,
        active: true,
        created_at: chrono::Utc::now().timestamp(),
    };
    
    Ok(Json(ApiResponse::success(webhook)))
}

/// GET /api/v1/webhooks/list
pub async fn list(
    State(_state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<WebhookInfo>>>> {
    let webhooks = vec![];
    Ok(Json(ApiResponse::success(webhooks)))
}

/// DELETE /api/v1/webhooks/:id
pub async fn delete(
    State(_state): State<AppState>,
    Path(_id): Path<i64>,
) -> Result<Json<ApiResponse<String>>> {
    Ok(Json(ApiResponse::success("Webhook deleted".to_string())))
}

/// GET /api/v1/webhooks/logs
pub async fn get_logs(
    State(_state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<String>>>> {
    Ok(Json(ApiResponse::success(vec![])))
}