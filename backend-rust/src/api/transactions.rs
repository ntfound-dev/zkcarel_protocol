use axum::{
    extract::{State, Path},
    Json,
    response::IntoResponse,
    http::{header, StatusCode},
};
use serde::Deserialize;
use chrono::{DateTime, Utc};

use crate::{
    error::Result,
    models::{ApiResponse, Transaction, PaginatedResponse},
    services::TransactionHistoryService,
};

use super::AppState;

#[derive(Debug, Deserialize)]
pub struct HistoryQuery {
    pub tx_type: Option<String>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub page: Option<i32>,
    pub limit: Option<i32>,
}

// Helper function agar logika parsing tanggal tidak berulang (DRY)
fn parse_dates(query: &HistoryQuery) -> (Option<DateTime<Utc>>, Option<DateTime<Utc>>) {
    let from = query.from_date.as_ref().and_then(|d| {
        DateTime::parse_from_rfc3339(d).ok().map(|dt| dt.with_timezone(&Utc))
    });
    let to = query.to_date.as_ref().and_then(|d| {
        DateTime::parse_from_rfc3339(d).ok().map(|dt| dt.with_timezone(&Utc))
    });
    (from, to)
}

/// GET /api/v1/transactions/history
pub async fn get_history(
    State(state): State<AppState>,
    axum::extract::Query(query): axum::extract::Query<HistoryQuery>,
) -> Result<Json<ApiResponse<PaginatedResponse<Transaction>>>> {
    let user_address = "0x1234...";

    let (from_date, to_date) = parse_dates(&query);
    let page = query.page.unwrap_or(1);
    let limit = query.limit.unwrap_or(20);

    let service = TransactionHistoryService::new(state.db);
    let history = service.get_user_history(
        user_address,
        query.tx_type,
        from_date,
        to_date,
        page,
        limit,
    ).await?;

    Ok(Json(ApiResponse::success(history)))
}

/// GET /api/v1/transactions/:tx_hash
pub async fn get_details(
    State(state): State<AppState>,
    Path(tx_hash): Path<String>,
) -> Result<Json<ApiResponse<Transaction>>> {
    let service = TransactionHistoryService::new(state.db);
    let tx = service.get_transaction_details(&tx_hash).await?;

    Ok(Json(ApiResponse::success(tx)))
}

/// POST /api/v1/transactions/export
pub async fn export_csv(
    State(state): State<AppState>,
    Json(query): Json<HistoryQuery>,
) -> Result<impl IntoResponse> {
    let user_address = "0x1234...";

    // Menggunakan helper parse_dates
    let (from_date, to_date) = parse_dates(&query);
    
    // Field 'tx_type', 'page', dan 'limit' mungkin tidak dipakai di export_csv
    // Kita panggil di tracing agar tidak kena warning 'unused' di masa depan
    tracing::debug!("Exporting CSV for type: {:?}, page: {:?}, limit: {:?}", 
        query.tx_type, query.page, query.limit);

    let service = TransactionHistoryService::new(state.db);
    let csv = service.export_to_csv(user_address, from_date, to_date).await?;

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "text/csv"),
            (header::CONTENT_DISPOSITION, "attachment; filename=\"transactions.csv\""),
        ],
        csv,
    ))
}
