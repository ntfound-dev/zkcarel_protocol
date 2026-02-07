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
