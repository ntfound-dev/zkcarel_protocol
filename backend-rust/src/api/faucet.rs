use axum::{extract::State, Json};
use serde::Serialize; 

use crate::{
    constants::{
        FAUCET_AMOUNT_BTC,
        FAUCET_AMOUNT_CAREL,
        FAUCET_AMOUNT_ETH,
        FAUCET_AMOUNT_STRK,
    },
    error::Result,
    models::{ApiResponse, FaucetClaimRequest, FaucetClaimResponse},
    services::faucet_service::{FaucetService, FaucetStats}, 
};


use super::AppState;

fn compute_next_claim_in(
    next_claim: Option<chrono::DateTime<chrono::Utc>>,
    now: chrono::DateTime<chrono::Utc>,
) -> i64 {
    match next_claim {
        Some(next) => {
            let diff = (next - now).num_seconds();
            if diff > 0 { diff } else { 0 }
        }
        None => 0,
    }
}

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

/// POST /api/v1/faucet/claim
pub async fn claim_tokens(
    State(state): State<AppState>,
    Json(req): Json<FaucetClaimRequest>,
) -> Result<Json<ApiResponse<FaucetClaimResponse>>> {
    // Tips: Kedepannya ambil user_address dari JWT auth state
    let user_address = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F"; 

    let faucet = FaucetService::new(state.db.clone(), state.config.clone())?;

    // Eksekusi klaim (sekarang sudah mengecek saldo via provider)
    let tx_hash = faucet.claim_tokens(user_address, &req.token).await?;

    let next_claim = faucet.get_next_claim_time(user_address, &req.token).await?;
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
) -> Result<Json<ApiResponse<FaucetStatusResponse>>> {
    let user_address = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";

    let faucet = FaucetService::new(state.db.clone(), state.config.clone())?;

    let mut token_status = Vec::new();

    for token in &["BTC", "ETH", "STRK", "CAREL"] {
        let can_claim = faucet.can_claim(user_address, token).await?;
        let next_claim = faucet.get_next_claim_time(user_address, token).await?;
        let last_claim_at = faucet
            .get_last_claim(user_address, token)
            .await?
            .map(|c| c.claimed_at);

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
    fn compute_next_claim_in_returns_zero_when_none() {
        // Memastikan None menghasilkan 0 detik
        let now = Utc.timestamp_opt(1_700_000_000, 0).unwrap();
        assert_eq!(compute_next_claim_in(None, now), 0);
    }

    #[test]
    fn compute_next_claim_in_clamps_past_to_zero() {
        // Memastikan waktu klaim yang sudah lewat dikembalikan 0
        let now = Utc.timestamp_opt(1_700_000_000, 0).unwrap();
        let past = Utc.timestamp_opt(1_699_999_000, 0).unwrap();
        assert_eq!(compute_next_claim_in(Some(past), now), 0);
    }

    #[test]
    fn faucet_amount_from_options_uses_overrides() {
        // Memastikan override config dipakai jika tersedia
        let amount = faucet_amount_from_options("BTC", Some(0.02), None, None);
        assert!((amount - 0.02).abs() < f64::EPSILON);
    }
}
