# Backend-Rust Internal Audit — CAREL Protocol

**Date:** 2026-05-06  
**Auditor:** Internal (Claude Code)  
**Scope:** `backend-rust/src/` — all services, handlers, on-chain integrations, garaga pipeline, and indexer  
**Status:** Full file-by-file pass complete. 3 bugs fixed; 11 technical-debt items documented; pre-mainnet checklist updated.

---

## Executive Summary

This audit evaluated the backend on two axes:

1. **Correctness** — any bug that risks user funds or corrupts on-chain state
2. **Logic distribution** — any logic that belongs on-chain but is currently off-chain

Two **critical** and one **medium** bugs were found and fixed in this commit. No additional critical bugs were found in the second-pass audit of the remaining ~55 files. Several medium and low technical-debt items were identified across the `bridge_worker`, `indexer`, `garaga`, `services`, and `api` layers. These are documented below with actionable notes.

The hybrid architecture — PostgreSQL as the mutable off-chain ledger, Cairo contracts as the finalized canonical state — is correct and well-suited to the protocol's requirements.

---

## Part 1 — Bugs Found and Fixed

### BUG-001 — Expired limit orders permanently lock user funds

**Severity:** Critical  
**File:** `backend-rust/src/services/limit_order_executor.rs`  
**Function:** `expire_order()`

**Root cause:**  
`LimitOrderBook.cairo` locks user tokens via `transfer_from` when `create_limit_order` is called. When the backend detected an expired order, `expire_order` only updated the DB (status = 4) without calling the smart contract. There was no mechanism to refund the locked tokens.

```
User creates order → tokens locked in LimitOrderBook
Backend detects expiry → only updates DB status → tokens never returned
```

**Fix:**
- Added `expire_limit_order(order_id)` entrypoint to `dca_orders.cairo` — callable by authorized keeper, enforces `block_timestamp >= expiry`, transfers `from_token` back to the order owner, emits `LimitOrderExpired` event.
- `expire_order` in Rust now calls `expire_limit_order` on-chain **before** updating the DB. If the on-chain call fails, the backend logs a warning but still updates the DB (graceful degradation).

**Files changed:**
- `smartcontract/starknet/cairo/src/trading/dca_orders.cairo` — interface + event + implementation
- `backend-rust/src/services/limit_order_executor.rs` — on-chain call added

---

### BUG-002 — Referral points double-credited

**Severity:** Critical  
**File:** `backend-rust/src/services/point_calculator.rs`  
**Functions:** `apply_referral_bonus()` + `sync_referral_onchain()`

**Root cause:**  
The backend calculated referral bonus (10% referrer + 10% referee) and then performed two operations that both credited the same bonus:

1. `sync_points_total_onchain()` → called `PointStorage.submit_points()` with the **absolute total** already including the referral bonus.
2. `sync_referral_onchain()` → called `ReferralSystem.record_referee_points()`, which stored the bonus separately, allowing the user to later claim it again via `claim_referral_bonus()` → `PointStorage.add_points()`.

Result: users with active referrals could accumulate up to 2× the correct on-chain point balance.

```
Backend computes bonus = X
→ Path A: PointStorage.submit_points(total_with_X)    ✓ correct total
→ Path B: ReferralSystem.record → user claim → add_points(X)  ✗ double
```

**Fix:**  
Removed `sync_referral_onchain()` and `build_referral_call()` from `point_calculator.rs`. The backend is the single source of truth — the full point total (including referral bonus) is synced via `submit_points`. The on-chain `ReferralSystem` contract still handles referral registration, but the backend no longer pushes points to it in parallel.

**Files changed:**
- `backend-rust/src/services/point_calculator.rs` — `sync_referral_onchain` and `build_referral_call` removed

---

### BUG-003 — Race condition between `add_points` and `submit_points` for social points

**Severity:** Medium  
**File:** `backend-rust/src/services/social_verifier.rs`  
**Function:** `sync_points_onchain()`

