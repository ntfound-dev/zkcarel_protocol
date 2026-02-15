use async_trait::async_trait;
use axum::{
    extract::{Path, State},
    Json,
};
use rust_decimal::Decimal;
use serde::Serialize;

use crate::{constants::EPOCH_DURATION_SECONDS, error::Result, models::ApiResponse};

use super::{ensure_user_exists, AppState};

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
pub struct GlobalMetricsResponse {
    pub points_total: f64,
    pub volume_total: f64,
    pub referral_total: i64,
}

#[async_trait]
trait GlobalMetricsStore {
    async fn points_total(&self, epoch: i64) -> Result<f64>;
    async fn volume_total(
        &self,
        start: chrono::DateTime<chrono::Utc>,
        end: chrono::DateTime<chrono::Utc>,
    ) -> Result<f64>;
    async fn referral_total(
        &self,
        start: chrono::DateTime<chrono::Utc>,
        end: chrono::DateTime<chrono::Utc>,
    ) -> Result<i64>;
}

struct PgMetricsStore<'a> {
    pool: &'a sqlx::PgPool,
}

#[async_trait]
impl<'a> GlobalMetricsStore for PgMetricsStore<'a> {
    async fn points_total(&self, epoch: i64) -> Result<f64> {
        let value: Decimal = sqlx::query_scalar::<_, Decimal>(
            "SELECT COALESCE(SUM(total_points), 0) FROM points WHERE epoch = $1",
        )
        .bind(epoch)
        .fetch_one(self.pool)
        .await?;
        Ok(value.to_string().parse().unwrap_or(0.0))
    }

    async fn volume_total(
        &self,
        start: chrono::DateTime<chrono::Utc>,
        end: chrono::DateTime<chrono::Utc>,
    ) -> Result<f64> {
        let value: Decimal = sqlx::query_scalar::<_, Decimal>(
            "SELECT COALESCE(SUM(usd_value), 0)
             FROM transactions
             WHERE timestamp >= $1
               AND timestamp < $2
               AND COALESCE(is_private, false) = false",
        )
        .bind(start)
        .bind(end)
        .fetch_one(self.pool)
        .await?;
        Ok(value.to_string().parse().unwrap_or(0.0))
    }

    async fn referral_total(
        &self,
        start: chrono::DateTime<chrono::Utc>,
        end: chrono::DateTime<chrono::Utc>,
    ) -> Result<i64> {
        let value: i64 = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM users WHERE referrer IS NOT NULL AND created_at >= $1 AND created_at < $2",
        )
        .bind(start)
        .bind(end)
        .fetch_one(self.pool)
        .await?;
        Ok(value)
    }
}

fn epoch_window(
    epoch: i64,
) -> Result<(chrono::DateTime<chrono::Utc>, chrono::DateTime<chrono::Utc>)> {
    let start = chrono::DateTime::<chrono::Utc>::from_timestamp(epoch * EPOCH_DURATION_SECONDS, 0)
        .ok_or_else(|| crate::error::AppError::BadRequest("Invalid epoch".to_string()))?;
    let end = start + chrono::Duration::seconds(EPOCH_DURATION_SECONDS);
    Ok((start, end))
}

