# CAREL MVP - Transaction Evidence Analysis (Normal vs Hide + Bridge)

This document analyzes 9 MVP proof links using on-chain data and local runtime context.

Verification snapshot date: **February 25, 2026**.

Current runtime update (March 5, 2026):
- Hide-mode baseline has moved to V3:
  - `HIDE_BALANCE_EXECUTOR_KIND=shielded_pool_v3`
  - `HIDE_BALANCE_POOL_VERSION_DEFAULT=v3`
  - `HIDE_BALANCE_V2_REDEEM_ONLY=true`
  - `PRIVATE_ACTION_EXECUTOR_ADDRESS=0x0112a5f60db409d74c4e67b5c29c85c7fbeefffccf9762a37460a42854cc74c2`
- This file is kept as historical analysis for the earlier V2-era links.

## 1. Problem and Approach (Contract Scope)

### 1.1 Problem
- It is easy to mix up contracts that are actively used in MVP runtime versus contracts deployed for roadmap scope.
- `normal` and `hide` flows are often described together, while their on-chain traces are different.
- Reviewers need auditable evidence from chain data, not assumptions.

### 1.2 Approach
- Use runtime `env` as source of truth.
- Validate receipts/calldata/events directly, not only UI behavior.
- In this snapshot, active hide path was in `smartcontract/private_executor_lite` (`ShieldedPoolV2`), not `garaga_real_bls`.

## 2. Source-of-Truth Environments Used
- `backend-rust/.env`
- `smartcontract/.env`
- `frontend/.env.local`

Key values aligned across the three env files on the February 25, 2026 snapshot:
- `HIDE_BALANCE_EXECUTOR_KIND=shielded_pool_v2`
- `PRIVATE_ACTION_EXECUTOR_ADDRESS=0x060549e87e71903ffe1e6449aaa1e77d941de1a5117be3beabd0026d847c61fb`
- `SWAP_AGGREGATOR_ADDRESS=0x06f3e03be8a82746394c4ad20c6888dd260a69452a50eb3121252fdecacc6d28`
- `LIMIT_ORDER_BOOK_ADDRESS=0x06b189eef1358559681712ff6e9387c2f6d43309e27705d26daff4e3ba1fdf8a`
- `STAKING_STABLECOIN_ADDRESS=0x014f58753338f2f470c397a1c7ad1cfdc381a951b314ec2d7c9aec06a73a0aff`

Important note:
- `ZK_PRIVACY_ROUTER_ADDRESS` in `smartcontract/.env` may differ from runtime profile (`backend-rust/.env` + `frontend/.env.local`).
- MVP tx proof verification should follow the active runtime profile.

## 3. Local Smart Contract Test Result
Executed from `smartcontract`:
- `bash scripts/test_core_fast.sh` -> **166 passed, 0 failed**
- `bash scripts/test_private_executor_lite.sh` -> **12 passed, 0 failed**

Result: core path and active hide path for this snapshot were locally verified.

## 4. Analysis of 6 Starknet Transactions (Normal vs Hide)
Detected sender addresses:
- User wallet (normal): `0x469de079832d5da0591fc5f8fd2957f70b908d62c5d0dcb057d030cfc827705`
- Relayer (hide): `0x289f797b9c2dc6c661fd058968d9ba39d01c7547f8259f01b7bce55696d0ff0`

All tx below were `ACCEPTED_ON_L1` + `SUCCEEDED`.

