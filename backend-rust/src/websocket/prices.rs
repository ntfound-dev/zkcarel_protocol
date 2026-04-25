use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::{header::AUTHORIZATION, HeaderMap},
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tokio::time::timeout;

use crate::{
    api::{auth::extract_user_from_token, AppState},
    error::AppError,
};

const PRICE_CACHE_TTL_SECS: u64 = 10;
const PRICE_REDIS_PREFIX: &str = "price:latest";

#[derive(Clone)]
struct CachedPrice {
    fetched_at: Instant,
    price: f64,
    change_24h: f64,
}

static PRICE_CACHE: OnceLock<RwLock<HashMap<String, CachedPrice>>> = OnceLock::new();

#[derive(Debug, Serialize, Deserialize)]
struct CachedPricePayload {
    price: f64,
    change_24h: f64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct WsAuthQuery {
    token: Option<String>,
}

// Internal helper that supports `token_from_headers` operations.
fn token_from_headers(headers: &HeaderMap) -> Option<String> {
    let header_value = headers.get(AUTHORIZATION)?.to_str().ok()?;
    header_value
        .strip_prefix("Bearer ")
        .map(|token| token.to_string())
}

// Internal helper that supports `price_cache` operations.
fn price_cache() -> &'static RwLock<HashMap<String, CachedPrice>> {
    PRICE_CACHE.get_or_init(|| RwLock::new(HashMap::new()))
}

// Internal helper that supports `price_redis_key` operations.
fn price_redis_key(token: &str) -> String {
    format!("{PRICE_REDIS_PREFIX}:{token}")
}

// Internal helper that supports `cache_price_redis` operations.
async fn cache_price_redis(state: &AppState, token: &str, price: f64, change_24h: f64) {
    let payload = CachedPricePayload { price, change_24h };
    let Ok(json) = serde_json::to_string(&payload) else {
        return;
    };
    let mut conn = state.redis.clone();
    let _: std::result::Result<(), redis::RedisError> = conn
        .set_ex(price_redis_key(token), json, PRICE_CACHE_TTL_SECS)
        .await;
}

// Internal helper that supports `get_cached_price_redis` operations.
async fn get_cached_price_redis(state: &AppState, token: &str) -> Option<(f64, f64)> {
    let mut conn = state.redis.clone();
    let raw: Option<String> = conn.get(price_redis_key(token)).await.ok()?;
    raw.and_then(|value| serde_json::from_str::<CachedPricePayload>(&value).ok())
        .map(|payload| (payload.price, payload.change_24h))
}

// Internal helper that supports `get_cached_price` operations.
async fn get_cached_price(token: &str, ttl: Duration) -> Option<(f64, f64)> {
    let cache = price_cache();
    let guard = cache.read().await;
    guard.get(token).and_then(|entry| {
        if entry.fetched_at.elapsed() <= ttl {
            Some((entry.price, entry.change_24h))
        } else {
            None
        }
    })
}

// Internal helper that supports `get_cached_price_with_fallback` operations.
async fn get_cached_price_with_fallback(
    state: &AppState,
    token: &str,
    ttl: Duration,
) -> Option<(f64, f64)> {
    if let Some(cached) = get_cached_price(token, ttl).await {
        return Some(cached);
    }

    if let Some(cached) = get_cached_price_redis(state, token).await {
        store_cached_price_local(token, cached.0, cached.1).await;
        return Some(cached);
    }

    None
}

// Internal helper that supports `store_cached_price` operations.
async fn store_cached_price_local(token: &str, price: f64, change_24h: f64) {
    let cache = price_cache();
    let mut guard = cache.write().await;
    guard.insert(
        token.to_string(),
        CachedPrice {
            fetched_at: Instant::now(),
            price,
            change_24h,
        },
    );
}

// Internal helper that supports `store_cached_price` operations.
async fn store_cached_price(state: &AppState, token: &str, price: f64, change_24h: f64) {
    store_cached_price_local(token, price, change_24h).await;
    cache_price_redis(state, token, price, change_24h).await;
}

// Internal helper that supports `connected_payload` operations.
fn connected_payload() -> String {
    serde_json::json!({
        "type": "connected",
        "message": "Connected to price stream"
    })
    .to_string()
}

#[derive(Debug, Deserialize)]
struct SubscribeMessage {
    #[serde(rename = "type")]
    msg_type: String,
    tokens: Vec<String>,
}

#[derive(Debug, Serialize)]
struct PriceUpdate {
    #[serde(rename = "type")]
    msg_type: String,
    token: String,
    price: f64,
    change_24h: f64,
    timestamp: i64,
}

