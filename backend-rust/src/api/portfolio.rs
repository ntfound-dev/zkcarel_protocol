use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::{
    error::Result,
    models::ApiResponse,
};

use super::AppState;

#[derive(Debug, Serialize)]
pub struct BalanceResponse {
    pub total_value_usd: f64,
    pub balances: Vec<TokenBalance>,
}

#[derive(Debug, Serialize)]
pub struct TokenBalance {
    pub token: String,
    pub amount: f64,
    pub value_usd: f64,
    pub price: f64,
    pub change_24h: f64,
}

#[derive(Debug, Serialize)]
pub struct HistoryResponse {
    pub total_value: Vec<HistoryPoint>,
    pub pnl: f64,
    pub pnl_percentage: f64,
}

#[derive(Debug, Serialize)]
pub struct HistoryPoint {
    pub timestamp: i64,
    pub value: f64,
}

#[derive(Debug, Deserialize)]
pub struct HistoryQuery {
    pub period: String, // 1d, 7d, 30d, all
}

/// GET /api/v1/portfolio/balance
pub async fn get_balance(
    State(_state): State<AppState>,
) -> Result<Json<ApiResponse<BalanceResponse>>> {
    // TODO: Extract user from JWT and get actual balances
    
    // Mock balances
    let balances = vec![
        TokenBalance {
            token: "CAREL".to_string(),
            amount: 15000.0,
            value_usd: 7500.0,
            price: 0.5,
            change_24h: 5.2,
        },
        TokenBalance {
            token: "BTC".to_string(),
            amount: 0.15,
            value_usd: 9750.0,
            price: 65000.0,
            change_24h: -1.3,
        },
        TokenBalance {
            token: "ETH".to_string(),
            amount: 2.5,
            value_usd: 8750.0,
            price: 3500.0,
            change_24h: 2.1,
        },
        TokenBalance {
            token: "USDT".to_string(),
            amount: 5000.0,
            value_usd: 5000.0,
            price: 1.0,
            change_24h: 0.0,
        },
    ];

    let total_value_usd: f64 = balances.iter().map(|b| b.value_usd).sum();

    let response = BalanceResponse {
        total_value_usd,
        balances,
    };

    Ok(Json(ApiResponse::success(response)))
}

/// GET /api/v1/portfolio/history
pub async fn get_history(
    State(_state): State<AppState>,
    axum::extract::Query(query): axum::extract::Query<HistoryQuery>,
) -> Result<Json<ApiResponse<HistoryResponse>>> {
    // TODO: Extract user and calculate actual history

    // Generate mock history data
    let points_count = match query.period.as_str() {
        "1d" => 24,
        "7d" => 7 * 24,
        "30d" => 30,
        _ => 30,
    };

    let mut total_value = Vec::new();
    let base_value = 31000.0;
    let now = chrono::Utc::now().timestamp();

    for i in 0..points_count {
        let timestamp = now - (points_count - i - 1) * 3600;
        let variation = (rand::random::<f64>() - 0.5) * 2000.0;
        let value = base_value + variation;
        
        total_value.push(HistoryPoint {
            timestamp,
            value,
        });
    }

    // Calculate PnL
    let initial_value = 28000.0;
    let current_value = 31000.0;
    let pnl = current_value - initial_value;
    let pnl_percentage = (pnl / initial_value) * 100.0;

    let response = HistoryResponse {
        total_value,
        pnl,
        pnl_percentage,
    };

    Ok(Json(ApiResponse::success(response)))
}