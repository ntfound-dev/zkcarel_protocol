use super::{require_user, AppState};
use crate::{
    config::Config,
    constants::{
        POINTS_DISCORD_JOIN, POINTS_DISCORD_ROLE, POINTS_DISCORD_VERIFY,
        POINTS_TELEGRAM_JOIN_CHANNEL, POINTS_TELEGRAM_JOIN_GROUP, POINTS_TWITTER_COMMENT,
        POINTS_TWITTER_FOLLOW, POINTS_TWITTER_LIKE, POINTS_TWITTER_RETWEET,
    },
    error::{AppError, Result},
    models::ApiResponse,
    services::SocialVerifier,
};
use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

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

#[derive(Debug, Clone, Serialize)]
pub struct SocialTaskDefinition {
    pub id: String,
    pub title: String,
    pub description: String,
    pub points: f64,
    pub provider: String,
}

#[derive(Debug, Clone, Deserialize)]
struct SocialTaskDefinitionInput {
    id: String,
    title: Option<String>,
    description: Option<String>,
    points: f64,
    provider: Option<String>,
}

// Internal helper that supports `infer_provider` operations.
fn infer_provider(task_id: &str) -> Option<&'static str> {
    if task_id.starts_with("twitter_") {
        return Some("twitter");
    }
    if task_id.starts_with("telegram_") {
        return Some("telegram");
    }
    if task_id.starts_with("discord_") {
        return Some("discord");
    }
    None
}

// Internal helper that fetches data for `resolve_task_alias`.
fn resolve_task_alias(task_type: &str) -> &str {
    if task_type.eq_ignore_ascii_case("telegram_join") {
        "telegram_join_channel"
    } else {
        task_type
    }
}

// Internal helper that supports `default_social_tasks` operations.
fn default_social_tasks() -> Vec<SocialTaskDefinition> {
    vec![
        SocialTaskDefinition {
            id: "twitter_follow".to_string(),
            title: "X: Follow".to_string(),
            description: "Follow official X account".to_string(),
            points: POINTS_TWITTER_FOLLOW,
            provider: "twitter".to_string(),
        },
        SocialTaskDefinition {
            id: "twitter_like".to_string(),
            title: "X: Like".to_string(),
            description: "Like announcement post".to_string(),
            points: POINTS_TWITTER_LIKE,
            provider: "twitter".to_string(),
        },
        SocialTaskDefinition {
            id: "twitter_retweet".to_string(),
            title: "X: Retweet".to_string(),
            description: "Retweet announcement post".to_string(),
            points: POINTS_TWITTER_RETWEET,
            provider: "twitter".to_string(),
        },
        SocialTaskDefinition {
            id: "twitter_comment".to_string(),
            title: "X: Comment".to_string(),
            description: "Comment on announcement post".to_string(),
            points: POINTS_TWITTER_COMMENT,
            provider: "twitter".to_string(),
        },
        SocialTaskDefinition {
            id: "telegram_join_channel".to_string(),
            title: "Telegram: Join Channel".to_string(),
            description: "Join official Telegram channel".to_string(),
            points: POINTS_TELEGRAM_JOIN_CHANNEL,
            provider: "telegram".to_string(),
        },
        SocialTaskDefinition {
            id: "telegram_join_group".to_string(),
            title: "Telegram: Join Group".to_string(),
            description: "Join official Telegram group".to_string(),
            points: POINTS_TELEGRAM_JOIN_GROUP,
            provider: "telegram".to_string(),
        },
        SocialTaskDefinition {
            id: "discord_join".to_string(),
            title: "Discord: Join".to_string(),
            description: "Join Discord server".to_string(),
            points: POINTS_DISCORD_JOIN,
            provider: "discord".to_string(),
        },
        SocialTaskDefinition {
            id: "discord_verify".to_string(),
            title: "Discord: Verify".to_string(),
            description: "Complete Discord verification".to_string(),
            points: POINTS_DISCORD_VERIFY,
            provider: "discord".to_string(),
        },
        SocialTaskDefinition {
            id: "discord_role".to_string(),
            title: "Discord: Role".to_string(),
            description: "Claim specific Discord role".to_string(),
            points: POINTS_DISCORD_ROLE,
            provider: "discord".to_string(),
        },
    ]
}

