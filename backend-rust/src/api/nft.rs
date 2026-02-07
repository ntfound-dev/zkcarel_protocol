use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use crate::{error::Result, models::ApiResponse};
use super::AppState;

#[derive(Debug, Serialize)]
pub struct NFT {
    pub token_id: String,
    pub tier: i32,
    pub discount: f64,
    pub expiry: i64,
    pub used: bool,
}

#[derive(Debug, Deserialize)]
pub struct MintRequest {
    pub tier: i32,
}

/// POST /api/v1/nft/mint
pub async fn mint_nft(
    State(_state): State<AppState>,
    Json(req): Json<MintRequest>,
) -> Result<Json<ApiResponse<NFT>>> {
    let token_id = format!("NFT_{}", hex::encode(&rand::random::<[u8; 16]>()));
    let discount = match req.tier {
        1 => 5.0, 2 => 10.0, 3 => 15.0,
        4 => 20.0, 5 => 30.0, 6 => 50.0,
        _ => 5.0,
    };
    
    let nft = NFT {
        token_id,
        tier: req.tier,
        discount,
        expiry: chrono::Utc::now().timestamp() + 86400 * 30,
        used: false,
    };
    
    Ok(Json(ApiResponse::success(nft)))
}

/// GET /api/v1/nft/owned
pub async fn get_owned_nfts(
    State(_state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<NFT>>>> {
    let nfts = vec![
        NFT {
            token_id: "NFT_001".to_string(),
            tier: 3,
            discount: 15.0,
            expiry: chrono::Utc::now().timestamp() + 86400 * 15,
            used: false,
        }
    ];
    
    Ok(Json(ApiResponse::success(nfts)))
}