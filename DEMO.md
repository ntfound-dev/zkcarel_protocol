# CAREL Protocol Demo Guide
This guide covers the minimum setup and exact demo flows for showing CAREL Protocol on Starknet Sepolia.

## Table of Contents
- [Prerequisites](#prerequisites)
- [Minimum Setup for Demo](#minimum-setup-for-demo)
- [Demo Flow 1: Normal Mode Swap](#demo-flow-1-normal-mode-swap)
- [Demo Flow 2: Normal Mode Limit Order](#demo-flow-2-normal-mode-limit-order)
- [Demo Flow 3: Hide Mode (Private Swap)](#demo-flow-3-hide-mode-private-swap)
- [Demo Flow 4: Bitcoin Bridge](#demo-flow-4-bitcoin-bridge)
- [Demo Flow 5: Battleship (ZK Game)](#demo-flow-5-battleship-zk-game)
- [Verifying On-chain](#verifying-on-chain)
- [Troubleshooting](#troubleshooting)

## Prerequisites
- Tooling: `Node.js >= 20`, `npm`, `Rust + cargo`, `PostgreSQL`, `Redis`.
- Wallets:
  - Starknet: Argent X or Braavos (funded on Sepolia).
  - EVM: MetaMask (ETH Sepolia funded).
  - BTC: UniSat or Xverse (BTC testnet funded).
- Faucet and funding references:
  - ETH Sepolia faucet: <https://www.alchemy.com/faucets/ethereum-sepolia>
  - BTC testnet4 faucet: <https://testnet4.dev/> and <https://testnet4.info/>
  - STRK Sepolia funding path (bridge ETH Sepolia): <https://sepolia.starkgate.starknet.io/>

## Minimum Setup for Demo
Use only the minimum env needed for demo execution.

```bash
# backend-rust/.env (minimum for demo focus)
PRIVATE_ACTION_EXECUTOR_ADDRESS=0x07e18b8314a17989a74ba12e6a68856a9e4791ce254d8491ad2b4addc7e5bf8e
HIDE_BALANCE_EXECUTOR_KIND=shielded_pool_v2
ZK_PRIVACY_ROUTER_ADDRESS=0x0682719dbe8364fc5c772f49ecb63ea2f2cf5aa919b7d5baffb4448bb4438d1f
STARKNET_SWAP_CONTRACT_ADDRESS=0x06f3e03be8a82746394c4ad20c6888dd260a69452a50eb3121252fdecacc6d28
LIMIT_ORDER_BOOK_ADDRESS=0x06b189eef1358559681712ff6e9387c2f6d43309e27705d26daff4e3ba1fdf8a
PRIVACY_AUTO_GARAGA_PROVER_CMD="python3 scripts/garaga_auto_prover.py"
GARAGA_ALLOW_PRECOMPUTED_PAYLOAD=true
GARAGA_DYNAMIC_BINDING=true
GARAGA_NULLIFIER_PUBLIC_INPUT_INDEX=0
GARAGA_COMMITMENT_PUBLIC_INPUT_INDEX=1
GARAGA_INTENT_HASH_PUBLIC_INPUT_INDEX=2
```

```bash
# frontend/.env.local (minimum for demo focus)
NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8080
NEXT_PUBLIC_ZK_PRIVACY_ROUTER_ADDRESS=0x0682719dbe8364fc5c772f49ecb63ea2f2cf5aa919b7d5baffb4448bb4438d1f
NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS=0x07e18b8314a17989a74ba12e6a68856a9e4791ce254d8491ad2b4addc7e5bf8e
NEXT_PUBLIC_HIDE_BALANCE_RELAYER_POOL_ENABLED=true
NEXT_PUBLIC_HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED=false
NEXT_PUBLIC_ENABLE_DEV_GARAGA_AUTOFILL=false
```

Start services:
```bash
cd backend-rust && cargo run
# new terminal
cd frontend && npm install && npm run dev
```

## Demo Flow 1: Normal Mode Swap
1. Connect a Starknet wallet (Argent X or Braavos).
2. Open Swap in the frontend.
3. Keep Hide Mode OFF.
4. Select a Starknet pair and request quote.
5. Execute and sign from wallet.
6. Show on-chain result: direct `approve` + `execute_swap` call path.

## Demo Flow 2: Normal Mode Limit Order
1. Open Limit Order page.
2. Keep Hide Mode OFF.
3. Create an order (`from`, `to`, amount, price, expiry).
4. Sign the order transaction from wallet.
5. Verify that call goes directly to `Limit Order Book` contract.
6. Optional: cancel order to show lifecycle end-to-end.

## Demo Flow 3: Hide Mode (Private Swap)
### Pre-check
- `NEXT_PUBLIC_HIDE_BALANCE_RELAYER_POOL_ENABLED=true`.
- `NEXT_PUBLIC_HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED=false`.
- Backend prover command active: `PRIVACY_AUTO_GARAGA_PROVER_CMD`.
- Wallet has enough balance for source token + gas.

### Steps
1. Open Swap and enable Hide Mode.
2. Submit swap from UI.
3. Frontend requests payload from `POST /api/v1/privacy/auto-submit`.
4. Backend binds payload (`nullifier`, `commitment`, `intent_hash`) and relays execution.
5. On-chain flow should include `submit_private_action` then `execute_private_swap`.

### Verify payload in browser console
```js
localStorage.getItem("trade_privacy_garaga_payload_v2")
```
Expected: non-null JSON with `nullifier`, `commitment`, `proof[]`, `public_inputs[]`.

### Verify on-chain calls
- In explorer, find transaction containing:
  - `submit_private_action` on `ZkPrivacyRouter`
  - `execute_private_swap` on `PrivateActionExecutor/ShieldedPoolV2`

### Verify nullifier usage
Use API check:
```bash
GET /api/v1/dark-pool/nullifier/0x{nullifier}
```
Expected response after usage: `{"used": true, ...}`.

## Demo Flow 4: Bitcoin Bridge
1. Connect BTC wallet (UniSat or Xverse) and source-chain wallet.
2. Use only supported bridge pairs: `ETH<->BTC`, `BTC<->WBTC`, `ETH<->WBTC`.
3. Submit bridge order from UI.
4. Follow Garden order-first flow: backend returns `deposit_address` (`result.to`).
5. Send BTC to that deposit address from BTC wallet.
6. Track status from bridge UI or backend status endpoint.

Notes:
- Bridge to `STRK` is disabled.
- `STRK/WBTC` should be demonstrated via Swap, not Bridge.

## Demo Flow 5: Battleship (ZK Game)
1. Connect Starknet wallet.
2. Open Battleship feature.
3. Create game and invite opponent.
4. Join game, place ships/commit board, and start turns.
5. Fire shot and respond until finish.
6. Optionally trigger timeout claim to show edge flow.

## Verifying On-chain
### Explorer URLs
| Network | Explorer | URL |
| --- | --- | --- |
| Starknet Sepolia | Voyager | <https://sepolia.voyager.online/> |
| Starknet Sepolia | Starkscan | <https://sepolia.starkscan.co/> |
| Ethereum Sepolia | Etherscan | <https://sepolia.etherscan.io/> |
| BTC Testnet4 | mempool.space | <https://mempool.space/testnet4> |

### What to check per flow
| Flow | What to look for |
| --- | --- |
| Normal Swap | Wallet-signed tx with `approve` and swap execution on aggregator |
| Normal Limit Order | Direct create/cancel call on `Limit Order Book` |
| Hide Mode Swap | `submit_private_action` + `execute_private_swap`; payload persisted in localStorage |
| Bitcoin Bridge | Order created first, then BTC sent to returned deposit address |
| Battleship | Game lifecycle calls (`create`, `join`, `fire`, `respond`, `claim-timeout`) |

## Troubleshooting
| Symptom | Likely Cause | Fix |
| --- | --- | --- |
| Hide Mode button works but tx fails immediately | Router/executor env mismatch | Ensure frontend and backend point to the same Sepolia addresses |
| Payload is `null` in localStorage | Prover command or file config is missing | Recheck `PRIVACY_AUTO_GARAGA_PROVER_CMD` and restart backend |
| Explorer shows dummy proof (`0x1`) | Dev autofill or dummy payload path still active | Set `NEXT_PUBLIC_ENABLE_DEV_GARAGA_AUTOFILL=false` and use real payload config |
| Bridge order exists but no progress | BTC deposit not sent to returned address yet | Send BTC to `deposit_address` from wallet and refresh bridge status |
| AI bridge returns `insufficient liquidity` / range error | Live Garden quote cannot satisfy pair+amount now | Retry with adjusted amount or later; AI L2 pre-check stops before setup burn (`No CAREL was burned`) |
| Explorer shows `Created 6 hours ago` but `Completed in 10 secs` | Different metrics are being shown | `Created` is order age; `Completed in` is settlement duration once initiated |
| Swap quote is intermittent | RPC/provider rate limit | Retry after cooldown or switch RPC/provider |
| Battleship state looks reset after backend restart | Current state stored in backend memory | Keep backend stable during demo; avoid restart mid-match |
