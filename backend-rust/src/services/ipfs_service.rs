use crate::{config::Config, error::Result, services::ipfs::IpfsService};

/// Handles IPFS logging for AI execution audit trails.
pub struct IpfsLogService {
    ipfs: IpfsService,
}

impl IpfsLogService {
    pub fn from_config(config: &Config) -> Result<Self> {
        Ok(Self {
            ipfs: IpfsService::from_config(config)?,
        })
    }

    /// Uploads AI execution log JSON to IPFS and returns CID.
    pub async fn upload_ai_log_to_ipfs(
        &self,
        prompt: &str,
        response: &serde_json::Value,
    ) -> Result<String> {
        let payload = serde_json::json!({
            "prompt": prompt,
            "response": response,
            "timestamp": chrono::Utc::now().timestamp_millis(),
        });
        self.ipfs.add_json_payload(&payload).await
    }
}
