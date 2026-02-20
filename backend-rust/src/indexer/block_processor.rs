use super::{event_parser::EventParser, starknet_client::StarknetClient};
use crate::{db::Database, error::Result};

/// Block Processor - Processes blocks and extracts events
pub struct BlockProcessor {
    client: StarknetClient,
    parser: EventParser,
    db: Database,
}

impl BlockProcessor {
    /// Constructs a new instance via `new`.
    ///
    /// # Arguments
    /// * Uses function parameters as validated input and runtime context.
    ///
    /// # Returns
    /// * `Ok(...)` when processing succeeds.
    /// * `Err(AppError)` when validation, authorization, or integration checks fail.
    ///
    /// # Notes
    /// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
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
            if let Ok(receipt) = self
                .client
                .get_transaction_receipt(&tx.transaction_hash)
                .await
            {
                for event in &receipt.events {
                    if let Some(parsed) = self.parser.parse_event(event) {
                        self.handle_event(&tx.transaction_hash, block_number, parsed)
                            .await?;
                        events_processed += 1;
                    }
                }
            }
        }

        tracing::info!(
            "Processed block {} with {} events",
            block_number,
            events_processed
        );
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
            "Bridge" => {
                self.handle_bridge(tx_hash, block_number, event.data)
                    .await?
            }
            "Stake" => self.handle_stake(tx_hash, block_number, event.data).await?,
            "Unstake" => {
                self.handle_unstake(tx_hash, block_number, event.data)
                    .await?
            }
            "LimitOrderFilled" => self.handle_order_filled(tx_hash, event.data).await?,
            _ => {}
        }

        Ok(())
    }

    // Internal helper that supports `handle_swap` operations.
    async fn handle_swap(
        &self,
        tx_hash: &str,
        block_number: u64,
        data: serde_json::Value,
    ) -> Result<()> {
        let user = data.get("user").and_then(|v| v.as_str()).unwrap_or("");

        let tx = build_swap_transaction(tx_hash, block_number, user, &data);

        self.db.save_transaction(&tx).await?;
        Ok(())
    }

    // Internal helper that supports `handle_bridge` operations.
    async fn handle_bridge(
        &self,
        tx_hash: &str,
        block_number: u64,
        data: serde_json::Value,
    ) -> Result<()> {
        let user = data.get("user").and_then(|v| v.as_str()).unwrap_or("");

        let tx = build_simple_transaction(tx_hash, block_number, user, "bridge");

        self.db.save_transaction(&tx).await?;
        Ok(())
    }

    // Internal helper that supports `handle_stake` operations.
    async fn handle_stake(
        &self,
        tx_hash: &str,
        block_number: u64,
        data: serde_json::Value,
    ) -> Result<()> {
        let user = data.get("user").and_then(|v| v.as_str()).unwrap_or("");

        let tx = build_simple_transaction(tx_hash, block_number, user, "stake");

        self.db.save_transaction(&tx).await?;
        Ok(())
    }

    // Internal helper that supports `handle_unstake` operations.
    async fn handle_unstake(
        &self,
        tx_hash: &str,
        block_number: u64,
        data: serde_json::Value,
    ) -> Result<()> {
        let user = data.get("user").and_then(|v| v.as_str()).unwrap_or("");

        let tx = build_simple_transaction(tx_hash, block_number, user, "unstake");

        self.db.save_transaction(&tx).await?;
        Ok(())
    }

    // Internal helper that supports `handle_order_filled` operations.
    async fn handle_order_filled(&self, _tx_hash: &str, data: serde_json::Value) -> Result<()> {
        let order_id = data.get("order_id").and_then(|v| v.as_str()).unwrap_or("");

        self.db.update_order_status(order_id, 2).await?;
        Ok(())
    }
}

// Internal helper that builds inputs for `build_simple_transaction`.
fn build_simple_transaction(
    tx_hash: &str,
    block_number: u64,
    user: &str,
    tx_type: &str,
) -> crate::models::Transaction {
    crate::models::Transaction {
        tx_hash: tx_hash.to_string(),
        block_number: block_number as i64,
        user_address: user.to_string(),
        tx_type: tx_type.to_string(),
        token_in: None,
        token_out: None,
        amount_in: None,
        amount_out: None,
        usd_value: None,
        fee_paid: None,
        points_earned: None,
        timestamp: chrono::Utc::now(),
        processed: false,
    }
}

// Internal helper that builds inputs for `build_swap_transaction`.
fn build_swap_transaction(
    tx_hash: &str,
    block_number: u64,
    user: &str,
    data: &serde_json::Value,
) -> crate::models::Transaction {
    crate::models::Transaction {
        tx_hash: tx_hash.to_string(),
        block_number: block_number as i64,
        user_address: user.to_string(),
        tx_type: "swap".to_string(),
        token_in: data
            .get("token_in")
            .and_then(|v| v.as_str())
            .map(String::from),
        token_out: data
            .get("token_out")
            .and_then(|v| v.as_str())
            .map(String::from),
        amount_in: None,
        amount_out: None,
        usd_value: None,
        fee_paid: None,
        points_earned: None,
        timestamp: chrono::Utc::now(),
        processed: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    // Internal helper that builds inputs for `build_simple_transaction_sets_fields`.
    fn build_simple_transaction_sets_fields() {
        // Memastikan field dasar transaksi terisi dengan benar
        let tx = build_simple_transaction("0xhash", 10, "0xuser", "bridge");
        assert_eq!(tx.tx_hash, "0xhash");
        assert_eq!(tx.block_number, 10);
        assert_eq!(tx.user_address, "0xuser");
        assert_eq!(tx.tx_type, "bridge");
        assert!(!tx.processed);
    }

    #[test]
    // Internal helper that builds inputs for `build_swap_transaction_maps_tokens`.
    fn build_swap_transaction_maps_tokens() {
        // Memastikan token_in dan token_out terambil dari data event
        let data = serde_json::json!({
            "token_in": "ETH",
            "token_out": "USDT"
        });
        let tx = build_swap_transaction("0xhash", 1, "0xuser", &data);
        assert_eq!(tx.token_in.as_deref(), Some("ETH"));
        assert_eq!(tx.token_out.as_deref(), Some("USDT"));
        assert_eq!(tx.tx_type, "swap");
    }
}
