# smartcontract/scripts

This document explains each script and the recommended execution order for deploy, wiring, and tests.

## Table of Contents
- [Scope](#scope)
- [Script Index](#script-index)
- [Recommended Order](#recommended-order)
- [Environment Notes](#environment-notes)

## Scope
- Scripts in this folder are used for testnet setup, deployment, wiring, and test automation.
- Primary target: Starknet Sepolia (MVP).

## Script Index
Setup:
- `01_setup_testnet.sh` Initialize testnet config and scaffolding.
- `02_init_tokenomics.sh` Initialize tokenomics baseline distribution.
- `03_fill_env_from_wallets.sh` Fill `.env` from local wallet/account data.

Deploy:
- `04_deploy_adapters.sh` Deploy privacy/verifier-related adapters and registry.
- `05_deploy_price_oracle.sh` Deploy price oracle.
- `06_deploy_remaining.sh` Deploy remaining core contracts.
- `deploy_garaga_verifier_windows.ps1` Deploy real Garaga verifier plus adapter/router wiring (Windows + WSL helper).
- `10_redeploy_ai_executor.sh` Redeploy AIExecutor when API/ABI upgrade is needed.
- `11_deploy_privacy_intermediary.sh` Deploy `PrivacyIntermediary` and sync FE/BE/SC env values.
- `deploy.sh` Minimal deploy shortcut.

Wiring:
- `07_wire_privacy_router_v2.sh` Wire Privacy Router V2 and verifier registry.
- `09_register_staking_tokens.sh` Register staking tokens in staking contracts.
- `08_rebalance_liquidity_healthcheck.sh` Liquidity healthcheck and rebalance utility.

Testing:
- `test_core_fast.sh` Test core `smartcontract` package.
- `test_private_executor_lite.sh` Test `private_executor_lite` hide-mode package.
- `test_garaga_fast.sh` Test `garaga_real_bls` package (optional).
- `test_garaga_fork.sh` Fork test path (heavier).

Utilities:
- `load_stress.sh` Stress/load test helper.

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
10. `11_deploy_privacy_intermediary.sh` (if using relayer + intermediary path)

## Environment Notes
- Scripts read from `smartcontract/.env`; several scripts also write deployed addresses back to that file.
- Ensure RPC endpoint supports JSON-RPC `v0_10` and account/keystore settings are valid before execution.
- For ZAN keyed endpoint, use format:
  `https://api.zan.top/node/v1/starknet/sepolia/<key>/rpc/v0_10`
- For script-specific env details, read comments inside each script.
- For `10_redeploy_ai_executor.sh`, production AI parameters can be configured via env:
  - `AI_EXECUTOR_LEVEL2_PRICE_WEI` (default `1e18`)
  - `AI_EXECUTOR_LEVEL3_PRICE_WEI` (default `2e18`)
  - `AI_EXECUTOR_FEE_ENABLED` (`1/0`)
  - `AI_EXECUTOR_SIGNATURE_VERIFICATION_ENABLED` (`1/0`)
  - `AI_EXECUTOR_MAX_PENDING_SCAN`, `AI_EXECUTOR_MAX_ACTIONS_PER_USER`, `AI_EXECUTOR_MAX_BATCH_EXECUTE`
  - `SNCAST_WAIT_TIMEOUT`, `SNCAST_WAIT_RETRY_INTERVAL`
  - `CONTRACT_READY_RETRIES`, `CONTRACT_READY_SLEEP_SECS`
- If script output is used for FE/BE runtime demos, sync results to:
  - `backend-rust/.env`
  - `frontend/.env.local`
- For `deploy_garaga_verifier_windows.ps1` with `-UseWsl`, ensure these paths are valid:
  - `WslSncastPath` (default: `/home/frend/.asdf/installs/starknet-foundry/0.56.0/bin/sncast`)
  - `WslScarbPath` (default: `/home/frend/.asdf/installs/scarb/2.11.4/bin/scarb`)
  - `WslUscPath` (default: `/home/frend/.local/bin/universal-sierra-compiler`)