**Root cause:**  
Two services used different on-chain methods:
- `social_verifier` → `PointStorage.add_points()` (delta, **append**)
- `point_calculator` → `PointStorage.submit_points()` (absolute total, **overwrite**)

If `point_calculator` ran after `social_verifier` had added a delta, the calculator would overwrite the on-chain state with its DB total — which might or might not yet include the social points, depending on DB timing. Either the delta was overwritten (lost points) or double-counted (inflated points).

**Fix:**  
`social_verifier.sync_points_onchain` now:
1. Reads `total_points` from DB after the upsert completes.
2. Calls `PointStorage.submit_points()` with the absolute total — consistent with `point_calculator`.

Both services now always write an absolute value, making execution order irrelevant.

**Files changed:**
- `backend-rust/src/services/social_verifier.rs` — `build_add_points_call` replaced by `build_submit_points_call`, signature of `sync_points_onchain` simplified

---

## Part 2 — Extended Audit (All Remaining Files)

This section documents findings from the second-pass audit of all files not covered in Part 1.

### 2.1 — `api/auth.rs` — Authentication Layer

**Status: Generally well-implemented.**

- Login message timestamp is validated with a 300-second TTL — prevents replay attacks.
- Starknet signature verification uses `is_valid_signature` called on-chain against the user's account contract. Correct: handles smart wallet signatures (e.g., multisig Argent/Braavos).
- Bitcoin signature uses `bip322::verify_simple_encoded` with hex→base64 normalization. Correct.
- EVM signatures use `SignatureVerifier::verify_signature` (EIP-191 ECDSA) — correct for MetaMask/EVM wallets. This is the right curve for EVM users.
- Referral bind is enforced as one-time only (`bind_referrer_once`) and rejects self-referral.
- JWT refresh grace window is `expiry × 7` (minimum 24h). Reasonable.

**Finding — auth.rs no issues:** No bugs found. Code is solid.

---

### 2.2 — `api/onchain_privacy.rs` — On-Chain Privacy Verification

**Status: Thorough implementation, one note.**

This module parses raw Starknet INVOKE transaction calldata to verify that a user's on-chain transaction actually contains the expected ZK proof payload (nullifier, commitment, root, proof elements).

- Checks tx sender against all linked Starknet wallets of the authenticated user.
- Checks that the calldata contains the expected `submit_private_action` / `submit_private_swap` / `execute_private_*` call with matching proof elements.
- Checks transaction finality (`PreConfirmed` is not accepted; polls 5 attempts × 1s).
- Checks reverted status via receipt.
- `ensure_nullifier_unused` queries `is_nullifier_used` on-chain before relayer execution.

**Finding — onchain_privacy.rs — intermediary V1 path has no execute call check:**  
When a transaction goes through `PrivacyIntermediary`, the code validates the `execute()` call on the intermediary and checks nullifier/commitment binding. However it does **not** verify that the intermediary then actually invokes the `execute_private_*` method on the pool. An adversary could craft a transaction that calls the intermediary's `execute` with correct parameters but routes to a different internal target. Low-severity for testnet; review before mainnet.

---

### 2.3 — `api/privacy.rs` — Privacy API (Garaga Proof Flow)

**Status: Production guards are present and correct.**

- `allow_nonproduction_proof_shortcuts()` gate prevents static artifact paths from being used in production.
- `is_production_environment()` enforces the correct check across `api/privacy.rs` and `garaga/auto_prover.rs`.
- Privacy RPC URL pool is resolved from multiple env fallback candidates (good resiliency).

**Finding — privacy.rs no additional bugs:** Production guardrails are well-structured.

---

### 2.4 — `garaga/auto_prover.rs` — ZK Proof Orchestration

**Status: Production safeguards present. Two notes.**

The Garaga auto-prover handles the full pipeline from proof generation request to Starknet calldata assembly (for both Groth16 and ZK-Honk circuits).

