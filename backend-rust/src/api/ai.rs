use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use crate::{error::Result, models::ApiResponse};
use super::AppState;

#[derive(Debug, Deserialize)]
pub struct AICommandRequest {
    pub command: String,
    pub context: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AICommandResponse {
    pub response: String,
    pub actions: Vec<String>,
    pub confidence: f64,
}

/// POST /api/v1/ai/execute
pub async fn execute_command(
    State(_state): State<AppState>,
    Json(req): Json<AICommandRequest>,
) -> Result<Json<ApiResponse<AICommandResponse>>> {
    // Menggunakan field 'context' agar compiler tidak memberikan peringatan dead_code
    let log_msg = match &req.context {
        Some(ctx) => format!("Processing command: '{}' with context: '{}'", req.command, ctx),
        None => format!("Processing command: '{}' without additional context", req.command),
    };

    // Simulasi logika berdasarkan command
    let response = AICommandResponse {
        response: log_msg,
        actions: vec!["analyze_market".to_string(), "check_liquidity".to_string()],
        confidence: 0.92,
    };

    Ok(Json(ApiResponse::success(response)))
}
