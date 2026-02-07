use super::{starknet_client::StarknetClient, event_parser::EventParser};
use crate::{db::Database, error::Result};

/// Block Processor - Processes blocks and extracts events
pub struct BlockProcessor {
    client: StarknetClient,
    parser: EventParser,
    db: Database,
}

impl BlockProcessor {
    pub fn new(client: StarknetClient, db: Database) -> Self {
        Self {
            client,
            parser: EventParser::new(),
            db,
        }
    }

    /// Process a single block
    pub async fn process_block(&self, block_number: u64) -> Result<usize> {
        tracing::info!("Processing block {}", block_number);

        let block = self.client.get_block(block_number).await?;
        let mut events_processed = 0;

        for tx in &block.transactions {
            // Get transaction receipt to get events
            if let Ok(receipt) = self.client.get_transaction_receipt(&tx.transaction_hash).await {
                for event in &receipt.events {
                    if let Some(parsed) = self.parser.parse_event(event) {
                        self.handle_event(
                            &tx.transaction_hash,
                            block_number,
                            parsed,
                        ).await?;
                        events_processed += 1;
                    }
                }
            }
        }

        tracing::info!("Processed block {} with {} events", block_number, events_processed);
        Ok(events_processed)
    }

    /// Handle parsed event
    async fn handle_event(
        &self,
        tx_hash: &str,
        block_number: u64,
        event: super::event_parser::ParsedEvent,
    ) -> Result<()> {
        match event.event_type.as_str() {
            "Swap" => self.handle_swap(tx_hash, block_number, event.data).await?,
            "Bridge" => self.handle_bridge(tx_hash, block_number, event.data).await?,
            "Stake" => self.handle_stake(tx_hash, block_number, event.data).await?,
            "Unstake" => self.handle_unstake(tx_hash, block_number, event.data).await?,
            "LimitOrderFilled" => self.handle_order_filled(tx_hash, event.data).await?,
            _ => {}
        }

        Ok(())
    }

    async fn handle_swap(&self, tx_hash: &str, block_number: u64, data: serde_json::Value) -> Result<()> {
        let user = data.get("user").and_then(|v| v.as_str()).unwrap_or("");
        
        let tx = crate::models::Transaction {
            tx_hash: tx_hash.to_string(),
            block_number: block_number as i64,
            user_address: user.to_string(),
            tx_type: "swap".to_string(),
            token_in: data.get("token_in").and_then(|v| v.as_str()).map(String::from),
            token_out: data.get("token_out").and_then(|v| v.as_str()).map(String::from),
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

    async fn handle_bridge(&self, tx_hash: &str, block_number: u64, data: serde_json::Value) -> Result<()> {
        let user = data.get("user").and_then(|v| v.as_str()).unwrap_or("");
        
        let tx = crate::models::Transaction {
            tx_hash: tx_hash.to_string(),
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

    async fn handle_stake(&self, tx_hash: &str, block_number: u64, data: serde_json::Value) -> Result<()> {
        let user = data.get("user").and_then(|v| v.as_str()).unwrap_or("");
        
        let tx = crate::models::Transaction {
            tx_hash: tx_hash.to_string(),
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

    async fn handle_unstake(&self, tx_hash: &str, block_number: u64, data: serde_json::Value) -> Result<()> {
        let user = data.get("user").and_then(|v| v.as_str()).unwrap_or("");
        
        let tx = crate::models::Transaction {
            tx_hash: tx_hash.to_string(),
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

    async fn handle_order_filled(&self, _tx_hash: &str, data: serde_json::Value) -> Result<()> {
        let order_id = data.get("order_id").and_then(|v| v.as_str()).unwrap_or("");
        
        self.db.update_order_status(order_id, 2).await?;
        Ok(())
    }
}