use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use crate::{
    constants::{
        EPOCH_DURATION_SECONDS,
        NFT_TIER_1_DISCOUNT,
        NFT_TIER_2_DISCOUNT,
        NFT_TIER_3_DISCOUNT,
        NFT_TIER_4_DISCOUNT,
        NFT_TIER_5_DISCOUNT,
        NFT_TIER_6_DISCOUNT,
    },
    error::Result,
    models::ApiResponse,
};
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

fn discount_for_tier(tier: i32) -> f64 {
    match tier {
        1 => NFT_TIER_1_DISCOUNT,
        2 => NFT_TIER_2_DISCOUNT,
        3 => NFT_TIER_3_DISCOUNT,
        4 => NFT_TIER_4_DISCOUNT,
        5 => NFT_TIER_5_DISCOUNT,
        6 => NFT_TIER_6_DISCOUNT,
        _ => NFT_TIER_1_DISCOUNT,
    }
}

/// POST /api/v1/nft/mint
pub async fn mint_nft(
    State(_state): State<AppState>,
    Json(req): Json<MintRequest>,
) -> Result<Json<ApiResponse<NFT>>> {
    let token_id = format!("NFT_{}", hex::encode(&rand::random::<[u8; 16]>()));
    let discount = discount_for_tier(req.tier);
    
    let nft = NFT {
        token_id,
        tier: req.tier,
        discount,
        expiry: chrono::Utc::now().timestamp() + EPOCH_DURATION_SECONDS,
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
            expiry: chrono::Utc::now().timestamp() + (EPOCH_DURATION_SECONDS / 2),
            used: false,
        }
    ];
    
    Ok(Json(ApiResponse::success(nfts)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discount_for_tier_defaults_to_tier1() {
        // Memastikan tier di luar range memakai diskon tier 1
        assert_eq!(discount_for_tier(99), NFT_TIER_1_DISCOUNT);
    }

    #[test]
    fn discount_for_tier_returns_exact_value() {
        // Memastikan tier 3 memakai konstanta yang benar
        assert_eq!(discount_for_tier(3), NFT_TIER_3_DISCOUNT);
    }
}
