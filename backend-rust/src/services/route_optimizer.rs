use crate::{
    config::Config,
    constants::{BRIDGE_ATOMIQ, BRIDGE_GARDEN, BRIDGE_LAYERSWAP, BRIDGE_STARKGATE},
    error::Result,
    integrations::bridge::{AtomiqClient, GardenClient, LayerSwapClient},
};

fn bridge_providers_for(from: &str, to: &str) -> Vec<String> {
    match (from, to) {
        ("bitcoin", "starknet") => vec![
            BRIDGE_LAYERSWAP.to_string(),
            BRIDGE_ATOMIQ.to_string(),
            BRIDGE_GARDEN.to_string(),
        ],
        ("ethereum", "starknet") => vec![
            BRIDGE_STARKGATE.to_string(),
            BRIDGE_ATOMIQ.to_string(),
            BRIDGE_GARDEN.to_string(),
        ],
        ("starknet", "ethereum") => vec![BRIDGE_STARKGATE.to_string()],
        _ => vec![BRIDGE_ATOMIQ.to_string()],
    }
}

fn bridge_score(route: &BridgeRoute, is_testnet: bool) -> f64 {
    let output_score = route.amount_out / route.amount_in;
    let time_score = 1.0 / (route.estimated_time_minutes as f64 / 10.0);
    let reliability_score = match route.provider.as_str() {
        BRIDGE_STARKGATE => 1.0,
        BRIDGE_LAYERSWAP => 0.95,
        BRIDGE_GARDEN => 0.93,
        _ => 0.9,
    };
    let env_factor = if is_testnet { 0.98 } else { 1.0 };
    let score = output_score * 0.5 + time_score * 0.3 + reliability_score * 0.2;
    score * env_factor
}

/// Route Optimizer - Selects best bridge/swap routes
pub struct RouteOptimizer {
    config: Config,
}

impl RouteOptimizer {
    pub fn new(config: Config) -> Self {
        Self { config }
    }

    /// Find best bridge route
    pub async fn find_best_bridge_route(
        &self,
        from_chain: &str,
        to_chain: &str,
        token: &str,
        amount: f64,
    ) -> Result<BridgeRoute> {
        let providers = self.get_bridge_providers(from_chain, to_chain);

        let mut best_route: Option<BridgeRoute> = None;
        let mut best_score = 0.0;

        for provider in providers {
            if let Ok(route) = self
                .get_bridge_quote(&provider, from_chain, to_chain, token, amount)
                .await
            {
                let score = self.calculate_bridge_score(&route);

                if best_route.is_none() || score > best_score {
                    best_route = Some(route);
                    best_score = score;
                }
            }
        }

        best_route.ok_or_else(|| {
            crate::error::AppError::NotFound("No bridge route available".to_string())
        })
    }

    fn get_bridge_providers(&self, from: &str, to: &str) -> Vec<String> {
        bridge_providers_for(from, to)
    }

    async fn get_bridge_quote(
        &self,
        provider: &str,
        from_chain: &str,
        to_chain: &str,
        token: &str,
        amount: f64,
    ) -> Result<BridgeRoute> {
        let route = match provider {
            BRIDGE_LAYERSWAP => {
                let client = LayerSwapClient::new(
                    self.config.layerswap_api_key.clone().unwrap_or_default(),
                    self.config.layerswap_api_url.clone(),
                );
                let quote = client
                    .get_quote(from_chain, to_chain, token, amount)
                    .await?;
                BridgeRoute {
                    provider: provider.to_string(),
                    token: token.to_string(),
                    amount_in: quote.amount_in,
                    amount_out: quote.amount_out,
                    fee: quote.fee,
                    estimated_time_minutes: quote.estimated_time_minutes,
                }
            }
            BRIDGE_ATOMIQ => {
                let client = AtomiqClient::new(
                    self.config.atomiq_api_key.clone().unwrap_or_default(),
                    self.config.atomiq_api_url.clone(),
                );
                let quote = client
                    .get_quote(from_chain, to_chain, token, amount)
                    .await?;
                BridgeRoute {
                    provider: provider.to_string(),
                    token: token.to_string(),
                    amount_in: quote.amount_in,
                    amount_out: quote.amount_out,
                    fee: quote.fee,
                    estimated_time_minutes: quote.estimated_time_minutes,
                }
            }
            BRIDGE_STARKGATE => {
                // Mock implementation for StarkGate
                let fee_percent = 0.3;
                BridgeRoute {
                    provider: provider.to_string(),
                    token: token.to_string(),
                    amount_in: amount,
                    amount_out: amount * (1.0 - fee_percent / 100.0),
                    fee: amount * (fee_percent / 100.0),
                    estimated_time_minutes: 10,
                }
            }
            BRIDGE_GARDEN => {
                let client = GardenClient::new(
                    self.config.garden_api_key.clone().unwrap_or_default(),
                    self.config.garden_api_url.clone(),
                );
                let quote = client
                    .get_quote(from_chain, to_chain, token, amount)
                    .await?;
                BridgeRoute {
                    provider: provider.to_string(),
                    token: token.to_string(),
                    amount_in: quote.amount_in,
                    amount_out: quote.amount_out,
                    fee: quote.fee,
                    estimated_time_minutes: quote.estimated_time_minutes,
                }
            }
            _ => {
                let fee_percent = 0.5;
                BridgeRoute {
                    provider: provider.to_string(),
                    token: token.to_string(),
                    amount_in: amount,
                    amount_out: amount * (1.0 - fee_percent / 100.0),
                    fee: amount * (fee_percent / 100.0),
                    estimated_time_minutes: 20,
                }
            }
        };

        tracing::debug!(
            "Bridge quote provider={} from={} to={} token={} amount_in={} amount_out={}",
            provider,
            from_chain,
            to_chain,
            token,
            route.amount_in,
            route.amount_out
        );

        Ok(route)
    }

    fn calculate_bridge_score(&self, route: &BridgeRoute) -> f64 {
        let score = bridge_score(route, self.config.is_testnet());
        tracing::debug!(
            "Bridge score token={} provider={} score={}",
            route.token,
            route.provider,
            score
        );
        score
    }
}

#[derive(Debug, Clone)]
pub struct BridgeRoute {
    pub provider: String,
    pub token: String,
    pub amount_in: f64,
    pub amount_out: f64,
    pub fee: f64,
    pub estimated_time_minutes: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_providers_for_bitcoin_to_starknet() {
        // Memastikan provider LayerSwap ada untuk BTC -> Starknet
        let providers = bridge_providers_for("bitcoin", "starknet");
        assert!(providers.contains(&BRIDGE_LAYERSWAP.to_string()));
        assert!(providers.contains(&BRIDGE_GARDEN.to_string()));
    }

    #[test]
    fn bridge_score_applies_env_factor() {
        // Memastikan skor berkurang di testnet
        let route = BridgeRoute {
            provider: BRIDGE_STARKGATE.to_string(),
            token: "ETH".to_string(),
            amount_in: 100.0,
            amount_out: 99.0,
            fee: 1.0,
            estimated_time_minutes: 10,
        };
        let main_score = bridge_score(&route, false);
        let test_score = bridge_score(&route, true);
        assert!(test_score < main_score);
    }
}
