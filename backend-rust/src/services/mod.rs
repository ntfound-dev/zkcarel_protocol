// All service modules
pub mod ai_plan;
pub mod ai_service;
pub mod analytics_service;
pub mod deposit_service;
pub mod event_indexer;
pub mod faucet_service;
pub mod filecoin;
pub mod gas_optimizer;
pub mod header_pusher;
pub mod invoke_parser;
pub mod ipfs;
pub mod ipfs_service;
pub mod limit_order_executor;
pub mod liquidity_aggregator;
pub mod merkle_generator;
pub mod nft_discount;
pub mod notification_service;
pub mod onchain;
pub mod point_calculator;
pub mod price_chart_service;
pub mod price_guard;
pub mod privacy_verifier;
pub mod relayer;
pub mod route_optimizer;
pub mod snapshot_manager;
pub mod social_verifier;
pub mod transaction_history;
pub mod webhook_service;

// Re-export for convenience
pub use analytics_service::AnalyticsService;
pub use deposit_service::DepositService;
pub use event_indexer::EventIndexer;
pub use header_pusher::HeaderPusher;
pub use limit_order_executor::LimitOrderExecutor;
pub use liquidity_aggregator::LiquidityAggregator;
pub use merkle_generator::MerkleGenerator;
pub use notification_service::NotificationService;
pub use point_calculator::PointCalculator;
pub use price_chart_service::PriceChartService;
pub use route_optimizer::RouteOptimizer;
pub use snapshot_manager::SnapshotManager;
pub use social_verifier::SocialVerifier;
pub use transaction_history::TransactionHistoryService;
pub use webhook_service::WebhookService;

use crate::{config::Config, db::Database};
use sqlx::Row;
use std::sync::Arc;

// Internal helper that checks conditions for `is_env_flag_enabled`.
fn is_env_flag_enabled(name: &str) -> bool {
    std::env::var(name)
        .ok()
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            normalized == "1" || normalized == "true" || normalized == "yes" || normalized == "on"
        })
        .unwrap_or(false)
}

// Internal helper that supports `notification_retention_days` operations.
fn notification_retention_days() -> i64 {
    std::env::var("NOTIFICATION_RETENTION_DAYS")
        .ok()
        .and_then(|raw| raw.parse::<i64>().ok())
        .filter(|value| *value >= 0)
        .unwrap_or(30)
}

// Internal helper that supports `notification_retention_interval_secs` operations.
fn notification_retention_interval_secs() -> u64 {
    std::env::var("NOTIFICATION_RETENTION_INTERVAL_SECS")
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(6 * 60 * 60)
}

/// Start all background services
pub async fn start_background_services(db: Database, config: Config) {
    tracing::info!("Starting background services...");

    let enable_event_indexer = if std::env::var("ENABLE_EVENT_INDEXER").is_ok() {
        is_env_flag_enabled("ENABLE_EVENT_INDEXER")
    } else {
        true
    };
    if enable_event_indexer {
        let event_indexer = Arc::new(EventIndexer::new(db.clone(), config.clone()));
        event_indexer.clone().start().await;
    } else {
        tracing::warn!("Event indexer disabled via ENABLE_EVENT_INDEXER");
    }

    // Start point calculator
    let point_calculator = Arc::new(PointCalculator::new(db.clone(), config.clone()));
    point_calculator.clone().start().await;

    // Start price chart updater
    let price_service = Arc::new(PriceChartService::new(db.clone(), config.clone()));
    price_service.clone().start_price_updater().await;

    // Start limit order executor
    let order_executor = Arc::new(LimitOrderExecutor::new(db.clone(), config.clone()));
    order_executor.clone().start_executor().await;

    if is_env_flag_enabled("ENABLE_BTC_HEADER_PUSHER") {
        let header_pusher = Arc::new(HeaderPusher::new(&config));
        header_pusher.clone().start().await;
    } else {
        tracing::warn!("BTC header pusher disabled via ENABLE_BTC_HEADER_PUSHER");
    }

    // Snapshot manager (optional one-off jobs)
    let snapshot_manager = SnapshotManager::new(db.clone(), config.clone());
    let current_epoch = snapshot_manager.get_current_epoch();
    tracing::info!("Current epoch: {}", current_epoch);

    if is_env_flag_enabled("RUN_EPOCH_JOBS") {
        tracing::info!("Running epoch finalize job...");
        let finalize_epoch = current_epoch.saturating_sub(1);
        let merkle = MerkleGenerator::new(db.clone(), config.clone());

        if let Ok(tree) = merkle.generate_for_epoch(finalize_epoch).await {
            let _ = merkle.save_merkle_root(finalize_epoch, tree.root).await;

            if let Ok(Some(row)) = sqlx::query(
                "SELECT user_address, total_points FROM points
                 WHERE epoch = $1 AND finalized = true AND total_points > 0
                 ORDER BY user_address ASC LIMIT 1",
            )
            .bind(finalize_epoch)
            .fetch_optional(db.pool())
            .await
            {
                let address: String = row.get("user_address");
                let points: rust_decimal::Decimal = row.get("total_points");
                if let Ok(total_points) = sqlx::query_scalar::<_, rust_decimal::Decimal>(
                    "SELECT COALESCE(SUM(total_points), 0) FROM points WHERE epoch = $1",
                )
                .bind(finalize_epoch)
                .fetch_one(db.pool())
                .await
                {
                    let amount_wei = merkle.calculate_reward_amount_wei(points, total_points);
                    let _ = merkle
                        .generate_proof(&tree, &address, amount_wei, finalize_epoch)
                        .await;
                }
                let _ = merkle.get_merkle_root(finalize_epoch).await;
            }
        }

        let _ = snapshot_manager.finalize_epoch(finalize_epoch).await;
        let _ = snapshot_manager.start_new_epoch(current_epoch).await;
    }

    let retention_days = notification_retention_days();
    if retention_days > 0 {
        let retention_interval = notification_retention_interval_secs();
        let notification_service = NotificationService::new(db.clone(), config.clone());
        tokio::spawn(async move {
            let mut ticker =
                tokio::time::interval(std::time::Duration::from_secs(retention_interval));
            loop {
                ticker.tick().await;
                match notification_service
                    .cleanup_old_notifications(retention_days)
                    .await
                {
                    Ok(removed) => {
                        if removed > 0 {
                            tracing::info!(
                                "Notification retention cleanup removed {} rows (retention_days={})",
                                removed,
                                retention_days
                            );
                        }
                    }
                    Err(err) => {
                        tracing::warn!("Notification retention cleanup failed: {}", err);
                    }
                }
            }
        });
    } else {
        tracing::warn!("Notification retention disabled via NOTIFICATION_RETENTION_DAYS=0");
    }

    tracing::info!("All background services started successfully");
}
