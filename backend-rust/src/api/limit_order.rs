use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::services::notification_service::{NotificationService, NotificationType};
use crate::{
    // 1. Import modul hash agar terpakai
    crypto::hash,
    error::Result,
    models::{ApiResponse, CreateLimitOrderRequest, LimitOrder, PaginatedResponse},
    services::nft_discount::consume_nft_usage_if_active,
};

use super::{require_starknet_user, AppState};

#[derive(Debug, Serialize)]
pub struct CreateOrderResponse {
    pub order_id: String,
    pub status: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct ListOrdersQuery {
    pub status: Option<String>,
    pub page: Option<i32>,
    pub limit: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct CancelOrderRequest {
    pub onchain_tx_hash: Option<String>,
}

fn expiry_duration_for(expiry: &str) -> chrono::Duration {
    match expiry {
        "1d" => chrono::Duration::days(1),
        "7d" => chrono::Duration::days(7),
        "30d" => chrono::Duration::days(30),
        _ => chrono::Duration::days(7),
    }
}

fn build_order_id(
    user_address: &str,
    from_token: &str,
    to_token: &str,
    amount: f64,
    now_ts: i64,
) -> String {
    let order_data = format!(
        "{}{}{}{}{}",
        user_address, from_token, to_token, amount, now_ts
    );
    // Keep length <= 66 to fit DB (varchar(66))
    hash::hash_string(&order_data)
}

fn normalize_onchain_tx_hash(
    tx_hash: Option<&str>,
) -> std::result::Result<Option<String>, crate::error::AppError> {
    let Some(raw) = tx_hash.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if !raw.starts_with("0x") {
        return Err(crate::error::AppError::BadRequest(
            "onchain_tx_hash must start with 0x".to_string(),
        ));
    }
    if raw.len() > 66 {
        return Err(crate::error::AppError::BadRequest(
            "onchain_tx_hash exceeds maximum length (66)".to_string(),
        ));
    }
    if !raw[2..].chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(crate::error::AppError::BadRequest(
            "onchain_tx_hash must be hex-encoded".to_string(),
        ));
    }
    Ok(Some(raw.to_ascii_lowercase()))
}

fn normalize_order_id(
    raw: Option<&str>,
) -> std::result::Result<Option<String>, crate::error::AppError> {
    let Some(value) = raw.map(str::trim).filter(|item| !item.is_empty()) else {
        return Ok(None);
    };
    if !value.starts_with("0x") {
        return Err(crate::error::AppError::BadRequest(
            "client_order_id must start with 0x".to_string(),
        ));
    }
    if value.len() > 66 {
        return Err(crate::error::AppError::BadRequest(
            "client_order_id exceeds maximum length (66)".to_string(),
        ));
    }
    if !value[2..].chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(crate::error::AppError::BadRequest(
            "client_order_id must be hex-encoded".to_string(),
        ));
    }
    Ok(Some(value.to_ascii_lowercase()))
}

// Struct bantuan untuk menghitung total
#[derive(sqlx::FromRow)]
struct CountResult {
    count: i64,
}

/// POST /api/v1/limit-order/create
pub async fn create_order(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateLimitOrderRequest>,
) -> Result<Json<ApiResponse<CreateOrderResponse>>> {
    let user_address = require_starknet_user(&headers, &state).await?;

    let amount: f64 = req
        .amount
        .parse()
        .map_err(|_| crate::error::AppError::BadRequest("Invalid amount".to_string()))?;

    let price: f64 = req
        .price
        .parse()
        .map_err(|_| crate::error::AppError::BadRequest("Invalid price".to_string()))?;

    if amount <= 0.0 || price <= 0.0 {
        return Err(crate::error::AppError::BadRequest(
            "Amount and price must be greater than 0".to_string(),
        ));
    }

    let onchain_tx_hash = normalize_onchain_tx_hash(req.onchain_tx_hash.as_deref())?;
    let tx_hash = onchain_tx_hash.ok_or_else(|| {
        crate::error::AppError::BadRequest(
            "Create order requires onchain_tx_hash from user-signed Starknet transaction"
                .to_string(),
        )
    })?;

    let expiry_duration = expiry_duration_for(&req.expiry);

    let now = chrono::Utc::now();
    let expiry = now + expiry_duration;

    // 2. GUNAKAN HASHER untuk membuat Order ID (Menghilangkan warning di hash.rs)
    let order_id = normalize_order_id(req.client_order_id.as_deref())?.unwrap_or_else(|| {
        build_order_id(
            &user_address,
            &req.from_token,
            &req.to_token,
            amount,
            now.timestamp(),
        )
    });

    let order = LimitOrder {
        order_id: order_id.clone(),
        owner: user_address.to_string(),
        from_token: req.from_token,
        to_token: req.to_token,
        amount: rust_decimal::Decimal::from_f64_retain(amount).unwrap(),
        filled: rust_decimal::Decimal::ZERO,
        price: rust_decimal::Decimal::from_f64_retain(price).unwrap(),
        expiry,
        recipient: req.recipient,
        status: 0,
        created_at: now,
    };

    state.db.create_limit_order(&order).await?;
    if let Err(err) =
        consume_nft_usage_if_active(&state.config, &user_address, "limit_order_create").await
    {
        tracing::warn!(
            "Failed to consume NFT discount usage after limit order create: user={} order_id={} err={}",
            user_address,
            order_id,
            err
        );
    }
    let notification_service = NotificationService::new(state.db.clone(), state.config.clone());
    let _ = notification_service
        .send_notification(
            &user_address,
            NotificationType::System,
            "Limit order submitted".to_string(),
            "Order submitted on-chain and queued for execution.".to_string(),
            Some(serde_json::json!({
                "source": "limit_order.create",
                "order_id": order_id,
                "onchain_tx_hash": tx_hash,
            })),
        )
        .await;

    let response = CreateOrderResponse {
        order_id,
        status: "submitted_onchain".to_string(),
        created_at: order.created_at,
    };

    Ok(Json(ApiResponse::success(response)))
}

