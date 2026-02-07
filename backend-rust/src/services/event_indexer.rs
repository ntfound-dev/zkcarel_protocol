use crate::{config::Config, db::Database, error::Result};
use std::sync::Arc;
use tokio::time::{interval, Duration};

/// Event Indexer - Scans blockchain for CAREL Protocol events
pub struct EventIndexer {
    db: Database,
    config: Config,
    last_block: Arc<tokio::sync::RwLock<u64>>,
}

impl EventIndexer {
    pub fn new(db: Database, config: Config) -> Self {
        Self {
            db,
            config,
            last_block: Arc::new(tokio::sync::RwLock::new(0)),
        }
    }

    /// Start the event indexer loop
    pub async fn start(self: Arc<Self>) {
        tokio::spawn(async move {
            let mut ticker = interval(Duration::from_secs(5));

            loop {
                ticker.tick().await;

                if let Err(e) = self.scan_events().await {
                    tracing::error!("Event indexer error: {}", e);
                }
            }
        });
    }

    /// Scan for new events from last block to current
    async fn scan_events(&self) -> Result<()> {
        let last_block = *self.last_block.read().await;
        let current_block = self.get_current_block().await?;

        if current_block <= last_block {
            return Ok(());
        }

        tracing::info!(
            "Scanning blocks {} to {}",
            last_block + 1,
            current_block
        );

        for block in (last_block + 1)..=current_block {
            self.process_block(block).await?;
        }

        // Update last processed block
        *self.last_block.write().await = current_block;

        Ok(())
    }

    /// Get current blockchain block number
    async fn get_current_block(&self) -> Result<u64> {
        // TODO: Integrate with actual Starknet RPC
        // For now, return mock value
        Ok(1000000)
    }

    /// Process a single block
    async fn process_block(&self, block_number: u64) -> Result<()> {
        // Get events from this block
        let events = self.get_block_events(block_number).await?;

        for event in events {
            self.process_event(event, block_number).await?;
        }

        Ok(())
    }

    /// Get events from a specific block
    async fn get_block_events(&self, _block_number: u64) -> Result<Vec<BlockchainEvent>> {
        // TODO: Query Starknet for events
        // For now, return empty
        Ok(vec![])
    }

    /// Process individual event
    async fn process_event(&self, event: BlockchainEvent, block_number: u64) -> Result<()> {
        match event.event_type.as_str() {
            "Swap" => self.handle_swap_event(event, block_number).await?,
            "Bridge" => self.handle_bridge_event(event, block_number).await?,
            "Stake" => self.handle_stake_event(event, block_number).await?,
            "Unstake" => self.handle_unstake_event(event, block_number).await?,
            "Claim" => self.handle_claim_event(event, block_number).await?,
            "LimitOrderFilled" => self.handle_order_filled(event, block_number).await?,
            _ => {
                tracing::debug!("Unknown event type: {}", event.event_type);
            }
        }

        Ok(())
    }

    async fn handle_swap_event(&self, event: BlockchainEvent, block_number: u64) -> Result<()> {
        // Parse swap event data
        let user = event.data.get("user").and_then(|v| v.as_str()).unwrap_or("");
        let amount_usd: f64 = event
            .data
            .get("amount_usd")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);

        // Save transaction
        let tx = crate::models::Transaction {
            tx_hash: event.tx_hash,
            block_number: block_number as i64,
            user_address: user.to_string(),
            tx_type: "swap".to_string(),
            token_in: event.data.get("token_in").and_then(|v| v.as_str()).map(String::from),
            token_out: event.data.get("token_out").and_then(|v| v.as_str()).map(String::from),
            amount_in: None,
            amount_out: None,
            usd_value: Some(rust_decimal::Decimal::from_f64_retain(amount_usd).unwrap()),
            fee_paid: None,
            points_earned: None,
            timestamp: chrono::Utc::now(),
            processed: false,
        };

        self.db.save_transaction(&tx).await?;

        tracing::info!(
            "Swap event indexed: user={}, amount_usd={}",
            user,
            amount_usd
        );

        Ok(())
    }

    async fn handle_bridge_event(&self, event: BlockchainEvent, block_number: u64) -> Result<()> {
        let user = event.data.get("user").and_then(|v| v.as_str()).unwrap_or("");
        
        let tx = crate::models::Transaction {
            tx_hash: event.tx_hash,
            block_number: block_number as i64,
            user_address: user.to_string(),
            tx_type: "bridge".to_string(),
            token_in: None,
            token_out: None,
            amount_in: None,
            amount_out: None,
            usd_value: None,
            fee_paid: None,
            points_earned: None,
            timestamp: chrono::Utc::now(),
            processed: false,
        };

        self.db.save_transaction(&tx).await?;
        Ok(())
    }

    async fn handle_stake_event(&self, event: BlockchainEvent, block_number: u64) -> Result<()> {
        let user = event.data.get("user").and_then(|v| v.as_str()).unwrap_or("");
        
        let tx = crate::models::Transaction {
            tx_hash: event.tx_hash,
            block_number: block_number as i64,
            user_address: user.to_string(),
            tx_type: "stake".to_string(),
            token_in: None,
            token_out: None,
            amount_in: None,
            amount_out: None,
            usd_value: None,
            fee_paid: None,
            points_earned: None,
            timestamp: chrono::Utc::now(),
            processed: false,
        };

        self.db.save_transaction(&tx).await?;
        Ok(())
    }

    async fn handle_unstake_event(&self, event: BlockchainEvent, block_number: u64) -> Result<()> {
        let user = event.data.get("user").and_then(|v| v.as_str()).unwrap_or("");
        
        let tx = crate::models::Transaction {
            tx_hash: event.tx_hash,
            block_number: block_number as i64,
            user_address: user.to_string(),
            tx_type: "unstake".to_string(),
            token_in: None,
            token_out: None,
            amount_in: None,
            amount_out: None,
            usd_value: None,
            fee_paid: None,
            points_earned: None,
            timestamp: chrono::Utc::now(),
            processed: false,
        };

        self.db.save_transaction(&tx).await?;
        Ok(())
    }

    async fn handle_claim_event(&self, event: BlockchainEvent, block_number: u64) -> Result<()> {
        let user = event.data.get("user").and_then(|v| v.as_str()).unwrap_or("");
        
        let tx = crate::models::Transaction {
            tx_hash: event.tx_hash,
            block_number: block_number as i64,
            user_address: user.to_string(),
            tx_type: "claim".to_string(),
            token_in: None,
            token_out: None,
            amount_in: None,
            amount_out: None,
            usd_value: None,
            fee_paid: None,
            points_earned: None,
            timestamp: chrono::Utc::now(),
            processed: false,
        };

        self.db.save_transaction(&tx).await?;
        Ok(())
    }

    async fn handle_order_filled(&self, event: BlockchainEvent, _block_number: u64) -> Result<()> {
        let order_id = event.data.get("order_id").and_then(|v| v.as_str()).unwrap_or("");
        
        // Update limit order status
        self.db.update_order_status(order_id, 2).await?;
        
        tracing::info!("Limit order filled: {}", order_id);
        Ok(())
    }
}

#[derive(Debug, Clone)]
struct BlockchainEvent {
    tx_hash: String,
    event_type: String,
    data: serde_json::Value,
}