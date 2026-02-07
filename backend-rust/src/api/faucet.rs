use axum::{extract::State, Json};
use serde::Serialize; 

use crate::{
    error::Result,
    models::{ApiResponse, FaucetClaimRequest, FaucetClaimResponse},
    services::faucet_service::{FaucetService, FaucetStats}, 
};


use super::AppState;

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
    let next_claim_in = if let Some(next) = next_claim {
        let diff = (next - chrono::Utc::now()).num_seconds();
        if diff > 0 { diff } else { 0 }
    } else {
        0
    };

    let amount = match req.token.as_str() {
        "BTC" => state.config.faucet_btc_amount.unwrap_or(0.001),
        "STRK" => state.config.faucet_strk_amount.unwrap_or(10.0),
        "CAREL" => state.config.faucet_carel_amount.unwrap_or(100.0),
        _ => 0.0,
    };

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

    for token in &["BTC", "STRK", "CAREL"] {
        let can_claim = faucet.can_claim(user_address, token).await?;
        let next_claim = faucet.get_next_claim_time(user_address, token).await?;

        token_status.push(TokenStatus {
            token: token.to_string(),
            can_claim,
            next_claim_at: next_claim,
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
}
