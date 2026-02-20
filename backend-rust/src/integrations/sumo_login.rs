use reqwest::Client;
use url::Url;

#[derive(Clone, Debug)]
pub struct SumoLoginClient {
    base_url: String,
    api_key: Option<String>,
    client: Client,
}

impl SumoLoginClient {
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

    /// Handles `verify_login` logic.
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
    pub async fn verify_login(&self, token: &str) -> Result<bool, reqwest::Error> {
        if !self.is_configured() {
            return Ok(false);
        }

        let mut url = match Url::parse(&format!("{}/verify", self.base_url.trim_end_matches('/'))) {
            Ok(url) => url,
            Err(_) => return Ok(false),
        };
        url.query_pairs_mut().append_pair("token", token);
        let mut req = self.client.get(url);
        if let Some(key) = &self.api_key {
            req = req.bearer_auth(key);
        }
        let resp = req.send().await?;
        Ok(resp.status().is_success())
    }
}
