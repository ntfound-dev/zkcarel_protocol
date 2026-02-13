// src/models/mod.rs
pub mod user;

// Re-export commonly used types from user.rs so other modules can use `crate::models::X`
pub use user::{
    ApiResponse,
    BridgeQuoteRequest,
    BridgeQuoteResponse,
    CreateLimitOrderRequest,
    FaucetClaim,
    FaucetClaimRequest,
    FaucetClaimResponse,
    LimitOrder,
    LinkedWalletAddress,
    Notification,
    NotificationPreferences,
    OHLCVResponse,
    PaginatedResponse,
    PriceTick,
    SwapQuoteRequest,
    SwapQuoteResponse,
    // add other exports as needed
    Transaction,
    User,
    UserPoints,
    Webhook,
};
