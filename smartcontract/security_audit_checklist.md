# CAREL Protocol Security Audit Checklist

## Project Status
- Backend Rust integration: in progress
- Deployment plan: testnet first, then mainnet after gas + security validation
- Latest test run: 145/145 tests passed
- Gas snapshot (latest): AI burst load ~9.8M (batch submit, 100 actions), AI rate-limit ~4.9–5.1M, TWAP calc ~3.4M, TWAP deviation ~3.7M

## Access Control
- [x] Only owner can change critical parameters (fee configs, verifiers, oracle wiring)
- [x] VestingManager: Only owner can create vesting schedules
- [x] Treasury: Only owner can burn tokens
- [x] Router: Only owner can add DEXes/bridges
- [x] NFT: Only router can use discounts
- [x] Points: Only approved contracts can add points
- [x] Privileged functions (upgrade/pause/withdraw) restricted to owner/admin where implemented (no upgrade module found)
- [x] Account abstraction: signature verification and replay protection for custom accounts (N/A: no custom account contract; AI signature verifier now consumes hashes on-chain)

## Input Validation
- [x] All amounts checked for > 0 where required (fees/multipliers)
- [x] Address validation (non-zero for recipients/verifiers/oracle adapters)
- [x] Deadline validation (Swap Router + PrivateSwap enforce `deadline > now`)
- [x] Slippage protection
- [x] Tier bounds checking

## Arithmetic Safety
- [x] No integer overflow/underflow (guarded fee/multiplier bounds)
- [x] Safe division (check denominator != 0)
- [x] Fee calculation bounds (swap/bridge/mev <= 10000 bps)
- [x] Reward calculation accuracy
- [x] Felt252 arithmetic wraparound risk reviewed (felts used for IDs/hashes; amounts use u256)
- [x] L1 (uint160) <-> L2 (felt252/u256) address conversions validated (N/A: no L1 address types or handlers)

## State Management
- [x] No reentrancy vulnerabilities (state updated before external calls)
- [x] Proper state updates before external calls
- [x] No duplicate claims (nullifiers + processed flags)
- [x] Proper vesting schedule tracking
- [x] Storage initialization verified (constructors set owners/admins and critical params; maps rely on default-zero sentinels)
- [x] Mapping access patterns reviewed for unsafe assumptions (unbounded growth mitigated via owner-controlled caps and pagination)

## Token Safety
- [x] ERC20 compliance
- [x] Proper allowance handling
- [x] Safe transfer patterns
- [x] Mint/burn restrictions

## Emergency Measures
- [x] Pause functionality (if implemented)
- [x] Emergency withdrawal for stuck funds
- [x] Upgradeability considerations (no proxy/upgrade mechanism; upgrades require redeploy + state migration)
- [x] Multisig requirements

## Cross-Layer Messaging (L1 <-> L2)
- [x] L1 handler validates trusted L1 sender address (N/A: no #[l1_handler] found)
- [x] Failed L1 messages handled (N/A: no L1 messaging implemented)

## Integration Safety
- [x] DEX integration safety
- [x] Bridge integration safety
- [x] Oracle price feed safety
- [x] External contract call safety

## Testing Coverage
- [x] Unit tests for privacy nullifiers (dark pool/private payments/private BTC swap)
- [x] Integration tests for workflows (multi-contract flows: fee_collector/treasury, swap/bridge aggregators, staking)
- [x] Edge case testing (unauthorized paths, invalid proofs, double-spend/nullifier reuse, bounds) — not exhaustive
- [x] Fuzz testing (snforge fuzz for MerkleVerifier invariants)
- [x] Load testing (AIExecutor burst load test + script)

## Gas & DoS Resilience
- [x] Gas efficiency review for loops and heavy computations (caps + pagination added for AI pending scans, provider/dex lists, leaderboard reads/updates)
- [x] AI burst load optimized using `batch_submit_actions` (fee+signature disabled path)
- [ ] AI rate limit gas still above target (current ~4.9–5.1M vs target 1.5M)
- [ ] TWAP gas still above target (current ~3.4–3.7M vs target 100–200K)
- [x] DoS vectors checked (no critical per-user blocking found; admin-controlled caps should be maintained)

## Documentation
- [x] Code comments
- [x] Function documentation
- [x] Security assumptions documented
- [x] Known limitations documented

## Security Assumptions
- Backend signer keys are stored securely and never exposed to clients.
- Oracle inputs are sourced from trusted providers; fallback prices are admin-controlled.
- Bridge provider adapters are configured to known endpoints and only updated by owner.
- Verifier contracts (Garaga/Tongo/Semaphore/Sigma) are trusted and immutable after setup.
- Admin keys are protected by multisig for production.

## Known Limitations
- Privacy modules rely on external proof verification contracts and off-chain tooling.
- Bridge execution depends on third-party APIs (Atomiq/Garden/LayerSwap) availability.
- Price oracle accuracy depends on upstream feed availability.
- TWAP currently uses running average (approximate; not a strict time window).
- AI pending queries scan by action id with `max_pending_scan` cap; may miss older pending actions if cap too low.
- Batch submit path is gated to fee/signature-disabled mode (intended for controlled backend usage).
- Gas limits and sequencer availability can delay L1/L2 or heavy computations.
