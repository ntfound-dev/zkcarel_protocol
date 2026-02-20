use rust_decimal::prelude::FromPrimitive;
use rust_decimal::Decimal;

pub const BPS_DENOM: i64 = 10_000;
pub const CAREL_TOTAL_SUPPLY: i64 = 1_000_000_000;

// Early testnet distribution follows vesting EarlyAccess bucket (3%).
pub const EARLY_TESTNET_DISTRIBUTION_BPS: i64 = 300;

// Mainnet monthly distribution follows VestingManager ecosystem release.
pub const MAINNET_ECOSYSTEM_MONTHLY_CAREL: i64 = 6_000_000;

// Claim fee split (5% total): 2.5% management + 2.5% dev.
pub const CLAIM_FEE_BPS: i64 = 500;
pub const CLAIM_FEE_MANAGEMENT_BPS: i64 = 250;
pub const CLAIM_FEE_DEV_BPS: i64 = 250;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RewardsDistributionMode {
    EarlyTestnet,
    MainnetMonthly,
}

impl RewardsDistributionMode {
    /// Handles `as_str` logic.
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
    pub fn as_str(self) -> &'static str {
        match self {
            Self::EarlyTestnet => "early_testnet",
            Self::MainnetMonthly => "mainnet_monthly",
        }
    }

    /// Handles `label` logic.
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
    pub fn label(self) -> &'static str {
        match self {
            Self::EarlyTestnet => "Early testnet pool (3% token supply)",
            Self::MainnetMonthly => "Mainnet monthly distribution pool",
        }
    }
}

/// Handles `distribution_mode_for_environment` logic.
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
pub fn distribution_mode_for_environment(environment: &str) -> RewardsDistributionMode {
    let env = environment.trim().to_ascii_lowercase();
    if env.contains("mainnet") || env == "prod" || env == "production" {
        RewardsDistributionMode::MainnetMonthly
    } else {
        RewardsDistributionMode::EarlyTestnet
    }
}

/// Handles `rewards_distribution_pool_carel` logic.
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
pub fn rewards_distribution_pool_carel(mode: RewardsDistributionMode) -> Decimal {
    match mode {
        RewardsDistributionMode::EarlyTestnet => {
            let total_supply = Decimal::from_i64(CAREL_TOTAL_SUPPLY).unwrap_or(Decimal::ZERO);
            let bps = Decimal::from_i64(EARLY_TESTNET_DISTRIBUTION_BPS).unwrap_or(Decimal::ZERO);
            let denom = Decimal::from_i64(BPS_DENOM).unwrap_or(Decimal::ONE);
            total_supply * bps / denom
        }
        RewardsDistributionMode::MainnetMonthly => {
            Decimal::from_i64(MAINNET_ECOSYSTEM_MONTHLY_CAREL).unwrap_or(Decimal::ZERO)
        }
    }
}

/// Handles `rewards_distribution_pool_for_environment` logic.
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
pub fn rewards_distribution_pool_for_environment(environment: &str) -> Decimal {
    rewards_distribution_pool_carel(distribution_mode_for_environment(environment))
}

/// Runs `claim_fee_multiplier` and handles related side effects.
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
pub fn claim_fee_multiplier() -> Decimal {
    let numerator = Decimal::from_i64(BPS_DENOM - CLAIM_FEE_BPS).unwrap_or(Decimal::ZERO);
    let denominator = Decimal::from_i64(BPS_DENOM).unwrap_or(Decimal::ONE);
    numerator / denominator
}

/// Handles `bps_to_percent` logic.
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
pub fn bps_to_percent(bps: i64) -> f64 {
    (bps as f64) / 100.0
}
