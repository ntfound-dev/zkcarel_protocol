use axum::{extract::State, http::HeaderMap, Json};
use serde::Serialize;
use sqlx::Row;

use crate::{
    constants::{FAUCET_AMOUNT_BTC, FAUCET_AMOUNT_CAREL, FAUCET_AMOUNT_ETH, FAUCET_AMOUNT_STRK},
    error::Result,
    models::{ApiResponse, FaucetClaimRequest, FaucetClaimResponse},
    services::faucet_service::{FaucetService, FaucetStats},
};

use super::{require_user, AppState};

// Internal helper that supports `compute_next_claim_in` operations.
fn compute_next_claim_in(
    next_claim: Option<chrono::DateTime<chrono::Utc>>,
    now: chrono::DateTime<chrono::Utc>,
) -> i64 {
    match next_claim {
        Some(next) => {
            let diff = (next - now).num_seconds();
            if diff > 0 {
                diff
            } else {
                0
            }
        }
        None => 0,
    }
}

// Internal helper that supports `faucet_amount_from_options` operations.
fn faucet_amount_from_options(
    token: &str,
    btc_amount: Option<f64>,
    strk_amount: Option<f64>,
    carel_amount: Option<f64>,
) -> f64 {
    match token {
        "BTC" => btc_amount.unwrap_or(FAUCET_AMOUNT_BTC),
        "ETH" => FAUCET_AMOUNT_ETH,
        "STRK" => strk_amount.unwrap_or(FAUCET_AMOUNT_STRK),
        "CAREL" => carel_amount.unwrap_or(FAUCET_AMOUNT_CAREL),
        _ => 0.0,
    }
}

// Internal helper that supports `faucet_cooldown_hours` operations.
fn faucet_cooldown_hours(state: &AppState) -> i64 {
    state
        .config
        .faucet_cooldown_hours
        .unwrap_or(crate::constants::FAUCET_COOLDOWN_HOURS as u64) as i64
}

// Internal helper that supports `faucet_carel_unlimited` operations.
fn faucet_carel_unlimited() -> bool {
    std::env::var("FAUCET_CAREL_UNLIMITED")
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "y" | "on"
            )
        })
        .unwrap_or(false)
}

// Internal helper that supports `token_faucet_configured` operations.
fn token_faucet_configured(state: &AppState, token: &str) -> bool {
    match token {
        "BTC" => state
            .config
            .token_btc_address
            .as_deref()
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false),
        "ETH" => state
            .config
            .token_eth_address
            .as_deref()
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false),
        "STRK" => state
            .config
            .token_strk_address
            .as_deref()
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false),
        "CAREL" => !state.config.carel_token_address.trim().is_empty(),
        _ => false,
    }
}

/// POST /api/v1/faucet/claim
pub async fn claim_tokens(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<FaucetClaimRequest>,
) -> Result<Json<ApiResponse<FaucetClaimResponse>>> {
    let user_address = require_user(&headers, &state).await?;

    let faucet = FaucetService::new(state.db.clone(), state.config.clone())?;

    // Eksekusi klaim (sekarang sudah mengecek saldo via provider)
    let tx_hash = faucet.claim_tokens(&user_address, &req.token).await?;

    let next_claim = faucet
        .get_next_claim_time(&user_address, &req.token)
        .await?;
    let next_claim_in = compute_next_claim_in(next_claim, chrono::Utc::now());

    let amount = faucet_amount_from_options(
        req.token.as_str(),
        state.config.faucet_btc_amount,
        state.config.faucet_strk_amount,
        state.config.faucet_carel_amount,
    );

    Ok(Json(ApiResponse::success(FaucetClaimResponse {
        token: req.token,
        amount,
        tx_hash,
        next_claim_in,
    })))
}

