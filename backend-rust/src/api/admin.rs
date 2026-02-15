use super::AppState;
use crate::{
    error::{AppError, Result},
    models::ApiResponse,
};
use axum::{
    extract::State,
    http::{HeaderMap, HeaderName},
    Json,
};
use serde::{Deserialize, Serialize};

const ADMIN_KEY_HEADER: &str = "x-admin-key";

#[derive(Debug, Deserialize)]
pub struct ResetPointsRequest {
    pub user_address: Option<String>,
    pub reset_all: Option<bool>,
    pub clear_transactions: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct ResetPointsResponse {
    pub scope: String,
    pub points_rows_deleted: i64,
    pub transactions_rows_deleted: i64,
}

fn require_admin_key(headers: &HeaderMap, state: &AppState) -> Result<()> {
    let expected = state
        .config
        .admin_manual_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::BadRequest(
                "ADMIN_MANUAL_KEY is not configured on backend. Manual reset is disabled."
                    .to_string(),
            )
        })?;

    let header_name = HeaderName::from_static(ADMIN_KEY_HEADER);
    let provided = headers
        .get(&header_name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::AuthError(format!(
                "Missing admin key. Send header '{}' to access this endpoint.",
                ADMIN_KEY_HEADER
            ))
        })?;

    if provided != expected {
        return Err(AppError::AuthError("Invalid admin key".to_string()));
    }
    Ok(())
}

/// POST /api/v1/admin/points/reset
pub async fn reset_points(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ResetPointsRequest>,
) -> Result<Json<ApiResponse<ResetPointsResponse>>> {
    require_admin_key(&headers, &state)?;

    let clear_transactions = req.clear_transactions.unwrap_or(false);
    let reset_all = req.reset_all.unwrap_or(false);
    let scope_user = req
        .user_address
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if !reset_all && scope_user.is_none() {
        return Err(AppError::BadRequest(
            "Provide user_address or set reset_all=true".to_string(),
        ));
    }

    if reset_all && scope_user.is_some() {
        return Err(AppError::BadRequest(
            "Use either user_address or reset_all=true, not both".to_string(),
        ));
    }

    let mut points_rows_deleted: i64 = 0;
    let mut transactions_rows_deleted: i64 = 0;

    if let Some(user_address) = scope_user {
        let points_result = sqlx::query("DELETE FROM points WHERE LOWER(user_address) = LOWER($1)")
            .bind(user_address)
            .execute(state.db.pool())
            .await?;
        points_rows_deleted += points_result.rows_affected() as i64;

        if clear_transactions {
            let tx_result = sqlx::query(
                "DELETE FROM transactions
                 WHERE LOWER(user_address) = LOWER($1)
                   AND tx_type IN ('swap', 'bridge', 'stake', 'unstake', 'limit_order')",
            )
            .bind(user_address)
            .execute(state.db.pool())
            .await?;
            transactions_rows_deleted += tx_result.rows_affected() as i64;
        }
    } else {
        let points_result = sqlx::query("DELETE FROM points")
            .execute(state.db.pool())
            .await?;
        points_rows_deleted += points_result.rows_affected() as i64;

        if clear_transactions {
            let tx_result = sqlx::query(
                "DELETE FROM transactions
                 WHERE tx_type IN ('swap', 'bridge', 'stake', 'unstake', 'limit_order')",
            )
            .execute(state.db.pool())
            .await?;
            transactions_rows_deleted += tx_result.rows_affected() as i64;
        }
    }

    let response = ResetPointsResponse {
        scope: scope_user
            .map(|value| format!("user:{value}"))
            .unwrap_or_else(|| "all_users".to_string()),
        points_rows_deleted,
        transactions_rows_deleted,
    };
    Ok(Json(ApiResponse::success(response)))
}
