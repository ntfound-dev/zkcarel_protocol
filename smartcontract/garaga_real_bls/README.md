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
- Untuk environment Windows + WSL, jalankan deploy dari Windows dengan helper:
  `smartcontract/scripts/deploy_garaga_verifier_windows.ps1 -UseWsl`.
- Jika `sncast` gagal menemukan `scarb` / `universal-sierra-compiler`, pastikan env ini terpasang:
  - `SCARB=/home/frend/.asdf/installs/scarb/2.11.4/bin/scarb`
  - `UNIVERSAL_SIERRA_COMPILER=/home/frend/.local/bin/universal-sierra-compiler`

## Env Integration
Minimal env yang harus benar:
- `GARAGA_VERIFIER_ADDRESS=<alamat verifier real>`
- `GARAGA_VERIFICATION_MODE=5`
- `PRIVACY_VERIFIER_KIND=garaga`

Sepolia (latest, 27 Feb 2026):
- `GARAGA_VERIFIER_ADDRESS=0x04bc6f22779e528785ee27b844b93e92cf92d8ff0b6bed2f9b5cf41ee467ff45`
- `ClassHash=0x3c304b6fbde499591d6b79b6e3eb525a5673e1de9c02d46c575492065ed996a`

Re-wire adapter/router via:
- `smartcontract/scripts/04_deploy_adapters.sh`
- `smartcontract/scripts/07_wire_privacy_router_v2.sh`

## Current Constraints
- Compile jauh lebih berat dibanding `private_executor_lite`.
- Bukan jalur MVP default.
- Verifier real harus konsisten dengan proof format yang dipakai backend.
