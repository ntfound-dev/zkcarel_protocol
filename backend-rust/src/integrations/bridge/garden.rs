use crate::error::Result;
use serde::{Deserialize, Serialize};

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
            return Ok(GardenQuote::simulated(from_chain, to_chain, token, amount));
        }

        let url = format!("{}/quote", self.api_url.trim_end_matches('/'));
        let client = reqwest::Client::new();
        let resp = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&GardenQuoteRequest {
                from_chain: from_chain.to_string(),
                to_chain: to_chain.to_string(),
                token: token.to_string(),
                amount,
            })
            .send()
            .await;

        match resp {
            Ok(res) => match res.json::<GardenQuoteResponse>().await {
                Ok(body) => {
                    return Ok(GardenQuote {
                        from_chain: from_chain.to_string(),
                        to_chain: to_chain.to_string(),
                        token: token.to_string(),
                        amount_in: amount,
                        amount_out: body.amount_out.unwrap_or(amount),
                        fee: body.fee.unwrap_or(0.0),
                        estimated_time_minutes: body.estimated_time_minutes.unwrap_or(30),
                    });
                }
                Err(err) => {
                    tracing::warn!("Garden quote parse failed: {}", err);
                }
            },
            Err(err) => {
                tracing::warn!("Garden API request failed: {}", err);
            }
        }

        Ok(GardenQuote::simulated(from_chain, to_chain, token, amount))
    }

    pub async fn execute_bridge(&self, quote: &GardenQuote, recipient: &str) -> Result<String> {
        if self.api_url.trim().is_empty() {
            return Ok(GardenQuote::simulated_id(recipient));
        }

        let url = format!("{}/execute", self.api_url.trim_end_matches('/'));
        let client = reqwest::Client::new();
        let resp = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&GardenExecuteRequest {
                quote: quote.clone(),
                recipient: recipient.to_string(),
            })
            .send()
            .await;

        match resp {
            Ok(res) => match res.json::<GardenExecuteResponse>().await {
                Ok(body) => {
                    if let Some(id) = body.bridge_id {
                        return Ok(id);
                    }
                }
                Err(err) => {
                    tracing::warn!("Garden execute parse failed: {}", err);
                }
            },
            Err(err) => {
                tracing::warn!("Garden execute failed: {}", err);
            }
        }

        Ok(GardenQuote::simulated_id(recipient))
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
struct GardenQuoteRequest {
    from_chain: String,
    to_chain: String,
    token: String,
    amount: f64,
}

#[derive(Debug, Deserialize)]
struct GardenQuoteResponse {
    amount_out: Option<f64>,
    fee: Option<f64>,
    estimated_time_minutes: Option<u32>,
}

#[derive(Debug, Serialize)]
struct GardenExecuteRequest {
    quote: GardenQuote,
    recipient: String,
}

#[derive(Debug, Deserialize)]
struct GardenExecuteResponse {
    bridge_id: Option<String>,
}
