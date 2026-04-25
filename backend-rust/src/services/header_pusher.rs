use crate::{config::Config, error::Result, services::onchain::OnchainInvoker};
use reqwest::Client;
use std::sync::Arc;
use tokio::time::{self, Duration};

const DEFAULT_HEADER_API_BASE: &str = "https://mempool.space/testnet/api";
const DEFAULT_POLL_INTERVAL_SECS: u64 = 60;

pub struct HeaderPusher {
    client: Client,
    api_base: String,
    poll_interval: Duration,
    light_client_address: Option<String>,
    invoker: Option<OnchainInvoker>,
}

impl HeaderPusher {
    pub fn new(config: &Config) -> Self {
        let api_base = std::env::var("BTC_HEADER_API_BASE")
            .ok()
            .or_else(|| std::env::var("BTC_MEMPOOL_API_BASE").ok())
            .unwrap_or_else(|| DEFAULT_HEADER_API_BASE.to_string())
            .trim_end_matches('/')
            .to_string();

        let poll_interval = std::env::var("BTC_HEADER_POLL_SECS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(DEFAULT_POLL_INTERVAL_SECS);

        let light_client_address = std::env::var("BTC_LIGHT_CLIENT_ADDRESS")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

        let invoker = OnchainInvoker::from_config(config).ok().flatten();

        Self {
            client: Client::new(),
            api_base,
            poll_interval: Duration::from_secs(poll_interval),
            light_client_address,
            invoker,
        }
    }

    pub async fn start(self: Arc<Self>) {
        tokio::spawn(async move {
            let mut ticker = time::interval(self.poll_interval);
            ticker.set_missed_tick_behavior(time::MissedTickBehavior::Delay);
            let mut last_tip: Option<String> = None;

            loop {
                ticker.tick().await;
                if let Err(err) = self.tick(&mut last_tip).await {
                    tracing::error!("BTC header pusher error: {}", err);
                }
            }
        });
    }

    async fn tick(&self, last_tip: &mut Option<String>) -> Result<()> {
        let tip_hash = fetch_tip_hash(&self.client, &self.api_base).await?;
        if last_tip.as_deref() == Some(tip_hash.as_str()) {
            return Ok(());
        }
        *last_tip = Some(tip_hash.clone());

        let header_hex = fetch_header_hex(&self.client, &self.api_base, &tip_hash).await?;
        self.submit_header(&tip_hash, &header_hex).await
    }

    async fn submit_header(&self, tip_hash: &str, header_hex: &str) -> Result<()> {
        let Some(_address) = self.light_client_address.as_deref() else {
            tracing::warn!(
                "BTC header pusher skipped (BTC_LIGHT_CLIENT_ADDRESS not set); latest tip {}",
                tip_hash
            );
            return Ok(());
        };
        let Some(_invoker) = self.invoker.as_ref() else {
            tracing::warn!(
                "BTC header pusher skipped (backend signer not configured); latest tip {}",
                tip_hash
            );
            return Ok(());
        };

        tracing::info!(
            "BTC header fetched ({} bytes). Wire up store_header calldata to submit on-chain.",
            header_hex.len() / 2
        );
        Ok(())
    }
}

async fn fetch_tip_hash(client: &Client, api_base: &str) -> Result<String> {
    let url = format!("{}/blocks/tip/hash", api_base.trim_end_matches('/'));
    let response = client.get(url).send().await.map_err(|err| {
        crate::error::AppError::BadRequest(format!("BTC tip hash error: {}", err))
    })?;
    let status = response.status();
    if !status.is_success() {
        return Err(crate::error::AppError::BadRequest(format!(
            "BTC tip hash status {}",
            status
        )));
    }
    let text = response.text().await.map_err(|err| {
        crate::error::AppError::BadRequest(format!("BTC tip hash read error: {}", err))
    })?;
    Ok(text.trim().to_string())
}

async fn fetch_header_hex(client: &Client, api_base: &str, hash: &str) -> Result<String> {
    let url = format!("{}/block/{}/header", api_base.trim_end_matches('/'), hash);
    let response =
        client.get(url).send().await.map_err(|err| {
            crate::error::AppError::BadRequest(format!("BTC header error: {}", err))
        })?;
    let status = response.status();
    if !status.is_success() {
        return Err(crate::error::AppError::BadRequest(format!(
            "BTC header status {}",
            status
        )));
    }
    let text = response.text().await.map_err(|err| {
        crate::error::AppError::BadRequest(format!("BTC header read error: {}", err))
    })?;
    Ok(text.trim().to_string())
}
