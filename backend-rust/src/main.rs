use axum::http::HeaderValue;
use axum::{
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod api;
mod bridge_worker;
mod config;
mod constants;
mod crypto;
mod db;
mod error;
mod indexer;
mod integrations;
mod models;
mod services;
mod tokenomics;
mod utils;
mod websocket;

use config::Config;
use constants::API_VERSION;
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
    config.validate()?;

    tracing::info!("Starting CAREL Backend Server");
    tracing::info!("Environment: {}", config.environment);
    tracing::info!("API Version: {}", API_VERSION);

    // Initialize database
    let db = Database::new(&config).await?;

    // Run migrations
    tracing::info!("Running database migrations...");
    db.run_migrations().await?;

    // Initialize Redis
    let redis = redis::Client::open(config.redis_url.clone())?;
    let redis_manager = redis::aio::ConnectionManager::new(redis).await?;

    // Masukkan manager ke AppState
    let app_state = api::AppState {
        db: db.clone(),
        redis: redis_manager,
        config: config.clone(),
    };

    // Build router
    let app = build_router(app_state);

    // Start background services
    tokio::spawn(services::start_background_services(
        db.clone(),
        config.clone(),
    ));

    // Optional BTC -> Starknet bridge watcher.
    let enable_bridge_watcher = std::env::var("ENABLE_BTC_BRIDGE_WATCHER")
        .map(|v| {
            let normalized = v.trim().to_ascii_lowercase();
            normalized == "1" || normalized == "true" || normalized == "yes" || normalized == "on"
        })
        .unwrap_or(false);
    if enable_bridge_watcher {
        tracing::info!("Starting BTC bridge watcher...");
        tokio::spawn(async {
            bridge_worker::start_bridge_watcher().await;
        });
    }

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
    let cors = cors_from_config(&state.config);

    Router::new()
        // Health check
        .route("/health", get(api::health::health_check))
        // Authentication
        .route("/api/v1/auth/connect", post(api::auth::connect_wallet))
        .route("/api/v1/auth/refresh", post(api::auth::refresh_token))
        .route("/api/v1/profile/me", get(api::profile::get_profile))
        .route(
            "/api/v1/profile/display-name",
            axum::routing::put(api::profile::set_display_name),
        )
        // Swap & Bridge
        .route("/api/v1/swap/quote", post(api::swap::get_quote))
        .route("/api/v1/swap/execute", post(api::swap::execute_swap))
        .route("/api/v1/bridge/quote", post(api::bridge::get_bridge_quote))
        .route("/api/v1/bridge/execute", post(api::bridge::execute_bridge))
        .route(
            "/api/v1/bridge/status/{bridge_id}",
            get(api::bridge::get_bridge_status),
        )
        // Garden Public Data (proxied)
        .route("/api/v1/garden/volume", get(api::garden::get_total_volume))
        .route("/api/v1/garden/fees", get(api::garden::get_total_fees))
        .route(
            "/api/v1/garden/chains",
            get(api::garden::get_supported_chains),
        )
        .route(
            "/api/v1/garden/assets",
            get(api::garden::get_supported_assets),
        )
        .route(
            "/api/v1/garden/liquidity",
            get(api::garden::get_available_liquidity),
        )
        .route("/api/v1/garden/orders", get(api::garden::get_orders))
        .route(
            "/api/v1/garden/orders/{order_id}",
            get(api::garden::get_order_by_id),
        )
        .route(
            "/api/v1/garden/orders/{order_id}/instant-refund-hash",
            get(api::garden::get_order_instant_refund_hash),
        )
        .route(
            "/api/v1/garden/schemas/{name}",
            get(api::garden::get_schema),
        )
        .route(
            "/api/v1/garden/apps/earnings",
            get(api::garden::get_app_earnings),
        )
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
            "/api/v1/portfolio/ohlcv",
            get(api::portfolio::get_portfolio_ohlcv),
        )
        .route(
            "/api/v1/wallet/onchain-balances",
            post(api::wallet::get_onchain_balances),
        )
        .route(
            "/api/v1/wallet/link",
            post(api::wallet::link_wallet_address),
        )
        .route(
            "/api/v1/wallet/linked",
            get(api::wallet::get_linked_wallets),
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
            "/api/v1/leaderboard/global",
            get(api::leaderboard::get_global_metrics),
        )
        .route(
            "/api/v1/leaderboard/global/{epoch}",
            get(api::leaderboard::get_global_metrics_epoch),
        )
        .route(
            "/api/v1/leaderboard/user/{address}", // PERBAIKAN: :address -> {address}
            get(api::leaderboard::get_user_rank),
        )
        .route(
            "/api/v1/leaderboard/user/{address}/categories",
            get(api::leaderboard::get_user_categories),
        )
        // Rewards & Points
        .route("/api/v1/rewards/points", get(api::rewards::get_points))
        .route(
            "/api/v1/rewards/sync-onchain",
            post(api::rewards::sync_points_onchain),
        )
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
        .route("/api/v1/referral/history", get(api::referral::get_history))
        // Social Tasks
        .route("/api/v1/social/tasks", get(api::social::get_tasks))
        .route("/api/v1/social/verify", post(api::social::verify_task))
        // Admin (manual maintenance)
        .route("/api/v1/admin/points/reset", post(api::admin::reset_points))
        // Privacy
        .route(
            "/api/v1/privacy/submit",
            post(api::privacy::submit_private_action),
        )
        // Private BTC swap
        .route(
            "/api/v1/private-btc-swap/initiate",
            post(api::private_btc_swap::initiate_private_btc_swap),
        )
        .route(
            "/api/v1/private-btc-swap/finalize",
            post(api::private_btc_swap::finalize_private_btc_swap),
        )
        .route(
            "/api/v1/private-btc-swap/nullifier/{nullifier}",
            get(api::private_btc_swap::is_nullifier_used),
        )
        // Dark pool
        .route(
            "/api/v1/dark-pool/order",
            post(api::dark_pool::submit_order),
        )
        .route("/api/v1/dark-pool/match", post(api::dark_pool::match_order))
        .route(
            "/api/v1/dark-pool/nullifier/{nullifier}",
            get(api::dark_pool::is_nullifier_used),
        )
        // Private payments
        .route(
            "/api/v1/private-payments/submit",
            post(api::private_payments::submit_private_payment),
        )
        .route(
            "/api/v1/private-payments/finalize",
            post(api::private_payments::finalize_private_payment),
        )
        .route(
            "/api/v1/private-payments/nullifier/{nullifier}",
            get(api::private_payments::is_nullifier_used),
        )
        // Anonymous credentials
        .route(
            "/api/v1/credentials/submit",
            post(api::anonymous_credentials::submit_credential_proof),
        )
        .route(
            "/api/v1/credentials/nullifier/{nullifier}",
            get(api::anonymous_credentials::is_nullifier_used),
        )
        // Faucet (Testnet)
        .route("/api/v1/faucet/claim", post(api::faucet::claim_tokens))
        .route("/api/v1/faucet/status", get(api::faucet::get_status))
        .route("/api/v1/faucet/stats", get(api::faucet::get_faucet_stats))
        // Deposit (Fiat On-Ramp)
        .route(
            "/api/v1/deposit/bank-transfer",
            post(api::deposit::bank_transfer),
        )
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
        .route(
            "/api/v1/notifications/stats",
            get(api::notifications::get_stats),
        )
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
        // Market Depth
        .route(
            "/api/v1/market/depth/{token}",
            get(api::market::get_market_depth),
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
        .route(
            "/api/v1/ai/prepare-action",
            post(api::ai::prepare_action_signature),
        )
        .route("/api/v1/ai/execute", post(api::ai::execute_command))
        .route("/api/v1/ai/pending", get(api::ai::get_pending_actions))
        // WebSocket endpoints
        .route("/ws/notifications", get(websocket::notifications::handler))
        .route("/ws/prices", get(websocket::prices::handler))
        .route("/ws/orders", get(websocket::orders::handler))
        .layer(cors)
        .with_state(state)
}

fn cors_from_config(config: &Config) -> CorsLayer {
    let raw = config.cors_allowed_origins.trim();
    if raw.is_empty() || raw == "*" {
        return CorsLayer::very_permissive();
    }

    let allowed: Vec<HeaderValue> = raw
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse::<HeaderValue>().ok())
        .collect();

    if allowed.is_empty() {
        tracing::warn!("No valid CORS origins parsed; falling back to permissive");
        return CorsLayer::very_permissive();
    }

    CorsLayer::new()
        .allow_origin(AllowOrigin::list(allowed))
        .allow_methods(Any)
        .allow_headers(Any)
}
