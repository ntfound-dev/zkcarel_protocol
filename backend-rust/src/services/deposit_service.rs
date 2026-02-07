use crate::{config::Config, db::Database, error::Result};
use serde::Serialize; // Disederhanakan (menghapus Deserialize yang tidak terpakai)
use rust_decimal::prelude::{ToPrimitive, FromPrimitive}; 
use hex;
use rand; 
use sqlx::Row; // Tambahkan ini untuk akses .get()

pub struct DepositService {
    db: Database,
    config: Config,
}

impl DepositService {
    pub fn new(db: Database, config: Config) -> Self {
        Self { db, config }
    }

    pub async fn create_bank_transfer(&self, user_address: &str, amount: f64, currency: &str) -> Result<DepositInfo> {
        let deposit_id = format!("DEP_BANK_{}", hex::encode(rand::random::<[u8; 16]>()));
        let bank_details = BankDetails {
            account_name: "CAREL Protocol".to_string(),
            account_number: "1234567890".to_string(),
            bank_name: "Example Bank".to_string(),
            reference: deposit_id.clone(),
        };

        let amount_dec = rust_decimal::Decimal::from_f64(amount).unwrap_or(rust_decimal::Decimal::ZERO);
        self.save_deposit_with_decimal(&deposit_id, user_address, amount_dec, currency, "bank_transfer").await?;

        Ok(DepositInfo {
            deposit_id,
            status: "pending".to_string(),
            payment_method: "bank_transfer".to_string(),
            amount,
            currency: currency.to_string(),
            details: serde_json::to_value(bank_details).ok(),
        })
    }

    pub async fn create_qris(&self, user_address: &str, amount: f64) -> Result<DepositInfo> {
        let deposit_id = format!("DEP_QRIS_{}", hex::encode(rand::random::<[u8; 16]>()));
        let qr_data = format!("qris://pay?id={}&amount={}", deposit_id, amount);
        let amount_dec = rust_decimal::Decimal::from_f64(amount).unwrap_or(rust_decimal::Decimal::ZERO);
        
        self.save_deposit_with_decimal(&deposit_id, user_address, amount_dec, "IDR", "qris").await?;

        Ok(DepositInfo {
            deposit_id,
            status: "pending".to_string(),
            payment_method: "qris".to_string(),
            amount,
            currency: "IDR".to_string(),
            details: Some(serde_json::json!({ "qr_code": qr_data, "expires_in": 300 })),
        })
    }

    pub async fn create_card_payment(&self, user_address: &str, amount: f64, currency: &str) -> Result<DepositInfo> {
        let deposit_id = format!("DEP_CARD_{}", hex::encode(rand::random::<[u8; 16]>()));
        let payment_url = format!("https://checkout.stripe.com{}", deposit_id);
        let amount_dec = rust_decimal::Decimal::from_f64(amount).unwrap_or(rust_decimal::Decimal::ZERO);

        self.save_deposit_with_decimal(&deposit_id, user_address, amount_dec, currency, "card").await?;

        Ok(DepositInfo {
            deposit_id,
            status: "pending".to_string(),
            payment_method: "card".to_string(),
            amount,
            currency: currency.to_string(),
            details: Some(serde_json::json!({ "payment_url": payment_url })),
        })
    }

    async fn save_deposit_with_decimal(&self, id: &str, user: &str, amount_dec: rust_decimal::Decimal, currency: &str, method: &str) -> Result<()> {
        // Ganti query! menjadi query (tanpa tanda seru)
        sqlx::query(
            "INSERT INTO deposits (deposit_id, user_address, amount, currency, payment_method, status, created_at)
             VALUES ($1, $2, $3, $4, $5, 'pending', NOW())"
        )
        .bind(id)
        .bind(user)
        .bind(amount_dec)
        .bind(currency)
        .bind(method)
        .execute(self.db.pool())
        .await?;

        Ok(())
    }

    pub async fn get_status(&self, deposit_id: &str) -> Result<DepositInfo> {
        // Ganti query! menjadi query
        let row = sqlx::query(
            "SELECT deposit_id, status, payment_method, amount, currency FROM deposits WHERE deposit_id = $1"
        )
        .bind(deposit_id)
        .fetch_one(self.db.pool())
        .await?;

        Ok(DepositInfo {
            deposit_id: row.get("deposit_id"),
            status: row.get("status"),
            payment_method: row.get("payment_method"),
            amount: row.get::<rust_decimal::Decimal, _>("amount").to_f64().unwrap_or(0.0),
            currency: row.get("currency"),
            details: None,
        })
    }
}

#[derive(Debug, Serialize)]
pub struct DepositInfo {
    pub deposit_id: String,
    pub status: String,
    pub payment_method: String,
    pub amount: f64,
    pub currency: String,
    pub details: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
struct BankDetails {
    account_name: String,
    account_number: String,
    bank_name: String,
    reference: String,
}
