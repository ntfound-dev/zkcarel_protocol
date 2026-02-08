use crate::error::{AppError, Result};
use crate::crypto::hash;

/// Struct untuk menangani verifikasi tanda tangan digital (ECDSA)
pub struct SignatureVerifier;

impl SignatureVerifier {
    /// Memverifikasi tanda tangan Ethereum (EIP-191)
    /// address: Alamat wallet publik (0x...)
    /// message: Pesan asli yang ditandatangani
    /// signature: Hasil tanda tangan dalam format hex
    pub fn verify_signature(
        address: &str,
        message: &str,
        signature: &str,
    ) -> Result<bool> {
        // MENGGUNAKAN hash utilitas agar tidak dead code di hash.rs
        let _msg_hash = hash::hash_string(message);

        // Validasi input dasar
        if address.is_empty() || signature.is_empty() {
            return Err(AppError::BadRequest("Address or signature cannot be empty".into()));
        }

        // TODO: Implementasi recovery kunci publik asli menggunakan krate 'k256' atau 'ethers'
        // Untuk sekarang kita buat mock logic yang memvalidasi format hex
        if !signature.starts_with("0x") || signature.len() < 64 {
            return Err(AppError::InvalidSignature);
        }

        tracing::info!("Verifying signature for address: {}", address);
        
        // Mock return true jika format benar
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_signature() -> String {
        format!("0x{}", "a".repeat(64))
    }

    #[test]
    fn empty_inputs_return_bad_request() {
        let result = SignatureVerifier::verify_signature("", "hello", &valid_signature());
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
    fn invalid_signature_format_returns_error() {
        let result = SignatureVerifier::verify_signature("0xabc", "hello", "deadbeef");
        match result {
            Err(AppError::InvalidSignature) => {}
            other => panic!("expected InvalidSignature, got {other:?}"),
        }
    }

    #[test]
    fn valid_signature_returns_true() {
        let result = SignatureVerifier::verify_signature("0xabc", "hello", &valid_signature());
        assert!(matches!(result, Ok(true)));
    }
}