async fn get_global_metrics_epoch_with<S: GlobalMetricsStore + Sync>(
    store: &S,
    epoch: i64,
) -> Result<GlobalMetricsResponse> {
    let (start, end) = epoch_window(epoch)?;
    let points_total = store.points_total(epoch).await?;
    let volume_total = store.volume_total(start, end).await?;
    let referral_total = store.referral_total(start, end).await?;
    Ok(GlobalMetricsResponse {
        points_total,
        volume_total,
        referral_total,
    })
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

fn normalize_scope_addresses(user_addresses: &[String]) -> Vec<String> {
    let mut normalized = Vec::new();
    for address in user_addresses {
        let trimmed = address.trim();
        if trimmed.is_empty() {
            continue;
        }
        let lower = trimmed.to_ascii_lowercase();
        if normalized.iter().any(|existing| existing == &lower) {
            continue;
        }
        normalized.push(lower);
    }
    normalized
}

async fn resolve_leaderboard_identity(
    state: &AppState,
    address: &str,
) -> Result<(String, Vec<String>)> {
    let canonical_address = state
        .db
        .find_user_by_wallet_address(address, None)
        .await?
        .unwrap_or_else(|| address.to_string());
    ensure_user_exists(state, &canonical_address).await?;

    let mut scopes = vec![canonical_address.clone(), address.to_string()];
    if let Ok(linked_wallets) = state.db.list_wallet_addresses(&canonical_address).await {
        for linked in linked_wallets {
            scopes.push(linked.wallet_address);
        }
    }
    Ok((canonical_address, normalize_scope_addresses(&scopes)))
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
        _ => {
            return Err(crate::error::AppError::BadRequest(
                "Invalid leaderboard type".to_string(),
            ))
        }
    };

    // Gunakan query_as untuk menghindari keharusan DATABASE_URL saat compile
    let total_users: CountResult =
        sqlx::query_as("SELECT COUNT(DISTINCT address) as count FROM users")
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

    let (canonical_address, scope_addresses) = resolve_leaderboard_identity(&state, &address).await?;
    let user_total: f64 = sqlx::query_scalar::<_, f64>(
        "SELECT COALESCE(SUM(total_points), 0)::FLOAT
         FROM points
         WHERE LOWER(user_address) = ANY($1) AND epoch = $2",
    )
    .bind(scope_addresses)
    .bind(current_epoch)
    .fetch_one(state.db.pool())
    .await?
    ;

    let rank_result: RankResult = sqlx::query_as(
        r#"
        WITH identity_points AS (
            SELECT
                COALESCE(uw.user_address, p.user_address) as identity,
                COALESCE(SUM(p.total_points), 0) as total_points
            FROM points p
            LEFT JOIN user_wallet_addresses uw
              ON LOWER(uw.wallet_address) = LOWER(p.user_address)
            WHERE p.epoch = $1
            GROUP BY COALESCE(uw.user_address, p.user_address)
        )
        SELECT COUNT(*) + 1 as rank
        FROM identity_points
        WHERE total_points > COALESCE(
              (
                  SELECT ip.total_points
                  FROM identity_points ip
                  WHERE LOWER(ip.identity) = LOWER($2)
                  LIMIT 1
              ),
              0
          )
        "#,
    )
    .bind(current_epoch)
    .bind(&canonical_address)
    .fetch_one(state.db.pool())
    .await?;

    let total_users_res: CountResult =
        sqlx::query_as(
            r#"
            SELECT COUNT(*) as count
            FROM (
                SELECT COALESCE(uw.user_address, p.user_address) as identity
                FROM points p
                LEFT JOIN user_wallet_addresses uw
                  ON LOWER(uw.wallet_address) = LOWER(p.user_address)
                WHERE p.epoch = $1
                GROUP BY COALESCE(uw.user_address, p.user_address)
            ) s
            "#,
        )
        .bind(current_epoch)
        .fetch_one(state.db.pool())
        .await?;

    let total_users = if total_users_res.count == 0 {
        1
    } else {
        total_users_res.count
    };
    let percentile = compute_percentile(rank_result.rank, total_users);

    Ok(Json(ApiResponse::success(UserRankResponse {
        rank: rank_result.rank,
        total_users,
        percentile,
        value: user_total,
    })))
}

