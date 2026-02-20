use axum::{extract::State, Json};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

use crate::{
    // Import SignatureVerifier agar kode di signature.rs tidak dead code
    crypto::{hash, signature::SignatureVerifier},
    error::{AppError, Result},
    models::ApiResponse,
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
    pub referral_code: Option<String>,
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

#[derive(Debug, Deserialize)]
struct SumoTokenClaims {
    sub: Option<String>,
    iss: Option<String>,
}

const REFRESH_GRACE_MULTIPLIER: u64 = 7;
const MIN_REFRESH_GRACE_HOURS: u64 = 24;

// ==================== HANDLERS ====================

/// POST /api/v1/auth/connect
pub async fn connect_wallet(
    State(state): State<AppState>,
    Json(req): Json<ConnectWalletRequest>,
) -> Result<Json<ApiResponse<ConnectWalletResponse>>> {
    let requested_address = req.address.trim().to_string();
    let detected_chain = detect_wallet_chain(req.chain_id, req.wallet_type.as_deref());
    let mut sumo_subject: Option<String> = None;

    // 1. Verify signature OR Sumo Login token
    let canonical_user_address = if let Some(token) = req.sumo_login_token.as_ref() {
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
        let subject = derive_sumo_subject_key(token)?;
        let canonical = if let Some(address) = state.db.find_user_by_sumo_subject(&subject).await? {
            address
        } else if !requested_address.is_empty() && !is_zero_placeholder_address(&requested_address)
        {
            state
                .db
                .find_user_by_wallet_address(&requested_address, detected_chain)
                .await?
                .unwrap_or_else(|| requested_address.clone())
        } else {
            canonical_address_for_sumo_subject(&subject)
        };
        sumo_subject = Some(subject);
        canonical
    } else {
        verify_signature(
            &requested_address,
            &req.message,
            &req.signature,
            req.chain_id,
        )?;
        if requested_address.is_empty() {
            return Err(AppError::BadRequest("Address is required".to_string()));
        }
        state
            .db
            .find_user_by_wallet_address(&requested_address, detected_chain)
            .await?
            .unwrap_or_else(|| requested_address.clone())
    };

    // 2. Create or get user
    state.db.create_user(&canonical_user_address).await?;
    if let Some(subject) = sumo_subject.as_deref() {
        state
            .db
            .bind_sumo_subject_once(&canonical_user_address, subject)
            .await?;
    }
    let mut user = state
        .db
        .get_user(&canonical_user_address)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    // Immutable referral bind: only on first bind (when referrer still NULL).
    if user.referrer.is_none() {
        if let Some(referral_suffix) = parse_referral_code(req.referral_code.as_deref())? {
            let referrer_address = state
                .db
                .find_user_by_referral_code(&referral_suffix)
                .await?
                .ok_or_else(|| AppError::BadRequest("Invalid referral code".to_string()))?;
            if referrer_address.eq_ignore_ascii_case(&canonical_user_address) {
                return Err(AppError::BadRequest(
                    "Cannot use own referral code".to_string(),
                ));
            }

            let bound = state
                .db
                .bind_referrer_once(&canonical_user_address, &referrer_address)
                .await?;
            if bound {
                user = state
                    .db
                    .get_user(&canonical_user_address)
                    .await?
                    .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;
            }
        }
    }

    // Link wallet address to canonical user for multi-address account.
    if let Some(chain) = detected_chain {
        let address = requested_address.as_str();
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
    // 1. Decode refresh token (allow expired access token within bounded grace window)
    let refresh_max_age_hours = state
        .config
        .jwt_expiry_hours
        .saturating_mul(REFRESH_GRACE_MULTIPLIER)
        .max(MIN_REFRESH_GRACE_HOURS);
    let user_address = extract_user_from_refresh_token(
        &req.refresh_token,
        &state.config.jwt_secret,
        refresh_max_age_hours,
    )?;

    // 2. Get user
    let user = state
        .db
        .get_user(&user_address)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    // 3. Generate new token
    let new_token = generate_jwt_token(
        &user_address,
        &state.config.jwt_secret,
        state.config.jwt_expiry_hours,
    )?;

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

// Internal helper that builds inputs for `generate_jwt_token`.
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
    )
    .map_err(|e| AppError::Internal(format!("Failed to generate token: {}", e)))?;

    Ok(token)
}

// Internal helper that parses or transforms values for `decode_claims`.
fn decode_claims(token: &str, secret: &str, validate_exp: bool) -> Result<Claims> {
    let mut validation = Validation::default();
    validation.validate_exp = validate_exp;

    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .map_err(|_| AppError::AuthError("Invalid or expired token".to_string()))?;

    Ok(token_data.claims)
}

/// Handles `extract_user_from_token` logic.
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
pub async fn extract_user_from_token(token: &str, secret: &str) -> Result<String> {
    let claims = decode_claims(token, secret, true)?;

    Ok(claims.sub)
}

// Internal helper that supports `extract_user_from_refresh_token` operations.
fn extract_user_from_refresh_token(
    token: &str,
    secret: &str,
    max_age_hours: u64,
) -> Result<String> {
    let claims = decode_claims(token, secret, false)?;
    let issued_at = claims.iat as i64;
    let now = Utc::now().timestamp();
    let max_age_seconds = Duration::hours(max_age_hours as i64).num_seconds();

    // Accept small positive skew, reject stale/invalid tokens.
    if issued_at <= 0 || issued_at > now + 300 || now.saturating_sub(issued_at) > max_age_seconds {
        return Err(AppError::AuthError("Invalid or expired token".to_string()));
    }

    Ok(claims.sub)
}

// Internal helper that supports `detect_wallet_chain` operations.
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

// Internal helper that checks conditions for `is_zero_placeholder_address`.
fn is_zero_placeholder_address(address: &str) -> bool {
    let normalized = address.trim().to_ascii_lowercase();
    normalized == "0x0"
        || normalized == "0x0000000000000000000000000000000000000000"
        || normalized == "0x0000000000000000000000000000000000000000000000000000000000000000"
}

// Internal helper that supports `derive_sumo_subject_key` operations.
fn derive_sumo_subject_key(token: &str) -> Result<String> {
    let claims = token
        .split('.')
        .nth(1)
        .and_then(|payload| URL_SAFE_NO_PAD.decode(payload).ok())
        .and_then(|decoded| serde_json::from_slice::<SumoTokenClaims>(&decoded).ok())
        .ok_or_else(|| AppError::AuthError("Invalid Sumo token payload".to_string()))?;

    let issuer = claims
        .iss
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or("sumo");
    let subject = claims
        .sub
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| AppError::AuthError("Sumo token missing subject".to_string()))?;
    let key = format!("{}:{}", issuer.to_ascii_lowercase(), subject);

    if key.len() <= 255 {
        return Ok(key);
    }
    Ok(format!("sumo:{}", hash::hash_string(&key)))
}

