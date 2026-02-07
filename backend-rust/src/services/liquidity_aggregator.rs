use crate::{config::Config, error::Result};
use std::collections::HashMap;

// ==================== AGGREGATOR ====================

pub struct LiquidityAggregator {
    config: Config,
    dex_clients: HashMap<String, Box<dyn DEXClient>>,
}

impl LiquidityAggregator {
    pub fn new(config: Config) -> Self {
        let mut dex_clients: HashMap<String, Box<dyn DEXClient>> = HashMap::new();

        dex_clients.insert("Ekubo".to_string(), Box::new(EkuboClient::new()));
        dex_clients.insert("Haiko".to_string(), Box::new(HaikoClient::new()));
        dex_clients.insert("Avnu".to_string(), Box::new(AvnuClient::new()));

        Self { config, dex_clients }
    }

    /// Get best swap quote from all DEXes
    pub async fn get_best_quote(
        &self,
        from_token: &str,
        to_token: &str,
        amount_in: f64,
    ) -> Result<SwapRoute> {
        let mut futures = Vec::new();

        for (dex_name, client) in &self.dex_clients {
            let dex = dex_name.clone();
            let fut = client.get_quote(from_token, to_token, amount_in);
            futures.push(async move { (dex, fut.await) });
        }

        let results = futures_util::future::join_all(futures).await;

        let mut routes = Vec::new();

        for (dex, res) in results {
            if let Ok(q) = res {
                let mut route = SwapRoute {
                    dex,
                    amount_in,
                    amount_out: q.amount_out,
                    price_impact: q.price_impact,
                    fee: q.fee,
                    path: q.path,
                    score: 0.0,
                };
                route.score = self.calculate_route_score(&route);
                routes.push(route);
            }
        }

        routes
            .into_iter()
            .max_by(|a, b| a.score.partial_cmp(&b.score).unwrap())
            .ok_or(crate::error::AppError::InsufficientLiquidity)
    }

    fn calculate_route_score(&self, route: &SwapRoute) -> f64 {
        let amount_score = route.amount_out / route.amount_in;
        let impact_score = 1.0 / (1.0 + route.price_impact);
        let fee_score = 1.0 / (1.0 + route.fee);

        amount_score * 0.4 + impact_score * 0.3 + fee_score * 0.3
    }

    /// Split routing (simple heuristic)
    pub async fn get_split_quote(
        &self,
        from_token: &str,
        to_token: &str,
        amount_in: f64,
    ) -> Result<Vec<SwapRoute>> {
        let mut quotes = Vec::new();

        for (dex, client) in &self.dex_clients {
            if let Ok(q) = client.get_quote(from_token, to_token, amount_in).await {
                quotes.push((dex.clone(), q));
            }
        }

        quotes.sort_by(|a, b| {
            b.1.amount_out
                .partial_cmp(&a.1.amount_out)
                .unwrap()
        });

        let mut remaining = amount_in;
        let mut routes = Vec::new();

        for (dex, q) in quotes {
            if remaining <= 0.0 {
                break;
            }

            let allocation = remaining.min(q.max_amount * 0.5);

            if allocation > 0.0 {
                routes.push(SwapRoute {
                    dex,
                    amount_in: allocation,
                    amount_out: q.amount_out * (allocation / amount_in),
                    price_impact: q.price_impact,
                    fee: q.fee,
                    path: q.path.clone(),
                    score: 0.0,
                });
                remaining -= allocation;
            }
        }

        Ok(routes)
    }

    pub async fn get_liquidity_depth(
        &self,
        from_token: &str,
        to_token: &str,
    ) -> Result<LiquidityDepth> {
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
    async fn get_quote(
        &self,
        from_token: &str,
        to_token: &str,
        amount_in: f64,
    ) -> Result<DEXQuote>;

    async fn get_liquidity(&self, from_token: &str, to_token: &str) -> Result<f64>;
}

// ==================== EKUBO ====================

struct EkuboClient;
impl EkuboClient {
    fn new() -> Self {
        Self
    }
}

#[async_trait::async_trait]
impl DEXClient for EkuboClient {
    async fn get_quote(
        &self,
        from: &str,
        to: &str,
        amount: f64,
    ) -> Result<DEXQuote> {
        Ok(DEXQuote {
            amount_out: amount * 0.998,
            price_impact: 0.001,
            fee: amount * 0.002,
            path: vec![from.into(), to.into()],
            max_amount: 1_000_000.0,
        })
    }

    async fn get_liquidity(&self, _: &str, _: &str) -> Result<f64> {
        Ok(5_000_000.0)
    }
}

// ==================== HAIKO ====================

struct HaikoClient;
impl HaikoClient {
    fn new() -> Self {
        Self
    }
}

#[async_trait::async_trait]
impl DEXClient for HaikoClient {
    async fn get_quote(
        &self,
        from: &str,
        to: &str,
        amount: f64,
    ) -> Result<DEXQuote> {
        Ok(DEXQuote {
            amount_out: amount * 0.997,
            price_impact: 0.002,
            fee: amount * 0.003,
            path: vec![from.into(), to.into()],
            max_amount: 500_000.0,
        })
    }

    async fn get_liquidity(&self, _: &str, _: &str) -> Result<f64> {
        Ok(2_000_000.0)
    }
}

// ==================== AVNU ====================

struct AvnuClient;
impl AvnuClient {
    fn new() -> Self {
        Self
    }
}

#[async_trait::async_trait]
impl DEXClient for AvnuClient {
    async fn get_quote(
        &self,
        from: &str,
        to: &str,
        amount: f64,
    ) -> Result<DEXQuote> {
        Ok(DEXQuote {
            amount_out: amount * 0.996,
            price_impact: 0.0015,
            fee: amount * 0.004,
            path: vec![from.into(), to.into()],
            max_amount: 3_000_000.0,
        })
    }

    async fn get_liquidity(&self, _: &str, _: &str) -> Result<f64> {
        Ok(3_500_000.0)
    }
}

// ==================== DATA STRUCTURES ====================

#[derive(Debug, Clone)]
pub struct SwapRoute {
    pub dex: String,
    pub amount_in: f64,
    pub amount_out: f64,
    pub price_impact: f64,
    pub fee: f64,
    pub path: Vec<String>,
    pub score: f64,
}

#[derive(Debug, Clone)]
pub struct DEXQuote {
    pub amount_out: f64,
    pub price_impact: f64,
    pub fee: f64,
    pub path: Vec<String>,
    pub max_amount: f64,
}

#[derive(Debug, serde::Serialize)]
pub struct LiquidityDepth {
    pub total_liquidity: f64,
    pub dex_liquidity: HashMap<String, f64>,
}
