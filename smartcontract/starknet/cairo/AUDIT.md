# Smart Contract Security Audit — Findings & Fixes

**Scope:** `src/ai/` (7 contracts), `src/core/` (6 contracts), `src/governance/` (2 contracts), `src/nft/` (1 contract), `src/rewards/` (6 contracts), `src/utils/` (4 contracts), `src/trading/` (8 contracts), `src/` root (8 files)
**Status:** All findings resolved
**OZ version:** openzeppelin-cairo 0.20.0
**Audit date:** 2026-04-27

---

## Module Audit Status

### AI Module (`src/ai/`) — 2026-04-27
All 7 contracts audited. All findings resolved.
- **H-1** `submit_action_with_plan` had no caller restriction — fixed (operator-only gate)
- **H-2** `batch_submit_actions` bypassed the pause gate — fixed
- **H-3** Upgrade fee and per-action fee shared one storage slot — fixed (split into `upgrade_l2_fee`/`upgrade_l3_fee`)
- **H-4** `set_fee_config` could set fee below burn amount — fixed (invariant check added)
- **M-1** `chain_id` defaulted to 0 (cross-chain replay) — fixed (required constructor param)
- **M-2** `action_status` never written to `Pending` explicitly — fixed
- **M-3** No reentrancy protection on submit/execute paths — fixed (`ReentrancyGuardComponent`)
- **M-4** `PlanStatus::Expired` never persisted — fixed
- **M-5** `verify_and_consume` returned `false` silently on replay — fixed (now panics)
- **M-6** `is_validated` ignores `expires_at` — documented limitation (no on-chain cron)
- **M-7** `submit_validation` accepted backdated `expires_at` — fixed
- **L-1** No per-rater deduplication in reputation registry — fixed (`rater_submitted` map)

### Core Module (`src/core/`) — 2026-04-27
All 6 contracts audited. All findings resolved.
- **C-H-1** `submit_private_token_action` had no nullifier replay protection — fixed (`used_nullifiers` map)
- **C-H-2** `treasury.cairo` fund/withdraw paths had no reentrancy guard — fixed (`ReentrancyGuardComponent`)
- **C-M-1** No `remove_fee_collector` function — fixed
- **C-M-2** Swap split constraint used `==` instead of `<=` — fixed
- **C-M-3** Privacy router was immutable once set — fixed (removed immutability assertion)
- **C-L-1** All core contracts used single-step ownership — fixed (upgraded to `OwnableTwoStepImpl`)
- **C-L-2** `fee_collector.cairo` emitted no event on router/token update — fixed
- **C-L-3** `carel_protocol.cairo` used raw `owner` storage — fixed (`OwnableComponent`)

### Governance Module (`src/governance/`) — 2026-04-27
All 2 contracts audited. All findings resolved.
- **G-H-1** `governance.cairo` used raw `owner` storage — fixed (`OwnableComponent` two-step)
- **G-H-2** `timelock.cairo` used raw `admin` storage — fixed (`OwnableComponent` two-step)
- **G-M-1** No events on `propose`, `vote`, `execute`, `cancel` — fixed (full event suite added)
- **G-M-2** No nullifier replay protection in governance privacy path — fixed
- **G-M-3** No nullifier replay protection in timelock privacy path — fixed
- **G-M-4** No proposer management interface — fixed (`ITimelockAdmin` with `add_proposer`/`remove_proposer`)
- **G-L-1** No events on timelock queue/execute/cancel — fixed

### NFT Module (`src/nft/`) — 2026-04-27
1 contract audited. All findings resolved.
- **N-H-1** Used raw `admin` storage — fixed (`OwnableComponent` two-step)
- **N-M-1** No nullifier replay protection in NFT privacy path — fixed
- **N-L-1** `set_authorized_caller` emitted no event — fixed (`AuthorizedCallerUpdated`)

### Rewards Module (`src/rewards/`) — 2026-04-27
All 6 contracts audited. All findings resolved.
- **R-H-1** `point_storage.cairo` had no `admin` constructor param — fixed (added `OwnableComponent`; breaking constructor change)
- **R-H-2** `snapshot_distributor.cairo` had no `admin` constructor param — fixed (added `OwnableComponent`; breaking constructor change)
- **R-H-3** No nullifier replay protection in `submit_private_points_action` — fixed (`used_nullifiers` map)
- **R-H-4** No nullifier replay protection in `submit_private_snapshot_action` — fixed
- **R-H-5** No reentrancy on `claim_reward`/`batch_claim_rewards` — fixed (`ReentrancyGuardComponent`)
- **R-H-6** No reentrancy on `release_vested`/`emergency_release` — fixed (`ReentrancyGuardComponent`)
- **R-M-1** `min_stake` hardcoded in `snapshot_distributor.cairo` — fixed (configurable via `ISnapshotDistributorAdmin`)
- **R-M-2** No nullifier replay protection in `submit_private_rewards_action` — fixed
- **R-M-3** No nullifier replay protection in `submit_private_referral_action` — fixed
- **R-L-1** Single-step ownership across most rewards contracts — fixed (upgraded to `OwnableTwoStepImpl`)
- **R-L-2** `set_privacy_router` emitted no event — fixed (`PrivacyRouterUpdated` event added)

### Utils Module (`src/utils/`) — 2026-04-27
All 4 contracts audited. All findings resolved.
- **U-H-1** `emergency_pause.cairo` `#[storage]` block missing `pub struct Storage {}` — compile error fixed
- **U-H-2** `price_oracle.cairo` used raw `owner` storage — fixed (`OwnableComponent` two-step; breaking constructor change)
- **U-M-1** No nullifier replay protection in `submit_private_emergency_action` — fixed
- **U-M-2** No nullifier replay protection in `submit_private_multisig_action` — fixed
- **U-M-3** No nullifier replay protection in `submit_private_oracle_action` — fixed
- **U-M-4** No nullifier replay protection in `submit_private_twap_action` — fixed
- **U-L-1** `twap_oracle.cairo` used single-step `OwnableImpl` — fixed (upgraded to `OwnableTwoStepImpl`)
- **U-L-2** `multisig.cairo` emitted no lifecycle events — fixed (full event suite added)
- **U-L-3** `set_privacy_router` emitted no event in multisig/oracle — fixed (`PrivacyRouterUpdated` event)

### Trading Module (`src/trading/`) — 2026-04-27
All 8 contracts audited. All findings resolved.
- **T-H-1** Staking contracts used raw `owner` storage — fixed (`OwnableComponent` two-step; breaking constructor changes)
- **T-H-2** No reentrancy guard on stake/unstake/claim paths — fixed (`ReentrancyGuardComponent`)
- **T-H-3** `swap_aggregator.cairo` used raw `owner` storage — fixed (`OwnableComponent` two-step)
- **T-H-4** `dca_orders.cairo` used raw `owner` storage; no reentrancy on order paths — fixed
- **T-M-1** No nullifier replay protection in staking privacy dispatch — fixed (`used_nullifiers` map)
- **T-M-2** No nullifier replay protection in `submit_private_swap_agg_action` — fixed
- **T-M-3** Missing `RewardFeeUpdated`/`PrivacyRouterUpdated` events in staking contracts — fixed
- **T-M-4** Missing `KeeperUpdated` event in `dca_orders.cairo` — fixed
- **T-L-1** `privacy_intermediary.cairo` used single-step `OwnableImpl` — fixed (upgraded to two-step)
- **T-L-2** All trading contracts missing NatSpec — fixed

