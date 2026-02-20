use crate::services::onchain::{
    felt_to_u128, parse_felt, u256_from_felts, OnchainInvoker, OnchainReader,
};
use crate::{
    config::Config,
    constants::{
        EPOCH_DURATION_SECONDS, MULTIPLIER_TIER_1, MULTIPLIER_TIER_2, MULTIPLIER_TIER_3,
        MULTIPLIER_TIER_4, POINTS_BATTLE_HIT, POINTS_BATTLE_LOSS, POINTS_BATTLE_MISS,
        POINTS_BATTLE_TIMEOUT_WIN, POINTS_BATTLE_WIN, POINTS_MIN_STAKE_BTC, POINTS_MIN_STAKE_CAREL,
        POINTS_MIN_STAKE_LP, POINTS_MIN_STAKE_STABLECOIN, POINTS_MIN_STAKE_STRK,
        POINTS_MIN_USD_BRIDGE_BTC, POINTS_MIN_USD_BRIDGE_ETH, POINTS_MIN_USD_LIMIT_ORDER,
        POINTS_MIN_USD_SWAP, POINTS_MIN_USD_SWAP_TESTNET, POINTS_MULTIPLIER_STAKE_BTC,
        POINTS_MULTIPLIER_STAKE_CAREL_TIER_1, POINTS_MULTIPLIER_STAKE_CAREL_TIER_2,
        POINTS_MULTIPLIER_STAKE_CAREL_TIER_3, POINTS_MULTIPLIER_STAKE_LP,
        POINTS_MULTIPLIER_STAKE_STABLECOIN, POINTS_PER_USD_BRIDGE_BTC, POINTS_PER_USD_BRIDGE_ETH,
        POINTS_PER_USD_LIMIT_ORDER, POINTS_PER_USD_STAKE, POINTS_PER_USD_SWAP,
        POINT_CALCULATOR_INTERVAL_SECS,
    },
    db::Database,
    error::Result,
};
use rust_decimal::prelude::{FromPrimitive, ToPrimitive};
use rust_decimal::Decimal;
use sqlx::Row;
use starknet_core::types::{Call, Felt, FunctionCall};
use starknet_core::utils::get_selector_from_name;
use std::sync::Arc;
use tokio::time::{interval, Duration};

/// Point Calculator - Calculates trading points with anti-wash trading detection
pub struct PointCalculator {
    db: Database,
    config: Config,
    onchain: Option<OnchainInvoker>,
}

const REFERRAL_MIN_USD_VOLUME: i64 = 20;
const REFERRAL_REFERRER_BONUS_BPS: i64 = 1000; // 10%
const REFERRAL_REFEREE_BONUS_BPS: i64 = 1000; // 10%