/// GET /api/v1/faucet/status
pub async fn get_status(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<FaucetStatusResponse>>> {
    let user_address = require_user(&headers, &state).await?;
    let faucet = FaucetService::new(state.db.clone(), state.config.clone()).ok();
    if faucet.is_none() {
        tracing::warn!(
            "Faucet service init failed; using fallback status mode (check backend signer config/private key)."
        );
    }
    let mut token_status = Vec::new();
    let cooldown_hours = faucet_cooldown_hours(&state);
    let carel_unlimited = faucet_carel_unlimited();

    for token in &["BTC", "ETH", "STRK", "CAREL"] {
        let (can_claim, next_claim, last_claim_at) = if let Some(faucet_service) = &faucet {
            let can_claim = faucet_service
                .can_claim(&user_address, token)
                .await
                .unwrap_or(false);
            let next_claim = faucet_service
                .get_next_claim_time(&user_address, token)
                .await
                .ok()
                .flatten();
            let last_claim_at = faucet_service
                .get_last_claim(&user_address, token)
                .await
                .ok()
                .flatten()
                .map(|c| c.claimed_at);
            (can_claim, next_claim, last_claim_at)
        } else {
            let last_claim_row = sqlx::query(
                "SELECT claimed_at FROM faucet_claims WHERE user_address = $1 AND token = $2 ORDER BY claimed_at DESC LIMIT 1",
            )
            .bind(&user_address)
            .bind(token)
            .fetch_optional(state.db.pool())
            .await
            .ok()
            .flatten();
            let last_claim_at: Option<chrono::DateTime<chrono::Utc>> =
                last_claim_row.map(|row| row.get("claimed_at"));
            let next_claim = if *token == "CAREL" && carel_unlimited {
                None
            } else {
                last_claim_at.map(|claimed| claimed + chrono::Duration::hours(cooldown_hours))
            };
            let can_claim = if !state.config.is_testnet() || !token_faucet_configured(&state, token)
            {
                false
            } else if *token == "CAREL" && carel_unlimited {
                true
            } else {
                state
                    .db
                    .can_claim_faucet(&user_address, token, cooldown_hours)
                    .await
                    .unwrap_or(false)
            };
            (can_claim, next_claim, last_claim_at)
        };

        token_status.push(TokenStatus {
            token: token.to_string(),
            can_claim,
            next_claim_at: next_claim,
            last_claim_at,
        });
    }

    Ok(Json(ApiResponse::success(FaucetStatusResponse {
        tokens: token_status,
    })))
}

/// GET /api/v1/faucet/stats
/// Menampilkan statistik distribusi faucet (DITAMBAHKAN)
pub async fn get_faucet_stats(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<FaucetStats>>> {
    let faucet = FaucetService::new(state.db.clone(), state.config.clone())?;

    // Memanggil method get_stats() yang sebelumnya dianggap dead_code
    let stats = faucet.get_stats().await?;

    Ok(Json(ApiResponse::success(stats)))
}

#[derive(Serialize)]
pub struct FaucetStatusResponse {
    pub tokens: Vec<TokenStatus>,
}

#[derive(Serialize)]
pub struct TokenStatus {
    pub token: String,
    pub can_claim: bool,
    pub next_claim_at: Option<chrono::DateTime<chrono::Utc>>,
    pub last_claim_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    #[test]
    // Internal helper that supports `compute_next_claim_in_returns_zero_when_none` operations.
    fn compute_next_claim_in_returns_zero_when_none() {
        // Memastikan None menghasilkan 0 detik
        let now = Utc.timestamp_opt(1_700_000_000, 0).unwrap();
        assert_eq!(compute_next_claim_in(None, now), 0);
    }

    #[test]
    // Internal helper that supports `compute_next_claim_in_clamps_past_to_zero` operations.
    fn compute_next_claim_in_clamps_past_to_zero() {
        // Memastikan waktu klaim yang sudah lewat dikembalikan 0
        let now = Utc.timestamp_opt(1_700_000_000, 0).unwrap();
        let past = Utc.timestamp_opt(1_699_999_000, 0).unwrap();
        assert_eq!(compute_next_claim_in(Some(past), now), 0);
    }

    #[test]
    // Internal helper that supports `faucet_amount_from_options_uses_overrides` operations.
    fn faucet_amount_from_options_uses_overrides() {
        // Memastikan override config dipakai jika tersedia
        let amount = faucet_amount_from_options("BTC", Some(0.02), None, None);
        assert!((amount - 0.02).abs() < f64::EPSILON);
    }
}