### src/ Root Module — 2026-04-27
8 files audited. All findings resolved.
- **S-H-1** `shielded_pool_v4.cairo` used manual `reentrancy_lock: bool` flag — fixed (`ReentrancyGuardComponent`)
- **S-H-2** `shielded_pool_v4.cairo` used raw `owner` storage — fixed (`OwnableComponent` two-step)
- **S-H-3** `shadow_bridge_receiver.cairo` used raw `owner` storage — fixed (`OwnableComponent` two-step)
- **S-H-4** `carel_stake_vault.cairo` used raw `owner` storage — fixed (`OwnableComponent` two-step)
- **S-L-1** `privacy_router_v4.cairo` used single-step `OwnableImpl` — fixed (upgraded to two-step)
- **S-L-2** All src/ root files missing NatSpec — fixed
- **S-I-1** `btc_light_client.cairo` PoW and proof circuit validation are stub TODOs — documented; not for production use until implemented

### Hide-Mode Shielded Pool
Remediation cycle closed before the current runtime profile was activated.

Closed:
- Deposit path no longer leaks `nullifier` through calldata or deposit event.
- Unlimited approval drain path removed in favor of exact approvals (`approve_exact_if_needed` / `reset_approval_if_needed` in ShieldedPoolV4).
- Zero-hash / short-proof bypass closed.
- Action hash includes deployment domain separation (contract address + chain_id in Poseidon binding).
- Reentrancy on submit/execute/exit paths guarded (now via `ReentrancyGuardComponent`).
- AI `L3` aligned to private swap/stake/limit only; bridge stays on `L2`.

Still open:
- Circuit audit mandatory for private exit token/amount binding.
- Admin operations should run behind multisig/governance for production.
- Mixing-window enforcement is primarily runtime/UX-based, not fully on-chain.

---

## Summary — AI Module (`src/ai/`)

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| H-1 | High | `submit_action_with_plan` has no caller restriction | Fixed |
| H-2 | High | `batch_submit_actions` bypasses pause gate | Fixed |
| H-3 | High | Upgrade fee and per-action fee share the same storage slot | Fixed |
| H-4 | High | `set_fee_config` can set fee below existing burn amount | Fixed |
| M-1 | Medium | `chain_id` defaults to 0 — cross-chain replay possible | Fixed |
| M-2 | Medium | `action_status` never written to `Pending` on submit | Fixed |
| M-3 | Medium | No reentrancy protection on submit/execute paths | Fixed |
| M-4 | Medium | `PlanStatus::Expired` is defined but never written | Fixed |
| M-5 | Medium | `verify_and_consume` returns `false` silently on replay | Fixed |
| M-6 | Medium | `is_validated` ignores `expires_at` | Documented |
| M-7 | Medium | `submit_validation` accepts past `expires_at` | Fixed |
| L-1 | Low | No per-rater deduplication in reputation registry | Fixed |

---

## Summary — Core Module (`src/core/`)

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| C-H-1 | High | `submit_private_token_action` has no nullifier replay protection | Fixed |
| C-H-2 | High | `treasury.cairo` fund/withdraw paths have no reentrancy guard | Fixed |
| C-M-1 | Medium | `treasury.cairo` has no `remove_fee_collector` function | Fixed |
| C-M-2 | Medium | `fee_collector.cairo` swap split constraint uses `==` instead of `<=` | Fixed |
| C-M-3 | Medium | `registry.cairo` privacy router is immutable once set | Fixed |
| C-L-1 | Low | All core contracts use single-step ownership transfer | Fixed |
| C-L-2 | Low | `fee_collector.cairo` emits no event on router/token address update | Fixed |
| C-L-3 | Low | `carel_protocol.cairo` uses raw `owner` storage instead of OZ Ownable | Fixed |

---

## Summary — Governance Module (`src/governance/`)

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| G-H-1 | High | `governance.cairo` uses raw `owner` storage — no OZ Ownable | Fixed |
| G-H-2 | High | `timelock.cairo` uses raw `admin` storage — no OZ Ownable | Fixed |
| G-M-1 | Medium | No events emitted on `propose`, `vote`, `execute`, `cancel` | Fixed |
| G-M-2 | Medium | No nullifier replay protection in `submit_private_governance_action` | Fixed |
| G-M-3 | Medium | No nullifier replay protection in `submit_private_timelock_action` | Fixed |
| G-M-4 | Medium | No proposer management interface in `timelock.cairo` | Fixed |
| G-L-1 | Low | No events on timelock queue/execute/cancel | Fixed |

---

## Summary — NFT Module (`src/nft/`)

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| N-H-1 | High | `discount_soulbound.cairo` uses raw `admin` storage — no OZ Ownable | Fixed |
| N-M-1 | Medium | No nullifier replay protection in `submit_private_nft_action` | Fixed |
| N-L-1 | Low | `set_authorized_caller` emits no event | Fixed |

---

## Summary — Rewards Module (`src/rewards/`)

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| R-H-1 | High | `point_storage.cairo` has no `admin` constructor param — role management unmovable after deploy | Fixed (Breaking) |
| R-H-2 | High | `snapshot_distributor.cairo` has no `admin` constructor param — ownership hardcoded to deployer | Fixed (Breaking) |
| R-H-3 | High | No nullifier replay protection in `submit_private_points_action` | Fixed |
| R-H-4 | High | No nullifier replay protection in `submit_private_snapshot_action` | Fixed |
| R-H-5 | High | No reentrancy protection on `claim_reward`/`batch_claim_rewards` | Fixed |
| R-H-6 | High | No reentrancy protection on `release_vested`/`emergency_release` | Fixed |
| R-M-1 | Medium | `snapshot_distributor.cairo` `min_stake` is a hardcoded constant, not configurable | Fixed |
| R-M-2 | Medium | No nullifier replay protection in `submit_private_rewards_action` | Fixed |
| R-M-3 | Medium | No nullifier replay protection in `submit_private_referral_action` | Fixed |
| R-L-1 | Low | All rewards contracts except `referral_system.cairo` used single-step `OwnableImpl` | Fixed |
| R-L-2 | Low | `set_privacy_router` in multiple rewards contracts emitted no `PrivacyRouterUpdated` event | Fixed |

---

## Summary — Utils Module (`src/utils/`)

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| U-H-1 | High | `emergency_pause.cairo` `#[storage]` block missing `pub struct Storage {}` — compile error | Fixed |
| U-H-2 | High | `price_oracle.cairo` uses raw `owner: ContractAddress` storage — no OZ Ownable | Fixed |
| U-M-1 | Medium | No nullifier replay protection in `submit_private_emergency_action` | Fixed |
| U-M-2 | Medium | No nullifier replay protection in `submit_private_multisig_action` | Fixed |
| U-M-3 | Medium | No nullifier replay protection in `submit_private_oracle_action` | Fixed |
| U-M-4 | Medium | No nullifier replay protection in `submit_private_twap_action` | Fixed |
| U-L-1 | Low | `twap_oracle.cairo` used single-step `OwnableImpl` | Fixed |
| U-L-2 | Low | `multisig.cairo` emitted no events on transaction lifecycle or owner changes | Fixed |
| U-L-3 | Low | `set_privacy_router` in `multisig.cairo` and `price_oracle.cairo` emitted no `PrivacyRouterUpdated` event | Fixed |

