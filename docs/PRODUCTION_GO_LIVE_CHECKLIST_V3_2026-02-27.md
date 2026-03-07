# ZKCare Production Go-Live Checklist (ShieldedPoolV3)

Snapshot date: 27 February 2026  
Scope: hide-mode Swap, Limit Order, and Stake with dual-pool setup (V2 legacy redeem + V3 new notes)

## 1. Status Legend

- `DONE`: implemented and verified in repo/tests.
- `PARTIAL`: implemented but still has security/operational gap.
- `PENDING`: not implemented yet.

## 2. Decision Gates

### 2.1 Gate A: Testnet Beta (allowlist users, capped funds)

Required outcome: **all P0 items = `DONE`**, with no open critical bug.

### 2.2 Gate B: Public Production (mainnet, open users)

Required outcome: **all P0 + P1 items = `DONE`**, external audit complete, and SRE/incident controls ready.

Current recommendation at this snapshot:

- Gate A (Testnet Beta): **GO with restrictions**
- Gate B (Public Production): **NO-GO**

## 3. P0 Checklist (Must-Have Before Beta)

### 3.1 P0.1 Unlinkability Controls

- `DONE` V3 execute path does not accept free `recipient` parameter; recipient sourced from proof output.
  - Evidence: `smartcontract/private_executor_lite/src/shielded_pool_v3.cairo`
- `DONE` Nullifier replay prevention.
  - Evidence: `nullifier_used` checks + tests.
- `DONE` Action-hash binding enforced at execution (swap/limit/stake).
  - Evidence: `*_execute_private_*_with_payout` hash checks.
- `DONE` Mix window hard reject (default 3600s) in backend for V3.
  - Evidence: `backend-rust/src/api/swap.rs`, `limit_order.rs`, `stake.rs`.
- `DONE` Strict guard already enforced:
  - reject `recipient == depositor`
  - reject inline deposit+submit+execute in strict mode

### 3.2 P0.2 Dual Pool Safety

- `DONE` V3 default + V2 redeem-only migration flags available.
  - Evidence: `backend-rust/README.md` env section.
- `DONE` V2 legacy path is still available for old notes.
- `DONE` New note flow is routed to V3.

### 3.3 P0.3 Frontend Safety Controls

- `DONE` Hide execute blocked during mix window with countdown.
  - Evidence: `frontend/components/trading-interface.tsx`.
- `DONE` V3 denomination selector available (1/5/10/50/100 STRK).
- `DONE` V3 recipient lock UX:
  - recipient persisted in note payload
  - warning shown if current receive address differs from locked note recipient

### 3.4 P0.4 Contract/Backend Test Health

- `DONE` Cairo tests pass: `19 passed, 0 failed`.
  - Evidence: `smartcontract/private_executor_lite/tests/test_shielded_pool_v3.cairo`
  - and updated legacy tests in `test_contract.cairo`.
- `DONE` Backend compiles and targeted tests for V3 pool-version and mixing defaults pass.

## 4. P1 Checklist (Must-Have Before Public Production)

### 4.1 P1.1 Circuit Security Completeness

- `PARTIAL` Current prover binds V3 outputs (`root/nullifier/action_hash/recipient`) but circuit is not yet a full production note-membership circuit (Merkle membership + full witness constraints end-to-end).
- `PENDING` Independent cryptography review for final circuit design.
- `PENDING` Formal domain-separation spec for all hashes (`note`, `nullifier`, `action`) published in docs.

### 4.2 P1.2 Smart Contract Assurance

- `PENDING` External security audit for `ShieldedPoolV3` and relayer-facing execution surfaces.
- `PENDING` Mainnet-grade invariant/fuzz/property tests (beyond current integration unit tests).
- `PENDING` Upgrade/rollback policy + emergency pause playbook.

### 4.3 P1.3 Relayer/Backend Production Hardening

- `PARTIAL` Auto prover queue, timeout, and fallback are implemented.
- `PENDING` Full SLO/SLA observability:
  - proof latency p95/p99
  - queue depth
  - relayer fail ratio
  - RPC failure classification and alerting
- `PENDING` HSM/KMS signing policy (or equivalent key isolation) for relayer keys.
- `PENDING` Rate-limit + abuse prevention policy documented per endpoint.

### 4.4 P1.4 Infra/Network Integrity

- `PENDING` Resolve upstream TLS/certificate reliability issues seen in runtime logs (expired cert / wrong hostname chain) before public rollout.
- `PENDING` Multi-RPC failover and health checks with automatic circuit-breaker policy.

### 4.5 P1.5 Product/Legal Clarity

- `PENDING` Public threat-model doc that explicitly states what is visible vs hidden.
- `PENDING` User-facing privacy disclaimer aligned with actual guarantees.

## 5. P2 Checklist (Strongly Recommended for Scale)

- `PENDING` Red-team simulation for de-anonymization via timing/metadata correlation.
- `PENDING` Canary deployment + progressive traffic shift (1% -> 10% -> 50% -> 100%).
- `PENDING` Automated incident drills (relayer stuck, prover timeout storm, RPC outage).

## 6. Release Checklist (Execution Order)

### 6.1 Phase 1: Beta (Testnet)

- [ ] Confirm env:
  - `HIDE_BALANCE_EXECUTOR_KIND=shielded_pool_v3`
  - `HIDE_BALANCE_POOL_VERSION_DEFAULT=v3`
  - `HIDE_BALANCE_V2_REDEEM_ONLY=true`
  - `HIDE_BALANCE_MIN_NOTE_AGE_SECS=3600`
- [ ] Run:
  - `cargo check` (backend)
  - `cargo test` targeted V3 tests (backend)
  - `asdf exec snforge test` (private_executor_lite)
  - `npm run lint` (frontend; warnings documented)
- [ ] Verify one end-to-end private flow each:
  - swap
  - limit
  - stake
- [ ] Verify mix-window rejection and post-window success.

### 6.2 Phase 2: Mainnet Public

- [ ] Complete all P1 items.
- [ ] External audit sign-off.
- [ ] Security + SRE go/no-go review signed.
- [ ] Legal/privacy copy approved.

## 7. Current Go/No-Go Summary

- For controlled Sepolia beta: **GO**
  - Conditions: allowlist users, cap value per tx/day, explicit privacy disclaimer.
- For public production: **NO-GO**
  - Primary blockers: full circuit completeness + external audit + SRE hardening.
