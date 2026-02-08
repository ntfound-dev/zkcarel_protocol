use axum::{
    extract::{ws::{WebSocket, WebSocketUpgrade, Message}, State},
    response::Response,
};
use futures_util::{StreamExt, SinkExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::api::AppState;

fn connected_payload() -> String {
    serde_json::json!({
        "type": "connected",
        "message": "Connected to price stream"
    }).to_string()
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
) -> Response {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, _state: AppState) {
    let (mut sender, mut receiver) = socket.split();

    // Track subscribed tokens
    let subscribed_tokens: Arc<RwLock<Vec<String>>> = Arc::new(RwLock::new(Vec::new()));
    let subscribed_clone = subscribed_tokens.clone();

    // FIX: Tambahkan .into() pada String sambutan
    let _ = sender.send(Message::Text(connected_payload().into())).await;

    // Spawn task to send price updates
    let mut send_task = tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;

            let tokens = subscribed_clone.read().await.clone();
            
            for token in tokens {
                let price = get_mock_price(&token);
                
                let update = PriceUpdate {
                    msg_type: "price_update".to_string(),
                    token: token.clone(),
                    price,
                    change_24h: (rand::random::<f64>() - 0.5) * 10.0,
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

fn get_mock_price(token: &str) -> f64 {
    match token {
        "BTC" => 65000.0 + (rand::random::<f64>() - 0.5) * 1000.0,
        "ETH" => 3500.0 + (rand::random::<f64>() - 0.5) * 100.0,
        "STRK" => 2.5 + (rand::random::<f64>() - 0.5) * 0.1,
        "CAREL" => 0.5 + (rand::random::<f64>() - 0.5) * 0.05,
        _ => 1.0,
    }
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
    fn get_mock_price_unknown_returns_one() {
        // Memastikan token tidak dikenal mengembalikan 1.0
        let price = get_mock_price("UNKNOWN");
        assert!((price - 1.0).abs() < f64::EPSILON);
    }
}