---

## Detailed Findings — AI Module

### H-1 — `submit_action_with_plan`: no caller restriction
**File:** `ai_plan_router.cairo`

Anyone could call `submit_action_with_plan` and execute actions under any plan, spending the plan user's tier fee allowance.

**Fix:** Added `assert!(get_caller_address() == plan.operator, "Not plan operator")` at the top of the function. Only the registered operator for a plan may submit actions under it.

---

### H-2 — `batch_submit_actions` bypasses pause gate
**File:** `ai_executor.cairo`

`batch_submit_actions` had no `assert_not_paused()` check, so the emergency pause could not stop batch submissions even when all other paths were halted.

**Fix:** Added `self.pausable.assert_not_paused()` as the first check. Also added explicit `Status::Pending` writes per action (covers M-2 for the batch path).

---

### H-3 — Upgrade fee and per-action fee share one storage slot
**File:** `ai_executor.cairo`

`level_2_price` was used as both the one-time tier upgrade cost (in `upgrade_to_l2`) and the per-action fee (in `tier_fee()`). Changing one silently changed the other.

**Fix:** Added separate `upgrade_l2_fee` and `upgrade_l3_fee` storage slots for tier purchase costs. `upgrade_to_l2`/`upgrade_to_l3` now read from these. `level_2_price`/`level_3_price` remain exclusively for per-action fees. Added `set_upgrade_fees(l2, l3)` admin function.

---

### H-4 — `set_fee_config` can set fee below burn amount
**File:** `ai_executor.cairo`

`set_fee_config` set `level_2_price`/`level_3_price` without checking that the currently stored burn amounts (`ai_l2_burn_amount`, `ai_l3_burn_amount`) would still fit within the new fees. This could result in `burn_amount > fee`, causing all `submit_action` calls to revert.

**Fix:** Added invariant checks in `set_fee_config`:
```cairo
assert!(self.ai_l2_burn_amount.read() <= level_2_price, "L2 burn exceeds fee");
assert!(self.ai_l3_burn_amount.read() <= level_3_price, "L3 burn exceeds fee");
```
`set_ai_fee_config` (which sets both fee and burn atomically) already had these checks and was not affected.

---

### M-1 — `chain_id` defaults to 0
**File:** `ai_executor.cairo`, `erc8004_identity_registry.cairo`

The constructor wrote `self.chain_id.write(0)`. Action hashes binding `chain_id = 0` are identical across any chain that also uses `chain_id = 0`, enabling cross-chain signature replay.

**Fix:** `chain_id` is now a required constructor parameter with `assert!(chain_id != 0, "Chain id required")`. `set_chain_id` also now asserts non-zero.

---

### M-2 — `action_status` never written to `Pending` on submit
**File:** `ai_executor.cairo`

`submit_action` and `batch_submit_actions` wrote the action owner and hash but never explicitly wrote `Status::Pending`. The default value of Cairo storage for an enum is the `#[default]` variant (which is `Pending`), but relying on unwritten storage made the intent implicit and unsafe against future enum reordering.

**Fix:** Added explicit `self.action_status.entry(action_id).write(Status::Pending)` in both `submit_action` and `batch_submit_actions`.

---

### M-3 — No reentrancy protection on submit/execute paths
**File:** `ai_executor.cairo`

`submit_action` and `execute_action` called external contracts (ERC20 `transfer_from`, signature verifier, privacy router) without reentrancy guards. A malicious ERC20 or verifier contract could reenter and create duplicate action IDs.

**Fix:** Added `ReentrancyGuardComponent` from OZ. Applied `self.reentrancy_guard.start()` / `self.reentrancy_guard.end()` around `submit_action`, `submit_action_from_plan`, `execute_action`, and `batch_execute_actions`.

---

### M-4 — `PlanStatus::Expired` never written
**File:** `ai_plan_router.cairo`

The `PlanStatus::Expired` variant was defined but `submit_action_with_plan` only asserted `now < expires_at` and panicked — it never persisted the `Expired` status. Off-chain indexers could not detect expired plans by reading state.

**Fix:** When `now >= plan.expires_at` is detected, the plan status is written as `Expired` before panicking:
```cairo
if now >= plan.expires_at {
    plan.status = PlanStatus::Expired;
    self.plans.entry(plan_id).write(plan);
    assert!(false, "Plan expired");
}
```

---

### M-5 — `verify_and_consume` returns `false` on replay instead of panicking
**File:** `ai_signature_verifier.cairo`

On a replayed message hash, `verify_and_consume` silently returned `false`. Callers that did not check the return value would proceed with a replayed signature undetected.

**Fix:** Changed to `assert!(!self.used_hashes.entry(key).read(), "Signature already consumed")`. The transaction now reverts immediately on replay regardless of whether the caller checked the return value.

---

### M-6 — `is_validated` ignores `expires_at` (documented limitation)
**File:** `erc8004_validation_registry.cairo`

`is_validated` returns `active_counts > 0`, which does not account for records whose `expires_at` has passed. There is no on-chain cron to decrement `active_counts` when validations expire.

**Status:** Documented as a known limitation. On-chain expiry enforcement requires callers to read `get_validation` and compare `expires_at` against `block_timestamp`. The `submit_validation` fix (M-7) ensures new records cannot be backdated. Future work: off-chain keeper that calls `revoke_validation` on expired records.

---

### M-7 — `submit_validation` accepts past `expires_at`
**File:** `erc8004_validation_registry.cairo`

A validator could submit a validation record that was already expired at submission time, making it appear in `active_counts` while being immediately stale.

**Fix:** Added `assert!(expires_at > now, "Expires in the past")` at the start of `submit_validation`.

---

### L-1 — No per-rater deduplication in reputation registry
**File:** `erc8004_reputation_registry.cairo`

An allowlisted rater could call `submit_feedback` unlimited times for the same agent, artificially inflating or deflating reputation scores.

**Fix:** Added `rater_submitted: Map<(felt252, ContractAddress), bool>` storage. Each rater may submit feedback for a given agent exactly once:
```cairo
assert!(!self.rater_submitted.entry(submitted_key).read(), "Already submitted");
self.rater_submitted.entry(submitted_key).write(true);
```

---

## Detailed Findings — Core Module

### C-H-1 — No nullifier replay protection in `submit_private_token_action`
**File:** `token.cairo`

`submit_private_token_action` forwarded nullifiers to the privacy router without recording them locally. A replayed ZK proof with the same nullifiers would be forwarded again, potentially crediting the same token action twice.

**Fix:** Added `used_nullifiers: Map<felt252, bool>` to storage. Each nullifier is asserted unused and then marked before the router call:
```cairo
assert!(!self.used_nullifiers.read(nf), "Nullifier already used");
self.used_nullifiers.write(nf, true);
```

---

### C-H-2 — No reentrancy guard on treasury fund/withdraw paths
**File:** `treasury.cairo`

`fund_rewards`, `batch_fund_rewards`, `withdraw_emergency`, and `burn_excess` called external ERC20 contracts without reentrancy protection. A malicious token could reenter and drain treasury balances.

**Fix:** Added `ReentrancyGuardComponent`. Each function is wrapped with `self.reentrancy_guard.start()` / `self.reentrancy_guard.end()`.

---

### C-M-1 — No `remove_fee_collector` function
**File:** `treasury.cairo`

