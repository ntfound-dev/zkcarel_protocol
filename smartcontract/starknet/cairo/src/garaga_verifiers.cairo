/// @notice Garaga-generated ZK verifier modules for each privacy circuit.
///         Each sub-module exposes a `verify_proof` entrypoint backed by on-chain
///         Groth16 / PLONK verification via the Garaga library.
#[path("garaga_verifiers/swap_verifier/mod.cairo")]
pub mod swap_verifier;
#[path("garaga_verifiers/stake_verifier/mod.cairo")]
pub mod stake_verifier;
#[path("garaga_verifiers/limit_verifier/mod.cairo")]
pub mod limit_verifier;
#[path("garaga_verifiers/btc_verifier/mod.cairo")]
pub mod btc_verifier;