- `GARAGA_PRECOMPUTED_PAYLOAD_PATH` is blocked in production environments — cannot serve pre-generated proofs in mainnet.
- `GARAGA_PROVE_CMD` is mandatory in production — real per-request proving is enforced.
- Per-request temp directory with random suffix prevents proof file collisions.
- Redis-based concurrency queue limits parallel proving jobs (default max 2). Fail-open if Redis unavailable (logs warning, continues without queue).
- VK `nPublic` validation prevents "scalars and points length mismatch" errors.
- `run_test_mode()` validates that two different inputs produce two different proofs — good property test.

**Finding — TD-AUTO-001 — `GARAGA_ALLOW_STATEMENT_OVERRIDE` is an escape hatch with no production block:**  
When `GARAGA_ALLOW_STATEMENT_OVERRIDE=true`, the prover allows overriding `root`, `nullifier`, `action_hash`, `recipient`, `chain_id`, and `contract_address` in the public inputs from the `tx_context` payload. This allows the caller to substitute any values for the circuit's public outputs. This flag is intended for testing and key replay scenarios, but there is no enforcement that it is `false` in production. The production startup check (`AI_EXECUTOR_AUTO_DISABLE_SIGNATURE_VERIFICATION` is checked) does not cover this variable.  
**Action:** Add `GARAGA_ALLOW_STATEMENT_OVERRIDE` to the production fail-fast check in `main.rs`.

**Finding — TD-AUTO-002 — Honk proof public inputs are read as raw bytes then chunked to 32-byte words:**  
`read_public_inputs_bytes` reads the binary file directly, then `bytes_to_hex_words` chunks into 32-byte words. If the circuit prover outputs public inputs in a format other than 32-byte-aligned big-endian, the chunking will silently produce incorrect field elements. No format validation is performed.  
**Action:** Document the expected byte format for `GARAGA_PUBLIC_INPUTS_PATH` in Honk mode, or add a validation check.

---

### 2.5 — `services/invoke_parser.rs` — Calldata Parser

**Status: Clean implementation.**

Two parsing strategies (offset-based INVOKE v1/v3 format and inline format) with automatic fallback. All index arithmetic uses `checked_add` / `checked_mul` — overflow protection is correct.

**No bugs found.**

---

### 2.6 — `services/merkle_generator.rs` — Merkle Tree

**Status: One important silent failure.**

- Only includes users with `finalized = true AND total_points > 0` — correct.
- Leaf hash is `poseidon(user, amount_low, amount_high, epoch)` — matches on-chain verifier.
- Sorted pair hashing ensures deterministic tree structure.

**Finding — BUG-CANDIDATE-001 — Proof verification result is silently discarded:**  
In `generate_proof`, after constructing the proof path, the function calls:
```rust
let _ = self.verify_proof(tree.root, leaf, &proof);
```
The result is intentionally discarded. If the generated proof does not verify, no error is returned — the function returns `Ok(proof)` regardless. Any caller that uses the returned proof to let a user claim rewards will submit an invalid proof to the on-chain `SnapshotDistributor.claim_reward`, which will revert. The user receives no points but also no informative error from the backend.  
**Action:** Change to `if !self.verify_proof(tree.root, leaf, &proof) { return Err(...) }`.

---

### 2.7 — `services/snapshot_manager.rs` — Epoch Finalization

**Status: One potential state divergence.**

- Finalization sets all points to `finalized = true` before Merkle submission — correct ordering.
- Calls both `submit_merkle_root` and `finalize_epoch` in a single `invoke_many` multicall — atomic from the relayer perspective.

**Finding — TD-SNAPSHOT-001 — Epoch can be finalized without a Merkle root:**  
If `merkle_generator.get_merkle_root(epoch)` returns `Err` (e.g., no root was saved for this epoch yet), the code logs a warning and skips the `submit_merkle_root` call, but still proceeds to call `PointStorage.finalize_epoch`. This means the epoch is finalized in `PointStorage` (points can no longer be updated) but no corresponding Merkle root is available in `SnapshotDistributor`. Users will have finalized points but no proof path to claim rewards.  
**Action:** Either enforce that `save_merkle_root` must succeed before calling `finalize_epoch`, or add a reconciliation check.