impl PointCalculator {
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
        let onchain = OnchainInvoker::from_config(&config).ok().flatten();
        Self {
            db,
            config,
            onchain,
        }
    }

    /// Start point calculation loop
    pub async fn start(self: Arc<Self>) {
        tokio::spawn(async move {
            let interval_secs = if self.config.is_testnet() {
                10
            } else {
                POINT_CALCULATOR_INTERVAL_SECS
            };
            let mut ticker = interval(Duration::from_secs(interval_secs));

            loop {
                ticker.tick().await;

                if let Err(e) = self.calculate_pending_points().await {
                    tracing::error!("Point calculator error: {}", e);
                }
            }
        });
    }

    /// Calculate points for all pending transactions
    async fn calculate_pending_points(&self) -> Result<()> {
        if self.config.is_testnet() {
            tracing::debug!("Point calculator running in testnet mode");
        }
        let batch_size = self.config.point_calculator_batch_size.max(1) as i64;
        let max_batches = self.config.point_calculator_max_batches_per_tick.max(1);

        let mut fetched_total = 0usize;
        let mut processed_total = 0usize;
        let mut failed_total = 0usize;

        for _ in 0..max_batches {
            let transactions = sqlx::query_as::<_, crate::models::Transaction>(
                "SELECT * FROM transactions WHERE processed = false ORDER BY timestamp ASC LIMIT $1",
            )
            .bind(batch_size)
            .fetch_all(self.db.pool())
            .await?;

            if transactions.is_empty() {
                break;
            }

            let batch_len = transactions.len();
            fetched_total += batch_len;

            for tx in transactions {
                match self.process_transaction(&tx).await {
                    Ok(()) => processed_total += 1,
                    Err(err) => {
                        failed_total += 1;
                        tracing::error!(
                            "Point calculator failed to process tx: tx_hash={}, user={}, tx_type={}, error={}",
                            tx.tx_hash,
                            tx.user_address,
                            tx.tx_type,
                            err
                        );
                    }
                }
            }

            if batch_len < batch_size as usize {
                break;
            }
        }

        if fetched_total > 0 {
            tracing::info!(
                "Point calculator tick complete: fetched={}, processed={}, failed={}, batch_size={}, max_batches={}",
                fetched_total,
                processed_total,
                failed_total,
                batch_size,
                max_batches
            );
        }

        Ok(())
    }

    /// Process a single transaction and calculate points
    async fn process_transaction(&self, tx: &crate::models::Transaction) -> Result<()> {
        // Check for wash trading
        if self.is_wash_trading(&tx.user_address, &tx.tx_hash).await? {
            tracing::warn!("Wash trading detected for user: {}", tx.user_address);

            sqlx::query("UPDATE transactions SET processed = true WHERE tx_hash = $1")
                .bind(&tx.tx_hash)
                .execute(self.db.pool())
                .await?;

            self.flag_wash_trading(&tx.user_address).await?;
            return Ok(());
        }

        let current_epoch = (chrono::Utc::now().timestamp() / EPOCH_DURATION_SECONDS) as i64;
        let prev_total: Decimal = sqlx::query_scalar(
            "SELECT COALESCE(total_points, 0) FROM points WHERE user_address = $1 AND epoch = $2",
        )
        .bind(&tx.user_address)
        .bind(current_epoch)
        .fetch_optional(self.db.pool())
        .await?
        .unwrap_or(Decimal::ZERO);

        let points = match tx.tx_type.as_str() {
            "swap" => self.calculate_swap_points(tx).await?,
            "limit_order" => self.calculate_limit_order_points(tx).await?,
            "bridge" => self.calculate_bridge_points(tx).await?,
            "stake" => self.calculate_stake_points(tx).await?,
            "battle_hit" | "battle_miss" | "battle_win" | "battle_loss" | "battle_tmo_win" => {
                self.calculate_battleship_points(tx)
            }
            _ => 0.0,
        };

        let points_decimal = rust_decimal::Decimal::from_f64_retain(points).unwrap_or_default();

        match tx.tx_type.as_str() {
            "swap" | "limit_order" => {
                self.db
                    .create_or_update_points(
                        &tx.user_address,
                        current_epoch,
                        points_decimal,
                        rust_decimal::Decimal::ZERO,
                        rust_decimal::Decimal::ZERO,
                    )
                    .await?;
            }
            "bridge" => {
                self.db
                    .create_or_update_points(
                        &tx.user_address,
                        current_epoch,
                        rust_decimal::Decimal::ZERO,
                        points_decimal,
                        rust_decimal::Decimal::ZERO,
                    )
                    .await?;
            }
            "stake" => {
                self.db
                    .create_or_update_points(
                        &tx.user_address,
                        current_epoch,
                        rust_decimal::Decimal::ZERO,
                        rust_decimal::Decimal::ZERO,
                        points_decimal,
                    )
                    .await?;
            }
            "battle_hit" | "battle_miss" | "battle_win" | "battle_loss" | "battle_tmo_win" => {
                self.db
                    .add_social_points(&tx.user_address, current_epoch, points_decimal)
                    .await?;
            }
            _ => {}
        }

        // Apply multipliers after point updates
        self.apply_multipliers(&tx.user_address, current_epoch)
            .await?;

        let new_total: Decimal = sqlx::query_scalar(
            "SELECT COALESCE(total_points, 0) FROM points WHERE user_address = $1 AND epoch = $2",
        )
        .bind(&tx.user_address)
        .bind(current_epoch)
        .fetch_one(self.db.pool())
        .await?;

        if let Err(err) = self
            .sync_points_total_onchain(current_epoch, &tx.user_address, new_total)
            .await
        {
            tracing::warn!(
                "Failed to sync trading points onchain: user={}, epoch={}, error={}",
                tx.user_address,
                current_epoch,
                err
            );
        }

        let eligible_for_referral = matches!(
            tx.tx_type.as_str(),
            "swap" | "limit_order" | "bridge" | "stake"
        );
        if eligible_for_referral {
            self.apply_referral_bonus(&tx.user_address, current_epoch, prev_total, new_total)
                .await?;
        }

        sqlx::query(
            "UPDATE transactions SET points_earned = $1, processed = true WHERE tx_hash = $2",
        )
        .bind(points_decimal)
        .bind(&tx.tx_hash)
        .execute(self.db.pool())
        .await?;

        tracing::info!(
            "Points calculated: user={}, type={}, points={}",
            tx.user_address,
            tx.tx_type,
            points
        );

        Ok(())
    }

    // Internal helper that supports `calculate_swap_points` operations.
    async fn calculate_swap_points(&self, tx: &crate::models::Transaction) -> Result<f64> {
        let usd_value = tx.usd_value.and_then(|v| v.to_f64()).unwrap_or(0.0);
        let min_usd = if self.config.is_testnet() {
            POINTS_MIN_USD_SWAP_TESTNET
        } else {
            POINTS_MIN_USD_SWAP
        };
        if usd_value < min_usd {
            return Ok(0.0);
        }
        self.apply_nft_discount_bonus(&tx.user_address, usd_value * POINTS_PER_USD_SWAP)
            .await
    }

    // Internal helper that supports `calculate_limit_order_points` operations.
    async fn calculate_limit_order_points(&self, tx: &crate::models::Transaction) -> Result<f64> {
        let usd_value = tx.usd_value.and_then(|v| v.to_f64()).unwrap_or(0.0);
        if usd_value < POINTS_MIN_USD_LIMIT_ORDER {
            return Ok(0.0);
        }
        self.apply_nft_discount_bonus(&tx.user_address, usd_value * POINTS_PER_USD_LIMIT_ORDER)
            .await
    }

    // Internal helper that supports `calculate_bridge_points` operations.
    async fn calculate_bridge_points(&self, tx: &crate::models::Transaction) -> Result<f64> {
        let usd_value = tx.usd_value.and_then(|v| v.to_f64()).unwrap_or(0.0);
        let is_btc_bridge = is_btc_bridge(tx);
        let (min_threshold, per_usd_rate) = if is_btc_bridge {
            (POINTS_MIN_USD_BRIDGE_BTC, POINTS_PER_USD_BRIDGE_BTC)
        } else {
            (POINTS_MIN_USD_BRIDGE_ETH, POINTS_PER_USD_BRIDGE_ETH)
        };
        if usd_value < min_threshold {
            return Ok(0.0);
        }
        self.apply_nft_discount_bonus(&tx.user_address, usd_value * per_usd_rate)
            .await
    }

    // Internal helper that supports `calculate_stake_points` operations.
    async fn calculate_stake_points(&self, tx: &crate::models::Transaction) -> Result<f64> {
        let amount = tx.amount_in.and_then(|v| v.to_f64()).unwrap_or(0.0);
        let usd_value = tx.usd_value.and_then(|v| v.to_f64()).unwrap_or(0.0);
        if amount <= 0.0 || usd_value <= 0.0 {
            return Ok(0.0);
        }

        let token = tx
            .token_in
            .as_deref()
            .unwrap_or("CAREL")
            .to_ascii_uppercase();
        let multiplier = stake_points_multiplier_for(&token, amount);
        if multiplier <= 0.0 {
            return Ok(0.0);
        }

        self.apply_nft_discount_bonus(
            &tx.user_address,
            usd_value * POINTS_PER_USD_STAKE * multiplier,
        )
        .await
    }

    // Internal helper that supports `calculate_battleship_points` operations.
    fn calculate_battleship_points(&self, tx: &crate::models::Transaction) -> f64 {
        match tx.tx_type.as_str() {
            "battle_hit" => POINTS_BATTLE_HIT,
            "battle_miss" => POINTS_BATTLE_MISS,
            "battle_win" => POINTS_BATTLE_WIN,
            "battle_loss" => POINTS_BATTLE_LOSS,
            "battle_tmo_win" => POINTS_BATTLE_TIMEOUT_WIN,
            _ => 0.0,
        }
    }

    // Internal helper that supports `apply_nft_discount_bonus` operations.
    async fn apply_nft_discount_bonus(&self, user_address: &str, base_points: f64) -> Result<f64> {
        if base_points <= 0.0 {
            return Ok(0.0);
        }
        let discount = self.active_nft_discount_rate(user_address).await?;
        let boosted = base_points * nft_factor_for_discount(discount);
        Ok(boosted)
    }

    // Internal helper that supports `current_staked_carel_amount` operations.
    async fn current_staked_carel_amount(&self, user_address: &str) -> Result<f64> {
        let amount: Option<f64> = sqlx::query_scalar(
            r#"
            SELECT COALESCE(SUM(
                CASE
                    WHEN tx_type = 'stake' THEN COALESCE(amount_in, 0)
                    WHEN tx_type = 'unstake' THEN -COALESCE(amount_in, 0)
                    ELSE 0
                END
            ), 0)::FLOAT
            FROM transactions
            WHERE user_address = $1
              AND token_in = 'CAREL'
            "#,
        )
        .bind(user_address)
        .fetch_optional(self.db.pool())
        .await?;

        Ok(amount.unwrap_or(0.0).max(0.0))
    }

    // Internal helper that supports `active_nft_discount_rate` operations.
    async fn active_nft_discount_rate(&self, user_address: &str) -> Result<f64> {
        let Some(contract) = self.config.discount_soulbound_address.as_deref() else {
            return Ok(0.0);
        };
        if contract.trim().is_empty() || contract.starts_with("0x0000") {
            return Ok(0.0);
        }
        let reader = match OnchainReader::from_config(&self.config) {
            Ok(value) => value,
            Err(err) => {
                tracing::warn!(
                    "Failed to initialize on-chain reader for NFT discount: {}",
                    err
                );
                return Ok(0.0);
            }
        };
        let contract_felt = match parse_felt(contract) {
            Ok(value) => value,
            Err(err) => {
                tracing::warn!(
                    "Invalid discount contract address for NFT discount check: {}",
                    err
                );
                return Ok(0.0);
            }
        };
        let user_felt = match parse_felt(user_address) {
            Ok(value) => value,
            Err(err) => {
                tracing::warn!(
                    "Invalid user address for NFT discount check: user={}, error={}",
                    user_address,
                    err
                );
                return Ok(0.0);
            }
        };
        let call = FunctionCall {
            contract_address: contract_felt,
            entry_point_selector: get_selector_from_name("has_active_discount")
                .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?,
            calldata: vec![user_felt],
        };
        let result = match reader.call(call).await {
            Ok(value) => value,
            Err(err) => {
                tracing::warn!(
                    "Failed on-chain NFT discount check for user={}: {}",
                    user_address,
                    err
                );
                return Ok(0.0);
            }
        };
        if result.len() < 3 {
            return Ok(0.0);
        }
        let active = felt_to_u128(&result[0]).unwrap_or(0) > 0;
        if !active {
            return Ok(0.0);
        }
        let discount = u256_from_felts(&result[1], &result[2]).unwrap_or(0) as f64;
        Ok(discount.max(0.0))
    }

    // Internal helper that checks conditions for `is_wash_trading`.
    async fn is_wash_trading(&self, user_address: &str, current_tx: &str) -> Result<bool> {
        let row = sqlx::query(
            "SELECT COUNT(*) as count FROM transactions
             WHERE user_address = $1 
             AND timestamp > NOW() - INTERVAL '5 minutes'
             AND tx_hash != $2
             AND tx_type = 'swap'",
        )
        .bind(user_address)
        .bind(current_tx)
        .fetch_one(self.db.pool())
        .await?;

        Ok(row.get::<i64, _>("count") > 5)
    }

    // Internal helper that supports `flag_wash_trading` operations.
    async fn flag_wash_trading(&self, user_address: &str) -> Result<()> {
        let current_epoch = (chrono::Utc::now().timestamp() / EPOCH_DURATION_SECONDS) as i64;

        sqlx::query(
            "UPDATE points SET wash_trading_flagged = true
             WHERE user_address = $1 AND epoch = $2",
        )
        .bind(user_address)
        .bind(current_epoch)
        .execute(self.db.pool())
        .await?;

        Ok(())
    }

    /// Handles `apply_multipliers` logic.
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
    pub async fn apply_multipliers(&self, user_address: &str, epoch: i64) -> Result<()> {
        let stake_amount = self.current_staked_carel_amount(user_address).await?;
        let multiplier = staking_multiplier_for(stake_amount);
        let nft_discount = self.active_nft_discount_rate(user_address).await?;
        let nft_boost = nft_discount > 0.0;
        let nft_factor = nft_factor_for_discount(nft_discount);

        sqlx::query(
            "UPDATE points 
             SET staking_multiplier = $1,
                 nft_boost = $2,
                 total_points = (swap_points + bridge_points + stake_points + referral_points + social_points) * $1 * $3
             WHERE user_address = $4 AND epoch = $5"
        )
        .bind(rust_decimal::Decimal::from_f64_retain(multiplier).unwrap())
        .bind(nft_boost)
        .bind(rust_decimal::Decimal::from_f64_retain(nft_factor).unwrap())
        .bind(user_address)
        .bind(epoch)
        .execute(self.db.pool())
        .await?;

        Ok(())
    }

    // Internal helper that supports `apply_referral_bonus` operations.
    async fn apply_referral_bonus(
        &self,
        referee_address: &str,
        epoch: i64,
        prev_total: Decimal,
        new_total: Decimal,
    ) -> Result<()> {
        if new_total <= prev_total {
            return Ok(());
        }

        let referrer_raw: Option<String> =
            sqlx::query_scalar("SELECT COALESCE(referrer, '') FROM users WHERE address = $1")
                .bind(referee_address)
                .fetch_optional(self.db.pool())
                .await?;

        let referrer = match referrer_raw {
            Some(value) => value.trim().to_string(),
            None => return Ok(()),
        };
        if referrer.is_empty() {
            return Ok(());
        }

        // Referral bonus aktif hanya untuk referee yang sudah punya volume transaksi kumulatif >= $20.
        let total_referee_volume_usd: Decimal = sqlx::query_scalar(
            "SELECT COALESCE(SUM(ABS(COALESCE(usd_value, 0))), 0)
             FROM transactions
             WHERE LOWER(user_address) = LOWER($1)",
        )
        .bind(referee_address)
        .fetch_optional(self.db.pool())
        .await?
        .unwrap_or(Decimal::ZERO);

        let min_volume = Decimal::from_i64(REFERRAL_MIN_USD_VOLUME).unwrap_or(Decimal::ZERO);
        if total_referee_volume_usd < min_volume {
            return Ok(());
        }

        let delta = new_total - prev_total;
        let referrer_bonus = delta
            * Decimal::from_i64(REFERRAL_REFERRER_BONUS_BPS).unwrap_or(Decimal::ZERO)
            / Decimal::new(10000, 0);
        let referee_bonus = delta
            * Decimal::from_i64(REFERRAL_REFEREE_BONUS_BPS).unwrap_or(Decimal::ZERO)
            / Decimal::new(10000, 0);
        if referrer_bonus <= Decimal::ZERO && referee_bonus <= Decimal::ZERO {
            return Ok(());
        }

        // 1) Bonus untuk referee (user yang diundang).
        if referee_bonus > Decimal::ZERO {
            self.db
                .add_referral_points(referee_address, epoch, referee_bonus)
                .await?;
            self.apply_multipliers(referee_address, epoch).await?;

            let updated_referee_total: Decimal = sqlx::query_scalar(
                "SELECT COALESCE(total_points, 0) FROM points WHERE user_address = $1 AND epoch = $2",
            )
            .bind(referee_address)
            .bind(epoch)
            .fetch_optional(self.db.pool())
            .await?
            .unwrap_or(Decimal::ZERO);

            if let Err(err) = self
                .sync_points_total_onchain(epoch, referee_address, updated_referee_total)
                .await
            {
                tracing::warn!(
                    "Failed to sync referee total points onchain: referee={}, epoch={}, error={}",
                    referee_address,
                    epoch,
                    err
                );
            }
        }

        // 2) Bonus untuk referrer.
        if referrer_bonus > Decimal::ZERO {
            self.db
                .add_referral_points(&referrer, epoch, referrer_bonus)
                .await?;
            self.apply_multipliers(&referrer, epoch).await?;

            let updated_referrer_total: Decimal = sqlx::query_scalar(
                "SELECT COALESCE(total_points, 0) FROM points WHERE user_address = $1 AND epoch = $2",
            )
            .bind(&referrer)
            .bind(epoch)
            .fetch_optional(self.db.pool())
            .await?
            .unwrap_or(Decimal::ZERO);

            if let Err(err) = self
                .sync_points_total_onchain(epoch, &referrer, updated_referrer_total)
                .await
            {
                tracing::warn!(
                    "Failed to sync referrer total points onchain: referrer={}, epoch={}, error={}",
                    referrer,
                    epoch,
                    err
                );
            }
        }

        let referee_total_for_referral_sync = if referee_bonus > Decimal::ZERO {
            new_total + referee_bonus
        } else {
            new_total
        };

        if let Err(err) = self
            .sync_referral_onchain(epoch, referee_address, referee_total_for_referral_sync)
            .await
        {
            tracing::warn!(
                "Failed to sync referral onchain: referee={}, epoch={}, error={}",
                referee_address,
                epoch,
                err
            );
        }

        Ok(())
    }

    // Internal helper that supports `sync_referral_onchain` operations.
    async fn sync_referral_onchain(
        &self,
        epoch: i64,
        referee_address: &str,
        total_points: Decimal,
    ) -> Result<()> {
        let referral_contract = match &self.config.referral_system_address {
            Some(addr) if !addr.trim().is_empty() => addr,
            _ => return Ok(()),
        };
        let Some(invoker) = &self.onchain else {
            return Ok(());
        };

        let points_u128 = total_points.trunc().to_u128().unwrap_or(0);
        if points_u128 == 0 {
            return Ok(());
        }

        let call = build_referral_call(
            referral_contract,
            epoch as u64,
            referee_address,
            points_u128,
        )?;

        let tx_hash = invoker.invoke(call).await?;
        tracing::info!(
            "Referral points synced onchain: referee={}, epoch={}, tx={}",
            referee_address,
            epoch,
            tx_hash
        );

        Ok(())
    }

    // Internal helper that supports `sync_points_total_onchain` operations.
    async fn sync_points_total_onchain(
        &self,
        epoch: i64,
        user_address: &str,
        expected_total: Decimal,
    ) -> Result<()> {
        let contract = self.config.point_storage_address.trim();
        if contract.is_empty() || contract.starts_with("0x0000") {
            return Ok(());
        }
        let Some(invoker) = &self.onchain else {
            return Ok(());
        };

        let expected_u128 = expected_total
            .max(Decimal::ZERO)
            .trunc()
            .to_u128()
            .unwrap_or(0);
        if expected_u128 == 0 {
            return Ok(());
        }

        // Write exact aggregate points to on-chain storage to avoid drift/race from repeated delta adds.
        let submit_call = build_point_storage_submit_points_call(
            contract,
            epoch as u64,
            user_address,
            expected_u128,
        )?;
        let tx_hash = invoker.invoke(submit_call).await?;
        tracing::info!(
            "Trading points synced onchain: user={}, epoch={}, total={}, tx={}",
            user_address,
            epoch,
            expected_u128,
            tx_hash
        );

        Ok(())
    }
}

