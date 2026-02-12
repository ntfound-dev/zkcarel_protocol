use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use jsonwebtoken::{encode, decode, Header, Validation, EncodingKey, DecodingKey};
use chrono::{Utc, Duration};

use crate::{
    error::{AppError, Result},
    models::ApiResponse,
    // Import SignatureVerifier agar kode di signature.rs tidak dead code
    crypto::signature::SignatureVerifier,
};

use super::AppState;

// ==================== REQUEST/RESPONSE TYPES ====================

#[derive(Debug, Deserialize)]
pub struct ConnectWalletRequest {
    pub address: String,
    pub signature: String,
    pub message: String,
    pub chain_id: u64,
    pub wallet_type: Option<String>, // starknet/evm/bitcoin
    pub sumo_login_token: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ConnectWalletResponse {
    pub token: String,
    pub expires_in: i64,
    pub user: UserInfo,
}

#[derive(Debug, Serialize)]
pub struct UserInfo {
    pub address: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct RefreshTokenRequest {
    pub refresh_token: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String, // user address
    pub exp: usize,  // expiry
    pub iat: usize,  // issued at
}

// ==================== HANDLERS ====================

/// POST /api/v1/auth/connect
pub async fn connect_wallet(
    State(state): State<AppState>,
    Json(req): Json<ConnectWalletRequest>,
) -> Result<Json<ApiResponse<ConnectWalletResponse>>> {
    // 1. Verify signature OR Sumo Login token
    if let Some(token) = req.sumo_login_token.as_ref() {
        let client = crate::integrations::sumo_login::SumoLoginClient::new(
            state.config.sumo_login_api_url.clone(),
            state.config.sumo_login_api_key.clone(),
        );
        let ok = client
            .verify_login(token)
            .await
            .map_err(|e| AppError::AuthError(format!("Sumo login failed: {}", e)))?;
        if !ok {
            return Err(AppError::AuthError("Invalid Sumo login token".to_string()));
        }
    } else {
        verify_signature(&req.address, &req.message, &req.signature, req.chain_id)?;
    }

    let canonical_user_address = req.address.clone();

    // 2. Create or get user
    state.db.create_user(&canonical_user_address).await?;
    let user = state.db.get_user(&canonical_user_address).await?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    // Link wallet address to canonical user for multi-address account.
    if let Some(chain) = detect_wallet_chain(req.chain_id, req.wallet_type.as_deref()) {
        let address = req.address.trim();
        if !address.is_empty() && !is_zero_placeholder_address(address) {
            state
                .db
                .upsert_wallet_address(&canonical_user_address, chain, address, None)
                .await?;
        }
    }

    // 3. Update last active
    state.db.update_last_active(&canonical_user_address).await?;

    // 4. Generate JWT token
    let token = generate_jwt_token(
        &canonical_user_address,
        &state.config.jwt_secret,
        state.config.jwt_expiry_hours,
    )?;

    // 5. Calculate expiry
    let expires_in = state.config.jwt_expiry_hours * 3600;

    Ok(Json(ApiResponse::success(ConnectWalletResponse {
        token,
        expires_in: expires_in as i64,
        user: UserInfo {
            address: user.address,
            created_at: user.created_at,
        },
    })))
}

/// POST /api/v1/auth/refresh
pub async fn refresh_token(
    State(state): State<AppState>,
    Json(req): Json<RefreshTokenRequest>,
) -> Result<Json<ApiResponse<ConnectWalletResponse>>> {
    // 1. Decode token menggunakan helper
    let user_address = extract_user_from_token(&req.refresh_token, &state.config.jwt_secret).await?;

    // 2. Get user
    let user = state.db.get_user(&user_address).await?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    // 3. Generate new token
    let new_token = generate_jwt_token(&user_address, &state.config.jwt_secret, state.config.jwt_expiry_hours)?;

    // 4. Calculate expiry
    let expires_in = state.config.jwt_expiry_hours * 3600;

    Ok(Json(ApiResponse::success(ConnectWalletResponse {
        token: new_token,
        expires_in: expires_in as i64,
        user: UserInfo {
            address: user.address,
            created_at: user.created_at,
        },
    })))
}

// ==================== HELPER FUNCTIONS ====================

fn verify_signature(address: &str, message: &str, signature: &str, chain_id: u64) -> Result<()> {
    tracing::debug!(
        "Initiating signature verification for {} on chain {}", 
        address, 
        chain_id
    );

    // MENGHUBUNGKAN KE crypto/signature.rs
    // Sekarang SignatureVerifier resmi "Used"
    let is_valid = SignatureVerifier::verify_signature(address, message, signature)?;
    
    if !is_valid {
        return Err(AppError::InvalidSignature);
    }

    Ok(())
}

fn generate_jwt_token(address: &str, secret: &str, expiry_hours: u64) -> Result<String> {
    let expiration = Utc::now()
        .checked_add_signed(Duration::hours(expiry_hours as i64))
        .expect("valid timestamp")
        .timestamp();

    let claims = Claims {
        sub: address.to_string(),
        exp: expiration as usize,
        iat: Utc::now().timestamp() as usize,
    };

    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    ).map_err(|e| AppError::Internal(format!("Failed to generate token: {}", e)))?;

    Ok(token)
}

pub async fn extract_user_from_token(token: &str, secret: &str) -> Result<String> {
    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    ).map_err(|_| AppError::AuthError("Invalid or expired token".to_string()))?;

    Ok(token_data.claims.sub)
}

fn detect_wallet_chain(chain_id: u64, wallet_type: Option<&str>) -> Option<&'static str> {
    if let Some(kind) = wallet_type.map(|v| v.trim().to_ascii_lowercase()) {
        match kind.as_str() {
            "starknet" | "strk" => return Some("starknet"),
            "evm" | "ethereum" | "eth" => return Some("evm"),
            "bitcoin" | "btc" => return Some("bitcoin"),
            _ => {}
        }
    }

    match chain_id {
        2 => Some("starknet"),
        1 => Some("evm"),
        _ => None,
    }
}

fn is_zero_placeholder_address(address: &str) -> bool {
    let normalized = address.trim().to_ascii_lowercase();
    normalized == "0x0"
        || normalized == "0x0000000000000000000000000000000000000000"
        || normalized == "0x0000000000000000000000000000000000000000000000000000000000000000"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verify_signature_rejects_invalid_format() {
        // Memastikan format signature yang salah ditolak
        let result = verify_signature("0xabc", "hello", "deadbeef", 1);
        assert!(matches!(result, Err(AppError::InvalidSignature)));
    }

    #[tokio::test]
    async fn extract_user_from_token_rejects_invalid() {
        // Memastikan token invalid mengembalikan error autentikasi
        let result = extract_user_from_token("invalid.token", "secret").await;
        assert!(matches!(result, Err(AppError::AuthError(_))));
    }
}
