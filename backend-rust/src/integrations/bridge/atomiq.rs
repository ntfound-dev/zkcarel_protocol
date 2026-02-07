use crate::error::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct AtomiqClient {
    api_key: String,
}

impl AtomiqClient {
    pub fn new(api_key: String) -> Self {
        Self { api_key }
    }

    pub async fn get_quote(&self, from_chain: &str, to_chain: &str, token: &str, amount: f64) -> Result<AtomiqQuote> {
        Ok(AtomiqQuote {
            from_chain: from_chain.to_string(),
            to_chain: to_chain.to_string(),
            token: token.to_string(),
            amount_in: amount,
            amount_out: amount * 0.995, // 0.5% fee
            fee: amount * 0.005,
            estimated_time_minutes: 20,
        })
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