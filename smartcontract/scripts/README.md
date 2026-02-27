# smartcontract/scripts

Dokumen ini menjelaskan fungsi setiap script dan urutan eksekusi yang direkomendasikan untuk deploy/wiring/test.

## Table of Contents
- Scope
- Script Index
- Recommended Order
- Environment Notes

## Scope
- Semua script di folder ini dipakai untuk setup testnet, deploy, wiring, dan test automation.
- Target utama: Starknet Sepolia (MVP).

## Script Index
Setup:
- `01_setup_testnet.sh` Initialize testnet config dan scaffolding.
- `02_init_tokenomics.sh` Init distribusi/tokenomics awal.
- `03_fill_env_from_wallets.sh` Isi `.env` dari wallet/account lokal.

Deploy:
- `04_deploy_adapters.sh` Deploy adapter dan registry terkait privacy/verifier.
- `05_deploy_price_oracle.sh` Deploy price oracle.
- `06_deploy_remaining.sh` Deploy kontrak utama yang tersisa.
- `10_redeploy_ai_executor.sh` Redeploy AIExecutor saat perlu upgrade API/ABI.
- `11_deploy_privacy_intermediary.sh` Deploy `PrivacyIntermediary` + sinkron env FE/BE/SC.
- `deploy.sh` Shortcut deploy minimal.

Wiring:
- `07_wire_privacy_router_v2.sh` Wiring router V2 dan verifier registry.
- `09_register_staking_tokens.sh` Register token staking di kontrak staking.
- `08_rebalance_liquidity_healthcheck.sh` Healthcheck + rebalance liquidity.

Testing:
- `test_core_fast.sh` Test paket utama `smartcontract`.
- `test_private_executor_lite.sh` Test hide mode `private_executor_lite`.
- `test_garaga_fast.sh` Test `garaga_real_bls` (opsional).
- `test_garaga_fork.sh` Fork test (lebih berat).

Utilities:
- `load_stress.sh` Stress/load test.

## Recommended Order
1. `01_setup_testnet.sh`
2. `02_init_tokenomics.sh`
3. `03_fill_env_from_wallets.sh`
4. `04_deploy_adapters.sh`
5. `05_deploy_price_oracle.sh`
6. `06_deploy_remaining.sh`
7. `07_wire_privacy_router_v2.sh`
8. `09_register_staking_tokens.sh`
9. `08_rebalance_liquidity_healthcheck.sh`
10. `11_deploy_privacy_intermediary.sh` (jika memakai relayer+intermediary path)

## Environment Notes
- Semua script membaca `smartcontract/.env` dan beberapa juga menulis balik alamat hasil deploy.
- Pastikan RPC endpoint mendukung JSON-RPC `v0_10` dan account/keystore sudah benar sebelum menjalankan.
- Untuk ZAN keyed endpoint, gunakan format: `https://api.zan.top/node/v1/starknet/sepolia/<key>/rpc/v0_10`.
- Untuk detail env per script, lihat komentar di masing-masing file.
- Khusus `10_redeploy_ai_executor.sh`, parameter produksi AI bisa diatur lewat env:
  - `AI_EXECUTOR_LEVEL2_PRICE_WEI` (default `1e18`)
  - `AI_EXECUTOR_LEVEL3_PRICE_WEI` (default `2e18`)
  - `AI_EXECUTOR_FEE_ENABLED` (`1/0`)
  - `AI_EXECUTOR_SIGNATURE_VERIFICATION_ENABLED` (`1/0`)
  - `AI_EXECUTOR_MAX_PENDING_SCAN`, `AI_EXECUTOR_MAX_ACTIONS_PER_USER`, `AI_EXECUTOR_MAX_BATCH_EXECUTE`
  - `SNCAST_WAIT_TIMEOUT`, `SNCAST_WAIT_RETRY_INTERVAL`
  - `CONTRACT_READY_RETRIES`, `CONTRACT_READY_SLEEP_SECS`
- Jika dipakai untuk demo runtime frontend/backend, sinkronkan hasil deploy ke:
  - `backend-rust/.env`
  - `frontend/.env.local`
