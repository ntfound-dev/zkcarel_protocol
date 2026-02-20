use sha3::{Digest, Keccak256};

/// Menghitung hash Keccak256 dari data byte
pub fn keccak256(data: &[u8]) -> Vec<u8> {
    let mut hasher = Keccak256::new();
    hasher.update(data);
    hasher.finalize().to_vec()
}

/// Menghitung hash Keccak256 dan mengembalikan string hex dengan prefix 0x
pub fn keccak256_hex(data: &[u8]) -> String {
    format!("0x{}", hex::encode(keccak256(data)))
}

/// Helper untuk menghitung hash dari string langsung
pub fn hash_string(s: &str) -> String {
    keccak256_hex(s.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    // Internal helper that supports `keccak256_hex_matches_empty_string_vector` operations.
    fn keccak256_hex_matches_empty_string_vector() {
        let digest = keccak256_hex(b"");
        assert_eq!(
            digest,
            "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
        );
        assert_eq!(digest.len(), 66);
    }

    #[test]
    // Internal helper that supports `hash_string_matches_hex_helper` operations.
    fn hash_string_matches_hex_helper() {
        let input = "zkcare";
        let digest = hash_string(input);
        assert!(digest.starts_with("0x"));
        assert_eq!(digest, keccak256_hex(input.as_bytes()));
    }
}
