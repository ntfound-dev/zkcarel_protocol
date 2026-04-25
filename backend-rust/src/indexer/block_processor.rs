use super::{event_parser::EventParser, starknet_client::StarknetClient};
use crate::{db::Database, error::Result};
use rust_decimal::prelude::FromPrimitive;
use rust_decimal::Decimal;
use std::collections::HashMap;

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
        let mut transactions: HashMap<String, crate::models::Transaction> = HashMap::new();

        for tx in &block.transactions {
            // Get transaction receipt to get events
            if let Ok(receipt) = self
                .client
                .get_transaction_receipt(&tx.transaction_hash)
                .await
            {
                for event in &receipt.events {
                    if let Some(parsed) = self.parser.parse_event(event) {
                        if let Some(entry) = self
                            .handle_event(&tx.transaction_hash, block_number, parsed)
                            .await?
                        {
                            merge_transaction_map(&mut transactions, entry);
                        }
                        events_processed += 1;
                    }
                }
            }
        }

        let batch: Vec<crate::models::Transaction> = transactions.into_values().collect();
        self.db.save_transactions_batch(&batch).await?;
        self.db
            .upsert_indexed_block(
                block.block_number as i64,
                &block.block_hash,
                block.parent_hash.as_deref(),
            )
            .await?;

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
    ) -> Result<Option<crate::models::Transaction>> {
        match event.event_type.as_str() {
            "Swap" => Ok(Some(
                self.handle_swap(tx_hash, block_number, event.data).await?,
            )),
            "Bridge" => Ok(Some(
                self.handle_bridge(tx_hash, block_number, event.data)
                    .await?,
            )),
            "Stake" => Ok(Some(
                self.handle_stake(tx_hash, block_number, event.data).await?,
            )),
            "Unstake" => Ok(Some(
                self.handle_unstake(tx_hash, block_number, event.data)
                    .await?,
            )),
            "Claim" => Ok(Some(
                self.handle_claim(tx_hash, block_number, event.data).await?,
            )),
            "LimitOrderFilled" => {
                self.handle_order_filled(tx_hash, event.data).await?;
                Ok(None)
            }
            _ => Ok(None),
        }
    }

    // Internal helper that supports `handle_swap` operations.
    async fn handle_swap(
        &self,
        tx_hash: &str,
        block_number: u64,
        data: serde_json::Value,
    ) -> Result<crate::models::Transaction> {
        let user = data.get("user").and_then(|v| v.as_str()).unwrap_or("");

        let tx = build_swap_transaction(tx_hash, block_number, user, &data);

        Ok(tx)
    }

    // Internal helper that supports `handle_bridge` operations.
    async fn handle_bridge(
        &self,
        tx_hash: &str,
        block_number: u64,
        data: serde_json::Value,
    ) -> Result<crate::models::Transaction> {
        let user = data.get("user").and_then(|v| v.as_str()).unwrap_or("");

        let tx = build_bridge_transaction(tx_hash, block_number, user, &data);

        Ok(tx)
    }

    // Internal helper that supports `handle_stake` operations.
    async fn handle_stake(
        &self,
        tx_hash: &str,
        block_number: u64,
        data: serde_json::Value,
    ) -> Result<crate::models::Transaction> {
        let user = data.get("user").and_then(|v| v.as_str()).unwrap_or("");

        let tx = build_stake_transaction(tx_hash, block_number, user, &data);

        Ok(tx)
    }

    // Internal helper that supports `handle_unstake` operations.
    async fn handle_unstake(
        &self,
        tx_hash: &str,
        block_number: u64,
        data: serde_json::Value,
    ) -> Result<crate::models::Transaction> {
        let user = data.get("user").and_then(|v| v.as_str()).unwrap_or("");

        let tx = build_unstake_transaction(tx_hash, block_number, user, &data);

        Ok(tx)
    }

    // Internal helper that supports `handle_claim` operations.
    async fn handle_claim(
        &self,
        tx_hash: &str,
        block_number: u64,
        data: serde_json::Value,
    ) -> Result<crate::models::Transaction> {
        let user = data.get("user").and_then(|v| v.as_str()).unwrap_or("");

        let tx = build_claim_transaction(tx_hash, block_number, user, &data);

        Ok(tx)
    }

    // Internal helper that supports `handle_order_filled` operations.
    async fn handle_order_filled(&self, _tx_hash: &str, data: serde_json::Value) -> Result<()> {
        let order_id = data.get("order_id").and_then(|v| v.as_str()).unwrap_or("");

        self.db.update_order_status(order_id, 2).await?;
        Ok(())
    }
}

