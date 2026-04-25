# Hide Balance V4 Internal Audit - 2026-03-23

Scope:
- Swap hide mode
- Limit order hide mode
- Stake hide mode
- Shared Garaga prover/verifier plumbing

Out of scope:
- Full Shadow BTC production review
- Legacy V1/V2 hide-mode migration plan

## Findings

### 1. Critical: verifier wrapper ignored `public_inputs`

Affected source files:
- `smartcontract/starknet/cairo/src/garaga_verifiers/swap_verifier/honk_verifier.cairo`
- `smartcontract/starknet/cairo/src/garaga_verifiers/limit_verifier/honk_verifier.cairo`
- `smartcontract/starknet/cairo/src/garaga_verifiers/stake_verifier/honk_verifier.cairo`
- `smartcontract/starknet/cairo/src/garaga_verifiers/btc_verifier/honk_verifier.cairo`

Original behavior:
- `verify_proof(proof, public_inputs)` discarded the `public_inputs` argument.
- `ShieldedPoolV4` relied on these public inputs for `action_hash`, `recipient`, `chain_id`, and `contract_address`.

Risk:
- The verifier wrapper was weaker than the contract call site assumed.
- This was especially dangerous for relayer-submitted hide-mode execution.

Status:
- Patched locally.
- Wrapper now compares proof-derived public inputs against the provided public inputs.
- Requires redeploy and rewire on-chain before the fix is active in production.

### 2. High: backend silently rewrote V4 binding fields

Affected source files:
- `backend-rust/src/api/privacy.rs`
- `backend-rust/src/api/swap.rs`

Original behavior:
- Backend could overwrite `action_hash`, `root`, `nullifier`, `chain_id`, or `contract_address`
  after payload generation.
- This made bad prover output look valid locally and hid binding mistakes.

Risk:
- Production flow could submit payloads that did not faithfully match prover output.
- Once wrapper validation becomes strict, silent rewriting turns into proof breakage.

Status:
- Patched locally.
- Mismatches now fail fast with explicit errors instead of being normalized.

### 3. High: proof binding inside Noir circuits is still incomplete

Affected source files:
- `smartcontract/starknet/garaga/circuits/carel_swap/src/main.nr`
- `smartcontract/starknet/garaga/circuits/carel_limit/src/main.nr`
- `smartcontract/starknet/garaga/circuits/carel_stake/src/main.nr`

Current state:
- The circuits constrain note ownership, nullifier, root, and amount bounds.
- They do not directly constrain `recipient`, `chain_id`, `contract_address`, or full action intent.

Risk:
- Security still depends partly on trusted prover/backend behavior and contract-side checks.
- This is better than before, but not the same as a fully trustless intent-bound proof system.

Status:
- Not fully fixed.
- Requires circuit redesign and verifier regeneration for a stronger long-term model.

### 4. Medium: legacy `submit_private_*` paths remain weaker than V4 execute paths

Affected source file:
- `smartcontract/starknet/cairo/src/shielded_pool_v4.cairo`

Current state:
- `execute_private_*_v4` performs stronger checks around `chain_id`, `contract_address`,
  and recomputed action hash.
- `submit_private_swap`, `submit_private_limit`, and `submit_private_stake` are looser.

Risk:
- Any production flow that still depends on legacy submit-first semantics has a weaker security posture.

Status:
- Not removed yet.
- Should be restricted or deprecated for production relayer flows.

### 5. Medium: Shadow BTC is not production-ready

Affected source file:
- `smartcontract/starknet/garaga/circuits/shadow_btc/src/main.nr`

Current state:
- The circuit still contains TODOs for real BTC transaction/hash/header validation.

Risk:
- Native BTC hide mode should not be treated as production-safe yet.

Status:
- Not fixed.
- Keep out of production claims until a dedicated audit is complete.

## Remediations completed locally

- Fixed Honk proof encoding mismatch in backend prover plumbing.
- Added backend fail-fast checks for payload/action hash mismatches.
- Tightened V4 payload handling so swap relayer flow no longer silently rewrites critical public inputs.
- Patched generated verifier wrappers to validate `public_inputs`.

## Validation completed

- `cargo check --bin carel-backend` passed.
- `cargo test strips_leading_honk_size_prefix --manifest-path backend-rust/Cargo.toml` passed.
- Read-only `execute_private_swap_v4` validation previously succeeded after proof-prefix fix.

## Validation still pending

- Full Cairo build after verifier-wrapper patch.
- Deploy new verifier wrappers on-chain.
- Rewire `ShieldedPoolV4` to new verifier addresses.
- Smoke tests for:
  - hide swap
  - hide limit order
  - hide stake

## Production gate

Do not call this production-ready until all of the following are true:
- New verifier wrappers are deployed and wired on-chain.
- Smoke tests pass for swap, limit, and stake hide flows.
- `PRIVACY_AUTO_GARAGA_PROVER_SHA256` is configured in the real production environment.
- A follow-up decision is made on whether legacy `submit_private_*` paths stay enabled.
- A separate Shadow BTC review is completed before enabling BTC native hide mode.
