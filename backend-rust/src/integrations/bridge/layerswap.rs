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
