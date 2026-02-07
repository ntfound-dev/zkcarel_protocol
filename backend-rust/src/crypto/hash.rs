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
