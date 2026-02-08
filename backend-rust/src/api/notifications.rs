use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};

use crate::{
    error::Result,
    models::{ApiResponse, Notification, NotificationPreferences, PaginatedResponse},
    services::NotificationService,
    utils::ensure_page_limit,
};

use super::{AppState, require_user};

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
    total: i64,
}

fn should_mark_all(notification_ids: &[i64]) -> bool {
    notification_ids.is_empty()
}

/// GET /api/v1/notifications/list
pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(query): axum::extract::Query<ListNotificationsQuery>,
) -> Result<Json<ApiResponse<PaginatedResponse<Notification>>>> {
    let user_address = require_user(&headers, &state).await?;

    let page = query.page.unwrap_or(1);
    let limit = query.limit.unwrap_or(20);
    ensure_page_limit(limit, state.config.rate_limit_authenticated)?;

    let service = NotificationService::new(state.db.clone(), state.config.clone());
    let notifications = service
        .get_user_notifications(&user_address, page, limit)
        .await?;

    // Perbaikan: Gunakan query_as
    let total_res: CountResult = sqlx::query_as(
        "SELECT COUNT(*) as count FROM notifications WHERE user_address = $1"
    )
    .bind(&user_address)
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
    headers: HeaderMap,
    Json(req): Json<MarkReadRequest>,
) -> Result<Json<ApiResponse<String>>> {
    let user_address = require_user(&headers, &state).await?;
    let service = NotificationService::new(state.db.clone(), state.config.clone());

    if should_mark_all(&req.notification_ids) {
        service.mark_all_as_read(&user_address).await?;
    } else {
        for id in req.notification_ids {
            service.mark_as_read(id, &user_address).await?;
        }
    }

    Ok(Json(ApiResponse::success("Notifications marked as read".to_string())))
}

/// PUT /api/v1/notifications/preferences
pub async fn update_preferences(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<NotificationPreferences>,
) -> Result<Json<ApiResponse<NotificationPreferences>>> {
    let user_address = require_user(&headers, &state).await?;

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
    .bind(&user_address)
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
    headers: HeaderMap,
) -> Result<Json<ApiResponse<NotificationStats>>> {
    let user_address = require_user(&headers, &state).await?;
    let service = NotificationService::new(state.db.clone(), state.config.clone());

    // Hitung total notifikasi
    let stats: StatsResult = sqlx::query_as(
        "SELECT COUNT(*) as total
         FROM notifications
         WHERE user_address = $1"
    )
    .bind(&user_address)
    .fetch_one(state.db.pool())
    .await?;

    Ok(Json(ApiResponse::success(NotificationStats {
        unread_count: service.get_unread_count(&user_address).await?,
        total_count: stats.total,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_mark_all_true_when_empty() {
        // Memastikan daftar kosong menandai semua notifikasi
        assert!(should_mark_all(&[]));
    }

    #[test]
    fn should_mark_all_false_when_ids_present() {
        // Memastikan daftar berisi ID tidak menandai semua
        assert!(!should_mark_all(&[1, 2, 3]));
    }
}
