use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use crate::{error::Result, models::ApiResponse, services::ai_service::AIService};
use crate::indexer::starknet_client::StarknetClient;
use super::{AppState, require_user};

#[derive(Debug, Deserialize)]
pub struct AICommandRequest {
    pub command: String,
    pub context: Option<String>,
    pub level: Option<u8>,
    pub action_id: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct AICommandResponse {
    pub response: String,
    pub actions: Vec<String>,
    pub confidence: f64,
    pub level: u8,
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
    let level = req.level.unwrap_or(1);

    if level == 0 || level > 3 {
        return Err(crate::error::AppError::BadRequest("Invalid AI level".into()));
    }

    if level >= 2 {
        let Some(action_id) = req.action_id else {
            return Err(crate::error::AppError::BadRequest("Missing on-chain AI action_id".into()));
        };
        ensure_onchain_action(&config, &user_address, action_id).await?;
    }

    let ai_response = service.execute_command(&user_address, &command).await?;
    let confidence = confidence_score(config.openai_api_key.is_some());

    let response = AICommandResponse {
        response: ai_response.message,
        actions: ai_response.actions,
        confidence,
        level,
    };

    Ok(Json(ApiResponse::success(response)))
}

async fn ensure_onchain_action(
    config: &crate::config::Config,
    user_address: &str,
    action_id: u64,
) -> Result<()> {
    if action_id == 0 {
        return Err(crate::error::AppError::BadRequest("Invalid on-chain AI action_id".into()));
    }

    let contract = config.ai_executor_address.trim();
    if contract.is_empty() || contract.starts_with("0x0000") {
        return Err(crate::error::AppError::BadRequest("AI executor not configured".into()));
    }

    let client = StarknetClient::new(config.starknet_rpc_url.clone());
    let start_offset = action_id.saturating_sub(1).to_string();
    let result = client
        .call_contract(
            contract,
            "get_pending_actions_page",
            vec![user_address.to_string(), start_offset, "1".to_string()],
        )
        .await?;

    let mut pending = vec![];
    if let Some(len_hex) = result.get(0) {
        let len = parse_felt_u64(len_hex).unwrap_or(0);
        for i in 0..len as usize {
            if let Some(val) = result.get(i + 1) {
                if let Some(parsed) = parse_felt_u64(val) {
                    pending.push(parsed);
                }
            }
        }
    }

    if !pending.contains(&action_id) {
        return Err(crate::error::AppError::BadRequest("Invalid or missing on-chain AI action".into()));
    }
    Ok(())
}

fn parse_felt_u64(value: &str) -> Option<u64> {
    if let Some(stripped) = value.strip_prefix("0x") {
        u64::from_str_radix(stripped, 16).ok()
    } else {
        value.parse::<u64>().ok()
    }
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
