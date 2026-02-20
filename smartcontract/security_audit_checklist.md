# CAREL Protocol Security Audit Checklist
This checklist tracks the current contract security posture, open hardening items, and explicit assumptions for testnet operations.

## Table of Contents
- [Project Status](#project-status)
- [Access Control](#access-control)
- [Input Validation](#input-validation)
- [Arithmetic Safety](#arithmetic-safety)
- [State Management](#state-management)
- [Token Safety](#token-safety)
- [Emergency Measures](#emergency-measures)
- [Cross-Layer Messaging (L1 <-> L2)](#cross-layer-messaging-l1---l2)
- [Integration Safety](#integration-safety)
- [Testing Coverage](#testing-coverage)
- [Gas and DoS Resilience](#gas-and-dos-resilience)
- [Documentation](#documentation)
- [Security Assumptions](#security-assumptions)
- [Known Limitations](#known-limitations)

## Project Status
| Area | Status | Notes |
| --- | --- | --- |
| Network | Active (Testnet) | Starknet Sepolia is the current deployment target |
| Test Status | Passing | `145/145` passing on current integrated suite |
| Hide Mode | Active | Relayer path for swap/limit/stake only |
| Upgradeability | Not implemented | No proxy path; redeploy + migration model |

Gas snapshot (current vs target):
| Metric | Current | Target | Status |
| --- | --- | --- | --- |
| AI burst load (batch submit, 100 actions) | ~9.8M gas | <= 5.0M gas | Above target |
| AI rate-limit path | ~4.9-5.1M gas | 1.5M gas | Above target |
| TWAP calculation | ~3.4M gas | 100-200K gas | Above target |
| TWAP deviation check | ~3.7M gas | 100-200K gas | Above target |

## Access Control
- [x] Owner/admin checks exist for critical parameter updates.
- [x] Vesting schedule creation is restricted to authorized role.
- [x] Treasury-sensitive operations are owner-gated.
- [x] Router/verifier wiring changes are admin-gated.
- [x] Points consumption requires authorized contract paths.
- [x] Privileged function boundaries reviewed for unauthorized access.

## Input Validation
- [x] Amount-based inputs validate non-zero where required.
- [x] Address-like parameters validate non-empty/non-zero constraints.
- [x] Deadline-based flows enforce expiry checks.
- [x] Slippage guard paths are present in execution flows.
- [x] Tier/enum bounds checks are present on user-facing actions.

## Arithmetic Safety
- [x] Arithmetic constraints reviewed for overflow/underflow exposure.
- [x] Division-by-zero protections are in place.
- [x] Fee bounds are enforced in basis-point logic.
- [x] Reward conversion and ratio paths include sanity constraints.
- [x] Felt/u256 boundary assumptions reviewed in critical flows.

## State Management
- [x] Nullifier and replay-protection checks exist in privacy flows.
- [x] State updates are applied before/around external effects where applicable.
- [x] Duplicate claim/double-spend paths are blocked by flags/nullifiers.
- [x] Constructor initialization paths set required owner/admin fields.
- [x] Storage growth risks reviewed with caps/pagination where available.

## Token Safety
- [x] ERC20 interactions are constrained to expected transfer/allowance paths.
- [x] Mint/burn paths are role-restricted.
- [x] Fee transfer logic includes split-bound controls.
- [x] Token address mapping has explicit fallback/validation checks.

## Emergency Measures
- [x] Emergency-role pathways exist where designed.
- [x] Pause/emergency controls reviewed for privileged misuse risk.
- [x] Incident response assumes multisig-controlled admin keys.
- [x] Upgradeability absence is explicitly documented as operational risk.

## Cross-Layer Messaging (L1 <-> L2)
- [x] L1 handler validation reviewed where relevant.
- [x] Message failure handling reviewed for current integration scope.
- [x] No custom L1 handler module introduces additional trust assumptions at this stage.

## Integration Safety
- [x] DEX route integration paths reviewed for unsafe call assumptions.
- [x] Bridge provider dependency risk acknowledged and documented.
- [x] Oracle dependency and fallback behavior reviewed.
- [x] External verifier adapter trust model documented.

## Testing Coverage
- [x] Unit and integration tests cover core protocol paths.
- [x] Privacy nullifier flows are tested across private modules.
- [x] User workflow scenarios are covered across trading/rewards/privacy modules.
- [x] Edge-path testing includes invalid proofs, unauthorized actions, and replay attempts.
- [x] Performance/load checks exist for AI executor-related paths.

## Gas and DoS Resilience
- [x] Pagination/caps are applied on high-cardinality reads where possible.
- [x] Batch pathways exist for selected high-volume actions.
- [ ] AI rate-limit gas remains above target (`~4.9-5.1M` vs target `1.5M`).
- [ ] TWAP gas remains above target (`~3.4-3.7M` vs target `100-200K`).
- [ ] Ongoing optimization is required before production-grade gas posture.

## Documentation
- [x] Contract-level security assumptions are documented.
- [x] Known limitations are explicitly listed.
- [x] Testnet-only components are clearly marked.
- [x] Deployment and wiring docs are available for reproducible setup.

## Security Assumptions
1. Admin and relayer keys are stored securely and rotated under controlled operational policy.
2. Verifier contracts and adapter wiring are trusted once configured on testnet.
3. Oracle/provider integrations are treated as partially trusted external dependencies.
4. Off-chain prover and relayer infrastructure is trusted not to leak sensitive payload internals.
5. Mainnet deployment will not use `MockGaragaVerifier` under any condition.

## Known Limitations
| Limitation | Notes |
| --- | --- |
| Hide Mode metadata leakage | Hide Mode reduces linkability but cannot fully hide timing/fee/tx graph metadata on public chains. |
| Bridge dependency risk | Bridge behavior depends on external provider uptime and policy. |
| RPC instability | Quote/indexer/API behavior can degrade under provider rate limits. |
| TWAP implementation | Current TWAP path uses running-average style logic, not strict fixed time-window buffering. |
| Gas profile | AI and TWAP gas are above target and require further optimization. |
| Mock verifier scope | `MockGaragaVerifier` is testnet-only and forbidden for mainnet. |
| Battleship persistence | Current gameplay state is still backend-memory based and not fully on-chain. |
| Upgrade model | No proxy upgrade path; migrations require redeploy plus state movement. |
