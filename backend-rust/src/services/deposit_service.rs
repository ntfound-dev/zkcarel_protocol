use crate::{
    config::Config,
    db::Database,
    error::{AppError, Result},
};
use hex;
use rand;
use rust_decimal::prelude::{FromPrimitive, ToPrimitive};
use serde::Serialize; // Disederhanakan (menghapus Deserialize yang tidak terpakai)
use sqlx::Row; // Tambahkan ini untuk akses .get()

fn build_bank_details(deposit_id: &str) -> BankDetails {
    BankDetails {
        account_name: "CAREL Protocol".to_string(),
        account_number: "1234567890".to_string(),
        bank_name: "Example Bank".to_string(),
        reference: deposit_id.to_string(),
    }
}

fn build_qris_payload(deposit_id: &str, amount: f64) -> String {
    format!("qris://pay?id={}&amount={}", deposit_id, amount)
}

fn build_stripe_url(deposit_id: &str) -> String {
    format!("https://checkout.stripe.com{}", deposit_id)
}

pub struct DepositService {
    db: Database,
    config: Config,
}

impl DepositService {
    pub fn new(db: Database, config: Config) -> Self {
        Self { db, config }
    }

    pub async fn create_bank_transfer(
        &self,
        user_address: &str,
        amount: f64,
        currency: &str,
    ) -> Result<DepositInfo> {
        let deposit_id = format!("DEP_BANK_{}", hex::encode(rand::random::<[u8; 16]>()));
        let bank_details = build_bank_details(&deposit_id);

        let amount_dec =
            rust_decimal::Decimal::from_f64(amount).unwrap_or(rust_decimal::Decimal::ZERO);
        self.save_deposit_with_decimal(
            &deposit_id,
            user_address,
            amount_dec,
            currency,
            "bank_transfer",
        )
        .await?;

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
        if self.config.moonpay_api_key.is_none() {
            return Err(AppError::ExternalAPI(
                "Moonpay API key not configured".into(),
            ));
        }

        let deposit_id = format!("DEP_QRIS_{}", hex::encode(rand::random::<[u8; 16]>()));
        let qr_data = build_qris_payload(&deposit_id, amount);
        let amount_dec =
            rust_decimal::Decimal::from_f64(amount).unwrap_or(rust_decimal::Decimal::ZERO);

        self.save_deposit_with_decimal(&deposit_id, user_address, amount_dec, "IDR", "qris")
            .await?;

        Ok(DepositInfo {
            deposit_id,
            status: "pending".to_string(),
            payment_method: "qris".to_string(),
            amount,
            currency: "IDR".to_string(),
            details: Some(serde_json::json!({ "qr_code": qr_data, "expires_in": 300 })),
        })
    }

    pub async fn create_card_payment(
        &self,
        user_address: &str,
        amount: f64,
        currency: &str,
    ) -> Result<DepositInfo> {
        if self.config.stripe_secret_key.is_none() {
            return Err(AppError::ExternalAPI(
                "Stripe secret key not configured".into(),
            ));
        }

        let deposit_id = format!("DEP_CARD_{}", hex::encode(rand::random::<[u8; 16]>()));
        let payment_url = build_stripe_url(&deposit_id);
        let amount_dec =
            rust_decimal::Decimal::from_f64(amount).unwrap_or(rust_decimal::Decimal::ZERO);

        self.save_deposit_with_decimal(&deposit_id, user_address, amount_dec, currency, "card")
            .await?;

        Ok(DepositInfo {
            deposit_id,
            status: "pending".to_string(),
            payment_method: "card".to_string(),
            amount,
            currency: currency.to_string(),
            details: Some(serde_json::json!({ "payment_url": payment_url })),
        })
    }

    async fn save_deposit_with_decimal(
        &self,
        id: &str,
        user: &str,
        amount_dec: rust_decimal::Decimal,
        currency: &str,
        method: &str,
    ) -> Result<()> {
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
            amount: row
                .get::<rust_decimal::Decimal, _>("amount")
                .to_f64()
                .unwrap_or(0.0),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_bank_details_uses_reference() {
        // Memastikan reference mengikuti deposit_id
        let details = build_bank_details("DEP_TEST");
        assert_eq!(details.reference, "DEP_TEST");
    }

    #[test]
    fn build_qris_payload_formats_string() {
        // Memastikan payload QRIS mengandung id dan amount
        let payload = build_qris_payload("DEP_QRIS_TEST", 10.5);
        assert!(payload.contains("DEP_QRIS_TEST"));
        assert!(payload.contains("10.5"));
    }

    #[test]
    fn build_stripe_url_appends_id() {
        // Memastikan URL stripe berisi deposit_id
        let url = build_stripe_url("DEP_CARD_TEST");
        assert_eq!(url, "https://checkout.stripe.comDEP_CARD_TEST");
    }
}
