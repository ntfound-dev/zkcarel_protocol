use crate::error::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

#[derive(Debug, Clone)]
pub struct GardenClient {
    api_key: String,
    api_url: String,
}

impl GardenClient {
    pub fn new(api_key: String, api_url: String) -> Self {
        Self { api_key, api_url }
    }

    pub async fn get_quote(
        &self,
        from_chain: &str,
        to_chain: &str,
        token: &str,
        amount: f64,
    ) -> Result<GardenQuote> {
        if self.api_url.trim().is_empty() {
            return Err(crate::error::AppError::ExternalAPI(
                "Garden API is not configured".to_string(),
            ));
        }

        let from_asset = map_garden_asset(from_chain, token);
        let to_asset = map_garden_asset(to_chain, token);
        let from_amount_units = to_base_units(amount, garden_decimals(token));

        let mut url = Url::parse(&format!(
            "{}/v2/quote",
            self.api_url.trim_end_matches('/')
        ))
        .map_err(|e| crate::error::AppError::Internal(format!("Invalid Garden URL: {}", e)))?;
        url.query_pairs_mut()
            .append_pair("from", &from_asset)
            .append_pair("to", &to_asset)
            .append_pair("from_amount", &from_amount_units.to_string());
        let client = reqwest::Client::new();
        let response = client
            .get(url)
            .header("garden-app-id", self.api_key.trim())
            .send()
            .await
            .map_err(|e| {
                crate::error::AppError::ExternalAPI(format!("Garden quote request failed: {}", e))
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(crate::error::AppError::ExternalAPI(format!(
                "Garden quote returned {}: {}",
                status, body
            )));
        }

        let body: Value = response.json().await.map_err(|e| {
            crate::error::AppError::ExternalAPI(format!("Garden quote parse failed: {}", e))
        })?;

        let first_result = body
            .get("result")
            .and_then(|value| value.as_array())
            .and_then(|items| items.first());
        let destination_amount_units = first_result
            .and_then(|row| row.get("destination"))
            .and_then(|dst| dst.get("amount"))
            .and_then(value_to_u128)
            .unwrap_or(from_amount_units);
        let fee_units = first_result
            .and_then(|row| row.get("fee"))
            .and_then(value_to_u128)
            .unwrap_or(0);
        let estimated_time_seconds = first_result
            .and_then(|row| row.get("estimated_time"))
            .and_then(value_to_u128)
            .unwrap_or(1800);

        let decimals = garden_decimals(token);
        let amount_out = from_base_units(destination_amount_units, decimals);
        let fee = from_base_units(fee_units, decimals);
        let estimated_time_minutes = ((estimated_time_seconds as f64) / 60.0).ceil() as u32;

        Ok(GardenQuote {
            from_chain: from_chain.to_string(),
            to_chain: to_chain.to_string(),
            token: token.to_string(),
            amount_in: amount,
            amount_out,
            fee,
            estimated_time_minutes: estimated_time_minutes.max(1),
        })
    }

    pub async fn execute_bridge(&self, quote: &GardenQuote, recipient: &str) -> Result<String> {
        if self.api_url.trim().is_empty() {
            return Err(crate::error::AppError::ExternalAPI(
                "Garden API is not configured".to_string(),
            ));
        }

        let url = format!("{}/v2/orders", self.api_url.trim_end_matches('/'));
        let from_asset = map_garden_asset(&quote.from_chain, &quote.token);
        let to_asset = map_garden_asset(&quote.to_chain, &quote.token);
        let from_amount = to_base_units(quote.amount_in, garden_decimals(&quote.token));
        let client = reqwest::Client::new();
        let response = client
            .post(&url)
            .header("garden-app-id", self.api_key.trim())
            .json(&GardenExecuteRequest {
                from: from_asset,
                to: to_asset,
                from_amount: from_amount.to_string(),
                destination_recipient_address: recipient.to_string(),
            })
            .send()
            .await
            .map_err(|e| {
                crate::error::AppError::ExternalAPI(format!("Garden execute failed: {}", e))
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(crate::error::AppError::ExternalAPI(format!(
                "Garden execute returned {}: {}",
                status, body
            )));
        }

        let body: Value = response.json().await.map_err(|e| {
            crate::error::AppError::ExternalAPI(format!("Garden execute parse failed: {}", e))
        })?;
        if let Some(id) = body
            .get("result")
            .and_then(|value| value.get("id"))
            .and_then(value_to_string)
            .or_else(|| body.get("id").and_then(value_to_string))
        {
            return Ok(id);
        }

        Err(crate::error::AppError::ExternalAPI(
            "Garden execute response missing bridge id".to_string(),
        ))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GardenQuote {
    pub from_chain: String,
    pub to_chain: String,
    pub token: String,
    pub amount_in: f64,
    pub amount_out: f64,
    pub fee: f64,
    pub estimated_time_minutes: u32,
}

#[cfg(test)]
impl GardenQuote {
    fn simulated(from_chain: &str, to_chain: &str, token: &str, amount: f64) -> Self {
        Self {
            from_chain: from_chain.to_string(),
            to_chain: to_chain.to_string(),
            token: token.to_string(),
            amount_in: amount,
            amount_out: amount * 0.995,
            fee: amount * 0.005,
            estimated_time_minutes: 30,
        }
    }

    fn simulated_id(recipient: &str) -> String {
        let id_bytes: [u8; 16] = rand::random();
        let id_hex = hex::encode(id_bytes);
        let suffix: String = recipient
            .chars()
            .rev()
            .take(8)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        format!("GD_{}_{}", id_hex, suffix)
    }
}

#[derive(Debug, Serialize)]
struct GardenExecuteRequest {
    from: String,
    to: String,
    from_amount: String,
    destination_recipient_address: String,
}

fn map_garden_chain(chain: &str) -> &'static str {
    match chain.trim().to_ascii_lowercase().as_str() {
        "bitcoin" | "btc" => "bitcoin_testnet",
        "ethereum" | "eth" => "ethereum_sepolia",
        "starknet" | "strk" => "starknet_sepolia",
        _ => "starknet_sepolia",
    }
}

fn map_garden_token(chain: &str, token: &str) -> &'static str {
    match (chain.trim().to_ascii_lowercase().as_str(), token.trim().to_ascii_uppercase().as_str())
    {
        ("bitcoin", _) | ("btc", _) => "btc",
        (_, "BTC") | (_, "WBTC") => "wbtc",
        (_, "ETH") => "eth",
        (_, "STRK") => "strk",
        (_, "USDT") => "usdt",
        (_, "USDC") => "usdc",
        (_, "CAREL") => "carel",
        _ => "strk",
    }
}

fn map_garden_asset(chain: &str, token: &str) -> String {
    format!("{}:{}", map_garden_chain(chain), map_garden_token(chain, token))
}

fn garden_decimals(token: &str) -> u32 {
    match token.trim().to_ascii_uppercase().as_str() {
        "BTC" | "WBTC" => 8,
        "USDT" | "USDC" => 6,
        _ => 18,
    }
}

fn to_base_units(amount: f64, decimals: u32) -> u128 {
    if !amount.is_finite() || amount <= 0.0 {
        return 0;
    }
    let scale = 10_f64.powi(decimals as i32);
    (amount * scale).round() as u128
}

fn from_base_units(amount: u128, decimals: u32) -> f64 {
    if amount == 0 {
        return 0.0;
    }
    let scale = 10_f64.powi(decimals as i32);
    (amount as f64) / scale
}

fn value_to_u128(value: &Value) -> Option<u128> {
    if let Some(raw) = value.as_u64() {
        return Some(raw as u128);
    }
    if let Some(raw) = value.as_str() {
        return raw.parse::<u128>().ok();
    }
    None
}

fn value_to_string(value: &Value) -> Option<String> {
    if let Some(raw) = value.as_str() {
        if !raw.trim().is_empty() {
            return Some(raw.to_string());
        }
    }
    if let Some(raw) = value.as_u64() {
        return Some(raw.to_string());
    }
    None
}
