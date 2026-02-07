use axum::{
    extract::{State, Path},
    Json,
};
use serde::Serialize;

use crate::{
    error::Result,
    models::ApiResponse,
};

use super::AppState;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct LeaderboardEntry {
    pub rank: i64,
    #[sqlx(rename = "user_address")] // Sesuaikan jika nama kolom di SQL berbeda
    pub address: String,
    pub display_name: Option<String>,
    pub value: f64,
    pub change_24h: Option<f64>,
}

// Tambahkan struct bantuan untuk query manual agar tidak "Type Annotation Needed"
#[derive(sqlx::FromRow)]
struct CountResult {
    count: i64,
}

#[derive(sqlx::FromRow)]
struct RankResult {
    rank: i64,
}

#[derive(Debug, Serialize)]
pub struct LeaderboardResponse {
    pub leaderboard_type: String,
    pub entries: Vec<LeaderboardEntry>,
    pub total_users: i64,
}

#[derive(Debug, Serialize)]
pub struct UserRankResponse {
    pub rank: i64,
    pub total_users: i64,
    pub percentile: f64,
    pub value: f64,
}

/// GET /api/v1/leaderboard/:type
pub async fn get_leaderboard(
    State(state): State<AppState>,
    Path(leaderboard_type): Path<String>,
) -> Result<Json<ApiResponse<LeaderboardResponse>>> {
    let entries = match leaderboard_type.as_str() {
        "points" => get_points_leaderboard(&state).await?,
        "volume" => get_volume_leaderboard(&state).await?,
        "referrals" => get_referrals_leaderboard(&state).await?,
        _ => return Err(crate::error::AppError::BadRequest(
            "Invalid leaderboard type".to_string()
        )),
    };

    // Gunakan query_as untuk menghindari keharusan DATABASE_URL saat compile
    let total_users: CountResult = sqlx::query_as("SELECT COUNT(DISTINCT address) as count FROM users")
        .fetch_one(state.db.pool())
        .await?;

    let response = LeaderboardResponse {
        leaderboard_type,
        entries,
        total_users: total_users.count,
    };

    Ok(Json(ApiResponse::success(response)))
}

/// GET /api/v1/leaderboard/user/:address
pub async fn get_user_rank(
    State(state): State<AppState>,
    Path(address): Path<String>,
) -> Result<Json<ApiResponse<UserRankResponse>>> {
    let current_epoch = (chrono::Utc::now().timestamp() / 2592000) as i64;

    let user_points = state.db.get_user_points(&address, current_epoch).await?
        .ok_or_else(|| crate::error::AppError::NotFound("User not found".to_string()))?;

    let user_total: f64 = user_points.total_points.to_string().parse().unwrap_or(0.0);

    let rank_result: RankResult = sqlx::query_as(
        "SELECT COUNT(*) + 1 as rank FROM points WHERE epoch = $1 AND total_points > $2"
    )
    .bind(current_epoch)
    .bind(user_points.total_points)
    .fetch_one(state.db.pool())
    .await?;

    let total_users_res: CountResult = sqlx::query_as(
        "SELECT COUNT(DISTINCT user_address) as count FROM points WHERE epoch = $1"
    )
    .bind(current_epoch)
    .fetch_one(state.db.pool())
    .await?;

    let total_users = if total_users_res.count == 0 { 1 } else { total_users_res.count };
    let percentile = (1.0 - (rank_result.rank as f64 / total_users as f64)) * 100.0;

    Ok(Json(ApiResponse::success(UserRankResponse {
        rank: rank_result.rank,
        total_users,
        percentile,
        value: user_total,
    })))
}

async fn get_points_leaderboard(state: &AppState) -> Result<Vec<LeaderboardEntry>> {
    let current_epoch = (chrono::Utc::now().timestamp() / 2592000) as i64;

    // Perhatikan penggunaan CAST(... AS FLOAT) agar cocok dengan struct f64
    let entries = sqlx::query_as::<_, LeaderboardEntry>(
        "SELECT 
            ROW_NUMBER() OVER (ORDER BY p.total_points DESC) as rank,
            p.user_address,
            u.display_name,
            CAST(p.total_points AS FLOAT) as value,
            NULL as change_24h
         FROM points p
         JOIN users u ON p.user_address = u.address
         WHERE p.epoch = $1
         ORDER BY p.total_points DESC
         LIMIT 100"
    )
    .bind(current_epoch)
    .fetch_all(state.db.pool())
    .await?;

    Ok(entries)
}

async fn get_volume_leaderboard(state: &AppState) -> Result<Vec<LeaderboardEntry>> {
    let entries = sqlx::query_as::<_, LeaderboardEntry>(
        "SELECT 
            ROW_NUMBER() OVER (ORDER BY u.total_volume_usd DESC) as rank,
            u.address as user_address,
            u.display_name,
            CAST(u.total_volume_usd AS FLOAT) as value,
            NULL as change_24h
         FROM users u
         ORDER BY u.total_volume_usd DESC
         LIMIT 100"
    )
    .fetch_all(state.db.pool())
    .await?;

    Ok(entries)
}

async fn get_referrals_leaderboard(state: &AppState) -> Result<Vec<LeaderboardEntry>> {
    let entries = sqlx::query_as::<_, LeaderboardEntry>(
        "SELECT 
            ROW_NUMBER() OVER (ORDER BY referral_count DESC) as rank,
            COALESCE(referrer, '') as user_address,
            u.display_name,
            CAST(referral_count AS FLOAT) as value,
            NULL as change_24h
         FROM (
            SELECT referrer, COUNT(*) as referral_count
            FROM users
            WHERE referrer IS NOT NULL
            GROUP BY referrer
         ) r
         JOIN users u ON r.referrer = u.address
         ORDER BY referral_count DESC
         LIMIT 100"
    )
    .fetch_all(state.db.pool())
    .await?;

    Ok(entries)
}
