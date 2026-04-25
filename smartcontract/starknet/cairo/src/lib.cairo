// Root module that exposes all CAREL protocol components.
// Keeps import wiring centralized across contracts.

pub mod core {
    // Core contracts for tokenomics, treasury, fees, and registry state.
    // Other protocol modules depend on these primitives.
    pub mod token;
    pub mod vesting_manager;
    pub mod treasury;
    pub mod fee_collector;
    pub mod registry;
    pub mod carel_protocol;
}

pub mod rewards {
    // Reward distribution, points, referrals, and Merkle verification.
    // Keeps reward-related contracts grouped for clear integration paths.
    pub mod snapshot_distributor;
    pub mod point_storage;
    pub mod point_token;
    pub mod referral_system;
    pub mod merkle_verifier;
    pub mod rewards_escrow;
}

pub mod nft {
    // Discount NFT contracts used for loyalty and fee reductions.
    // Keeps NFT logic isolated from swaps and rewards.
    pub mod discount_soulbound;
}

pub mod ai {
    // AI execution and billing entrypoints for CAREL services.
    // Encapsulates AI-related contracts to keep core protocol small.
    pub mod ai_executor;
    pub mod ai_signature_verifier;
    pub mod ai_plan_router;
    pub mod erc8004_identity_registry;
    pub mod erc8004_validation_registry;
    pub mod erc8004_reputation_registry;
    pub mod agent_registry;
}

pub mod utils {
    // Shared utilities for access control, oracles, and admin tooling.
    // Centralizes reusable helpers used across protocol contracts.
    pub mod price_oracle;
    pub mod emergency_pause;
    pub mod twap_oracle;
    pub mod multisig;
}

pub mod trading {
    // Trading layer modules for swaps, staking, limit orders, and Battleship ZK game.
    // Keeps trading-related contracts isolated from core protocol modules.
    pub mod swap;
    pub mod staking;
    pub mod dca_orders;
    pub mod battleship_garaga;
    pub mod privacy_intermediary;
}

pub mod faucet {
    // Multi-token faucet for testnet distribution.
    pub mod multi_faucet;
}

pub mod governance {
    // Governance and timelock contracts for protocol decision execution.
    // Provides delayed execution controls for sensitive changes.
    pub mod timelock;
    pub mod governance;
}

pub mod privacy_router;
pub mod privacy_router_v4;
pub mod privacy_action_types;

// Garaga-based privacy primitives and external interfaces.
pub mod shielded_pool_v4;
pub mod shadow_bridge_receiver;
pub mod btc_light_client;
pub mod carel_stake_vault;
pub mod interfaces;
pub mod garaga_verifiers;

pub mod mocks {
    pub mod mock_erc20;
    pub mod mock_signature_account;
}