// Internal helper that builds inputs for `build_referral_call`.
fn build_referral_call(
    contract: &str,
    epoch: u64,
    referee: &str,
    total_points: u128,
) -> Result<Call> {
    let to = parse_felt(contract)?;
    let selector = get_selector_from_name("record_referee_points")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    let referee_felt = parse_felt(referee)?;

    let calldata = vec![
        Felt::from(epoch as u128),
        referee_felt,
        Felt::from(total_points),
        Felt::from(0_u128),
    ];

    Ok(Call {
        to,
        selector,
        calldata,
    })
}

// Internal helper that builds inputs for `build_point_storage_submit_points_call`.
fn build_point_storage_submit_points_call(
    contract: &str,
    epoch: u64,
    user: &str,
    points: u128,
) -> Result<Call> {
    let to = parse_felt(contract)?;
    let selector = get_selector_from_name("submit_points")
        .map_err(|e| crate::error::AppError::Internal(format!("Selector error: {}", e)))?;
    let user_felt = parse_felt(user)?;
    let calldata = vec![
        Felt::from(epoch as u128),
        user_felt,
        Felt::from(points),
        Felt::from(0_u128),
    ];

    Ok(Call {
        to,
        selector,
        calldata,
    })
}

// Internal helper that checks conditions for `is_btc_bridge`.
fn is_btc_bridge(tx: &crate::models::Transaction) -> bool {
    tx.token_in
        .as_deref()
        .map(|symbol| {
            let token = symbol.to_ascii_uppercase();
            token == "BTC" || token == "WBTC"
        })
        .unwrap_or(false)
}

