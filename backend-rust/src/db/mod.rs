use sqlx::{postgres::PgPoolOptions, PgPool, Row};
use crate::{config::Config, error::Result, models::*};

#[derive(Clone)]
pub struct Database {
    pool: PgPool,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config(database_url: &str) -> Config {
        Config {
            host: "0.0.0.0".to_string(),
            port: 3000,
            environment: "development".to_string(),
            database_url: database_url.to_string(),
            database_max_connections: 1,
            redis_url: "redis://localhost:6379".to_string(),
            starknet_rpc_url: "http://localhost:5050".to_string(),
            starknet_chain_id: "SN_MAIN".to_string(),
            ethereum_rpc_url: "http://localhost:8545".to_string(),
            carel_token_address: "0x0000000000000000000000000000000000000001".to_string(),
            snapshot_distributor_address: "0x0000000000000000000000000000000000000002".to_string(),
            point_storage_address: "0x0000000000000000000000000000000000000003".to_string(),
            price_oracle_address: "0x0000000000000000000000000000000000000004".to_string(),
            limit_order_book_address: "0x0000000000000000000000000000000000000005".to_string(),
            faucet_wallet_private_key: None,
            faucet_btc_amount: None,
            faucet_strk_amount: None,
            faucet_carel_amount: None,
            faucet_cooldown_hours: None,
            backend_private_key: "test_private".to_string(),
            backend_public_key: "test_public".to_string(),
            jwt_secret: "test_secret".to_string(),
            jwt_expiry_hours: 24,
            openai_api_key: None,
            twitter_bearer_token: None,
            telegram_bot_token: None,
            discord_bot_token: None,
            stripe_secret_key: None,
            moonpay_api_key: None,
            rate_limit_public: 1,
            rate_limit_authenticated: 1,
            cors_allowed_origins: "*".to_string(),
        }
    }

    #[tokio::test]
    async fn database_new_returns_error_on_invalid_url() {
        let config = test_config("not-a-url");
        let result = Database::new(&config).await;
        assert!(result.is_err());
    }
}

impl Database {
    pub async fn new(config: &Config) -> anyhow::Result<Self> {
        let pool = PgPoolOptions::new()
            .max_connections(config.database_max_connections)
            .connect(&config.database_url)
            .await?;

        Ok(Self { pool })
    }

    pub async fn run_migrations(&self) -> anyhow::Result<()> {
        // migrations harus berada di crate root: ./migrations
        sqlx::migrate!("./migrations")
            .run(&self.pool)
            .await?;
        Ok(())
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }
}

