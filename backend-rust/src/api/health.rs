use axum::{extract::State, Json};
use serde::Serialize;
use super::AppState;

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub database: String,
    pub redis: String,
}

pub async fn health_check(State(state): State<AppState>) -> Json<HealthResponse> {
    // 1. Cek koneksi Database (SQLx)
    // Menggunakan pool() untuk cek apakah database merespon
    let db_status = if state.db.pool().acquire().await.is_ok() {
        "connected".to_string()
    } else {
        "disconnected".to_string()
    };

    // 2. Cek koneksi Redis
    // Mencoba mengambil satu koneksi dari pool r2d2 agar field 'redis' terpakai
    let redis_status = if state.redis.get().is_ok() {
        "connected".to_string()
    } else {
        "disconnected".to_string()
    };

    Json(HealthResponse {
        status: "ok".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        database: db_status,
        redis: redis_status,
    })
}
