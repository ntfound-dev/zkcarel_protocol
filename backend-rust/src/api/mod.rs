// src/api/mod.rs

// Re-export your API endpoint modules here (sesuaikan kalau ada/tdk ada)
pub mod admin;
pub mod ai;
pub mod analytics;
pub mod anonymous_credentials;
pub mod auth;
pub mod battleship;
pub mod bridge;
pub mod charts;
pub mod dark_pool;
pub mod deposit;
pub mod faucet;
pub mod garden;
pub mod health;
pub mod leaderboard;
pub mod limit_order;
pub mod market;
pub mod nft;
pub mod notifications;
pub mod onchain_privacy;
pub mod portfolio;
pub mod privacy;
pub mod private_btc_swap;
pub mod private_payments;
pub mod profile;
pub mod referral;
pub mod rewards;
pub mod social;
pub mod stake;
pub mod swap;
pub mod transactions;
pub mod wallet;
pub mod webhooks;

use crate::error::{AppError, Result};
use axum::http::{header::AUTHORIZATION, HeaderMap};
use redis::aio::ConnectionManager;
use std::{collections::HashMap, sync::OnceLock, time::Instant};
use tokio::time::{timeout, Duration};

// AppState definition
use crate::config::Config;
use crate::db::Database;

const USER_TOUCH_TIMEOUT_MS: u64 = 1200;
const USER_TOUCH_MIN_INTERVAL_SECS: u64 = 30;
const USER_TOUCH_CACHE_MAX_ENTRIES: usize = 200_000;
const USER_TOUCH_CACHE_RETENTION_SECS: u64 = 600;

static USER_TOUCH_CACHE: OnceLock<tokio::sync::RwLock<HashMap<String, Instant>>> = OnceLock::new();

fn user_touch_cache() -> &'static tokio::sync::RwLock<HashMap<String, Instant>> {
    USER_TOUCH_CACHE.get_or_init(|| tokio::sync::RwLock::new(HashMap::new()))
}

async fn should_touch_user(address: &str) -> bool {
    let cache = user_touch_cache();
    let now = Instant::now();
    let min_interval = Duration::from_secs(USER_TOUCH_MIN_INTERVAL_SECS);

    {
        let guard = cache.read().await;
        if let Some(last_seen) = guard.get(address) {
            if now.duration_since(*last_seen) < min_interval {
                return false;
            }
        }
    }

    let mut guard = cache.write().await;
    if let Some(last_seen) = guard.get(address) {
        if now.duration_since(*last_seen) < min_interval {
            return false;
        }
    }

    guard.insert(address.to_string(), now);

    if guard.len() > USER_TOUCH_CACHE_MAX_ENTRIES {
        let retention = Duration::from_secs(USER_TOUCH_CACHE_RETENTION_SECS);
        guard.retain(|_, ts| now.duration_since(*ts) < retention);
    }

    true
}

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub redis: ConnectionManager,
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
    if should_touch_user(&user_address).await {
        match timeout(
            Duration::from_millis(USER_TOUCH_TIMEOUT_MS),
            state.db.touch_user(&user_address),
        )
        .await
        {
            Ok(Ok(())) => {}
            Ok(Err(err)) => tracing::warn!(
                "require_user touch_user failed for {}: {}",
                user_address,
                err
            ),
            Err(_) => tracing::warn!("require_user touch_user timed out for {}", user_address),
        }
    }
    Ok(user_address)
}

fn normalize_scope_address(address: &str) -> Option<String> {
    let trimmed = address.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

fn push_scope_address(scopes: &mut Vec<String>, address: &str) {
    let Some(normalized) = normalize_scope_address(address) else {
        return;
    };
    if scopes
        .iter()
        .any(|existing| existing.eq_ignore_ascii_case(normalized.as_str()))
    {
        return;
    }
    scopes.push(normalized);
}

pub async fn resolve_user_scope_addresses(
    headers: &HeaderMap,
    state: &AppState,
) -> Result<Vec<String>> {
    let auth_subject = require_user(headers, state).await?;
    let mut scopes = Vec::new();
    push_scope_address(&mut scopes, &auth_subject);

    match state.db.list_wallet_addresses(&auth_subject).await {
        Ok(linked_wallets) => {
            for linked in linked_wallets {
                push_scope_address(&mut scopes, &linked.wallet_address);
            }
        }
        Err(error) => {
            tracing::warn!(
                "Failed to list linked wallets for user scope resolution ({}): {}",
                auth_subject,
                error
            );
        }
    }

    Ok(scopes)
}

fn is_starknet_like_address(address: &str) -> bool {
    let trimmed = address.trim();
    if !trimmed.starts_with("0x") {
        return false;
    }
    let hex = &trimmed[2..];
    if hex.is_empty() || hex.len() > 64 {
        return false;
    }
    if !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return false;
    }
    // EVM address is 20 bytes (40 hex chars). Starknet felt addresses are typically longer.
    hex.len() > 40
}

pub async fn require_starknet_user(headers: &HeaderMap, state: &AppState) -> Result<String> {
    let user_address = require_user(headers, state).await?;
    let linked = state.db.list_wallet_addresses(&user_address).await?;
    if let Some(starknet_wallet) = linked
        .iter()
        .rev()
        .find(|wallet| {
            wallet.chain.eq_ignore_ascii_case("starknet")
                && !wallet.wallet_address.trim().is_empty()
        })
        .map(|wallet| wallet.wallet_address.clone())
    {
        tracing::debug!(
            "Resolved Starknet wallet from linked addresses: subject={} starknet_wallet={}",
            user_address,
            starknet_wallet
        );
        return Ok(starknet_wallet);
    }

    if is_starknet_like_address(&user_address) {
        tracing::debug!(
            "Using Starknet-like auth subject as Starknet user: {}",
            user_address
        );
        return Ok(user_address);
    }

    Err(AppError::BadRequest(
        "This endpoint only supports Starknet users. Connect/link Starknet wallet first."
            .to_string(),
    ))
}

pub async fn ensure_user_exists(state: &AppState, address: &str) -> Result<()> {
    state.db.create_user(address).await?;
    Ok(())
}
