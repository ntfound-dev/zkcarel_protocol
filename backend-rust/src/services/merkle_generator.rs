use crate::tokenomics::rewards_distribution_pool_for_environment;
use crate::{config::Config, db::Database, error::Result};
use rust_decimal::prelude::{FromPrimitive, ToPrimitive};
use rust_decimal::Decimal;
use sqlx::Row;
use starknet_crypto::{poseidon_hash_many, Felt};

const ONE_CAREL_WEI: i128 = 1_000_000_000_000_000_000;

// Internal helper that supports `carel_to_wei` operations.
fn carel_to_wei(carel_amount: Decimal) -> u128 {
    let wei = carel_amount * Decimal::from_i128(ONE_CAREL_WEI).unwrap();
    wei.trunc().to_u128().unwrap_or(0)
}

// Internal helper that supports `felt_from_address` operations.
fn felt_from_address(address: &str) -> Result<Felt> {
    let addr = address.trim();
    let normalized = if addr.starts_with("0x") {
        addr.to_string()
    } else {
        format!("0x{addr}")
    };
    Felt::from_hex(&normalized)
        .map_err(|e| crate::error::AppError::Internal(format!("Invalid address: {}", e)))
}

// Internal helper that builds inputs for `create_leaf_hash`.
fn create_leaf_hash(address: &str, amount_wei: u128, epoch: i64) -> Result<Felt> {
    let user = felt_from_address(address)?;
    let amount_low = Felt::from(amount_wei);
    let amount_high = Felt::from(0_u128);
    let epoch_felt = Felt::from(epoch as u128);
    Ok(poseidon_hash_many(&[
        user,
        amount_low,
        amount_high,
        epoch_felt,
    ]))
}

// Internal helper that supports `hash_pair_sorted` operations.
fn hash_pair_sorted(left: Felt, right: Felt) -> Felt {
    if left <= right {
        poseidon_hash_many(&[left, right])
    } else {
        poseidon_hash_many(&[right, left])
    }
}

// Internal helper that builds inputs for `build_merkle_tree_from_leaves`.
fn build_merkle_tree_from_leaves(mut leaves: Vec<Felt>) -> Result<MerkleTree> {
    if leaves.is_empty() {
        return Err(crate::error::AppError::BadRequest(
            "Cannot build tree with no leaves".to_string(),
        ));
    }

    leaves.sort();

    let mut current_level = leaves.clone();
    let mut all_levels: Vec<Vec<Felt>> = vec![current_level.clone()];

    while current_level.len() > 1 {
        let mut next_level = Vec::new();

        for i in (0..current_level.len()).step_by(2) {
            let left = current_level[i];
            let right = if i + 1 < current_level.len() {
                current_level[i + 1]
            } else {
                left
            };

            let parent = hash_pair_sorted(left, right);
            next_level.push(parent);
        }

        all_levels.push(next_level.clone());
        current_level = next_level;
    }

    let root = current_level[0];

    Ok(MerkleTree {
        root,
        leaves,
        levels: all_levels,
    })
}

// Internal helper that supports `verify_merkle_proof` operations.
fn verify_merkle_proof(root: Felt, leaf: Felt, proof: &[Felt]) -> bool {
    let mut current_hash = leaf;

    for sibling in proof {
        current_hash = hash_pair_sorted(current_hash, *sibling);
    }

    current_hash == root
}

/// Merkle Generator - Generates merkle trees for reward distributions
pub struct MerkleGenerator {
    db: Database,
    config: Config,
}

impl MerkleGenerator {
    /// Constructs a new instance via `new`.
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
    pub fn new(db: Database, config: Config) -> Self {
        Self { db, config }
    }

    /// Generate merkle tree for epoch rewards
    pub async fn generate_for_epoch(&self, epoch: i64) -> Result<MerkleTree> {
        self.generate_for_epoch_with_distribution(epoch, self.default_distribution_pool())
            .await
    }

    /// Builds inputs required by `generate_for_epoch_with_distribution`.
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
    pub async fn generate_for_epoch_with_distribution(
        &self,
        epoch: i64,
        total_distribution: Decimal,
    ) -> Result<MerkleTree> {
        if self.config.is_testnet() {
            tracing::debug!("Generating merkle tree in testnet mode");
        }
        // Menggunakan runtime query untuk menghindari error DATABASE_URL
        let rows = sqlx::query(
            "SELECT user_address, total_points FROM points
             WHERE epoch = $1 AND finalized = true AND total_points > 0
             ORDER BY user_address ASC",
        )
        .bind(epoch)
        .fetch_all(self.db.pool())
        .await?;

        if rows.is_empty() {
            return Err(crate::error::AppError::NotFound(
                "No users with points for this epoch".to_string(),
            ));
        }

        // Calculate total points for proportional distribution
        let mut total_points_dec = rust_decimal::Decimal::ZERO;
        for row in &rows {
            let points: rust_decimal::Decimal = row.get("total_points");
            total_points_dec += points;
        }
        if total_points_dec == Decimal::ZERO {
            return Err(crate::error::AppError::NotFound(
                "Total points is zero".to_string(),
            ));
        }

        // Create leaves: poseidon(user, amount_wei, epoch)
        let mut leaves: Vec<Felt> = Vec::new();
        for row in &rows {
            let address: String = row.get("user_address");
            let points: rust_decimal::Decimal = row.get("total_points");

            let amount_wei = self.calculate_reward_amount_wei_with_distribution(
                points,
                total_points_dec,
                total_distribution,
            );

            let leaf = self.create_leaf(&address, amount_wei, epoch)?;
            leaves.push(leaf);
        }

        // Build merkle tree
        let tree = self.build_merkle_tree(leaves)?;

        tracing::info!(
            "Merkle tree generated for epoch {}: {} users, root: {}",
            epoch,
            rows.len(),
            tree.root.to_fixed_hex_string()
        );

        Ok(tree)
    }

