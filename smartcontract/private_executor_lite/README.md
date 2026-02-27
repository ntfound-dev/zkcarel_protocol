# private_executor_lite (Hide Mode MVP)

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
- Jalur eksekusi: relayer + `ShieldedPoolV2`.
- Proof bisa real atau mock/dev sesuai env backend.

## Status Pemakaian
- Dipakai aktif untuk hide mode dengan `ShieldedPoolV2`.
- `PrivateActionExecutor` tetap ada untuk kompatibilitas flow lama.
- Source-of-truth mode di env (backend): `HIDE_BALANCE_EXECUTOR_KIND=shielded_pool_v2`.
- Source-of-truth mode di env (frontend): `NEXT_PUBLIC_HIDE_BALANCE_EXECUTOR_KIND=shielded_pool_v2`.
- Status test lokal terakhir: `12/12` passing (`smartcontract/SC_TEST_REPORT.md`).

## Contracts
| Contract | Path | Notes |
| --- | --- | --- |
| `ShieldedPoolV2` | `src/shielded_pool_v2.cairo` | Kontrak utama hide mode. Menyimpan note, nullifier, commitment, action hash binding. Mendukung single dan batch execution via relayer. |
| `PrivateActionExecutor` | `src/private_action_executor.cairo` | Executor generasi awal untuk kompatibilitas deployment lama. |

## Hide Mode Flow (Ringkas)
1. Admin set aturan aset lewat `set_asset_rule`.
2. User/relayer deposit note lewat `deposit_fixed` / `deposit_fixed_for`.
3. User submit intent privat lewat `submit_private_action`.
4. Relayer/admin eksekusi aksi privat: swap (`execute_private_swap_with_payout`), limit (`execute_private_limit_order`), stake (`execute_private_stake`).

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
asdf exec sncast --wait -a sepolia declare --contract-name ShieldedPoolV2 --url <RPC>

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
- `PRIVATE_ACTION_EXECUTOR_ADDRESS=<ShieldedPoolV2>`
- `HIDE_BALANCE_EXECUTOR_KIND=shielded_pool_v2`
- `GARAGA_VERIFIER_ADDRESS` (atau mock verifier jika testnet dev)

Untuk profile demo saat ini:
- `PRIVATE_ACTION_EXECUTOR_ADDRESS=0x060549e87e71903ffe1e6449aaa1e77d941de1a5117be3beabd0026d847c61fb`

## Current Constraints
- Package ini tidak membawa verifier BLS real.
- Proof format harus konsisten dengan backend (real/mock/dev).
- Hide mode mengurangi linkability tapi metadata chain publik tetap ada.
