use axum::{
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod api;
mod config;
mod constants;
mod crypto;
mod db;
mod error;
mod indexer;
mod integrations;
mod models;
mod services;
mod utils;
mod websocket;

use config::Config;
use db::Database;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "carel_backend=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Load configuration
    let config = Config::from_env()?;

    tracing::info!("Starting CAREL Backend Server");
    tracing::info!("Environment: {}", config.environment);

    // Initialize database
    let db = Database::new(&config.database_url).await?;

    // Run migrations
    tracing::info!("Running database migrations...");
    db.run_migrations().await?;

    // Initialize Redis
    let redis = redis::Client::open(config.redis_url.clone())?;
    let _redis_conn = redis.get_connection()?; // Ditambah underscore agar tidak warning unused

    // 1. Buat manager dan pool
    let manager = r2d2_redis::RedisConnectionManager::new(config.redis_url.clone())?;
    let redis_pool = r2d2::Pool::builder()
        .build(manager)
        .expect("Failed to create Redis pool");

    // 2. Masukkan pool ke AppState
    let app_state = api::AppState {
        db: db.clone(),
        redis: redis_pool, 
        config: config.clone(),
    };

    // Build router
    let app = build_router(app_state);

    // Start background services
    tokio::spawn(services::start_background_services(
        db.clone(),
        config.clone(),
    ));

    // Start server
    let addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .expect("Invalid address");

    tracing::info!("Listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

fn build_router(state: api::AppState) -> Router {
    // CORS configuration
    let cors = CorsLayer::very_permissive();

    Router::new()
        // Health check
        .route("/health", get(api::health::health_check))
        // Authentication
        .route("/api/v1/auth/connect", post(api::auth::connect_wallet))
        .route("/api/v1/auth/refresh", post(api::auth::refresh_token))
        // Swap & Bridge
        .route("/api/v1/swap/quote", post(api::swap::get_quote))
        .route("/api/v1/swap/execute", post(api::swap::execute_swap))
        .route("/api/v1/bridge/quote", post(api::bridge::get_bridge_quote))
        .route("/api/v1/bridge/execute", post(api::bridge::execute_bridge))
        // Limit Orders
        .route(
            "/api/v1/limit-order/create",
            post(api::limit_order::create_order),
        )
        .route(
            "/api/v1/limit-order/list",
            get(api::limit_order::list_orders),
        )
        .route(
            "/api/v1/limit-order/{order_id}", // PERBAIKAN: :order_id -> {order_id}
            axum::routing::delete(api::limit_order::cancel_order),
        )
        // Staking
        .route("/api/v1/stake/pools", get(api::stake::get_pools))
        .route("/api/v1/stake/deposit", post(api::stake::deposit))
        .route("/api/v1/stake/withdraw", post(api::stake::withdraw))
        .route("/api/v1/stake/positions", get(api::stake::get_positions))
        // Portfolio
        .route(
            "/api/v1/portfolio/balance",
            get(api::portfolio::get_balance),
        )
        .route(
            "/api/v1/portfolio/history",
            get(api::portfolio::get_history),
        )
        .route(
            "/api/v1/portfolio/analytics",
            get(api::analytics::get_analytics),
        )
        // Leaderboard
        .route(
            "/api/v1/leaderboard/{type}", // PERBAIKAN: :type -> {type}
            get(api::leaderboard::get_leaderboard),
        )
        .route(
            "/api/v1/leaderboard/user/{address}", // PERBAIKAN: :address -> {address}
            get(api::leaderboard::get_user_rank),
        )
        // Rewards & Points
        .route("/api/v1/rewards/points", get(api::rewards::get_points))
        .route("/api/v1/rewards/claim", post(api::rewards::claim_rewards))
        .route(
            "/api/v1/rewards/convert",
            post(api::rewards::convert_to_carel),
        )
        // NFT
        .route("/api/v1/nft/mint", post(api::nft::mint_nft))
        .route("/api/v1/nft/owned", get(api::nft::get_owned_nfts))
        // Referral
        .route("/api/v1/referral/code", get(api::referral::get_code))
        .route("/api/v1/referral/stats", get(api::referral::get_stats))
        // Social Tasks
        .route("/api/v1/social/verify", post(api::social::verify_task))
        // Faucet (Testnet)
        .route("/api/v1/faucet/claim", post(api::faucet::claim_tokens))
        .route("/api/v1/faucet/status", get(api::faucet::get_status))
        .route("/api/v1/faucet/stats", get(api::faucet::get_faucet_stats))
        // Deposit (Fiat On-Ramp)
        .route("/api/v1/deposit/bank-transfer", post(api::deposit::bank_transfer))
        .route("/api/v1/deposit/qris", post(api::deposit::qris))
        .route("/api/v1/deposit/card", post(api::deposit::card_payment))
        .route("/api/v1/deposit/status/{id}", get(api::deposit::get_status)) // PERBAIKAN: :id -> {id}
        // Notifications
        .route("/api/v1/notifications/list", get(api::notifications::list))
        .route(
            "/api/v1/notifications/mark-read",
            post(api::notifications::mark_read),
        )
        .route(
            "/api/v1/notifications/preferences",
            axum::routing::put(api::notifications::update_preferences),
        )
       .route("/api/v1/notifications/stats", get(api::notifications::get_stats))
        // Transactions
        .route(
            "/api/v1/transactions/history",
            get(api::transactions::get_history),
        )
        .route(
            "/api/v1/transactions/{tx_hash}", 
            get(api::transactions::get_details),
        )
        .route(
            "/api/v1/transactions/export",
            post(api::transactions::export_csv),
        )
        // Price Charts
        .route("/api/v1/chart/{token}/ohlcv", get(api::charts::get_ohlcv)) // PERBAIKAN: :token -> {token}
        .route(
            "/api/v1/chart/{token}/indicators", // PERBAIKAN: :token -> {token}
            get(api::charts::get_indicators),
        )
        // Webhooks
        .route("/api/v1/webhooks/register", post(api::webhooks::register))
        .route("/api/v1/webhooks/list", get(api::webhooks::list))
        .route(
            "/api/v1/webhooks/{id}", // PERBAIKAN: :id -> {id}
            axum::routing::delete(api::webhooks::delete),
        )
        .route("/api/v1/webhooks/logs", get(api::webhooks::get_logs))
        // AI Assistant
        .route("/api/v1/ai/execute", post(api::ai::execute_command))
        // WebSocket endpoints
        .route("/ws/notifications", get(websocket::notifications::handler))
        .route("/ws/prices", get(websocket::prices::handler))
        .route("/ws/orders", get(websocket::orders::handler))
        .layer(cors)
        .with_state(state)
}
