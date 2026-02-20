use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Json,
};
use serde::Deserialize;
use serde_json::Value;

use super::{require_user, AppState};
use crate::{error::Result, integrations::bridge::GardenClient, models::ApiResponse};

#[derive(Debug, Deserialize)]
pub struct GardenStatsQuery {
    pub source_chain: Option<String>,
    pub destination_chain: Option<String>,
    pub address: Option<String>,
    pub from: Option<i64>,
    pub to: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct GardenAssetFilterQuery {
    pub from: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct GardenOrdersQuery {
    pub address: Option<String>,
    pub tx_hash: Option<String>,
    pub from_chain: Option<String>,
    pub to_chain: Option<String>,
    pub from_owner: Option<String>,
    pub to_owner: Option<String>,
    pub solver_id: Option<String>,
    pub integrator: Option<String>,
    pub page: Option<u32>,
    pub per_page: Option<u32>,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct GardenOrderPath {
    pub order_id: String,
}

#[derive(Debug, Deserialize)]
pub struct GardenSchemaPath {
    pub name: String,
}

// Internal helper that supports `garden_client` operations.
fn garden_client(state: &AppState) -> GardenClient {
    GardenClient::new(
        state.config.garden_api_key.clone().unwrap_or_default(),
        state.config.garden_api_url.clone(),
    )
}

/// GET /api/v1/garden/volume
pub async fn get_total_volume(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<GardenStatsQuery>,
) -> Result<Json<ApiResponse<Value>>> {
    let _ = require_user(&headers, &state).await?;
    let payload = garden_client(&state)
        .get_total_volume(
            query.source_chain.as_deref(),
            query.destination_chain.as_deref(),
            query.address.as_deref(),
            query.from,
            query.to,
        )
        .await?;
    Ok(Json(ApiResponse::success(payload)))
}

/// GET /api/v1/garden/fees
pub async fn get_total_fees(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<GardenStatsQuery>,
) -> Result<Json<ApiResponse<Value>>> {
    let _ = require_user(&headers, &state).await?;
    let payload = garden_client(&state)
        .get_total_fees(
            query.source_chain.as_deref(),
            query.destination_chain.as_deref(),
            query.address.as_deref(),
            query.from,
            query.to,
        )
        .await?;
    Ok(Json(ApiResponse::success(payload)))
}

/// GET /api/v1/garden/chains
pub async fn get_supported_chains(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<GardenAssetFilterQuery>,
) -> Result<Json<ApiResponse<Value>>> {
    let _ = require_user(&headers, &state).await?;
    let payload = garden_client(&state)
        .get_supported_chains(query.from.as_deref())
        .await?;
    Ok(Json(ApiResponse::success(payload)))
}

/// GET /api/v1/garden/assets
pub async fn get_supported_assets(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<GardenAssetFilterQuery>,
) -> Result<Json<ApiResponse<Value>>> {
    let _ = require_user(&headers, &state).await?;
    let payload = garden_client(&state)
        .get_supported_assets(query.from.as_deref())
        .await?;
    Ok(Json(ApiResponse::success(payload)))
}

/// GET /api/v1/garden/liquidity
pub async fn get_available_liquidity(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>> {
    let _ = require_user(&headers, &state).await?;
    let payload = garden_client(&state).get_available_liquidity().await?;
    Ok(Json(ApiResponse::success(payload)))
}

/// GET /api/v1/garden/orders
pub async fn get_orders(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<GardenOrdersQuery>,
) -> Result<Json<ApiResponse<Value>>> {
    let _ = require_user(&headers, &state).await?;
    let payload = garden_client(&state)
        .get_orders(
            query.address.as_deref(),
            query.tx_hash.as_deref(),
            query.from_chain.as_deref(),
            query.to_chain.as_deref(),
            query.from_owner.as_deref(),
            query.to_owner.as_deref(),
            query.solver_id.as_deref(),
            query.integrator.as_deref(),
            query.page,
            query.per_page,
            query.status.as_deref(),
        )
        .await?;
    Ok(Json(ApiResponse::success(payload)))
}

/// GET /api/v1/garden/orders/{order_id}
pub async fn get_order_by_id(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(path): Path<GardenOrderPath>,
) -> Result<Json<ApiResponse<Value>>> {
    let _ = require_user(&headers, &state).await?;
    let payload = garden_client(&state)
        .get_order_by_id(&path.order_id)
        .await?;
    Ok(Json(ApiResponse::success(payload)))
}

/// GET /api/v1/garden/orders/{order_id}/instant-refund-hash
pub async fn get_order_instant_refund_hash(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(path): Path<GardenOrderPath>,
) -> Result<Json<ApiResponse<Value>>> {
    let _ = require_user(&headers, &state).await?;
    let payload = garden_client(&state)
        .get_order_instant_refund_hash(&path.order_id)
        .await?;
    Ok(Json(ApiResponse::success(payload)))
}

/// GET /api/v1/garden/schemas/{name}
pub async fn get_schema(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(path): Path<GardenSchemaPath>,
) -> Result<Json<ApiResponse<Value>>> {
    let _ = require_user(&headers, &state).await?;
    let payload = garden_client(&state).get_schema(&path.name).await?;
    Ok(Json(ApiResponse::success(payload)))
}

/// GET /api/v1/garden/apps/earnings
pub async fn get_app_earnings(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Value>>> {
    let _ = require_user(&headers, &state).await?;
    let payload = garden_client(&state).get_app_earnings().await?;
    Ok(Json(ApiResponse::success(payload)))
}
