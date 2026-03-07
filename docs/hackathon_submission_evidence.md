# Hackathon Submission and Proof Links

## Hackathon Eligibility and Judging Alignment
### Stage One (Tahap Pertama)
Focus: basic eligibility and track alignment.

Track alignment in this repository:
- Bitcoin track: BTC-related bridge and private BTC roadmap under `bridge` and `private_btc_swap` modules.
- Privacy track: ZK payload flow (`nullifier`, `commitment`, proof/public inputs), relayer path, and private executor.
- Open innovation track: integrated FE/BE/SC execution system with AI-assisted flow and loyalty module.

### Stage Two (Tahap Kedua)
Equal-weight judging criteria:
- Technology Execution: build quality and reliability.
- Innovation: originality and technical differentiation.
- Impact: real user/problem relevance.
- Presentation: clarity of explanation and demo evidence.
- Progress: measurable work completed during hackathon.

Evidence mapping:

| Criterion | Evidence in Repo |
| --- | --- |
| Technology Execution | `backend-rust/BE_TEST_REPORT.md`, `smartcontract/SC_TEST_REPORT.md`, runtime flow docs |
| Innovation | hide-mode relayer + ZK binding, AI-assisted execution, loyalty/points integration |
| Impact | unified execution flow (swap/bridge/stake/limit) and failure pre-check path |
| Presentation | architecture docs + README structure + demo proof links |
| Progress | deployment updates, runtime env audits, and test reports dated during hackathon cycle |

## Submission Checklist (Hackathon)
Required assets:
- Project description
- Demo video (max 3 minutes)
- Functional demo URL (`https://carel-protocol.vercel.app`)
- Public code repository
- README
- Starknet wallet address
- Optional: pitch deck

Language:
- English content, or content with English translation.

## Proof Transactions
Use these links as audit evidence.

Scope note:
- Demo-flow links are historical MVP proof and not the full deployment footprint.

### Latest Deployment/Upgrade Transactions (Feb 26-27, 2026)
- Garaga verifier declare: https://sepolia.voyager.online/tx/0x3077ad4d20d1b9acc70fc18af1be0356b3e2c5a803f3ac4b83766523616b51f
- Garaga verifier deploy: https://sepolia.voyager.online/tx/0x0261ba1337d96733010f049591f5c65a3f33a080006d76f7dca4de958e8b0b66
- AI Executor deploy: https://sepolia.voyager.online/tx/0x057ee4fb05d584d4d5dc1fd54ceed57a6e5638b3fe8f2e8de6f222b66b6c2b9a
- AI Executor config 1: https://sepolia.voyager.online/tx/0x00c473fff1062e048d407b8e378337ce2f86489487cf31f5346ea2ebdb9eba46
- AI Executor config 2: https://sepolia.voyager.online/tx/0x002bb9b874a213c2b20d03acf8827e3db1912ead8abea5934e5aa0640e076a61
- AI Executor config 3: https://sepolia.voyager.online/tx/0x046c27a0f32d84dd42f3094a90c0b90f2e3501d63518ee5f93e9f7bc08180ae8
- AI Executor config 4: https://sepolia.voyager.online/tx/0x075f6f5bb1ae646a31f5f0373749b4fe99c164b05cfcfe0ac52ad3fd6e4e9462
- AI Executor config 5: https://sepolia.voyager.online/tx/0x0722f5eea40ab5fd4b89f96484ca373cfbf31a5fc5c1a92dd218c29739c08cd0
- AI Executor config 6: https://sepolia.voyager.online/tx/0x0105bcf4255238c6aac5e02d66e6ee39f65ba41f060530f54b6cae3553bb4423
- CAREL burner grant: https://sepolia.voyager.online/tx/0x0745212c6e5a3cab6f62f8111aa946ef4bafd5b540b7d68dbbc70c9eee8e3158

### Historical MVP Demo-Flow Links (Feb 23-25, 2026)
- Normal Swap: https://sepolia.voyager.online/tx/0x22a53b1af0f7d62e19569a99b38d67e9165faad2804ca50a1b0a53f289bab98
- Hide Swap: https://sepolia.voyager.online/tx/0x71b6c99287c78b082d105dc7169faa56b419a3e2568b3ea9a70ef1ff653a2d2
- Normal Stake: https://sepolia.voyager.online/tx/0x3ffda88b060ad41b752e8410b13b567c2cca3aa1e32b29f60cf75d9f8b42d60
- Hide Stake: https://sepolia.voyager.online/tx/0x5fcac3b4578ebe8cf32dde9b0c6ab2390f1f1aa6bea731c3f779575abbdd4cf
- Normal Limit: https://sepolia.voyager.online/tx/0x737c40659dc5c7872ab1a89222d879bca68163b890a61f09b1875d52e4747a6
- Hide Limit: https://sepolia.voyager.online/tx/0x523c9721e57f69fddff4ed3be3935cce3b5782ca2c3b454df565c0be6b22ba3
- BTC bridge tx: https://mempool.space/testnet4/tx/d26a8f5d0213b4448722cde81e1f47e68b8efbd00c56ce4802e39c9b0898db4c
- Garden order: https://testnet-explorer.garden.finance/order/237be68816b9144b9d3533ca3ec8c4eb1e7c00b1649e9ec216d89469fd014e70
- ETH bridge tx: https://sepolia.etherscan.io/tx/0xab25b9261dc9f703e44cb89a34831ff03024b8fe89e32cce4a7e58b5d6dcdef3

