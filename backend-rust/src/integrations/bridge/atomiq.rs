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
            return Err(crate::error::AppError::ExternalAPI(
                "Atomiq API is not configured".to_string(),
            ));
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
            .await
            .map_err(|err| {
                crate::error::AppError::ExternalAPI(format!("Atomiq quote request failed: {}", err))
            })?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(crate::error::AppError::ExternalAPI(format!(
                "Atomiq quote returned {}: {}",
                status, body
            )));
        }

        let body = resp.json::<AtomiqQuoteResponse>().await.map_err(|err| {
            crate::error::AppError::ExternalAPI(format!("Atomiq quote parse failed: {}", err))
        })?;

        Ok(AtomiqQuote {
            from_chain: from_chain.to_string(),
            to_chain: to_chain.to_string(),
            token: token.to_string(),
            amount_in: amount,
            amount_out: body.amount_out.unwrap_or(amount),
            fee: body.fee.unwrap_or(0.0),
            estimated_time_minutes: body.estimated_time_minutes.unwrap_or(20),
        })
    }

    pub async fn execute_bridge(&self, quote: &AtomiqQuote, recipient: &str) -> Result<String> {
        if self.api_url.trim().is_empty() {
            return Err(crate::error::AppError::ExternalAPI(
                "Atomiq API is not configured".to_string(),
            ));
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
            .await
            .map_err(|err| {
                crate::error::AppError::ExternalAPI(format!("Atomiq execute request failed: {}", err))
            })?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(crate::error::AppError::ExternalAPI(format!(
                "Atomiq execute returned {}: {}",
                status, body
            )));
        }

        let body = resp.json::<AtomiqExecuteResponse>().await.map_err(|err| {
            crate::error::AppError::ExternalAPI(format!("Atomiq execute parse failed: {}", err))
        })?;
        if let Some(id) = body.bridge_id {
            return Ok(id);
        }

        Err(crate::error::AppError::ExternalAPI(
            "Atomiq execute response missing bridge id".to_string(),
        ))
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

    #[tokio::test]
    async fn get_quote_without_api_url_returns_error() {
        let client = AtomiqClient::new("api_key".to_string(), "".to_string());
        let err = client
            .get_quote("ethereum", "starknet", "ETH", 200.0)
            .await
            .expect_err("quote should fail without API config");
        assert!(err.to_string().to_ascii_lowercase().contains("not configured"));
    }
}
