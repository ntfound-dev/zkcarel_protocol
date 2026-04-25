use crate::{
    bridge_amounts::bridge_token_decimals,
    config::Config,
    constants::{DEX_AVNU, DEX_EKUBO, DEX_HAIKO},
    error::{AppError, Result},
};
use std::collections::HashMap;

// Internal helper that supports `allow_mock_dex_quotes` operations.
fn allow_mock_dex_quotes(config: &Config) -> bool {
    if config.is_testnet() {
        return true;
    }
    let mode = std::env::var("DEX_QUOTE_MODE")
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    matches!(mode.as_str(), "mock" | "test" | "dev")
}

// Internal helper that supports `pow10_u128` operations.
fn pow10_u128(exp: u32) -> u128 {
    let mut out: u128 = 1;
    let mut i: u32 = 0;
    while i < exp {
        match out.checked_mul(10) {
            Some(next) => out = next,
            None => return u128::MAX,
        }
        i += 1;
    }
    out
}

// Internal helper that supports `scale_between_decimals` operations.
fn scale_between_decimals(amount: u128, from_decimals: u32, to_decimals: u32) -> u128 {
    if from_decimals == to_decimals {
        return amount;
    }
    if to_decimals > from_decimals {
        let scale = pow10_u128(to_decimals - from_decimals);
        return amount.saturating_mul(scale);
    }
    let scale = pow10_u128(from_decimals - to_decimals);
    amount / scale
}

// Internal helper that supports `score_route` operations.
fn score_route(route: &SwapRoute) -> f64 {
    if route.amount_in_units == 0 {
        return 0.0;
    }
    let from_decimals = bridge_token_decimals(&route.from_token);
    let to_decimals = bridge_token_decimals(&route.to_token);
    let normalized_out =
        scale_between_decimals(route.amount_out_units, to_decimals, from_decimals) as f64;
    let amount_score = normalized_out / (route.amount_in_units as f64);
    let impact_score = 1.0 / (1.0 + route.price_impact);
    let fee_ratio = route.fee_units as f64 / route.amount_in_units as f64;
    let fee_score = 1.0 / (1.0 + fee_ratio);

    amount_score * 0.4 + impact_score * 0.3 + fee_score * 0.3
}

// Internal helper that supports `apply_env_factor` operations.
fn apply_env_factor(score: f64, is_testnet: bool) -> f64 {
    if is_testnet {
        score * 0.99
    } else {
        score
    }
}

// ==================== AGGREGATOR ====================

pub struct LiquidityAggregator {
    config: Config,
    dex_clients: HashMap<String, Box<dyn DEXClient>>,
}

impl LiquidityAggregator {
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
    pub fn new(config: Config) -> Self {
        let mut dex_clients: HashMap<String, Box<dyn DEXClient>> = HashMap::new();

        if allow_mock_dex_quotes(&config) {
            dex_clients.insert(DEX_EKUBO.to_string(), Box::new(EkuboClient::new()));
            dex_clients.insert(DEX_HAIKO.to_string(), Box::new(HaikoClient::new()));
            dex_clients.insert(DEX_AVNU.to_string(), Box::new(AvnuClient::new()));
        } else {
            tracing::warn!("DEX quote mocks are disabled; configure real DEX integrations.");
        }

        Self {
            config,
            dex_clients,
        }
    }

    /// Get best swap quote from all DEXes
    pub async fn get_best_quote(
        &self,
        from_token: &str,
        to_token: &str,
        amount_in_units: u128,
    ) -> Result<SwapRoute> {
        if self.dex_clients.is_empty() {
            return Err(AppError::BadRequest(
                "DEX quotes are disabled on mainnet. Configure real DEX integrations.".to_string(),
            ));
        }
        let mut futures = Vec::new();

        for (dex_name, client) in &self.dex_clients {
            let dex = dex_name.clone();
            let fut = client.get_quote(from_token, to_token, amount_in_units);
            futures.push(async move { (dex, fut.await) });
        }

        let results = futures_util::future::join_all(futures).await;

        let mut routes = Vec::new();

        for (dex, res) in results {
            if let Ok(q) = res {
                let mut route = SwapRoute {
                    dex,
                    from_token: from_token.to_string(),
                    to_token: to_token.to_string(),
                    amount_in_units,
                    amount_out_units: q.amount_out_units,
                    fee_units: q.fee_units,
                    price_impact: q.price_impact,
                    path: q.path,
                    score: 0.0,
                };
                route.score =
                    apply_env_factor(self.calculate_route_score(&route), self.config.is_testnet());
                routes.push(route);
            }
        }

        routes
            .into_iter()
            .max_by(|a, b| a.score.partial_cmp(&b.score).unwrap())
            .ok_or(crate::error::AppError::InsufficientLiquidity)
    }