// Internal helper that supports `nft_factor_for_discount` operations.
fn nft_factor_for_discount(discount_rate: f64) -> f64 {
    1.0 + (discount_rate.max(0.0) / 100.0)
}

// Internal helper that checks conditions for `is_lp_stake_symbol`.
fn is_lp_stake_symbol(token: &str) -> bool {
    token.starts_with("LP")
}

// Internal helper that runs side-effecting logic for `stake_points_multiplier_for`.
fn stake_points_multiplier_for(token: &str, amount: f64) -> f64 {
    match token {
        "CAREL" => {
            if amount < POINTS_MIN_STAKE_CAREL {
                0.0
            } else if amount < 1_000.0 {
                POINTS_MULTIPLIER_STAKE_CAREL_TIER_1
            } else if amount < 10_000.0 {
                POINTS_MULTIPLIER_STAKE_CAREL_TIER_2
            } else {
                POINTS_MULTIPLIER_STAKE_CAREL_TIER_3
            }
        }
        "BTC" | "WBTC" => {
            if amount < POINTS_MIN_STAKE_BTC {
                0.0
            } else {
                POINTS_MULTIPLIER_STAKE_BTC
            }
        }
        "USDT" | "USDC" => {
            if amount < POINTS_MIN_STAKE_STABLECOIN {
                0.0
            } else {
                POINTS_MULTIPLIER_STAKE_STABLECOIN
            }
        }
        "STRK" => {
            if amount < POINTS_MIN_STAKE_STRK {
                0.0
            } else {
                POINTS_MULTIPLIER_STAKE_STABLECOIN
            }
        }
        _ if is_lp_stake_symbol(token) => {
            if amount < POINTS_MIN_STAKE_LP {
                0.0
            } else {
                POINTS_MULTIPLIER_STAKE_LP
            }
        }
        _ => 0.0,
    }
}

