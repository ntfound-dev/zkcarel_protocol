use crate::{config::Config, constants::{GAS_PRICE_FAST, GAS_PRICE_INSTANT, GAS_PRICE_SLOW, GAS_PRICE_STANDARD}, error::Result};

fn base_gas_for(tx_type: &str) -> u64 {
    match tx_type {
        "swap" => 150000,
        "bridge" => 200000,
        "stake" => 100000,
        "claim" => 80000,
        _ => 100000,
    }
}

fn apply_testnet_discount(mut gas: GasPrice, is_testnet: bool) -> GasPrice {
    if is_testnet {
        gas.slow *= 0.5;
        gas.standard *= 0.5;
        gas.fast *= 0.5;
        gas.instant *= 0.5;
    }
    gas
}

/// Gas Optimizer - Optimizes transaction gas costs
pub struct GasOptimizer {
    config: Config,
}

impl GasOptimizer {
    pub fn new(config: Config) -> Self {
        Self { config }
    }

    /// Get optimal gas price
    pub async fn get_optimal_gas_price(&self) -> Result<GasPrice> {
        // TODO: Integrate with gas price oracle
        let gas = GasPrice {
            slow: GAS_PRICE_SLOW,
            standard: GAS_PRICE_STANDARD,
            fast: GAS_PRICE_FAST,
            instant: GAS_PRICE_INSTANT,
        };
        Ok(apply_testnet_discount(gas, self.config.is_testnet()))
    }

    /// Estimate transaction cost
    pub async fn estimate_cost(&self, tx_type: &str) -> Result<f64> {
        let base_gas = base_gas_for(tx_type);

        let gas_price = self.get_optimal_gas_price().await?;
        Ok(base_gas as f64 * gas_price.standard)
    }

    /// Optimize transaction batch
    pub async fn optimize_batch(&self, transactions: Vec<String>) -> Result<Vec<String>> {
        // Group similar transactions
        Ok(transactions)
    }
}

#[derive(Debug, serde::Serialize)]
pub struct GasPrice {
    pub slow: f64,
    pub standard: f64,
    pub fast: f64,
    pub instant: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_gas_for_defaults() {
        // Memastikan tx_type tidak dikenal memakai default
        assert_eq!(base_gas_for("unknown"), 100000);
    }

    #[test]
    fn apply_testnet_discount_halves_values() {
        // Memastikan diskon testnet memotong harga gas jadi setengah
        let gas = GasPrice { slow: 2.0, standard: 4.0, fast: 6.0, instant: 8.0 };
        let discounted = apply_testnet_discount(gas, true);
        assert!((discounted.standard - 2.0).abs() < f64::EPSILON);
    }
}
