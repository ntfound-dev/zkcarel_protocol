// src/api/mod.rs

// Re-export your API endpoint modules here (sesuaikan kalau ada/tdk ada)
pub mod auth;
pub mod health;
pub mod swap;
pub mod bridge;
pub mod limit_order;
pub mod stake;
pub mod portfolio;
pub mod analytics;
pub mod leaderboard;
pub mod rewards;
pub mod nft;
pub mod referral;
pub mod social;
pub mod faucet;
pub mod notifications;
pub mod transactions;
pub mod charts;
pub mod webhooks;
pub mod ai;
pub mod deposit;
pub mod market;
pub mod privacy;
pub mod private_btc_swap;
pub mod dark_pool;
pub mod private_payments;
pub mod anonymous_credentials;
pub mod wallet;

use axum::http::{header::AUTHORIZATION, HeaderMap};
use crate::error::{AppError, Result};

// AppState definition
use crate::config::Config;
use crate::db::Database;
use r2d2::Pool;
use r2d2_redis::RedisConnectionManager;

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub redis: Pool<RedisConnectionManager>,
    pub config: Config,
}

pub async fn require_user(headers: &HeaderMap, state: &AppState) -> Result<String> {
    let auth_header = headers
        .get(AUTHORIZATION)
        .ok_or_else(|| AppError::AuthError("Missing Authorization header".to_string()))?;
    let auth_str = auth_header
        .to_str()
        .map_err(|_| AppError::AuthError("Invalid Authorization header".to_string()))?;
    let token = auth_str
        .strip_prefix("Bearer ")
        .ok_or_else(|| AppError::AuthError("Invalid Authorization scheme".to_string()))?;

    let user_address = auth::extract_user_from_token(token, &state.config.jwt_secret).await?;
    state.db.create_user(&user_address).await?;
    state.db.update_last_active(&user_address).await?;
    Ok(user_address)
}

pub async fn ensure_user_exists(state: &AppState, address: &str) -> Result<()> {
    state.db.create_user(address).await?;
    Ok(())
}