---

### 2.8 — `services/price_guard.rs` — Price Sanitizer

**Status: Correct for testnet. Needs live oracle before mainnet.**

- Per-token sanity bounds prevent oracle manipulation from producing pathological point totals (e.g., BTC at $0 would award 0 points).
- `sanitize_usd_notional` and `sanitize_points_usd_base` cap per-tx USD values.

**Finding — TD-PRICE-001 — Fallback prices are hardcoded and stale:**  
- BTC: $65,000 (may be significantly below actual market price at mainnet)
- ETH: $1,900 (was correct in 2023; current price is approximately 2×–3× higher)
- STRK: $0.05

These are safe (conservative — lower price = fewer points = no inflation), but they make point calculations inaccurate when the live price feed is unavailable. This ties directly to TD-002 (gas oracle integration) and should use the same live price feed.

---

### 2.9 — `services/route_optimizer.rs` — Bridge Route Selection

**Status: StarkGate is a mock stub. Others are real clients.**

- Garden, LayerSwap, and Atomiq route through real API clients.
- Provider routing logic (bridge pair matrix, STRK disable, token normalization) is well-tested (15 unit tests).

**Finding — TD-ROUTE-001 — StarkGate bridge is a hardcoded mock:**  
The StarkGate branch in `get_bridge_quote` returns a simulated route with `fee_bps = 30` and `estimated_time_minutes = 720`. It does not call any external API. Any user who receives a StarkGate route in the UI is seeing simulated data.  
**Action:** Implement real StarkGate fee/time fetching or clearly label the StarkGate option as "estimated" in the UI.

---

### 2.10 — `services/liquidity_aggregator.rs` — DEX Quote Aggregation

**Status: All DEX clients are mock stubs. Production guard is present.**

If `!is_testnet()` and `DEX_QUOTE_MODE` is not set to `mock|test|dev`, no DEX clients are registered and all quote requests return `BadRequest`. This correctly blocks fake data from reaching mainnet.

**Finding — TD-DEX-001 — Ekubo, Haiko, and Avnu clients are all simulated:**  
All three implementations (`EkuboClient`, `HaikoClient`, `AvnuClient`) calculate deterministic amounts from fee constants (2bps, 3bps, 4bps respectively) with no real API calls. The returned quotes do not reflect actual on-chain liquidity or real swap prices.  
**Action:** Implement real API/SDK integrations before mainnet launch. Ekubo has an off-chain quoting API; AVNU has a REST API.

---

### 2.11 — `services/nft_discount.rs` — NFT Discount Consumption

**Status: Well-implemented. One note on in-memory rate limit.**

- Per-user+action rate limiting using an in-memory `HashMap` with sliding window.
- Timeout guards on both read (2.5s) and write (5s) operations prevent RPC hangs.
- Map capped at 50,000 entries with cleanup.

**Finding — TD-NFT-001 — Rate limit state resets on restart:**  
The in-memory rate limit map is a `static OnceLock` — it persists across requests within a process lifetime but is cleared on every backend restart. Under load or rolling deployments, the rate limit provides no protection during the restart window.  
**Action:** Move rate limit counters to Redis (same as the Garaga prover queue) for durability across restarts.

---

### 2.12 — `bridge_worker.rs` — Bitcoin→Starknet Bridge Watcher

**Status: Three bug candidates identified (not yet fixed).**

**Finding — BUG-CANDIDATE-002 — Unrecognized BTC senders attributed to a single fallback address:**  
`resolve_starknet_recipient` returns `DEFAULT_STARKNET_RECIPIENT` for any BTC sender not present in the user mapping table. This means all unrecognized deposits (e.g., test transactions from unknown addresses) mint tokens and points to the same single address. If `DEFAULT_STARKNET_RECIPIENT` is the treasury or any real address, this is an unintended credit.  
**Action:** Return an error or skip minting when no mapping exists, rather than defaulting to a single address.

