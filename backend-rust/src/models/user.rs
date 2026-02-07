use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;

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
    pub token: String, // BTC, STRK, CAREL
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

#[derive(Debug, Deserialize)]
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
}

// ==================== BRIDGE ====================
#[derive(Debug, Deserialize)]
pub struct BridgeQuoteRequest {
    pub from_chain: String,
    pub to_chain: String,
    pub token: String,
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
pub struct CreateLimitOrderRequest {
    pub from_token: String,
    pub to_token: String,
    pub amount: String,
    pub price: String,
    pub expiry: String, // "1d", "7d", "30d"
    pub recipient: Option<String>,
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
