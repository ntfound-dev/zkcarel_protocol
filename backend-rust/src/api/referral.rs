use axum::{extract::State, Json};
use serde::Serialize;
use crate::{error::Result, models::ApiResponse};
use super::AppState;

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

// Struct bantuan untuk mapping hasil query COUNT
#[derive(sqlx::FromRow)]
struct CountResult {
    total: i64,
}

/// GET /api/v1/referral/code
pub async fn get_code(
    State(_state): State<AppState>,
) -> Result<Json<ApiResponse<ReferralCode>>> {
    // TODO: Ambil dari JWT
    let user_address = "0x1234...";
    let code = format!("CAREL_{}", &user_address[2..10].to_uppercase());
    
    let response = ReferralCode {
        code: code.clone(),
        url: format!("https://zkcarel.io?ref={}", code),
    };
    
    Ok(Json(ApiResponse::success(response)))
}

/// GET /api/v1/referral/stats
pub async fn get_stats(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<ReferralStats>>> {
    // TODO: Ambil dari JWT
    let user_address = "0x1234...";
    
    // Perbaikan: Gunakan query_as untuk menghindari keharusan DATABASE_URL saat compile
    let stats_result: CountResult = sqlx::query_as(
        "SELECT COUNT(*) as total FROM users WHERE referrer = $1"
    )
    .bind(user_address)
    .fetch_one(state.db.pool())
    .await?;
    
    let response = ReferralStats {
        total_referrals: stats_result.total,
        // Mock data - nantinya bisa diambil dari query agregasi
        active_referrals: 12,
        total_volume: 125000.0,
        total_rewards: 625.0,
    };
    
    Ok(Json(ApiResponse::success(response)))
}