// ==================== USER QUERIES ====================
impl Database {
    pub async fn create_user(&self, address: &str) -> Result<()> {
        sqlx::query(
            "INSERT INTO users (address) VALUES ($1)
             ON CONFLICT DO NOTHING",
        )
        .bind(address)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_user(&self, address: &str) -> Result<Option<User>> {
        let row = sqlx::query_as::<_, User>(
            "SELECT * FROM users WHERE address = $1",
        )
        .bind(address)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    pub async fn update_last_active(&self, address: &str) -> Result<()> {
        sqlx::query(
            "UPDATE users SET last_active = NOW() WHERE address = $1",
        )
        .bind(address)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

// ==================== POINTS QUERIES ====================
impl Database {
    pub async fn get_user_points(
        &self,
        address: &str,
        epoch: i64,
    ) -> Result<Option<UserPoints>> {
        let points = sqlx::query_as::<_, UserPoints>(
            "SELECT * FROM points WHERE user_address = $1 AND epoch = $2",
        )
        .bind(address)
        .bind(epoch)
        .fetch_optional(&self.pool)
        .await?;
        Ok(points)
    }

    pub async fn create_or_update_points(
        &self,
        address: &str,
        epoch: i64,
        swap_points: rust_decimal::Decimal,
        bridge_points: rust_decimal::Decimal,
        stake_points: rust_decimal::Decimal,
    ) -> Result<()> {
        let total = swap_points + bridge_points + stake_points;

        // Upsert yang menambah nilai yang sudah ada (accumulate deltas)
        sqlx::query(
            r#"
            INSERT INTO points
                (user_address, epoch, swap_points, bridge_points, stake_points, total_points)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (user_address, epoch) DO UPDATE
            SET swap_points   = points.swap_points   + EXCLUDED.swap_points,
                bridge_points = points.bridge_points + EXCLUDED.bridge_points,
                stake_points  = points.stake_points  + EXCLUDED.stake_points,
                total_points  = points.total_points  + EXCLUDED.total_points,
                updated_at    = NOW()
            "#,
        )
        .bind(address)
        .bind(epoch)
        .bind(swap_points)
        .bind(bridge_points)
        .bind(stake_points)
        .bind(total)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

// ==================== TRANSACTION QUERIES ====================
impl Database {
    pub async fn save_transaction(&self, tx: &Transaction) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO transactions
                (tx_hash, block_number, user_address, tx_type,
                 token_in, token_out, amount_in, amount_out,
                 usd_value, fee_paid, points_earned, timestamp)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
            ON CONFLICT (tx_hash) DO NOTHING
            "#,
        )
        .bind(&tx.tx_hash)
        .bind(tx.block_number)
        .bind(&tx.user_address)
        .bind(&tx.tx_type)
        .bind(&tx.token_in)
        .bind(&tx.token_out)
        .bind(tx.amount_in)
        .bind(tx.amount_out)
        .bind(tx.usd_value)
        .bind(tx.fee_paid)
        .bind(tx.points_earned)
        .bind(tx.timestamp)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_transaction(&self, tx_hash: &str) -> Result<Option<Transaction>> {
        let tx = sqlx::query_as::<_, Transaction>(
            "SELECT * FROM transactions WHERE tx_hash = $1",
        )
        .bind(tx_hash)
        .fetch_optional(&self.pool)
        .await?;
        Ok(tx)
    }
}

// ==================== FAUCET QUERIES ====================
impl Database {
    pub async fn can_claim_faucet(
        &self,
        address: &str,
        token: &str,
        cooldown_hours: i64,
    ) -> Result<bool> {
        // gunakan query_scalar untuk mendapatkan satu boolean langsung
        let recent_claim: bool = sqlx::query_scalar(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM faucet_claims
                WHERE user_address = $1
                  AND token = $2
                  AND claimed_at >= NOW() - make_interval(hours => $3)
            )
            "#,
        )
        .bind(address)
        .bind(token)
        .bind(cooldown_hours)
        .fetch_one(&self.pool)
        .await?;

        Ok(!recent_claim)
    }

    pub async fn record_faucet_claim(
        &self,
        address: &str,
        token: &str,
        amount: f64,
        tx_hash: &str,
    ) -> Result<()> {
        // lebih aman: gunakan from_f64 dan handle Option di caller jika perlu
        let amount_dec = rust_decimal::Decimal::from_f64_retain(amount);

        sqlx::query(
            "INSERT INTO faucet_claims (user_address, token, amount, tx_hash)
             VALUES ($1, $2, $3, $4)",
        )
        .bind(address)
        .bind(token)
        .bind(amount_dec)
        .bind(tx_hash)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

// ==================== NOTIFICATION QUERIES ====================
impl Database {
    pub async fn create_notification(
        &self,
        user: &str,
        notif_type: &str,
        title: &str,
        message: &str,
    ) -> Result<i64> {
        // runtime query + ambil id dari PgRow
        let row = sqlx::query(
            "INSERT INTO notifications (user_address, notif_type, title, message)
             VALUES ($1,$2,$3,$4)
             RETURNING id",
        )
        .bind(user)
        .bind(notif_type)
        .bind(title)
        .bind(message)
        .fetch_one(&self.pool)
        .await?;

        // ambil kolom id
        let id: i64 = row.try_get("id")?;
        Ok(id)
    }

    pub async fn get_user_notifications(
        &self,
        address: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Notification>> {
        let notifications = sqlx::query_as::<_, Notification>(
            "SELECT * FROM notifications
             WHERE user_address = $1
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3",
        )
        .bind(address)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;

        Ok(notifications)
    }

    pub async fn mark_notification_read(&self, id: i64, user: &str) -> Result<()> {
        sqlx::query(
            "UPDATE notifications SET read = true WHERE id = $1 AND user_address = $2",
        )
        .bind(id)
        .bind(user)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

// ==================== PRICE HISTORY QUERIES ====================
impl Database {
    pub async fn save_price_tick(
        &self,
        token: &str,
        timestamp: chrono::DateTime<chrono::Utc>,
        open: f64,
        high: f64,
        low: f64,
        close: f64,
        volume: f64,
        interval: &str,
    ) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO price_history
              (token, timestamp, open, high, low, close, volume, interval)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT (token, timestamp, interval) DO UPDATE
            SET high   = GREATEST(price_history.high, $4),
                low    = LEAST(price_history.low,  $5),
                close  = $6,
                volume = price_history.volume + $7
            "#,
        )
        .bind(token)
        .bind(timestamp)
        .bind(rust_decimal::Decimal::from_f64_retain(open))
        .bind(rust_decimal::Decimal::from_f64_retain(high))
        .bind(rust_decimal::Decimal::from_f64_retain(low))
        .bind(rust_decimal::Decimal::from_f64_retain(close))
        .bind(rust_decimal::Decimal::from_f64_retain(volume))
        .bind(interval)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_price_history(
        &self,
        token: &str,
        interval: &str,
        from: chrono::DateTime<chrono::Utc>,
        to: chrono::DateTime<chrono::Utc>,
    ) -> Result<Vec<PriceTick>> {
        let rows = sqlx::query_as::<_, PriceTick>(
            r#"
            SELECT
                token,
                timestamp,
                open   as "open",
                high   as "high",
                low    as "low",
                close  as "close",
                volume as "volume"
            FROM price_history
            WHERE token = $1
              AND interval = $2
              AND timestamp BETWEEN $3 AND $4
            ORDER BY timestamp ASC
            "#,
        )
        .bind(token)
        .bind(interval)
        .bind(from)
        .bind(to)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows)
    }
}

// ==================== LIMIT ORDER QUERIES ====================
impl Database {
    pub async fn create_limit_order(&self, order: &LimitOrder) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO limit_orders
                (order_id, owner, from_token, to_token, amount, price, expiry, recipient, status)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            "#,
        )
        .bind(&order.order_id)
        .bind(&order.owner)
        .bind(&order.from_token)
        .bind(&order.to_token)
        .bind(order.amount)
        .bind(order.price)
        .bind(order.expiry)
        .bind(&order.recipient)
        .bind(order.status)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_limit_order(&self, order_id: &str) -> Result<Option<LimitOrder>> {
        let order = sqlx::query_as::<_, LimitOrder>(
            "SELECT * FROM limit_orders WHERE order_id = $1",
        )
        .bind(order_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(order)
    }

    pub async fn get_active_orders(&self) -> Result<Vec<LimitOrder>> {
        let orders = sqlx::query_as::<_, LimitOrder>(
            "SELECT * FROM limit_orders WHERE status = 0 AND expiry > NOW() ORDER BY created_at ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(orders)
    }

    pub async fn update_order_status(&self, order_id: &str, status: i16) -> Result<()> {
        sqlx::query("UPDATE limit_orders SET status = $1 WHERE order_id = $2")
            .bind(status)
            .bind(order_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn fill_order(
        &self,
        order_id: &str,
        amount: rust_decimal::Decimal,
    ) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE limit_orders
            SET filled = filled + $1,
                status = CASE WHEN filled + $1 >= amount THEN 2 ELSE 1 END
            WHERE order_id = $2
            "#,
        )
        .bind(amount)
        .bind(order_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
