use crate::{config::Config, db::Database, error::Result};
use sha3::{Digest, Keccak256};
use sqlx::Row;
use rust_decimal::prelude::ToPrimitive;

/// Merkle Generator - Generates merkle trees for reward distributions
pub struct MerkleGenerator {
    db: Database,
    config: Config,
}

impl MerkleGenerator {
    pub fn new(db: Database, config: Config) -> Self {
        Self { db, config }
    }

    /// Generate merkle tree for epoch rewards
    pub async fn generate_for_epoch(&self, epoch: i64) -> Result<MerkleTree> {
        // Menggunakan runtime query untuk menghindari error DATABASE_URL
        let rows = sqlx::query(
            "SELECT user_address, total_points FROM points
             WHERE epoch = $1 AND finalized = true AND total_points > 0
             ORDER BY user_address ASC"
        )
        .bind(epoch)
        .fetch_all(self.db.pool())
        .await?;

        if rows.is_empty() {
            return Err(crate::error::AppError::NotFound(
                "No users with points for this epoch".to_string(),
            ));
        }

        // Create leaves: hash(address, amount)
        let mut leaves = Vec::new();
        for row in &rows {
            let address: String = row.get("user_address");
            let points: rust_decimal::Decimal = row.get("total_points");
            
            // Konversi Decimal ke f64 dengan lebih aman
            let amount_carel = points.to_f64().unwrap_or(0.0) * 0.1;
            let leaf = self.create_leaf(&address, amount_carel);
            leaves.push(leaf);
        }

        // Build merkle tree
        let tree = self.build_merkle_tree(leaves)?;

        tracing::info!(
            "Merkle tree generated for epoch {}: {} users, root: {}",
            epoch,
            rows.len(),
            hex::encode(&tree.root)
        );

        Ok(tree)
    }

    /// Create a leaf node: keccak256(address + keccak256(amount))
    /// Catatan: Menggunakan string f64 bisa berisiko presisi di smart contract, 
    /// pertimbangkan menggunakan format integer/wei di masa depan.
    fn create_leaf(&self, address: &str, amount: f64) -> Vec<u8> {
        let mut hasher = Keccak256::new();
        hasher.update(address.as_bytes());
        hasher.update(amount.to_string().as_bytes());
        hasher.finalize().to_vec()
    }

    /// Build merkle tree from leaves
    fn build_merkle_tree(&self, mut leaves: Vec<Vec<u8>>) -> Result<MerkleTree> {
        if leaves.is_empty() {
            return Err(crate::error::AppError::BadRequest(
                "Cannot build tree with no leaves".to_string(),
            ));
        }

        // Sort leaves agar tree bersifat deterministik
        leaves.sort();

        let mut current_level = leaves.clone();
        let mut all_levels = vec![current_level.clone()];

        while current_level.len() > 1 {
            let mut next_level = Vec::new();

            for i in (0..current_level.len()).step_by(2) {
                let left = &current_level[i];
                let right = if i + 1 < current_level.len() {
                    &current_level[i + 1]
                } else {
                    left // Duplicate if odd number (standard Merkle behavior)
                };

                let parent = self.hash_pair(left, right);
                next_level.push(parent);
            }

            all_levels.push(next_level.clone());
            current_level = next_level;
        }

        let root = current_level[0].clone();

        Ok(MerkleTree {
            root,
            leaves,
            levels: all_levels,
        })
    }

    fn hash_pair(&self, left: &[u8], right: &[u8]) -> Vec<u8> {
        let mut hasher = Keccak256::new();
        
        if left <= right {
            hasher.update(left);
            hasher.update(right);
        } else {
            hasher.update(right);
            hasher.update(left);
        }
        
        hasher.finalize().to_vec()
    }

    pub async fn generate_proof(
        &self,
        tree: &MerkleTree,
        user_address: &str,
        amount: f64,
    ) -> Result<Vec<Vec<u8>>> {
        let leaf = self.create_leaf(user_address, amount);

        let leaf_index = tree
            .leaves
            .iter()
            .position(|l| l == &leaf)
            .ok_or_else(|| {
                crate::error::AppError::NotFound("User not found in tree".to_string())
            })?;

        let mut proof = Vec::new();
        let mut index = leaf_index;

        for level in &tree.levels[..tree.levels.len() - 1] {
            let sibling_index = if index % 2 == 0 { index + 1 } else { index - 1 };

            if sibling_index < level.len() {
                proof.push(level[sibling_index].clone());
            }

            index /= 2;
        }

        Ok(proof)
    }

    pub fn verify_proof(&self, root: &[u8], leaf: &[u8], proof: &[Vec<u8>]) -> bool {
        let mut current_hash = leaf.to_vec();

        for sibling in proof {
            current_hash = self.hash_pair(&current_hash, sibling);
        }

        current_hash == root
    }

    pub async fn save_merkle_root(&self, epoch: i64, root: &[u8]) -> Result<()> {
        let root_hex = hex::encode(root);

        sqlx::query(
            "INSERT INTO merkle_roots (epoch, root, created_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (epoch) DO UPDATE SET root = $2"
        )
        .bind(epoch)
        .bind(&root_hex)
        .execute(self.db.pool())
        .await?;

        tracing::info!("Merkle root saved for epoch {}: {}", epoch, root_hex);
        Ok(())
    }

    pub async fn get_merkle_root(&self, epoch: i64) -> Result<Vec<u8>> {
        let row = sqlx::query("SELECT root FROM merkle_roots WHERE epoch = $1")
            .bind(epoch)
            .fetch_one(self.db.pool())
            .await?;

        let root_str: String = row.get("root");
        let root = hex::decode(root_str)
            .map_err(|e| crate::error::AppError::Internal(format!("Invalid hex: {}", e)))?;

        Ok(root)
    }
}

#[derive(Debug, Clone)]
pub struct MerkleTree {
    pub root: Vec<u8>,
    pub leaves: Vec<Vec<u8>>,
    pub levels: Vec<Vec<Vec<u8>>>,
}