// Internal helper that supports `social_task_catalog` operations.
fn social_task_catalog(config: &Config) -> Vec<SocialTaskDefinition> {
    let Some(raw) = config
        .social_tasks_json
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return default_social_tasks();
    };

    let parsed: Vec<SocialTaskDefinitionInput> = match serde_json::from_str(raw) {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(
                "Invalid SOCIAL_TASKS_JSON, fallback to defaults. parse_error={}",
                err
            );
            return default_social_tasks();
        }
    };

    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for item in parsed {
        let id = item.id.trim().to_ascii_lowercase();
        if id.is_empty() || seen.contains(&id) || !item.points.is_finite() || item.points < 0.0 {
            continue;
        }
        let provider = item
            .provider
            .as_deref()
            .map(|value| value.trim().to_ascii_lowercase())
            .filter(|value| matches!(value.as_str(), "twitter" | "telegram" | "discord"))
            .or_else(|| infer_provider(&id).map(str::to_string));
        let Some(provider) = provider else {
            continue;
        };

        seen.insert(id.clone());
        out.push(SocialTaskDefinition {
            title: item
                .title
                .unwrap_or_else(|| id.replace('_', " ").to_string())
                .trim()
                .to_string(),
            description: item
                .description
                .unwrap_or_else(|| "Complete task and submit proof".to_string())
                .trim()
                .to_string(),
            points: item.points,
            provider,
            id,
        });
    }

    if out.is_empty() {
        return default_social_tasks();
    }
    out
}

/// GET /api/v1/social/tasks
pub async fn get_tasks(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<SocialTaskDefinition>>>> {
    let tasks = social_task_catalog(&state.config);
    Ok(Json(ApiResponse::success(tasks)))
}

/// POST /api/v1/social/verify
pub async fn verify_task(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<VerifyTaskRequest>,
) -> Result<Json<ApiResponse<VerifyTaskResponse>>> {
    // Gunakan 'proof' di sini agar tidak dianggap dead code
    // Sekaligus membantu debugging untuk melihat apa yang dikirim user
    tracing::info!(
        "Verifying task: {} with proof: {}",
        req.task_type,
        req.proof
    );

    let verifier = SocialVerifier::new(state.db.clone(), state.config.clone());
    let user_address = require_user(&headers, &state).await?;
    let requested_id = resolve_task_alias(req.task_type.trim());
    let tasks = social_task_catalog(&state.config);
    let task = tasks
        .iter()
        .find(|task| task.id.eq_ignore_ascii_case(requested_id))
        .ok_or_else(|| AppError::BadRequest("Invalid task type".into()))?;

    let verified = match task.provider.as_str() {
        "twitter" => {
            verifier
                .verify_twitter(&user_address, task.id.as_str(), &req.proof)
                .await?
        }
        "telegram" => {
            verifier
                .verify_telegram(&user_address, task.id.as_str(), &req.proof)
                .await?
        }
        "discord" => {
            verifier
                .verify_discord(&user_address, task.id.as_str(), &req.proof)
                .await?
        }
        _ => {
            return Err(AppError::BadRequest(
                "Unsupported social task provider".into(),
            ))
        }
    };

    let points = task.points;

    if verified && points > 0.0 {
        verifier.award_points(&user_address, points).await?;
    }

    let response = VerifyTaskResponse {
        verified,
        points_earned: if verified { points } else { 0.0 },
        message: if verified {
            format!("Task {} verified successfully", task.id)
        } else {
            format!("Task {} verification failed", task.id)
        },
    };

    Ok(Json(ApiResponse::success(response)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    // Internal helper that supports `default_social_task_catalog_contains_expected_rules` operations.
    fn default_social_task_catalog_contains_expected_rules() {
        let tasks = default_social_tasks();
        let twitter_follow = tasks
            .iter()
            .find(|task| task.id == "twitter_follow")
            .expect("twitter_follow exists");
        assert_eq!(twitter_follow.points, POINTS_TWITTER_FOLLOW);
        let twitter_comment = tasks
            .iter()
            .find(|task| task.id == "twitter_comment")
            .expect("twitter_comment exists");
        assert_eq!(twitter_comment.points, POINTS_TWITTER_COMMENT);
    }

    #[test]
    // Internal helper that fetches data for `resolve_task_alias_maps_legacy_telegram_join`.
    fn resolve_task_alias_maps_legacy_telegram_join() {
        assert_eq!(resolve_task_alias("telegram_join"), "telegram_join_channel");
        assert_eq!(resolve_task_alias("discord_join"), "discord_join");
    }
}
