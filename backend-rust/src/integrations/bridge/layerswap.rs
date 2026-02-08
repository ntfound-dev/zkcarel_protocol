use crate::error::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct LayerSwapClient {
    api_key: String,
    api_url: String,
}

impl LayerSwapClient {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            api_url: "https://api.layerswap.io/api/v2".to_string(),
        }
    }

    pub async fn get_quote(
        &self,
        from_chain: &str,
        to_chain: &str,
        token: &str,
        amount: f64,
    ) -> Result<LayerSwapQuote> {
        tracing::debug!(
            "LayerSwap quote via {} (api_key_set={})",
            self.api_url,
            !self.api_key.is_empty()
        );
        // TODO: Implement actual LayerSwap API integration.
        // For now we return a deterministic simulated quote.
        Ok(LayerSwapQuote {
            from_chain: from_chain.to_string(),
            to_chain: to_chain.to_string(),
            token: token.to_string(),
            amount_in: amount,
            amount_out: amount * 0.996, // assume 0.4% fee
            fee: amount * 0.004,
            estimated_time_minutes: 15,
        })
    }

    pub async fn execute_bridge(
        &self,
        quote: &LayerSwapQuote,
        recipient: &str,
    ) -> Result<String> {
        // NOTE: This is still a stub. We use `quote` and `recipient` here
        // to avoid unused-variable warnings and to make the fake ID include
        // a short recipient summary for easier debugging.
        //
        // TODO: Replace with real API call to LayerSwap that uses `quote` and `recipient`.
        let id_bytes: [u8; 16] = rand::random();
        let id_hex = hex::encode(id_bytes);

        // take up to last 10 characters of recipient (safe with chars)
        let recipient_short: String = recipient
            .chars()
            .rev()
            .take(10)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();

        // include a small summary of the quote for debugging
        let quote_summary = format!(
            "{}:{}->{:.6}",
            &quote.token,
            &quote.to_chain,
            quote.amount_out
        );

        Ok(format!("LS_{}_to_{}_{}", id_hex, recipient_short, quote_summary))
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
mod tests {
    use super::*;

    const EPSILON: f64 = 1e-9;

    #[tokio::test]
    async fn get_quote_returns_expected_fields() {
        let client = LayerSwapClient::new("api_key".to_string());
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
        let client = LayerSwapClient::new("api_key".to_string());
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
        let quote_summary = format!("{}:{}->{:.6}", quote.token, quote.to_chain, quote.amount_out);
        assert_eq!(parts[1], format!("{}_{}", recipient_short, quote_summary));
    }
}
