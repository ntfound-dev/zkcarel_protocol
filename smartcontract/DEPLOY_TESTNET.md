# Deploy to Starknet Sepolia
This guide defines the recommended contract deployment order and wiring steps for CAREL Protocol on Starknet Sepolia.

## Table of Contents
- [Prerequisites](#prerequisites)
- [Deploy Order](#deploy-order)
- [Profile Alignment (Important)](#profile-alignment-important)
- [Optional: Real Garaga Verifier (BLS12-381)](#optional-real-garaga-verifier-bls12-381)
- [Export Addresses](#export-addresses)
- [V2 Privacy Wiring](#v2-privacy-wiring)
- [Notes](#notes)

## Prerequisites
- `scarb` and `sncast` installed.
- Funded Sepolia deployer account.
- RPC endpoint compatible with Starknet spec `0.10.x`.

Recommended environment:
```bash
export NET=sepolia
export STARKNET_RPC_URL=https://api.zan.top/public/starknet-sepolia/rpc/v0_10
export PRAGMA_ORACLE_ADDRESS=0x36031daa264c24520b11d93af622c848b2499b66b41d611bac95e13cfca131a
export CHAINLINK_ORACLE_ADDRESS=0x0
```

Build before deploy:
```bash
cd smartcontract
scarb build
```

## Deploy Order
| No | Contract | Constructor Args |
| --- | --- | --- |
| 1 | `MockGaragaVerifier` (testnet only) | `admin`, `always_valid=true` |
| 2 | `GaragaVerifierAdapter` | `admin`, `mock_verifier_address` |
| 3 | `CarelToken` | `multisig_admin` |
| 4 | `Treasury` | `multisig_admin`, `carel_token` |
| 5 | `PointStorage` | `backend_signer` |
| 6 | `SnapshotDistributor` | `carel_token`, `staking_carel`, `dev_address`, `treasury`, `signer`, `protocol_start` |
| 7 | `PriceOracle` | `pragma_oracle`, `chainlink_oracle`, `owner` |
| 8 | `AIExecutor` | `carel_token`, `backend_signer` |
| 9 | `BridgeAggregator` | `owner`, `min_liquidity` |
| 10 | `SwapAggregator` | `owner`, `price_oracle`, `fee_collector` (or project-specific constructor set) |
| 11 | `KeeperNetwork` (Limit Order Book) | `owner` |
| 12 | `StakingCarel` | `carel_token`, `reward_pool` |
| 13 | `StakingStablecoin` | `pool_admin`, `reward_pool`, `token_list` |
| 14 | `StakingBTC` | `pool_admin`, `reward_pool`, `btc_token` |
| 15 | `ZkPrivacyRouter` | `admin`, `garaga_adapter` |
| 16 | `PrivateBTCSwap` | `admin`, `garaga_adapter` |
| 17 | `DarkPool` | `admin`, `garaga_adapter` |
| 18 | `PrivatePayments` | `admin`, `garaga_adapter` |
| 19 | `AnonymousCredentials` | `admin`, `garaga_adapter` |
| 20 | `BattleshipGaraga` | `admin`, `garaga_adapter`, `timeout_config` |
| 21 | `ShieldedPoolV2` (MVP default hide executor) | `admin`, `verifier`, `relayer` |
| 22 | `PrivateActionExecutor` (legacy/compatibility) | `admin`, `verifier`, `relayer`, `swap_target`, `limit_target`, `staking_target` |

## Profile Alignment (Important)
Untuk menghindari mismatch saat demo:
- `smartcontract/.env` dipakai sebagai katalog deploy/contracts inventory.
- Runtime bukti MVP biasanya memakai:
  - `backend-rust/.env`
  - `frontend/.env.local`

Setelah deploy/wiring kontrak:
1. Sinkronkan alamat dari `smartcontract/.env` ke `backend-rust/.env`.
2. Sinkronkan alamat dari backend ke `frontend/.env.local`.
3. Restart backend + frontend.

Catatan:
- Jika alamat `ZK_PRIVACY_ROUTER_ADDRESS` di runtime profile berbeda dengan katalog smartcontract, bukti tx akan mengikuti runtime profile aktif.

## Optional: Real Garaga Verifier (BLS12-381)
Use this section when moving from mock verification to real BLS12-381 proof verification.

Declare and deploy verifier:
```bash
cd smartcontract/garaga_real_bls
SN=/home/frend/.local/bin/sncast
RPC=https://api.zan.top/public/starknet-sepolia/rpc/v0_10

$SN --wait -a sepolia -p sepolia declare \
  --contract-name Groth16VerifierBLS12_381 \
  --url "$RPC"

$SN --wait -a sepolia -p sepolia deploy \
  --class-hash 0x<CLASS_HASH_FROM_DECLARE> \
  --url "$RPC"
```

Wire adapter and router:
```bash
GARAGA_VERIFIER=0x<DEPLOYED_REAL_VERIFIER>
GARAGA_ADAPTER=0x<GARAGA_ADAPTER_ADDRESS>
ZK_ROUTER=0x<ZK_PRIVACY_ROUTER_ADDRESS>

$SN --wait -a sepolia -p sepolia invoke \
  --contract-address "$GARAGA_ADAPTER" \
  --function set_verifier \
  --calldata "$GARAGA_VERIFIER" \
  --url "$RPC"

# mode 5 = verify_groth16_proof_bls12_381 returning Option<Span<u256>>
$SN --wait -a sepolia -p sepolia invoke \
  --contract-address "$GARAGA_ADAPTER" \
  --function set_verification_mode \
  --calldata 5 \
  --url "$RPC"

$SN --wait -a sepolia -p sepolia invoke \
  --contract-address "$ZK_ROUTER" \
  --function set_verifier \
  --calldata "$GARAGA_ADAPTER" \
  --url "$RPC"
```

## Export Addresses
Use this JSON template to populate `backend-rust/.env`:

```json
{
  "CAREL_TOKEN_ADDRESS": "0x...",
  "SNAPSHOT_DISTRIBUTOR_ADDRESS": "0x...",
  "POINT_STORAGE_ADDRESS": "0x...",
  "PRICE_ORACLE_ADDRESS": "0x...",
  "LIMIT_ORDER_BOOK_ADDRESS": "0x...",
  "STAKING_CAREL_ADDRESS": "0x...",
  "STAKING_STABLECOIN_ADDRESS": "0x...",
  "STAKING_BTC_ADDRESS": "0x...",
  "AI_EXECUTOR_ADDRESS": "0x...",
  "BRIDGE_AGGREGATOR_ADDRESS": "0x...",
  "STARKNET_SWAP_CONTRACT_ADDRESS": "0x...",
  "ZK_PRIVACY_ROUTER_ADDRESS": "0x...",
  "PRIVATE_ACTION_EXECUTOR_ADDRESS": "0x...",
  "BATTLESHIP_GARAGA_ADDRESS": "0x...",
  "PRIVATE_BTC_SWAP_ADDRESS": "0x...",
  "DARK_POOL_ADDRESS": "0x...",
  "PRIVATE_PAYMENTS_ADDRESS": "0x...",
  "ANONYMOUS_CREDENTIALS_ADDRESS": "0x..."
}
```

## AI Executor Upgrade (rate_limit getter)
If backend logs show:
`AI executor rate-limit getter not found ... falling back to set_rate_limit without readback`
then your deployed `AIExecutor` class is older and does not expose `rate_limit()`.

Use the helper script to redeploy `AIExecutor`, set burner/verifier config, and sync env addresses:

```bash
bash smartcontract/scripts/10_redeploy_ai_executor.sh
```

The script updates:
- `smartcontract/.env` -> `AI_EXECUTOR_ADDRESS`
- `backend-rust/.env` -> `AI_EXECUTOR_ADDRESS`
- `frontend/.env` and `frontend/.env.local` -> `NEXT_PUBLIC_STARKNET_AI_EXECUTOR_ADDRESS`, `NEXT_PUBLIC_AI_EXECUTOR_ADDRESS`

Then restart backend and frontend services.

Latest verified run (Feb 26, 2026):
- RPC: `https://api.zan.top/node/v1/starknet/sepolia/<key>/rpc/v0_10`
- New `AI_EXECUTOR_ADDRESS`: `0x01b46617037091d04d978d2cbda42887ab4ace055b63c8b7881d34a7ec5b076b`
- Deploy tx: `0x057ee4fb05d584d4d5dc1fd54ceed57a6e5638b3fe8f2e8de6f222b66b6c2b9a`
- Config tx (rate/fee/limits/verifier): `0x00c473fff1062e048d407b8e378337ce2f86489487cf31f5346ea2ebdb9eba46`, `0x002bb9b874a213c2b20d03acf8827e3db1912ead8abea5934e5aa0640e076a61`, `0x046c27a0f32d84dd42f3094a90c0b90f2e3501d63518ee5f93e9f7bc08180ae8`, `0x075f6f5bb1ae646a31f5f0373749b4fe99c164b05cfcfe0ac52ad3fd6e4e9462`, `0x0722f5eea40ab5fd4b89f96484ca373cfbf31a5fc5c1a92dd218c29739c08cd0`, `0x0105bcf4255238c6aac5e02d66e6ee39f65ba41f060530f54b6cae3553bb4423`
- CAREL burner grant tx: `0x0745212c6e5a3cab6f62f8111aa946ef4bafd5b540b7d68dbbc70c9eee8e3158`

## V2 Privacy Wiring
Default script:
```bash
bash smartcontract/scripts/07_wire_privacy_router_v2.sh
```

Override options:
```bash
# choose verifier kind
export PRIVACY_VERIFIER_KIND=garaga   # or: tongo, semaphore

# optional explicit verifier address
export PRIVACY_VERIFIER_ADDRESS=0x...

# wire optional external modules (bridge/BTC)
export PRIVACY_WIRE_EXTERNAL=1

bash smartcontract/scripts/07_wire_privacy_router_v2.sh
```

## Staking Token Registration
After deploy, run:
```bash
bash smartcontract/scripts/09_register_staking_tokens.sh
```

Notes:
- Script registers USDC/USDT/STRK on `StakingStablecoin`, registers WBTC on `StakingBTC`, and verifies allowlist status on-chain.
- For new deployments, `BTCStaking` constructor also receives default WBTC token (`TOKEN_WBTC_ADDRESS` fallback `TOKEN_BTC_ADDRESS`) from `scripts/06_deploy_remaining.sh`.

## Notes
| Topic | Detail |
| --- | --- |
| Mock verifier | `MockGaragaVerifier` is for testnet only and must not be deployed to mainnet. |
| Hide Mode scope | Hide Mode is currently for swap, limit order, and stake on Starknet L2 only. |
| Bridge policy | Bridge to `STRK` is disabled; use `STRK/WBTC` through swap. |
| Bridge pairs | Active testnet bridge pairs: `ETH<->BTC`, `BTC<->WBTC`, `ETH<->WBTC`. |
| Gas status | AI and TWAP gas are still above target and require further optimization. |
| Upgrade model | No proxy/upgrade contracts are active; upgrades require redeploy plus migration. |
