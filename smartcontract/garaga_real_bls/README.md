# garaga_real_bls (Real Groth16 BLS Verifier)

Package ini berisi verifier Groth16 BLS12-381 yang real (generated) dan executor kompatibilitas lama. Dipakai hanya saat butuh proof real on-chain.

## Table of Contents
- Scope
- When to Use
- Repository Contents
- Build and Test
- Deployment Notes
- Env Integration
- Current Constraints

## Scope
- Target: Starknet Sepolia (testnet) dan eventual mainnet.
- Fokus: verifier Groth16 BLS12-381 yang real.
- Bukan jalur MVP harian (compile berat).

## When to Use
Gunakan jika:
- Butuh verifier BLS real untuk proof Garaga on-chain.
- Validasi end-to-end proof flow (bukan mock).
- Menjaga kompatibilitas deployment lama yang masih memakai executor generasi awal.
- Sedang menyiapkan migrasi menuju verifier real untuk environment produksi.

Jangan gunakan untuk dev harian MVP. Untuk itu pakai `smartcontract/private_executor_lite/README.md`.
Dokumen bukti tx MVP saat ini tidak menggunakan package ini sebagai jalur default.

## Repository Contents
- `Groth16VerifierBLS12_381` (generated verifier, compile berat)
- `PrivateActionExecutor` (executor kompatibilitas, bukan `ShieldedPoolV2`)

## Build and Test
Dari root repo:
```bash
bash smartcontract/scripts/test_garaga_fast.sh
```

Fork test verifier (lebih berat, default `ignored`):
```bash
bash smartcontract/scripts/test_garaga_fork.sh
```

Atau manual:
```bash
cd smartcontract/garaga_real_bls
asdf exec snforge test
```

## Deployment Notes
- Pastikan `sncast` tersedia.
- Declare dan deploy class verifier terlebih dulu.
- Wiring adapter/router dilakukan via script deploy/wiring di `smartcontract/scripts/`.

## Env Integration
Minimal env yang harus benar:
- `GARAGA_VERIFIER_ADDRESS=<alamat verifier real>`
- `GARAGA_VERIFICATION_MODE=5`
- `PRIVACY_VERIFIER_KIND=garaga`

Re-wire adapter/router via:
- `smartcontract/scripts/04_deploy_adapters.sh`
- `smartcontract/scripts/07_wire_privacy_router_v2.sh`

## Current Constraints
- Compile jauh lebih berat dibanding `private_executor_lite`.
- Bukan jalur MVP default.
- Verifier real harus konsisten dengan proof format yang dipakai backend.