// Internal helper that supports `staking_multiplier_for` operations.
fn staking_multiplier_for(stake_amount: f64) -> f64 {
    if stake_amount < POINTS_MIN_STAKE_CAREL {
        MULTIPLIER_TIER_1
    } else if stake_amount < 1_000.0 {
        MULTIPLIER_TIER_2
    } else if stake_amount < 10_000.0 {
        MULTIPLIER_TIER_3
    } else {
        MULTIPLIER_TIER_4
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    // Internal helper that supports `staking_multiplier_for_tier_boundaries` operations.
    fn staking_multiplier_for_tier_boundaries() {
        // Memastikan multiplier berubah sesuai batas tier
        assert_eq!(staking_multiplier_for(0.0), MULTIPLIER_TIER_1);
        assert_eq!(staking_multiplier_for(100.0), MULTIPLIER_TIER_2);
        assert_eq!(staking_multiplier_for(1_000.0), MULTIPLIER_TIER_3);
        assert_eq!(staking_multiplier_for(10_000.0), MULTIPLIER_TIER_4);
    }

    #[test]
    // Internal helper that runs side-effecting logic for `stake_points_multiplier_matches_product_rules`.
    fn stake_points_multiplier_matches_product_rules() {
        assert_eq!(stake_points_multiplier_for("CAREL", 99.0), 0.0);
        assert_eq!(
            stake_points_multiplier_for("CAREL", 100.0),
            POINTS_MULTIPLIER_STAKE_CAREL_TIER_1
        );
        assert_eq!(
            stake_points_multiplier_for("CAREL", 1_000.0),
            POINTS_MULTIPLIER_STAKE_CAREL_TIER_2
        );
        assert_eq!(
            stake_points_multiplier_for("CAREL", 10_000.0),
            POINTS_MULTIPLIER_STAKE_CAREL_TIER_3
        );
        assert_eq!(
            stake_points_multiplier_for("WBTC", 0.001),
            POINTS_MULTIPLIER_STAKE_BTC
        );
        assert_eq!(
            stake_points_multiplier_for("USDT", 100.0),
            POINTS_MULTIPLIER_STAKE_STABLECOIN
        );
        assert_eq!(
            stake_points_multiplier_for("LP_CAREL_STRK", 1.0),
            POINTS_MULTIPLIER_STAKE_LP
        );
    }

    #[test]
    // Internal helper that supports `nft_factor_for_discount_matches_percentage` operations.
    fn nft_factor_for_discount_matches_percentage() {
        assert_eq!(nft_factor_for_discount(0.0), 1.0);
        assert_eq!(nft_factor_for_discount(25.0), 1.25);
    }
}
