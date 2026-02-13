use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::{header::AUTHORIZATION, HeaderMap},
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;

use crate::{
    api::{auth::extract_user_from_token, AppState},
    error::AppError,
};

#[derive(Debug, serde::Deserialize)]
pub(crate) struct WsAuthQuery {
    token: Option<String>,
}

fn token_from_headers(headers: &HeaderMap) -> Option<String> {
    let header_value = headers.get(AUTHORIZATION)?.to_str().ok()?;
    header_value
        .strip_prefix("Bearer ")
        .map(|token| token.to_string())
}

#[derive(Debug, Serialize)]
struct OrderUpdate {
    #[serde(rename = "type")]
    msg_type: String,
    order_id: String,
    status: String,
    filled: String,
    timestamp: i64,
}

fn connected_payload() -> String {
    serde_json::json!({
        "type": "connected",
        "message": "Connected to order updates stream"
    })
    .to_string()
}

fn status_label(status: i16) -> &'static str {
    match status {
        0 => "active",
        1 => "partially_filled",
        2 => "filled",
        3 => "cancelled",
        4 => "expired",
        _ => "unknown",
    }
}

/// WebSocket handler for limit order updates
/// GET /ws/orders
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

    if let Err(err) = state.db.create_user(&user_address).await {
        return err.into_response();
    }
    if let Err(err) = state.db.update_last_active(&user_address).await {
        return err.into_response();
    }

    ws.on_upgrade(|socket| handle_socket(socket, state, user_address))
}

async fn handle_socket(socket: WebSocket, state: AppState, user_address: String) {
    let (mut sender, mut receiver) = socket.split();

    // Perbaikan: Tambahkan .into() untuk menyambut koneksi
    let _ = sender.send(Message::Text(connected_payload().into())).await;

    // Spawn task to send order updates
    let state_clone = state.clone();
    let owner_address = user_address.clone();
    let mut send_task = tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;

            // Get user's active orders
            let orders = match state_clone
                .db
                .get_active_orders_for_owner(&owner_address)
                .await
            {
                Ok(orders) => orders,
                Err(_) => continue,
            };

            // Send updates for each order
            for order in orders {
                let update = OrderUpdate {
                    msg_type: "order_update".to_string(),
                    order_id: order.order_id,
                    status: status_label(order.status).to_string(),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_label_maps_known_values() {
        // Memastikan status order terjemah sesuai kode
        assert_eq!(status_label(2), "filled");
        assert_eq!(status_label(9), "unknown");
    }
}
