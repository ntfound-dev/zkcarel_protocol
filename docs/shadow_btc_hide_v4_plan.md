# Shadow BTC Hide Mode (V4) Plan

## Goals
- Provide a one-call Hide flow using `ShieldedPoolV4` where the proof is verified inside the `execute_private_*_v4` entrypoint.
- Keep the “Normal Bridge” path (Garden API) unchanged for non-hide mode.
- Introduce a Carel-operated bridge provider for Hide mode that can send/mint WBTC directly to a contract receiver.
- Ensure all Noir circuits (swap, limit, stake, shadow_btc) share a consistent public input layout.
- Minimize on-chain disclosure while maintaining anti-double-spend guarantees.

## Non-Goals
- Remove `nullifier` from calldata or storage. It must remain public for anti-double-spend.
- Build a fully trustless BTC bridge. Hide mode assumes Carel custody/mint flows.

## High-Level Architecture
Normal Bridge (Garden)
- User sends BTC.
- Garden mints WBTC to user wallet.
- Standard swap/stake/limit flows continue as-is.

Hide Bridge (Carel Provider)
- User sends BTC to Carel custody.
- Carel mints WBTC on Starknet to a receiver contract.
- Receiver deposits into `ShieldedPoolV4` as a note.
- User spends note via proof-based `execute_private_*_v4`.

## One-Call Hide Flow (Swap/Limit/Stake)
```
[User / Frontend]
  -> choose swap/limit/stake + note
[Backend]
  -> compute action_hash
  -> build prover payload
[Noir Circuit]
  -> generate proof + public_inputs
[Garaga Prover]
  -> output proof + public_inputs
[Backend -> Starknet]
  -> execute_private_*_v4(root, nullifier, proof, public_inputs, action params)
[ShieldedPoolV4]
  -> verify proof
  -> validate root/nullifier/action_hash
  -> execute action + mark nullifier used
```

## Per-Flow Details

Swap (Hide V4)
- Action hash binds: target, selector, calldata, approval_token, approval_amount, payout_token, min_payout.
- Execute call: `execute_private_swap_v4(root, nullifier, proof, public_inputs, target, selector, calldata, approval_token, approval_amount, payout_token, min_payout)`.
- Proof public inputs must include `action_hash` that matches the above binding.

Limit Order (Hide V4)
- Action hash binds: target, selector, calldata, approval_token, approval_amount, payout_token, min_payout.
- Execute call: `execute_private_limit_v4(root, nullifier, proof, public_inputs, target, selector, calldata, approval_token, approval_amount, payout_token, min_payout)`.
- Proof public inputs must include the limit-order `action_hash`.

Stake (Hide V4)
- Two variants: internal and external.
- Action hash binds: target, selector, calldata, approval_token, approval_amount, payout_token, min_payout.
- Execute calls:
  - `execute_private_stake_internal_v4(root, nullifier, proof, public_inputs, target, selector, calldata, approval_token, approval_amount, payout_token, min_payout)`
  - `execute_private_stake_external_v4(root, nullifier, proof, public_inputs, target, selector, calldata, approval_token, approval_amount, payout_token, min_payout)`
- Proof public inputs must include the stake `action_hash`.

## On-Chain Visibility (Expected)
- Visible in calldata: `root`, `nullifier`, `proof`, `public_inputs`, action params.
- Visible in events: `PrivateActionExecuted` and `NullifierUsed`.
- The key privacy property is unlinkability between note deposit and action execution.

## Public Inputs Layout (V4)
Required public inputs (order matters):
1. `root`
2. `nullifier`
3. `action_hash`
4. `recipient` (optional but recommended)
5. `chain_id`
6. `contract_address`
7. `commitment` (optional slot for Garaga dynamic binding)

Recommended env indexes:
- `GARAGA_ROOT_PUBLIC_INPUT_INDEX=0`
- `GARAGA_NULLIFIER_PUBLIC_INPUT_INDEX=1`
- `GARAGA_INTENT_HASH_PUBLIC_INPUT_INDEX=2` (used for action_hash in V3, reuse for V4)
- `GARAGA_COMMITMENT_PUBLIC_INPUT_INDEX=6`

