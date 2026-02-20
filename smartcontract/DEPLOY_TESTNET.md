# Deploy to Starknet Sepolia
This guide defines the recommended contract deployment order and wiring steps for CAREL Protocol on Starknet Sepolia.

## Table of Contents
- [Prerequisites](#prerequisites)
- [Deploy Order](#deploy-order)
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
| 11 | `DCAOrders` (Limit Order Book) | `owner` |
| 12 | `StakingCarel` | `carel_token`, `reward_pool` |
| 13 | `StakingStablecoin` | `pool_admin`, `reward_pool`, `token_list` |
| 14 | `StakingBTC` | `pool_admin`, `reward_pool`, `btc_token` |
| 15 | `ZkPrivacyRouter` | `admin`, `garaga_adapter` |
| 16 | `PrivateBTCSwap` | `admin`, `garaga_adapter` |
| 17 | `DarkPool` | `admin`, `garaga_adapter` |
| 18 | `PrivatePayments` | `admin`, `garaga_adapter` |
| 19 | `AnonymousCredentials` | `admin`, `garaga_adapter` |
| 20 | `BattleshipGaraga` | `admin`, `garaga_adapter`, `timeout_config` |
| 21 | `PrivateActionExecutor / ShieldedPoolV2` | `admin`, `router`, `verifier_adapter`, module-specific params |

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

## Notes
| Topic | Detail |
| --- | --- |
| Mock verifier | `MockGaragaVerifier` is for testnet only and must not be deployed to mainnet. |
| Hide Mode scope | Hide Mode is currently for swap, limit order, and stake on Starknet L2 only. |
| Bridge policy | Bridge to `STRK` is disabled; use `STRK/WBTC` through swap. |
| Bridge pairs | Active testnet bridge pairs: `ETH<->BTC`, `BTC<->WBTC`, `ETH<->WBTC`. |
| Gas status | AI and TWAP gas are still above target and require further optimization. |
| Upgrade model | No proxy/upgrade contracts are active; upgrades require redeploy plus migration. |
