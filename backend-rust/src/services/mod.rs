// All service modules
pub mod faucet_service;
pub mod notification_service;
pub mod transaction_history;
pub mod price_chart_service;
pub mod limit_order_executor;
pub mod liquidity_aggregator;
pub mod event_indexer;
pub mod point_calculator;
pub mod merkle_generator;
pub mod route_optimizer;
pub mod snapshot_manager;
pub mod social_verifier;
pub mod ai_service;
pub mod deposit_service;
pub mod analytics_service;
pub mod webhook_service;
pub mod gas_optimizer;

// Re-export for convenience
pub use faucet_service::FaucetService;
pub use notification_service::{NotificationService};
pub use transaction_history::TransactionHistoryService;
pub use price_chart_service::PriceChartService;
pub use limit_order_executor::LimitOrderExecutor;
pub use liquidity_aggregator::LiquidityAggregator;
pub use event_indexer::EventIndexer;
pub use point_calculator::PointCalculator;
// pub use merkle_generator::MerkleGenerator;
// pub use route_optimizer::RouteOptimizer;
// pub use snapshot_manager::SnapshotManager;
// pub use social_verifier::SocialVerifier;
// pub use ai_service::AIService;
pub use deposit_service::DepositService;
// pub use analytics_service::AnalyticsService;
// pub use webhook_service::WebhookService;
// pub use gas_optimizer::GasOptimizer;

use crate::{config::Config, db::Database};
use std::sync::Arc;

/// Start all background services
pub async fn start_background_services(db: Database, config: Config) {
    tracing::info!("Starting background services...");

    // Start event indexer
    let event_indexer = Arc::new(EventIndexer::new(db.clone(), config.clone()));
    event_indexer.clone().start().await;

    // Start point calculator
    let point_calculator = Arc::new(PointCalculator::new(db.clone(), config.clone()));
    point_calculator.clone().start().await;

    // Start price chart updater
    let price_service = Arc::new(PriceChartService::new(db.clone(), config.clone()));
    price_service.clone().start_price_updater().await;

    // Start limit order executor
    let order_executor = Arc::new(LimitOrderExecutor::new(db.clone(), config.clone()));
    order_executor.clone().start_executor().await;

    tracing::info!("All background services started successfully");
}