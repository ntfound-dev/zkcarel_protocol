use axum::{extract::State, Json};
use base64::engine::general_purpose;
use base64::Engine;
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use serde_json::json;
use starknet_core::types::typed_data::TypedData;
use starknet_core::types::{Felt as CoreFelt, FunctionCall};
use starknet_core::utils::get_selector_from_name;

use crate::{
    // Import SignatureVerifier agar kode di signature.rs tidak dead code
    crypto::signature::SignatureVerifier,
    error::{AppError, Result},
    models::ApiResponse,
    services::onchain::{parse_felt, OnchainReader},
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

const REFRESH_GRACE_MULTIPLIER: u64 = 7;
const MIN_REFRESH_GRACE_HOURS: u64 = 24;
const LOGIN_MESSAGE_MAX_AGE_SECS: i64 = 300;

// ==================== HANDLERS ====================

/// POST /api/v1/auth/connect
pub async fn connect_wallet(
    State(state): State<AppState>,
    Json(req): Json<ConnectWalletRequest>,
) -> Result<Json<ApiResponse<ConnectWalletResponse>>> {
    let requested_address = req.address.trim().to_string();
    let detected_chain = detect_wallet_chain(req.chain_id, req.wallet_type.as_deref());
    // 1. Verify signature
    validate_login_timestamp(&req.message)?;
    verify_wallet_signature(
        &state,
        &requested_address,
        &req.message,
        &req.signature,
        req.chain_id,
        req.wallet_type.as_deref(),
    )
    .await?;
    if requested_address.is_empty() {
        return Err(AppError::BadRequest("Address is required".to_string()));
    }
    let canonical_user_address = state
        .db
        .find_user_by_wallet_address(&requested_address, detected_chain)
        .await?
        .unwrap_or_else(|| requested_address.clone());

    // 2. Create or get user
    state.db.create_user(&canonical_user_address).await?;
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

// Internal helper that supports `verify_wallet_signature` operations.
async fn verify_wallet_signature(
    state: &AppState,
    address: &str,
    message: &str,
    signature: &str,
    chain_id: u64,
    wallet_type: Option<&str>,
) -> Result<()> {
    tracing::debug!(
        "Initiating wallet signature verification for {} on chain {} ({:?})",
        address,
        chain_id,
        wallet_type
    );

    match detect_wallet_chain(chain_id, wallet_type) {
        Some("starknet") => verify_starknet_signature(state, address, message, signature).await,
        Some("bitcoin") => verify_bitcoin_signature(address, message, signature),
        _ => verify_signature(address, message, signature, chain_id),
    }
}

// Internal helper that supports `verify_starknet_signature` operations.
async fn verify_starknet_signature(
    state: &AppState,
    address: &str,
    message: &str,
    signature: &str,
) -> Result<()> {
    let account = parse_felt(address).map_err(|_| AppError::InvalidSignature)?;
    let chain_id = state.config.starknet_chain_id.trim();
    let chain_id = if chain_id.is_empty() {
        "SN_SEPOLIA"
    } else {
        chain_id
    };
    let typed_data = build_login_typed_data(chain_id, address, message);
    let data: TypedData = serde_json::from_value(typed_data).map_err(|err| {
        AppError::Internal(format!(
            "Failed to parse login typed data for signature verification: {}",
            err
        ))
    })?;
    let message_hash = data.message_hash(account).map_err(|err| {
        AppError::Internal(format!(
            "Failed to compute login typed-data message hash: {}",
            err
        ))
    })?;

    let signature_felts = parse_starknet_signature(signature)?;
    let selector = get_selector_from_name("is_valid_signature")
        .map_err(|e| AppError::Internal(format!("Selector error: {}", e)))?;
    let mut calldata = Vec::with_capacity(2 + signature_felts.len());
    calldata.push(message_hash);
    calldata.push(CoreFelt::from(signature_felts.len() as u64));
    calldata.extend(signature_felts);

    let call = FunctionCall {
        contract_address: account,
        entry_point_selector: selector,
        calldata,
    };
    let reader = OnchainReader::from_config_for_wallet(&state.config)?;
    let response = reader.call(call).await?;
    let is_valid = response
        .first()
        .map(|felt| *felt != CoreFelt::from(0u8))
        .unwrap_or(false);
    if !is_valid {
        return Err(AppError::InvalidSignature);
    }
    Ok(())
}

// Internal helper that supports `verify_bitcoin_signature` operations.
fn verify_bitcoin_signature(address: &str, message: &str, signature: &str) -> Result<()> {
    if message.trim().is_empty() || signature.trim().is_empty() {
        return Err(AppError::InvalidSignature);
    }

    let trimmed = signature.trim();
    let normalized = if looks_like_hex_signature(trimmed) {
        let hex_body = trimmed.strip_prefix("0x").unwrap_or(trimmed);
        let bytes = hex::decode(hex_body).map_err(|_| AppError::InvalidSignature)?;
        general_purpose::STANDARD.encode(bytes)
    } else {
        trimmed.to_string()
    };

    bip322::verify_simple_encoded(address, message, &normalized)
        .map_err(|_| AppError::InvalidSignature)?;
    Ok(())
}

// Internal helper that supports `looks_like_hex_signature` operations.
fn looks_like_hex_signature(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return false;
    }
    let body = trimmed.strip_prefix("0x").unwrap_or(trimmed);
    if body.len() < 64 || body.len() % 2 != 0 {
        return false;
    }
    body.chars().all(|c| c.is_ascii_hexdigit())
}

// Internal helper that supports `parse_starknet_signature` operations.
fn parse_starknet_signature(signature: &str) -> Result<Vec<CoreFelt>> {
    let trimmed = signature.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidSignature);
    }
    let hex = trimmed.strip_prefix("0x").unwrap_or(trimmed);
    if hex.len() % 64 != 0 {
        return Err(AppError::InvalidSignature);
    }
    let mut felts = Vec::new();
    for chunk in hex.as_bytes().chunks(64) {
        let part = std::str::from_utf8(chunk).map_err(|_| AppError::InvalidSignature)?;
        let felt = parse_felt(&format!("0x{part}")).map_err(|_| AppError::InvalidSignature)?;
        felts.push(felt);
    }
    if felts.is_empty() {
        return Err(AppError::InvalidSignature);
    }
    Ok(felts)
}

