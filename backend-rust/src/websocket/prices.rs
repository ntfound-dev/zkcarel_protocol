use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::api::AppState;

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
pub async fn handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

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

fn fallback_price_for(token: &str) -> f64 {
    match token.to_uppercase().as_str() {
        "USDT" | "USDC" | "CAREL" => 1.0,
        _ => 0.0,
    }
}

async fn latest_price_with_change(
    state: &AppState,
    token: &str,
) -> crate::error::Result<(f64, f64)> {
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
        .get(0)
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

    Ok((latest, change))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connected_payload_contains_type() {
        // Memastikan payload koneksi berisi tipe connected
        let payload = connected_payload();
        assert!(payload.contains("\"type\":\"connected\""));
    }

    #[test]
    fn fallback_price_unknown_returns_zero() {
        // Memastikan token tidak dikenal mengembalikan 0.0
        let price = fallback_price_for("UNKNOWN");
        assert!((price - 0.0).abs() < f64::EPSILON);
    }
}
