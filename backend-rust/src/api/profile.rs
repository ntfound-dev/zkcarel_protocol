use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, Result},
    models::ApiResponse,
};

use super::{require_user, AppState};

#[derive(Debug, Deserialize)]
pub struct SetDisplayNameRequest {
    pub display_name: String,
}

#[derive(Debug, Serialize)]
pub struct ProfileResponse {
    pub address: String,
    pub display_name: Option<String>,
    pub referrer: Option<String>,
}

/// GET /api/v1/profile/me
pub async fn get_profile(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<ProfileResponse>>> {
    let user_address = require_user(&headers, &state).await?;
    let user = state
        .db
        .get_user(&user_address)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    Ok(Json(ApiResponse::success(ProfileResponse {
        address: user.address,
        display_name: user.display_name,
        referrer: user.referrer,
    })))
}

/// PUT /api/v1/profile/display-name
pub async fn set_display_name(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<SetDisplayNameRequest>,
) -> Result<Json<ApiResponse<ProfileResponse>>> {
    let user_address = require_user(&headers, &state).await?;
    let normalized = normalize_display_name(&req.display_name)?;

    let user = state
        .db
        .set_display_name(&user_address, &normalized)
        .await
        .map_err(map_display_name_error)?;

    Ok(Json(ApiResponse::success(ProfileResponse {
        address: user.address,
        display_name: user.display_name,
        referrer: user.referrer,
    })))
}

fn normalize_display_name(raw: &str) -> Result<String> {
    let value = raw.trim();
    if value.len() < 3 || value.len() > 24 {
        return Err(AppError::BadRequest(
            "display_name must be 3-24 characters".to_string(),
        ));
    }
    if !value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(AppError::BadRequest(
            "display_name only allows letters, numbers, '_' and '-'".to_string(),
        ));
    }
    Ok(value.to_string())
}

fn map_display_name_error(err: AppError) -> AppError {
    match err {
        AppError::Database(sqlx::Error::Database(db_err))
            if db_err.code().as_deref() == Some("23505") =>
        {
            AppError::BadRequest("display_name already taken".to_string())
        }
        other => other,
    }
}