    /// Handles `calculate_reward_amount_wei` logic.
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
    pub fn calculate_reward_amount_wei(&self, user_points: Decimal, total_points: Decimal) -> u128 {
        self.calculate_reward_amount_wei_with_distribution(
            user_points,
            total_points,
            self.default_distribution_pool(),
        )
    }

    /// Handles `calculate_reward_amount_wei_with_distribution` logic.
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
    pub fn calculate_reward_amount_wei_with_distribution(
        &self,
        user_points: Decimal,
        total_points: Decimal,
        total_distribution: Decimal,
    ) -> u128 {
        if total_points == Decimal::ZERO {
            return 0;
        }
        let share = user_points / total_points;
        let amount_carel = share * total_distribution;
        carel_to_wei(amount_carel)
    }

    /// Create a leaf node: poseidon(user, amount_wei, epoch)
    fn create_leaf(&self, address: &str, amount_wei: u128, epoch: i64) -> Result<Felt> {
        create_leaf_hash(address, amount_wei, epoch)
    }

    /// Build merkle tree from leaves
    fn build_merkle_tree(&self, leaves: Vec<Felt>) -> Result<MerkleTree> {
        build_merkle_tree_from_leaves(leaves)
    }

    /// Builds inputs required by `generate_proof`.
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
    pub async fn generate_proof(
        &self,
        tree: &MerkleTree,
        user_address: &str,
        amount_wei: u128,
        epoch: i64,
    ) -> Result<Vec<Felt>> {
        let leaf = self.create_leaf(user_address, amount_wei, epoch)?;

        let leaf_index = tree.leaves.iter().position(|l| l == &leaf).ok_or_else(|| {
            crate::error::AppError::NotFound("User not found in tree".to_string())
        })?;

        let mut proof: Vec<Felt> = Vec::new();
        let mut index = leaf_index;

        for level in &tree.levels[..tree.levels.len() - 1] {
            let sibling_index = if index % 2 == 0 { index + 1 } else { index - 1 };

            if sibling_index < level.len() {
                proof.push(level[sibling_index]);
            }

            index /= 2;
        }

        let _ = self.verify_proof(tree.root, leaf, &proof);
        Ok(proof)
    }

    /// Handles `verify_proof` logic.
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
    pub fn verify_proof(&self, root: Felt, leaf: Felt, proof: &[Felt]) -> bool {
        verify_merkle_proof(root, leaf, proof)
    }

    // Internal helper that supports `default_distribution_pool` operations.
    fn default_distribution_pool(&self) -> Decimal {
        rewards_distribution_pool_for_environment(&self.config.environment)
    }

    /// Updates state for `save_merkle_root`.
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
    pub async fn save_merkle_root(&self, epoch: i64, root: Felt) -> Result<()> {
        let root_hex = root.to_fixed_hex_string();

        sqlx::query(
            "INSERT INTO merkle_roots (epoch, root, created_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (epoch) DO UPDATE SET root = $2",
        )
        .bind(epoch)
        .bind(&root_hex)
        .execute(self.db.pool())
        .await?;

        tracing::info!("Merkle root saved for epoch {}: {}", epoch, root_hex);
        Ok(())
    }

    /// Fetches data for `get_merkle_root`.
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
    pub async fn get_merkle_root(&self, epoch: i64) -> Result<Felt> {
        let row = sqlx::query("SELECT root FROM merkle_roots WHERE epoch = $1")
            .bind(epoch)
            .fetch_one(self.db.pool())
            .await?;

        let root_str: String = row.get("root");
        let root = Felt::from_hex(&root_str)
            .map_err(|e| crate::error::AppError::Internal(format!("Invalid hex: {}", e)))?;

        Ok(root)
    }
}

#[derive(Debug, Clone)]
pub struct MerkleTree {
    pub root: Felt,
    pub leaves: Vec<Felt>,
    pub levels: Vec<Vec<Felt>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    // Internal helper that builds inputs for `create_leaf_hash_is_deterministic`.
    fn create_leaf_hash_is_deterministic() {
        // Memastikan hash leaf sama untuk input yang sama
        let a = create_leaf_hash("0xabc", 150_u128, 1).unwrap();
        let b = create_leaf_hash("0xabc", 150_u128, 1).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    // Internal helper that builds inputs for `build_merkle_tree_from_leaves_rejects_empty`.
    fn build_merkle_tree_from_leaves_rejects_empty() {
        // Memastikan tree tidak dibuat jika leaf kosong
        let result = build_merkle_tree_from_leaves(vec![]);
        assert!(result.is_err());
    }

    #[test]
    // Internal helper that supports `verify_merkle_proof_valid_for_two_leaves` operations.
    fn verify_merkle_proof_valid_for_two_leaves() {
        // Memastikan proof valid untuk tree sederhana
        let leaf_a = create_leaf_hash("0x1", 100_u128, 1).unwrap();
        let leaf_b = create_leaf_hash("0x2", 200_u128, 1).unwrap();
        let tree = build_merkle_tree_from_leaves(vec![leaf_a.clone(), leaf_b.clone()])
            .expect("tree harus dibuat");
        let proof = vec![leaf_b.clone()];
        assert!(verify_merkle_proof(tree.root, leaf_a, &proof));
    }
}
