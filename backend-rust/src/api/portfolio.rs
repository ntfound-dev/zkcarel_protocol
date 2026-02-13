use axum::{extract::State, http::HeaderMap, Json};
use chrono::TimeZone;
use rust_decimal::prelude::ToPrimitive;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

use crate::{
    error::Result,
    models::{ApiResponse, PriceTick},
};

use super::{
    require_user,
    wallet::{
        fetch_btc_balance, fetch_evm_erc20_balance, fetch_evm_native_balance,
        fetch_starknet_erc20_balance,
    },
    AppState,
};

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

#[derive(Debug, Deserialize)]
pub struct PortfolioOHLCVQuery {
    pub interval: String, // 1h, 4h, 1d, 1w
    pub limit: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct PortfolioOHLCVPoint {
    pub timestamp: i64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
}

#[derive(Debug, Serialize)]
pub struct PortfolioOHLCVResponse {
    pub interval: String,
    pub data: Vec<PortfolioOHLCVPoint>,
}

#[derive(sqlx::FromRow)]
struct RawTokenBalance {
    token: String,
    amount: f64,
}

struct TokenSeries {
    amount: f64,
    ticks: HashMap<i64, PriceTick>,
    last_close: Option<f64>,
    fallback_price: f64,
}

const ONCHAIN_BALANCE_TIMEOUT_SECS: u64 = 4;

fn total_value_usd(balances: &[TokenBalance]) -> f64 {
    balances.iter().map(|b| b.value_usd).sum()
}

fn period_to_interval(period: &str) -> (&'static str, i64) {
    match period {
        "1d" => ("1h", 24),
        "7d" => ("1d", 7),
        "30d" => ("1d", 30),
        _ => ("1w", 26),
    }
}

fn fallback_price_for(token: &str) -> f64 {
    match token.to_uppercase().as_str() {
        "USDT" | "USDC" | "CAREL" => 1.0,
        _ => 0.0,
    }
}

fn decimal_to_f64(value: rust_decimal::Decimal) -> f64 {
    value.to_f64().unwrap_or(0.0)
}

fn interval_seconds(interval: &str) -> i64 {
    match interval {
        "1h" => 3600,
        "4h" => 14400,
        "1d" => 86400,
        "1w" => 604800,
        _ => 3600,
    }
}

fn clamp_ohlcv_limit(limit: Option<i32>) -> i64 {
    limit.unwrap_or(24).clamp(2, 200) as i64
}

fn align_timestamp(timestamp: i64, interval: i64) -> i64 {
    if interval <= 0 {
        return timestamp;
    }
    timestamp - (timestamp % interval)
}

fn tick_prices(tick: &PriceTick) -> (f64, f64, f64, f64, f64) {
    (
        decimal_to_f64(tick.open),
        decimal_to_f64(tick.high),
        decimal_to_f64(tick.low),
        decimal_to_f64(tick.close),
        decimal_to_f64(tick.volume),
    )
}

async fn latest_price(state: &AppState, token: &str) -> Result<f64> {
    let price: Option<f64> = sqlx::query_scalar(
        "SELECT close::FLOAT FROM price_history WHERE token = $1 ORDER BY timestamp DESC LIMIT 1",
    )
    .bind(token)
    .fetch_optional(state.db.pool())
    .await?;

    Ok(price
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or_else(|| fallback_price_for(token)))
}

async fn latest_price_with_change(state: &AppState, token: &str) -> Result<(f64, f64)> {
    let rows: Vec<f64> = sqlx::query_scalar(
        "SELECT close::FLOAT FROM price_history WHERE token = $1 ORDER BY timestamp DESC LIMIT 2",
    )
    .bind(token)
    .fetch_all(state.db.pool())
    .await?;

    let latest = rows
        .get(0)
        .copied()
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or_else(|| fallback_price_for(token));
    let prev = rows
        .get(1)
        .copied()
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(latest);
    let change = if prev > 0.0 {
        ((latest - prev) / prev) * 100.0
    } else {
        0.0
    };
    Ok((latest, change))
}

async fn fetch_token_holdings(
    state: &AppState,
    user_address: &str,
) -> Result<Vec<RawTokenBalance>> {
    let rows = sqlx::query_as::<_, RawTokenBalance>(
        r#"
        SELECT token, SUM(amount) as amount
        FROM (
            SELECT UPPER(token_out) as token, COALESCE(CAST(amount_out AS FLOAT), 0) as amount
            FROM transactions
            WHERE user_address = $1 AND token_out IS NOT NULL AND COALESCE(is_private, false) = false
            UNION ALL
            SELECT UPPER(token_in) as token, -COALESCE(CAST(amount_in AS FLOAT), 0) as amount
            FROM transactions
            WHERE user_address = $1 AND token_in IS NOT NULL AND COALESCE(is_private, false) = false
        ) t
        GROUP BY token
        "#,
    )
    .bind(user_address)
    .fetch_all(state.db.pool())
    .await?;

    Ok(rows)
}

fn override_holding(holdings: &mut HashMap<String, f64>, token: &str, amount: f64) {
    if !amount.is_finite() {
        return;
    }
    if amount <= 0.0 {
        holdings.remove(token);
        return;
    }
    holdings.insert(token.to_string(), amount);
}

async fn fetch_optional_balance_with_timeout<F>(label: &str, fut: F) -> Option<f64>
where
    F: std::future::Future<Output = Result<Option<f64>>>,
{
    match tokio::time::timeout(Duration::from_secs(ONCHAIN_BALANCE_TIMEOUT_SECS), fut).await {
        Ok(Ok(value)) => value,
        Ok(Err(err)) => {
            tracing::warn!("Portfolio {} fetch failed: {}", label, err);
            None
        }
        Err(_) => {
            tracing::warn!(
                "Portfolio {} fetch timed out after {}s",
                label,
                ONCHAIN_BALANCE_TIMEOUT_SECS
            );
            None
        }
    }
}

async fn merge_onchain_holdings(
    state: &AppState,
    user_address: &str,
    holdings: &mut HashMap<String, f64>,
) -> Result<()> {
    let linked = state
        .db
        .list_wallet_addresses(user_address)
        .await
        .unwrap_or_default();
    let starknet_address = linked
        .iter()
        .find(|item| item.chain == "starknet")
        .map(|item| item.wallet_address.clone());
    let evm_address = linked
        .iter()
        .find(|item| item.chain == "evm")
        .map(|item| item.wallet_address.clone());
    let btc_address = linked
        .iter()
        .find(|item| item.chain == "bitcoin")
        .map(|item| item.wallet_address.clone());

    let starknet_strk_fut = async {
        match (
            starknet_address.as_deref(),
            state.config.token_strk_address.as_deref(),
        ) {
            (Some(addr), Some(token)) => {
                fetch_optional_balance_with_timeout(
                    "starknet STRK",
                    fetch_starknet_erc20_balance(&state.config, addr, token),
                )
                .await
            }
            _ => None,
        }
    };
    let evm_eth_fut = async {
        match evm_address.as_deref() {
            Some(addr) => {
                fetch_optional_balance_with_timeout(
                    "evm ETH",
                    fetch_evm_native_balance(&state.config, addr),
                )
                .await
            }
            None => None,
        }
    };
    let evm_strk_fut = async {
        match (
            evm_address.as_deref(),
            state.config.token_strk_l1_address.as_deref(),
        ) {
            (Some(addr), Some(token)) => {
                fetch_optional_balance_with_timeout(
                    "evm STRK",
                    fetch_evm_erc20_balance(&state.config, addr, token),
                )
                .await
            }
            _ => None,
        }
    };
    let btc_fut = async {
        match btc_address.as_deref() {
            Some(addr) => {
                fetch_optional_balance_with_timeout(
                    "bitcoin BTC",
                    fetch_btc_balance(&state.config, addr),
                )
                .await
            }
            None => None,
        }
    };

    let (starknet_strk, evm_eth, evm_strk, btc_balance) =
        tokio::join!(starknet_strk_fut, evm_eth_fut, evm_strk_fut, btc_fut);

    if let Some(balance) = evm_eth {
        override_holding(holdings, "ETH", balance);
    }

    let strk_total = starknet_strk.unwrap_or(0.0) + evm_strk.unwrap_or(0.0);
    if strk_total > 0.0 {
        override_holding(holdings, "STRK", strk_total);
    }

    if let Some(balance) = btc_balance {
        override_holding(holdings, "BTC", balance);
    }

    Ok(())
}

async fn build_balances(state: &AppState, user_address: &str) -> Result<Vec<TokenBalance>> {
    let rows = fetch_token_holdings(state, user_address).await?;
    let mut holding_map = HashMap::new();
    for row in rows {
        if row.amount > 0.0 {
            holding_map.insert(row.token, row.amount);
        }
    }
    merge_onchain_holdings(state, user_address, &mut holding_map).await?;

    let mut balances = Vec::new();

    for (token, amount) in holding_map {
        if amount <= 0.0 {
            continue;
        }
        let (price, change) = latest_price_with_change(state, token.as_str()).await?;
        let value_usd = amount * price;
        balances.push(TokenBalance {
            token,
            amount,
            value_usd,
            price,
            change_24h: change,
        });
    }

    Ok(balances)
}

async fn build_portfolio_ohlcv(
    state: &AppState,
    user_address: &str,
    interval: &str,
    limit: i64,
) -> Result<Vec<PortfolioOHLCVPoint>> {
    let holdings = fetch_token_holdings(state, user_address).await?;
    if holdings.is_empty() {
        return Ok(Vec::new());
    }

    let interval_secs = interval_seconds(interval);
    let now_ts = align_timestamp(chrono::Utc::now().timestamp(), interval_secs);
    let start_ts = now_ts - interval_secs * (limit - 1);
    let from = chrono::Utc
        .timestamp_opt(start_ts, 0)
        .single()
        .unwrap_or_else(|| chrono::Utc::now());
    let to = chrono::Utc
        .timestamp_opt(now_ts, 0)
        .single()
        .unwrap_or_else(|| chrono::Utc::now());

    let mut series = Vec::new();
    for holding in holdings {
        let token = holding.token.clone();
        let ticks = state
            .db
            .get_price_history(&token, interval, from, to)
            .await?
            .into_iter()
            .map(|tick| (tick.timestamp.timestamp(), tick))
            .collect::<HashMap<_, _>>();
        let fallback = latest_price(state, token.as_str()).await?;

        series.push(TokenSeries {
            amount: holding.amount,
            ticks,
            last_close: None,
            fallback_price: fallback,
        });
    }

    let mut data = Vec::with_capacity(limit as usize);
    for idx in 0..limit {
        let ts = start_ts + interval_secs * idx;
        let mut open_total = 0.0;
        let mut high_total = 0.0;
        let mut low_total = 0.0;
        let mut close_total = 0.0;
        let mut volume_total = 0.0;

        for token_series in series.iter_mut() {
            let (open, high, low, close, volume) = if let Some(tick) = token_series.ticks.get(&ts) {
                let (o, h, l, c, v) = tick_prices(tick);
                token_series.last_close = Some(c);
                (o, h, l, c, v)
            } else if let Some(last) = token_series.last_close {
                (last, last, last, last, 0.0)
            } else {
                let fallback = token_series.fallback_price;
                (fallback, fallback, fallback, fallback, 0.0)
            };

            open_total += token_series.amount * open;
            high_total += token_series.amount * high;
            low_total += token_series.amount * low;
            close_total += token_series.amount * close;
            volume_total += volume;
        }

        data.push(PortfolioOHLCVPoint {
            timestamp: ts,
            open: open_total,
            high: high_total,
            low: low_total,
            close: close_total,
            volume: volume_total,
        });
    }

    Ok(data)
}

/// GET /api/v1/portfolio/balance
pub async fn get_balance(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<BalanceResponse>>> {
    let user_address = require_user(&headers, &state).await?;
    let balances = build_balances(&state, &user_address).await?;

    let total_value_usd = total_value_usd(&balances);

    let response = BalanceResponse {
        total_value_usd,
        balances,
    };

    Ok(Json(ApiResponse::success(response)))
}

/// GET /api/v1/portfolio/history
pub async fn get_history(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(query): axum::extract::Query<HistoryQuery>,
) -> Result<Json<ApiResponse<HistoryResponse>>> {
    let user_address = require_user(&headers, &state).await?;
    let (interval, limit) = period_to_interval(&query.period);
    let ohlcv = build_portfolio_ohlcv(&state, &user_address, interval, limit).await?;
    let total_value = ohlcv
        .iter()
        .map(|point| HistoryPoint {
            timestamp: point.timestamp,
            value: point.close,
        })
        .collect::<Vec<_>>();

    let (pnl, pnl_percentage) = if let (Some(first), Some(last)) = (ohlcv.first(), ohlcv.last()) {
        let diff = last.close - first.close;
        let pct = if first.close > 0.0 {
            (diff / first.close) * 100.0
        } else {
            0.0
        };
        (diff, pct)
    } else {
        (0.0, 0.0)
    };

    let response = HistoryResponse {
        total_value,
        pnl,
        pnl_percentage,
    };

    Ok(Json(ApiResponse::success(response)))
}

/// GET /api/v1/portfolio/ohlcv
pub async fn get_portfolio_ohlcv(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::extract::Query(query): axum::extract::Query<PortfolioOHLCVQuery>,
) -> Result<Json<ApiResponse<PortfolioOHLCVResponse>>> {
    let user_address = require_user(&headers, &state).await?;
    let interval = query.interval.clone();
    let limit = clamp_ohlcv_limit(query.limit);
    let data = build_portfolio_ohlcv(&state, &user_address, &interval, limit).await?;

    Ok(Json(ApiResponse::success(PortfolioOHLCVResponse {
        interval,
        data,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn total_value_usd_sums_balances() {
        // Memastikan total nilai dihitung dari seluruh saldo
        let balances = vec![
            TokenBalance {
                token: "A".to_string(),
                amount: 1.0,
                value_usd: 10.0,
                price: 10.0,
                change_24h: 0.0,
            },
            TokenBalance {
                token: "B".to_string(),
                amount: 2.0,
                value_usd: 15.5,
                price: 7.75,
                change_24h: 0.0,
            },
        ];
        assert!((total_value_usd(&balances) - 25.5).abs() < f64::EPSILON);
    }

    #[test]
    fn period_to_interval_defaults_to_weekly() {
        // Memastikan periode tidak dikenal memakai default 1w
        let (interval, limit) = period_to_interval("unknown");
        assert_eq!(interval, "1w");
        assert_eq!(limit, 26);
    }

    #[test]
    fn interval_seconds_defaults_to_hour() {
        // Memastikan interval tidak dikenal memakai 1 jam
        assert_eq!(interval_seconds("unknown"), 3600);
    }

    #[test]
    fn align_timestamp_rounds_down() {
        // Memastikan timestamp di-align ke interval
        assert_eq!(align_timestamp(10005, 3600), 7200);
    }
}
