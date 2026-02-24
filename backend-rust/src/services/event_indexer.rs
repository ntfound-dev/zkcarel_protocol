use crate::{
    config::Config,
    constants::INDEXER_INTERVAL_SECS,
    db::Database,
    error::Result,
    indexer::{
        block_processor::BlockProcessor, event_parser::EventParser, starknet_client::StarknetClient,
    },
};
use std::sync::Arc;
use tokio::time::{interval, sleep, Duration};

const INDEXER_DEFAULT_INITIAL_BACKFILL_BLOCKS: u64 = 128;
const INDEXER_DEFAULT_MAX_BLOCKS_PER_TICK: u64 = 32;
const INDEXER_TRANSIENT_BACKOFF_MAX_SECS: u64 = 300;

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

// Internal helper that supports `env_non_empty` operations.
fn env_non_empty(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

// Internal helper that supports `parse_rpc_url_list` operations.
fn parse_rpc_url_list(raw: &str) -> Vec<String> {
    raw.split([',', ';', '\n', '\r', ' '])
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect()
}

// Internal helper that supports `indexer_rpc_url` operations.
fn indexer_rpc_url(config: &Config) -> String {
    env_non_empty("STARKNET_INDEXER_RPC_URL").unwrap_or_else(|| config.starknet_rpc_url.clone())
}

// Internal helper that supports `indexer_rpc_urls` operations.
fn indexer_rpc_urls(config: &Config) -> Vec<String> {
    let mut urls = env_non_empty("STARKNET_INDEXER_RPC_POOL")
        .map(|raw| parse_rpc_url_list(&raw))
        .unwrap_or_default();
    if urls.is_empty() {
        urls.extend(parse_rpc_url_list(&indexer_rpc_url(config)));
    }
    if urls.is_empty() {
        urls.push(config.starknet_rpc_url.clone());
    }
    urls
}

// Internal helper that checks conditions for `is_transient_indexer_error`.
fn is_transient_indexer_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("error decoding response body")
        || lower.contains("too many requests")
        || lower.contains("429")
        || lower.contains("timeout")
        || lower.contains("timed out")
        || lower.contains("gateway")
        || lower.contains("temporarily unavailable")
        || lower.contains("connection reset")
        || lower.contains("eof while parsing")
}

// Internal helper that supports `transient_backoff_secs` operations.
fn transient_backoff_secs(failures: u32) -> u64 {
    let exponent = failures.saturating_sub(1).min(5);
    let multiplier = 1_u64 << exponent;
    let candidate = INDEXER_INTERVAL_SECS.saturating_mul(multiplier);
    candidate.clamp(INDEXER_INTERVAL_SECS, INDEXER_TRANSIENT_BACKOFF_MAX_SECS)
}

/// Event Indexer - Scans blockchain for CAREL Protocol events
pub struct EventIndexer {
    db: Database,
    config: Config,
    last_block: Arc<tokio::sync::RwLock<u64>>,
    client: StarknetClient,
    parser: EventParser,
}

impl EventIndexer {
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
    pub fn new(db: Database, config: Config) -> Self {
        let rpc_urls = indexer_rpc_urls(&config);
        Self {
            client: StarknetClient::new_with_urls(rpc_urls),
            parser: EventParser::new(),
            db,
            config,
            last_block: Arc::new(tokio::sync::RwLock::new(0)),
        }
    }

    // Internal helper that supports `contract_targets` operations.
    fn contract_targets(&self) -> Vec<String> {
        let mut targets = Vec::new();
        push_valid_address(&mut targets, &self.config.bridge_aggregator_address);
        push_valid_address(&mut targets, &self.config.snapshot_distributor_address);
        if let Some(addr) = self.config.staking_carel_address.as_deref() {
            push_valid_address(&mut targets, addr);
        }
        if let Some(addr) = self.config.referral_system_address.as_deref() {
            push_valid_address(&mut targets, addr);
        }
        push_valid_address(&mut targets, &self.config.limit_order_book_address);
        targets
    }

