use crate::services::onchain::{parse_felt, OnchainInvoker};
use crate::{
    config::Config,
    constants::{DEX_EKUBO, ORDER_EXECUTOR_INTERVAL_SECS},
    db::Database,
    error::Result,
    models::{LimitOrder, Transaction},
};
use rust_decimal::prelude::ToPrimitive; // Penting untuk f64 conversion
use sqlx::Row; // Penting untuk .get()
use starknet_core::types::{Call, Felt};
use starknet_core::utils::get_selector_from_name;
use std::sync::Arc;

// Internal helper that checks conditions for `is_order_expired`.
fn is_order_expired(
    now: chrono::DateTime<chrono::Utc>,
    expiry: chrono::DateTime<chrono::Utc>,
) -> bool {
    now > expiry
}

// Internal helper that checks conditions for `should_execute_price`.
fn should_execute_price(current_price: f64, target_price: f64) -> bool {
    current_price <= target_price * 1.005
}

// Internal helper that supports `to_u256_felts` operations.
fn to_u256_felts(value: f64) -> (Felt, Felt) {
    if !value.is_finite() || value <= 0.0 {
        return (Felt::from(0_u128), Felt::from(0_u128));
    }
    let scaled = (value * 1e18_f64).round() as u128;
    (Felt::from(scaled), Felt::from(0_u128))
}

// Internal helper that supports `fallback_price_for` operations.
fn fallback_price_for(token: &str) -> f64 {
    match token.to_ascii_uppercase().as_str() {
        "BTC" | "WBTC" => 65_000.0,
        "ETH" => 1_900.0,
        "STRK" => 0.05,
        "USDT" | "USDC" => 1.0,
        "CAREL" => 1.0,
        _ => 0.0,
    }
}

// Internal helper that parses or transforms values for `normalize_usd_volume`.
fn normalize_usd_volume(usd_in: f64, usd_out: f64) -> f64 {
    let in_valid = usd_in.is_finite() && usd_in > 0.0;
    let out_valid = usd_out.is_finite() && usd_out > 0.0;
    match (in_valid, out_valid) {
        (true, true) => (usd_in + usd_out) / 2.0,
        (true, false) => usd_in,
        (false, true) => usd_out,
        (false, false) => 0.0,
    }
}

pub struct LimitOrderExecutor {
    db: Database,
    config: Config,
}

