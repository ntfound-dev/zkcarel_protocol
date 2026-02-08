use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use crate::{
    constants::{
        POINTS_DISCORD_JOIN,
        POINTS_TELEGRAM_JOIN,
        POINTS_TWITTER_FOLLOW,
        POINTS_TWITTER_RETWEET,
    },
    error::{AppError, Result},
    models::ApiResponse,
    services::SocialVerifier,
};
use super::{AppState, require_user};

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

fn points_for_task(task_type: &str) -> f64 {
    match task_type {
        "twitter_follow" => POINTS_TWITTER_FOLLOW,
        "telegram_join" => POINTS_TELEGRAM_JOIN,
        "discord_join" => POINTS_DISCORD_JOIN,
        "twitter_retweet" => POINTS_TWITTER_RETWEET,
        _ => 0.0,
    }
}

/// POST /api/v1/social/verify
pub async fn verify_task(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<VerifyTaskRequest>,
) -> Result<Json<ApiResponse<VerifyTaskResponse>>> {
    // Gunakan 'proof' di sini agar tidak dianggap dead code
    // Sekaligus membantu debugging untuk melihat apa yang dikirim user
    tracing::info!("Verifying task: {} with proof: {}", req.task_type, req.proof);

    let verifier = SocialVerifier::new(state.db.clone(), state.config.clone());
    let user_address = require_user(&headers, &state).await?;

    let task_type = req.task_type.as_str();
    let verified = match task_type {
        "twitter_follow" => verifier.verify_twitter(&user_address, task_type, &req.proof).await?,
        "twitter_retweet" => verifier.verify_twitter(&user_address, task_type, &req.proof).await?,
        "telegram_join" => verifier.verify_telegram(&user_address, task_type, &req.proof).await?,
        "discord_join" => verifier.verify_discord(&user_address, task_type, &req.proof).await?,
        _ => return Err(AppError::BadRequest("Invalid task type".into())),
    };

    let points = points_for_task(task_type);

    if verified && points > 0.0 {
        verifier.award_points(&user_address, points).await?;
    }
    
    let response = VerifyTaskResponse {
        verified,
        points_earned: if verified { points } else { 0.0 },
        message: if verified {
            format!("Task {} verified successfully", req.task_type)
        } else {
            format!("Task {} verification failed", req.task_type)
        },
    };
    
    Ok(Json(ApiResponse::success(response)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn points_for_task_returns_expected() {
        // Memastikan task twitter_follow mengembalikan poin yang benar
        assert_eq!(points_for_task("twitter_follow"), POINTS_TWITTER_FOLLOW);
    }

    #[test]
    fn points_for_task_unknown_returns_zero() {
        // Memastikan task tidak dikenal mengembalikan 0
        assert!((points_for_task("unknown") - 0.0).abs() < f64::EPSILON);
    }
}