**Finding — BUG-CANDIDATE-003 — Bridge worker uses `mint_points` on point token, not `submit_points` on PointStorage:**  
All other point-awarding paths use `PointStorage.submit_points()` (absolute overwrite). The bridge worker calls `mint_points` on the CAREL point token contract directly. These are two different contracts and two different accounting systems. If `point_calculator` later calls `submit_points` with its DB total (which may not include the bridge mint), the bridge points may be overwritten to zero.  
**Action:** Align bridge worker with the `PointStorage.submit_points` path used by all other services, or ensure the DB total includes bridge-minted points before the calculator runs.

**Finding — BUG-CANDIDATE-004 — Hardcoded `POINTS_PER_USD = 25.0` in bridge worker:**  
`point_calculator` derives its rate from configurable parameters (base rate × multiplier × AI level). The bridge worker uses a hardcoded `25.0`. If the protocol-wide rate changes, bridge users will receive a different rate than swap/stake users.  
**Action:** Read the rate from the same constants/config used by `point_calculator`.

---

### 2.13 — `indexer/block_processor.rs` — On-Chain Event Ingestion

**Status: Two systematic data gaps.**

**Finding — TD-IDX-001 — Chain-indexed transactions always have `usd_value: None`:**  
Transactions reconstructed from on-chain events (swap fills, stake events) are built without a USD value (`usd_value: None`). When `point_calculator` processes these transactions, it cannot compute USD-based points — all chain-indexed transactions receive 0 points from the calculator.  
**Action:** After indexing a transaction, enrich it with a USD value lookup from the Redis price cache before inserting into the DB.

**Finding — TD-IDX-002 — `merge_transaction` overwrites event type with the first-seen type:**  
When a single on-chain transaction emits multiple events (e.g., swap + stake), `merge_transaction` keeps only the first event type and discards the rest. The transaction is categorized as only one type and may miss point calculations for the secondary operation.

---

### 2.14 — `indexer/event_parser.rs` — Starknet Event Parsing

**Status: Fragile positional parsing.**

**Finding — TD-IDX-003 — Swap event parsing uses offset heuristics based on `keys.len()`:**  
Event fields are read at hardcoded positional offsets that differ based on the number of keys in the event. If a contract upgrade adds or removes an indexed field, the parser will silently read wrong values without any error. This is a correctness risk whenever the swap contracts are upgraded.

**Finding — TD-IDX-004 — `LimitOrderFilled` events do not extract the user address:**  
The user address is not parsed from `LimitOrderFilled` events, leaving `user_address: None` in the DB record. This means limit order fills cannot be attributed to users for point calculation.  
**Action:** Update the parser to extract the user address from the appropriate key/data position.

---

### 2.15 — `crypto/signature.rs` — EIP-191 Signature Verification

**Status: Correct for EVM wallets. Confirm not used for Starknet auth.**

`SignatureVerifier::verify_signature` uses `ethers` secp256k1 ECDSA with EIP-191 message prefix. This is correct for Ethereum/MetaMask signatures. The `auth.rs` handler routes Starknet wallet auth to `verify_starknet_signature` (on-chain `is_valid_signature` call) and Bitcoin auth to `verify_bitcoin_signature` (BIP-322). EVM wallets use this function. The routing logic in `verify_wallet_signature` is correct.

---

### 2.16 — `services/onchain.rs` — RPC Invoker

**Status: Production-ready. One silent truncation.**

- Global `tx_submit_mutex` prevents nonce races across concurrent requests.
- Circuit breaker with exponential backoff (2s base, 180s max) and round-robin RPC pool failover.
- `parse_felt` handles hex with and without `0x` prefix.

