use crate::{
    config::Config,
    constants::{BRIDGE_ATOMIQ, BRIDGE_GARDEN, BRIDGE_LAYERSWAP, BRIDGE_STARKGATE},
    error::{AppError, Result},
    integrations::bridge::{AtomiqClient, GardenClient, LayerSwapClient},
};

// Internal helper that parses or transforms values for `normalize_chain`.
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

// Internal helper that supports `bridge_providers_for` operations.
fn bridge_providers_for(from: &str, to: &str) -> Vec<String> {
    match (from, to) {
        ("ethereum", "bitcoin") => vec![BRIDGE_GARDEN.to_string()],
        ("bitcoin", "ethereum") => vec![BRIDGE_GARDEN.to_string()],
        ("bitcoin", "starknet") => vec![BRIDGE_GARDEN.to_string()],
        ("starknet", "bitcoin") => vec![BRIDGE_GARDEN.to_string()],
        ("ethereum", "starknet") => vec![BRIDGE_GARDEN.to_string()],
        ("starknet", "ethereum") => vec![BRIDGE_GARDEN.to_string()],
        _ => vec![],
    }
}

// Internal helper that parses or transforms values for `normalize_token_symbol`.
fn normalize_token_symbol(token: &str) -> String {
    token.trim().to_ascii_uppercase()
}

// Internal helper that supports `garden_destination_token` operations.
fn garden_destination_token(
    to_chain: &str,
    source_token: &str,
    preferred_to_token: Option<&str>,
) -> String {
    if let Some(token) = preferred_to_token.map(normalize_token_symbol) {
        if !token.is_empty() {
            return token;
        }
    }
    let source = normalize_token_symbol(source_token);
    match to_chain {
        "bitcoin" => "BTC".to_string(),
        "starknet" => {
            if source == "BTC" || source == "WBTC" {
                "WBTC".to_string()
            } else {
                source
            }
        }
        "ethereum" => {
            if source == "BTC" || source == "WBTC" {
                "WBTC".to_string()
            } else {
                source
            }
        }
        _ => source,
    }
}

// Internal helper that supports `garden_token_supported_on_chain` operations.
fn garden_token_supported_on_chain(chain: &str, token: &str) -> bool {
    let chain = chain.trim().to_ascii_lowercase();
    let token = normalize_token_symbol(token);
    match chain.as_str() {
        "bitcoin" => token == "BTC" || token == "WBTC",
        "ethereum" => token == "ETH",
        "starknet" => token == "WBTC",
        _ => false,
    }
}

// Internal helper that supports `garden_supports_route` operations.
fn garden_supports_route(from: &str, to: &str) -> bool {
    match (from, to) {
        ("ethereum", "bitcoin")
        | ("bitcoin", "ethereum")
        | ("bitcoin", "starknet")
        | ("starknet", "bitcoin")
        | ("ethereum", "starknet")
        | ("starknet", "ethereum") => true,
        _ => false,
    }
}

// Internal helper that checks conditions for `is_active_config_value`.
fn is_active_config_value(raw: &str) -> bool {
    let value = raw.trim();
    if value.is_empty() {
        return false;
    }
    let upper = value.to_ascii_uppercase();
    !(upper == "DISABLED" || upper == "CHANGE_ME" || upper == "REPLACE_ME")
}

// Internal helper that checks conditions for `has_non_empty`.
fn has_non_empty(value: Option<&String>) -> bool {
    value
        .map(|item| is_active_config_value(item))
        .unwrap_or(false)
}

