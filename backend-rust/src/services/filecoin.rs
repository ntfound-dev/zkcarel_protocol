use crate::{
    config::Config,
    error::{AppError, Result},
    services::ipfs::IpfsService,
};
use reqwest::Client;
use serde_json::Value;
use std::path::Path;
use std::process::Stdio;
use tokio::{io::AsyncWriteExt, process::Command};

const SYNAPSE_MODE_UPLOAD: &str = "upload";
const SYNAPSE_MODE_DOWNLOAD: &str = "download";

// Internal helper that validates CLI-safe arguments for Synapse usage.
fn ensure_safe_synapse_arg(label: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        return Err(AppError::BadRequest(format!(
            "Synapse {} must be non-empty",
            label
        )));
    }
    for ch in value.chars() {
        if ch.is_control()
            || ch.is_whitespace()
            || matches!(
                ch,
                ';' | '&' | '|' | '$' | '<' | '>' | '`' | '"' | '\'' | '\\'
            )
        {
            return Err(AppError::BadRequest(format!(
                "Synapse {} contains invalid characters",
                label
            )));
        }
    }
    Ok(())
}

// Internal helper that validates the synapse command path.
fn ensure_synapse_command_path(command: &str) -> Result<()> {
    if command.trim().is_empty() {
        return Err(AppError::BadRequest(
            "Synapse command path cannot be empty".to_string(),
        ));
    }
    if command.chars().any(|ch| ch.is_control()) {
        return Err(AppError::BadRequest(
            "Synapse command path contains invalid characters".to_string(),
        ));
    }
    if !Path::new(command).exists() {
        return Err(AppError::BadRequest(format!(
            "Synapse command path not found: {}",
            command
        )));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FilecoinBackend {
    Synapse,
    Pin,
}

pub struct FilecoinService {
    client: Client,
    backend: FilecoinBackend,
    pin_api_url: Option<String>,
    pin_api_key: Option<String>,
    ipfs: Option<IpfsService>,
    synapse_script: Option<String>,
    synapse_private_key: Option<String>,
    synapse_rpc_url: Option<String>,
    synapse_with_cdn: bool,
    synapse_source: Option<String>,
}

impl FilecoinService {
    pub fn from_config(config: &Config) -> Result<Self> {
        let backend = resolve_backend(config)?;
        let ipfs = if backend == FilecoinBackend::Pin {
            Some(IpfsService::from_config(config)?)
        } else {
            None
        };
        Ok(Self {
            client: Client::new(),
            backend,
            pin_api_url: config
                .filecoin_pin_api_url
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            pin_api_key: config
                .filecoin_pin_api_key
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            ipfs,
            synapse_script: config
                .filecoin_synapse_script
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            synapse_private_key: config
                .filecoin_synapse_private_key
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            synapse_rpc_url: config
                .filecoin_synapse_rpc_url
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            synapse_with_cdn: config.filecoin_synapse_with_cdn.unwrap_or(false),
            synapse_source: config
                .filecoin_synapse_source
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
        })
    }

    pub async fn upload_encrypted_note(
        &self,
        encrypted_note: &str,
        note_commitment: &str,
    ) -> Result<String> {
        if encrypted_note.trim().is_empty() {
            return Err(AppError::BadRequest(
                "Encrypted note payload is empty".to_string(),
            ));
        }
        if note_commitment.trim().is_empty() {
            return Err(AppError::BadRequest(
                "note_commitment is required for Filecoin note upload".to_string(),
            ));
        }

        match self.backend {
            FilecoinBackend::Synapse => {
                self.upload_via_synapse(encrypted_note, note_commitment)
                    .await
            }
            FilecoinBackend::Pin => self.upload_via_pin(encrypted_note, note_commitment).await,
        }
    }

    async fn upload_via_synapse(
        &self,
        encrypted_note: &str,
        note_commitment: &str,
    ) -> Result<String> {
        let payload = serde_json::json!({
            "note_enc": encrypted_note,
            "commitment": note_commitment,
            "timestamp": chrono::Utc::now().timestamp_millis(),
        });
        let payload_body = payload.to_string();
        let stdout = self
            .run_synapse_command("upload", Some(payload_body.as_str()), None)
            .await?;
        let parsed: Value = serde_json::from_str(stdout.trim()).map_err(|error| {
            AppError::BadRequest(format!(
                "Synapse upload returned invalid JSON payload: {}",
                error
            ))
        })?;
        let cid = parsed
            .get("pieceCid")
            .and_then(Value::as_str)
            .or_else(|| parsed.get("dataCid").and_then(Value::as_str))
            .or_else(|| parsed.get("payloadCid").and_then(Value::as_str))
            .or_else(|| parsed.get("cid").and_then(Value::as_str))
            .ok_or_else(|| {
                AppError::BadRequest("Synapse upload response missing CID".to_string())
            })?;
        Ok(cid.to_string())
    }

    async fn upload_via_pin(&self, encrypted_note: &str, note_commitment: &str) -> Result<String> {
        let ipfs = self.ipfs.as_ref().ok_or_else(|| {
            AppError::BadRequest(
                "IPFS_NODE_URL is not configured for Filecoin Pin uploads".to_string(),
            )
        })?;
        let payload = serde_json::json!({
            "note_enc": encrypted_note,
            "commitment": note_commitment,
            "timestamp": chrono::Utc::now().timestamp_millis(),
        });
        let cid = ipfs.add_json_payload(&payload).await?;
        self.pin_cid(&cid, note_commitment).await?;
        Ok(cid)
    }

    async fn pin_cid(&self, cid: &str, note_commitment: &str) -> Result<()> {
        let api_url = self.pin_api_url.as_deref().ok_or_else(|| {
            AppError::BadRequest("FILECOIN_PIN_API_URL is not configured".to_string())
        })?;
        let endpoint = resolve_pin_api_url(api_url);
        let mut request = self.client.post(endpoint).json(&serde_json::json!({
            "cid": cid,
            "name": "carel_note",
            "meta": {
                "commitment": note_commitment,
                "source": "carel_protocol"
            }
        }));
        if let Some(api_key) = self.pin_api_key.as_deref() {
            request = request
                .header(
                    reqwest::header::AUTHORIZATION,
                    format!("Bearer {}", api_key),
                )
                .header("X-API-KEY", api_key);
        }
        let response = request.send().await.map_err(|error| {
            AppError::BadRequest(format!("Filecoin Pin request failed: {}", error))
        })?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(AppError::BadRequest(format!(
                "Filecoin Pin failed (status {}): {}",
                status, body
            )));
        }
        Ok(())
    }

    async fn run_synapse_command(
        &self,
        mode: &str,
        stdin_payload: Option<&str>,
        cid: Option<&str>,
    ) -> Result<String> {
        if mode != SYNAPSE_MODE_UPLOAD && mode != SYNAPSE_MODE_DOWNLOAD {
            return Err(AppError::BadRequest(format!(
                "Unsupported Synapse mode: {}",
                mode
            )));
        }
        let command_path = self.synapse_script.as_deref().ok_or_else(|| {
            AppError::BadRequest(
                "FILECOIN_SYNAPSE_SCRIPT is not configured for Synapse uploads".to_string(),
            )
        })?;
        ensure_synapse_command_path(command_path)?;
        let private_key = self.synapse_private_key.as_deref().ok_or_else(|| {
            AppError::BadRequest("FILECOIN_SYNAPSE_PRIVATE_KEY is not configured".to_string())
        })?;
        ensure_safe_synapse_arg("private key", private_key)?;

        let is_script = command_path.ends_with(".mjs") || command_path.ends_with(".js");
        let mut command = if is_script {
            let mut cmd = Command::new("node");
            cmd.arg(command_path);
            cmd
        } else {
            Command::new(command_path)
        };
        command.arg(mode);
        if let Some(cid) = cid {
            ensure_safe_synapse_arg("cid", cid)?;
            command.arg(cid);
        }
        command.env("SYNAPSE_PRIVATE_KEY", private_key);
        if let Some(rpc_url) = self.synapse_rpc_url.as_deref() {
            command.env("SYNAPSE_RPC_URL", rpc_url);
        }
        if self.synapse_with_cdn {
            command.env("SYNAPSE_WITH_CDN", "1");
        }
        if let Some(source) = self.synapse_source.as_deref() {
            command.env("SYNAPSE_SOURCE", source);
        }
        command.stdin(Stdio::piped());
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());

        let mut child = command.spawn().map_err(|error| {
            AppError::BadRequest(format!("Failed to start Synapse script: {}", error))
        })?;

        if let Some(payload) = stdin_payload {
            if let Some(mut stdin) = child.stdin.take() {
                stdin.write_all(payload.as_bytes()).await.map_err(|error| {
                    AppError::BadRequest(format!(
                        "Failed to write Synapse payload to stdin: {}",
                        error
                    ))
                })?;
            }
        }

        let output = child
            .wait_with_output()
            .await
            .map_err(|error| AppError::BadRequest(format!("Synapse script failed: {}", error)))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::BadRequest(format!(
                "Synapse script error: {}",
                stderr.trim()
            )));
        }
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }
}

fn resolve_backend(config: &Config) -> Result<FilecoinBackend> {
    if let Some(raw) = config
        .filecoin_backend
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return match raw.to_ascii_lowercase().as_str() {
            "synapse" => Ok(FilecoinBackend::Synapse),
            "pin" | "filecoin_pin" | "pinning" => Ok(FilecoinBackend::Pin),
            _ => Err(AppError::BadRequest(format!(
                "Unsupported FILECOIN_BACKEND '{}'. Use 'synapse' or 'pin'.",
                raw
            ))),
        };
    }

    if config
        .filecoin_synapse_private_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
    {
        return Ok(FilecoinBackend::Synapse);
    }
    if config
        .filecoin_pin_api_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
    {
        return Ok(FilecoinBackend::Pin);
    }

    Err(AppError::BadRequest(
        "Filecoin backend is not configured. Set FILECOIN_BACKEND to 'synapse' or 'pin'."
            .to_string(),
    ))
}

fn resolve_pin_api_url(base: &str) -> String {
    let trimmed = base.trim_end_matches('/');
    if trimmed.ends_with("/pins") || trimmed.contains("/pins/") {
        trimmed.to_string()
    } else {
        format!("{}/pins", trimmed)
    }
}