/// GET /api/v1/leaderboard/global
pub async fn get_global_metrics(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<GlobalMetricsResponse>>> {
    let current_epoch = (chrono::Utc::now().timestamp() / EPOCH_DURATION_SECONDS) as i64;

    let points_total: Decimal = sqlx::query_scalar::<_, Decimal>(
        "SELECT COALESCE(SUM(total_points), 0) FROM points WHERE epoch = $1",
    )
    .bind(current_epoch)
    .fetch_one(state.db.pool())
    .await?;

    let volume_total: Decimal = sqlx::query_scalar::<_, Decimal>(
        "SELECT COALESCE(SUM(usd_value), 0) FROM transactions WHERE COALESCE(is_private, false) = false",
    )
    .fetch_one(state.db.pool())
    .await?;

    let referral_total: i64 =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users WHERE referrer IS NOT NULL")
            .fetch_one(state.db.pool())
            .await?;

    Ok(Json(ApiResponse::success(GlobalMetricsResponse {
        points_total: points_total.to_string().parse().unwrap_or(0.0),
        volume_total: volume_total.to_string().parse().unwrap_or(0.0),
        referral_total,
    })))
}

/// GET /api/v1/leaderboard/global/{epoch}
pub async fn get_global_metrics_epoch(
    State(state): State<AppState>,
    Path(epoch): Path<i64>,
) -> Result<Json<ApiResponse<GlobalMetricsResponse>>> {
    let store = PgMetricsStore {
        pool: state.db.pool(),
    };
    let metrics = get_global_metrics_epoch_with(&store, epoch).await?;
    Ok(Json(ApiResponse::success(metrics)))
}

/// GET /api/v1/leaderboard/user/:address/categories
pub async fn get_user_categories(
    State(state): State<AppState>,
    Path(address): Path<String>,
) -> Result<Json<ApiResponse<UserRankCategoriesResponse>>> {
    let (canonical_address, scope_addresses) = resolve_leaderboard_identity(&state, &address).await?;

    let current_epoch = (chrono::Utc::now().timestamp() / EPOCH_DURATION_SECONDS) as i64;

    let user_points_total: f64 = sqlx::query_scalar::<_, f64>(
        "SELECT COALESCE(SUM(total_points), 0)::FLOAT
         FROM points
         WHERE LOWER(user_address) = ANY($1) AND epoch = $2",
    )
    .bind(scope_addresses.clone())
    .bind(current_epoch)
    .fetch_one(state.db.pool())
    .await?
    ;

    let points_rank: RankResult = sqlx::query_as(
        r#"
        WITH identity_points AS (
            SELECT
                COALESCE(uw.user_address, p.user_address) as identity,
                COALESCE(SUM(p.total_points), 0) as total_points
            FROM points p
            LEFT JOIN user_wallet_addresses uw
              ON LOWER(uw.wallet_address) = LOWER(p.user_address)
            WHERE p.epoch = $1
            GROUP BY COALESCE(uw.user_address, p.user_address)
        )
        SELECT COUNT(*) + 1 as rank
        FROM identity_points
        WHERE total_points > COALESCE(
              (
                  SELECT ip.total_points
                  FROM identity_points ip
                  WHERE LOWER(ip.identity) = LOWER($2)
                  LIMIT 1
              ),
              0
          )
        "#,
    )
    .bind(current_epoch)
    .bind(&canonical_address)
    .fetch_one(state.db.pool())
    .await?;

    let points_total: CountResult = sqlx::query_as(
        r#"
        SELECT COUNT(*) as count
        FROM (
            SELECT COALESCE(uw.user_address, p.user_address) as identity
            FROM points p
            LEFT JOIN user_wallet_addresses uw
              ON LOWER(uw.wallet_address) = LOWER(p.user_address)
            WHERE p.epoch = $1
            GROUP BY COALESCE(uw.user_address, p.user_address)
        ) s
        "#,
    )
    .bind(current_epoch)
    .fetch_one(state.db.pool())
    .await?;

    let volume_value: f64 = sqlx::query_scalar::<_, f64>(
        "SELECT COALESCE(SUM(usd_value), 0)::FLOAT
         FROM transactions
         WHERE LOWER(user_address) = ANY($1)
           AND COALESCE(is_private, false) = false",
    )
    .bind(scope_addresses)
    .fetch_one(state.db.pool())
    .await?;

    let volume_rank: RankResult = sqlx::query_as(
        r#"
        WITH identity_volume AS (
            SELECT
                COALESCE(uw.user_address, t.user_address) as identity,
                COALESCE(SUM(t.usd_value), 0) as volume_usd
            FROM transactions t
            LEFT JOIN user_wallet_addresses uw
              ON LOWER(uw.wallet_address) = LOWER(t.user_address)
            WHERE COALESCE(t.is_private, false) = false
            GROUP BY COALESCE(uw.user_address, t.user_address)
        )
        SELECT COUNT(*) + 1 as rank
        FROM identity_volume
        WHERE volume_usd > COALESCE(
            (
                SELECT iv.volume_usd
                FROM identity_volume iv
                WHERE LOWER(iv.identity) = LOWER($1)
                LIMIT 1
            ),
            0
        )
        "#,
    )
    .bind(&canonical_address)
    .fetch_one(state.db.pool())
    .await?;

    let volume_total: CountResult = sqlx::query_as(
        r#"
        SELECT COUNT(*) as count
        FROM (
            SELECT COALESCE(uw.user_address, t.user_address) as identity
            FROM transactions t
            LEFT JOIN user_wallet_addresses uw
              ON LOWER(uw.wallet_address) = LOWER(t.user_address)
            WHERE COALESCE(t.is_private, false) = false
            GROUP BY COALESCE(uw.user_address, t.user_address)
        ) s
        "#,
    )
    .fetch_one(state.db.pool())
    .await?;

    let referral_count: i64 =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users WHERE LOWER(referrer) = LOWER($1)")
            .bind(&canonical_address)
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
        FROM referral_counts rc
        WHERE rc.referral_count > COALESCE(
            (
                SELECT COUNT(*)
                FROM users
                WHERE LOWER(referrer) = LOWER($1)
            ),
            0
        )
        "#,
    )
    .bind(&canonical_address)
    .fetch_one(state.db.pool())
    .await?;

    let referral_total: CountResult = sqlx::query_as("SELECT COUNT(*) as count FROM users")
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
            total_users: referral_total.count,
            percentile: compute_percentile(referral_rank.rank, referral_total.count),
            value: referral_count as f64,
        },
    ];

    Ok(Json(ApiResponse::success(UserRankCategoriesResponse {
        categories,
    })))
}

