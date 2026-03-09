# private_executor_lite (Hide Mode)

This package is the default hide-mode execution path for the CAREL MVP.
It is optimized for fast iteration without heavy real-verifier compilation.

## Table of Contents
- [Scope](#scope)
- [Runtime Status](#runtime-status)
- [Contracts](#contracts)
- [Hide Mode Flow (Summary)](#hide-mode-flow-summary)
- [Build and Test](#build-and-test)
- [Deploy](#deploy)
- [Environment Integration](#environment-integration)
- [Production Checklist](#production-checklist)
- [Current Constraints](#current-constraints)

## Scope
- Target: Starknet Sepolia (MVP testnet).
- Execution path: relayer + `ShieldedPoolV3` as the current baseline, with `ShieldedPoolV2` kept for legacy compatibility.
- Proof payload can be real or mock/dev depending on backend environment settings.

## Runtime Status
- Active hide mode baseline uses `ShieldedPoolV3`.
- `ShieldedPoolV2` is retained for legacy note redemption (`v2 redeem-only` migration window).
- `PrivateActionExecutor` remains for older deployment compatibility.
- Backend source-of-truth mode: `HIDE_BALANCE_EXECUTOR_KIND=shielded_pool_v3`.
- Frontend source-of-truth mode: `NEXT_PUBLIC_HIDE_BALANCE_EXECUTOR_KIND=shielded_pool_v3`.
- Latest local test snapshot: `47/47` passing (`asdf exec snforge test`).

## Security Remediation Summary
Internal audit on `ShieldedPoolV3` found multiple critical privacy and fund-safety issues in the earlier design, then closed them in the current baseline.

Closed or mitigated in the current baseline:
- Deposit no longer exposes `nullifier` in calldata or deposit event.
- Exact approval replaced unlimited approval, preventing pool-drain via arbitrary target allowance.
- Proof submission rejects legacy short outputs and zero-hash bypass paths.
- Action/exit hashing is domain-separated by contract address and `chain_id`.
- Submit, execute, and exit paths are reentrancy-guarded.
- Pending actions can be cancelled safely and replay-by-other-submitter after cancel is blocked.
- Same-token payout accounting no longer breaks approve-then-pull integrations.
- Direct public note withdrawal remains disabled; user exit path is `private_exit_v3(...)`.
- Verifier rotation is delayed by timelock instead of instant admin swap.

Still treated as production hardening items:
- `private_exit_v3` still depends on circuit/verifier correctness to bind `token` and `amount`.
- `admin` should be a multisig or governance contract, not a single EOA.
- Mixing-window UX exists in FE/BE, but minimum note age is not enforced by contract state alone.

## Contracts
| Contract | Path | Notes |
| --- | --- | --- |
| `ShieldedPoolV3` | `src/shielded_pool_v3.cairo` | Current baseline contract (nullifier-based flow, action-hash binding, recipient bound from proof output). Supports private swap/limit/stake submit+execute path. |
| `ShieldedPoolV2` | `src/shielded_pool_v2.cairo` | Legacy contract retained during migration. |
| `PrivateActionExecutor` | `src/private_action_executor.cairo` | Early-generation executor for legacy compatibility. |

## Hide Mode Flow (Summary)
1. Admin sets root and asset rules via `set_root` + `set_asset_rule(token, denom_id, amount)`.
2. User deposits a note via `deposit_fixed_v3(token, denom_id, note_commitment)`.
3. User submits private intent keyed by nullifier:
   - `submit_private_swap(root, nullifier, proof)`
   - `submit_private_limit(root, nullifier, proof)`
   - `submit_private_stake(root, nullifier, proof)`
4. Relayer/admin executes the private action path:
   - `execute_private_swap_with_payout(...)`
   - `execute_private_limit_with_payout(...)`
   - `execute_private_stake_with_payout(...)`
5. If execution has not happened yet, the original submitter can clear a stuck action:
   - `cancel_private_action(nullifier)`
6. If the user wants funds back without exposing deposit linkage, redeem through:
   - `private_exit_v3(root, nullifier, proof, token, amount, recipient)`
7. During incident response, admin can stop user-facing flows:
   - `pause()`
   - `unpause()`

## Build and Test
From repository root:
```bash
bash smartcontract/scripts/test_private_executor_lite.sh
```

Or from package directory:
```bash
cd smartcontract/private_executor_lite
asdf exec snforge test
```

## Deploy
```bash
cd smartcontract/private_executor_lite

# declare
asdf exec sncast --wait -a sepolia declare --contract-name ShieldedPoolV3 --url <RPC>

# deploy (use class hash from declare)
asdf exec sncast --wait -a sepolia deploy \
  --class-hash <CLASS_HASH> \
  --constructor-calldata <ADMIN> <VERIFIER> <RELAYER> \
  --url <RPC>
```

If legacy executor is needed:
```bash
asdf exec sncast --wait -a sepolia declare --contract-name PrivateActionExecutor --url <RPC>
asdf exec sncast --wait -a sepolia deploy \
  --class-hash <CLASS_HASH> \
  --constructor-calldata <ADMIN> <VERIFIER> <RELAYER> <SWAP_TARGET> <LIMIT_TARGET> <STAKING_TARGET> \
  --url <RPC>
```

## Environment Integration
Ensure these keys are present and aligned:
- `PRIVATE_ACTION_EXECUTOR_ADDRESS=<ShieldedPoolV3 runtime address>`
- `HIDE_BALANCE_EXECUTOR_KIND=shielded_pool_v3`
- `HIDE_BALANCE_POOL_VERSION_DEFAULT=v3`
- `HIDE_BALANCE_V2_REDEEM_ONLY=true`
- `HIDE_BALANCE_MIN_NOTE_AGE_SECS=3600`
- `GARAGA_VERIFIER_ADDRESS` (or mock verifier for dev/testnet)

Current runtime profile example:
- `PRIVATE_ACTION_EXECUTOR_ADDRESS=0x01f7f3bcdfd94d0b28dd658882bef53787b4e9d40a6aa4ced65440ab76e0e191`

## Production Checklist
- Read [shielded_pool_v3_production_checklist.md](/mnt/c/Users/frend/zkcare_protocol/smartcontract/private_executor_lite/docs/shielded_pool_v3_production_checklist.md) before promoting beyond testnet.
- Treat `admin` as a multisig or governance contract, not a personal EOA.
- Keep `relayer` operationally separate from `admin`.
- Do not rely on contract-only review for `private_exit_v3`; circuit review is mandatory.

## Current Constraints
- This package does not include the heavy real BLS verifier implementation.
- Proof format must remain aligned with backend payload generation (real/mock/dev).
- Hide mode reduces linkability but public chain metadata remains visible.
