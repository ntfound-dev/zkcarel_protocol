use crate::{
    config::Config,
    constants::PRICE_UPDATER_INTERVAL_SECS,
    constants::token_address_for,
    db::Database,
    error::{AppError, Result},
    models::PriceTick,
};
use crate::indexer::starknet_client::StarknetClient;

use chrono::{DateTime, Timelike, Utc};
use rust_decimal::prelude::{FromPrimitive, ToPrimitive};
use rust_decimal::Decimal;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

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

                tokio::time::sleep(tokio::time::Duration::from_secs(PRICE_UPDATER_INTERVAL_SECS)).await;
            }
        });
    }

    async fn update_prices(&self) -> Result<()> {
        let tokens = ["BTC", "ETH", "STRK", "CAREL", "USDT", "USDC"];

        for token in tokens {
            let price = match self.fetch_price_from_oracle(token).await {
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

    async fn fetch_price_from_oracle(&self, token: &str) -> Result<Decimal> {
        let asset_id = self.config.oracle_asset_id_for(token)
            .ok_or_else(|| AppError::NotFound(format!("Missing asset_id for {}", token)))?;
        let token_address = token_address_for(token)
            .ok_or_else(|| AppError::InvalidToken)?;

        let client = StarknetClient::new(self.config.starknet_rpc_url.clone());
        let result = client
            .call_contract(
                &self.config.price_oracle_address,
                "get_price",
                vec![token_address.to_string(), asset_id],
            )
            .await?;

        let price = parse_u256_low(&result)?;
        Decimal::from_u128(price)
            .ok_or_else(|| AppError::Internal("Failed to convert price".into()))
    }

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
        self.db
            .save_price_tick(
                token,
                timestamp,
                open.to_f64().ok_or_else(|| AppError::Internal("open".into()))?,
                high.to_f64().ok_or_else(|| AppError::Internal("high".into()))?,
                low.to_f64().ok_or_else(|| AppError::Internal("low".into()))?,
                close.to_f64().ok_or_else(|| AppError::Internal("close".into()))?,
                0.0,
                interval,
            )
            .await?;

        Ok(())
    }


    pub async fn get_current_price(&self, token: &str) -> Result<Decimal> {
        self.price_cache
            .read()
            .await
            .get(token)
            .copied()
            .ok_or_else(|| AppError::NotFound("Price not found".into()))
    }

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

    async fn calculate_sma(
        &self,
        token: &str,
        interval: &str,
        period: i32,
    ) -> Result<Vec<(DateTime<Utc>, Decimal)>> {
        let candles = self.get_latest_candles(token, interval, period * 2).await?;
        let mut out = vec![];

        for i in period as usize..candles.len() {
            let sum: Decimal = candles[i - period as usize..i].iter().map(|c| c.close).sum();
            out.push((candles[i].timestamp, sum / Decimal::from(period)));
        }

        Ok(out)
    }

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
}

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

fn parse_felt_u128(value: &str) -> Result<u128> {
    if let Some(stripped) = value.strip_prefix("0x") {
        u128::from_str_radix(stripped, 16)
            .map_err(|e| AppError::Internal(format!("Invalid felt hex: {}", e)))
    } else {
        value.parse::<u128>()
            .map_err(|e| AppError::Internal(format!("Invalid felt dec: {}", e)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    #[test]
    fn candle_start_time_rounds_down() {
        // Memastikan waktu dibulatkan ke interval terdekat ke bawah
        let time = Utc.with_ymd_and_hms(2024, 1, 1, 10, 37, 45).unwrap();
        let rounded = candle_start_time(time, "15m");
        assert_eq!(rounded.minute(), 30);
        assert_eq!(rounded.second(), 0);
    }
}
