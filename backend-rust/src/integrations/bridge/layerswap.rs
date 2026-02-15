use crate::error::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

#[derive(Debug, Clone)]
pub struct LayerSwapClient {
    api_key: String,
    api_url: String,
}

impl LayerSwapClient {
    pub fn new(api_key: String, api_url: String) -> Self {
        Self { api_key, api_url }
    }

    pub async fn get_quote(
        &self,
        from_chain: &str,
        to_chain: &str,
        token: &str,
        amount: f64,
    ) -> Result<LayerSwapQuote> {
        if self.api_url.trim().is_empty() {
            return Err(crate::error::AppError::ExternalAPI(
                "LayerSwap API is not configured".to_string(),
            ));
        }

        let source_network = map_layerswap_network(from_chain);
        let destination_network = map_layerswap_network(to_chain);
        let source_asset = map_layerswap_asset(token);
        let destination_asset = map_layerswap_asset(token);
        let mut url = Url::parse(&format!("{}/quote", self.api_url.trim_end_matches('/')))
            .map_err(|e| crate::error::AppError::Internal(format!("Invalid LayerSwap URL: {}", e)))?;
        url.query_pairs_mut()
            .append_pair("source_network", source_network)
            .append_pair("destination_network", destination_network)
            .append_pair("source_asset", source_asset)
            .append_pair("destination_asset", destination_asset)
            .append_pair("source_amount", &amount.to_string())
            .append_pair("refuel", "false");
        let client = reqwest::Client::new();
        let response = client
            .get(url)
            .header("X-LS-APIKEY", self.api_key.trim())
            .send()
            .await
            .map_err(|e| {
                crate::error::AppError::ExternalAPI(format!("LayerSwap quote request failed: {}", e))
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(crate::error::AppError::ExternalAPI(format!(
                "LayerSwap quote returned {}: {}",
                status, body
            )));
        }

        let body: Value = response.json().await.map_err(|e| {
            crate::error::AppError::ExternalAPI(format!("LayerSwap quote parse failed: {}", e))
        })?;

        let amount_out = pick_f64(
            &body,
            &[
                &["data", "destination_amount"],
                &["data", "quote", "destination_amount"],
                &["destination_amount"],
                &["amount_out"],
            ],
        )
        .unwrap_or(amount);
        let fee = pick_f64(
            &body,
            &[
                &["data", "total_fee"],
                &["data", "quote", "total_fee"],
                &["total_fee"],
                &["fee"],
            ],
        )
        .unwrap_or(0.0);
        let estimated_time_seconds = pick_u64(
            &body,
            &[
                &["data", "estimated_duration_seconds"],
                &["data", "quote", "estimated_duration_seconds"],
                &["estimated_duration_seconds"],
            ],
        )
        .unwrap_or(900);
        let estimated_time_minutes = ((estimated_time_seconds as f64) / 60.0).ceil() as u32;

        Ok(LayerSwapQuote {
            from_chain: from_chain.to_string(),
            to_chain: to_chain.to_string(),
            token: token.to_string(),
            amount_in: amount,
            amount_out,
            fee,
            estimated_time_minutes: estimated_time_minutes.max(1),
        })
    }

    pub async fn execute_bridge(&self, quote: &LayerSwapQuote, recipient: &str) -> Result<String> {
        if self.api_url.trim().is_empty() {
            return Err(crate::error::AppError::ExternalAPI(
                "LayerSwap API is not configured".to_string(),
            ));
        }

        let url = format!("{}/swaps", self.api_url.trim_end_matches('/'));
        let source_network = map_layerswap_network(&quote.from_chain);
        let destination_network = map_layerswap_network(&quote.to_chain);
        let source_asset = map_layerswap_asset(&quote.token);
        let destination_asset = map_layerswap_asset(&quote.token);
        let client = reqwest::Client::new();
        let response = client
            .post(&url)
            .header("X-LS-APIKEY", self.api_key.trim())
            .json(&LayerSwapExecuteRequest {
                source_network: source_network.to_string(),
                destination_network: destination_network.to_string(),
                source_asset: source_asset.to_string(),
                destination_asset: destination_asset.to_string(),
                source_amount: quote.amount_in.to_string(),
                destination_address: recipient.to_string(),
            })
            .send()
            .await
            .map_err(|e| {
                crate::error::AppError::ExternalAPI(format!("LayerSwap execute failed: {}", e))
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(crate::error::AppError::ExternalAPI(format!(
                "LayerSwap execute returned {}: {}",
                status, body
            )));
        }

        let body: Value = response.json().await.map_err(|e| {
            crate::error::AppError::ExternalAPI(format!("LayerSwap execute parse failed: {}", e))
        })?;
        if let Some(id) = pick_string(
            &body,
            &[&["data", "swap_id"], &["data", "id"], &["swap_id"], &["id"]],
        ) {
            return Ok(id);
        }

        Err(crate::error::AppError::ExternalAPI(
            "LayerSwap execute response missing swap id".to_string(),
        ))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayerSwapQuote {
    pub from_chain: String,
    pub to_chain: String,
    pub token: String,
    pub amount_in: f64,
    pub amount_out: f64,
    pub fee: f64,
    pub estimated_time_minutes: u32,
}

#[cfg(test)]
impl LayerSwapQuote {
    fn simulated(from_chain: &str, to_chain: &str, token: &str, amount: f64) -> Self {
        Self {
            from_chain: from_chain.to_string(),
            to_chain: to_chain.to_string(),
            token: token.to_string(),
            amount_in: amount,
            amount_out: amount * 0.996,
            fee: amount * 0.004,
            estimated_time_minutes: 15,
        }
    }

    fn simulated_id(quote: &LayerSwapQuote, recipient: &str) -> String {
        let id_bytes: [u8; 16] = rand::random();
        let id_hex = hex::encode(id_bytes);

        let recipient_short: String = recipient
            .chars()
            .rev()
            .take(10)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();

        let quote_summary = format!(
            "{}:{}->{:.6}",
            &quote.token, &quote.to_chain, quote.amount_out
        );

        format!("LS_{}_to_{}_{}", id_hex, recipient_short, quote_summary)
    }
}

#[derive(Debug, Serialize)]
struct LayerSwapExecuteRequest {
    source_network: String,
    destination_network: String,
    source_asset: String,
    destination_asset: String,
    source_amount: String,
    destination_address: String,
}

fn map_layerswap_network(chain: &str) -> &'static str {
    match chain.trim().to_ascii_lowercase().as_str() {
        "bitcoin" | "btc" => "BTC",
        "ethereum" | "eth" => "ETHEREUM_SEPOLIA",
        "starknet" | "strk" => "STARKNET_SEPOLIA",
        _ => "STARKNET_SEPOLIA",
    }
}

fn map_layerswap_asset(token: &str) -> &'static str {
    match token.trim().to_ascii_uppercase().as_str() {
        "BTC" => "BTC",
        "WBTC" => "WBTC",
        "ETH" => "ETH",
        "STRK" => "STRK",
        "USDT" => "USDT",
        "USDC" => "USDC",
        _ => "STRK",
    }
}

fn pick_f64(body: &Value, paths: &[&[&str]]) -> Option<f64> {
    for path in paths {
        let mut current = body;
        let mut found = true;
        for segment in *path {
            let Some(next) = current.get(*segment) else {
                found = false;
                break;
            };
            current = next;
        }
        if !found {
            continue;
        }
        if let Some(value) = current.as_f64() {
            return Some(value);
        }
        if let Some(raw) = current.as_str() {
            if let Ok(value) = raw.parse::<f64>() {
                return Some(value);
            }
        }
    }
    None
}

fn pick_u64(body: &Value, paths: &[&[&str]]) -> Option<u64> {
    for path in paths {
        let mut current = body;
        let mut found = true;
        for segment in *path {
            let Some(next) = current.get(*segment) else {
                found = false;
                break;
            };
            current = next;
        }
        if !found {
            continue;
        }
        if let Some(value) = current.as_u64() {
            return Some(value);
        }
        if let Some(raw) = current.as_str() {
            if let Ok(value) = raw.parse::<u64>() {
                return Some(value);
            }
        }
    }
    None
}

fn pick_string(body: &Value, paths: &[&[&str]]) -> Option<String> {
    for path in paths {
        let mut current = body;
        let mut found = true;
        for segment in *path {
            let Some(next) = current.get(*segment) else {
                found = false;
                break;
            };
            current = next;
        }
        if !found {
            continue;
        }
        if let Some(value) = current.as_str() {
            if !value.trim().is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const EPSILON: f64 = 1e-9;

    #[test]
    fn simulated_quote_returns_expected_fields() {
        let quote = LayerSwapQuote::simulated("bitcoin", "starknet", "BTC", 100.0);

        assert_eq!(quote.from_chain, "bitcoin");
        assert_eq!(quote.to_chain, "starknet");
        assert_eq!(quote.token, "BTC");
        assert!((quote.amount_in - 100.0).abs() < EPSILON);
        assert!((quote.amount_out - 99.6).abs() < EPSILON);
        assert!((quote.fee - 0.4).abs() < EPSILON);
        assert_eq!(quote.estimated_time_minutes, 15);
    }

    #[test]
    fn simulated_bridge_id_is_traceable() {
        let quote = LayerSwapQuote::simulated("bitcoin", "starknet", "BTC", 100.0);
        let recipient = "recipient_1234567890";

        let result = LayerSwapQuote::simulated_id(&quote, recipient);

        assert!(result.starts_with("LS_"));

        let parts: Vec<&str> = result.split("_to_").collect();
        assert_eq!(parts.len(), 2);

        let id_hex = &parts[0][3..];
        assert_eq!(id_hex.len(), 32);
        assert!(id_hex.chars().all(|c| c.is_ascii_hexdigit()));

        let recipient_short = &recipient[recipient.len() - 10..];
        let quote_summary = format!(
            "{}:{}->{:.6}",
            quote.token, quote.to_chain, quote.amount_out
        );
        assert_eq!(parts[1], format!("{}_{}", recipient_short, quote_summary));
    }
}
