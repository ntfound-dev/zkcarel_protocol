use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use crate::{error::Result, models::ApiResponse, services::ai_service::AIService};
use super::{AppState, require_user};

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

fn build_command(command: &str, context: &Option<String>) -> String {
    match context {
        Some(ctx) => format!("{} | context: {}", command, ctx),
        None => command.to_string(),
    }
}

fn confidence_score(has_api_key: bool) -> f64 {
    if has_api_key { 0.9 } else { 0.6 }
}

/// POST /api/v1/ai/execute
pub async fn execute_command(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<AICommandRequest>,
) -> Result<Json<ApiResponse<AICommandResponse>>> {
    let user_address = require_user(&headers, &state).await?;
    let config = state.config.clone();
    let service = AIService::new(state.db, config.clone());

    let command = build_command(&req.command, &req.context);

    let ai_response = service.execute_command(&user_address, &command).await?;
    let confidence = confidence_score(config.openai_api_key.is_some());

    let response = AICommandResponse {
        response: ai_response.message,
        actions: ai_response.actions,
        confidence,
    };

    Ok(Json(ApiResponse::success(response)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_command_without_context() {
        // Memastikan command tidak berubah saat context kosong
        let command = build_command("ping", &None);
        assert_eq!(command, "ping");
    }

    #[test]
    fn build_command_with_context() {
        // Memastikan context ditambahkan ke command
        let command = build_command("ping", &Some("beta".to_string()));
        assert_eq!(command, "ping | context: beta");
    }

    #[test]
    fn confidence_score_depends_on_api_key() {
        // Memastikan skor confidence mengikuti status API key
        assert!((confidence_score(true) - 0.9).abs() < f64::EPSILON);
        assert!((confidence_score(false) - 0.6).abs() < f64::EPSILON);
    }
}