Once a fee collector was added there was no way to remove it. A compromised or retired collector could not be revoked.

**Fix:** Added `remove_fee_collector(collector)` admin function with a `FeeCollectorUpdated` event.

---

### C-M-2 — Swap split constraint uses `==` instead of `<=`
**File:** `fee_collector.cairo`

`set_swap_split` asserted `lp_share + treasury_share == swap_rate`, meaning the split had to consume 100% of the swap fee. Any rounding or partial-fee design was impossible and would revert.

**Fix:** Changed to `lp_share + treasury_share <= swap_rate` to allow partial allocation.

---

### C-M-3 — Privacy router is immutable once set
**File:** `registry.cairo`

`set_privacy_router` asserted `current.is_zero()`, permanently locking the router after first deployment. Any future upgrade or migration required redeploying the registry contract.

**Fix:** Removed the immutability assertion. Router updates are now owner-gated via `assert_only_owner()`.

---

### C-L-1 — Single-step ownership transfer
**Files:** `treasury.cairo`, `fee_collector.cairo`, `registry.cairo`, `vesting_manager.cairo`, `carel_protocol.cairo`

All core contracts used OZ `OwnableImpl` (one-step `transfer_ownership`). A typo in the new owner address would permanently lock the contract.

**Fix:** Upgraded all contracts to `OwnableTwoStepImpl`, which requires the new owner to call `accept_ownership()` before the transfer completes.

---

### C-L-2 — No events on router/token address updates
**File:** `fee_collector.cairo`

`set_router` and `set_carel_token` wrote new addresses without emitting events, making configuration changes invisible to off-chain indexers.

**Fix:** Added `RouterUpdated` and `CarelTokenUpdated` events emitted on each update.

---

### C-L-3 — `carel_protocol.cairo` uses raw `owner` storage
**File:** `carel_protocol.cairo`

The contract stored `owner: ContractAddress` as a plain storage slot and performed manual `== self.owner.read()` checks instead of using OZ `OwnableComponent`.

**Fix:** Replaced with `OwnableComponent` (`OwnableTwoStepImpl`). Added input validation (`amount > 0`, non-zero addresses) to `swap` and `stake_btc`.

---

## Detailed Findings — Governance Module

### G-H-1 — `governance.cairo` uses raw `owner` storage
**File:** `governance.cairo`

The contract stored `owner: ContractAddress` as a plain storage slot. `set_privacy_router` performed a manual `get_caller_address() == self.owner.read()` check. No two-step ownership pattern; accidental transfer to a wrong address is permanent.

**Fix:** Replaced with `OwnableComponent` (`OwnableTwoStepImpl`). `set_privacy_router` now calls `self.ownable.assert_only_owner()`.

---

### G-H-2 — `timelock.cairo` uses raw `admin` storage
**File:** `timelock.cairo`

The contract stored `admin: ContractAddress` as a plain storage slot. `set_privacy_router` performed a manual `caller == self.admin.read()` check with no two-step transfer protection.

**Fix:** Replaced with `OwnableComponent` (`OwnableTwoStepImpl`). All admin checks now route through `self.ownable.assert_only_owner()` or `self.ownable.owner()`.

---

### G-M-1 — No events on governance lifecycle functions
**File:** `governance.cairo`

`propose`, `vote`, `execute`, and `cancel` mutated state without emitting events. Off-chain indexers and frontends had no reliable way to track proposal state.

**Fix:** Added `ProposalCreated`, `VoteCast`, `ProposalExecuted`, `ProposalCanceled`, and `PrivacyRouterUpdated` events emitted at each state transition.

---

### G-M-2 — No nullifier replay protection in `submit_private_governance_action`
**File:** `governance.cairo`

Nullifiers were forwarded to the privacy router without being recorded locally, allowing the same ZK proof to be replayed against the governance contract.

**Fix:** Added `used_nullifiers: Map<felt252, bool>` to storage. Each nullifier is asserted unused and marked before the router dispatch.

---

### G-M-3 — No nullifier replay protection in `submit_private_timelock_action`
**File:** `timelock.cairo`

Same class of replay vulnerability as G-M-2 on the timelock path.

**Fix:** Same pattern — `used_nullifiers: Map<felt252, bool>` with assert-then-write before router dispatch.

---

### G-M-4 — No proposer management interface
**File:** `timelock.cairo`

`proposers: Map<ContractAddress, bool>` was present in storage but there was no public function to add or remove proposers. Once deployed, only the admin could queue/execute transactions.

**Fix:** Added `ITimelockAdmin` interface with `add_proposer(proposer)`, `remove_proposer(proposer)`, and `set_min_delay(min_delay)` admin functions, each emitting the corresponding event.

---

### G-L-1 — No events on timelock queue/execute/cancel
**File:** `timelock.cairo`

`queue_transaction`, `execute_transaction`, and `cancel_transaction` mutated state without events.

**Fix:** Added `TransactionQueued`, `TransactionExecuted`, `TransactionCanceled`, `ProposerAdded`, `ProposerRemoved`, and `MinDelayUpdated` events.

---

## Detailed Findings — NFT Module

### N-H-1 — `discount_soulbound.cairo` uses raw `admin` storage
**File:** `discount_soulbound.cairo`

All admin functions (`set_current_epoch`, `set_tier_config`, `set_base_uri`, `set_tier_uri`, `set_authorized_caller`, `set_privacy_router`) performed manual `get_caller_address() == self.admin.read()` checks. No two-step transfer protection.

**Fix:** Replaced with `OwnableComponent` (`OwnableTwoStepImpl`). All admin checks now call `self.ownable.assert_only_owner()`.

---

### N-M-1 — No nullifier replay protection in `submit_private_nft_action`
**File:** `discount_soulbound.cairo`

Same class of replay vulnerability as G-M-2/G-M-3 on the NFT privacy path.

**Fix:** Added `used_nullifiers: Map<felt252, bool>` with assert-then-write before the router dispatch.

---

### N-L-1 — `set_authorized_caller` emits no event
**File:** `discount_soulbound.cairo`

Granting or revoking caller authorization produced no on-chain log, making it invisible to indexers.

**Fix:** Added `AuthorizedCallerUpdated { caller, authorized }` event emitted in `set_authorized_caller`.

---

## Detailed Findings — Rewards Module

### R-H-1 — `point_storage.cairo` has no `admin` constructor param
**File:** `point_storage.cairo`

The original constructor signature was `(signer: ContractAddress)`. The `backend_signer` was also used as the de-facto admin for `add_consumer`/`add_producer`, meaning the signer key held both operational and administrative power with no separation. Rotating the signer required a full redeploy.

**Fix:** Added `OwnableComponent` (`OwnableTwoStepImpl`) with a new first constructor param `admin`. Role management functions (`add_consumer`, `remove_consumer`, `add_producer`, `remove_producer`, `set_backend_signer`) are now owner-gated. **Constructor signature changed — breaking.**

---

### R-H-2 — `snapshot_distributor.cairo` has no `admin` constructor param
**File:** `snapshot_distributor.cairo`

The constructor used `get_caller_address()` as the implicit owner and had no explicit `admin` parameter. On Starknet, the deployer and the intended admin may differ (e.g., deploy script vs multisig). The constructor also stored all dependency addresses but provided no admin functions to update them post-deploy.