// Internal helper that supports `bridge_force_garden_enabled` operations.
fn bridge_force_garden_enabled() -> bool {
    std::env::var("BRIDGE_FORCE_GARDEN")
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

// Internal helper that supports `apply_bridge_provider_mode` operations.
fn apply_bridge_provider_mode(mut providers: Vec<String>, force_garden: bool) -> Vec<String> {
    if force_garden && providers.iter().any(|provider| provider == BRIDGE_GARDEN) {
        providers.retain(|provider| provider == BRIDGE_GARDEN);
    }
    providers
}

// Internal helper that supports `bridge_score` operations.
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

// Internal helper that supports `compact_error_message` operations.
fn compact_error_message(raw: &str) -> String {
    let collapsed = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    for prefix in ["External API error: ", "Bad request: "] {
        if let Some(stripped) = collapsed.strip_prefix(prefix) {
            return stripped.to_string();
        }
    }
    collapsed
}

// Internal helper that supports `bridge_token_decimals` operations.
fn bridge_token_decimals(token: &str) -> u32 {
    match normalize_token_symbol(token).as_str() {
        "BTC" | "WBTC" => 8,
        "USDT" | "USDC" => 6,
        _ => 18,
    }
}

// Internal helper that supports `format_base_units_as_token_amount` operations.
fn format_base_units_as_token_amount(units: u128, token: &str) -> String {
    let decimals = bridge_token_decimals(token);
    if decimals == 0 {
        return units.to_string();
    }
    let scale = 10u128.pow(decimals);
    let whole = units / scale;
    let frac = units % scale;
    if frac == 0 {
        return whole.to_string();
    }
    let mut frac_text = format!("{:0width$}", frac, width = decimals as usize);
    while frac_text.ends_with('0') {
        frac_text.pop();
    }
    format!("{}.{}", whole, frac_text)
}

// Internal helper that supports `parse_garden_amount_range` operations.
fn parse_garden_amount_range(raw_lower: &str) -> Option<(u128, u128)> {
    let marker = "within the range of ";
    let start = raw_lower.find(marker)?;
    let tail = &raw_lower[start + marker.len()..];
    let mut numbers = tail
        .split(|ch: char| !ch.is_ascii_digit())
        .filter(|segment| !segment.is_empty())
        .take(2)
        .filter_map(|segment| segment.parse::<u128>().ok());
    let min = numbers.next()?;
    let max = numbers.next()?;
    Some((min, max))
}

// Internal helper that supports `humanize_bridge_provider_error` operations.
fn humanize_bridge_provider_error(
    provider: &str,
    err: &AppError,
    from_chain: &str,
    to_chain: &str,
    from_token: &str,
    requested_to_token: Option<&str>,
) -> String {
    let raw = compact_error_message(&err.to_string());
    let lower = raw.to_ascii_lowercase();

    if provider == BRIDGE_GARDEN {
        let to_token = requested_to_token
            .map(normalize_token_symbol)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| garden_destination_token(to_chain, from_token, requested_to_token));

        if lower.contains("invalid to_asset") {
            return format!(
                "{}: destination token {} is not available on {} for this route.",
                provider, to_token, to_chain
            );
        }

        if lower.contains("invalid from_asset") {
            return format!(
                "{}: source token {} is not available on {} for this route.",
                provider,
                normalize_token_symbol(from_token),
                from_chain
            );
        }

        if lower.contains("within the range of") {
            let symbol = normalize_token_symbol(from_token);
            if let Some((min_units, max_units)) = parse_garden_amount_range(&lower) {
                return format!(
                    "{}: amount is outside provider range for {} on {} -> {} (min {} {}, max {} {}).",
                    provider,
                    symbol,
                    from_chain,
                    to_chain,
                    format_base_units_as_token_amount(min_units, from_token),
                    symbol,
                    format_base_units_as_token_amount(max_units, from_token),
                    symbol
                );
            }
            return format!(
                "{}: amount is outside provider range for this pair. Try a higher amount.",
                provider
            );
        }

        if lower.contains("insufficient liquidity") {
            return format!(
                "{}: insufficient liquidity for {} -> {} ({} -> {}) right now. Try a different amount or retry later.",
                provider,
                normalize_token_symbol(from_token),
                to_token,
                from_chain,
                to_chain
            );
        }

        if lower.contains("garden quote returned 400") {
            return format!(
                "{}: provider rejected this quote request. Check amount limits and route liquidity.",
                provider
            );
        }

        if lower.starts_with("garden ") {
            return raw;
        }
    }

    format!("{}: {}", provider, raw)
}

