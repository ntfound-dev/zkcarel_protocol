use crate::error::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use url::Url;

#[derive(Debug, Clone)]
pub struct GardenClient {
    api_key: String,
    api_url: String,
}

impl GardenClient {
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
    pub fn new(api_key: String, api_url: String) -> Self {
        Self { api_key, api_url }
    }

    /// Fetches data for `get_quote`.
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
    pub async fn get_quote(
        &self,
        from_chain: &str,
        to_chain: &str,
        from_token: &str,
        to_token: &str,
        amount: f64,
    ) -> Result<GardenQuote> {
        if self.api_url.trim().is_empty() {
            return Err(crate::error::AppError::ExternalAPI(
                "Garden API is not configured".to_string(),
            ));
        }

        let from_asset = map_garden_asset(from_chain, from_token);
        let to_asset = map_garden_asset(to_chain, to_token);
        let from_amount_units = to_base_units(amount, garden_decimals(from_token));

        let mut url = Url::parse(&format!("{}/v2/quote", self.api_url.trim_end_matches('/')))
            .map_err(|e| crate::error::AppError::Internal(format!("Invalid Garden URL: {}", e)))?;
        url.query_pairs_mut()
            .append_pair("from", &from_asset)
            .append_pair("to", &to_asset)
            .append_pair("from_amount", &from_amount_units.to_string());
        let timeout_secs = std::env::var("BRIDGE_QUOTE_TIMEOUT_SECS")
            .ok()
            .and_then(|raw| raw.parse::<u64>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(12);
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(4))
            .timeout(Duration::from_secs(timeout_secs))
            .build()
            .map_err(|e| {
                crate::error::AppError::Internal(format!("Garden HTTP client init failed: {}", e))
            })?;
        let response = client
            .get(url)
            .header("garden-app-id", self.api_key.trim())
            .send()
            .await
            .map_err(|e| {
                crate::error::AppError::ExternalAPI(format!("Garden quote request failed: {}", e))
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(crate::error::AppError::ExternalAPI(
                humanize_garden_api_error(
                    "quote",
                    status,
                    &body,
                    Some(from_chain),
                    Some(to_chain),
                    Some(from_token),
                    Some(to_token),
                )
                .to_string(),
            ));
        }

        let body: Value = response.json().await.map_err(|e| {
            crate::error::AppError::ExternalAPI(format!("Garden quote parse failed: {}", e))
        })?;

        let destination_amount_units = pick_u128(
            &body,
            &[
                &["result", "0", "destination", "amount"],
                &["result", "destination", "amount"],
                &["destination", "amount"],
            ],
        )
        .unwrap_or(from_amount_units);
        let fee_units = pick_u128(
            &body,
            &[&["result", "0", "fee"], &["result", "fee"], &["fee"]],
        )
        .unwrap_or(0);
        let estimated_time_seconds = pick_u128(
            &body,
            &[
                &["result", "0", "estimated_time"],
                &["result", "estimated_time"],
                &["estimated_time"],
                &["result", "0", "eta"],
                &["result", "eta"],
                &["eta"],
            ],
        )
        .unwrap_or(1800);

        let amount_out = from_base_units(destination_amount_units, garden_decimals(to_token));
        let fee = from_base_units(fee_units, garden_decimals(from_token));
        let estimated_time_minutes = ((estimated_time_seconds as f64) / 60.0).ceil() as u32;

        Ok(GardenQuote {
            from_chain: from_chain.to_string(),
            to_chain: to_chain.to_string(),
            from_token: from_token.to_string(),
            to_token: to_token.to_string(),
            amount_in: amount,
            amount_out,
            fee,
            estimated_time_minutes: estimated_time_minutes.max(1),
        })
    }

    /// Runs `execute_bridge` and handles related side effects.
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
    pub async fn execute_bridge(
        &self,
        quote: &GardenQuote,
        source_owner: &str,
        destination_owner: &str,
    ) -> Result<GardenOrderSubmission> {
        if self.api_url.trim().is_empty() {
            return Err(crate::error::AppError::ExternalAPI(
                "Garden API is not configured".to_string(),
            ));
        }
        if source_owner.trim().is_empty() || destination_owner.trim().is_empty() {
            return Err(crate::error::AppError::BadRequest(
                "Garden execute requires source owner and destination owner".to_string(),
            ));
        }

        let url = format!("{}/v2/orders", self.api_url.trim_end_matches('/'));
        let from_asset = map_garden_asset(&quote.from_chain, &quote.from_token);
        let to_asset = map_garden_asset(&quote.to_chain, &quote.to_token);
        let from_amount = to_base_units(quote.amount_in, garden_decimals(&quote.from_token));
        let mut destination_amount =
            to_base_units(quote.amount_out, garden_decimals(&quote.to_token));
        if destination_amount == 0 {
            destination_amount = to_base_units(quote.amount_in, garden_decimals(&quote.to_token));
        }
        let client = reqwest::Client::new();
        let response = client
            .post(&url)
            .header("garden-app-id", self.api_key.trim())
            .json(&GardenExecuteRequest {
                source: GardenOrderLeg {
                    asset: from_asset,
                    owner: source_owner.trim().to_string(),
                    amount: from_amount.to_string(),
                },
                destination: GardenOrderLeg {
                    asset: to_asset,
                    owner: destination_owner.trim().to_string(),
                    amount: destination_amount.to_string(),
                },
            })
            .send()
            .await
            .map_err(|e| {
                crate::error::AppError::ExternalAPI(format!("Garden execute failed: {}", e))
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(crate::error::AppError::ExternalAPI(
                humanize_garden_api_error(
                    "order",
                    status,
                    &body,
                    Some(&quote.from_chain),
                    Some(&quote.to_chain),
                    Some(&quote.from_token),
                    Some(&quote.to_token),
                )
                .to_string(),
            ));
        }

        let body: Value = response.json().await.map_err(|e| {
            crate::error::AppError::ExternalAPI(format!("Garden execute parse failed: {}", e))
        })?;
        if let Some(id) = pick_string(
            &body,
            &[
                &["result", "order_id"],
                &["result", "id"],
                &["result", "0", "order_id"],
                &["result", "0", "id"],
                &["order_id"],
                &["id"],
            ],
        ) {
            let deposit_address = pick_string(
                &body,
                &[&["result", "to"], &["result", "deposit_address"], &["to"]],
            );
            let deposit_amount = pick_string(
                &body,
                &[
                    &["result", "amount"],
                    &["result", "source", "amount"],
                    &["amount"],
                ],
            );
            let approval_raw = pick_value_by_path(&body, &["result", "approval_transaction"])
                .or_else(|| pick_value_by_path(&body, &["approval_transaction"]));
            let initiate_raw = pick_value_by_path(&body, &["result", "initiate_transaction"])
                .or_else(|| pick_value_by_path(&body, &["initiate_transaction"]));
            return Ok(GardenOrderSubmission {
                order_id: id,
                deposit_address,
                deposit_amount,
                evm_approval_transaction: approval_raw.and_then(parse_evm_transaction),
                evm_initiate_transaction: initiate_raw.and_then(parse_evm_transaction),
                starknet_approval_transaction: approval_raw.and_then(parse_starknet_transaction),
                starknet_initiate_transaction: initiate_raw.and_then(parse_starknet_transaction),
            });
        }

        Err(crate::error::AppError::ExternalAPI(
            "Garden execute response missing order_id".to_string(),
        ))
    }

    /// Fetches data for `get_order_status`.
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
    pub async fn get_order_status(&self, order_id: &str) -> Result<GardenOrderStatus> {
        if self.api_url.trim().is_empty() {
            return Err(crate::error::AppError::ExternalAPI(
                "Garden API is not configured".to_string(),
            ));
        }
        let normalized = order_id.trim();
        if normalized.is_empty() {
            return Err(crate::error::AppError::BadRequest(
                "order_id is required".to_string(),
            ));
        }

        let url = format!(
            "{}/v2/orders/{}",
            self.api_url.trim_end_matches('/'),
            normalized
        );
        let client = reqwest::Client::new();
        let response = client
            .get(&url)
            .header("garden-app-id", self.api_key.trim())
            .send()
            .await
            .map_err(|e| {
                crate::error::AppError::ExternalAPI(format!(
                    "Garden order status request failed: {}",
                    e
                ))
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(crate::error::AppError::ExternalAPI(
                humanize_garden_api_error("order status", status, &body, None, None, None, None)
                    .to_string(),
            ));
        }

        let body: Value = response.json().await.map_err(|e| {
            crate::error::AppError::ExternalAPI(format!("Garden order status parse failed: {}", e))
        })?;

        let result = pick_value_by_path(&body, &["result"]).unwrap_or(&body);
        let resolved_id = pick_string(
            result,
            &[
                &["order_id"],
                &["id"],
                &["nonce"],
                &["source_swap", "swap_id"],
            ],
        )
        .unwrap_or_else(|| normalized.to_string());
        let source_initiate_tx_hash = pick_string_non_empty(
            result,
            &[
                &["source_swap", "initiate_tx_hash"],
                &["source_swap", "initiateTxHash"],
            ],
        );
        let source_redeem_tx_hash = pick_string_non_empty(
            result,
            &[
                &["source_swap", "redeem_tx_hash"],
                &["source_swap", "redeemTxHash"],
            ],
        );
        let destination_initiate_tx_hash = pick_string_non_empty(
            result,
            &[
                &["destination_swap", "initiate_tx_hash"],
                &["destination_swap", "initiateTxHash"],
            ],
        );
        let destination_redeem_tx_hash = pick_string_non_empty(
            result,
            &[
                &["destination_swap", "redeem_tx_hash"],
                &["destination_swap", "redeemTxHash"],
            ],
        );
        let version = pick_string_non_empty(result, &[&["version"]]);
        let status = if destination_redeem_tx_hash.is_some() {
            "completed".to_string()
        } else if source_initiate_tx_hash.is_some() || destination_initiate_tx_hash.is_some() {
            "initiated".to_string()
        } else {
            "pending".to_string()
        };

        Ok(GardenOrderStatus {
            order_id: resolved_id,
            status,
            source_initiate_tx_hash,
            source_redeem_tx_hash,
            destination_initiate_tx_hash,
            destination_redeem_tx_hash,
            version,
        })
    }

    /// Fetches data for `get_total_volume`.
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
    pub async fn get_total_volume(
        &self,
        source_chain: Option<&str>,
        destination_chain: Option<&str>,
        address: Option<&str>,
        from: Option<i64>,
        to: Option<i64>,
    ) -> Result<Value> {
        let mut params: Vec<(&str, String)> = Vec::new();
        if let Some(value) = source_chain
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            params.push(("source_chain", value.to_string()));
        }
        if let Some(value) = destination_chain
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            params.push(("destination_chain", value.to_string()));
        }
        if let Some(value) = address.map(str::trim).filter(|value| !value.is_empty()) {
            params.push(("address", value.to_string()));
        }
        if let Some(value) = from.filter(|value| *value > 0) {
            params.push(("from", value.to_string()));
        }
        if let Some(value) = to.filter(|value| *value > 0) {
            params.push(("to", value.to_string()));
        }
        self.get_json("/v2/volume", &params).await
    }

    /// Fetches data for `get_total_fees`.
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
    pub async fn get_total_fees(
        &self,
        source_chain: Option<&str>,
        destination_chain: Option<&str>,
        address: Option<&str>,
        from: Option<i64>,
        to: Option<i64>,
    ) -> Result<Value> {
        let mut params: Vec<(&str, String)> = Vec::new();
        if let Some(value) = source_chain
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            params.push(("source_chain", value.to_string()));
        }
        if let Some(value) = destination_chain
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            params.push(("destination_chain", value.to_string()));
        }
        if let Some(value) = address.map(str::trim).filter(|value| !value.is_empty()) {
            params.push(("address", value.to_string()));
        }
        if let Some(value) = from.filter(|value| *value > 0) {
            params.push(("from", value.to_string()));
        }
        if let Some(value) = to.filter(|value| *value > 0) {
            params.push(("to", value.to_string()));
        }
        self.get_json("/v2/fees", &params).await
    }

    /// Fetches data for `get_supported_chains`.
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
    pub async fn get_supported_chains(&self, from_asset: Option<&str>) -> Result<Value> {
        let mut params: Vec<(&str, String)> = Vec::new();
        if let Some(value) = from_asset.map(str::trim).filter(|value| !value.is_empty()) {
            params.push(("from", value.to_string()));
        }
        self.get_json("/v2/chains", &params).await
    }

    /// Fetches data for `get_supported_assets`.
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
    pub async fn get_supported_assets(&self, from_asset: Option<&str>) -> Result<Value> {
        let mut params: Vec<(&str, String)> = Vec::new();
        if let Some(value) = from_asset.map(str::trim).filter(|value| !value.is_empty()) {
            params.push(("from", value.to_string()));
        }
        self.get_json("/v2/assets", &params).await
    }

    /// Fetches data for `get_available_liquidity`.
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
    pub async fn get_available_liquidity(&self) -> Result<Value> {
        self.get_json("/v2/liquidity", &[]).await
    }

    #[allow(clippy::too_many_arguments)]
    /// Fetches data for `get_orders`.
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
    pub async fn get_orders(
        &self,
        address: Option<&str>,
        tx_hash: Option<&str>,
        from_chain: Option<&str>,
        to_chain: Option<&str>,
        from_owner: Option<&str>,
        to_owner: Option<&str>,
        solver_id: Option<&str>,
        integrator: Option<&str>,
        page: Option<u32>,
        per_page: Option<u32>,
        status: Option<&str>,
    ) -> Result<Value> {
        let mut params: Vec<(&str, String)> = Vec::new();
        if let Some(value) = address.map(str::trim).filter(|value| !value.is_empty()) {
            params.push(("address", value.to_string()));
        }
        if let Some(value) = tx_hash.map(str::trim).filter(|value| !value.is_empty()) {
            params.push(("tx_hash", value.to_string()));
        }
        if let Some(value) = from_chain.map(str::trim).filter(|value| !value.is_empty()) {
            params.push(("from_chain", value.to_string()));
        }
        if let Some(value) = to_chain.map(str::trim).filter(|value| !value.is_empty()) {
            params.push(("to_chain", value.to_string()));
        }
        if let Some(value) = from_owner.map(str::trim).filter(|value| !value.is_empty()) {
            params.push(("from_owner", value.to_string()));
        }
        if let Some(value) = to_owner.map(str::trim).filter(|value| !value.is_empty()) {
            params.push(("to_owner", value.to_string()));
        }
        if let Some(value) = solver_id.map(str::trim).filter(|value| !value.is_empty()) {
            params.push(("solver_id", value.to_string()));
        }
        if let Some(value) = integrator.map(str::trim).filter(|value| !value.is_empty()) {
            params.push(("integrator", value.to_string()));
        }
        if let Some(value) = page.filter(|value| *value > 0) {
            params.push(("page", value.to_string()));
        }
        if let Some(value) = per_page.filter(|value| *value > 0) {
            params.push(("per_page", value.to_string()));
        }
        if let Some(value) = status.map(str::trim).filter(|value| !value.is_empty()) {
            params.push(("status", value.to_string()));
        }
        self.get_json("/v2/orders", &params).await
    }

    /// Fetches data for `get_order_by_id`.
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
    pub async fn get_order_by_id(&self, order_id: &str) -> Result<Value> {
        let normalized = validate_path_segment("order", order_id)?;
        self.get_json(&format!("/v2/orders/{}", normalized), &[])
            .await
    }

    /// Fetches data for `get_order_instant_refund_hash`.
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
    pub async fn get_order_instant_refund_hash(&self, order_id: &str) -> Result<Value> {
        let normalized = validate_path_segment("order", order_id)?;
        self.get_json(
            &format!("/v2/orders/{}/instant-refund-hash", normalized),
            &[],
        )
        .await
    }

    /// Fetches data for `get_schema`.
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
    pub async fn get_schema(&self, name: &str) -> Result<Value> {
        let normalized = validate_path_segment("schema", name)?;
        self.get_json(&format!("/v2/schemas/{}", normalized), &[])
            .await
    }

    /// Fetches data for `get_app_earnings`.
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
    pub async fn get_app_earnings(&self) -> Result<Value> {
        self.get_json("/v2/apps/earnings", &[]).await
    }

    // Internal helper that fetches data for `get_json`.
    async fn get_json(&self, path: &str, params: &[(&str, String)]) -> Result<Value> {
        if self.api_url.trim().is_empty() {
            return Err(crate::error::AppError::ExternalAPI(
                "Garden API is not configured".to_string(),
            ));
        }

        let mut url = Url::parse(&format!(
            "{}/{}",
            self.api_url.trim_end_matches('/'),
            path.trim_start_matches('/')
        ))
        .map_err(|e| crate::error::AppError::Internal(format!("Invalid Garden URL: {}", e)))?;

        if !params.is_empty() {
            let mut query = url.query_pairs_mut();
            for (key, value) in params {
                if value.trim().is_empty() {
                    continue;
                }
                query.append_pair(key, value.trim());
            }
        }

        let client = reqwest::Client::new();
        let response = client
            .get(url)
            .header("garden-app-id", self.api_key.trim())
            .send()
            .await
            .map_err(|e| {
                crate::error::AppError::ExternalAPI(format!("Garden request failed: {}", e))
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(crate::error::AppError::ExternalAPI(
                humanize_garden_api_error("request", status, &body, None, None, None, None)
                    .to_string(),
            ));
        }

        response.json().await.map_err(|e| {
            crate::error::AppError::ExternalAPI(format!("Garden response parse failed: {}", e))
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GardenQuote {
    pub from_chain: String,
    pub to_chain: String,
    pub from_token: String,
    pub to_token: String,
    pub amount_in: f64,
    pub amount_out: f64,
    pub fee: f64,
    pub estimated_time_minutes: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GardenOrderSubmission {
    pub order_id: String,
    pub deposit_address: Option<String>,
    pub deposit_amount: Option<String>,
    pub evm_approval_transaction: Option<GardenEvmTransaction>,
    pub evm_initiate_transaction: Option<GardenEvmTransaction>,
    pub starknet_approval_transaction: Option<GardenStarknetTransaction>,
    pub starknet_initiate_transaction: Option<GardenStarknetTransaction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GardenOrderStatus {
    pub order_id: String,
    pub status: String,
    pub source_initiate_tx_hash: Option<String>,
    pub source_redeem_tx_hash: Option<String>,
    pub destination_initiate_tx_hash: Option<String>,
    pub destination_redeem_tx_hash: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GardenEvmTransaction {
    pub to: String,
    pub value: String,
    pub data: String,
    pub chain_id: Option<u64>,
    pub gas_limit: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GardenStarknetTransaction {
    pub to: String,
    pub selector: String,
    pub calldata: Vec<String>,
}

#[cfg(test)]
impl GardenQuote {
    // Internal helper that supports `simulated` operations.
    fn simulated(
        from_chain: &str,
        to_chain: &str,
        from_token: &str,
        to_token: &str,
        amount: f64,
    ) -> Self {
        Self {
            from_chain: from_chain.to_string(),
            to_chain: to_chain.to_string(),
            from_token: from_token.to_string(),
            to_token: to_token.to_string(),
            amount_in: amount,
            amount_out: amount * 0.995,
            fee: amount * 0.005,
            estimated_time_minutes: 30,
        }
    }

    // Internal helper that supports `simulated_id` operations.
    fn simulated_id(recipient: &str) -> String {
        let id_bytes: [u8; 16] = rand::random();
        let id_hex = hex::encode(id_bytes);
        let suffix: String = recipient
            .chars()
            .rev()
            .take(8)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        format!("GD_{}_{}", id_hex, suffix)
    }
}

#[derive(Debug, Serialize)]
struct GardenExecuteRequest {
    source: GardenOrderLeg,
    destination: GardenOrderLeg,
}

#[derive(Debug, Serialize)]
struct GardenOrderLeg {
    asset: String,
    owner: String,
    amount: String,
}

// Internal helper that supports `map_garden_chain` operations.
fn map_garden_chain(chain: &str) -> &'static str {
    match chain.trim().to_ascii_lowercase().as_str() {
        "bitcoin" | "btc" => "bitcoin_testnet",
        "ethereum" | "eth" => "ethereum_sepolia",
        "starknet" | "strk" => "starknet_sepolia",
        _ => "starknet_sepolia",
    }
}

// Internal helper that supports `validate_path_segment` operations.
fn validate_path_segment(label: &str, value: &str) -> Result<String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(crate::error::AppError::BadRequest(format!(
            "{} is required",
            label
        )));
    }
    if normalized.contains('/') {
        return Err(crate::error::AppError::BadRequest(format!(
            "{} contains invalid character '/'",
            label
        )));
    }
    Ok(normalized.to_string())
}

// Internal helper that supports `map_garden_token` operations.
fn map_garden_token(chain: &str, token: &str) -> &'static str {
    match (
        chain.trim().to_ascii_lowercase().as_str(),
        token.trim().to_ascii_uppercase().as_str(),
    ) {
        ("bitcoin", _) | ("btc", _) | ("bitcoin_testnet", _) => "btc",
        (_, "BTC") | (_, "WBTC") => "wbtc",
        (_, "ETH") => "eth",
        (_, "STRK") => "strk",
        (_, "USDT") => "usdt",
        (_, "USDC") => "usdc",
        (_, "CAREL") => "carel",
        _ => "strk",
    }
}

// Internal helper that supports `map_garden_asset` operations.
fn map_garden_asset(chain: &str, token: &str) -> String {
    format!(
        "{}:{}",
        map_garden_chain(chain),
        map_garden_token(chain, token)
    )
}

// Internal helper that supports `garden_decimals` operations.
fn garden_decimals(token: &str) -> u32 {
    match token.trim().to_ascii_uppercase().as_str() {
        "BTC" | "WBTC" => 8,
        "USDT" | "USDC" => 6,
        _ => 18,
    }
}

// Internal helper that supports `to_base_units` operations.
fn to_base_units(amount: f64, decimals: u32) -> u128 {
    if !amount.is_finite() || amount <= 0.0 {
        return 0;
    }
    let scale = 10_f64.powi(decimals as i32);
    (amount * scale).round() as u128
}

// Internal helper that supports `from_base_units` operations.
fn from_base_units(amount: u128, decimals: u32) -> f64 {
    if amount == 0 {
        return 0.0;
    }
    let scale = 10_f64.powi(decimals as i32);
    (amount as f64) / scale
}

// Internal helper that supports `compact_error_message` operations.
fn compact_error_message(raw: &str) -> String {
    raw.split_whitespace().collect::<Vec<_>>().join(" ")
}

// Internal helper that supports `format_units_as_token_amount` operations.
fn format_units_as_token_amount(units: u128, token: &str) -> String {
    let decimals = garden_decimals(token);
    if decimals == 0 {
        return units.to_string();
    }
    let scale = 10u128.pow(decimals);
    let whole = units / scale;
    let frac = units % scale;
    if frac == 0 {
        return whole.to_string();
    }
    let mut frac_text = format!("{:0width$}", frac, width = decimals as usize);
    while frac_text.ends_with('0') {
        frac_text.pop();
    }
    format!("{}.{}", whole, frac_text)
}

// Internal helper that supports `parse_garden_amount_range` operations.
fn parse_garden_amount_range(raw_lower: &str) -> Option<(u128, u128)> {
    let marker = "within the range of ";
    let start = raw_lower.find(marker)?;
    let tail = &raw_lower[start + marker.len()..];
    let mut numbers = tail
        .split(|ch: char| !ch.is_ascii_digit())
        .filter(|segment| !segment.is_empty())
        .take(2)
        .filter_map(|segment| segment.parse::<u128>().ok());
    let min = numbers.next()?;
    let max = numbers.next()?;
    Some((min, max))
}

// Internal helper that supports `extract_garden_error_message` operations.
fn extract_garden_error_message(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if let Ok(json) = serde_json::from_str::<Value>(trimmed) {
        if let Some(message) = pick_string(
            &json,
            &[
                &["error"],
                &["message"],
                &["result", "error"],
                &["result", "message"],
                &["data", "error"],
                &["data", "message"],
            ],
        ) {
            return compact_error_message(&message);
        }
    }
    let first_line = trimmed.split('\n').next().unwrap_or(trimmed);
    compact_error_message(first_line)
}

// Internal helper that supports `humanize_garden_api_error` operations.
fn humanize_garden_api_error(
    operation: &str,
    status: reqwest::StatusCode,
    body: &str,
    from_chain: Option<&str>,
    to_chain: Option<&str>,
    from_token: Option<&str>,
    to_token: Option<&str>,
) -> String {
    let detail = extract_garden_error_message(body);
    let lower = detail.to_ascii_lowercase();
    let from_chain_label = from_chain.unwrap_or("source");
    let to_chain_label = to_chain.unwrap_or("destination");
    let from_symbol = from_token.unwrap_or("TOKEN").trim().to_ascii_uppercase();
    let to_symbol = to_token.unwrap_or("TOKEN").trim().to_ascii_uppercase();

    if lower.contains("within the range of") {
        if let Some((min_units, max_units)) = parse_garden_amount_range(&lower) {
            return format!(
                "Garden {} amount is outside allowed range for {} -> {} ({} -> {}). Allowed: min {} {}, max {} {}.",
                operation,
                from_symbol,
                to_symbol,
                from_chain_label,
                to_chain_label,
                format_units_as_token_amount(min_units, &from_symbol),
                from_symbol,
                format_units_as_token_amount(max_units, &from_symbol),
                from_symbol
            );
        }
        return format!(
            "Garden {} amount is outside provider range for this pair. Try higher/lower amount.",
            operation
        );
    }

    if lower.contains("insufficient liquidity") {
        return format!(
            "Garden {} has insufficient liquidity for {} -> {} ({} -> {}). Try a different amount or retry later.",
            operation, from_symbol, to_symbol, from_chain_label, to_chain_label
        );
    }

    if lower.contains("invalid to_asset") {
        return format!(
            "Garden {} destination asset {} on {} is not available for this route.",
            operation, to_symbol, to_chain_label
        );
    }

    if lower.contains("invalid from_asset") {
        return format!(
            "Garden {} source asset {} on {} is not available for this route.",
            operation, from_symbol, from_chain_label
        );
    }

    if detail.is_empty() {
        return format!("Garden {} returned {}.", operation, status);
    }

    format!("Garden {} returned {}: {}", operation, status, detail)
}

// Internal helper that supports `pick_value_by_path` operations.
fn pick_value_by_path<'a>(body: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = body;
    for segment in path {
        let next = if let Ok(index) = segment.parse::<usize>() {
            current.get(index)?
        } else {
            current.get(*segment)?
        };
        current = next;
    }
    Some(current)
}

// Internal helper that supports `pick_u128` operations.
fn pick_u128(body: &Value, paths: &[&[&str]]) -> Option<u128> {
    for path in paths {
        if let Some(value) = pick_value_by_path(body, path).and_then(value_to_u128) {
            return Some(value);
        }
    }
    None
}

// Internal helper that supports `pick_string` operations.
fn pick_string(body: &Value, paths: &[&[&str]]) -> Option<String> {
    for path in paths {
        if let Some(value) = pick_value_by_path(body, path).and_then(value_to_string) {
            return Some(value);
        }
    }
    None
}

// Internal helper that supports `pick_string_non_empty` operations.
fn pick_string_non_empty(body: &Value, paths: &[&[&str]]) -> Option<String> {
    pick_string(body, paths).and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

// Internal helper that supports `pick_string_list` operations.
fn pick_string_list(body: &Value, paths: &[&[&str]]) -> Option<Vec<String>> {
    for path in paths {
        if let Some(value) = pick_value_by_path(body, path) {
            let list = match value {
                Value::Array(items) => items
                    .iter()
                    .filter_map(value_to_string)
                    .map(|item| item.trim().to_string())
                    .filter(|item| !item.is_empty())
                    .collect::<Vec<_>>(),
                _ => Vec::new(),
            };
            if !list.is_empty() {
                return Some(list);
            }
        }
    }
    None
}

// Internal helper that parses or transforms values for `parse_evm_transaction`.
fn parse_evm_transaction(value: &Value) -> Option<GardenEvmTransaction> {
    let to = pick_string_non_empty(value, &[&["to"]])?;
    let value_hex =
        pick_string_non_empty(value, &[&["value"]]).unwrap_or_else(|| "0x0".to_string());
    let data = pick_string_non_empty(value, &[&["data"]]).unwrap_or_else(|| "0x".to_string());
    let chain_id =
        pick_u128(value, &[&["chain_id"], &["chainId"]]).and_then(|raw| u64::try_from(raw).ok());
    let gas_limit =
        pick_u128(value, &[&["gas_limit"], &["gasLimit"]]).and_then(|raw| u64::try_from(raw).ok());
    Some(GardenEvmTransaction {
        to,
        value: value_hex,
        data,
        chain_id,
        gas_limit,
    })
}

// Internal helper that parses or transforms values for `parse_starknet_transaction`.
fn parse_starknet_transaction(value: &Value) -> Option<GardenStarknetTransaction> {
    let to = pick_string_non_empty(value, &[&["to"]])?;
    let selector = pick_string_non_empty(value, &[&["selector"]])?;
    let calldata = pick_string_list(value, &[&["calldata"]]).unwrap_or_default();
    Some(GardenStarknetTransaction {
        to,
        selector,
        calldata,
    })
}

// Internal helper that supports `value_to_u128` operations.
fn value_to_u128(value: &Value) -> Option<u128> {
    if let Some(raw) = value.as_u64() {
        return Some(raw as u128);
    }
    if let Some(raw) = value.as_f64() {
        if raw.is_finite() && raw >= 0.0 {
            return Some(raw.round() as u128);
        }
    }
    if let Some(raw) = value.as_str() {
        if let Some(hex) = raw.strip_prefix("0x").or_else(|| raw.strip_prefix("0X")) {
            if let Ok(parsed) = u128::from_str_radix(hex, 16) {
                return Some(parsed);
            }
        }
        if let Ok(parsed) = raw.parse::<u128>() {
            return Some(parsed);
        }
        if let Ok(parsed) = raw.parse::<f64>() {
            if parsed.is_finite() && parsed >= 0.0 {
                return Some(parsed.round() as u128);
            }
        }
    }
    None
}

// Internal helper that supports `value_to_string` operations.
fn value_to_string(value: &Value) -> Option<String> {
    if let Some(raw) = value.as_str() {
        if !raw.trim().is_empty() {
            return Some(raw.to_string());
        }
    }
    if let Some(raw) = value.as_u64() {
        return Some(raw.to_string());
    }
    if let Some(raw) = value.as_f64() {
        return Some(raw.to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    // Internal helper that supports `map_bitcoin_chain_always_uses_btc_asset` operations.
    fn map_bitcoin_chain_always_uses_btc_asset() {
        assert_eq!(
            map_garden_asset("bitcoin", "STRK"),
            "bitcoin_testnet:btc".to_string()
        );
    }

    #[test]
    // Internal helper that supports `pick_string_reads_order_id_from_result` operations.
    fn pick_string_reads_order_id_from_result() {
        let body = json!({
            "result": {
                "order_id": "order_123"
            }
        });
        let order_id = pick_string(&body, &[&["result", "order_id"], &["id"]]);
        assert_eq!(order_id.as_deref(), Some("order_123"));
    }

    #[test]
    // Internal helper that supports `simulated_quote_tracks_source_and_destination_tokens` operations.
    fn simulated_quote_tracks_source_and_destination_tokens() {
        let quote = GardenQuote::simulated("bitcoin", "starknet", "BTC", "STRK", 0.1);
        assert_eq!(quote.from_token, "BTC");
        assert_eq!(quote.to_token, "STRK");
        assert!(GardenQuote::simulated_id("0xabc").starts_with("GD_"));
    }

    #[test]
    // Internal helper that supports `humanize_garden_api_error_with_amount_range` operations.
    fn humanize_garden_api_error_with_amount_range() {
        let body = "{\"status\":\"Error\",\"error\":\"Exact output quote error : expected amount to be within the range of 50000 to 1000000\"}";
        let message = humanize_garden_api_error(
            "quote",
            reqwest::StatusCode::BAD_REQUEST,
            body,
            Some("starknet"),
            Some("ethereum"),
            Some("WBTC"),
            Some("ETH"),
        );
        assert_eq!(
            message,
            "Garden quote amount is outside allowed range for WBTC -> ETH (starknet -> ethereum). Allowed: min 0.0005 WBTC, max 0.01 WBTC."
        );
    }

    #[test]
    // Internal helper that supports `humanize_garden_api_error_with_insufficient_liquidity` operations.
    fn humanize_garden_api_error_with_insufficient_liquidity() {
        let body = "{\"status\":\"Error\",\"error\":\"insufficient liquidity\"}";
        let message = humanize_garden_api_error(
            "order",
            reqwest::StatusCode::BAD_REQUEST,
            body,
            Some("starknet"),
            Some("ethereum"),
            Some("WBTC"),
            Some("ETH"),
        );
        assert_eq!(
            message,
            "Garden order has insufficient liquidity for WBTC -> ETH (starknet -> ethereum). Try a different amount or retry later."
        );
    }
}
