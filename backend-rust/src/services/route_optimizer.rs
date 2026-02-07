use crate::{config::Config, error::Result};

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
            if let Ok(route) = self.get_bridge_quote(&provider, token, amount).await {
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
        match (from, to) {
            ("bitcoin", "starknet") => vec!["LayerSwap".to_string(), "Atomiq".to_string()],
            ("ethereum", "starknet") => vec!["StarkGate".to_string(), "Atomiq".to_string()],
            ("starknet", "ethereum") => vec!["StarkGate".to_string()],
            _ => vec!["Atomiq".to_string()],
        }
    }

    async fn get_bridge_quote(
        &self,
        provider: &str,
        token: &str,
        amount: f64,
    ) -> Result<BridgeRoute> {
        // Mock implementation
        let fee_percent = match provider {
            "LayerSwap" => 0.4,
            "StarkGate" => 0.3,
            "Atomiq" => 0.5,
            _ => 0.5,
        };

        Ok(BridgeRoute {
            provider: provider.to_string(),
            token: token.to_string(),
            amount_in: amount,
            amount_out: amount * (1.0 - fee_percent / 100.0),
            fee: amount * (fee_percent / 100.0),
            estimated_time_minutes: match provider {
                "StarkGate" => 10,
                "LayerSwap" => 15,
                _ => 20,
            },
        })
    }

    fn calculate_bridge_score(&self, route: &BridgeRoute) -> f64 {
        // Score based on: output amount (50%), speed (30%), reliability (20%)
        let output_score = route.amount_out / route.amount_in;
        let time_score = 1.0 / (route.estimated_time_minutes as f64 / 10.0);
        let reliability_score = match route.provider.as_str() {
            "StarkGate" => 1.0,
            "LayerSwap" => 0.95,
            _ => 0.9,
        };

        output_score * 0.5 + time_score * 0.3 + reliability_score * 0.2
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