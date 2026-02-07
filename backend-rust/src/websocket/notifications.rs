use axum::{
    extract::{ws::{WebSocket, WebSocketUpgrade, Message}, State},
    response::Response,
};
use futures_util::{StreamExt, SinkExt};

use crate::api::AppState;

/// WebSocket handler for real-time notifications
pub async fn handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> Response {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();

    // TODO: Extract user from initial message
    let user_address = "0x1234..."; // Placeholder

    // Subscribe to notifications
    let notification_service = crate::services::NotificationService::new(
        state.db.clone(),
        state.config.clone(),
    );

    let mut rx = notification_service.register_connection(user_address.to_string()).await;

    // FIX: Tambahkan .into() untuk mengubah String menjadi Utf8Bytes
    let _ = sender.send(Message::Text(
        serde_json::json!({
            "type": "connected",
            "message": "Connected to notification stream"
        }).to_string().into()
    )).await;

    // Spawn task to forward notifications
    let mut send_task = tokio::spawn(async move {
        while let Ok(notification) = rx.recv().await {
            let json = serde_json::to_string(&notification).unwrap_or_default();
            
            // FIX: Tambahkan .into() di sini juga
            if sender.send(Message::Text(json.into())).await.is_err() {
                break;
            }
        }
    });

    // Handle incoming messages (ping/pong)
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Text(text) => {
                    tracing::debug!("Received: {}", text);
                }
                Message::Close(_) => {
                    tracing::info!("Client disconnected");
                    break;
                }
                Message::Ping(_) => {
                    tracing::debug!("Ping received");
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

    // Cleanup
    notification_service.unregister_connection(user_address).await;
    tracing::info!("WebSocket connection closed for user: {}", user_address);
}
