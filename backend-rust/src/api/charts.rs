use axum::{
    extract::{Path, Query, State},
    Json,
};
use rust_decimal::prelude::ToPrimitive;
use serde::{Deserialize, Serialize};

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
    pub source: Option<String>,
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

// Internal helper that parses or transforms values for `parse_rfc3339_or`.
fn parse_rfc3339_or(
    value: Option<&str>,
    default: chrono::DateTime<chrono::Utc>,
) -> chrono::DateTime<chrono::Utc> {
    value
        .and_then(|d| chrono::DateTime::parse_from_rfc3339(d).ok())
        .map(|d| d.with_timezone(&chrono::Utc))
        .unwrap_or(default)
}

// Internal helper that supports `map_indicator_points` operations.
fn map_indicator_points(
    data: Vec<(chrono::DateTime<chrono::Utc>, rust_decimal::Decimal)>,
) -> Vec<IndicatorPoint> {
    data.into_iter()
        .map(|(ts, val)| IndicatorPoint {
            timestamp: ts.timestamp(),
            value: val.to_f64().unwrap_or(0.0),
        })
        .collect()
}

/// GET /api/v1/chart/:token/ohlcv
pub async fn get_ohlcv(
    State(state): State<AppState>,
    Path(token): Path<String>,
    Query(query): Query<OHLCVQuery>,
) -> Result<Json<ApiResponse<OHLCVResponse>>> {
    let service = PriceChartService::new(state.db, state.config);

    let to = parse_rfc3339_or(query.to.as_deref(), chrono::Utc::now());
    let from_default = to - chrono::Duration::hours(24);
    let from = parse_rfc3339_or(query.from.as_deref(), from_default);
    let source = query
        .source
        .as_deref()
        .unwrap_or("auto")
        .trim()
        .to_ascii_lowercase();

    let data = if source == "coingecko" {
        service
            .get_ohlcv_from_coingecko(&token, &query.interval, query.limit.unwrap_or(120))
            .await?
    } else {
        let data = if let Some(limit) = query.limit {
            service
                .get_latest_candles(&token, &query.interval, limit)
                .await?
        } else {
            service.get_ohlcv(&token, &query.interval, from, to).await?
        };
        if data.is_empty() {
            service
                .get_ohlcv_from_coingecko(&token, &query.interval, query.limit.unwrap_or(120))
                .await?
        } else {
            data
        }
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
        if let Ok(data) = service
            .calculate_indicators(&token, &query.interval, key)
            .await
        {
            indicators.push(IndicatorsResponse {
                indicator: name.to_string(),
                data: map_indicator_points(data),
            });
        }
    }

    Ok(Json(ApiResponse::success(indicators)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};
    use rust_decimal::Decimal;

    #[test]
    // Internal helper that parses or transforms values for `parse_rfc3339_or_uses_default_on_invalid`.
    fn parse_rfc3339_or_uses_default_on_invalid() {
        // Memastikan tanggal invalid memakai default
        let fallback = Utc.timestamp_opt(1_700_000_000, 0).unwrap();
        let parsed = parse_rfc3339_or(Some("invalid-date"), fallback);
        assert_eq!(parsed, fallback);
    }

    #[test]
    // Internal helper that supports `map_indicator_points_converts_decimal` operations.
    fn map_indicator_points_converts_decimal() {
        // Memastikan konversi indikator ke tipe response benar
        let ts = Utc.timestamp_opt(1_700_000_000, 0).unwrap();
        let data = vec![(ts, Decimal::from(42))];
        let out = map_indicator_points(data);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].timestamp, 1_700_000_000);
        assert!((out[0].value - 42.0).abs() < f64::EPSILON);
    }
}
