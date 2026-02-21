use crate::indexer::starknet_client::StarknetClient;
use crate::{
    config::Config,
    constants::token_address_for,
    constants::PRICE_UPDATER_INTERVAL_SECS,
    db::Database,
    error::{AppError, Result},
    models::PriceTick,
    services::price_guard::sanitize_price_usd,
};

use chrono::{DateTime, TimeZone, Timelike, Utc};
use rust_decimal::prelude::{FromPrimitive, ToPrimitive};
use rust_decimal::Decimal;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

// Internal helper that supports `candle_start_time` operations.
fn candle_start_time(time: DateTime<Utc>, interval: &str) -> DateTime<Utc> {
    let minutes = match interval {
        "1m" => 1,
        "5m" => 5,
        "15m" => 15,
        "1h" => 60,
        "4h" => 240,
        "1d" => 1440,
        _ => 1,
    };

    let total_minutes = time.hour() as i64 * 60 + time.minute() as i64;
    let rounded = (total_minutes / minutes) * minutes;

    time.date_naive()
        .and_hms_opt((rounded / 60) as u32, (rounded % 60) as u32, 0)
        .unwrap()
        .and_utc()
}

pub struct PriceChartService {
    db: Database,
    config: Config,
    price_cache: Arc<RwLock<HashMap<String, Decimal>>>,
}