// Internal helper that supports `canonical_address_for_sumo_subject` operations.
fn canonical_address_for_sumo_subject(subject: &str) -> String {
    let digest = hash::hash_string(subject);
    let hex = digest.strip_prefix("0x").unwrap_or(digest.as_str());
    let cut = hex.get(..40).unwrap_or(hex);
    format!("0x{}", cut)
}

// Internal helper that parses or transforms values for `parse_referral_code`.
fn parse_referral_code(raw: Option<&str>) -> Result<Option<String>> {
    let Some(input) = raw.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(None);
    };

    let upper = input.to_ascii_uppercase();
    let suffix = upper
        .strip_prefix("CAREL_")
        .unwrap_or(upper.as_str())
        .trim();

    if suffix.len() != 8 || !suffix.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::BadRequest(
            "Invalid referral code format".to_string(),
        ));
    }

    Ok(Some(suffix.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    // Internal helper that supports `verify_signature_rejects_invalid_format` operations.
    fn verify_signature_rejects_invalid_format() {
        // Memastikan format signature yang salah ditolak
        let result = verify_signature("0xabc", "hello", "deadbeef", 1);
        assert!(matches!(result, Err(AppError::InvalidSignature)));
    }

    #[tokio::test]
    // Internal helper that supports `extract_user_from_token_rejects_invalid` operations.
    async fn extract_user_from_token_rejects_invalid() {
        // Memastikan token invalid mengembalikan error autentikasi
        let result = extract_user_from_token("invalid.token", "secret").await;
        assert!(matches!(result, Err(AppError::AuthError(_))));
    }

    #[test]
    // Internal helper that parses or transforms values for `parse_referral_code_accepts_prefixed_and_plain`.
    fn parse_referral_code_accepts_prefixed_and_plain() {
        let with_prefix = parse_referral_code(Some("carel_1234abcd")).unwrap();
        let plain = parse_referral_code(Some("1234ABCD")).unwrap();
        assert_eq!(with_prefix.as_deref(), Some("1234ABCD"));
        assert_eq!(plain.as_deref(), Some("1234ABCD"));
    }

    #[test]
    // Internal helper that parses or transforms values for `parse_referral_code_rejects_invalid`.
    fn parse_referral_code_rejects_invalid() {
        let result = parse_referral_code(Some("CAREL_12ZZ"));
        assert!(matches!(result, Err(AppError::BadRequest(_))));
    }

    #[test]
    // Internal helper that supports `derive_sumo_subject_key_prefers_iss_and_sub` operations.
    fn derive_sumo_subject_key_prefers_iss_and_sub() {
        let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"none","typ":"JWT"}"#);
        let payload = URL_SAFE_NO_PAD.encode(r#"{"iss":"https://sumo","sub":"user-123"}"#);
        let token = format!("{}.{}.", header, payload);
        assert_eq!(
            derive_sumo_subject_key(&token).unwrap(),
            "https://sumo:user-123"
        );
    }

    #[test]
    // Internal helper that supports `derive_sumo_subject_key_rejects_invalid_token` operations.
    fn derive_sumo_subject_key_rejects_invalid_token() {
        let key = derive_sumo_subject_key("not-a-jwt");
        assert!(matches!(key, Err(AppError::AuthError(_))));
    }
}
