# private_executor_lite (Hide Mode)

Package ini adalah jalur default hide mode di MVP CAREL. Tujuannya iterasi cepat tanpa compile verifier Garaga real yang berat.

## Table of Contents
- Scope
- Status Pemakaian
- Contracts
- Hide Mode Flow (Ringkas)
- Build and Test
- Deploy
- Env Integration
- Current Constraints

## Scope
- Target: Starknet Sepolia (MVP testnet).
- Jalur eksekusi: relayer + `ShieldedPoolV3` (default baru), dengan `ShieldedPoolV2` legacy.
- Proof bisa real atau mock/dev sesuai env backend.

## Status Pemakaian
- Dipakai aktif untuk hide mode dengan `ShieldedPoolV3`.
- `ShieldedPoolV2` dipertahankan sementara untuk redeem note lama (dual-pool migration).
- `PrivateActionExecutor` tetap ada untuk kompatibilitas flow lama.
- Source-of-truth mode di env (backend): `HIDE_BALANCE_EXECUTOR_KIND=shielded_pool_v3`.
- Source-of-truth mode di env (frontend): `NEXT_PUBLIC_HIDE_BALANCE_EXECUTOR_KIND=shielded_pool_v3`.
- Status test lokal terakhir: `19/19` passing (`asdf exec snforge test`).

## Contracts
| Contract | Path | Notes |
| --- | --- | --- |
| `ShieldedPoolV3` | `src/shielded_pool_v3.cairo` | Kontrak utama baru (nullifier-based, action_hash binding, recipient dari proof output). Mendukung swap/limit/stake private submit+execute path. |
| `ShieldedPoolV2` | `src/shielded_pool_v2.cairo` | Kontrak utama hide mode. Menyimpan note, nullifier, commitment, action hash binding. Mendukung single dan batch execution via relayer. |
| `PrivateActionExecutor` | `src/private_action_executor.cairo` | Executor generasi awal untuk kompatibilitas deployment lama. |

## Hide Mode Flow (Ringkas)
1. Admin set root dan aturan aset lewat `set_root` + `set_asset_rule(token, denom_id, amount)`.
2. User deposit note lewat `deposit_fixed_v3(token, denom_id, note_commitment)`.
3. User submit intent privat berbasis nullifier:
   - `submit_private_swap(root, nullifier, proof)`
   - `submit_private_limit(root, nullifier, proof)`
   - `submit_private_stake(root, nullifier, proof)`
4. Relayer/admin eksekusi aksi privat tanpa `recipient` bebas:
   - `execute_private_swap_with_payout(...)`
   - `execute_private_limit_with_payout(...)`
   - `execute_private_stake_with_payout(...)`

## Build and Test
Dari root repo:
```bash
bash smartcontract/scripts/test_private_executor_lite.sh
```

Atau dari folder package:
```bash
cd smartcontract/private_executor_lite
asdf exec snforge test
```

## Deploy
```bash
cd smartcontract/private_executor_lite

# declare
asdf exec sncast --wait -a sepolia declare --contract-name ShieldedPoolV3 --url <RPC>

# deploy (pakai class hash hasil declare)
asdf exec sncast --wait -a sepolia deploy \
  --class-hash <CLASS_HASH> \
  --constructor-calldata <ADMIN> <VERIFIER> <RELAYER> \
  --url <RPC>
```

Jika butuh executor lama:
```bash
asdf exec sncast --wait -a sepolia declare --contract-name PrivateActionExecutor --url <RPC>
asdf exec sncast --wait -a sepolia deploy \
  --class-hash <CLASS_HASH> \
  --constructor-calldata <ADMIN> <VERIFIER> <RELAYER> <SWAP_TARGET> <LIMIT_TARGET> <STAKING_TARGET> \
  --url <RPC>
```

## Env Integration
Pastikan env terisi dan konsisten:
- `PRIVATE_ACTION_EXECUTOR_ADDRESS=<ShieldedPoolV3>`
- `HIDE_BALANCE_EXECUTOR_KIND=shielded_pool_v3`
- `HIDE_BALANCE_POOL_VERSION_DEFAULT=v3`
- `HIDE_BALANCE_V2_REDEEM_ONLY=true`
- `HIDE_BALANCE_MIN_NOTE_AGE_SECS=3600`
- `GARAGA_VERIFIER_ADDRESS` (atau mock verifier jika testnet dev)

Untuk profile demo saat ini:
- `PRIVATE_ACTION_EXECUTOR_ADDRESS=0x060549e87e71903ffe1e6449aaa1e77d941de1a5117be3beabd0026d847c61fb`

## Current Constraints
- Package ini tidak membawa verifier BLS real.
- Proof format harus konsisten dengan backend (real/mock/dev).
- Hide mode mengurangi linkability tapi metadata chain publik tetap ada.
