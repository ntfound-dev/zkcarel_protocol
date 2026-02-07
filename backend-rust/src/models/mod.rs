// src/models/mod.rs
pub mod user;

// Re-export commonly used types from user.rs so other modules can use `crate::models::X`
pub use user::{
    User,
    UserPoints,
    Transaction,
    //FaucetClaim,
    FaucetClaimRequest,
    FaucetClaimResponse,
    Notification,
    //NotificationPreferences,
    LimitOrder,
    CreateLimitOrderRequest,
    PriceTick,
    OHLCVResponse,
    //Webhook,
    ApiResponse,
    PaginatedResponse,
    BridgeQuoteRequest, 
    BridgeQuoteResponse, 
    SwapQuoteRequest,
    SwapQuoteResponse,
    // add other exports as needed
};
