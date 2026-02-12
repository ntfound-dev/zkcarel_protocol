/// @title CAREL Protocol Root Module
/// @author CAREL Team
/// @notice Aggregates the top-level protocol modules for Starknet deployment.
/// @dev Keeps module wiring centralized for consistent import paths across crates.
pub mod core;
pub mod rewards;
pub mod nft;
pub mod staking;
pub mod bridge;
pub mod ai;
pub mod utils;
pub mod trading;
pub mod governance;
pub mod privacy;
pub mod point_token;