| Flow | Link | On-chain sender | Detected action contract | `ShieldedPoolV2` emitter (`0x060549...c61fb`) |
| --- | --- | --- | --- | --- |
| Normal Swap | https://sepolia.voyager.online/tx/0x22a53b1af0f7d62e19569a99b38d67e9165faad2804ca50a1b0a53f289bab98 | User wallet | `SwapAggregator` (`0x06f3...`) | No |
| Hide Swap | https://sepolia.voyager.online/tx/0x71b6c99287c78b082d105dc7169faa56b419a3e2568b3ea9a70ef1ff653a2d2 | Relayer | `SwapAggregator` + executor | Yes |
| Normal Stake | https://sepolia.voyager.online/tx/0x3ffda88b060ad41b752e8410b13b567c2cca3aa1e32b29f60cf75d9f8b42d60 | User wallet | `StakingStablecoin` (`0x014f...`) | No |
| Hide Stake | https://sepolia.voyager.online/tx/0x5fcac3b4578ebe8cf32dde9b0c6ab2390f1f1aa6bea731c3f779575abbdd4cf | Relayer | `StakingStablecoin` + executor | Yes |
| Normal Limit | https://sepolia.voyager.online/tx/0x737c40659dc5c7872ab1a89222d879bca68163b890a61f09b1875d52e4747a6 | User wallet | `LimitOrderBook` (`0x06b1...`) | No |
| Hide Limit | https://sepolia.voyager.online/tx/0x523c9721e57f69fddff4ed3be3935cce3b5782ca2c3b454df565c0be6b22ba3 | Relayer | `LimitOrderBook` + executor | Yes |

## 5. Hide-Mode Proof Path Evidence (From Calldata)
All three hide transactions (`swap`, `stake`, `limit`) follow the same call pattern:
1. `set_asset_rule`
2. `deposit_fixed_for`
3. `submit_private_action` (large payload: `2322` fields)
4. `execute_private_*` (swap/stake/limit)

Key findings:
- `sender_address` for hide tx is relayer, not user wallet.
- User wallet can still appear in calldata binding data but is not the final sender.
- This is consistent with `ShieldedPoolV2` path in `private_executor_lite` for that snapshot.

## 6. Analysis of 3 Bridge Evidence Links
### 6.1 BTC Bridge Tx
- Link: https://mempool.space/testnet4/tx/d26a8f5d0213b4448722cde81e1f47e68b8efbd00c56ce4802e39c9b0898db4c
- Result:
  - Confirmed: `true`
  - Block: `123447`
  - Fee: `153 sats`
  - Main output: `50000 sats` (0.0005 BTC)

### 6.2 Garden Order
- Link: https://testnet-explorer.garden.finance/order/237be68816b9144b9d3533ca3ec8c4eb1e7c00b1649e9ec216d89469fd014e70
- Garden API verification (`/v2/orders/<id>`) shows:
  - `integrator`: `DocsTesting`
  - `created_at`: `2026-02-23T23:47:35Z`
  - Source: `bitcoin_testnet:btc`, amount `50000`
  - Source initiate tx: `d26a8f5d...:123447` (matches BTC tx above)
  - Destination: `starknet_sepolia:wbtc`, amount `49850`

### 6.3 ETH Bridge Tx
- Link: https://sepolia.etherscan.io/tx/0xab25b9261dc9f703e44cb89a34831ff03024b8fe89e32cce4a7e58b5d6dcdef3
- Result:
  - Status: `0x1` (success)
  - Value: `0.005 ETH`
  - `from`: `0x834de729cb9df77451dbc6bf7fd05f475b011ac7`
  - `to`: `0x006caa2c35c9f4df23dbf4985616ef2a8829bf22`

Note:
- Based on Garden order payload, the directly linked route is BTC -> WBTC.
- The ETH tx is valid but not directly tied to that specific `order_id` in this analyzed payload.

## 7. Practical Reviewer Summary
1. `normal` vs `hide` difference is provable on-chain: normal sent by user wallet, hide sent by relayer.
2. In this historical snapshot, active hide path was `private_executor_lite/ShieldedPoolV2`, not `garaga_real_bls`.
3. Hide path explicitly executes `submit_private_action` + `execute_private_*` in the same tx flow.
4. Bridge evidence is valid: BTC tx confirmed, Garden order matches BTC tx, ETH tx also succeeded.
