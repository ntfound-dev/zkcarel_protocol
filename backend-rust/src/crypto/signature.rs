use crate::error::{AppError, Result};
use ethers::types::{Address, Signature};
use ethers::utils::hash_message;
use std::str::FromStr;

/// Struct untuk menangani verifikasi tanda tangan digital (ECDSA)
pub struct SignatureVerifier;

impl SignatureVerifier {
    /// Memverifikasi tanda tangan Ethereum (EIP-191)
    /// address: Alamat wallet publik (0x...)
    /// message: Pesan asli yang ditandatangani
    /// signature: Hasil tanda tangan dalam format hex
    pub fn verify_signature(address: &str, message: &str, signature: &str) -> Result<bool> {
        // Validasi input dasar
        if address.is_empty() || signature.is_empty() {
            return Err(AppError::BadRequest(
                "Address or signature cannot be empty".into(),
            ));
        }

        let normalized_address = if address.starts_with("0x") {
            address.to_string()
        } else {
            format!("0x{address}")
        };

        let expected_address =
            Address::from_str(&normalized_address).map_err(|_| AppError::InvalidSignature)?;
        let parsed_signature =
            Signature::from_str(signature).map_err(|_| AppError::InvalidSignature)?;
        let message_hash = hash_message(message);

        tracing::info!("Verifying signature for address: {}", normalized_address);

        let recovered = parsed_signature
            .recover(message_hash)
            .map_err(|_| AppError::InvalidSignature)?;

        Ok(recovered == expected_address)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ethers::signers::{LocalWallet, Signer};

    #[test]
    // Internal helper that supports `empty_inputs_return_bad_request` operations.
    fn empty_inputs_return_bad_request() {
        let result = SignatureVerifier::verify_signature("", "hello", "0x00");
        match result {
            Err(AppError::BadRequest(msg)) => {
                assert!(msg.contains("Address or signature cannot be empty"));
            }
            other => panic!("expected BadRequest, got {other:?}"),
        }

        let result = SignatureVerifier::verify_signature("0xabc", "hello", "");
        match result {
            Err(AppError::BadRequest(msg)) => {
                assert!(msg.contains("Address or signature cannot be empty"));
            }
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[test]
    // Internal helper that supports `invalid_signature_format_returns_error` operations.
    fn invalid_signature_format_returns_error() {
        let result = SignatureVerifier::verify_signature("0xabc", "hello", "deadbeef");
        match result {
            Err(AppError::InvalidSignature) => {}
            other => panic!("expected InvalidSignature, got {other:?}"),
        }
    }

    #[tokio::test]
    // Internal helper that supports `valid_signature_returns_true` operations.
    async fn valid_signature_returns_true() {
        let wallet: LocalWallet =
            "0x59c6995e998f97a5a0044976f28d13b0b695c87c1c17cfdc8c8b7f8a6e7f2f2d"
                .parse()
                .expect("valid private key");
        let message = "hello";
        let signature = wallet.sign_message(message).await.expect("sign message");
        let mut signature_hex = signature.to_string();
        if !signature_hex.starts_with("0x") {
            signature_hex = format!("0x{signature_hex}");
        }

        let address = format!("{:#x}", wallet.address());
        let result = SignatureVerifier::verify_signature(&address, message, &signature_hex);
        assert!(matches!(result, Ok(true)));
    }
}
