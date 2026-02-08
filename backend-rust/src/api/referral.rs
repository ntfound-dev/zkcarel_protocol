use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use crate::{error::Result, models::{ApiResponse, PaginatedResponse}, utils::ensure_page_limit};
use super::{AppState, require_user};

#[derive(Debug, Serialize)]
pub struct ReferralCode {
    pub code: String,
    pub url: String,
}

#[derive(Debug, Serialize)]
pub struct ReferralStats {
    pub total_referrals: i64,
    pub active_referrals: i64,
    pub total_volume: f64,
    pub total_rewards: f64,
}

#[derive(Debug, Deserialize)]
pub struct ReferralHistoryQuery {
    pub page: Option<i32>,
    pub limit: Option<i32>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ReferralHistoryItem {
    pub tx_hash: String,
    pub user_address: String,
    pub action: String,
    pub volume_usd: f64,
    pub points: f64,
    pub status: String,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

// Struct bantuan untuk mapping hasil query COUNT
#[derive(sqlx::FromRow)]
struct CountResult {
    total: i64,
}

fn build_referral_code(user_address: &str) -> String {
    format!("CAREL_{}", &user_address[2..10].to_uppercase())
}

fn build_referral_url(code: &str) -> String {
    format!("https://zkcarel.io?ref={}", code)
}

/// GET /api/v1/referral/code
pub async fn get_code(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<ReferralCode>>> {
    let user_address = require_user(&headers, &state).await?;
    let code = build_referral_code(&user_address);
    
    let response = ReferralCode {
        code: code.clone(),
        url: build_referral_url(&code),
    };
    
    Ok(Json(ApiResponse::success(response)))
}

/// GET /api/v1/referral/stats
pub async fn get_stats(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<ReferralStats>>> {
    let user_address = require_user(&headers, &state).await?;
    
    // Perbaikan: Gunakan query_as untuk menghindari keharusan DATABASE_URL saat compile
    let stats_result: CountResult = sqlx::query_as(
        "SELECT COUNT(*) as total FROM users WHERE referrer = $1"
    )
    .bind(&user_address)
    .fetch_one(state.db.pool())
    .await?;

    let active_result: CountResult = sqlx::query_as(
        "SELECT COUNT(*) as total FROM users WHERE referrer = $1 AND last_active > NOW() - INTERVAL '30 days'"
    )
    .bind(&user_address)
    .fetch_one(state.db.pool())
    .await?;

    let total_volume: f64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(usd_value), 0)::FLOAT FROM transactions WHERE user_address IN (SELECT address FROM users WHERE referrer = $1)"
    )
    .bind(&user_address)
    .fetch_one(state.db.pool())
    .await?;

    let total_rewards: f64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(referral_points), 0)::FLOAT FROM points WHERE user_address = $1"
    )
    .bind(user_address)
    .fetch_one(state.db.pool())
    .await?;
    
    let response = ReferralStats {
        total_referrals: stats_result.total,
        active_referrals: active_result.total,
        total_volume,
        total_rewards,
    };
    
    Ok(Json(ApiResponse::success(response)))
}

/// GET /api/v1/referral/history
pub async fn get_history(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(query): axum::extract::Query<ReferralHistoryQuery>,
) -> Result<Json<ApiResponse<PaginatedResponse<ReferralHistoryItem>>>> {
    let user_address = require_user(&headers, &state).await?;
    let page = query.page.unwrap_or(1);
    let limit = query.limit.unwrap_or(10);
    ensure_page_limit(limit, state.config.rate_limit_authenticated)?;

    let offset = (page - 1) * limit;

    let items = sqlx::query_as::<_, ReferralHistoryItem>(
        r#"
        SELECT 
            t.tx_hash,
            t.user_address,
            t.tx_type as action,
            COALESCE(CAST(t.usd_value AS FLOAT), 0) as volume_usd,
            COALESCE(CAST(t.points_earned AS FLOAT), 0) as points,
            CASE WHEN t.processed THEN 'completed' ELSE 'pending' END as status,
            t.timestamp
        FROM transactions t
        WHERE t.user_address IN (
            SELECT address FROM users WHERE referrer = $1
        )
        ORDER BY t.timestamp DESC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(&user_address)
    .bind(limit as i64)
    .bind(offset as i64)
    .fetch_all(state.db.pool())
    .await?;

    let total_res: CountResult = sqlx::query_as(
        "SELECT COUNT(*) as total FROM transactions WHERE user_address IN (SELECT address FROM users WHERE referrer = $1)"
    )
    .bind(&user_address)
    .fetch_one(state.db.pool())
    .await?;

    let response = PaginatedResponse {
        items,
        page,
        limit,
        total: total_res.total,
    };

    Ok(Json(ApiResponse::success(response)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_referral_code_uses_address_slice() {
        // Memastikan kode referral mengambil substring alamat
        let code = build_referral_code("0x1234567890abcdef");
        assert_eq!(code, "CAREL_12345678");
    }

    #[test]
    fn build_referral_url_appends_code() {
        // Memastikan URL referral memakai kode yang diberikan
        let url = build_referral_url("CAREL_TEST");
        assert_eq!(url, "https://zkcarel.io?ref=CAREL_TEST");
    }
}
