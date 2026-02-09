use crate::{config::Config, constants::{DEX_EKUBO, ORDER_EXECUTOR_INTERVAL_SECS, POINTS_PER_USD_SWAP}, db::Database, error::Result, models::{LimitOrder, Transaction}};
use std::sync::Arc;
use sqlx::Row; // Penting untuk .get()
use rust_decimal::prelude::ToPrimitive; // Penting untuk f64 conversion

fn is_order_expired(now: chrono::DateTime<chrono::Utc>, expiry: chrono::DateTime<chrono::Utc>) -> bool {
    now > expiry
}

fn should_execute_price(current_price: f64, target_price: f64) -> bool {
    current_price <= target_price * 1.005
}

pub struct LimitOrderExecutor {
    db: Database,
    config: Config,
}

impl LimitOrderExecutor {
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
                tokio::time::sleep(tokio::time::Duration::from_secs(ORDER_EXECUTOR_INTERVAL_SECS)).await;
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
                            tracing::error!(
                                "Failed to execute order {}: {}",
                                order.order_id,
                                e
                            );
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
             ORDER BY created_at ASC"
        )
        .fetch_all(self.db.pool())
        .await?;

        Ok(orders)
    }

    async fn should_execute_order(&self, order: &LimitOrder) -> Result<bool> {
        let current_price = self.get_current_price(&order.from_token, &order.to_token).await?;
        
        // Konversi Decimal ke f64 dengan ToPrimitive
        let target_price_f64 = order.price.to_f64().unwrap_or(0.0);

        Ok(should_execute_price(current_price, target_price_f64))
    }

    async fn get_current_price(&self, _from_token: &str, _to_token: &str) -> Result<f64> {
        Ok(65000.0)
    }

    /// Execute limit order (Ganti query! ke query)
    async fn execute_order(&self, order: &LimitOrder) -> Result<()> {
        let route = self.get_best_execution_route(order).await?;
        let tx_hash = self.execute_swap_on_chain(order, &route).await?;

        let filled_amount = order.amount - order.filled;
        let amount_in = filled_amount.to_f64().unwrap_or(0.0);
        let _amount_out = (filled_amount * order.price).to_f64().unwrap_or(0.0);
        let points = amount_in * POINTS_PER_USD_SWAP;

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
            usd_value: Some(rust_decimal::Decimal::from_f64_retain(amount_in).unwrap_or_default()),
            fee_paid: None,
            points_earned: Some(rust_decimal::Decimal::from_f64_retain(points).unwrap_or_default()),
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

    async fn get_best_execution_route(&self, _order: &LimitOrder) -> Result<String> {
        Ok(DEX_EKUBO.to_string())
    }

    async fn execute_swap_on_chain(&self, _order: &LimitOrder, _route: &str) -> Result<String> {
        let tx_hash = format!("0x{}", hex::encode(&rand::random::<[u8; 32]>()));
        Ok(tx_hash)
    }

    async fn expire_order(&self, order_id: &str) -> Result<()> {
        sqlx::query(
            "UPDATE limit_orders
             SET status = 4
             WHERE order_id = $1"
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
             FROM limit_orders"
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
    fn is_order_expired_detects_past() {
        // Memastikan order dianggap expired jika sekarang lebih besar dari expiry
        let now = Utc.timestamp_opt(2_000, 0).unwrap();
        let expiry = Utc.timestamp_opt(1_000, 0).unwrap();
        assert!(is_order_expired(now, expiry));
    }

    #[test]
    fn should_execute_price_allows_small_slippage() {
        // Memastikan toleransi 0.5% diterapkan
        assert!(should_execute_price(100.0, 100.0));
        assert!(should_execute_price(100.4, 100.0));
        assert!(!should_execute_price(101.0, 100.0));
    }
}