## Contract Plan

### ShieldedPoolV4 (new design)
Add or update the following:
- `deposit_fixed_v4` should transfer tokens in (like V3) and store note metadata.
- `get_note_deposit_timestamp` for mixing-window checks.
- `fixed_amount` and `set_asset_rule` for note denomination rules.
- `preview_*_action_hash` and `_compute_action_hash` using the V3 hashing spec.
- `execute_private_swap_v4` must accept `root`, `nullifier`, `proof`, `public_inputs`, and action params.
- `execute_private_limit_v4` same structure.
- `execute_private_stake_internal_v4` and `execute_private_stake_external_v4` same structure.
- Reentrancy guard and allowance reset logic borrowed from V3.

Hash binding should follow V3’s `_compute_action_hash`:
- bind `contract_address`, `chain_id`, `action_type`, `target`, `selector`, `calldata_hash`, `approval_token`, `approval_amount`, `payout_token`, `min_payout`.

### ShadowBridgeReceiver (new contract)
Responsibilities:
- Accept WBTC minted/transferred by Carel bridge provider.
- Approve `ShieldedPoolV4` for exact amount.
- Call `deposit_fixed_v4` with `note_commitment` and metadata.
Implementation target:
- `smartcontract/starknet/cairo/src/shadow_bridge_receiver.cairo`
- Entrypoint: `deposit_shadow_note(denom_id, note_commitment, ipfs_cid)`

Access control:
- Only Carel operator can call the deposit function.
- Optional: allowlist `token` and `pool` addresses.

## Backend Plan

Config
- `HIDE_BALANCE_EXECUTOR_KIND=shielded_pool_v4`
- `HIDE_BALANCE_POOL_VERSION_DEFAULT=v4`

Prover binding
- Align `GARAGA_*_PUBLIC_INPUT_INDEX` with the V4 layout.
- Ensure dynamic binding does not overwrite `root` or `action_hash`.

Swap/Limit/Stake
- Remove submit step in V4 path.
- Build a single `execute_private_*_v4` call that includes proof + public_inputs.
- Keep V3 path unchanged for legacy.

Shadow BTC
- Add a new backend flow for hide bridge.
- Generate note commitment and action_hash for bridge.
- Trigger receiver deposit and return note to user.

## Frontend Plan

- Set `NEXT_PUBLIC_HIDE_BALANCE_EXECUTOR_KIND=shielded_pool_v4`.
- Split UI into:
  - “Deposit note” step.
  - “Execute swap/stake/limit” step.
- Hide swap/stake/limit uses V4 one-call execution.
- Bridge UI:
  - Normal (Garden): direct to wallet.
  - Hide (Carel): note-based, pool destination.

## Noir Circuits Plan

- Update `carel_swap`, `carel_limit`, `carel_stake`, `shadow_btc` to share the same public input order.
- Ensure `action_hash` is computed exactly like the contract.
- Include `contract_address` and `chain_id` in the public inputs to prevent cross-chain replay.

## Risks
- Provider must be able to mint/transfer WBTC to a contract address.
- Incorrect public input order will break proof verification.
- Action hash mismatch will cause `execute_private_*_v4` to revert.

## Open Questions
- Final choice of `recipient` inclusion in public inputs for V4.
- Exact `note_commitment` derivation for shadow_btc flow.
- Whether to keep `submit_private_*` as optional fallback in V4 (recommended: no).

## Milestones
1. Finalize V4 public input layout.
2. Update Noir circuits to match layout.
3. Implement ShieldedPoolV4 action execution + deposit logic.
4. Implement ShadowBridgeReceiver contract.
5. Update backend V4 call builders and env.
6. Update frontend flows and UI.
7. End-to-end test on testnet.

# Carel DEX Reference (Starknet Contracts Base)