    // Internal helper that supports `initial_backfill_blocks` operations.
    fn initial_backfill_blocks(&self) -> u64 {
        std::env::var("INDEXER_INITIAL_BACKFILL_BLOCKS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(INDEXER_DEFAULT_INITIAL_BACKFILL_BLOCKS)
    }

    // Internal helper that supports `max_blocks_per_tick` operations.
    fn max_blocks_per_tick(&self) -> u64 {
        std::env::var("INDEXER_MAX_BLOCKS_PER_TICK")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(INDEXER_DEFAULT_MAX_BLOCKS_PER_TICK)
    }

    /// Start the event indexer loop
    pub async fn start(self: Arc<Self>) {
        tokio::spawn(async move {
            let contract_targets = self.contract_targets();
            if contract_targets.is_empty() {
                tracing::warn!("No valid contract targets configured for event indexer");
            } else {
                tracing::info!("Indexing contracts: {:?}", contract_targets);
            }
            if !is_env_flag_enabled("USE_STARKNET_RPC") {
                tracing::warn!(
                    "Event indexer is enabled but USE_STARKNET_RPC is disabled; scans will be skipped"
                );
            }

            let mut ticker = interval(Duration::from_secs(INDEXER_INTERVAL_SECS));
            let mut transient_failures: u32 = 0;

            loop {
                ticker.tick().await;

                match self.scan_events().await {
                    Ok(()) => {
                        transient_failures = 0;
                    }
                    Err(e) => {
                        let err_text = e.to_string();
                        if is_transient_indexer_error(&err_text) {
                            transient_failures = transient_failures.saturating_add(1);
                            let backoff_secs = transient_backoff_secs(transient_failures);
                            tracing::warn!(
                                "Event indexer transient error: {} (backoff={}s, failures={})",
                                err_text,
                                backoff_secs,
                                transient_failures
                            );
                            sleep(Duration::from_secs(backoff_secs)).await;
                        } else {
                            transient_failures = 0;
                            tracing::error!("Event indexer error: {}", err_text);
                        }
                    }
                }
            }
        });
    }

    /// Scan for new events from last block to current
    async fn scan_events(&self) -> Result<()> {
        if !is_env_flag_enabled("USE_STARKNET_RPC") {
            return Ok(());
        }

        let previous_last_block = *self.last_block.read().await;
        let current_block = self.get_current_block().await?;

        if current_block <= previous_last_block {
            return Ok(());
        }

        let initial_backfill = self.initial_backfill_blocks();
        let max_blocks_per_tick = self.max_blocks_per_tick();

        let start_block = if previous_last_block == 0 {
            current_block.saturating_sub(initial_backfill.saturating_sub(1))
        } else {
            previous_last_block + 1
        };
        if start_block > current_block {
            return Ok(());
        }
        let end_block = start_block
            .saturating_add(max_blocks_per_tick.saturating_sub(1))
            .min(current_block);

        tracing::info!(
            "Scanning blocks {} to {} (head: {}, previous_last: {})",
            start_block,
            end_block,
            current_block,
            previous_last_block
        );

        let use_block_processor =
            is_env_flag_enabled("USE_STARKNET_RPC") && is_env_flag_enabled("USE_BLOCK_PROCESSOR");
        let processor = if use_block_processor {
            let rpc_urls = indexer_rpc_urls(&self.config);
            Some(BlockProcessor::new(
                StarknetClient::new_with_urls(rpc_urls),
                self.db.clone(),
            ))
        } else {
            None
        };

        let mut last_successful_block = previous_last_block;
        if let Some(processor) = processor.as_ref() {
            for block in start_block..=end_block {
                let result = processor.process_block(block).await.map(|_| ());
                match result {
                    Ok(()) => {
                        last_successful_block = block;
                    }
                    Err(error) => {
                        let err_text = error.to_string();
                        if is_transient_indexer_error(&err_text) {
                            tracing::debug!(
                                "Event indexer transient block failure on {}: {}. Will retry from this block on next tick",
                                block,
                                err_text
                            );
                        } else {
                            tracing::warn!(
                                "Event indexer failed on block {}: {}. Will retry from this block on next tick",
                                block,
                                err_text
                            );
                        }
                        if last_successful_block > previous_last_block {
                            *self.last_block.write().await = last_successful_block;
                        }
                        return Err(error);
                    }
                }
            }
        } else {
            match self.process_block_range(start_block, end_block).await {
                Ok(()) => {
                    last_successful_block = end_block;
                }
                Err(error) => {
                    let err_text = error.to_string();
                    if is_transient_indexer_error(&err_text) {
                        tracing::debug!(
                            "Event indexer transient range failure on {}..{}: {}. Will retry from this range on next tick",
                            start_block,
                            end_block,
                            err_text
                        );
                    } else {
                        tracing::warn!(
                            "Event indexer failed on range {}..{}: {}. Will retry from this range on next tick",
                            start_block,
                            end_block,
                            err_text
                        );
                    }
                    return Err(error);
                }
            }
        }

        if last_successful_block > previous_last_block {
            *self.last_block.write().await = last_successful_block;
        }

        Ok(())
    }

    /// Get current blockchain block number
    async fn get_current_block(&self) -> Result<u64> {
        if is_env_flag_enabled("USE_STARKNET_RPC") {
            return self.client.get_block_number().await;
        }
        Ok(0)
    }

    /// Process a block range by querying events in larger chunks.
    async fn process_block_range(&self, start_block: u64, end_block: u64) -> Result<()> {
        let events = self.get_range_events(start_block, end_block).await?;
        for event in events {
            self.process_event(event.event, event.block_number).await?;
        }

        Ok(())
    }

    /// Get events from a block range for indexed contracts.
    async fn get_range_events(
        &self,
        start_block: u64,
        end_block: u64,
    ) -> Result<Vec<IndexedBlockchainEvent>> {
        let mut out = Vec::new();
        if !is_env_flag_enabled("USE_STARKNET_RPC") {
            return Ok(out);
        }

        let targets = self.contract_targets();
        if targets.is_empty() {
            return Ok(out);
        }

        for contract in targets {
            let events = self
                .client
                .get_events(Some(contract.as_str()), start_block, end_block)
                .await?;

            for ev in events {
                if let Some(parsed) = self.parser.parse_event(&ev) {
                    let mut data = parsed.data;
                    normalize_event_data(&self.parser, &mut data);

                    let block_number = ev.block_number.unwrap_or(start_block);
                    let tx_hash = ev
                        .transaction_hash
                        .clone()
                        .unwrap_or_else(|| format!("{}:{}", ev.from_address, block_number));

                    out.push(IndexedBlockchainEvent {
                        event: BlockchainEvent {
                            tx_hash,
                            event_type: parsed.event_type,
                            data,
                        },
                        block_number,
                    });
                }
            }
        }

        Ok(out)
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

    // Internal helper that supports `handle_swap_event` operations.
    async fn handle_swap_event(&self, event: BlockchainEvent, block_number: u64) -> Result<()> {
        // Parse swap event data
        let user = event
            .data
            .get("user")
            .and_then(|v| v.as_str())
            .unwrap_or("");
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
            token_in: event
                .data
                .get("token_in")
                .and_then(|v| v.as_str())
                .map(String::from),
            token_out: event
                .data
                .get("token_out")
                .and_then(|v| v.as_str())
                .map(String::from),
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

    // Internal helper that supports `handle_bridge_event` operations.
    async fn handle_bridge_event(&self, event: BlockchainEvent, block_number: u64) -> Result<()> {
        let user = event
            .data
            .get("user")
            .and_then(|v| v.as_str())
            .unwrap_or("");

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

    // Internal helper that supports `handle_stake_event` operations.
    async fn handle_stake_event(&self, event: BlockchainEvent, block_number: u64) -> Result<()> {
        let user = event
            .data
            .get("user")
            .and_then(|v| v.as_str())
            .unwrap_or("");

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

    // Internal helper that supports `handle_unstake_event` operations.
    async fn handle_unstake_event(&self, event: BlockchainEvent, block_number: u64) -> Result<()> {
        let user = event
            .data
            .get("user")
            .and_then(|v| v.as_str())
            .unwrap_or("");

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

    // Internal helper that supports `handle_claim_event` operations.
    async fn handle_claim_event(&self, event: BlockchainEvent, block_number: u64) -> Result<()> {
        let user = event
            .data
            .get("user")
            .and_then(|v| v.as_str())
            .unwrap_or("");

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

    // Internal helper that supports `handle_order_filled` operations.
    async fn handle_order_filled(&self, event: BlockchainEvent, _block_number: u64) -> Result<()> {
        let order_id = event
            .data
            .get("order_id")
            .and_then(|v| v.as_str())
            .unwrap_or("");

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

#[derive(Debug, Clone)]
struct IndexedBlockchainEvent {
    event: BlockchainEvent,
    block_number: u64,
}

// Internal helper that parses or transforms values for `normalize_event_data`.
fn normalize_event_data(parser: &EventParser, data: &mut serde_json::Value) {
    if let Some(user) = data.get("user").and_then(|v| v.as_str()) {
        let addr = parser.hex_to_address(user);
        data["user"] = serde_json::Value::String(addr);
    }

    if let Some(amount_hex) = data.get("amount_in").and_then(|v| v.as_str()) {
        let _ = parser.hex_to_decimal(amount_hex);
    }
}

// Internal helper that supports `push_valid_address` operations.
fn push_valid_address(targets: &mut Vec<String>, address: &str) {
    let trimmed = address.trim();
    if trimmed.is_empty() || trimmed.starts_with("0x0000") {
        return;
    }
    targets.push(trimmed.to_string());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    // Internal helper that parses or transforms values for `normalize_event_data_adds_prefix`.
    fn normalize_event_data_adds_prefix() {
        // Memastikan user di-normalisasi ke format 0x
        let parser = EventParser::new();
        let mut data = serde_json::json!({"user": "abc", "amount_in": "0x10"});
        normalize_event_data(&parser, &mut data);
        assert_eq!(data.get("user").and_then(|v| v.as_str()), Some("0xabc"));
    }
}
