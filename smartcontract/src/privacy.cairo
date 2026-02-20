// ZK/privacy routing integration points for CAREL protocol.
// Keeps privacy adapters isolated from core protocol logic.
pub mod zk_privacy_router;
pub mod action_types;
pub mod shielded_vault;
pub mod verifier_registry;
pub mod privacy_router;
pub mod privacy_adapter;
pub mod garaga_verifier_adapter;
pub mod tongo_verifier_adapter;
pub mod semaphore_verifier_adapter;
pub mod mock_verifiers;
pub mod sigma_verifier;
pub mod anonymous_credentials;
pub mod private_payments;
