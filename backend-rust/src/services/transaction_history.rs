use crate::{
    db::Database,
    error::{AppError, Result},
    models::{PaginatedResponse, Transaction},
};
use chrono::{DateTime, Utc};
use sqlx::Row; // PENTING: Import ini untuk memperbaiki error try_get

fn csv_header() -> &'static str {
    "Date,Type,Token In,Token Out,Amount In,Amount Out,USD Value,Fee,Points\n"
}

fn format_csv_row(tx: &Transaction) -> String {
    format!(
        "{},{},{},{},{},{},{},{},{}\n",
        tx.timestamp.format("%Y-%m-%d %H:%M:%S"),
        tx.tx_type,
        tx.token_in.clone().unwrap_or_default(),
        tx.token_out.clone().unwrap_or_default(),
        tx.amount_in.map(|v| v.to_string()).unwrap_or_default(),
        tx.amount_out.map(|v| v.to_string()).unwrap_or_default(),
        tx.usd_value.map(|v| v.to_string()).unwrap_or_default(),
        tx.fee_paid.map(|v| v.to_string()).unwrap_or_default(),
        tx.points_earned.map(|v| v.to_string()).unwrap_or_default(),
    )
}

fn normalize_scope_addresses(user_addresses: &[String]) -> Vec<String> {
    let mut normalized = Vec::new();
    for address in user_addresses {
        let trimmed = address.trim();
        if trimmed.is_empty() {
            continue;
        }
        let lower = trimmed.to_ascii_lowercase();
        if normalized.iter().any(|existing| existing == &lower) {
            continue;
        }
        normalized.push(lower);
    }
    normalized
}

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
        user_addresses: &[String],
        tx_type: Option<String>,
        from_date: Option<DateTime<Utc>>,
        to_date: Option<DateTime<Utc>>,
        page: i32,
        limit: i32,
    ) -> Result<PaginatedResponse<Transaction>> {
        let normalized_addresses = normalize_scope_addresses(user_addresses);
        if normalized_addresses.is_empty() {
            return Err(AppError::BadRequest(
                "No wallet address available for transaction history".to_string(),
            ));
        }
        let offset = (page - 1) * limit;

        let mut query = String::from(
            "SELECT * FROM transactions WHERE LOWER(user_address) = ANY($1) AND COALESCE(is_private, false) = false",
        );
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
        query.push_str(&format!(
            " LIMIT ${} OFFSET ${}",
            param_count,
            param_count + 1
        ));

        // Gunakan sqlx::query_as (Runtime) bukan macro query_as!
        let mut query_builder = sqlx::query_as::<_, Transaction>(&query);
        query_builder = query_builder.bind(normalized_addresses.clone());

        if let Some(ref t) = tx_type {
            query_builder = query_builder.bind(t);
        }
        if let Some(ref fd) = from_date {
            query_builder = query_builder.bind(fd);
        }
        if let Some(ref td) = to_date {
            query_builder = query_builder.bind(td);
        }

        query_builder = query_builder.bind(limit as i64);
        query_builder = query_builder.bind(offset as i64);

        let transactions = query_builder.fetch_all(self.db.pool()).await?;
        let total = self
            .get_total_count(&normalized_addresses, tx_type, from_date, to_date)
            .await?;

        Ok(PaginatedResponse {
            items: transactions,
            page,
            limit,
            total,
        })
    }

    async fn get_total_count(
        &self,
        user_addresses: &[String],
        tx_type: Option<String>,
        from_date: Option<DateTime<Utc>>,
        to_date: Option<DateTime<Utc>>,
    ) -> Result<i64> {
        let normalized_addresses = normalize_scope_addresses(user_addresses);
        if normalized_addresses.is_empty() {
            return Ok(0);
        }
        let mut query = String::from(
            "SELECT COUNT(*) as count FROM transactions WHERE LOWER(user_address) = ANY($1) AND COALESCE(is_private, false) = false",
        );
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

        let mut query_builder = sqlx::query(&query);
        query_builder = query_builder.bind(normalized_addresses);
        if let Some(ref t) = tx_type {
            query_builder = query_builder.bind(t);
        }
        if let Some(ref fd) = from_date {
            query_builder = query_builder.bind(fd);
        }
        if let Some(ref td) = to_date {
            query_builder = query_builder.bind(td);
        }
        let result = query_builder.fetch_one(self.db.pool()).await?;

        // Sekarang try_get akan berfungsi karena sqlx::Row sudah di-import
        Ok(result.try_get("count")?)
    }

    pub async fn get_transaction_details(&self, tx_hash: &str) -> Result<Transaction> {
        self.db
            .get_transaction(tx_hash)
            .await?
            .ok_or_else(|| AppError::NotFound("Transaction not found".to_string()))
    }

    pub async fn get_recent_transactions(&self, user_addresses: &[String]) -> Result<Vec<Transaction>> {
        let normalized_addresses = normalize_scope_addresses(user_addresses);
        if normalized_addresses.is_empty() {
            return Ok(Vec::new());
        }
        let transactions = sqlx::query_as::<_, Transaction>(
            "SELECT * FROM transactions
             WHERE LOWER(user_address) = ANY($1) AND COALESCE(is_private, false) = false
             ORDER BY timestamp DESC LIMIT 10",
        )
        .bind(normalized_addresses)
        .fetch_all(self.db.pool())
        .await?;
        Ok(transactions)
    }

    pub async fn get_user_stats(&self, user_addresses: &[String]) -> Result<TransactionStats> {
        let normalized_addresses = normalize_scope_addresses(user_addresses);
        if normalized_addresses.is_empty() {
            return Ok(TransactionStats {
                total_transactions: 0,
                total_swaps: 0,
                total_bridges: 0,
                total_stakes: 0,
                total_volume_usd: rust_decimal::Decimal::ZERO,
                total_fees_paid: rust_decimal::Decimal::ZERO,
                total_points_earned: rust_decimal::Decimal::ZERO,
            });
        }
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
             WHERE LOWER(user_address) = ANY($1) AND COALESCE(is_private, false) = false",
        )
        .bind(normalized_addresses)
        .fetch_one(self.db.pool())
        .await?;

        Ok(TransactionStats {
            total_transactions: row.get::<Option<i64>, _>("total_transactions").unwrap_or(0),
            total_swaps: row.get::<Option<i64>, _>("total_swaps").unwrap_or(0),
            total_bridges: row.get::<Option<i64>, _>("total_bridges").unwrap_or(0),
            total_stakes: row.get::<Option<i64>, _>("total_stakes").unwrap_or(0),
            total_volume_usd: row
                .get::<Option<rust_decimal::Decimal>, _>("total_volume_usd")
                .unwrap_or_default(),
            total_fees_paid: row
                .get::<Option<rust_decimal::Decimal>, _>("total_fees_paid")
                .unwrap_or_default(),
            total_points_earned: row
                .get::<Option<rust_decimal::Decimal>, _>("total_points_earned")
                .unwrap_or_default(),
        })
    }

    pub async fn export_to_csv(
        &self,
        user_addresses: &[String],
        from_date: Option<DateTime<Utc>>,
        to_date: Option<DateTime<Utc>>,
    ) -> Result<String> {
        let transactions = self
            .get_user_history(user_addresses, None, from_date, to_date, 1, 10000)
            .await?;

        let mut csv = String::from(csv_header());

        for tx in transactions.items {
            csv.push_str(&format_csv_row(&tx));
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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    #[test]
    fn csv_header_starts_with_date() {
        // Memastikan header CSV konsisten
        assert!(csv_header().starts_with("Date,Type"));
    }

    #[test]
    fn format_csv_row_contains_type() {
        // Memastikan baris CSV memuat tipe transaksi
        let tx = Transaction {
            tx_hash: "0x1".to_string(),
            block_number: 1,
            user_address: "0xuser".to_string(),
            tx_type: "swap".to_string(),
            token_in: Some("ETH".to_string()),
            token_out: Some("USDT".to_string()),
            amount_in: None,
            amount_out: None,
            usd_value: None,
            fee_paid: None,
            points_earned: None,
            timestamp: Utc.with_ymd_and_hms(2024, 1, 1, 0, 0, 0).unwrap(),
            processed: false,
        };
        let row = format_csv_row(&tx);
        assert!(row.contains(",swap,"));
    }
}
