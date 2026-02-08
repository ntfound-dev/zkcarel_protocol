use axum::{
    extract::{State, Path},
    Json,
    response::IntoResponse,
    http::{header, HeaderMap, StatusCode},
};
use serde::Deserialize;
use chrono::{DateTime, Utc};

use crate::{
    error::Result,
    models::{ApiResponse, Transaction, PaginatedResponse},
    services::TransactionHistoryService,
    utils::ensure_page_limit,
};

use super::{AppState, require_user};

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
    headers: HeaderMap,
    axum::extract::Query(query): axum::extract::Query<HistoryQuery>,
) -> Result<Json<ApiResponse<PaginatedResponse<Transaction>>>> {
    let user_address = require_user(&headers, &state).await?;

    let (from_date, to_date) = parse_dates(&query);
    let page = query.page.unwrap_or(1);
    let limit = query.limit.unwrap_or(20);
    ensure_page_limit(limit, state.config.rate_limit_authenticated)?;

    let service = TransactionHistoryService::new(state.db);
    let history = service.get_user_history(
        &user_address,
        query.tx_type,
        from_date,
        to_date,
        page,
        limit,
    ).await?;

    if page == 1 {
        if let Ok(stats) = service.get_user_stats(&user_address).await {
            tracing::debug!("Transaction stats: {:?}", stats);
        }
        if let Ok(recent) = service.get_recent_transactions(&user_address).await {
            tracing::debug!("Recent transaction sample count: {}", recent.len());
        }
    }

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
    headers: HeaderMap,
    Json(query): Json<HistoryQuery>,
) -> Result<impl IntoResponse> {
    let user_address = require_user(&headers, &state).await?;

    // Menggunakan helper parse_dates
    let (from_date, to_date) = parse_dates(&query);
    
    // Field 'tx_type', 'page', dan 'limit' mungkin tidak dipakai di export_csv
    // Kita panggil di tracing agar tidak kena warning 'unused' di masa depan
    tracing::debug!("Exporting CSV for type: {:?}, page: {:?}, limit: {:?}", 
        query.tx_type, query.page, query.limit);

    let service = TransactionHistoryService::new(state.db);
    let csv = service.export_to_csv(&user_address, from_date, to_date).await?;

    Ok((
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "text/csv"),
            (header::CONTENT_DISPOSITION, "attachment; filename=\"transactions.csv\""),
        ],
        csv,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_dates_returns_none_for_invalid() {
        // Memastikan tanggal invalid menghasilkan None
        let query = HistoryQuery {
            tx_type: None,
            from_date: Some("invalid".to_string()),
            to_date: Some("invalid".to_string()),
            page: None,
            limit: None,
        };
        let (from, to) = parse_dates(&query);
        assert!(from.is_none());
        assert!(to.is_none());
    }

    #[test]
    fn parse_dates_parses_valid_rfc3339() {
        // Memastikan tanggal valid ter-parse
        let query = HistoryQuery {
            tx_type: None,
            from_date: Some("2024-01-01T00:00:00Z".to_string()),
            to_date: None,
            page: None,
            limit: None,
        };
        let (from, to) = parse_dates(&query);
        assert!(from.is_some());
        assert!(to.is_none());
    }
}
