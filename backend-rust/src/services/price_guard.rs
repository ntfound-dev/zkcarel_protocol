// Shared price and USD-sanity guards used across APIs/services.

const MAX_USD_NOTIONAL_PER_TX: f64 = 1_000_000.0;
const MAX_USD_POINTS_BASE_PER_TX: f64 = 100_000.0;

// Internal helper that normalizes symbols for price sanity checks.
pub fn normalize_symbol(token: &str) -> String {
    token.trim().to_ascii_uppercase()
}

// Internal helper that supports alias candidates (WBTC <-> BTC).
pub fn symbol_candidates_for(token: &str) -> Vec<String> {
    let symbol = normalize_symbol(token);
    match symbol.as_str() {
        "WBTC" => vec!["WBTC".to_string(), "BTC".to_string()],
        "BTC" => vec!["BTC".to_string(), "WBTC".to_string()],
        _ => vec![symbol],
    }
}

// Internal helper that provides deterministic fallback prices.
pub fn fallback_price_for(token: &str) -> f64 {
    match normalize_symbol(token).as_str() {
        "BTC" | "WBTC" => 65_000.0,
        "ETH" => 1_900.0,
        "STRK" => 0.05,
        "USDT" | "USDC" => 1.0,
        "CAREL" => 1.0,
        _ => 0.0,
    }
}

// Internal helper that returns sane min/max USD bounds for known assets.
fn bounds_for(token: &str) -> (f64, f64) {
    match normalize_symbol(token).as_str() {
        "USDT" | "USDC" => (0.5, 2.0),
        "CAREL" => (0.000001, 1_000.0),
        "STRK" => (0.0001, 100.0),
        "ETH" => (10.0, 100_000.0),
        "BTC" | "WBTC" => (1_000.0, 1_000_000.0),
        _ => (0.00000001, 1_000_000.0),
    }
}

// Internal helper that validates a raw USD price.
pub fn sanitize_price_usd(token: &str, value: f64) -> Option<f64> {
    if !value.is_finite() || value <= 0.0 {
        return None;
    }
    let (min, max) = bounds_for(token);
    if value < min || value > max {
        return None;
    }
    Some(value)
}

// Internal helper that selects the first sane price from newest->older candidates.
pub fn first_sane_price(token: &str, prices: &[f64]) -> Option<f64> {
    prices
        .iter()
        .copied()
        .find_map(|candidate| sanitize_price_usd(token, candidate))
}

// Internal helper that clamps USD notional for tx metrics.
pub fn sanitize_usd_notional(value: f64) -> f64 {
    if !value.is_finite() || value <= 0.0 {
        return 0.0;
    }
    value.min(MAX_USD_NOTIONAL_PER_TX)
}

// Internal helper that clamps USD base before converting to points.
pub fn sanitize_points_usd_base(value: f64) -> f64 {
    if !value.is_finite() || value <= 0.0 {
        return 0.0;
    }
    value.min(MAX_USD_POINTS_BASE_PER_TX)
}