// Internal helper that builds inputs for `build_bridge_transaction`.
fn build_bridge_transaction(
    tx_hash: &str,
    block_number: u64,
    user: &str,
    data: &serde_json::Value,
) -> crate::models::Transaction {
    let token_in = extract_string_field(data, &["token_in", "from_token", "asset_in", "token"]);
    let token_out = extract_string_field(data, &["token_out", "to_token", "asset_out", "token"]);
    let amount_in = extract_decimal_field(
        data,
        &["amount_in", "amount", "amount_in_units", "amount_units"],
    );
    let amount_out = extract_decimal_field(data, &["amount_out", "amount_out_units"]);
    let usd_value = extract_decimal_field(data, &["amount_usd", "usd_value", "usd_amount"]);
    let fee_paid = extract_decimal_field(data, &["fee", "fee_paid"]);

    crate::models::Transaction {
        tx_hash: tx_hash.to_string(),
        block_number: block_number as i64,
        user_address: user.to_string(),
        tx_type: "bridge".to_string(),
        token_in,
        token_out,
        amount_in,
        amount_out,
        usd_value,
        fee_paid,
        points_earned: None,
        is_private: false,
        timestamp: chrono::Utc::now(),
        processed: false,
    }
}

// Internal helper that builds inputs for `build_stake_transaction`.
fn build_stake_transaction(
    tx_hash: &str,
    block_number: u64,
    user: &str,
    data: &serde_json::Value,
) -> crate::models::Transaction {
    let token = extract_string_field(data, &["token", "token_in", "asset"]);
    let amount = extract_decimal_field(data, &["amount", "amount_in", "amount_units"]);
    let usd_value = extract_decimal_field(data, &["amount_usd", "usd_value", "usd_amount"]);

    crate::models::Transaction {
        tx_hash: tx_hash.to_string(),
        block_number: block_number as i64,
        user_address: user.to_string(),
        tx_type: "stake".to_string(),
        token_in: token.clone(),
        token_out: token,
        amount_in: amount,
        amount_out: None,
        usd_value,
        fee_paid: None,
        points_earned: None,
        is_private: false,
        timestamp: chrono::Utc::now(),
        processed: false,
    }
}

// Internal helper that builds inputs for `build_unstake_transaction`.
fn build_unstake_transaction(
    tx_hash: &str,
    block_number: u64,
    user: &str,
    data: &serde_json::Value,
) -> crate::models::Transaction {
    let token = extract_string_field(data, &["token", "token_out", "asset"]);
    let amount = extract_decimal_field(data, &["amount", "amount_out", "amount_units"]);
    let usd_value = extract_decimal_field(data, &["amount_usd", "usd_value", "usd_amount"]);

    crate::models::Transaction {
        tx_hash: tx_hash.to_string(),
        block_number: block_number as i64,
        user_address: user.to_string(),
        tx_type: "unstake".to_string(),
        token_in: None,
        token_out: token,
        amount_in: None,
        amount_out: amount,
        usd_value,
        fee_paid: None,
        points_earned: None,
        is_private: false,
        timestamp: chrono::Utc::now(),
        processed: false,
    }
}

