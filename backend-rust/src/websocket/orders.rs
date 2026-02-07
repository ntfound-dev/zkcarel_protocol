use axum::{
    extract::{ws::{WebSocket, WebSocketUpgrade, Message}, State},
    response::Response,
};
use futures_util::{StreamExt, SinkExt};
use serde::Serialize;

use crate::api::AppState;

#[derive(Debug, Serialize)]
struct OrderUpdate {
    #[serde(rename = "type")]
    msg_type: String,
    order_id: String,
    status: String,
    filled: String,
    timestamp: i64,
}

/// WebSocket handler for limit order updates
/// GET /ws/orders
pub async fn handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> Response {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();

    // TODO: Extract user from initial message
    let _user_address = "0x1234...";

    // Perbaikan: Tambahkan .into() untuk menyambut koneksi
    let _ = sender.send(Message::Text(
        serde_json::json!({
            "type": "connected",
            "message": "Connected to order updates stream"
        }).to_string().into()
    )).await;

    // Spawn task to send order updates
    let state_clone = state.clone();
    let mut send_task = tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;

            // Get user's active orders
            let orders = match state_clone.db.get_active_orders().await {
                Ok(orders) => orders,
                Err(_) => continue,
            };

            // Send updates for each order
            for order in orders {
                let update = OrderUpdate {
                    msg_type: "order_update".to_string(),
                    order_id: order.order_id,
                    status: match order.status {
                        0 => "active",
                        1 => "partially_filled",
                        2 => "filled",
                        3 => "cancelled",
                        4 => "expired",
                        _ => "unknown",
                    }.to_string(),
                    filled: order.filled.to_string(),
                    timestamp: chrono::Utc::now().timestamp(),
                };

                let json = serde_json::to_string(&update).unwrap_or_default();
                
                // Perbaikan: Tambahkan .into() di sini juga
                if sender.send(Message::Text(json.into())).await.is_err() {
                    return;
                }
            }
        }
    });

    // Handle incoming messages (ping/pong)
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Close(_) => {
                    tracing::info!("Order stream client disconnected");
                    break;
                }
                Message::Ping(_) => {
                    // Auto-responded by axum
                }
                _ => {}
            }
        }
    });

    // Wait for either task to finish
    tokio::select! {
        _ = &mut send_task => {
            recv_task.abort();
        }
        _ = &mut recv_task => {
            send_task.abort();
        }
    }

    tracing::info!("Order WebSocket connection closed");
}