**Fix:** Added `OwnableComponent` (`OwnableTwoStepImpl`) with a new first constructor param `admin`. Added `ISnapshotDistributorAdmin` interface with `set_backend_signer`, `set_staking_contract`, `set_dev_wallet`, `set_treasury_wallet`, `set_min_stake`. **Constructor signature changed — breaking.**

---

### R-H-3 — No nullifier replay protection in `submit_private_points_action`
**File:** `point_storage.cairo`

Same class of ZK proof replay vulnerability as C-H-1. Nullifiers were forwarded to the privacy router without local deduplication.

**Fix:** Added `used_nullifiers: Map<felt252, bool>` to storage. Each nullifier is asserted unused and marked before the router dispatch.

---

### R-H-4 — No nullifier replay protection in `submit_private_snapshot_action`
**File:** `snapshot_distributor.cairo`

Same replay vulnerability on the snapshot path.

**Fix:** Same pattern — `used_nullifiers: Map<felt252, bool>` with assert-then-write before router dispatch.

---

### R-H-5 — No reentrancy guard on `claim_reward`/`batch_claim_rewards`
**File:** `snapshot_distributor.cairo`

Both reward claim functions called `IERC20.transfer`-equivalent mint paths on external token contracts without reentrancy protection. A malicious token hook could reenter and claim a reward twice.

**Fix:** Added `ReentrancyGuardComponent`. Both `claim_reward` and `batch_claim_rewards` are wrapped with `self.reentrancy_guard.start()` / `self.reentrancy_guard.end()`.

---

### R-H-6 — No reentrancy guard on `release_vested`/`emergency_release`
**File:** `rewards_escrow.cairo`

Both vesting release functions transferred tokens to external addresses without reentrancy protection.

**Fix:** Added `ReentrancyGuardComponent`. Both `release_vested` and `emergency_release` are wrapped with `self.reentrancy_guard.start()` / `self.reentrancy_guard.end()`.

---

### R-M-1 — `min_stake` hardcoded in `snapshot_distributor.cairo`
**File:** `snapshot_distributor.cairo`

`claim_reward` and `batch_claim_rewards` compared staked balance against `10_000_000_000_000_000_000_u256` (a hardcoded constant). Changing the minimum stake floor required redeploying the entire distributor.

**Fix:** Added `min_stake: u256` to storage with a `DEFAULT_MIN_STAKE` constant as the initializer value. `set_min_stake` admin function allows updating post-deploy.

---

### R-M-2 — No nullifier replay protection in `submit_private_rewards_action`
**File:** `rewards_escrow.cairo`

Same replay vulnerability on the escrow privacy path.

**Fix:** Added `used_nullifiers: Map<felt252, bool>` with assert-then-write before router dispatch.

---

### R-M-3 — No nullifier replay protection in `submit_private_referral_action`
**File:** `referral_system.cairo`

Same replay vulnerability on the referral privacy path.

**Fix:** Added `used_nullifiers: Map<felt252, bool>` with assert-then-write before router dispatch.

---

### R-L-1 — Single-step ownership across rewards contracts
**Files:** `point_storage.cairo`, `snapshot_distributor.cairo`, `rewards_escrow.cairo`, `point_token.cairo`

`point_token.cairo` used raw `admin_address: ContractAddress` storage. The others used `OwnableImpl` (one-step transfer). `referral_system.cairo` already used `OwnableTwoStepImpl` and was not affected.

**Fix:** All affected contracts upgraded to `OwnableTwoStepImpl`. `point_token.cairo` constructor param renamed from `admin_address` to `admin`.

---

### R-L-2 — Missing `PrivacyRouterUpdated` events
**Files:** `rewards_escrow.cairo`, `snapshot_distributor.cairo`, `referral_system.cairo`, `point_storage.cairo`

`set_privacy_router` wrote the new address without emitting an event, making router changes invisible to indexers.

**Fix:** Added `PrivacyRouterUpdated { router }` event emitted in each `set_privacy_router` implementation.

---

## Detailed Findings — Utils Module

### U-H-1 — `emergency_pause.cairo` Storage struct syntax error
**File:** `emergency_pause.cairo`

The `#[storage]` block was written without the required `pub struct Storage {` struct declaration wrapper, placing storage fields directly after the attribute macro. This is invalid Cairo syntax and causes a compile error — the contract cannot be built at all.

**Fix:** Added `pub struct Storage {` declaration, converting all field declarations into proper struct members.

---

### U-H-2 — `price_oracle.cairo` uses raw `owner: ContractAddress` storage
**File:** `price_oracle.cairo`

All admin-gated functions (`set_fallback_price`, `set_paused`, `set_authorized_updater`, `set_privacy_router`) performed manual `get_caller_address() == self.owner.read()` checks against a plain storage slot. No two-step transfer protection; an accidental ownership transfer is permanent.

**Fix:** Replaced with `OwnableComponent` (`OwnableTwoStepImpl`). Removed `owner: ContractAddress` from storage. Added new first constructor param `admin`. **Constructor signature changed — breaking.**

---

### U-M-1 — No nullifier replay protection in `submit_private_emergency_action`
**File:** `emergency_pause.cairo`

Same class of ZK proof replay vulnerability as other modules on the privacy dispatch path.

**Fix:** Added `used_nullifiers: Map<felt252, bool>` with assert-then-write before router dispatch.

---

### U-M-2 — No nullifier replay protection in `submit_private_multisig_action`
**File:** `multisig.cairo`

Same replay vulnerability on the multisig privacy path.

**Fix:** Added `used_nullifiers: Map<felt252, bool>` with assert-then-write before router dispatch.

---

### U-M-3 — No nullifier replay protection in `submit_private_oracle_action`
**File:** `price_oracle.cairo`

Same replay vulnerability on the oracle privacy path.

**Fix:** Added `used_nullifiers: Map<felt252, bool>` with assert-then-write before router dispatch.

---

### U-M-4 — No nullifier replay protection in `submit_private_twap_action`
**File:** `twap_oracle.cairo`

Same replay vulnerability on the TWAP privacy path.

**Fix:** Added `used_nullifiers: Map<felt252, bool>` with assert-then-write before router dispatch.

---

### U-L-1 — `twap_oracle.cairo` uses single-step `OwnableImpl`
**File:** `twap_oracle.cairo`

`OwnableImpl` was embedded instead of `OwnableTwoStepImpl`, allowing accidental single-step transfers.

**Fix:** Upgraded to `OwnableTwoStepImpl`.

---

### U-L-2 — `multisig.cairo` emits no lifecycle events
**File:** `multisig.cairo`

`submit_transaction`, `confirm_transaction`, `revoke_confirmation`, `execute_transaction`, `add_owner`, and `remove_owner` all mutated state without emitting events. Off-chain indexers had no way to track the transaction or ownership state.

**Fix:** Added `TransactionSubmitted`, `TransactionConfirmed`, `ConfirmationRevoked`, `TransactionExecuted`, `OwnerAdded`, `OwnerRemoved`, and `PrivacyRouterUpdated` events with a full `Event` enum.

---

### U-L-3 — `set_privacy_router` emits no event in `multisig.cairo` and `price_oracle.cairo`
**Files:** `multisig.cairo`, `price_oracle.cairo`

Router address updates produced no on-chain log.

**Fix:** `PrivacyRouterUpdated { router }` event added to both implementations. (Also fixed implicitly by U-L-2 for `multisig.cairo`.)

