use crate::{db::Database, error::Result, models::{Transaction, PaginatedResponse}};
use chrono::{DateTime, Utc};
use sqlx::Row; // PENTING: Import ini untuk memperbaiki error try_get

pub struct TransactionHistoryService {
    db: Database,
}

impl TransactionHistoryService {
    pub fn new(db: Database) -> Self {
        Self { db }
    }

    /// Get user transaction history with pagination and filters
    pub async fn get_user_history(
        &self,
        user_address: &str,
        tx_type: Option<String>,
        from_date: Option<DateTime<Utc>>,
        to_date: Option<DateTime<Utc>>,
        page: i32,
        limit: i32,
    ) -> Result<PaginatedResponse<Transaction>> {
        let offset = (page - 1) * limit;

        let mut query = String::from("SELECT * FROM transactions WHERE user_address = $1");
        let mut param_count = 2;

        if tx_type.is_some() {
            query.push_str(&format!(" AND tx_type = ${}", param_count));
            param_count += 1;
        }
        if from_date.is_some() {
            query.push_str(&format!(" AND timestamp >= ${}", param_count));
            param_count += 1;
        }
        if to_date.is_some() {
            query.push_str(&format!(" AND timestamp <= ${}", param_count));
            param_count += 1;
        }

        query.push_str(" ORDER BY timestamp DESC");
        query.push_str(&format!(" LIMIT ${} OFFSET ${}", param_count, param_count + 1));

        // Gunakan sqlx::query_as (Runtime) bukan macro query_as!
        let mut query_builder = sqlx::query_as::<_, Transaction>(&query);
        query_builder = query_builder.bind(user_address);

        if let Some(ref t) = tx_type { query_builder = query_builder.bind(t); }
        if let Some(ref fd) = from_date { query_builder = query_builder.bind(fd); }
        if let Some(ref td) = to_date { query_builder = query_builder.bind(td); }

        query_builder = query_builder.bind(limit as i64);
        query_builder = query_builder.bind(offset as i64);

        let transactions = query_builder.fetch_all(self.db.pool()).await?;
        let total = self.get_total_count(user_address, tx_type, from_date, to_date).await?;

        Ok(PaginatedResponse {
            items: transactions,
            page,
            limit,
            total,
        })
    }

    async fn get_total_count(
        &self,
        user_address: &str,
        tx_type: Option<String>,
        from_date: Option<DateTime<Utc>>,
        to_date: Option<DateTime<Utc>>,
    ) -> Result<i64> {
        let mut query = String::from("SELECT COUNT(*) as count FROM transactions WHERE user_address = $1");
        let mut param_count = 2;

        if tx_type.is_some() {
            query.push_str(&format!(" AND tx_type = ${}", param_count));
            param_count += 1;
        }
        if from_date.is_some() {
            query.push_str(&format!(" AND timestamp >= ${}", param_count));
            param_count += 1;
        }
        if to_date.is_some() {
            query.push_str(&format!(" AND timestamp <= ${}", param_count));
        }

        let result = sqlx::query(&query)
            .bind(user_address)
            .fetch_one(self.db.pool())
            .await?;

        // Sekarang try_get akan berfungsi karena sqlx::Row sudah di-import
        Ok(result.try_get("count")?)
    }

    pub async fn get_transaction_details(&self, tx_hash: &str) -> Result<Transaction> {
        let tx = sqlx::query_as::<_, Transaction>("SELECT * FROM transactions WHERE tx_hash = $1")
            .bind(tx_hash)
            .fetch_one(self.db.pool())
            .await?;
        Ok(tx)
    }

    pub async fn get_recent_transactions(&self, user_address: &str) -> Result<Vec<Transaction>> {
        let transactions = sqlx::query_as::<_, Transaction>(
            "SELECT * FROM transactions WHERE user_address = $1 ORDER BY timestamp DESC LIMIT 10"
        )
        .bind(user_address)
        .fetch_all(self.db.pool())
        .await?;
        Ok(transactions)
    }

    pub async fn get_user_stats(&self, user_address: &str) -> Result<TransactionStats> {
        let row = sqlx::query(
            "SELECT 
                COUNT(*) as total_transactions,
                SUM(CASE WHEN tx_type = 'swap' THEN 1 ELSE 0 END) as total_swaps,
                SUM(CASE WHEN tx_type = 'bridge' THEN 1 ELSE 0 END) as total_bridges,
                SUM(CASE WHEN tx_type = 'stake' THEN 1 ELSE 0 END) as total_stakes,
                SUM(usd_value) as total_volume_usd,
                SUM(fee_paid) as total_fees_paid,
                SUM(points_earned) as total_points_earned
             FROM transactions
             WHERE user_address = $1"
        )
        .bind(user_address)
        .fetch_one(self.db.pool())
        .await?;

        Ok(TransactionStats {
            total_transactions: row.get::<Option<i64>, _>("total_transactions").unwrap_or(0),
            total_swaps: row.get::<Option<i64>, _>("total_swaps").unwrap_or(0),
            total_bridges: row.get::<Option<i64>, _>("total_bridges").unwrap_or(0),
            total_stakes: row.get::<Option<i64>, _>("total_stakes").unwrap_or(0),
            total_volume_usd: row.get::<Option<rust_decimal::Decimal>, _>("total_volume_usd").unwrap_or_default(),
            total_fees_paid: row.get::<Option<rust_decimal::Decimal>, _>("total_fees_paid").unwrap_or_default(),
            total_points_earned: row.get::<Option<rust_decimal::Decimal>, _>("total_points_earned").unwrap_or_default(),
        })
    }

    pub async fn export_to_csv(
        &self,
        user_address: &str,
        from_date: Option<DateTime<Utc>>,
        to_date: Option<DateTime<Utc>>,
    ) -> Result<String> {
        let transactions = self
            .get_user_history(user_address, None, from_date, to_date, 1, 10000)
            .await?;

        let mut csv = String::from("Date,Type,Token In,Token Out,Amount In,Amount Out,USD Value,Fee,Points\n");

        for tx in transactions.items {
            csv.push_str(&format!(
                "{},{},{},{},{},{},{},{},{}\n",
                tx.timestamp.format("%Y-%m-%d %H:%M:%S"),
                tx.tx_type,
                tx.token_in.unwrap_or_default(),
                tx.token_out.unwrap_or_default(),
                tx.amount_in.map(|v| v.to_string()).unwrap_or_default(),
                tx.amount_out.map(|v| v.to_string()).unwrap_or_default(),
                tx.usd_value.map(|v| v.to_string()).unwrap_or_default(),
                tx.fee_paid.map(|v| v.to_string()).unwrap_or_default(),
                tx.points_earned.map(|v| v.to_string()).unwrap_or_default(),
            ));
        }

        Ok(csv)
    }
}

#[derive(Debug, serde::Serialize)]
pub struct TransactionStats {
    pub total_transactions: i64,
    pub total_swaps: i64,
    pub total_bridges: i64,
    pub total_stakes: i64,
    pub total_volume_usd: rust_decimal::Decimal,
    pub total_fees_paid: rust_decimal::Decimal,
    pub total_points_earned: rust_decimal::Decimal,
}