// Internal helper that supports `bridge_to_strk_is_disabled` operations.
fn bridge_to_strk_is_disabled(
    from_chain: &str,
    to_chain: &str,
    requested_to_token: Option<&str>,
) -> bool {
    from_chain != "starknet"
        && to_chain == "starknet"
        && requested_to_token.map(normalize_token_symbol).as_deref() == Some("STRK")
}

// Internal helper that parses or transforms values for `normalize_bridge_token_for_chain`.
fn normalize_bridge_token_for_chain(chain: &str, token: &str) -> String {
    let normalized = normalize_token_symbol(token);
    if chain == "bitcoin" && normalized == "WBTC" {
        return "BTC".to_string();
    }
    normalized
}

// Internal helper that supports `bridge_pair_supported_for_current_routes` operations.
fn bridge_pair_supported_for_current_routes(
    from_chain: &str,
    to_chain: &str,
    from_token: &str,
    requested_to_token: Option<&str>,
) -> bool {
    let from = normalize_bridge_token_for_chain(from_chain, from_token);
    let resolved_to = requested_to_token
        .map(normalize_token_symbol)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| garden_destination_token(to_chain, from_token, requested_to_token));
    let to = normalize_bridge_token_for_chain(to_chain, &resolved_to);

    matches!(
        (from_chain, to_chain, from.as_str(), to.as_str()),
        ("ethereum", "bitcoin", "ETH", "BTC")
            | ("bitcoin", "ethereum", "BTC", "ETH")
            | ("bitcoin", "starknet", "BTC", "WBTC")
            | ("starknet", "bitcoin", "WBTC", "BTC")
            | ("ethereum", "starknet", "ETH", "WBTC")
            | ("starknet", "ethereum", "WBTC", "ETH")
    )
}

/// Route Optimizer - Selects best bridge/swap routes
pub struct RouteOptimizer {
    config: Config,
}

