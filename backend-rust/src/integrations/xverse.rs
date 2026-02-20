use reqwest::Client;

#[derive(Clone, Debug)]
pub struct XverseClient {
    base_url: String,
    api_key: Option<String>,
    client: Client,
}

impl XverseClient {
    /// Constructs a new instance via `new`.
    ///
    /// # Arguments
    /// * Uses function parameters as validated input and runtime context.
    ///
    /// # Returns
    /// * `Ok(...)` when processing succeeds.
    /// * `Err(AppError)` when validation, authorization, or integration checks fail.
    ///
    /// # Notes
    /// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
    pub fn new(base_url: String, api_key: Option<String>) -> Self {
        Self {
            base_url,
            api_key,
            client: Client::new(),
        }
    }

    /// Checks conditions for `is_configured`.
    ///
    /// # Arguments
    /// * Uses function parameters as validated input and runtime context.
    ///
    /// # Returns
    /// * `Ok(...)` when processing succeeds.
    /// * `Err(AppError)` when validation, authorization, or integration checks fail.
    ///
    /// # Notes
    /// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
    pub fn is_configured(&self) -> bool {
        !self.base_url.trim().is_empty()
    }

    /// Fetches data for `get_btc_address`.
    ///
    /// # Arguments
    /// * Uses function parameters as validated input and runtime context.
    ///
    /// # Returns
    /// * `Ok(...)` when processing succeeds.
    /// * `Err(AppError)` when validation, authorization, or integration checks fail.
    ///
    /// # Notes
    /// * May update state, query storage, or invoke relayer/on-chain paths depending on flow.
    pub async fn get_btc_address(&self, user_id: &str) -> Result<Option<String>, reqwest::Error> {
        if !self.is_configured() {
            return Ok(None);
        }

        let mut req = self.client.get(format!(
            "{}/address/{}",
            self.base_url.trim_end_matches('/'),
            user_id
        ));
        if let Some(key) = &self.api_key {
            req = req.bearer_auth(key);
        }

        let resp = req.send().await?;
        if !resp.status().is_success() {
            return Ok(None);
        }

        let payload: serde_json::Value = resp.json().await?;
        let address = payload
            .get("address")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        Ok(address)
    }
}
