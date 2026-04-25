use crate::{
    config::Config,
    error::{AppError, Result},
};
use reqwest::{multipart, Client};
use serde_json::Value;

pub struct IpfsService {
    client: Client,
    api_url: String,
    api_key: Option<String>,
}

impl IpfsService {
    pub fn from_config(config: &Config) -> Result<Self> {
        let api_url = config
            .ipfs_api_url
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::BadRequest("IPFS_NODE_URL is not configured".to_string()))?;

        Ok(Self {
            client: Client::new(),
            api_url: api_url.to_string(),
            api_key: config.ipfs_api_key.clone(),
        })
    }

    pub async fn add_json_payload(&self, payload: &Value) -> Result<String> {
        let add_url = resolve_add_url(&self.api_url);
        let part = multipart::Part::text(payload.to_string())
            .file_name("payload.json")
            .mime_str("application/json")
            .map_err(|error| {
                AppError::BadRequest(format!("Failed to build IPFS upload payload: {}", error))
            })?;
        let form = multipart::Form::new().part("file", part);

        let mut request = self.client.post(add_url).multipart(form);
        if let Some(api_key) = self.api_key.as_deref().filter(|value| !value.is_empty()) {
            request = request
                .header(
                    reqwest::header::AUTHORIZATION,
                    format!("Bearer {}", api_key),
                )
                .header("X-API-KEY", api_key);
        }

        let response = request.send().await.map_err(|error| {
            AppError::BadRequest(format!("IPFS upload request failed: {}", error))
        })?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(AppError::BadRequest(format!(
                "IPFS upload failed (status {}): {}",
                status, body
            )));
        }

        extract_cid_from_body(&body)
            .ok_or_else(|| AppError::BadRequest("IPFS upload response missing CID".to_string()))
    }
}

fn resolve_add_url(base: &str) -> String {
    let trimmed = base.trim_end_matches('/');
    if trimmed.contains("/api/v0/add") {
        trimmed.to_string()
    } else {
        format!("{}/api/v0/add", trimmed)
    }
}

fn extract_cid_from_body(body: &str) -> Option<String> {
    let mut parsed_any = false;
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
            parsed_any = true;
            if let Some(cid) = extract_cid_from_value(&value) {
                return Some(cid);
            }
        }
    }
    if !parsed_any {
        if let Ok(value) = serde_json::from_str::<Value>(body) {
            return extract_cid_from_value(&value);
        }
    }
    None
}

fn extract_cid_from_value(value: &Value) -> Option<String> {
    if let Some(cid) = value.get("Hash").and_then(Value::as_str) {
        return Some(cid.to_string());
    }
    if let Some(cid) = value.get("Cid").and_then(Value::as_str) {
        return Some(cid.to_string());
    }
    if let Some(cid) = value.get("cid").and_then(Value::as_str) {
        return Some(cid.to_string());
    }
    if let Some(cid) = value
        .get("cid")
        .and_then(|inner| inner.get("/"))
        .and_then(Value::as_str)
    {
        return Some(cid.to_string());
    }
    if let Some(data) = value.get("data") {
        if let Some(cid) = extract_cid_from_value(data) {
            return Some(cid);
        }
    }
    None
}