impl LimitOrderExecutor {
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
        Self { db, config }
    }

    /// Start limit order monitoring loop
    pub async fn start_executor(self: Arc<Self>) {
        tokio::spawn(async move {
            loop {
                if let Err(e) = self.check_and_execute_orders().await {
                    tracing::error!("Limit order execution error: {}", e);
                }

                // Check every 10 seconds
                tokio::time::sleep(tokio::time::Duration::from_secs(
                    ORDER_EXECUTOR_INTERVAL_SECS,
                ))
                .await;
            }
        });
    }

    /// Check all active orders and execute if price matches
    async fn check_and_execute_orders(&self) -> Result<()> {
        let orders = self.get_active_orders().await?;

        for order in orders {
            if is_order_expired(chrono::Utc::now(), order.expiry) {
                self.expire_order(&order.order_id).await?;
                continue;
            }

            if let Ok(should_execute) = self.should_execute_order(&order).await {
                if should_execute {
                    match self.execute_order(&order).await {
                        Ok(_) => {
                            tracing::info!("Executed limit order: {}", order.order_id);
                        }
                        Err(e) => {
                            tracing::error!("Failed to execute order {}: {}", order.order_id, e);
                        }
                    }
                }
            }
        }

        if self.config.is_testnet() {
            if let Ok(stats) = self.get_executor_stats().await {
                tracing::debug!(
                    "Executor stats: active={}, filled={}, expired={}, total={}",
                    stats.active_orders,
                    stats.filled_orders,
                    stats.expired_orders,
                    stats.total_orders
                );
            }
        }

        Ok(())
    }

    /// Get all active limit orders (Ganti query_as! ke query_as)
    async fn get_active_orders(&self) -> Result<Vec<LimitOrder>> {
        let orders = sqlx::query_as::<_, LimitOrder>(
            "SELECT * FROM limit_orders
             WHERE status = 0 
             AND expiry > NOW()
             ORDER BY created_at ASC",
        )
        .fetch_all(self.db.pool())
        .await?;

        Ok(orders)
    }

    // Internal helper that checks conditions for `should_execute_order`.
    async fn should_execute_order(&self, order: &LimitOrder) -> Result<bool> {
        let current_price = self
            .get_current_price(&order.from_token, &order.to_token)
            .await?;

        // Konversi Decimal ke f64 dengan ToPrimitive
        let target_price_f64 = order.price.to_f64().unwrap_or(0.0);

        Ok(should_execute_price(current_price, target_price_f64))
    }

    // Internal helper that fetches data for `get_current_price`.
    async fn get_current_price(&self, _from_token: &str, _to_token: &str) -> Result<f64> {
        Ok(65000.0)
    }

    // Internal helper that supports `latest_price_usd` operations.
    async fn latest_price_usd(&self, token: &str) -> Result<f64> {
        let symbol = token.to_ascii_uppercase();
        let price: Option<f64> = sqlx::query_scalar(
            "SELECT close::FLOAT FROM price_history WHERE token = $1 ORDER BY timestamp DESC LIMIT 1",
        )
        .bind(&symbol)
        .fetch_optional(self.db.pool())
        .await?;
        Ok(price.unwrap_or_else(|| fallback_price_for(&symbol)))
    }

    /// Execute limit order (Ganti query! ke query)
    async fn execute_order(&self, order: &LimitOrder) -> Result<()> {
        let route = self.get_best_execution_route(order).await?;
        let tx_hash = self.execute_swap_on_chain(order, &route).await?;

        let filled_amount = order.amount - order.filled;
        let amount_in = filled_amount.to_f64().unwrap_or(0.0);
        let amount_out = (filled_amount * order.price).to_f64().unwrap_or(0.0);
        let from_price_usd = self.latest_price_usd(&order.from_token).await?;
        let to_price_usd = self.latest_price_usd(&order.to_token).await?;
        let usd_value = normalize_usd_volume(amount_in * from_price_usd, amount_out * to_price_usd);

        self.db.fill_order(&order.order_id, filled_amount).await?;

        sqlx::query(
            "INSERT INTO order_executions (order_id, executor, amount_filled, price_executed, tx_hash)
             VALUES ($1, $2, $3, $4, $5)"
        )
        .bind(&order.order_id)
        .bind("keeper")
        .bind(filled_amount)
        .bind(order.price)
        .bind(&tx_hash)
        .execute(self.db.pool())
        .await?;

        let tx = Transaction {
            tx_hash: tx_hash.clone(),
            block_number: 0,
            user_address: order.owner.clone(),
            tx_type: "limit_order".to_string(),
            token_in: Some(order.from_token.clone()),
            token_out: Some(order.to_token.clone()),
            amount_in: Some(filled_amount),
            amount_out: Some(filled_amount * order.price),
            usd_value: Some(rust_decimal::Decimal::from_f64_retain(usd_value).unwrap_or_default()),
            fee_paid: None,
            points_earned: Some(rust_decimal::Decimal::ZERO),
            timestamp: chrono::Utc::now(),
            processed: false,
        };
        self.db.save_transaction(&tx).await?;

        tracing::info!(
            "Order {} filled: {} {} → {} {} at price {}",
            order.order_id,
            filled_amount,
            order.from_token,
            filled_amount * order.price,
            order.to_token,
            order.price
        );

        Ok(())
    }

    // Internal helper that fetches data for `get_best_execution_route`.
    async fn get_best_execution_route(&self, _order: &LimitOrder) -> Result<String> {
        Ok(DEX_EKUBO.to_string())
    }

    // Internal helper that runs side-effecting logic for `execute_swap_on_chain`.
    async fn execute_swap_on_chain(&self, order: &LimitOrder, _route: &str) -> Result<String> {
        let contract = self.config.limit_order_book_address.trim();
        if contract.is_empty() || contract.starts_with("0x0000") {
            return Err(crate::error::AppError::BadRequest(
                "LIMIT_ORDER_BOOK_ADDRESS is not configured".to_string(),
            ));
        }
        let Some(invoker) = OnchainInvoker::from_config(&self.config).ok().flatten() else {
            return Err(crate::error::AppError::BadRequest(
                "Backend on-chain invoker is not configured".to_string(),
            ));
        };

        let to = parse_felt(contract)?;
        let selector = get_selector_from_name("execute_limit_order")
            .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
        let order_id = parse_felt(&order.order_id)?;
        let order_value = (order.amount * order.price).to_f64().unwrap_or(0.0);
        let amount_u256 = to_u256_felts(order_value);
        let call = Call {
            to,
            selector,
            calldata: vec![order_id, amount_u256.0, amount_u256.1],
        };
        let tx_hash = invoker.invoke(call).await?;
        Ok(tx_hash.to_string())
    }

    // Internal helper that supports `expire_order` operations.
    async fn expire_order(&self, order_id: &str) -> Result<()> {
        sqlx::query(
            "UPDATE limit_orders
             SET status = 4
             WHERE order_id = $1",
        )
        .bind(order_id)
        .execute(self.db.pool())
        .await?;

        tracing::info!("Order {} expired", order_id);
        Ok(())
    }

    /// Get executor statistics (Ganti query! ke query)
    pub async fn get_executor_stats(&self) -> Result<ExecutorStats> {
        let row = sqlx::query(
            "SELECT 
                COUNT(*) FILTER (WHERE status = 0) as active_orders,
                COUNT(*) FILTER (WHERE status = 2) as filled_orders,
                COUNT(*) FILTER (WHERE status = 4) as expired_orders,
                COUNT(*) as total_orders
             FROM limit_orders",
        )
        .fetch_one(self.db.pool())
        .await?;

        Ok(ExecutorStats {
            active_orders: row.get::<Option<i64>, _>("active_orders").unwrap_or(0),
            filled_orders: row.get::<Option<i64>, _>("filled_orders").unwrap_or(0),
            expired_orders: row.get::<Option<i64>, _>("expired_orders").unwrap_or(0),
            total_orders: row.get::<Option<i64>, _>("total_orders").unwrap_or(0),
        })
    }
}

#[derive(Debug, serde::Serialize)]
pub struct ExecutorStats {
    pub active_orders: i64,
    pub filled_orders: i64,
    pub expired_orders: i64,
    pub total_orders: i64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    #[test]
    // Internal helper that checks conditions for `is_order_expired_detects_past`.
    fn is_order_expired_detects_past() {
        // Memastikan order dianggap expired jika sekarang lebih besar dari expiry
        let now = Utc.timestamp_opt(2_000, 0).unwrap();
        let expiry = Utc.timestamp_opt(1_000, 0).unwrap();
        assert!(is_order_expired(now, expiry));
    }

    #[test]
    // Internal helper that checks conditions for `should_execute_price_allows_small_slippage`.
    fn should_execute_price_allows_small_slippage() {
        // Memastikan toleransi 0.5% diterapkan
        assert!(should_execute_price(100.0, 100.0));
        assert!(should_execute_price(100.4, 100.0));
        assert!(!should_execute_price(101.0, 100.0));
    }
}
