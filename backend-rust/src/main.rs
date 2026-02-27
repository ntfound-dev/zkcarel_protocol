use axum::http::HeaderValue;
use axum::{
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;
use std::time::Duration;
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

use anyhow::Context;
use config::Config;
use constants::API_VERSION;
use db::Database;

// Internal helper that supports `install_rustls_crypto_provider` operations.
fn install_rustls_crypto_provider() -> anyhow::Result<()> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        rustls::crypto::aws_lc_rs::default_provider()
            .install_default()
            .map_err(|_| anyhow::anyhow!("failed to install rustls crypto provider"))?;
    }
    Ok(())
}

// Internal helper that supports `spawn_auto_garaga_warmup` operations.
fn spawn_auto_garaga_warmup(config: &Config) {
    let Some(cmd) = config
        .privacy_auto_garaga_prover_cmd
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return;
    };

    // Only warm up bundled script flow to avoid mutating custom external prover commands.
    if !cmd.contains("garaga_auto_prover.py") {
        return;
    }

    let warmup_cmd = format!("{cmd} --warmup");
    tokio::spawn(async move {
        tracing::info!("Starting Garaga calldata warmup...");
        let child = match tokio::process::Command::new("sh")
            .arg("-lc")
            .arg(&warmup_cmd)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            Ok(child) => child,
            Err(err) => {
                tracing::warn!("Garaga warmup spawn failed: {}", err);
                return;
            }
        };

        match tokio::time::timeout(Duration::from_secs(180), child.wait_with_output()).await {
            Ok(Ok(output)) => {
                if output.status.success() {
                    tracing::info!("Garaga warmup completed");
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    tracing::warn!("Garaga warmup failed: {}", stderr.trim());
                }
            }
            Ok(Err(err)) => {
                tracing::warn!("Garaga warmup process error: {}", err);
            }
            Err(_) => {
                tracing::warn!("Garaga warmup timed out after 180s");
            }
        }
    });
}

#[tokio::main]
// Internal helper that supports `main` operations.
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| {
                    "carel_backend=info,tower_http=warn,sqlx::query=error,sqlx::pool::acquire=error,rustls_platform_verifier=error".into()
                }),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    install_rustls_crypto_provider()?;

    // Load configuration
    let config = Config::from_env()?;
    config.validate()?;

    tracing::info!("Starting CAREL Backend Server");
    tracing::info!("Environment: {}", config.environment);
    tracing::info!("API Version: {}", API_VERSION);
    let api_rpc = std::env::var("STARKNET_API_RPC_URL")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| config.starknet_rpc_url.clone());
    tracing::info!("Starknet API RPC URL: {}", api_rpc);
    tracing::info!(
        "Auto Garaga Prover Command Configured: {}",
        config
            .privacy_auto_garaga_prover_cmd
            .as_ref()
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false)
    );
    tracing::info!(
        "Auto Garaga Strict Mode: prover command per-request (no static payload fallback)"
    );
    tracing::info!(
        "Auto Garaga Prover Timeout (ms): {}",
        config.privacy_auto_garaga_prover_timeout_ms
    );
    tracing::info!(
        "Battleship Contract Configured: {}{}",
        config.battleship_garaga_address.as_ref().is_some(),
        config
            .battleship_garaga_address
            .as_ref()
            .map(|addr| format!(" ({addr})"))
            .unwrap_or_default()
    );
    let swap_contract = std::env::var("STARKNET_SWAP_CONTRACT_ADDRESS")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .or_else(|| {
            std::env::var("SWAP_AGGREGATOR_ADDRESS")
                .ok()
                .filter(|v| !v.trim().is_empty())
        });
    tracing::info!(
        "Swap Contract Configured: {}",
        swap_contract.as_ref().is_some()
    );
    spawn_auto_garaga_warmup(&config);

    // Initialize database
    let db = Database::new(&config).await?;

    // Run migrations
    tracing::info!("Running database migrations...");
    db.run_migrations().await?;

    // Initialize Redis
    tracing::info!("Initializing Redis connection manager...");
    let redis =
        redis::Client::open(config.redis_url.clone()).context("invalid REDIS_URL format")?;
    let redis_manager_config = redis::aio::ConnectionManagerConfig::new()
        .set_connection_timeout(Some(Duration::from_secs(10)))
        .set_response_timeout(Some(Duration::from_secs(5)))
        .set_number_of_retries(10)
        .set_min_delay(Duration::from_millis(200))
        .set_max_delay(Duration::from_secs(3));
    let redis_manager = redis::aio::ConnectionManager::new_with_config(redis, redis_manager_config)
        .await
        .context("failed to initialize Redis connection manager (check REDIS_URL, TLS, and network latency)")?;
    tracing::info!("Redis connection manager initialized");

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

// Internal helper that builds inputs for `build_router`.
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
        .route("/api/v1/stake/claim", post(api::stake::claim))
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
        .route(
            "/api/v1/privacy/auto-submit",
            post(api::privacy::auto_submit_private_action),
        )
        .route(
            "/api/v1/privacy/prepare-private-execution",
            post(api::privacy::prepare_private_execution),
        )
        .route(
            "/api/v1/privacy/relayer-execute",
            post(api::privacy::relay_private_execution),
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
        .route("/api/v1/ai/level", get(api::ai::get_ai_level))
        .route("/api/v1/ai/upgrade", post(api::ai::upgrade_ai_level))
        .route("/api/v1/ai/config", get(api::ai::get_runtime_config))
        .route(
            "/api/v1/ai/ensure-executor",
            post(api::ai::ensure_executor_ready),
        )
        .route("/api/v1/ai/execute", post(api::ai::execute_command))
        .route("/api/v1/ai/pending", get(api::ai::get_pending_actions))
        // DeFi Futures (Battleship with Garaga payload flow)
        .route(
            "/api/v1/battleship/create",
            post(api::battleship::create_game),
        )
        .route("/api/v1/battleship/join", post(api::battleship::join_game))
        .route(
            "/api/v1/battleship/place-ships",
            post(api::battleship::place_ships),
        )
        .route("/api/v1/battleship/fire", post(api::battleship::fire_shot))
        .route(
            "/api/v1/battleship/respond",
            post(api::battleship::respond_shot),
        )
        .route(
            "/api/v1/battleship/claim-timeout",
            post(api::battleship::claim_timeout),
        )
        .route(
            "/api/v1/battleship/state/{game_id}",
            get(api::battleship::get_state),
        )
        // WebSocket endpoints
        .route("/ws/notifications", get(websocket::notifications::handler))
        .route("/ws/prices", get(websocket::prices::handler))
        .route("/ws/orders", get(websocket::orders::handler))
        .layer(cors)
        .with_state(state)
}

// Internal helper that supports `cors_from_config` operations.
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
