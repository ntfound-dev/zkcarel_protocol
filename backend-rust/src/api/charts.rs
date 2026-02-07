use axum::{
    extract::{Path, State, Query},
    Json,
};
use serde::{Deserialize, Serialize};
use rust_decimal::prelude::ToPrimitive;

use crate::{
    error::Result,
    models::{ApiResponse, OHLCVResponse},
    services::PriceChartService,
};

use super::AppState;

#[derive(Debug, Deserialize)]
pub struct OHLCVQuery {
    pub interval: String,
    pub from: Option<String>,
    pub to: Option<String>,
    pub limit: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct IndicatorsResponse {
    pub indicator: String,
    pub data: Vec<IndicatorPoint>,
}

#[derive(Debug, Serialize)]
pub struct IndicatorPoint {
    pub timestamp: i64,
    pub value: f64,
}

/// GET /api/v1/chart/:token/ohlcv
pub async fn get_ohlcv(
    State(state): State<AppState>,
    Path(token): Path<String>,
    Query(query): Query<OHLCVQuery>,
) -> Result<Json<ApiResponse<OHLCVResponse>>> {
    let service = PriceChartService::new(state.db, state.config);

    let to = query.to
        .as_ref()
        .and_then(|d| chrono::DateTime::parse_from_rfc3339(d).ok())
        .map(|d| d.with_timezone(&chrono::Utc))
        .unwrap_or_else(chrono::Utc::now);

    let from = query.from
        .as_ref()
        .and_then(|d| chrono::DateTime::parse_from_rfc3339(d).ok())
        .map(|d| d.with_timezone(&chrono::Utc))
        .unwrap_or_else(|| to - chrono::Duration::hours(24));

    let data = if let Some(limit) = query.limit {
        service
            .get_latest_candles(&token, &query.interval, limit)
            .await?
    } else {
        service
            .get_ohlcv(&token, &query.interval, from, to)
            .await?
    };

    Ok(Json(ApiResponse::success(OHLCVResponse {
        token,
        interval: query.interval,
        data,
    })))
}

/// GET /api/v1/chart/:token/indicators
pub async fn get_indicators(
    State(state): State<AppState>,
    Path(token): Path<String>,
    Query(query): Query<OHLCVQuery>,
) -> Result<Json<ApiResponse<Vec<IndicatorsResponse>>>> {
    let service = PriceChartService::new(state.db, state.config);
    let mut indicators = vec![];

    for (name, key) in [("SMA", "SMA"), ("EMA", "EMA"), ("RSI", "RSI")] {
        if let Ok(data) = service.calculate_indicators(&token, &query.interval, key).await {
            indicators.push(IndicatorsResponse {
                indicator: name.to_string(),
                data: data
                    .into_iter()
                    .map(|(ts, val)| IndicatorPoint {
                        timestamp: ts.timestamp(),
                        value: val.to_f64().unwrap_or(0.0),
                    })
                    .collect(),
            });
        }
    }

    Ok(Json(ApiResponse::success(indicators)))
}