---

## OpenZeppelin Components Applied

### AI Module

| Contract | Components Added |
|----------|-----------------|
| `ai_executor.cairo` | `OwnableComponent` (two-step), `PausableComponent`, `ReentrancyGuardComponent`, `NoncesComponent` |
| `ai_plan_router.cairo` | `OwnableComponent` (two-step) |
| `ai_signature_verifier.cairo` | `OwnableComponent` (two-step) |
| `erc8004_identity_registry.cairo` | `OwnableComponent` (two-step), `NoncesComponent` |
| `erc8004_validation_registry.cairo` | `OwnableComponent` (two-step), `AccessControlComponent` (VALIDATOR_ROLE), `SRC5Component` |
| `erc8004_reputation_registry.cairo` | `OwnableComponent` (two-step), `AccessControlComponent` (RATER_ROLE), `SRC5Component` |
| `agent_registry.cairo` | `OwnableComponent` (two-step) |

### Core Module

| Contract | Components Added / Upgraded |
|----------|-----------------------------|
| `token.cairo` | `OwnableComponent` already present; nullifier replay protection added |
| `treasury.cairo` | Upgraded to `OwnableTwoStepImpl`; added `ReentrancyGuardComponent` |
| `fee_collector.cairo` | Upgraded to `OwnableTwoStepImpl` |
| `registry.cairo` | Upgraded to `OwnableTwoStepImpl` |
| `vesting_manager.cairo` | Upgraded to `OwnableTwoStepImpl` |
| `carel_protocol.cairo` | Replaced raw `owner` storage with `OwnableComponent` (two-step) |

### Governance Module

| Contract | Components Added |
|----------|-----------------|
| `governance.cairo` | `OwnableComponent` (two-step); added full event suite; nullifier replay protection |
| `timelock.cairo` | `OwnableComponent` (two-step); added `ITimelockAdmin`; added full event suite; nullifier replay protection |

### NFT Module

| Contract | Components Added |
|----------|-----------------|
| `discount_soulbound.cairo` | `OwnableComponent` (two-step); nullifier replay protection; `AuthorizedCallerUpdated` event |

### Rewards Module

| Contract | Components Added / Upgraded |
|----------|-----------------------------|
| `point_storage.cairo` | `OwnableComponent` (two-step) added — new `admin` constructor param; `add_consumer`/`add_producer`/`set_backend_signer` moved to owner-gated; nullifier replay protection; events |
| `snapshot_distributor.cairo` | `OwnableComponent` (two-step) added — new `admin` constructor param; `ReentrancyGuardComponent`; `ISnapshotDistributorAdmin`; configurable `min_stake`; nullifier replay protection; events |
| `rewards_escrow.cairo` | Upgraded to `OwnableTwoStepImpl`; `ReentrancyGuardComponent`; nullifier replay protection; `PrivacyRouterUpdated` event |
| `referral_system.cairo` | Already `OwnableTwoStepImpl`; nullifier replay protection added; `PrivacyRouterUpdated` event |
| `point_token.cairo` | Replaced raw `admin_address` storage with `OwnableComponent` (two-step) |
| `merkle_verifier.cairo` | Pure computation contract — no admin, no privacy path; NatSpec only |

### Utils Module

| Contract | Components Added / Upgraded |
|----------|-----------------------------|
| `emergency_pause.cairo` | Fixed Storage struct syntax error; nullifier replay protection; `PrivacyRouterUpdated` event |
| `multisig.cairo` | `used_nullifiers` replay protection; full event suite (`TransactionSubmitted`, `TransactionConfirmed`, `ConfirmationRevoked`, `TransactionExecuted`, `OwnerAdded`, `OwnerRemoved`, `PrivacyRouterUpdated`) |
| `price_oracle.cairo` | Replaced raw `owner` storage with `OwnableComponent` (two-step); new `admin` constructor param; nullifier replay protection; full event suite |
| `twap_oracle.cairo` | Upgraded `OwnableImpl` → `OwnableTwoStepImpl`; nullifier replay protection; `PrivacyRouterUpdated` event |

---

## OZ Component Notes

**`OwnableComponent` with `OwnableTwoStepImpl`:** In OZ Cairo 0.20.0 there is a single `OwnableComponent` that exposes two embeddable impls — `OwnableImpl` (one-step) and `OwnableTwoStepImpl` (two-step). All contracts in this audit embed `OwnableTwoStepImpl`, which replaces single-step `transfer_ownership` with a two-step accept pattern (`transfer_ownership` + `accept_ownership`) and prevents accidental transfers to wrong addresses.

**`NoncesComponent`:** Sequential per-address nonce counter managed by OZ. Replaces ad-hoc `Map<(ContractAddress, felt252), bool>` tracking. `use_checked_nonce(owner, nonce)` verifies the provided nonce matches the expected value and increments atomically — eliminates nonce reuse and out-of-order submission.

**`AccessControlComponent`:** Replaces `Map<ContractAddress, bool>` allowlists for VALIDATOR_ROLE and RATER_ROLE with OZ's standard role system. Role grants and revocations emit `RoleGranted`/`RoleRevoked` events automatically, providing an auditable access log. Requires `SRC5Component` as a dependency.

**`SRC5Component`:** Introspection component required by `AccessControlComponent`. Must be registered alongside `AccessControlComponent` in any contract that embeds it — omitting `SRC5Component` from the storage and component list causes a compile-time `HasComponent` bound failure.

**`ReentrancyGuardComponent`:** Mutex that prevents reentrant calls. Applied to all paths that transfer tokens to or from external contracts (`ai_executor.cairo`, `treasury.cairo`).

---

## Breaking Changes for Integrators

| Change | Impact |
|--------|--------|
| `AIExecutor` constructor now requires `chain_id: felt252` as third parameter | Redeploy required; pass `SN_MAIN = 0x534e5f4d41494e` or testnet chain id |
| `submit_action` nonces are now sequential (0, 1, 2, ...) via `NoncesComponent` | Off-chain signing must use `nonces(user)` to fetch expected nonce before signing |
| `upgrade_to_l2`/`upgrade_to_l3` now charge `upgrade_l2_fee`/`upgrade_l3_fee` instead of `level_2_price`/`level_3_price` | Default upgrade fees raised to 50 / 100 CAREL; call `set_upgrade_fees` to adjust |
| `verify_and_consume` panics on replay (was: returns `false`) | Callers that previously handled `false` gracefully will now revert instead — this is the desired behavior |
| `submit_action_with_plan` restricted to plan operator only | Non-operator callers will revert with `"Not plan operator"` |
| `Timelock` now requires `add_proposer` call to register proposers | No proposers are registered at deploy time; owner must call `add_proposer` to enable queuing |
| All ownership transfers are two-step across all modules | Integrators must call `accept_ownership()` after `transfer_ownership()` to complete a handover |
| `PointStorage` constructor changed from `(signer)` to `(admin, signer)` | Deployment scripts must pass admin address as first param |
| `SnapshotDistributor` constructor changed from `(token, staking, dev, treasury, signer, protocol_start)` to `(admin, token, staking, dev, treasury, signer, protocol_start)` | Deployment scripts must pass admin address as first param |
| `PointToken` constructor param renamed from `admin_address` to `admin` | Same semantics; scripts using positional args unaffected |
| `PriceOracle` constructor changed from `(pragma, chainlink, owner_address)` to `(admin, pragma, chainlink)` | Param order changed; deployment scripts must update argument order |
| `StakingWBTC` constructor changed from `(reward_token, owner, default_btc_token)` to `(owner, reward_token, default_btc_token)` | Deployment scripts must pass owner as first param |
| `StakingStablecoin` constructor changed from `(reward_token, owner)` to `(owner, reward_token)` | Deployment scripts must pass owner as first param |
| `StakingLP` constructor changed from `(reward_token, owner)` to `(owner, reward_token)` | Deployment scripts must pass owner as first param |
| `StakingCarel` constructor changed from `(token, reward_pool, admin)` to `(admin, token, reward_pool)` | Deployment scripts must pass admin as first param |