    // Internal helper that supports `calculate_route_score` operations.
    fn calculate_route_score(&self, route: &SwapRoute) -> f64 {
        score_route(route)
    }

    /// Split routing (simple heuristic)
    pub async fn get_split_quote(
        &self,
        from_token: &str,
        to_token: &str,
        amount_in_units: u128,
    ) -> Result<Vec<SwapRoute>> {
        if self.dex_clients.is_empty() {
            return Err(AppError::BadRequest(
                "DEX quotes are disabled on mainnet. Configure real DEX integrations.".to_string(),
            ));
        }
        let mut quotes = Vec::new();

        for (dex, client) in &self.dex_clients {
            if let Ok(q) = client
                .get_quote(from_token, to_token, amount_in_units)
                .await
            {
                quotes.push((dex.clone(), q));
            }
        }

        quotes.sort_by(|a, b| b.1.amount_out_units.cmp(&a.1.amount_out_units));

        let mut remaining = amount_in_units;
        let mut routes = Vec::new();

        for (dex, q) in quotes {
            if remaining == 0 {
                break;
            }

            let allocation = remaining.min(q.max_amount_units / 2);

            if allocation > 0 {
                let amount_out = allocation
                    .saturating_mul(q.amount_out_units)
                    .saturating_div(amount_in_units.max(1));
                let fee_units = allocation
                    .saturating_mul(q.fee_units)
                    .saturating_div(amount_in_units.max(1));
                routes.push(SwapRoute {
                    dex,
                    from_token: from_token.to_string(),
                    to_token: to_token.to_string(),
                    amount_in_units: allocation,
                    amount_out_units: amount_out,
                    fee_units,
                    price_impact: q.price_impact,
                    path: q.path.clone(),
                    score: 0.0,
                });
                remaining = remaining.saturating_sub(allocation);
            }
        }

        Ok(routes)
    }

    /// Fetches data for `get_liquidity_depth`.
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
    pub async fn get_liquidity_depth(
        &self,
        from_token: &str,
        to_token: &str,
    ) -> Result<LiquidityDepth> {
        if self.dex_clients.is_empty() {
            return Err(AppError::BadRequest(
                "DEX liquidity checks are disabled on mainnet.".to_string(),
            ));
        }
        let mut total = 0.0;
        let mut per_dex = HashMap::new();

        for (dex, client) in &self.dex_clients {
            if let Ok(liq) = client.get_liquidity(from_token, to_token).await {
                total += liq;
                per_dex.insert(dex.clone(), liq);
            }
        }

        Ok(LiquidityDepth {
            total_liquidity: total,
            dex_liquidity: per_dex,
        })
    }
}

// ==================== DEX TRAIT ====================

#[async_trait::async_trait]
pub trait DEXClient: Send + Sync {
    // Internal helper that fetches data for `get_quote`.
    async fn get_quote(
        &self,
        from_token: &str,
        to_token: &str,
        amount_in_units: u128,
    ) -> Result<DEXQuote>;

    // Internal helper that fetches data for `get_liquidity`.
    async fn get_liquidity(&self, from_token: &str, to_token: &str) -> Result<f64>;
}

// ==================== EKUBO ====================

struct EkuboClient;
impl EkuboClient {
    // Internal helper that constructs instances for `new`.
    fn new() -> Self {
        Self
    }
}

#[async_trait::async_trait]
impl DEXClient for EkuboClient {
    // Internal helper that fetches data for `get_quote`.
    async fn get_quote(&self, from: &str, to: &str, amount_in_units: u128) -> Result<DEXQuote> {
        let from_decimals = bridge_token_decimals(from);
        let to_decimals = bridge_token_decimals(to);
        let fee_units = amount_in_units.saturating_mul(2).saturating_div(1000);
        let net_amount = amount_in_units.saturating_sub(fee_units);
        let amount_out_units = scale_between_decimals(
            net_amount.saturating_mul(998).saturating_div(1000),
            from_decimals,
            to_decimals,
        );
        Ok(DEXQuote {
            amount_out_units,
            price_impact: 0.001,
            fee_units,
            path: vec![from.into(), to.into()],
            max_amount_units: 1_000_000_u128.saturating_mul(pow10_u128(from_decimals)),
        })
    }

    // Internal helper that fetches data for `get_liquidity`.
    async fn get_liquidity(&self, _: &str, _: &str) -> Result<f64> {
        Ok(5_000_000.0)
    }
}

// ==================== HAIKO ====================

struct HaikoClient;
impl HaikoClient {
    // Internal helper that constructs instances for `new`.
    fn new() -> Self {
        Self
    }
}

