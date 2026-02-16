use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::{header::AUTHORIZATION, HeaderMap},
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::time::{interval, timeout, Duration};

use crate::{
    api::{auth::extract_user_from_token, AppState},
    constants::{WS_CLIENT_TIMEOUT_SECS, WS_HEARTBEAT_INTERVAL_SECS},
    error::AppError,
};

#[derive(Debug, Deserialize)]
pub(crate) struct WsAuthQuery {
    token: Option<String>,
}

fn token_from_headers(headers: &HeaderMap) -> Option<String> {
    let header_value = headers.get(AUTHORIZATION)?.to_str().ok()?;
    header_value
        .strip_prefix("Bearer ")
        .map(|token| token.to_string())
}

fn connected_payload() -> String {
    serde_json::json!({
        "type": "connected",
        "message": "Connected to notification stream"
    })
    .to_string()
}

/// WebSocket handler for real-time notifications
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

    match timeout(
        Duration::from_millis(1200),
        state.db.touch_user(&user_address),
    )
    .await
    {
        Ok(Ok(())) => {}
        Ok(Err(err)) => {
            tracing::warn!(
                "notifications websocket touch_user failed for {}: {}",
                user_address,
                err
            );
        }
        Err(_) => {
            tracing::warn!(
                "notifications websocket touch_user timed out for {}",
                user_address
            );
        }
    }

    ws.on_upgrade(|socket| handle_socket(socket, state, user_address))
}

async fn handle_socket(socket: WebSocket, state: AppState, user_address: String) {
    let (mut sender, mut receiver) = socket.split();

    // Subscribe to notifications
    let notification_service =
        crate::services::NotificationService::new(state.db.clone(), state.config.clone());

    let mut rx = notification_service
        .register_connection(user_address.to_string())
        .await;

    // FIX: Tambahkan .into() untuk mengubah String menjadi Utf8Bytes
    let _ = sender.send(Message::Text(connected_payload().into())).await;

    // Spawn task to forward notifications
    let mut send_task = tokio::spawn(async move {
        let mut heartbeat = interval(Duration::from_secs(WS_HEARTBEAT_INTERVAL_SECS));

        loop {
            tokio::select! {
                _ = heartbeat.tick() => {
                    if sender.send(Message::Ping(Vec::new().into())).await.is_err() {
                        break;
                    }
                }
                result = rx.recv() => {
                    match result {
                        Ok(notification) => {
                            let json = serde_json::to_string(&notification).unwrap_or_default();
                            if sender.send(Message::Text(json.into())).await.is_err() {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
            }
        }
    });

    // Handle incoming messages (ping/pong)
    let mut recv_task = tokio::spawn(async move {
        loop {
            let next_msg =
                timeout(Duration::from_secs(WS_CLIENT_TIMEOUT_SECS), receiver.next()).await;
            let msg = match next_msg {
                Ok(Some(Ok(msg))) => msg,
                Ok(Some(Err(_))) | Ok(None) => break,
                Err(_) => {
                    tracing::info!("WebSocket client timeout");
                    break;
                }
            };

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
    notification_service
        .unregister_connection(&user_address)
        .await;
    tracing::info!("WebSocket connection closed for user: {}", user_address);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connected_payload_has_type() {
        // Memastikan payload memiliki tipe connected
        let payload = connected_payload();
        assert!(payload.contains("\"type\":\"connected\""));
    }
}