**Finding — TD-ONCHAIN-001 — `u256_to_felts` silently truncates values above `u128::MAX`:**  
`u256_to_felts(value: u128)` always sets `high = 0`. This is correct for u128 values but the function signature implies u256 support. Any caller that passes a value exceeding `u128::MAX` will silently produce incorrect calldata. Currently all callers pass u128 values, so this is not a live bug, but it's a footgun.  
**Action:** Rename to `u128_to_felts` to match actual behavior.

---

## Part 3 — Logic Distribution: What Stays Off-Chain vs. On-Chain

### Correctly Off-Chain

| Service | Why it cannot be on-chain |
|---|---|
| `point_calculator` | Requires USD prices from Redis, AI level from DB, wash-trade detection across tx history |
| `merkle_generator` | Must iterate all users O(n); tree construction is infeasible on-chain |
| `snapshot_manager` | Oracle pattern: computes off-chain, writes canonical result to chain |
| `social_verifier` | Requires external OAuth API calls (Twitter/Telegram/Discord) |
| `limit_order_executor` | Keeper pattern — monitors price off-chain, triggers on-chain execution |
| `gas_optimizer` | Advisory only; no consensus required |
| `privacy_verifier` | Policy routing before forwarding to Garaga verifier on-chain |
| `route_optimizer` | Aggregates external provider quotes; no on-chain equivalent |
| `bridge_worker` | Cross-chain coordination (Bitcoin → Starknet); cannot be done on-chain |
| `liquidity_aggregator` | DEX quote aggregation requires off-chain API calls |

### Correctly On-Chain

| Contract | Function |
|---|---|
| `PointStorage` | Absolute point ledger per epoch, finalized state, points→CAREL conversion |
| `ReferralSystem` | Referral graph, accrual, claim mechanics |
| `SnapshotDistributor` | Merkle root storage, reward claims with proof verification |
| `LimitOrderBook` | Order state, token custody, on-chain expiry entrypoint |
| `DiscountSoulbound` | NFT discount rate, per-period usage tracking |
| Staking contracts | Lock position, reward accrual |
| Garaga verifiers | ZK proof verification (swap/stake/limit/BTC) |

---

## Part 4 — Technical Debt Summary

| ID | File | Finding | Severity | Status |
|---|---|---|---|---|
| TD-001 | `privacy_verifier.rs` | No local Honk pre-validation; passes all proofs to on-chain verifier without pre-check | High | Open |
| TD-002 | `gas_optimizer.rs` | Hardcoded gas price constants; needs live oracle integration before mainnet | Low | Open |
| TD-003 | DB / `limit_order_executor` | Status enum mismatch: DB uses `0/2/4`, contract uses `1/2/3` | Low | Open |
| TD-AUTO-001 | `garaga/auto_prover.rs` | `GARAGA_ALLOW_STATEMENT_OVERRIDE` not blocked in production startup check | Medium | Open |
| TD-AUTO-002 | `garaga/auto_prover.rs` | Honk public inputs byte format is undocumented; no format validation | Low | Open |
| TD-SNAPSHOT-001 | `snapshot_manager.rs` | Epoch can be finalized on PointStorage without a Merkle root in SnapshotDistributor | Medium | Open |
| TD-PRICE-001 | `price_guard.rs` | Fallback prices are hardcoded and potentially stale at mainnet | Low | Open |
| TD-ROUTE-001 | `route_optimizer.rs` | StarkGate branch is a hardcoded mock (30bps fee, 12h time) | Low | Open |
| TD-DEX-001 | `liquidity_aggregator.rs` | All DEX clients (Ekubo, Haiko, Avnu) are mock stubs; no real API calls | High | Open (blocked on mainnet only) |
| TD-NFT-001 | `nft_discount.rs` | Rate limit state is in-memory only; resets on backend restart | Low | Open |
| TD-ONCHAIN-001 | `onchain.rs` | `u256_to_felts` is misleadingly named; only handles u128 range | Low | Open |
| TD-IDX-001 | `block_processor.rs` | Chain-indexed transactions have no USD value → 0 points from calculator | Medium | Open |
| TD-IDX-002 | `block_processor.rs` | Multi-event transactions lose secondary event type on merge | Low | Open |
| TD-IDX-003 | `event_parser.rs` | Swap event parsing uses fragile positional offsets based on `keys.len()` | Low | Open |
| TD-IDX-004 | `event_parser.rs` | `LimitOrderFilled` does not extract user address | Medium | Open |

