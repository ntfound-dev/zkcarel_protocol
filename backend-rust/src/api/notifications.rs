use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::{
    error::Result,
    models::{ApiResponse, Notification, PaginatedResponse},
    services::notification_service::NotificationPreferences,
};

use super::AppState;

#[derive(Debug, Deserialize)]
pub struct ListNotificationsQuery {
    pub page: Option<i32>,
    pub limit: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct MarkReadRequest {
    pub notification_ids: Vec<i64>,
}

#[derive(Debug, Serialize)]
pub struct NotificationStats {
    pub unread_count: i64,
    pub total_count: i64,
}

// Struct bantuan untuk mapping hasil query COUNT
#[derive(sqlx::FromRow)]
struct CountResult {
    count: i64,
}

#[derive(sqlx::FromRow)]
struct StatsResult {
    unread: i64,
    total: i64,
}

/// GET /api/v1/notifications/list
pub async fn list(
    State(state): State<AppState>,
    axum::extract::Query(query): axum::extract::Query<ListNotificationsQuery>,
) -> Result<Json<ApiResponse<PaginatedResponse<Notification>>>> {
    let user_address = "0x1234...";

    let page = query.page.unwrap_or(1);
    let limit = query.limit.unwrap_or(20);
    let offset = (page - 1) * limit;

    let notifications = state.db
        .get_user_notifications(user_address, limit as i64, offset as i64)
        .await?;

    // Perbaikan: Gunakan query_as
    let total_res: CountResult = sqlx::query_as(
        "SELECT COUNT(*) as count FROM notifications WHERE user_address = $1"
    )
    .bind(user_address)
    .fetch_one(state.db.pool())
    .await?;

    let response = PaginatedResponse {
        items: notifications,
        page,
        limit,
        total: total_res.count,
    };

    Ok(Json(ApiResponse::success(response)))
}

/// POST /api/v1/notifications/mark-read
pub async fn mark_read(
    State(state): State<AppState>,
    Json(req): Json<MarkReadRequest>,
) -> Result<Json<ApiResponse<String>>> {
    let user_address = "0x1234...";

    for id in req.notification_ids {
        state.db.mark_notification_read(id, user_address).await?;
    }

    Ok(Json(ApiResponse::success("Notifications marked as read".to_string())))
}

/// PUT /api/v1/notifications/preferences
pub async fn update_preferences(
    State(state): State<AppState>,
    Json(req): Json<NotificationPreferences>,
) -> Result<Json<ApiResponse<NotificationPreferences>>> {
    let user_address = "0x1234...";

    // Perbaikan: Gunakan query biasa (execute) untuk INSERT/UPDATE
    sqlx::query(
        "INSERT INTO notification_preferences (user_address, email_enabled, push_enabled, telegram_enabled, discord_enabled)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_address) DO UPDATE
         SET email_enabled = $2,
             push_enabled = $3,
             telegram_enabled = $4,
             discord_enabled = $5"
    )
    .bind(user_address)
    .bind(req.email_enabled)
    .bind(req.push_enabled)
    .bind(req.telegram_enabled)
    .bind(req.discord_enabled)
    .execute(state.db.pool())
    .await?;

    Ok(Json(ApiResponse::success(req)))
}

/// GET /api/v1/notifications/stats
pub async fn get_stats(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<NotificationStats>>> {
    let user_address = "0x1234...";

    // Perbaikan: Gunakan query_as dengan CAST untuk menangani NULL/Filter
    let stats: StatsResult = sqlx::query_as(
        "SELECT 
            COALESCE(COUNT(*) FILTER (WHERE NOT read), 0) as unread,
            COUNT(*) as total
         FROM notifications
         WHERE user_address = $1"
    )
    .bind(user_address)
    .fetch_one(state.db.pool())
    .await?;

    Ok(Json(ApiResponse::success(NotificationStats {
        unread_count: stats.unread,
        total_count: stats.total,
    })))
}
