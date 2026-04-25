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
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use subtle::ConstantTimeEq;

const ADMIN_KEY_HEADER: &str = "x-admin-key";
const ADMIN_RESET_KEY_HEADER: &str = "x-admin-reset-key";
const ADMIN_RESET_RATE_LIMIT_DEFAULT_WINDOW_SECS: u64 = 60;
const ADMIN_RESET_RATE_LIMIT_DEFAULT_MAX: u32 = 5;
const ADMIN_RESET_RATE_LIMIT_MAX_ENTRIES: usize = 1000;

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

#[derive(Clone, Copy)]
struct AdminResetRateLimitEntry {
    window_start: Instant,
    count: u32,
}

static ADMIN_RESET_RATE_LIMIT: OnceLock<
    tokio::sync::RwLock<HashMap<String, AdminResetRateLimitEntry>>,
> = OnceLock::new();

// Internal helper that supports `admin_reset_rate_limit` operations.
fn admin_reset_rate_limit(
) -> &'static tokio::sync::RwLock<HashMap<String, AdminResetRateLimitEntry>> {
    ADMIN_RESET_RATE_LIMIT.get_or_init(|| tokio::sync::RwLock::new(HashMap::new()))
}

// Internal helper that supports `admin_reset_rate_limit_config` operations.
fn admin_reset_rate_limit_config() -> (Duration, u32) {
    let window_secs = std::env::var("ADMIN_RESET_RATE_LIMIT_WINDOW_SECS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(ADMIN_RESET_RATE_LIMIT_DEFAULT_WINDOW_SECS);
    let max = std::env::var("ADMIN_RESET_RATE_LIMIT_MAX")
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(ADMIN_RESET_RATE_LIMIT_DEFAULT_MAX);
    (Duration::from_secs(window_secs), max)
}

// Internal helper that supports `enforce_admin_reset_rate_limit` operations.
async fn enforce_admin_reset_rate_limit(scope: &str) -> Result<()> {
    let (window, max) = admin_reset_rate_limit_config();
    if max == 0 {
        return Ok(());
    }
    let key = format!("admin_reset|{}", scope.trim().to_ascii_lowercase());
    let now = Instant::now();
    let cache = admin_reset_rate_limit();
    let mut guard = cache.write().await;
    let entry = guard.entry(key).or_insert(AdminResetRateLimitEntry {
        window_start: now,
        count: 0,
    });
    if now.duration_since(entry.window_start) > window {
        entry.window_start = now;
        entry.count = 0;
    }
    if entry.count >= max {
        return Err(AppError::RateLimitExceeded);
    }
    entry.count = entry.count.saturating_add(1);

    if guard.len() > ADMIN_RESET_RATE_LIMIT_MAX_ENTRIES {
        guard.retain(|_, value| value.window_start.elapsed() <= window);
    }

    Ok(())
}

// Internal helper that supports `require_admin_key` operations.
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

    if provided.as_bytes().len() != expected.as_bytes().len()
        || provided.as_bytes().ct_eq(expected.as_bytes()).unwrap_u8() != 1
    {
        return Err(AppError::AuthError("Invalid admin key".to_string()));
    }
    Ok(())
}

// Internal helper that supports `require_admin_reset_key` operations.
fn require_admin_reset_key(headers: &HeaderMap, state: &AppState) -> Result<()> {
    let expected = state
        .config
        .admin_reset_confirm_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::BadRequest(
                "ADMIN_RESET_CONFIRM_KEY is not configured on backend. reset_all is disabled."
                    .to_string(),
            )
        })?;

    let header_name = HeaderName::from_static(ADMIN_RESET_KEY_HEADER);
    let provided = headers
        .get(&header_name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::AuthError(format!(
                "Missing admin reset key. Send header '{}' to access reset_all.",
                ADMIN_RESET_KEY_HEADER
            ))
        })?;

    if provided.as_bytes().len() != expected.as_bytes().len()
        || provided.as_bytes().ct_eq(expected.as_bytes()).unwrap_u8() != 1
    {
        return Err(AppError::AuthError("Invalid admin reset key".to_string()));
    }
    Ok(())
}

// Internal helper that parses or transforms values for `request_ip_hint`.
fn request_ip_hint(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.split(',').next().unwrap_or(value).trim().to_string())
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|value| value.to_str().ok())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string())
        })
        .unwrap_or_else(|| "unknown".to_string())
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

    if reset_all {
        require_admin_reset_key(&headers, &state)?;
        enforce_admin_reset_rate_limit("reset_all").await?;
    } else {
        enforce_admin_reset_rate_limit("user_reset").await?;
    }

    tracing::warn!(
        "Admin points reset requested: reset_all={} scope_user={:?} clear_transactions={} ip={}",
        reset_all,
        scope_user,
        clear_transactions,
        request_ip_hint(&headers)
    );

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
                   AND tx_type IN (
                       'swap', 'bridge', 'stake', 'unstake', 'limit_order',
                       'battle_hit', 'battle_miss', 'battle_win', 'battle_loss', 'battle_tmo_win'
                   )",
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
                 WHERE tx_type IN (
                     'swap', 'bridge', 'stake', 'unstake', 'limit_order',
                     'battle_hit', 'battle_miss', 'battle_win', 'battle_loss', 'battle_tmo_win'
                 )",
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