// Internal helper that supports `build_login_typed_data` operations.
fn build_login_typed_data(chain_id: &str, address: &str, message: &str) -> serde_json::Value {
    let short_message = to_short_string(message);
    json!({
        "domain": {
            "name": "Carel Protocol",
            "version": "1",
            "chainId": chain_id
        },
        "types": {
            "StarkNetDomain": [
                { "name": "name", "type": "felt" },
                { "name": "version", "type": "felt" },
                { "name": "chainId", "type": "felt" }
            ],
            "Message": [
                { "name": "address", "type": "felt" },
                { "name": "contents", "type": "felt" }
            ]
        },
        "primaryType": "Message",
        "message": {
            "address": address,
            "contents": short_message
        }
    })
}

// Internal helper that supports `to_short_string` operations.
fn to_short_string(value: &str) -> String {
    if value.chars().count() <= 31 {
        return value.to_string();
    }
    value.chars().take(31).collect()
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

// Internal helper that supports `validate_login_timestamp` operations.
fn validate_login_timestamp(message: &str) -> Result<()> {
    let ts = extract_login_timestamp(message)?;
    let now = Utc::now().timestamp();
    if ts <= 0 {
        return Err(AppError::AuthError(
            "Invalid login message timestamp".to_string(),
        ));
    }
    if ts > now + LOGIN_MESSAGE_MAX_AGE_SECS {
        return Err(AppError::AuthError(
            "Login message timestamp is in the future".to_string(),
        ));
    }
    let age = now.saturating_sub(ts);
    if age > LOGIN_MESSAGE_MAX_AGE_SECS {
        return Err(AppError::AuthError("Login message expired".to_string()));
    }
    Ok(())
}

// Internal helper that fetches data for `extract_login_timestamp`.
const LOGIN_MSG_PREFIX: &str = "Carel Protocol login at ";
const LOGIN_MSG_PREFIX_BTC: &str = "Carel Protocol BTC login ";

fn extract_login_timestamp(message: &str) -> Result<i64> {
    let trimmed = message.trim();
    let ts_str = trimmed
        .strip_prefix(LOGIN_MSG_PREFIX)
        .or_else(|| trimmed.strip_prefix(LOGIN_MSG_PREFIX_BTC))
        .ok_or_else(|| AppError::AuthError("Invalid login message format".to_string()))?
        .trim();
    if ts_str.is_empty() {
        return Err(AppError::AuthError(
            "Invalid login message timestamp".to_string(),
        ));
    }
    ts_str
        .parse::<i64>()
        .map_err(|_| AppError::AuthError("Invalid login message timestamp".to_string()))
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
    // Internal helper that supports `extract_login_timestamp_parses_last_token`.
    fn extract_login_timestamp_parses_last_token() {
        let message = "Carel Protocol login at 1700000000";
        let ts = extract_login_timestamp(message).expect("valid timestamp");
        assert_eq!(ts, 1_700_000_000);
    }
}
