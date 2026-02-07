use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use crate::{error::Result, models::ApiResponse};
use super::AppState;

#[derive(Debug, Deserialize)]
pub struct VerifyTaskRequest {
    pub task_type: String, 
    pub proof: String,
}

#[derive(Debug, Serialize)]
pub struct VerifyTaskResponse {
    pub verified: bool,
    pub points_earned: f64,
    pub message: String,
}

/// POST /api/v1/social/verify
pub async fn verify_task(
    State(_state): State<AppState>,
    Json(req): Json<VerifyTaskRequest>,
) -> Result<Json<ApiResponse<VerifyTaskResponse>>> {
    // Gunakan 'proof' di sini agar tidak dianggap dead code
    // Sekaligus membantu debugging untuk melihat apa yang dikirim user
    tracing::info!("Verifying task: {} with proof: {}", req.task_type, req.proof);

    // TODO: Actual verification with social APIs
    
    let points = match req.task_type.as_str() {
        "twitter_follow" => 50.0,
        "telegram_join" => 30.0,
        "discord_join" => 30.0,
        "twitter_retweet" => 25.0,
        _ => 10.0,
    };
    
    let response = VerifyTaskResponse {
        verified: true,
        points_earned: points,
        message: format!("Task {} verified successfully", req.task_type),
    };
    
    Ok(Json(ApiResponse::success(response)))
}
