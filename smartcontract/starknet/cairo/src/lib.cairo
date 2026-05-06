/// @notice Root module that exposes all CAREL protocol components.
///         Keeps import wiring centralized across contracts.

/// @notice Core contracts for tokenomics, treasury, fees, and registry state.
/// @dev Other protocol modules depend on these primitives.
pub mod core {
    pub mod token;
    pub mod vesting_manager;
    pub mod treasury;
    pub mod fee_collector;
    pub mod lockup_escrow;
    pub mod airdrop_vesting;
    pub mod registry;
    pub mod carel_protocol;
}

/// @notice Reward distribution, points, referrals, and Merkle verification.
/// @dev Keeps reward-related contracts grouped for clear integration paths.
pub mod rewards {
    pub mod snapshot_distributor;
    pub mod point_storage;
    pub mod point_token;
    pub mod referral_system;
    pub mod merkle_verifier;
    pub mod rewards_escrow;
}

/// @notice Discount NFT contracts used for loyalty and fee reductions.
/// @dev Keeps NFT logic isolated from swaps and rewards.
pub mod nft {
    pub mod discount_soulbound;
}

/// @notice AI execution and billing entrypoints for CAREL services.
/// @dev Encapsulates AI-related contracts to keep core protocol small.
pub mod ai {
    pub mod ai_executor;
    pub mod ai_signature_verifier;
    pub mod ai_plan_router;
    pub mod erc8004_identity_registry;
    pub mod erc8004_validation_registry;
    pub mod erc8004_reputation_registry;
    pub mod agent_registry;
}

/// @notice Shared utilities for access control, oracles, and admin tooling.
/// @dev Centralizes reusable helpers used across protocol contracts.
pub mod utils {
    pub mod price_oracle;
    pub mod emergency_pause;
    pub mod twap_oracle;
    pub mod multisig;
}

/// @notice Trading layer modules for swaps, staking, limit orders, and Battleship ZK game.
/// @dev Keeps trading-related contracts isolated from core protocol modules.
pub mod trading {
    pub mod swap;
    pub mod staking;
    pub mod dca_orders;
    pub mod battleship_garaga;
    pub mod privacy_intermediary;
}

/// @notice Multi-token faucet for testnet distribution.
pub mod faucet {
    pub mod multi_faucet;
}

/// @notice Governance and timelock contracts for protocol decision execution.
/// @dev Provides delayed execution controls for sensitive changes.
pub mod governance {
    pub mod timelock;
    pub mod governance;
}

pub mod privacy_router;
pub mod privacy_router_v4;
pub mod privacy_action_types;

/// @notice Garaga-based privacy primitives and external protocol interfaces.
pub mod shielded_pool_v4;
pub mod shadow_bridge_receiver;
pub mod btc_light_client;
pub mod carel_stake_vault;
pub mod interfaces;
pub mod garaga_verifiers;
/// @notice Adapter wrapping raw Garaga UltraKeccakZKHonk verifier into IProofVerifier.
pub mod honk_wrapper_adapter;

pub mod mocks {
    pub mod mock_erc20;
    pub mod mock_signature_account;
}