### Deployment and Wiring Scope (Beyond 9 Demo Links)
- Base deployment order is 22 contracts (`smartcontract/DEPLOY_TESTNET.md`), so at least 22 deploy transactions.
- Additional documented upgrade/wiring activity:
- Real Garaga verifier redeploy (February 27, 2026): declare `0x3077ad4d20d1b9acc70fc18af1be0356b3e2c5a803f3ac4b83766523616b51f`, deploy `0x0261ba1337d96733010f049591f5c65a3f33a080006d76f7dca4de958e8b0b66`.
- AI Executor upgrade (February 26, 2026): deploy `0x057ee4fb05d584d4d5dc1fd54ceed57a6e5638b3fe8f2e8de6f222b66b6c2b9a`, plus 6 config tx and 1 CAREL burner grant tx (listed in `smartcontract/DEPLOY_TESTNET.md`).
- V2 privacy wiring script maps 32 verifier actions and wires up to 36 contracts/modules (30 default + 6 optional external modules).
- Staking token registration script adds 4 invoke tx (USDC, USDT, STRK, WBTC).
- Documented deploy+wiring activity commonly exceeds 100 tx across full setup/redeploy cycles (excluding RPC retry attempts).
- Quick deployer check: `https://sepolia.voyager.online/contract/[DEPLOYER_ADDRESS]`.

## Detailed MVP Transaction Analysis
This section keeps the earlier detailed analysis of the 9 MVP proof links.

Verification snapshot date: **February 25, 2026**.

Current runtime update (March 5, 2026):
- Hide-mode baseline has moved to V3:
  - `HIDE_BALANCE_EXECUTOR_KIND=shielded_pool_v3`
  - `HIDE_BALANCE_POOL_VERSION_DEFAULT=v3`
  - `HIDE_BALANCE_V2_REDEEM_ONLY=true`
  - `PRIVATE_ACTION_EXECUTOR_ADDRESS=0x0112a5f60db409d74c4e67b5c29c85c7fbeefffccf9762a37460a42854cc74c2`
- This section is kept as historical analysis for the earlier V2-era links.

### Problem and Approach
#### Problem
- It is easy to mix up contracts that are actively used in MVP runtime versus contracts deployed for roadmap scope.
- `normal` and `hide` flows are often described together, while their on-chain traces are different.
- Reviewers need auditable evidence from chain data, not assumptions.

#### Approach
- Use runtime `env` as source of truth.
- Validate receipts/calldata/events directly, not only UI behavior.
- In this snapshot, active hide path was in `smartcontract/private_executor_lite` (`ShieldedPoolV2`), not `garaga_real_bls`.

### Source-of-Truth Environments Used
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

### Local Smart Contract Test Result
Executed from `smartcontract`:
- `bash scripts/test_core_fast.sh` -> **166 passed, 0 failed**
- `bash scripts/test_private_executor_lite.sh` -> **12 passed, 0 failed**

Result: core path and active hide path for this snapshot were locally verified.

### Analysis of 6 Starknet Transactions (Normal vs Hide)
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

### Hide-Mode Proof Path Evidence
All three hide transactions (`swap`, `stake`, `limit`) follow the same call pattern:
1. `set_asset_rule`
2. `deposit_fixed_for`
3. `submit_private_action` (large payload: `2322` fields)
4. `execute_private_*` (swap/stake/limit)

Key findings:
- `sender_address` for hide tx is relayer, not user wallet.
- User wallet can still appear in calldata binding data but is not the final sender.
- This is consistent with `ShieldedPoolV2` path in `private_executor_lite` for that snapshot.

### Analysis of 3 Bridge Evidence Links
#### BTC Bridge Tx
- Link: https://mempool.space/testnet4/tx/d26a8f5d0213b4448722cde81e1f47e68b8efbd00c56ce4802e39c9b0898db4c
- Result:
  - Confirmed: `true`
  - Block: `123447`
  - Fee: `153 sats`
  - Main output: `50000 sats` (0.0005 BTC)

#### Garden Order
- Link: https://testnet-explorer.garden.finance/order/237be68816b9144b9d3533ca3ec8c4eb1e7c00b1649e9ec216d89469fd014e70
- Garden API verification (`/v2/orders/<id>`) shows:
  - `integrator`: `DocsTesting`
  - `created_at`: `2026-02-23T23:47:35Z`
  - Source: `bitcoin_testnet:btc`, amount `50000`
  - Source initiate tx: `d26a8f5d...:123447` (matches BTC tx above)
  - Destination: `starknet_sepolia:wbtc`, amount `49850`

#### ETH Bridge Tx
- Link: https://sepolia.etherscan.io/tx/0xab25b9261dc9f703e44cb89a34831ff03024b8fe89e32cce4a7e58b5d6dcdef3
- Result:
  - Status: `0x1` (success)
  - Value: `0.005 ETH`
  - `from`: `0x834de729cb9df77451dbc6bf7fd05f475b011ac7`
  - `to`: `0x006caa2c35c9f4df23dbf4985616ef2a8829bf22`

Note:
- Based on Garden order payload, the directly linked route is BTC -> WBTC.
- The ETH tx is valid but not directly tied to that specific `order_id` in this analyzed payload.

### Practical Reviewer Summary
1. `normal` vs `hide` difference is provable on-chain: normal sent by user wallet, hide sent by relayer.
2. In this historical snapshot, active hide path was `private_executor_lite/ShieldedPoolV2`, not `garaga_real_bls`.
3. Hide path explicitly executes `submit_private_action` + `execute_private_*` in the same tx flow.
4. Bridge evidence is valid: BTC tx confirmed, Garden order matches BTC tx, ETH tx also succeeded.
