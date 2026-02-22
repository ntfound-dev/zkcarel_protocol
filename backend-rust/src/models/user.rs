use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

// ==================== USER ====================
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub address: String,
    pub referrer: Option<String>,
    pub display_name: Option<String>,
    pub twitter_username: Option<String>,
    pub telegram_username: Option<String>,
    pub discord_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_active: Option<DateTime<Utc>>,
    pub total_volume_usd: Decimal,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct LinkedWalletAddress {
    pub user_address: String,
    pub chain: String,
    pub wallet_address: String,
    pub provider: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ==================== POINTS ====================
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserPoints {
    pub user_address: String,
    pub epoch: i64,
    pub swap_points: Decimal,
    pub bridge_points: Decimal,
    pub stake_points: Decimal,
    pub referral_points: Decimal,
    pub social_points: Decimal,
    pub total_points: Decimal,
    pub staking_multiplier: Decimal,
    pub nft_boost: bool,
    pub wash_trading_flagged: bool,
    pub finalized: bool,
}

// ==================== TRANSACTION ====================
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Transaction {
    pub tx_hash: String,
    pub block_number: i64,
    pub user_address: String,
    pub tx_type: String, // swap/bridge/stake/unstake/claim
    pub token_in: Option<String>,
    pub token_out: Option<String>,
    pub amount_in: Option<Decimal>,
    pub amount_out: Option<Decimal>,
    pub usd_value: Option<Decimal>,
    pub fee_paid: Option<Decimal>,
    pub points_earned: Option<Decimal>,
    pub timestamp: DateTime<Utc>,
    pub processed: bool,
}

// ==================== FAUCET ====================
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FaucetClaim {
    pub user_address: String,
    pub token: String,
    pub amount: f64,
    pub tx_hash: String,
    pub claimed_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct FaucetClaimRequest {
    pub token: String, // CAREL, USDT, USDC
}

#[derive(Debug, Serialize)]
pub struct FaucetClaimResponse {
    pub token: String,
    pub amount: f64,
    pub tx_hash: String,
    pub next_claim_in: i64, // seconds
}

// ==================== NOTIFICATION ====================
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Notification {
    pub id: i64,
    pub user_address: String,
    #[sqlx(rename = "type")]
    pub notif_type: String,
    pub title: String,
    pub message: String,
    pub data: Option<serde_json::Value>,
    pub read: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow, Default)]
pub struct NotificationPreferences {
    pub email_enabled: bool,
    pub push_enabled: bool,
    pub telegram_enabled: bool,
    pub discord_enabled: bool,
}

// ==================== SWAP ====================
#[derive(Debug, Deserialize)]
pub struct SwapQuoteRequest {
    pub from_token: String,
    pub to_token: String,
    pub amount: String,
    pub slippage: f64,
    pub mode: String, // private/transparent
}

#[derive(Debug, Serialize)]
pub struct SwapQuoteResponse {
    pub from_amount: String,
    pub to_amount: String,
    pub rate: String,
    pub price_impact: String,
    pub fee: String,
    pub fee_usd: String,
    pub route: Vec<String>,
    pub estimated_gas: String,
    pub estimated_time: String,
    pub onchain_calls: Option<Vec<StarknetWalletCall>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StarknetWalletCall {
    pub contract_address: String,
    pub entrypoint: String,
    pub calldata: Vec<String>,
}

// ==================== BRIDGE ====================
#[derive(Debug, Deserialize)]
pub struct BridgeQuoteRequest {
    pub from_chain: String,
    pub to_chain: String,
    pub token: String,
    pub to_token: Option<String>,
    pub amount: String,
}

#[derive(Debug, Serialize)]
pub struct BridgeQuoteResponse {
    pub from_chain: String,
    pub to_chain: String,
    pub amount: String,
    pub estimated_receive: String,
    pub fee: String,
    pub estimated_time: String,
    pub bridge_provider: String,
}

// ==================== LIMIT ORDER ====================
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct LimitOrder {
    pub order_id: String,
    pub owner: String,
    pub from_token: String,
    pub to_token: String,
    pub amount: Decimal,
    pub filled: Decimal,
    pub price: Decimal,
    pub expiry: DateTime<Utc>,
    pub recipient: Option<String>,
    pub status: i16, // 0=active, 1=partial, 2=filled, 3=cancelled, 4=expired
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct PrivacyVerificationPayload {
    pub verifier: Option<String>,
    pub nullifier: Option<String>,
    pub commitment: Option<String>,
    pub proof: Option<Vec<String>>,
    pub public_inputs: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct CreateLimitOrderRequest {
    pub from_token: String,
    pub to_token: String,
    pub amount: String,
    pub price: String,
    pub expiry: String, // "1d", "7d", "30d"
    pub recipient: Option<String>,
    pub client_order_id: Option<String>,
    pub onchain_tx_hash: Option<String>,
    pub hide_balance: Option<bool>,
    pub privacy: Option<PrivacyVerificationPayload>,
}

// ==================== PRICE ====================
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PriceTick {
    pub token: String,
    pub timestamp: DateTime<Utc>,
    pub open: Decimal,
    pub high: Decimal,
    pub low: Decimal,
    pub close: Decimal,
    pub volume: Decimal,
}

#[derive(Debug, Serialize)]
pub struct OHLCVResponse {
    pub token: String,
    pub interval: String,
    pub data: Vec<PriceTick>,
}

// ==================== WEBHOOK ====================
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Webhook {
    pub id: i64,
    pub user_address: String,
    pub url: String,
    pub events: Vec<String>,
    pub secret: String,
    pub active: bool,
    pub created_at: DateTime<Utc>,
}

// ==================== API RESPONSE ====================
#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: T,
}

impl<T> ApiResponse<T> {
    /// Handles `success` logic.
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
    pub fn success(data: T) -> Self {
        Self {
            success: true,
            data,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct PaginatedResponse<T> {
    pub items: Vec<T>,
    pub page: i32,
    pub limit: i32,
    pub total: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    // Internal helper that supports `api_response_success_sets_flag` operations.
    fn api_response_success_sets_flag() {
        // Memastikan helper ApiResponse::success mengisi flag sukses
        let response = ApiResponse::success("ok");
        assert!(response.success);
        assert_eq!(response.data, "ok");
    }

    #[test]
    // Internal helper that supports `notification_preferences_default_false` operations.
    fn notification_preferences_default_false() {
        // Memastikan default preferensi notifikasi bernilai false
        let prefs = NotificationPreferences::default();
        assert!(!prefs.email_enabled);
        assert!(!prefs.push_enabled);
        assert!(!prefs.telegram_enabled);
        assert!(!prefs.discord_enabled);
    }
}