/// WebSocket handler for real-time price updates
pub async fn handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<WsAuthQuery>,
) -> Response {
    let token = token_from_headers(&headers).or(query.token);
    let token = match token {
        Some(token) => token,
        None => return AppError::AuthError("Missing WebSocket token".to_string()).into_response(),
    };

    let user_address = match extract_user_from_token(&token, &state.config.jwt_secret).await {
        Ok(address) => address,
        Err(err) => return err.into_response(),
    };

    let db = state.db.clone();
    let user_address_for_touch = user_address.clone();
    tokio::spawn(async move {
        match timeout(
            Duration::from_millis(2500),
            db.touch_user(&user_address_for_touch),
        )
        .await
        {
            Ok(Ok(())) => {}
            Ok(Err(err)) => {
                tracing::warn!(
                    "prices websocket touch_user failed for {}: {}",
                    user_address_for_touch,
                    err
                );
            }
            Err(_) => {
                tracing::warn!(
                    "prices websocket touch_user timed out for {}",
                    user_address_for_touch
                );
            }
        }
    });

    ws.on_upgrade(|socket| handle_socket(socket, state))
}

// Internal helper that supports `handle_socket` operations.
async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();

    // Track subscribed tokens
    let subscribed_tokens: Arc<RwLock<Vec<String>>> = Arc::new(RwLock::new(Vec::new()));
    let subscribed_clone = subscribed_tokens.clone();

    // FIX: Tambahkan .into() pada String sambutan
    let _ = sender.send(Message::Text(connected_payload().into())).await;

    // Spawn task to send price updates
    let state_clone = state.clone();
    let mut send_task = tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;

            let tokens = subscribed_clone.read().await.clone();

            for token in tokens {
                let (price, change_24h) = match latest_price_with_change(&state_clone, &token).await
                {
                    Ok(result) => result,
                    Err(_) => (fallback_price_for(&token), 0.0),
                };

                let update = PriceUpdate {
                    msg_type: "price_update".to_string(),
                    token: token.clone(),
                    price,
                    change_24h,
                    timestamp: chrono::Utc::now().timestamp(),
                };

                let json = serde_json::to_string(&update).unwrap_or_default();

                // FIX: Tambahkan .into() pada update harga
                if sender.send(Message::Text(json.into())).await.is_err() {
                    return;
                }
            }
        }
    });

    // Handle incoming messages
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Text(text) => {
                    // text di sini sudah bertipe Utf8Bytes, bisa langsung digunakan atau di-convert
                    if let Ok(subscribe) = serde_json::from_str::<SubscribeMessage>(&text) {
                        if subscribe.msg_type == "subscribe" {
                            let mut tokens = subscribed_tokens.write().await;
                            for token in subscribe.tokens {
                                if !tokens.contains(&token) {
                                    tokens.push(token);
                                }
                            }
                            tracing::info!("Subscribed to tokens: {:?}", tokens);
                        }
                    }
                }
                Message::Close(_) => {
                    tracing::info!("Price stream client disconnected");
                    break;
                }
                _ => {}
            }
        }
    });

    tokio::select! {
        _ = &mut send_task => {
            recv_task.abort();
        }
        _ = &mut recv_task => {
            send_task.abort();
        }
    }

    tracing::info!("Price WebSocket connection closed");
}

// Internal helper that supports `fallback_price_for` operations.
fn fallback_price_for(token: &str) -> f64 {
    match token.to_uppercase().as_str() {
        "USDT" | "USDC" | "CAREL" => 1.0,
        _ => 0.0,
    }
}

// Internal helper that supports `latest_price_with_change` operations.
async fn latest_price_with_change(
    state: &AppState,
    token: &str,
) -> crate::error::Result<(f64, f64)> {
    if let Some(cached) =
        get_cached_price_with_fallback(state, token, Duration::from_secs(PRICE_CACHE_TTL_SECS))
            .await
    {
        return Ok(cached);
    }

    let rows: Vec<f64> = sqlx::query_scalar(
        "SELECT close::FLOAT FROM price_history WHERE token = $1 AND interval = $2 ORDER BY timestamp DESC LIMIT 2",
    )
    .bind(token)
    .bind("1h")
    .fetch_all(state.db.pool())
    .await?;

    let mut prices = rows;
    if prices.is_empty() {
        prices = sqlx::query_scalar(
            "SELECT close::FLOAT FROM price_history WHERE token = $1 ORDER BY timestamp DESC LIMIT 2",
        )
        .bind(token)
        .fetch_all(state.db.pool())
        .await?;
    }

    let latest = prices
        .first()
        .copied()
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or_else(|| fallback_price_for(token));
    let prev = prices
        .get(1)
        .copied()
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(latest);
    let change = if prev > 0.0 {
        ((latest - prev) / prev) * 100.0
    } else {
        0.0
    };

    store_cached_price(state, token, latest, change).await;
    Ok((latest, change))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    // Internal helper that supports `connected_payload_contains_type` operations.
    fn connected_payload_contains_type() {
        // Memastikan payload koneksi berisi tipe connected
        let payload = connected_payload();
        assert!(payload.contains("\"type\":\"connected\""));
    }

    #[test]
    // Internal helper that supports `fallback_price_unknown_returns_zero` operations.
    fn fallback_price_unknown_returns_zero() {
        // Memastikan token tidak dikenal mengembalikan 0.0
        let price = fallback_price_for("UNKNOWN");
        assert!((price - 0.0).abs() < f64::EPSILON);
    }
}
