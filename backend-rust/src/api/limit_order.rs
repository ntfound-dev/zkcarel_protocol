use axum::{
    extract::{State, Path},
    http::HeaderMap,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    error::Result,
    models::{ApiResponse, LimitOrder, PaginatedResponse, CreateLimitOrderRequest},
    constants::POINTS_PER_USD_SWAP,
    // 1. Import modul hash agar terpakai
    crypto::hash,
};
use crate::services::notification_service::{NotificationService, NotificationType};
use crate::services::onchain::{OnchainInvoker, parse_felt};
use rust_decimal::prelude::ToPrimitive;
use starknet_core::types::Call;
use starknet_core::utils::get_selector_from_name;

use super::{AppState, require_user};

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
    let order_data = format!("{}{}{}{}{}", user_address, from_token, to_token, amount, now_ts);
    // Keep length <= 66 to fit DB (varchar(66))
    hash::hash_string(&order_data)
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
    let user_address = require_user(&headers, &state).await?;

    let amount: f64 = req.amount.parse()
        .map_err(|_| crate::error::AppError::BadRequest("Invalid amount".to_string()))?;
    
    let price: f64 = req.price.parse()
        .map_err(|_| crate::error::AppError::BadRequest("Invalid price".to_string()))?;

    let expiry_duration = expiry_duration_for(&req.expiry);

    let now = chrono::Utc::now();
    let expiry = now + expiry_duration;

    // 2. GUNAKAN HASHER untuk membuat Order ID (Menghilangkan warning di hash.rs)
    let order_id = build_order_id(
        &user_address,
        &req.from_token,
        &req.to_token,
        amount,
        now.timestamp(),
    );

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
    let points = award_limit_order_points(&state, &user_address, amount, price).await?;
    let notification_service = NotificationService::new(state.db.clone(), state.config.clone());
    let _ = notification_service
        .send_notification(
            &user_address,
            NotificationType::PointsAwarded,
            "Limit order points awarded".to_string(),
            format!("You earned {:.2} points for creating a limit order.", points),
            Some(serde_json::json!({
                "source": "limit_order.create",
                "points": points,
                "order_id": order_id,
            })),
        )
        .await;

    let response = CreateOrderResponse {
        order_id,
        status: "active".to_string(),
        created_at: order.created_at,
    };

    Ok(Json(ApiResponse::success(response)))
}

async fn award_limit_order_points(
    state: &AppState,
    user_address: &str,
    amount: f64,
    price: f64,
) -> Result<f64> {
    let epoch = (chrono::Utc::now().timestamp() / crate::constants::EPOCH_DURATION_SECONDS) as i64;
    let usd_value = amount * price;
    let points = usd_value * POINTS_PER_USD_SWAP;
    let points_decimal = rust_decimal::Decimal::from_f64_retain(points)
        .unwrap_or(rust_decimal::Decimal::ZERO);

    state.db.create_or_update_points(
        user_address,
        epoch,
        points_decimal,
        rust_decimal::Decimal::ZERO,
        rust_decimal::Decimal::ZERO,
    ).await?;

    sync_points_onchain(state, epoch as u64, user_address, points_decimal).await?;
    tracing::info!(
        "Limit order points awarded: user={} epoch={} points={}",
        user_address,
        epoch,
        points
    );
    Ok(points)
}

async fn sync_points_onchain(
    state: &AppState,
    epoch: u64,
    user_address: &str,
    points: rust_decimal::Decimal,
) -> Result<()> {
    let contract = state.config.point_storage_address.trim();
    if contract.is_empty() || contract.starts_with("0x0000") {
        return Ok(());
    }

    let Some(invoker) = OnchainInvoker::from_config(&state.config).ok().flatten() else {
        return Ok(());
    };

    let points_u128 = points.trunc().to_u128().unwrap_or(0);
    if points_u128 == 0 {
        return Ok(());
    }

    let call = build_add_points_call(contract, epoch, user_address, points_u128)?;
    let _ = invoker.invoke(call).await?;
    Ok(())
}

fn build_add_points_call(
    contract: &str,
    epoch: u64,
    user: &str,
    points: u128,
) -> Result<Call> {
    let to = parse_felt(contract)?;
    let selector = get_selector_from_name("add_points")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    let user_felt = parse_felt(user)?;

    let calldata = vec![
        starknet_core::types::Felt::from(epoch),
        user_felt,
        // u256 low/high
        starknet_core::types::Felt::from(points),
        starknet_core::types::Felt::from(0_u128),
    ];

    Ok(Call { to, selector, calldata })
}

/// GET /api/v1/limit-order/list
pub async fn list_orders(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(query): axum::extract::Query<ListOrdersQuery>,
) -> Result<Json<ApiResponse<PaginatedResponse<LimitOrder>>>> {
    let user_address = require_user(&headers, &state).await?;
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
        sqlx::query_as::<_, CountResult>("SELECT COUNT(*) as count FROM limit_orders WHERE owner = $1 AND status = $2")
            .bind(&user_address).bind(s)
    } else {
        sqlx::query_as::<_, CountResult>("SELECT COUNT(*) as count FROM limit_orders WHERE owner = $1")
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
) -> Result<Json<ApiResponse<String>>> {
    let user_address = require_user(&headers, &state).await?;
    let order = state.db.get_limit_order(&order_id).await?
        .ok_or(crate::error::AppError::OrderNotFound)?;

    if order.owner != user_address {
        return Err(crate::error::AppError::AuthError("Not allowed to cancel this order".to_string()));
    }

    if order.status == 2 {
        return Err(crate::error::AppError::BadRequest("Order already filled".to_string()));
    }

    state.db.update_order_status(&order_id, 3).await?;

    Ok(Json(ApiResponse::success("Order cancelled successfully".to_string())))
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