---

## Summary — Trading Module (`src/trading/`)

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| T-H-1 | High | Staking contracts use raw `owner` storage — no OZ Ownable | Fixed |
| T-H-2 | High | No reentrancy guard on stake/unstake/claim paths | Fixed |
| T-H-3 | High | `swap_aggregator.cairo` uses raw `owner` storage — no OZ Ownable | Fixed |
| T-H-4 | High | `dca_orders.cairo` uses raw `owner` storage; no reentrancy guard on order paths | Fixed |
| T-M-1 | Medium | No nullifier replay protection in staking privacy dispatch paths | Fixed |
| T-M-2 | Medium | No nullifier replay protection in `submit_private_swap_agg_action` | Fixed |
| T-M-3 | Medium | Missing `RewardFeeUpdated` and `PrivacyRouterUpdated` events in staking contracts | Fixed |
| T-M-4 | Medium | Missing `KeeperUpdated` event in `dca_orders.cairo` | Fixed |
| T-L-1 | Low | `privacy_intermediary.cairo` uses single-step `OwnableImpl` | Fixed |
| T-L-2 | Low | All trading contracts missing NatSpec (`//` comments only) | Fixed |

---

## Summary — src/ Root Module

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| S-H-1 | High | `shielded_pool_v4.cairo` uses manual `reentrancy_lock: bool` flag instead of OZ component | Fixed |
| S-H-2 | High | `shielded_pool_v4.cairo` uses raw `owner: ContractAddress` storage — no OZ Ownable | Fixed |
| S-H-3 | High | `shadow_bridge_receiver.cairo` uses raw `owner: ContractAddress` storage — no OZ Ownable | Fixed |
| S-H-4 | High | `carel_stake_vault.cairo` uses raw `owner: ContractAddress` storage — no OZ Ownable | Fixed |
| S-L-1 | Low | `privacy_router_v4.cairo` uses single-step `OwnableImpl` | Fixed |
| S-L-2 | Low | All src/ root files missing NatSpec (`//` comments only) | Fixed |
| S-I-1 | Info | `btc_light_client.cairo` PoW and proof circuit validation are stub TODOs | Documented |

---

## Detailed Findings — Trading Module

### T-H-1 — Staking contracts use raw `owner` storage
**Files:** `staking_carel.cairo`, `staking_stablecoin.cairo`, `staking_wbtc.cairo`, `staking_lp.cairo`

All four staking contracts stored `owner: ContractAddress` as a plain storage slot and performed manual `get_caller_address() == self.owner.read()` checks. No two-step transfer protection; an accidental ownership transfer to a wrong address is permanent.

**Fix:** Replaced with `OwnableComponent` (`OwnableTwoStepImpl`) across all four contracts. Removed `owner: ContractAddress` from storage. Added `OwnableInternalImpl` for internal initializer calls. Constructor parameter order standardized: `owner` is always first. **Constructor signature changed — breaking for all four contracts.**

---

### T-H-2 — No reentrancy guard on stake/unstake/claim paths
**Files:** `staking_carel.cairo`, `staking_stablecoin.cairo`, `staking_wbtc.cairo`, `staking_lp.cairo`

`stake`, `unstake`, and `claim_rewards` (or equivalent) in all staking contracts called external ERC20 contracts (`transfer_from`, `transfer`, `mint`) without reentrancy protection. A malicious ERC20 token hook or reward token could reenter and double-credit stakes or drain rewards.

**Fix:** Added `ReentrancyGuardComponent` to all four staking contracts. Each token-transfer path is wrapped with `self.reentrancy_guard.start()` / `self.reentrancy_guard.end()`.

---

### T-H-3 — `swap_aggregator.cairo` uses raw `owner` storage
**File:** `swap_aggregator.cairo`

Admin functions (`register_dex`, `set_fee_config`, `set_privacy_router`) performed manual `get_caller_address() == self.owner.read()` checks against a plain storage slot with no two-step transfer protection.

**Fix:** Replaced with `OwnableComponent` (`OwnableTwoStepImpl`). Removed `owner: ContractAddress` from storage. Constructor is not breaking (`owner` was already the first param).

---

### T-H-4 — `dca_orders.cairo` uses raw `owner` storage; no reentrancy guard
**File:** `dca_orders.cairo`

`dca_orders.cairo` (the `LimitOrderBook`) stored `owner: ContractAddress` as a plain slot. Additionally, `create_limit_order`, `cancel_limit_order`, and `execute_limit_order` called external ERC20 contracts without reentrancy protection.

**Fix:** Replaced with `OwnableComponent` (`OwnableTwoStepImpl`). Added `ReentrancyGuardComponent` on all three order lifecycle functions. Constructor is not breaking (`owner` was already the first param).

---

### T-M-1 — No nullifier replay protection in staking privacy dispatch
**Files:** `staking_carel.cairo`, `staking_stablecoin.cairo`, `staking_wbtc.cairo`, `staking_lp.cairo`

Each staking contract had a `submit_private_staking_action` (or equivalent) function that forwarded nullifiers to the privacy router without recording them locally. A replayed ZK proof with the same nullifiers would be forwarded again.

**Fix:** Added `used_nullifiers: Map<felt252, bool>` to each staking contract's storage. Each nullifier is asserted unused and then marked before the router dispatch loop.

---

### T-M-2 — No nullifier replay protection in `submit_private_swap_agg_action`
**File:** `swap_aggregator.cairo`

Same class of ZK proof replay vulnerability as T-M-1 on the swap aggregator privacy path.

**Fix:** Added `used_nullifiers: Map<felt252, bool>` with assert-then-write loop before router dispatch.

---

### T-M-3 — Missing `RewardFeeUpdated` and `PrivacyRouterUpdated` events in staking contracts
**Files:** `staking_wbtc.cairo`, `staking_stablecoin.cairo`, `staking_lp.cairo`, `staking_carel.cairo`

`set_reward_fee` and `set_privacy_router` mutated fee BPS and router addresses without emitting events, making configuration changes invisible to off-chain indexers.

**Fix:** Added `RewardFeeUpdated { fee_bps }` and `PrivacyRouterUpdated { router }` events emitted in each respective setter. `swap_aggregator.cairo` also received `DexRegistered` and `FeeConfigUpdated` events.

---

### T-M-4 — Missing `KeeperUpdated` event in `dca_orders.cairo`
**File:** `dca_orders.cairo`

`set_keeper` (or `authorize_keeper`) mutated the keeper authorization map without emitting an event, making keeper grants invisible to indexers.

**Fix:** Added `KeeperUpdated { keeper, authorized }` event emitted in the authorization setter.

---

### T-L-1 — `privacy_intermediary.cairo` uses single-step `OwnableImpl`
**File:** `privacy_intermediary.cairo`

