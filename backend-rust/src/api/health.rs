use super::AppState;
use axum::{extract::State, Json};
use serde::Serialize;

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub database: String,
    pub redis: String,
}

fn build_health_response(db_ok: bool, redis_ok: bool) -> HealthResponse {
    HealthResponse {
        status: "ok".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        database: if db_ok {
            "connected".to_string()
        } else {
            "disconnected".to_string()
        },
        redis: if redis_ok {
            "connected".to_string()
        } else {
            "disconnected".to_string()
        },
    }
}

pub async fn health_check(State(state): State<AppState>) -> Json<HealthResponse> {
    // 1. Cek koneksi Database (SQLx)
    // Menggunakan pool() untuk cek apakah database merespon
    let db_ok = state.db.pool().acquire().await.is_ok();

    // 2. Cek koneksi Redis
    // Mencoba mengambil satu koneksi dari pool r2d2 agar field 'redis' terpakai
    let redis_ok = state.redis.get().is_ok();

    Json(build_health_response(db_ok, redis_ok))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_health_response_formats_status() {
        // Memastikan status koneksi dirender dengan benar
        let response = build_health_response(true, false);
        assert_eq!(response.database, "connected");
        assert_eq!(response.redis, "disconnected");
        assert_eq!(response.status, "ok");
    }
}