#[async_trait::async_trait]
impl DEXClient for HaikoClient {
    // Internal helper that fetches data for `get_quote`.
    async fn get_quote(&self, from: &str, to: &str, amount_in_units: u128) -> Result<DEXQuote> {
        let from_decimals = bridge_token_decimals(from);
        let to_decimals = bridge_token_decimals(to);
        let fee_units = amount_in_units.saturating_mul(3).saturating_div(1000);
        let net_amount = amount_in_units.saturating_sub(fee_units);
        let amount_out_units = scale_between_decimals(
            net_amount.saturating_mul(997).saturating_div(1000),
            from_decimals,
            to_decimals,
        );
        Ok(DEXQuote {
            amount_out_units,
            price_impact: 0.002,
            fee_units,
            path: vec![from.into(), to.into()],
            max_amount_units: 500_000_u128.saturating_mul(pow10_u128(from_decimals)),
        })
    }

    // Internal helper that fetches data for `get_liquidity`.
    async fn get_liquidity(&self, _: &str, _: &str) -> Result<f64> {
        Ok(2_000_000.0)
    }
}

// ==================== AVNU ====================

struct AvnuClient;
impl AvnuClient {
    // Internal helper that constructs instances for `new`.
    fn new() -> Self {
        Self
    }
}

#[async_trait::async_trait]
impl DEXClient for AvnuClient {
    // Internal helper that fetches data for `get_quote`.
    async fn get_quote(&self, from: &str, to: &str, amount_in_units: u128) -> Result<DEXQuote> {
        let from_decimals = bridge_token_decimals(from);
        let to_decimals = bridge_token_decimals(to);
        let fee_units = amount_in_units.saturating_mul(4).saturating_div(1000);
        let net_amount = amount_in_units.saturating_sub(fee_units);
        let amount_out_units = scale_between_decimals(
            net_amount.saturating_mul(996).saturating_div(1000),
            from_decimals,
            to_decimals,
        );
        Ok(DEXQuote {
            amount_out_units,
            price_impact: 0.0015,
            fee_units,
            path: vec![from.into(), to.into()],
            max_amount_units: 3_000_000_u128.saturating_mul(pow10_u128(from_decimals)),
        })
    }

    // Internal helper that fetches data for `get_liquidity`.
    async fn get_liquidity(&self, _: &str, _: &str) -> Result<f64> {
        Ok(3_500_000.0)
    }
}

// ==================== DATA STRUCTURES ====================

#[derive(Debug, Clone)]
pub struct SwapRoute {
    pub dex: String,
    pub from_token: String,
    pub to_token: String,
    pub amount_in_units: u128,
    pub amount_out_units: u128,
    pub price_impact: f64,
    pub fee_units: u128,
    pub path: Vec<String>,
    pub score: f64,
}

#[derive(Debug, Clone)]
pub struct DEXQuote {
    pub amount_out_units: u128,
    pub price_impact: f64,
    pub fee_units: u128,
    pub path: Vec<String>,
    pub max_amount_units: u128,
}

#[derive(Debug, serde::Serialize)]
pub struct LiquidityDepth {
    pub total_liquidity: f64,
    pub dex_liquidity: HashMap<String, f64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    // Internal helper that supports `score_route_increases_with_amount_out` operations.
    fn score_route_increases_with_amount_out() {
        // Memastikan skor naik jika amount_out lebih besar
        let route_low = SwapRoute {
            dex: "dex".to_string(),
            from_token: "USDC".to_string(),
            to_token: "USDC".to_string(),
            amount_in_units: 1000,
            amount_out_units: 900,
            price_impact: 0.01,
            fee_units: 10,
            path: vec![],
            score: 0.0,
        };
        let route_high = SwapRoute {
            amount_out_units: 950,
            ..route_low.clone()
        };
        assert!(score_route(&route_high) > score_route(&route_low));
    }

    #[test]
    // Internal helper that supports `apply_env_factor_applies_discount` operations.
    fn apply_env_factor_applies_discount() {
        // Memastikan faktor testnet menurunkan skor
        let score = apply_env_factor(1.0, true);
        assert!((score - 0.99).abs() < f64::EPSILON);
    }

    #[test]
    // Internal helper that supports `score_route_normalizes_decimals` operations.
    fn score_route_normalizes_decimals() {
        let base = SwapRoute {
            dex: "dex".to_string(),
            from_token: "USDC".to_string(),
            to_token: "USDC".to_string(),
            amount_in_units: 1_000_000, // 1 USDC
            amount_out_units: 1_000_000,
            price_impact: 0.0,
            fee_units: 0,
            path: vec![],
            score: 0.0,
        };
        let high_decimals = SwapRoute {
            to_token: "CAREL".to_string(),
            amount_out_units: 1_000_000_000_000_000_000, // 1 CAREL
            ..base.clone()
        };
        let base_score = score_route(&base);
        let high_score = score_route(&high_decimals);
        assert!((base_score - high_score).abs() < 1e-9);
    }
}