`OwnableImpl` (one-step `transfer_ownership`) was embedded. A typo in the new owner address would permanently lock admin access.

**Fix:** Upgraded to `OwnableTwoStepImpl`. Requires `accept_ownership()` call to complete transfer.

---

### T-L-2 — All trading contracts missing NatSpec
**Files:** All 8 contracts in `src/trading/`

All functions, interfaces, events, and storage structs used `//` inline comments only. No `/// @notice`, `/// @param`, `/// @return`, or `/// @title` NatSpec, making the ABI undocumented for external consumers and auditors.

**Fix:** Converted all `//` comments to full NatSpec (`/// @notice`, `/// @param`, `/// @return`, `/// @dev`, `/// @inheritdoc`, `/// @title`) across all 8 trading contracts. No behavioral changes.

---

## Detailed Findings — src/ Root Module

### S-H-1 — `shielded_pool_v4.cairo` manual reentrancy flag
**File:** `shielded_pool_v4.cairo`

The contract used a hand-rolled `reentrancy_lock: bool` storage flag with custom `enter_reentrancy_guard` / `exit_reentrancy_guard` helpers. A bug in the manual pattern (e.g., missing `exit` on a revert path) would permanently lock the contract. The pattern is also not audited to OZ standards.

**Fix:** Replaced `reentrancy_lock: bool` from storage and the two helper functions with `ReentrancyGuardComponent`. All guarded paths call `self.reentrancy_guard.start()` / `self.reentrancy_guard.end()`. The component uses OZ's audited mutex implementation.

---

### S-H-2 — `shielded_pool_v4.cairo` uses raw `owner` storage
**File:** `shielded_pool_v4.cairo`

`owner: ContractAddress` was stored as a plain slot. `assert_owner` and `assert_relayer_or_owner` performed manual equality checks. No two-step transfer protection — the most security-critical contract in the system had the weakest ownership model.

**Fix:** Replaced with `OwnableComponent` (`OwnableTwoStepImpl`). Removed `owner: ContractAddress` from storage. `assert_owner` and `assert_relayer_or_owner` now read from `self.ownable.owner()`. Constructor is not breaking.

---

### S-H-3 — `shadow_bridge_receiver.cairo` uses raw `owner` storage
**File:** `shadow_bridge_receiver.cairo`

`owner: ContractAddress` was stored as a plain slot. All admin functions (`set_operator`, `set_pool`, `set_token`, `pause`, `unpause`) and the internal helpers (`assert_owner`, `assert_operator_or_owner`) performed manual equality checks.

**Fix:** Replaced with `OwnableComponent` (`OwnableTwoStepImpl`). Removed `owner` from storage. All admin checks now route through `self.ownable.assert_only_owner()` or `self.ownable.owner()`. Constructor is not breaking.

---

### S-H-4 — `carel_stake_vault.cairo` uses raw `owner` storage
**File:** `carel_stake_vault.cairo`

`owner: ContractAddress` was stored as a plain slot. The single admin function (`set_external_adapter`) performed a manual equality check.

**Fix:** Replaced with `OwnableComponent` (`OwnableTwoStepImpl`). Removed `owner` from storage. `set_external_adapter` now calls `self.ownable.assert_only_owner()`. Constructor is not breaking.

---

### S-L-1 — `privacy_router_v4.cairo` uses single-step `OwnableImpl`
**File:** `privacy_router_v4.cairo`

`OwnableImpl` (one-step) was embedded. The privacy router controls which `ShieldedPoolV4` address is used for all V4 private actions — single-step ownership transfer is a risk for this sensitive role.

**Fix:** Upgraded to `OwnableTwoStepImpl`. Requires `accept_ownership()` call to complete transfer.

---

### S-L-2 — All src/ root files missing NatSpec
**Files:** `shielded_pool_v4.cairo`, `shadow_bridge_receiver.cairo`, `carel_stake_vault.cairo`, `privacy_router_v4.cairo`, `btc_light_client.cairo`, `privacy_router.cairo`, `privacy_action_types.cairo`, `garaga_verifiers.cairo`, `lib.cairo`, `interfaces.cairo`

All comments used `//` inline style. No `/// @notice`, `/// @param`, `/// @return`, or `/// @title` NatSpec.

**Fix:** Added full NatSpec to all listed files. Key external functions in `shielded_pool_v4.cairo` (1131 lines) received targeted `/// @notice` and `/// @dev` comments on each entrypoint. No behavioral changes.

---

### S-I-1 — `btc_light_client.cairo` PoW and proof circuit validation are stub TODOs
**File:** `btc_light_client.cairo`

`store_header` accepts any header without verifying PoW or chain linkage. `verify_btc_zk_proof` emits `ProofVerified` without actually verifying the proof. Both functions have `// TODO` comments noting this.

**Status:** Documented informational. This contract is a stub/scaffold. No security claims should be made for BTC light client functionality until the TODO items are implemented and audited. Do not use in production without completing PoW validation and circuit-proof verification.

---

## OpenZeppelin Components Applied (continued)

### Trading Module

| Contract | Components Added / Upgraded |
|----------|-----------------------------|
| `staking_carel.cairo` | `OwnableComponent` (two-step) — replaced raw `owner`; `ReentrancyGuardComponent`; nullifier replay protection |
| `staking_stablecoin.cairo` | `OwnableComponent` (two-step) — replaced raw `owner`; `ReentrancyGuardComponent`; nullifier replay protection |
| `staking_wbtc.cairo` | `OwnableComponent` (two-step) — replaced raw `owner`; `ReentrancyGuardComponent`; nullifier replay protection |
| `staking_lp.cairo` | `OwnableComponent` (two-step) — replaced raw `owner`; `ReentrancyGuardComponent`; nullifier replay protection |
| `swap_aggregator.cairo` | `OwnableComponent` (two-step) — replaced raw `owner`; nullifier replay protection; event suite added |
| `dca_orders.cairo` | `OwnableComponent` (two-step) — replaced raw `owner`; `ReentrancyGuardComponent`; `KeeperUpdated` event |
| `privacy_intermediary.cairo` | `OwnableComponent` upgraded from one-step to `OwnableTwoStepImpl`; NatSpec added |
| `battleship_garaga.cairo` | No behavioral changes — NatSpec only (ZK game, no admin paths) |

### src/ Root Module

| Contract | Components Added / Upgraded |
|----------|-----------------------------|
| `shielded_pool_v4.cairo` | `OwnableComponent` (two-step) — replaced raw `owner`; `ReentrancyGuardComponent` — replaced manual `reentrancy_lock` bool; NatSpec added |
| `shadow_bridge_receiver.cairo` | `OwnableComponent` (two-step) — replaced raw `owner`; NatSpec added |
| `carel_stake_vault.cairo` | `OwnableComponent` (two-step) — replaced raw `owner`; NatSpec added |
| `privacy_router_v4.cairo` | `OwnableComponent` upgraded from one-step to `OwnableTwoStepImpl`; NatSpec added |
| `btc_light_client.cairo` | No admin components (stub contract); NatSpec added; TODO items documented |
| `privacy_router.cairo` | Interface file — NatSpec added; no components |
| `privacy_action_types.cairo` | Constants module — NatSpec added; no components |
| `garaga_verifiers.cairo` | Module re-export file — NatSpec added; no components |
