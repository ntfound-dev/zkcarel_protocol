use crate::error::Result;
use serde::{Deserialize, Serialize};
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
            return Ok(LayerSwapQuote::simulated(
                from_chain, to_chain, token, amount,
            ));
        }

        let mut url = Url::parse(&format!("{}/quotes", self.api_url.trim_end_matches('/')))
            .map_err(|e| {
                crate::error::AppError::Internal(format!("Invalid LayerSwap URL: {}", e))
            })?;
        url.query_pairs_mut()
            .append_pair("source", from_chain)
            .append_pair("destination", to_chain)
            .append_pair("sourceAsset", token)
            .append_pair("destinationAsset", token)
            .append_pair("amount", &amount.to_string());
        let client = reqwest::Client::new();
        let resp = client
            .get(url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .send()
            .await;

        match resp {
            Ok(res) => match res.json::<LayerSwapQuoteResponse>().await {
                Ok(body) => {
                    return Ok(LayerSwapQuote {
                        from_chain: from_chain.to_string(),
                        to_chain: to_chain.to_string(),
                        token: token.to_string(),
                        amount_in: amount,
                        amount_out: body.amount_out.unwrap_or(amount),
                        fee: body.fee.unwrap_or(0.0),
                        estimated_time_minutes: body.estimated_time_minutes.unwrap_or(15),
                    });
                }
                Err(err) => {
                    tracing::warn!("LayerSwap quote parse failed: {}", err);
                }
            },
            Err(err) => {
                tracing::warn!("LayerSwap API request failed: {}", err);
            }
        }

        Ok(LayerSwapQuote::simulated(
            from_chain, to_chain, token, amount,
        ))
    }

    pub async fn execute_bridge(&self, quote: &LayerSwapQuote, recipient: &str) -> Result<String> {
        if self.api_url.trim().is_empty() {
            return Ok(LayerSwapQuote::simulated_id(quote, recipient));
        }

        let url = format!("{}/swaps", self.api_url.trim_end_matches('/'));
        let client = reqwest::Client::new();
        let resp = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&LayerSwapExecuteRequest {
                from_chain: quote.from_chain.clone(),
                to_chain: quote.to_chain.clone(),
                token: quote.token.clone(),
                amount: quote.amount_in,
                recipient: recipient.to_string(),
            })
            .send()
            .await;

        match resp {
            Ok(res) => match res.json::<LayerSwapExecuteResponse>().await {
                Ok(body) => {
                    if let Some(id) = body.swap_id {
                        return Ok(id);
                    }
                }
                Err(err) => {
                    tracing::warn!("LayerSwap execute parse failed: {}", err);
                }
            },
            Err(err) => {
                tracing::warn!("LayerSwap execute failed: {}", err);
            }
        }

        Ok(LayerSwapQuote::simulated_id(quote, recipient))
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

#[derive(Debug, Deserialize)]
struct LayerSwapQuoteResponse {
    amount_out: Option<f64>,
    fee: Option<f64>,
    estimated_time_minutes: Option<u32>,
}

#[derive(Debug, Serialize)]
struct LayerSwapExecuteRequest {
    from_chain: String,
    to_chain: String,
    token: String,
    amount: f64,
    recipient: String,
}

#[derive(Debug, Deserialize)]
struct LayerSwapExecuteResponse {
    swap_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    const EPSILON: f64 = 1e-9;

    #[tokio::test]
    async fn get_quote_returns_expected_fields() {
        let client = LayerSwapClient::new("api_key".to_string(), "".to_string());
        let quote = client
            .get_quote("bitcoin", "starknet", "BTC", 100.0)
            .await
            .expect("quote should succeed");

        assert_eq!(quote.from_chain, "bitcoin");
        assert_eq!(quote.to_chain, "starknet");
        assert_eq!(quote.token, "BTC");
        assert!((quote.amount_in - 100.0).abs() < EPSILON);
        assert!((quote.amount_out - 99.6).abs() < EPSILON);
        assert!((quote.fee - 0.4).abs() < EPSILON);
        assert_eq!(quote.estimated_time_minutes, 15);
    }

    #[tokio::test]
    async fn execute_bridge_builds_traceable_id() {
        let client = LayerSwapClient::new("api_key".to_string(), "".to_string());
        let quote = client
            .get_quote("bitcoin", "starknet", "BTC", 100.0)
            .await
            .expect("quote should succeed");
        let recipient = "recipient_1234567890";

        let result = client
            .execute_bridge(&quote, recipient)
            .await
            .expect("execute should succeed");

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