impl RouteOptimizer {
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
        Self { config }
    }

    /// Find best bridge route
    pub async fn find_best_bridge_route(
        &self,
        from_chain: &str,
        to_chain: &str,
        token: &str,
        to_token: Option<&str>,
        amount: f64,
    ) -> Result<BridgeRoute> {
        let from_chain_normalized = normalize_chain(from_chain);
        let to_chain_normalized = normalize_chain(to_chain);
        let expected_providers = bridge_providers_for(&from_chain_normalized, &to_chain_normalized);
        let mut providers = apply_bridge_provider_mode(
            self.get_bridge_providers(&from_chain_normalized, &to_chain_normalized),
            bridge_force_garden_enabled(),
        );
        let normalized_from_token = normalize_token_symbol(token);
        let normalized_to_token = to_token
            .map(normalize_token_symbol)
            .filter(|value| !value.is_empty());
        if bridge_to_strk_is_disabled(
            &from_chain_normalized,
            &to_chain_normalized,
            normalized_to_token.as_deref(),
        ) {
            return Err(crate::error::AppError::BadRequest(
                "Bridge to STRK is currently disabled. Use Starknet L2 Swap for STRK pairs."
                    .to_string(),
            ));
        }
        if !bridge_pair_supported_for_current_routes(
            &from_chain_normalized,
            &to_chain_normalized,
            &normalized_from_token,
            normalized_to_token.as_deref(),
        ) {
            return Err(crate::error::AppError::BadRequest(
                "Bridge pair is not supported on current testnet routes. Supported pairs: ETH<->BTC, BTC<->WBTC, and ETH<->WBTC (Ethereum<->Starknet)."
                    .to_string(),
            ));
        }
        let is_cross_token_bridge = normalized_to_token
            .as_deref()
            .map(|value| value != normalized_from_token.as_str())
            .unwrap_or(false);
        // StarkGate only supports ETH <-> ETH bridge semantics. Any cross-token target
        // must use a bridge provider that natively supports destination token conversion.
        let force_garden_cross_token = is_cross_token_bridge;
        if force_garden_cross_token {
            providers.retain(|provider| provider == BRIDGE_GARDEN);
        }

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
                    to_token,
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
                    provider_errors.push(humanize_bridge_provider_error(
                        &provider,
                        &err,
                        &from_chain_normalized,
                        &to_chain_normalized,
                        token,
                        normalized_to_token.as_deref(),
                    ));
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

    // Internal helper that fetches data for `get_bridge_providers`.
    fn get_bridge_providers(&self, from: &str, to: &str) -> Vec<String> {
        bridge_providers_for(from, to)
            .into_iter()
            .filter(|provider| self.provider_is_configured(provider))
            .collect()
    }

    // Internal helper that supports `provider_is_configured` operations.
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

    // Internal helper that fetches data for `get_bridge_quote`.
    async fn get_bridge_quote(
        &self,
        provider: &str,
        from_chain: &str,
        to_chain: &str,
        token: &str,
        to_token: Option<&str>,
        amount: f64,
    ) -> Result<BridgeRoute> {
        if provider == BRIDGE_GARDEN && !garden_supports_route(from_chain, to_chain) {
            return Err(crate::error::AppError::BadRequest(format!(
                "Garden does not support {} -> {} route",
                from_chain, to_chain
            )));
        }

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
                let token_normalized = normalize_token_symbol(token);
                let supports_pair = (from_chain == "ethereum" && to_chain == "starknet")
                    || (from_chain == "starknet" && to_chain == "ethereum");
                if token_normalized != "ETH" || !supports_pair {
                    return Err(crate::error::AppError::BadRequest(format!(
                        "StarkGate supports ETH bridge on ethereum<->starknet only (requested token={}, route={} -> {})",
                        token,
                        from_chain,
                        to_chain
                    )));
                }
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
                let to_token = garden_destination_token(to_chain, token, to_token);
                if !garden_token_supported_on_chain(from_chain, token) {
                    return Err(crate::error::AppError::BadRequest(format!(
                        "Garden does not support source token {} on {}",
                        token, from_chain
                    )));
                }
                if !garden_token_supported_on_chain(to_chain, &to_token) {
                    return Err(crate::error::AppError::BadRequest(format!(
                        "Garden does not support destination token {} on {}",
                        to_token, to_chain
                    )));
                }
                let quote = client
                    .get_quote(from_chain, to_chain, token, &to_token, amount)
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

    // Internal helper that supports `calculate_bridge_score` operations.
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
    // Internal helper that supports `bridge_providers_for_bitcoin_to_starknet` operations.
    fn bridge_providers_for_bitcoin_to_starknet() {
        // BTC native -> Starknet dikunci ke Garden agar sesuai order lifecycle API Garden.
        let providers = bridge_providers_for("bitcoin", "starknet");
        assert!(providers.contains(&BRIDGE_GARDEN.to_string()));
        assert_eq!(providers.len(), 1);
    }

    #[test]
    // Internal helper that supports `bridge_providers_for_ethereum_to_bitcoin_prefers_garden` operations.
    fn bridge_providers_for_ethereum_to_bitcoin_prefers_garden() {
        let providers = bridge_providers_for("ethereum", "bitcoin");
        assert_eq!(providers.first().map(String::as_str), Some(BRIDGE_GARDEN));
        assert_eq!(providers.len(), 1);
    }

    #[test]
    // Internal helper that supports `bridge_providers_for_ethereum_to_starknet_prefers_garden` operations.
    fn bridge_providers_for_ethereum_to_starknet_prefers_garden() {
        let providers = bridge_providers_for("ethereum", "starknet");
        assert_eq!(providers.first().map(String::as_str), Some(BRIDGE_GARDEN));
        assert_eq!(providers.len(), 1);
    }

    #[test]
    // Internal helper that supports `bridge_providers_for_bitcoin_to_ethereum_prefers_garden` operations.
    fn bridge_providers_for_bitcoin_to_ethereum_prefers_garden() {
        let providers = bridge_providers_for("bitcoin", "ethereum");
        assert_eq!(providers.first().map(String::as_str), Some(BRIDGE_GARDEN));
        assert_eq!(providers.len(), 1);
    }

    #[test]
    // Internal helper that supports `bridge_providers_for_starknet_to_bitcoin_prefers_garden` operations.
    fn bridge_providers_for_starknet_to_bitcoin_prefers_garden() {
        let providers = bridge_providers_for("starknet", "bitcoin");
        assert_eq!(providers.first().map(String::as_str), Some(BRIDGE_GARDEN));
        assert_eq!(providers.len(), 1);
    }

    #[test]
    // Internal helper that supports `apply_bridge_provider_mode_forced_garden` operations.
    fn apply_bridge_provider_mode_forced_garden() {
        let providers = vec![
            BRIDGE_STARKGATE.to_string(),
            BRIDGE_GARDEN.to_string(),
            BRIDGE_ATOMIQ.to_string(),
        ];
        let filtered = apply_bridge_provider_mode(providers, true);
        assert_eq!(filtered, vec![BRIDGE_GARDEN.to_string()]);
    }

    #[test]
    // Internal helper that supports `apply_bridge_provider_mode_without_garden_fallback` operations.
    fn apply_bridge_provider_mode_without_garden_fallback() {
        let providers = vec![BRIDGE_STARKGATE.to_string(), BRIDGE_ATOMIQ.to_string()];
        let filtered = apply_bridge_provider_mode(providers.clone(), true);
        assert_eq!(filtered, providers);
    }

    #[test]
    // Internal helper that supports `garden_destination_token_for_bitcoin_is_btc` operations.
    fn garden_destination_token_for_bitcoin_is_btc() {
        assert_eq!(garden_destination_token("bitcoin", "ETH", None), "BTC");
        assert_eq!(garden_destination_token("bitcoin", "WBTC", None), "BTC");
    }

    #[test]
    // Internal helper that supports `garden_destination_token_prefers_explicit_to_token` operations.
    fn garden_destination_token_prefers_explicit_to_token() {
        assert_eq!(
            garden_destination_token("starknet", "ETH", Some("WBTC")),
            "WBTC"
        );
    }

    #[test]
    // Internal helper that supports `garden_supports_common_routes` operations.
    fn garden_supports_common_routes() {
        assert!(garden_supports_route("ethereum", "bitcoin"));
        assert!(garden_supports_route("bitcoin", "ethereum"));
        assert!(garden_supports_route("bitcoin", "starknet"));
        assert!(garden_supports_route("starknet", "bitcoin"));
        assert!(garden_supports_route("ethereum", "starknet"));
        assert!(garden_supports_route("starknet", "ethereum"));
    }

    #[test]
    // Internal helper that supports `garden_token_support_rejects_eth_on_starknet` operations.
    fn garden_token_support_rejects_eth_on_starknet() {
        assert!(garden_token_supported_on_chain("starknet", "WBTC"));
        assert!(!garden_token_supported_on_chain("ethereum", "WBTC"));
        assert!(!garden_token_supported_on_chain("starknet", "ETH"));
        assert!(!garden_token_supported_on_chain("starknet", "STRK"));
    }

    #[test]
    // Internal helper that supports `bridge_score_applies_env_factor` operations.
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

    #[test]
    // Internal helper that supports `humanize_garden_invalid_to_asset_error` operations.
    fn humanize_garden_invalid_to_asset_error() {
        let err = AppError::ExternalAPI(
            "Garden quote returned 400 Bad Request: {\"status\":\"Error\",\"error\":\"invalid to_asset\"}"
                .to_string(),
        );
        let msg = humanize_bridge_provider_error(
            BRIDGE_GARDEN,
            &err,
            "ethereum",
            "starknet",
            "ETH",
            Some("STRK"),
        );
        assert_eq!(
            msg,
            "Garden: destination token STRK is not available on starknet for this route."
        );
    }

    #[test]
    // Internal helper that supports `humanize_garden_amount_range_error` operations.
    fn humanize_garden_amount_range_error() {
        let err = AppError::ExternalAPI(
            "Garden quote returned 400 Bad Request: {\"status\":\"Error\",\"error\":\"Exact output quote error : expected amount to be within the range of 50000 to 1000000\"}"
                .to_string(),
        );
        let msg = humanize_bridge_provider_error(
            BRIDGE_GARDEN,
            &err,
            "starknet",
            "ethereum",
            "WBTC",
            Some("ETH"),
        );
        assert_eq!(
            msg,
            "Garden: amount is outside provider range for WBTC on starknet -> ethereum (min 0.0005 WBTC, max 0.01 WBTC)."
        );
    }

    #[test]
    // Internal helper that supports `humanize_garden_insufficient_liquidity_error` operations.
    fn humanize_garden_insufficient_liquidity_error() {
        let err = AppError::ExternalAPI(
            "Garden quote returned 400 Bad Request: {\"status\":\"Error\",\"error\":\"insufficient liquidity\"}"
                .to_string(),
        );
        let msg = humanize_bridge_provider_error(
            BRIDGE_GARDEN,
            &err,
            "starknet",
            "ethereum",
            "WBTC",
            Some("ETH"),
        );
        assert_eq!(
            msg,
            "Garden: insufficient liquidity for WBTC -> ETH (starknet -> ethereum) right now. Try a different amount or retry later."
        );
    }

    #[test]
    // Internal helper that supports `bridge_to_strk_policy_blocks_cross_chain_destination` operations.
    fn bridge_to_strk_policy_blocks_cross_chain_destination() {
        assert!(bridge_to_strk_is_disabled(
            "ethereum",
            "starknet",
            Some("STRK")
        ));
        assert!(bridge_to_strk_is_disabled(
            "bitcoin",
            "starknet",
            Some("strk")
        ));
        assert!(!bridge_to_strk_is_disabled(
            "starknet",
            "starknet",
            Some("STRK")
        ));
        assert!(!bridge_to_strk_is_disabled(
            "ethereum",
            "starknet",
            Some("USDC")
        ));
    }

    #[test]
    // Internal helper that supports `bridge_pair_matrix_allows_expected_routes` operations.
    fn bridge_pair_matrix_allows_expected_routes() {
        assert!(bridge_pair_supported_for_current_routes(
            "ethereum",
            "bitcoin",
            "ETH",
            Some("BTC")
        ));
        assert!(bridge_pair_supported_for_current_routes(
            "bitcoin",
            "ethereum",
            "BTC",
            Some("ETH")
        ));
        assert!(bridge_pair_supported_for_current_routes(
            "bitcoin",
            "starknet",
            "BTC",
            Some("WBTC")
        ));
        assert!(bridge_pair_supported_for_current_routes(
            "starknet",
            "bitcoin",
            "WBTC",
            Some("BTC")
        ));
        assert!(bridge_pair_supported_for_current_routes(
            "ethereum",
            "starknet",
            "ETH",
            Some("WBTC")
        ));
        assert!(bridge_pair_supported_for_current_routes(
            "starknet",
            "ethereum",
            "WBTC",
            Some("ETH")
        ));
        assert!(!bridge_pair_supported_for_current_routes(
            "ethereum",
            "ethereum",
            "WBTC",
            Some("ETH")
        ));
        assert!(!bridge_pair_supported_for_current_routes(
            "ethereum",
            "starknet",
            "WBTC",
            Some("WBTC")
        ));
        assert!(!bridge_pair_supported_for_current_routes(
            "ethereum",
            "starknet",
            "ETH",
            Some("STRK")
        ));
    }
}