/// GET /api/v1/limit-order/list
pub async fn list_orders(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(query): axum::extract::Query<ListOrdersQuery>,
) -> Result<Json<ApiResponse<PaginatedResponse<LimitOrder>>>> {
    let user_address = require_starknet_user(&headers, &state).await?;
    let page = query.page.unwrap_or(1);
    let limit = query.limit.unwrap_or(10);
    let offset = (page - 1) * limit;

    // Logika penggunaan status agar tidak dead code
    let status_int = query.status.as_ref().map(|s| match s.as_str() {
        "active" => 0,
        "filled" => 2,
        "cancelled" => 3,
        _ => 0,
    });

    // Menggunakan query dinamis sederhana
    let orders = if let Some(s) = status_int {
        sqlx::query_as::<_, LimitOrder>(
            "SELECT * FROM limit_orders WHERE owner = $1 AND status = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4"
        )
        .bind(&user_address)
        .bind(s)
        .bind(limit as i64)
        .bind(offset as i64)
        .fetch_all(state.db.pool())
        .await?
    } else {
        sqlx::query_as::<_, LimitOrder>(
            "SELECT * FROM limit_orders WHERE owner = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3"
        )
        .bind(&user_address)
        .bind(limit as i64)
        .bind(offset as i64)
        .fetch_all(state.db.pool())
        .await?
    };

    // Hitung total dengan filter status juga jika ada
    let total_query = if let Some(s) = status_int {
        sqlx::query_as::<_, CountResult>(
            "SELECT COUNT(*) as count FROM limit_orders WHERE owner = $1 AND status = $2",
        )
        .bind(&user_address)
        .bind(s)
    } else {
        sqlx::query_as::<_, CountResult>(
            "SELECT COUNT(*) as count FROM limit_orders WHERE owner = $1",
        )
        .bind(&user_address)
    };

    let total_res = total_query.fetch_one(state.db.pool()).await?;

    let response = PaginatedResponse {
        items: orders,
        page,
        limit,
        total: total_res.count,
    };

    Ok(Json(ApiResponse::success(response)))
}

/// DELETE /api/v1/limit-order/:order_id
pub async fn cancel_order(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(order_id): Path<String>,
    Json(req): Json<CancelOrderRequest>,
) -> Result<Json<ApiResponse<String>>> {
    let user_address = require_starknet_user(&headers, &state).await?;
    let onchain_tx_hash = normalize_onchain_tx_hash(req.onchain_tx_hash.as_deref())?;
    let tx_hash = onchain_tx_hash.ok_or_else(|| {
        crate::error::AppError::BadRequest(
            "Cancel order requires onchain_tx_hash from user-signed Starknet transaction"
                .to_string(),
        )
    })?;
    let order = state
        .db
        .get_limit_order(&order_id)
        .await?
        .ok_or(crate::error::AppError::OrderNotFound)?;

    if order.owner != user_address {
        return Err(crate::error::AppError::AuthError(
            "Not allowed to cancel this order".to_string(),
        ));
    }

    if order.status == 2 {
        return Err(crate::error::AppError::BadRequest(
            "Order already filled".to_string(),
        ));
    }

    state.db.update_order_status(&order_id, 3).await?;
    tracing::info!(
        "Limit order cancelled: user={}, order_id={}, onchain_tx_hash={}",
        user_address,
        order_id,
        tx_hash
    );

    Ok(Json(ApiResponse::success(
        "Order cancelled successfully".to_string(),
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expiry_duration_for_defaults_to_7d() {
        // Memastikan input tidak dikenal memakai 7 hari
        let duration = expiry_duration_for("unknown");
        assert_eq!(duration.num_days(), 7);
    }

    #[test]
    fn build_order_id_is_stable() {
        // Memastikan order_id konsisten untuk input yang sama
        let id = build_order_id("0xabc", "ETH", "USDT", 10.0, 1_700_000_000);
        let order_data = format!("{}{}{}{}{}", "0xabc", "ETH", "USDT", 10.0, 1_700_000_000);
        let expected = hash::hash_string(&order_data);
        assert_eq!(id, expected);
    }
}
