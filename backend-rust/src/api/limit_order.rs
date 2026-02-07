use axum::{
    extract::{State, Path},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    error::Result,
    models::{ApiResponse, LimitOrder, PaginatedResponse, CreateLimitOrderRequest},
    // 1. Import modul hash agar terpakai
    crypto::hash,
};

use super::AppState;

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

// Struct bantuan untuk menghitung total
#[derive(sqlx::FromRow)]
struct CountResult {
    count: i64,
}

/// POST /api/v1/limit-order/create
pub async fn create_order(
    State(state): State<AppState>,
    Json(req): Json<CreateLimitOrderRequest>,
) -> Result<Json<ApiResponse<CreateOrderResponse>>> {
    let user_address = "0x1234...";

    let amount: f64 = req.amount.parse()
        .map_err(|_| crate::error::AppError::BadRequest("Invalid amount".to_string()))?;
    
    let price: f64 = req.price.parse()
        .map_err(|_| crate::error::AppError::BadRequest("Invalid price".to_string()))?;

    let expiry_duration = match req.expiry.as_str() {
        "1d" => chrono::Duration::days(1),
        "7d" => chrono::Duration::days(7),
        "30d" => chrono::Duration::days(30),
        _ => chrono::Duration::days(7),
    };

    let now = chrono::Utc::now();
    let expiry = now + expiry_duration;

    // 2. GUNAKAN HASHER untuk membuat Order ID (Menghilangkan warning di hash.rs)
    let order_data = format!("{}{}{}{}{}", user_address, req.from_token, req.to_token, amount, now.timestamp());
    let order_id = format!("ORD_{}", hash::hash_string(&order_data));

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

    let response = CreateOrderResponse {
        order_id,
        status: "active".to_string(),
        created_at: order.created_at,
    };

    Ok(Json(ApiResponse::success(response)))
}

/// GET /api/v1/limit-order/list
pub async fn list_orders(
    State(state): State<AppState>,
    axum::extract::Query(query): axum::extract::Query<ListOrdersQuery>,
) -> Result<Json<ApiResponse<PaginatedResponse<LimitOrder>>>> {
    let user_address = "0x1234...";
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
        .bind(user_address)
        .bind(s)
        .bind(limit as i64)
        .bind(offset as i64)
        .fetch_all(state.db.pool())
        .await?
    } else {
        sqlx::query_as::<_, LimitOrder>(
            "SELECT * FROM limit_orders WHERE owner = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3"
        )
        .bind(user_address)
        .bind(limit as i64)
        .bind(offset as i64)
        .fetch_all(state.db.pool())
        .await?
    };

    // Hitung total dengan filter status juga jika ada
    let total_query = if let Some(s) = status_int {
        sqlx::query_as::<_, CountResult>("SELECT COUNT(*) as count FROM limit_orders WHERE owner = $1 AND status = $2")
            .bind(user_address).bind(s)
    } else {
        sqlx::query_as::<_, CountResult>("SELECT COUNT(*) as count FROM limit_orders WHERE owner = $1")
            .bind(user_address)
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
    Path(order_id): Path<String>,
) -> Result<Json<ApiResponse<String>>> {
    let order = state.db.get_limit_order(&order_id).await?
        .ok_or_else(|| crate::error::AppError::NotFound("Order not found".to_string()))?;

    if order.status == 2 {
        return Err(crate::error::AppError::BadRequest("Order already filled".to_string()));
    }

    state.db.update_order_status(&order_id, 3).await?;

    Ok(Json(ApiResponse::success("Order cancelled successfully".to_string())))
}