async fn get_points_leaderboard(state: &AppState) -> Result<Vec<LeaderboardEntry>> {
    let current_epoch = (chrono::Utc::now().timestamp() / EPOCH_DURATION_SECONDS) as i64;

    let entries = sqlx::query_as::<_, LeaderboardEntry>(
        r#"
        WITH identity_points AS (
            SELECT
                COALESCE(uw.user_address, p.user_address) as identity,
                COALESCE(SUM(p.total_points), 0) as total_points
            FROM points p
            LEFT JOIN user_wallet_addresses uw
              ON LOWER(uw.wallet_address) = LOWER(p.user_address)
            WHERE p.epoch = $1
            GROUP BY COALESCE(uw.user_address, p.user_address)
        )
        SELECT
            ROW_NUMBER() OVER (ORDER BY ip.total_points DESC) as rank,
            ip.identity as user_address,
            COALESCE(NULLIF(TRIM(u.display_name), ''), CONCAT('user_', RIGHT(ip.identity, 6))) as display_name,
            CAST(ip.total_points AS FLOAT) as value,
            NULL as change_24h
        FROM identity_points ip
        LEFT JOIN users u ON LOWER(u.address) = LOWER(ip.identity)
        ORDER BY ip.total_points DESC
        LIMIT 100
        "#,
    )
    .bind(current_epoch)
    .fetch_all(state.db.pool())
    .await?;

    Ok(entries)
}

async fn get_volume_leaderboard(state: &AppState) -> Result<Vec<LeaderboardEntry>> {
    let entries = sqlx::query_as::<_, LeaderboardEntry>(
        r#"
        WITH identity_volume AS (
            SELECT
                COALESCE(uw.user_address, t.user_address) as identity,
                COALESCE(SUM(t.usd_value), 0) as volume_usd
            FROM transactions t
            LEFT JOIN user_wallet_addresses uw
              ON LOWER(uw.wallet_address) = LOWER(t.user_address)
            WHERE COALESCE(t.is_private, false) = false
            GROUP BY COALESCE(uw.user_address, t.user_address)
        )
        SELECT
            ROW_NUMBER() OVER (ORDER BY iv.volume_usd DESC) as rank,
            iv.identity as user_address,
            COALESCE(NULLIF(TRIM(u.display_name), ''), CONCAT('user_', RIGHT(iv.identity, 6))) as display_name,
            CAST(iv.volume_usd AS FLOAT) as value,
            NULL as change_24h
        FROM identity_volume iv
        LEFT JOIN users u ON LOWER(u.address) = LOWER(iv.identity)
        ORDER BY iv.volume_usd DESC
        LIMIT 100
        "#,
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
            COALESCE(NULLIF(TRIM(u.display_name), ''), CONCAT('user_', RIGHT(u.address, 6))) as display_name,
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
    use async_trait::async_trait;

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

    struct MockMetricsStore {
        points_total: f64,
        volume_total: f64,
        referral_total: i64,
    }

    #[async_trait]
    impl GlobalMetricsStore for MockMetricsStore {
        async fn points_total(&self, _epoch: i64) -> Result<f64> {
            Ok(self.points_total)
        }

        async fn volume_total(
            &self,
            _start: chrono::DateTime<chrono::Utc>,
            _end: chrono::DateTime<chrono::Utc>,
        ) -> Result<f64> {
            Ok(self.volume_total)
        }

        async fn referral_total(
            &self,
            _start: chrono::DateTime<chrono::Utc>,
            _end: chrono::DateTime<chrono::Utc>,
        ) -> Result<i64> {
            Ok(self.referral_total)
        }
    }

    #[tokio::test]
    async fn global_metrics_epoch_uses_store_values() {
        let store = MockMetricsStore {
            points_total: 1234.0,
            volume_total: 4567.0,
            referral_total: 42,
        };

        let metrics = get_global_metrics_epoch_with(&store, 1).await.unwrap();
        assert_eq!(metrics.points_total, 1234.0);
        assert_eq!(metrics.volume_total, 4567.0);
        assert_eq!(metrics.referral_total, 42);
    }
}
