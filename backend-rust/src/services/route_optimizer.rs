use crate::{
    config::Config,
    constants::{BRIDGE_ATOMIQ, BRIDGE_GARDEN, BRIDGE_LAYERSWAP, BRIDGE_STARKGATE},
    error::Result,
    integrations::bridge::{AtomiqClient, GardenClient, LayerSwapClient},
};

fn normalize_chain(value: &str) -> String {
    let lower = value.trim().to_ascii_lowercase();
    if lower.contains("starknet") || lower == "strk" {
        return "starknet".to_string();
    }
    if lower.contains("bitcoin") || lower == "btc" {
        return "bitcoin".to_string();
    }
    if lower.contains("ethereum") || lower == "eth" || lower == "evm" {
        return "ethereum".to_string();
    }
    lower
}

fn bridge_providers_for(from: &str, to: &str) -> Vec<String> {
    match (from, to) {
        ("bitcoin", "starknet") => vec![BRIDGE_GARDEN.to_string()],
        ("ethereum", "starknet") => vec![
            BRIDGE_STARKGATE.to_string(),
            BRIDGE_ATOMIQ.to_string(),
            BRIDGE_GARDEN.to_string(),
        ],
        ("starknet", "ethereum") => vec![BRIDGE_STARKGATE.to_string()],
        _ => vec![BRIDGE_ATOMIQ.to_string()],
    }
}

fn is_active_config_value(raw: &str) -> bool {
    let value = raw.trim();
    if value.is_empty() {
        return false;
    }
    let upper = value.to_ascii_uppercase();
    !(upper == "DISABLED" || upper == "CHANGE_ME" || upper == "REPLACE_ME")
}

fn has_non_empty(value: Option<&String>) -> bool {
    value
        .map(|item| is_active_config_value(item))
        .unwrap_or(false)
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
        let from_chain_normalized = normalize_chain(from_chain);
        let to_chain_normalized = normalize_chain(to_chain);
        let expected_providers = bridge_providers_for(&from_chain_normalized, &to_chain_normalized);
        let providers = self.get_bridge_providers(&from_chain_normalized, &to_chain_normalized);

        if providers.is_empty() {
            let fallback = if expected_providers.is_empty() {
                "none".to_string()
            } else {
                expected_providers.join(", ")
            };
            return Err(crate::error::AppError::BadRequest(format!(
                "No bridge provider configured for route {} -> {} (expected: {})",
                from_chain_normalized, to_chain_normalized, fallback
            )));
        }

        let mut best_route: Option<BridgeRoute> = None;
        let mut best_score = 0.0;
        let mut provider_errors: Vec<String> = Vec::new();

        for provider in providers {
            match self
                .get_bridge_quote(
                    &provider,
                    &from_chain_normalized,
                    &to_chain_normalized,
                    token,
                    amount,
                )
                .await
            {
                Ok(route) => {
                    let score = self.calculate_bridge_score(&route);

                    if best_route.is_none() || score > best_score {
                        best_route = Some(route);
                        best_score = score;
                    }
                }
                Err(err) => {
                    tracing::warn!(
                        "Bridge quote failed: provider={} from={} to={} token={} amount={} error={}",
                        provider,
                        from_chain_normalized,
                        to_chain_normalized,
                        token,
                        amount,
                        err
                    );
                    provider_errors.push(format!("{}: {}", provider, err));
                }
            }
        }

        if let Some(route) = best_route {
            return Ok(route);
        }

        if provider_errors.is_empty() {
            return Err(crate::error::AppError::NotFound(
                "No bridge route available".to_string(),
            ));
        }

        Err(crate::error::AppError::BadRequest(format!(
            "No bridge route available. {}",
            provider_errors.join(" | ")
        )))
    }

    fn get_bridge_providers(&self, from: &str, to: &str) -> Vec<String> {
        bridge_providers_for(from, to)
            .into_iter()
            .filter(|provider| self.provider_is_configured(provider))
            .collect()
    }

    fn provider_is_configured(&self, provider: &str) -> bool {
        match provider {
            BRIDGE_LAYERSWAP => {
                is_active_config_value(&self.config.layerswap_api_url)
                    && has_non_empty(self.config.layerswap_api_key.as_ref())
            }
            BRIDGE_ATOMIQ => {
                is_active_config_value(&self.config.atomiq_api_url)
                    && has_non_empty(self.config.atomiq_api_key.as_ref())
            }
            BRIDGE_GARDEN => {
                is_active_config_value(&self.config.garden_api_url)
                    && has_non_empty(self.config.garden_api_key.as_ref())
            }
            BRIDGE_STARKGATE => true,
            _ => false,
        }
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
                    .get_quote(from_chain, to_chain, token, token, amount)
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
        // BTC native -> Starknet dikunci ke Garden agar sesuai order lifecycle API Garden.
        let providers = bridge_providers_for("bitcoin", "starknet");
        assert!(providers.contains(&BRIDGE_GARDEN.to_string()));
        assert_eq!(providers.len(), 1);
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