impl PriceChartService {
    /// Constructs a new instance via `new`.
    ///
    /// # Arguments
    /// * Uses function parameters as validated input and runtime context.
    ///
    /// # Returns
    /// * `Ok(...)` when processing succeeds.
    /// * `Err(AppError)` when validation, authorization, or integration checks fail.
    ///
    /// # Notes
    /// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
    pub fn new(db: Database, config: Config) -> Self {
        Self {
            db,
            config,
            price_cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Start background price updater
    pub async fn start_price_updater(self: Arc<Self>) {
        tokio::spawn(async move {
            loop {
                if let Err(e) = self.update_prices().await {
                    tracing::error!("Failed to update prices: {}", e);
                }

                tokio::time::sleep(tokio::time::Duration::from_secs(
                    PRICE_UPDATER_INTERVAL_SECS,
                ))
                .await;
            }
        });
    }

    // Internal helper that updates state for `update_prices`.
    async fn update_prices(&self) -> Result<()> {
        let tokens = self.config.price_tokens_list();

        for token in tokens.iter() {
            let raw_price = match self.fetch_price(token.as_str()).await {
                Ok(value) => value,
                Err(err) => {
                    tracing::warn!("Oracle price fetch failed for {}: {}", token, err);
                    let cache = self.price_cache.read().await;
                    if let Some(last_price) = cache.get(token) {
                        *last_price
                    } else {
                        continue;
                    }
                }
            };
            let raw_price_f64 = raw_price.to_f64().unwrap_or(0.0);
            let Some(sane_price_f64) = sanitize_price_usd(token, raw_price_f64) else {
                tracing::warn!(
                    "Ignoring outlier price for {}: raw={}",
                    token,
                    raw_price_f64
                );
                continue;
            };
            let Some(price) = Decimal::from_f64(sane_price_f64) else {
                continue;
            };

            let mut cache = self.price_cache.write().await;
            let last_price = cache.get(token).copied();
            cache.insert(token.to_string(), price);
            drop(cache);

            if let Ok(latest) = self.get_current_price(token).await {
                tracing::debug!("Current price {}: {}", token, latest);
            }

            self.update_ohlcv_candles(token, price, last_price).await?;
        }

        Ok(())
    }

    // Internal helper that fetches data for `fetch_price`.
    async fn fetch_price(&self, token: &str) -> Result<Decimal> {
        if self.config.coingecko_id_for(token).is_some() {
            match self.fetch_price_from_coingecko(token).await {
                Ok(price) => return Ok(price),
                Err(err) => {
                    tracing::warn!("CoinGecko fetch failed for {}: {}", token, err);
                }
            }
        }
        self.fetch_price_from_oracle(token).await
    }

    // Internal helper that fetches data for `fetch_price_from_oracle`.
    async fn fetch_price_from_oracle(&self, token: &str) -> Result<Decimal> {
        let asset_id = self
            .config
            .oracle_asset_id_for(token)
            .ok_or_else(|| AppError::NotFound(format!("Missing asset_id for {}", token)))?;
        let token_address = token_address_for(token).ok_or_else(|| AppError::InvalidToken)?;

        let client = StarknetClient::new(self.config.starknet_rpc_url.clone());
        let result = client
            .call_contract(
                &self.config.price_oracle_address,
                "get_price",
                vec![token_address.to_string(), asset_id],
            )
            .await?;

        let raw = parse_u256_low(&result)? as f64;
        if !raw.is_finite() || raw <= 0.0 {
            return Err(AppError::Internal("Invalid oracle price".into()));
        }

        let candidates = [raw / 100_000_000.0, raw / 1_000_000_000_000_000_000.0];
        for candidate in candidates {
            if let Some(sane) = sanitize_price_usd(token, candidate) {
                if let Some(decimal) = Decimal::from_f64(sane) {
                    return Ok(decimal);
                }
            }
        }

        Err(AppError::Internal(format!(
            "Oracle price out of sane range for {}",
            token
        )))
    }

    // Internal helper that fetches data for `fetch_price_from_coingecko`.
    async fn fetch_price_from_coingecko(&self, token: &str) -> Result<Decimal> {
        let coin_id = self
            .coingecko_id_or_default(token)
            .ok_or_else(|| AppError::NotFound(format!("Missing CoinGecko id for {}", token)))?;

        let base_url = self.config.coingecko_api_url.trim_end_matches('/');
        let url = format!("{}/simple/price", base_url);
        let client = reqwest::Client::new();
        let mut url =
            reqwest::Url::parse(&url).map_err(|e| AppError::BlockchainRPC(e.to_string()))?;
        url.query_pairs_mut()
            .append_pair("ids", coin_id.as_str())
            .append_pair("vs_currencies", "usd");
        let mut request = client.get(url);

        if let Some(key) = &self.config.coingecko_api_key {
            if !key.trim().is_empty() {
                request = request.header("x-cg-demo-api-key", key.trim());
            }
        }

        let response = request
            .send()
            .await
            .map_err(|e| AppError::BlockchainRPC(e.to_string()))?;

        let data: CoinGeckoPriceResponse = response
            .json()
            .await
            .map_err(|e| AppError::BlockchainRPC(e.to_string()))?;

        let usd_price = data
            .prices
            .get(coin_id.as_str())
            .and_then(|entry| entry.usd)
            .ok_or_else(|| AppError::Internal(format!("Missing CoinGecko price for {}", token)))?;

        if usd_price.is_sign_negative() {
            return Err(AppError::Internal("Negative price".into()));
        }
        let sane = sanitize_price_usd(token, usd_price)
            .ok_or_else(|| AppError::Internal(format!("Outlier CoinGecko price for {}", token)))?;
        Decimal::from_f64(sane).ok_or_else(|| AppError::Internal("Failed to convert price".into()))
    }

    /// Fetches data for `get_ohlcv_from_coingecko`.
    ///
    /// # Arguments
    /// * Uses function parameters as validated input and runtime context.
    ///
    /// # Returns
    /// * `Ok(...)` when processing succeeds.
    /// * `Err(AppError)` when validation, authorization, or integration checks fail.
    ///
    /// # Notes
    /// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
    pub async fn get_ohlcv_from_coingecko(
        &self,
        token: &str,
        interval: &str,
        limit: i32,
    ) -> Result<Vec<PriceTick>> {
        let symbol = token.to_ascii_uppercase();
        let max_len = limit.max(1) as usize;
        let coin_id = match self.coingecko_id_or_default(&symbol) {
            Some(value) => value,
            None => {
                // Token seperti CAREL belum punya listing CoinGecko:
                // fallback ke candle lokal dari DB agar endpoint chart tetap hidup.
                let local = self.get_latest_candles(&symbol, interval, limit).await?;
                if !local.is_empty() {
                    return Ok(local);
                }
                if symbol == "CAREL" {
                    return Ok(self.synthetic_flat_ohlcv(&symbol, interval, max_len, Decimal::ONE));
                }
                return Err(AppError::NotFound(format!(
                    "Missing CoinGecko id for {}",
                    token
                )));
            }
        };
        let days = Self::coingecko_days_for(interval, limit);

        let base_url = self.config.coingecko_api_url.trim_end_matches('/');
        let endpoint = format!("{}/coins/{}/ohlc", base_url, coin_id);
        let mut url =
            reqwest::Url::parse(&endpoint).map_err(|e| AppError::BlockchainRPC(e.to_string()))?;
        url.query_pairs_mut()
            .append_pair("vs_currency", "usd")
            .append_pair("days", days);

        let client = reqwest::Client::new();
        let mut request = client.get(url);
        if let Some(key) = &self.config.coingecko_api_key {
            if !key.trim().is_empty() {
                request = request.header("x-cg-demo-api-key", key.trim());
            }
        }

        let response = request
            .send()
            .await
            .map_err(|e| AppError::BlockchainRPC(e.to_string()))?;
        let rows: Vec<Vec<f64>> = response
            .json()
            .await
            .map_err(|e| AppError::BlockchainRPC(e.to_string()))?;

        let mut candles = Vec::with_capacity(rows.len());
        for row in rows {
            if row.len() < 5 {
                continue;
            }
            let ts_ms = row[0] as i64;
            let Some(timestamp) = Utc.timestamp_millis_opt(ts_ms).single() else {
                continue;
            };
            let Some(close_f64) = sanitize_price_usd(&symbol, row[4]) else {
                continue;
            };
            let close = Decimal::from_f64(close_f64).unwrap_or(Decimal::ZERO);
            let open_f64 = sanitize_price_usd(&symbol, row[1]).unwrap_or(close_f64);
            let high_f64 = sanitize_price_usd(&symbol, row[2]).unwrap_or(close_f64);
            let low_f64 = sanitize_price_usd(&symbol, row[3]).unwrap_or(close_f64);
            let open = Decimal::from_f64(open_f64).unwrap_or(close);
            let high = Decimal::from_f64(high_f64).unwrap_or(close);
            let low = Decimal::from_f64(low_f64).unwrap_or(close);
            candles.push(PriceTick {
                token: symbol.clone(),
                timestamp,
                open,
                high,
                low,
                close,
                volume: Decimal::ZERO,
            });
        }

        if candles.is_empty() {
            let local = self.get_latest_candles(&symbol, interval, limit).await?;
            if !local.is_empty() {
                return Ok(local);
            }
            if symbol == "CAREL" {
                return Ok(self.synthetic_flat_ohlcv(&symbol, interval, max_len, Decimal::ONE));
            }
            return Err(AppError::NotFound(format!(
                "CoinGecko OHLCV unavailable for {}",
                token
            )));
        }

        if candles.len() > max_len {
            candles = candles[candles.len() - max_len..].to_vec();
        }

        Ok(candles)
    }

    // Internal helper that updates state for `update_ohlcv_candles`.
    async fn update_ohlcv_candles(
        &self,
        token: &str,
        current_price: Decimal,
        last_price: Option<Decimal>,
    ) -> Result<()> {
        let now = Utc::now();
        let intervals = ["1m", "5m", "15m", "1h", "4h", "1d"];

        for interval in intervals {
            let candle_start = candle_start_time(now, interval);

            let sql = r#"
                SELECT token, timestamp, open, high, low, close, volume
                FROM price_history
                WHERE token = $1 AND timestamp = $2 AND interval = $3
            "#;

            let existing = sqlx::query_as::<_, PriceTick>(sql)
                .bind(token)
                .bind(candle_start)
                .bind(interval)
                .fetch_optional(self.db.pool())
                .await?;

            match existing {
                Some(candle) => {
                    let high = candle.high.max(current_price);
                    let low = candle.low.min(current_price);

                    self.save_candle(
                        token,
                        candle_start,
                        candle.open,
                        high,
                        low,
                        current_price,
                        interval,
                    )
                    .await?;
                }
                None => {
                    let open = last_price.unwrap_or(current_price);

                    self.save_candle(
                        token,
                        candle_start,
                        open,
                        current_price,
                        current_price,
                        current_price,
                        interval,
                    )
                    .await?;
                }
            }
        }

        Ok(())
    }

    // Internal helper that updates state for `save_candle`.
    async fn save_candle(
        &self,
        token: &str,
        timestamp: DateTime<Utc>,
        open: Decimal,
        high: Decimal,
        low: Decimal,
        close: Decimal,
        interval: &str,
    ) -> Result<()> {
        let close_f64 = close
            .to_f64()
            .ok_or_else(|| AppError::Internal("close".into()))?;
        let Some(close_sane) = sanitize_price_usd(token, close_f64) else {
            tracing::warn!(
                "Skip saving outlier candle for {} interval {}: close={}",
                token,
                interval,
                close_f64
            );
            return Ok(());
        };
        let open_sane = open
            .to_f64()
            .ok_or_else(|| AppError::Internal("open".into()))
            .ok()
            .and_then(|v| sanitize_price_usd(token, v))
            .unwrap_or(close_sane);
        let high_sane = high
            .to_f64()
            .ok_or_else(|| AppError::Internal("high".into()))
            .ok()
            .and_then(|v| sanitize_price_usd(token, v))
            .unwrap_or(open_sane.max(close_sane));
        let low_sane = low
            .to_f64()
            .ok_or_else(|| AppError::Internal("low".into()))
            .ok()
            .and_then(|v| sanitize_price_usd(token, v))
            .unwrap_or(open_sane.min(close_sane));

        self.db
            .save_price_tick(
                token, timestamp, open_sane, high_sane, low_sane, close_sane, 0.0, interval,
            )
            .await?;

        Ok(())
    }

    /// Fetches data for `get_current_price`.
    ///
    /// # Arguments
    /// * Uses function parameters as validated input and runtime context.
    ///
    /// # Returns
    /// * `Ok(...)` when processing succeeds.
    /// * `Err(AppError)` when validation, authorization, or integration checks fail.
    ///
    /// # Notes
    /// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
    pub async fn get_current_price(&self, token: &str) -> Result<Decimal> {
        self.price_cache
            .read()
            .await
            .get(token)
            .copied()
            .ok_or_else(|| AppError::NotFound("Price not found".into()))
    }

    /// Fetches data for `get_latest_candles`.
    ///
    /// # Arguments
    /// * Uses function parameters as validated input and runtime context.
    ///
    /// # Returns
    /// * `Ok(...)` when processing succeeds.
    /// * `Err(AppError)` when validation, authorization, or integration checks fail.
    ///
    /// # Notes
    /// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
    pub async fn get_latest_candles(
        &self,
        token: &str,
        interval: &str,
        count: i32,
    ) -> Result<Vec<PriceTick>> {
        let sql = r#"
            SELECT token, timestamp, open, high, low, close, volume
            FROM price_history
            WHERE token = $1 AND interval = $2
            ORDER BY timestamp DESC
            LIMIT $3
        "#;

        let data = sqlx::query_as::<_, PriceTick>(sql)
            .bind(token)
            .bind(interval)
            .bind(count as i64)
            .fetch_all(self.db.pool())
            .await?;

        Ok(data.into_iter().rev().collect())
    }

    /// ✅ METHOD YANG SEBELUMNYA HILANG
    pub async fn get_ohlcv(
        &self,
        token: &str,
        interval: &str,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<Vec<PriceTick>> {
        self.db.get_price_history(token, interval, from, to).await
    }

    /// Handles `calculate_indicators` logic.
    ///
    /// # Arguments
    /// * Uses function parameters as validated input and runtime context.
    ///
    /// # Returns
    /// * `Ok(...)` when processing succeeds.
    /// * `Err(AppError)` when validation, authorization, or integration checks fail.
    ///
    /// # Notes
    /// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
    pub async fn calculate_indicators(
        &self,
        token: &str,
        interval: &str,
        indicator: &str,
    ) -> Result<Vec<(DateTime<Utc>, Decimal)>> {
        match indicator {
            "SMA" => self.calculate_sma(token, interval, 20).await,
            "EMA" => self.calculate_ema(token, interval, 20).await,
            "RSI" => self.calculate_rsi(token, interval, 14).await,
            _ => Err(AppError::BadRequest("Invalid indicator".into())),
        }
    }

    // Internal helper that supports `calculate_sma` operations.
    async fn calculate_sma(
        &self,
        token: &str,
        interval: &str,
        period: i32,
    ) -> Result<Vec<(DateTime<Utc>, Decimal)>> {
        let candles = self.get_latest_candles(token, interval, period * 2).await?;
        let mut out = vec![];

        for i in period as usize..candles.len() {
            let sum: Decimal = candles[i - period as usize..i]
                .iter()
                .map(|c| c.close)
                .sum();
            out.push((candles[i].timestamp, sum / Decimal::from(period)));
        }

        Ok(out)
    }

    // Internal helper that supports `calculate_ema` operations.
    async fn calculate_ema(
        &self,
        token: &str,
        interval: &str,
        period: i32,
    ) -> Result<Vec<(DateTime<Utc>, Decimal)>> {
        let candles = self.get_latest_candles(token, interval, period * 2).await?;
        let multiplier = Decimal::from(2) / (Decimal::from(period) + Decimal::ONE);

        let mut ema = candles[0].close;
        let mut out = vec![(candles[0].timestamp, ema)];

        for c in &candles[1..] {
            ema = (c.close - ema) * multiplier + ema;
            out.push((c.timestamp, ema));
        }

        Ok(out)
    }

    // Internal helper that supports `calculate_rsi` operations.
    async fn calculate_rsi(
        &self,
        token: &str,
        interval: &str,
        period: i32,
    ) -> Result<Vec<(DateTime<Utc>, Decimal)>> {
        let candles = self.get_latest_candles(token, interval, period * 2).await?;

        let mut gains = vec![];
        let mut losses = vec![];

        for i in 1..candles.len() {
            let diff = candles[i].close - candles[i - 1].close;
            if diff > Decimal::ZERO {
                gains.push(diff);
                losses.push(Decimal::ZERO);
            } else {
                gains.push(Decimal::ZERO);
                losses.push(diff.abs());
            }
        }

        let mut out = vec![];

        for i in period as usize..gains.len() {
            let avg_gain: Decimal =
                gains[i - period as usize..i].iter().sum::<Decimal>() / Decimal::from(period);
            let avg_loss: Decimal =
                losses[i - period as usize..i].iter().sum::<Decimal>() / Decimal::from(period);

            let rs = if avg_loss == Decimal::ZERO {
                Decimal::from(100)
            } else {
                avg_gain / avg_loss
            };

            let rsi = Decimal::from(100) - (Decimal::from(100) / (Decimal::ONE + rs));
            out.push((candles[i].timestamp, rsi));
        }

        Ok(out)
    }

    // Internal helper that supports `coingecko_id_or_default` operations.
    fn coingecko_id_or_default(&self, token: &str) -> Option<String> {
        if let Some(mapped) = self.config.coingecko_id_for(token) {
            let trimmed = mapped.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
        match token.to_ascii_uppercase().as_str() {
            "BTC" | "WBTC" => Some("bitcoin".to_string()),
            "ETH" => Some("ethereum".to_string()),
            "STRK" => Some("starknet".to_string()),
            "USDT" => Some("tether".to_string()),
            "USDC" => Some("usd-coin".to_string()),
            _ => None,
        }
    }

    // Internal helper that supports `coingecko_days_for` operations.
    fn coingecko_days_for(interval: &str, limit: i32) -> &'static str {
        let capped_limit = limit.max(1);
        match interval {
            "1m" | "5m" | "15m" | "1h" => {
                if capped_limit <= 24 {
                    "1"
                } else if capped_limit <= 168 {
                    "7"
                } else {
                    "30"
                }
            }
            "4h" => {
                if capped_limit <= 42 {
                    "7"
                } else {
                    "30"
                }
            }
            "1d" => {
                if capped_limit <= 7 {
                    "7"
                } else if capped_limit <= 30 {
                    "30"
                } else if capped_limit <= 90 {
                    "90"
                } else {
                    "365"
                }
            }
            _ => "30",
        }
    }

    // Internal helper that supports `synthetic_flat_ohlcv` operations.
    fn synthetic_flat_ohlcv(
        &self,
        symbol: &str,
        interval: &str,
        len: usize,
        price: Decimal,
    ) -> Vec<PriceTick> {
        let step_secs = match interval {
            "1m" => 60,
            "5m" => 300,
            "15m" => 900,
            "1h" => 3600,
            "4h" => 14_400,
            "1d" => 86_400,
            _ => 3600,
        };
        let now = Utc::now().timestamp();
        let mut out = Vec::with_capacity(len);
        for i in 0..len {
            let back = (len - 1 - i) as i64;
            let ts = now - (back * step_secs);
            let Some(timestamp) = Utc.timestamp_opt(ts, 0).single() else {
                continue;
            };
            out.push(PriceTick {
                token: symbol.to_string(),
                timestamp,
                open: price,
                high: price,
                low: price,
                close: price,
                volume: Decimal::ZERO,
            });
        }
        out
    }
}

#[derive(Debug, Deserialize)]
struct CoinGeckoPriceResponse {
    #[serde(flatten)]
    prices: HashMap<String, CoinGeckoUsdPrice>,
}

#[derive(Debug, Deserialize)]
struct CoinGeckoUsdPrice {
    usd: Option<f64>,
}

// Internal helper that parses or transforms values for `parse_u256_low`.
fn parse_u256_low(values: &[String]) -> Result<u128> {
    if values.len() < 2 {
        return Err(AppError::Internal("Invalid u256 response".into()));
    }
    let low = parse_felt_u128(&values[0])?;
    let high = parse_felt_u128(&values[1])?;
    if high != 0 {
        return Err(AppError::Internal("u256 value too large".into()));
    }
    Ok(low)
}

// Internal helper that parses or transforms values for `parse_felt_u128`.
fn parse_felt_u128(value: &str) -> Result<u128> {
    if let Some(stripped) = value.strip_prefix("0x") {
        u128::from_str_radix(stripped, 16)
            .map_err(|e| AppError::Internal(format!("Invalid felt hex: {}", e)))
    } else {
        value
            .parse::<u128>()
            .map_err(|e| AppError::Internal(format!("Invalid felt dec: {}", e)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    #[test]
    // Internal helper that supports `candle_start_time_rounds_down` operations.
    fn candle_start_time_rounds_down() {
        // Memastikan waktu dibulatkan ke interval terdekat ke bawah
        let time = Utc.with_ymd_and_hms(2024, 1, 1, 10, 37, 45).unwrap();
        let rounded = candle_start_time(time, "15m");
        assert_eq!(rounded.minute(), 30);
        assert_eq!(rounded.second(), 0);
    }
}
