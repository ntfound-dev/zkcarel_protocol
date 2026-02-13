use reqwest::Client;

#[derive(Clone, Debug)]
pub struct XverseClient {
    base_url: String,
    api_key: Option<String>,
    client: Client,
}

impl XverseClient {
    pub fn new(base_url: String, api_key: Option<String>) -> Self {
        Self {
            base_url,
            api_key,
            client: Client::new(),
        }
    }

    pub fn is_configured(&self) -> bool {
        !self.base_url.trim().is_empty()
    }

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
