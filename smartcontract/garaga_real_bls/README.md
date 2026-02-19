# garaga_real_bls (Isolated Project)

Folder ini adalah project Scarb terpisah untuk verifier Garaga + `PrivateActionExecutor`.

## Kenapa dipisah dari `smartcontract/`
- Generated verifier dari Garaga sangat berat saat build/test.
- Dipisah supaya test/build kontrak utama (`smartcontract/src`) tetap cepat.
- Tidak ada konflik source code selama command dijalankan di folder yang benar.

## Command
Jalankan dari root repo:

```bash
bash smartcontract/scripts/test_garaga_fast.sh
```

Fork verifier test (berat):

```bash
bash smartcontract/scripts/test_garaga_fork.sh
```

Atau manual:

```bash
cd smartcontract/garaga_real_bls
asdf exec snforge test
```

## Toolchain
Project ini membaca versi dari:

```text
smartcontract/garaga_real_bls/.tool-versions
```

Jika muncul error `No version is set`, pastikan command dijalankan dari folder ini atau gunakan helper script di `smartcontract/scripts/`.

## Hide Mode Executor Notes
- `PrivateActionExecutor` sekarang punya jalur `execute_private_swap_with_payout` untuk relayer/pool flow:
  - verify intent (`nullifier`, `commitment`, `intent_hash`),
  - call `execute_swap` di target swap,
  - payout token hasil swap ke recipient.
- Intent hash untuk jalur ini dihitung via endpoint preview:
  - `preview_swap_payout_intent_hash(entrypoint_selector, calldata, approval_token, payout_token, recipient, min_payout)`
- Untuk staking relayer multi-contract, executor juga menyediakan jalur target eksplisit:
  - `preview_stake_target_intent_hash(target, entrypoint_selector, calldata)`
  - `execute_private_stake_with_target(commitment, target, entrypoint_selector, calldata)`
- Untuk stake deposit relayer (butuh approve token ke staking target), gunakan jalur approval-aware:
  - `preview_stake_target_intent_hash_with_approval(target, entrypoint_selector, calldata, approval_token)`
  - `execute_private_stake_with_target_and_approval(commitment, target, entrypoint_selector, calldata, approval_token)`