## Purpose
This section maps the reference DEX implementation under:
`smartcontract/starknet/referensi/starknet-contracts-main/src`
into a production-ready Carel DEX plan. The goal is to reuse proven CLMM (concentrated liquidity)
components while keeping integration points clear for Carel’s Hide Mode (Garaga/Noir, V4).

## Reference Layout Summary

Core protocol
- `core.cairo` — AMM core: pools, swap, fees, ticks, liquidity, protocol fee accounting.
- `router.cairo` — multi-hop swap + quotes, callback handling.
- `positions.cairo` — LP positions + NFT ownership + hooks to extensions.
- `owned_nft.cairo` — NFT contract for liquidity positions.

Shared components
- `components/owned.cairo` — ownership + access control.
- `components/upgradeable.cairo` — upgrade pattern.
- `components/clear.cairo` — sweep token balances.
- `components/expires.cairo` — deadline checks.
- `components/util.cairo` — callback serialization + core lock helpers.

Extensions (optional)
- `extensions/limit_orders.cairo` — limit order extension.
- `extensions/twamm.cairo` — TWAMM extension.
- `extensions/oracle.cairo` — oracle interface.

Interfaces
- `interfaces/core.cairo` — ICore + swap + lock + forwardee APIs.
- `interfaces/router.cairo` — IRouter swap + quote APIs.
- `interfaces/positions.cairo` — IPositions + NFT positioning.
- `interfaces/erc20.cairo`, `interfaces/erc721.cairo`, `interfaces/src5.cairo`.
- `interfaces/extensions/*` — extension APIs.

Lens (read-only)
- `lens/price_fetcher.cairo` — TWAP and price fetcher.
- `lens/token_registry.cairo` — token metadata registry.

Math + Types
- `math/*` — swap math, fee, tick logic, mul/div, sqrt ratio.
- `types/*` — PoolKey, Bounds, Delta, i129, PoolPrice, Position.

## Production-Ready Minimal Stack (Recommended)
Start with these for a stable DEX core:
1. `core.cairo`
2. `router.cairo`
3. `positions.cairo`
4. `owned_nft.cairo`
5. Required `components/*`, `math/*`, `types/*`, and `interfaces/*`

Then add optional features:
- Limit orders: `extensions/limit_orders.cairo` + `interfaces/extensions/limit_orders.cairo`
- TWAMM: `extensions/twamm.cairo` + `interfaces/extensions/twamm.cairo`
- Oracle + Lens: `extensions/oracle.cairo`, `lens/price_fetcher.cairo`

## Suggested Carel DEX Integration Plan

### Phase 1: Core DEX
- Deploy core, router, positions, owned_nft.
- Ensure swaps and LP positions work end-to-end.
- Freeze the swap entrypoints you want to use in Hide Mode (V4).

### Phase 2: Extensions (Optional)
- Add limit orders or TWAMM if required.
- Wire `positions.cairo` to extension contracts.

### Phase 3: Hide Mode (Garaga/Noir, V4)
- Bind Hide action_hash to specific DEX router calls.
- Ensure calldata layout is deterministic.
- Use `execute_private_*_v4` to call the router swap entrypoint.

## Action Hash Binding (Hide Mode)
When Carel uses V4 Hide Mode, the action_hash should bind to:
- `target` (router/core)
- `entrypoint_selector`
- `calldata_hash`
- `approval_token` + `approval_amount`
- `payout_token` + `min_payout`
- `chain_id` + `contract_address`

This binding ensures:
- Proof matches the exact DEX action executed.
- Relayer cannot modify calldata without breaking proof.

## Notes for Solo Development
- Focus on swap first. Once swap is stable, add limit/stake circuits.
- Keep Noir public inputs aligned with the V4 contract layout.
- Avoid changing router entrypoints after circuits are generated.

## Open Decisions
- Whether to add limit orders or TWAMM in MVP.
- Whether to allow only core/router calls inside Hide Mode.
- Which router entrypoint becomes the canonical Hide target.
