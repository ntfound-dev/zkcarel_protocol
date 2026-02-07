use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    
    #[error("Redis error: {0}")]
    Redis(#[from] redis::RedisError),
    
    #[error("Blockchain RPC error: {0}")]
    BlockchainRPC(String),
    
    #[error("Authentication failed: {0}")]
    AuthError(String),
    
    #[error("Invalid signature")]
    InvalidSignature,
    
    #[error("Insufficient balance")]
    InsufficientBalance,
    
    #[error("Rate limit exceeded")]
    RateLimitExceeded,
    
    #[error("Not found: {0}")]
    NotFound(String),
    
    #[error("Bad request: {0}")]
    BadRequest(String),
    
    #[error("Faucet cooldown active")]
    FaucetCooldown,
    
    #[error("Invalid token")]
    InvalidToken,
    
    #[error("Order not found")]
    OrderNotFound,
    
    #[error("Insufficient liquidity")]
    InsufficientLiquidity,
    
    #[error("Price slippage too high")]
    SlippageTooHigh,
    
    #[error("External API error: {0}")]
    ExternalAPI(String),
    
    #[error("Internal server error: {0}")]
    Internal(String),
}

#[derive(Serialize)]
pub struct ErrorResponse {
    pub success: bool,
    pub error: ErrorDetail,
}

#[derive(Serialize)]
pub struct ErrorDetail {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message) = match self {
            AppError::Database(ref e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "DATABASE_ERROR",
                e.to_string(),
            ),
            AppError::Redis(ref e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "CACHE_ERROR",
                e.to_string(),
            ),
            AppError::AuthError(ref msg) => (
                StatusCode::UNAUTHORIZED,
                "AUTH_ERROR",
                msg.clone(),
            ),
            AppError::InvalidSignature => (
                StatusCode::UNAUTHORIZED,
                "INVALID_SIGNATURE",
                "Signature verification failed".to_string(),
            ),
            AppError::NotFound(ref msg) => (
                StatusCode::NOT_FOUND,
                "NOT_FOUND",
                msg.clone(),
            ),
            AppError::BadRequest(ref msg) => (
                StatusCode::BAD_REQUEST,
                "BAD_REQUEST",
                msg.clone(),
            ),
            AppError::RateLimitExceeded => (
                StatusCode::TOO_MANY_REQUESTS,
                "RATE_LIMIT_EXCEEDED",
                "Too many requests. Please try again later.".to_string(),
            ),
            AppError::FaucetCooldown => (
                StatusCode::TOO_MANY_REQUESTS,
                "FAUCET_COOLDOWN",
                "Please wait before claiming again".to_string(),
            ),
            AppError::InsufficientBalance => (
                StatusCode::BAD_REQUEST,
                "INSUFFICIENT_BALANCE",
                "Insufficient balance for this operation".to_string(),
            ),
            AppError::InsufficientLiquidity => (
                StatusCode::BAD_REQUEST,
                "INSUFFICIENT_LIQUIDITY",
                "Not enough liquidity available".to_string(),
            ),
            AppError::SlippageTooHigh => (
                StatusCode::BAD_REQUEST,
                "SLIPPAGE_TOO_HIGH",
                "Price impact exceeds slippage tolerance".to_string(),
            ),
            _ => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "INTERNAL_ERROR",
                self.to_string(),
            ),
        };

        let body = Json(ErrorResponse {
            success: false,
            error: ErrorDetail {
                code: code.to_string(),
                message,
                details: None,
            },
        });

        (status, body).into_response()
    }
}

pub type Result<T> = std::result::Result<T, AppError>;