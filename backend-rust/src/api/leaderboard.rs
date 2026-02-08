use axum::{
    extract::{State, Path},
    Json,
};
use serde::Serialize;

use crate::{
    constants::EPOCH_DURATION_SECONDS,
    error::Result,
    models::ApiResponse,
};

use super::{AppState, ensure_user_exists};

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

fn compute_percentile(rank: i64, total_users: i64) -> f64 {
    if total_users <= 0 {
        return 0.0;
    }
    let safe_rank = rank.clamp(1, total_users);
    (1.0 - (safe_rank as f64 / total_users as f64)) * 100.0
}

#[derive(Debug, Serialize)]
pub struct UserRankCategory {
    pub category: String,
    pub rank: i64,
    pub total_users: i64,
    pub percentile: f64,
    pub value: f64,
}

#[derive(Debug, Serialize)]
pub struct UserRankCategoriesResponse {
    pub categories: Vec<UserRankCategory>,
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
    let current_epoch = (chrono::Utc::now().timestamp() / EPOCH_DURATION_SECONDS) as i64;

    ensure_user_exists(&state, &address).await?;
    let user_points = state.db.get_user_points(&address, current_epoch).await?;
    let user_total: f64 = user_points
        .as_ref()
        .map(|points| points.total_points.to_string().parse().unwrap_or(0.0))
        .unwrap_or(0.0);

    let rank_result: RankResult = sqlx::query_as(
        "SELECT COUNT(*) + 1 as rank FROM points WHERE epoch = $1 AND total_points > $2"
    )
    .bind(current_epoch)
    .bind(user_points.map(|points| points.total_points).unwrap_or(rust_decimal::Decimal::ZERO))
    .fetch_one(state.db.pool())
    .await?;

    let total_users_res: CountResult = sqlx::query_as(
        "SELECT COUNT(DISTINCT user_address) as count FROM points WHERE epoch = $1"
    )
    .bind(current_epoch)
    .fetch_one(state.db.pool())
    .await?;

    let total_users = if total_users_res.count == 0 { 1 } else { total_users_res.count };
    let percentile = compute_percentile(rank_result.rank, total_users);

    Ok(Json(ApiResponse::success(UserRankResponse {
        rank: rank_result.rank,
        total_users,
        percentile,
        value: user_total,
    })))
}

/// GET /api/v1/leaderboard/user/:address/categories
pub async fn get_user_categories(
    State(state): State<AppState>,
    Path(address): Path<String>,
) -> Result<Json<ApiResponse<UserRankCategoriesResponse>>> {
    let user = state.db.get_or_create_user(&address).await?;

    let current_epoch = (chrono::Utc::now().timestamp() / EPOCH_DURATION_SECONDS) as i64;

    let user_points_total = state
        .db
        .get_user_points(&address, current_epoch)
        .await?
        .map(|points| points.total_points.to_string().parse().unwrap_or(0.0))
        .unwrap_or(0.0);

    let points_rank: RankResult = sqlx::query_as(
        "SELECT COUNT(*) + 1 as rank FROM points WHERE epoch = $1 AND total_points > $2",
    )
    .bind(current_epoch)
    .bind(user_points_total)
    .fetch_one(state.db.pool())
    .await?;

    let points_total: CountResult = sqlx::query_as(
        "SELECT COUNT(DISTINCT user_address) as count FROM points WHERE epoch = $1",
    )
    .bind(current_epoch)
    .fetch_one(state.db.pool())
    .await?;

    let volume_value: f64 = user.total_volume_usd.to_string().parse().unwrap_or(0.0);

    let volume_rank: RankResult = sqlx::query_as(
        "SELECT COUNT(*) + 1 as rank FROM users WHERE total_volume_usd > $1",
    )
    .bind(volume_value)
    .fetch_one(state.db.pool())
    .await?;

    let volume_total: CountResult =
        sqlx::query_as("SELECT COUNT(*) as count FROM users")
            .fetch_one(state.db.pool())
            .await?;

    let referral_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM users WHERE referrer = $1",
    )
    .bind(&address)
    .fetch_one(state.db.pool())
    .await?;

    let referral_rank: RankResult = sqlx::query_as(
        r#"
        WITH referral_counts AS (
            SELECT u.address, COALESCE(r.referral_count, 0) as referral_count
            FROM users u
            LEFT JOIN (
                SELECT referrer, COUNT(*) as referral_count
                FROM users
                WHERE referrer IS NOT NULL
                GROUP BY referrer
            ) r ON u.address = r.referrer
        )
        SELECT COUNT(*) + 1 as rank
        FROM referral_counts
        WHERE referral_count > $1
        "#,
    )
    .bind(referral_count)
    .fetch_one(state.db.pool())
    .await?;

    let categories = vec![
        UserRankCategory {
            category: "points".to_string(),
            rank: points_rank.rank,
            total_users: points_total.count,
            percentile: compute_percentile(points_rank.rank, points_total.count),
            value: user_points_total,
        },
        UserRankCategory {
            category: "volume".to_string(),
            rank: volume_rank.rank,
            total_users: volume_total.count,
            percentile: compute_percentile(volume_rank.rank, volume_total.count),
            value: volume_value,
        },
        UserRankCategory {
            category: "referrals".to_string(),
            rank: referral_rank.rank,
            total_users: volume_total.count,
            percentile: compute_percentile(referral_rank.rank, volume_total.count),
            value: referral_count as f64,
        },
    ];

    Ok(Json(ApiResponse::success(UserRankCategoriesResponse { categories })))
}

async fn get_points_leaderboard(state: &AppState) -> Result<Vec<LeaderboardEntry>> {
    let current_epoch = (chrono::Utc::now().timestamp() / EPOCH_DURATION_SECONDS) as i64;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compute_percentile_handles_basic_case() {
        // Memastikan perhitungan percentile sesuai formula
        let percentile = compute_percentile(1, 100);
        assert!((percentile - 99.0).abs() < f64::EPSILON);
    }

    #[test]
    fn compute_percentile_zero_total() {
        // Memastikan total user 0 menghasilkan 0
        let percentile = compute_percentile(1, 0);
        assert!((percentile - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn compute_percentile_clamps_rank() {
        // Memastikan rank di atas total menghasilkan 0
        let percentile = compute_percentile(10, 5);
        assert!((percentile - 0.0).abs() < f64::EPSILON);
    }
}