// Internal helper that builds inputs for `build_claim_transaction`.
fn build_claim_transaction(
    tx_hash: &str,
    block_number: u64,
    user: &str,
    data: &serde_json::Value,
) -> crate::models::Transaction {
    let token = extract_string_field(data, &["token", "token_out", "asset"]);
    let amount = extract_decimal_field(data, &["amount", "amount_out", "amount_units"]);
    let usd_value = extract_decimal_field(data, &["amount_usd", "usd_value", "usd_amount"]);

    crate::models::Transaction {
        tx_hash: tx_hash.to_string(),
        block_number: block_number as i64,
        user_address: user.to_string(),
        tx_type: "claim".to_string(),
        token_in: None,
        token_out: token,
        amount_in: None,
        amount_out: amount,
        usd_value,
        fee_paid: None,
        points_earned: None,
        is_private: false,
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
    let amount_in = extract_decimal_field(data, &["amount_in", "amount", "amount_in_units"]);
    let amount_out = extract_decimal_field(data, &["amount_out", "amount_out_units"]);
    let usd_value = extract_decimal_field(data, &["amount_usd", "usd_value", "usd_amount"]);

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
        amount_in,
        amount_out,
        usd_value,
        fee_paid: None,
        points_earned: None,
        is_private: false,
        timestamp: chrono::Utc::now(),
        processed: false,
    }
}

// Internal helper that supports `extract_string_field` operations.
fn extract_string_field(data: &serde_json::Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = data.get(*key) {
            if let Some(text) = value.as_str() {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }
    None
}

// Internal helper that supports `parse_decimal_value` operations.
fn parse_decimal_value(value: &serde_json::Value) -> Option<Decimal> {
    if let Some(num) = value.as_f64() {
        return Decimal::from_f64_retain(num);
    }
    if let Some(num) = value.as_i64() {
        return Decimal::from_i64(num);
    }
    if let Some(num) = value.as_u64() {
        return Decimal::from_u64(num);
    }
    if let Some(text) = value.as_str() {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return None;
        }
        if let Some(hex) = trimmed.strip_prefix("0x") {
            if let Ok(raw) = u128::from_str_radix(hex, 16) {
                return Decimal::from_u128(raw);
            }
        }
        if let Ok(parsed) = Decimal::from_str_exact(trimmed) {
            return Some(parsed);
        }
    }
    None
}

// Internal helper that supports `extract_decimal_field` operations.
fn extract_decimal_field(data: &serde_json::Value, keys: &[&str]) -> Option<Decimal> {
    for key in keys {
        if let Some(value) = data.get(*key) {
            if let Some(parsed) = parse_decimal_value(value) {
                return Some(parsed);
            }
        }
    }
    None
}

// Internal helper that supports `merge_transaction_map` operations.
fn merge_transaction_map(
    transactions: &mut HashMap<String, crate::models::Transaction>,
    incoming: crate::models::Transaction,
) {
    match transactions.get_mut(&incoming.tx_hash) {
        Some(existing) => merge_transaction(existing, incoming),
        None => {
            transactions.insert(incoming.tx_hash.clone(), incoming);
        }
    }
}

// Internal helper that supports `merge_transaction` operations.
fn merge_transaction(
    existing: &mut crate::models::Transaction,
    incoming: crate::models::Transaction,
) {
    if existing.block_number < incoming.block_number {
        existing.block_number = incoming.block_number;
    }
    if existing.user_address.is_empty() && !incoming.user_address.is_empty() {
        existing.user_address = incoming.user_address;
    }
    if existing.tx_type.is_empty() && !incoming.tx_type.is_empty() {
        existing.tx_type = incoming.tx_type;
    }
    if existing.token_in.is_none() {
        existing.token_in = incoming.token_in;
    }
    if existing.token_out.is_none() {
        existing.token_out = incoming.token_out;
    }
    if existing.amount_in.is_none() {
        existing.amount_in = incoming.amount_in;
    }
    if existing.amount_out.is_none() {
        existing.amount_out = incoming.amount_out;
    }
    if existing.usd_value.is_none() {
        existing.usd_value = incoming.usd_value;
    }
    if existing.fee_paid.is_none() {
        existing.fee_paid = incoming.fee_paid;
    }
    if existing.points_earned.is_none() {
        existing.points_earned = incoming.points_earned;
    }
    if incoming.timestamp > existing.timestamp {
        existing.timestamp = incoming.timestamp;
    }
    if incoming.processed {
        existing.processed = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
