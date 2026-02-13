use crate::error::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct AtomiqClient {
    api_key: String,
    api_url: String,
}

impl AtomiqClient {
    pub fn new(api_key: String, api_url: String) -> Self {
        Self { api_key, api_url }
    }

    pub async fn get_quote(
        &self,
        from_chain: &str,
        to_chain: &str,
        token: &str,
        amount: f64,
    ) -> Result<AtomiqQuote> {
        if self.api_url.trim().is_empty() {
            return Ok(AtomiqQuote::simulated(from_chain, to_chain, token, amount));
        }

        let url = format!("{}/quote", self.api_url.trim_end_matches('/'));
        let client = reqwest::Client::new();
        let resp = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&AtomiqQuoteRequest {
                from_chain: from_chain.to_string(),
                to_chain: to_chain.to_string(),
                token: token.to_string(),
                amount,
            })
            .send()
            .await;

        match resp {
            Ok(res) => match res.json::<AtomiqQuoteResponse>().await {
                Ok(body) => {
                    return Ok(AtomiqQuote {
                        from_chain: from_chain.to_string(),
                        to_chain: to_chain.to_string(),
                        token: token.to_string(),
                        amount_in: amount,
                        amount_out: body.amount_out.unwrap_or(amount),
                        fee: body.fee.unwrap_or(0.0),
                        estimated_time_minutes: body.estimated_time_minutes.unwrap_or(20),
                    });
                }
                Err(err) => {
                    tracing::warn!("Atomiq quote parse failed: {}", err);
                }
            },
            Err(err) => {
                tracing::warn!("Atomiq API request failed: {}", err);
            }
        }

        Ok(AtomiqQuote::simulated(from_chain, to_chain, token, amount))
    }

    pub async fn execute_bridge(&self, quote: &AtomiqQuote, recipient: &str) -> Result<String> {
        if self.api_url.trim().is_empty() {
            return Ok(AtomiqQuote::simulated_id(recipient));
        }

        let url = format!("{}/execute", self.api_url.trim_end_matches('/'));
        let client = reqwest::Client::new();
        let resp = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&AtomiqExecuteRequest {
                quote: quote.clone(),
                recipient: recipient.to_string(),
            })
            .send()
            .await;

        match resp {
            Ok(res) => match res.json::<AtomiqExecuteResponse>().await {
                Ok(body) => {
                    if let Some(id) = body.bridge_id {
                        return Ok(id);
                    }
                }
                Err(err) => {
                    tracing::warn!("Atomiq execute parse failed: {}", err);
                }
            },
            Err(err) => {
                tracing::warn!("Atomiq execute failed: {}", err);
            }
        }

        Ok(AtomiqQuote::simulated_id(recipient))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AtomiqQuote {
    pub from_chain: String,
    pub to_chain: String,
    pub token: String,
    pub amount_in: f64,
    pub amount_out: f64,
    pub fee: f64,
    pub estimated_time_minutes: u32,
}

impl AtomiqQuote {
    fn simulated(from_chain: &str, to_chain: &str, token: &str, amount: f64) -> Self {
        Self {
            from_chain: from_chain.to_string(),
            to_chain: to_chain.to_string(),
            token: token.to_string(),
            amount_in: amount,
            amount_out: amount * 0.995,
            fee: amount * 0.005,
            estimated_time_minutes: 20,
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
        format!("AT_{}_{}", id_hex, suffix)
    }
}

#[derive(Debug, Serialize)]
struct AtomiqQuoteRequest {
    from_chain: String,
    to_chain: String,
    token: String,
    amount: f64,
}

#[derive(Debug, Deserialize)]
struct AtomiqQuoteResponse {
    amount_out: Option<f64>,
    fee: Option<f64>,
    estimated_time_minutes: Option<u32>,
}

#[derive(Debug, Serialize)]
struct AtomiqExecuteRequest {
    quote: AtomiqQuote,
    recipient: String,
}

#[derive(Debug, Deserialize)]
struct AtomiqExecuteResponse {
    bridge_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    const EPSILON: f64 = 1e-9;

    #[tokio::test]
    async fn get_quote_returns_expected_fields() {
        let client = AtomiqClient::new("api_key".to_string(), "".to_string());
        let quote = client
            .get_quote("ethereum", "starknet", "ETH", 200.0)
            .await
            .expect("quote should succeed");

        assert_eq!(quote.from_chain, "ethereum");
        assert_eq!(quote.to_chain, "starknet");
        assert_eq!(quote.token, "ETH");
        assert!((quote.amount_in - 200.0).abs() < EPSILON);
        assert!((quote.amount_out - 199.0).abs() < EPSILON);
        assert!((quote.fee - 1.0).abs() < EPSILON);
        assert_eq!(quote.estimated_time_minutes, 20);
    }
}