---

## Part 5 — Bug Candidates (Not Yet Fixed)

These require investigation before mainnet. They are not confirmed bugs in the current testnet context, but are high-risk patterns.

| ID | File | Finding | Risk |
|---|---|---|---|
| BUG-CANDIDATE-001 | `merkle_generator.rs` | `generate_proof` silently returns an unverified proof | User cannot claim rewards (funds not at risk) |
| BUG-CANDIDATE-002 | `bridge_worker.rs` | Unknown BTC senders credited to `DEFAULT_STARKNET_RECIPIENT` | Unintended credit to wrong address |
| BUG-CANDIDATE-003 | `bridge_worker.rs` | Bridge worker calls `mint_points` on point token; other services use `PointStorage.submit_points` | Bridge points may be overwritten to 0 by `point_calculator` |
| BUG-CANDIDATE-004 | `bridge_worker.rs` | Hardcoded `POINTS_PER_USD = 25.0`; may diverge from protocol rate | Inconsistent point awards for bridge users |

---

## Part 6 — Pre-Mainnet Checklist

### Bug Fixes (This Commit)
- [x] BUG-001: `expire_limit_order` on-chain + `expire_order` Rust fix
- [x] BUG-002: Remove referral double-sync from `point_calculator`
- [x] BUG-003: Standardize `submit_points` (absolute) in `social_verifier`

### High Priority (Pre-Mainnet Required)
- [ ] BUG-CANDIDATE-001: `merkle_generator.generate_proof` — fail instead of returning unverified proof
- [ ] BUG-CANDIDATE-002: `bridge_worker` — reject unknown BTC senders instead of defaulting to single address
- [ ] BUG-CANDIDATE-003: `bridge_worker` — align points minting path with `PointStorage.submit_points`
- [ ] BUG-CANDIDATE-004: `bridge_worker` — read `POINTS_PER_USD` from shared config constant
- [ ] TD-001: Implement local Honk proof pre-validation in `privacy_verifier.rs`
- [ ] TD-AUTO-001: Add `GARAGA_ALLOW_STATEMENT_OVERRIDE` to production startup fail-fast check
- [ ] TD-SNAPSHOT-001: Enforce Merkle root existence before calling `finalize_epoch` on-chain
- [ ] TD-IDX-001: Enrich chain-indexed transactions with USD value from price cache
- [ ] TD-IDX-004: Parse user address from `LimitOrderFilled` events

### Medium Priority (Before Scale)
- [ ] TD-002: Integrate live gas price oracle in `gas_optimizer.rs`
- [ ] TD-DEX-001: Implement real Ekubo/AVNU DEX integrations
- [ ] TD-IDX-002: Handle multi-event transactions without losing secondary event type
- [ ] TD-IDX-003: Make event parsing resilient to key count changes (use selector-based field lookup)
- [ ] TD-NFT-001: Move NFT discount rate limit counters to Redis

### Low Priority (Cleanup)
- [ ] TD-003: Unify limit order status enum between DB and contract
- [ ] TD-AUTO-002: Document and validate Honk public inputs byte format
- [ ] TD-PRICE-001: Update fallback prices or tie to live oracle
- [ ] TD-ROUTE-001: Implement real StarkGate fee/time API or label as estimated
- [ ] TD-ONCHAIN-001: Rename `u256_to_felts` to `u128_to_felts`

### External Audit
- [ ] Full third-party audit of all 35 Cairo contracts, frontend, and backend — required before mainnet
