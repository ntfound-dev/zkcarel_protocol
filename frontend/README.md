# CAREL Frontend (Next.js)
This README explains frontend setup, environment configuration, wallet integrations, and Hide Mode verification for local or testnet use.

## Table of Contents
- [Scope and Related Docs](#scope-and-related-docs)
- [Prerequisites](#prerequisites)
- [Local Setup](#local-setup)
- [Environment Variables](#environment-variables)
  - [Core](#core)
  - [Contract Addresses](#contract-addresses)
  - [Token Addresses](#token-addresses)
  - [Hide Mode / Privacy](#hide-mode--privacy)
  - [Explorers and External URLs](#explorers-and-external-urls)
- [Wallet Integration Matrix](#wallet-integration-matrix)
- [Hide Mode Verification](#hide-mode-verification)
- [AI Assistant Tiers](#ai-assistant-tiers)
- [AI Bridge L2 Behavior](#ai-bridge-l2-behavior)
- [Build and Deploy](#build-and-deploy)

## Scope and Related Docs
- Monorepo overview: [`../README.md`](../README.md)
- Demo walkthrough: [`../DEMO.md`](../DEMO.md)
- Backend setup and API behavior: [`../backend-rust/README.md`](../backend-rust/README.md)

## Prerequisites
- `Node.js >= 20.9.0`
- `npm`
- Running backend (`backend-rust`) reachable from frontend

## Local Setup
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:3000`.

## Environment Variables
Create `frontend/.env.local` and set values as needed.

### Core
| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_BACKEND_URL` | Yes | `http://localhost:8080` | Base URL for REST API calls |
| `NEXT_PUBLIC_BACKEND_WS_URL` | No | Derived from `NEXT_PUBLIC_BACKEND_URL` | WebSocket URL; frontend converts `http` -> `ws` when missing |
| `NEXT_PUBLIC_COINGECKO_API_KEY` | No | Empty | CoinGecko key used by live price fallback |
| `NEXT_PUBLIC_COINGECKO_KEY` | No | Empty | Legacy alias for CoinGecko key |
| `NEXT_PUBLIC_COINGECKO_IDS` | No | `BTC=bitcoin,ETH=ethereum,STRK=starknet,USDC=usd-coin,USDT=tether,WBTC=wrapped-bitcoin` | Symbol-to-CoinGecko mapping |
| `NEXT_PUBLIC_PRICE_FALLBACKS` | No | `USDC=1,USDT=1,CAREL=1` | Static fallback prices when WS/API data is stale |

### Contract Addresses
| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_STARKNET_SWAP_CONTRACT_ADDRESS` | Yes (Swap) | Empty | Starknet swap contract target for wallet execution |
| `NEXT_PUBLIC_STARKNET_BRIDGE_AGGREGATOR_ADDRESS` | Yes (Bridge) | Empty | Starknet bridge aggregator contract address |
| `NEXT_PUBLIC_STARKNET_LIMIT_ORDER_BOOK_ADDRESS` | Yes (Limit Order) | Empty | Primary Limit Order Book address |
| `NEXT_PUBLIC_LIMIT_ORDER_BOOK_ADDRESS` | No | Empty | Fallback alias for limit order contract |
| `NEXT_PUBLIC_STARKNET_STAKING_CAREL_ADDRESS` | Yes (Stake CAREL/STRK) | Empty | Staking contract for CAREL/STRK-style pool |
| `NEXT_PUBLIC_STARKNET_STAKING_STABLECOIN_ADDRESS` | Yes (Stake USDC/USDT) | Empty | Staking contract for stablecoin pool |
| `NEXT_PUBLIC_STARKNET_STAKING_BTC_ADDRESS` | Yes (Stake WBTC) | Empty | Staking contract for WBTC pool |
| `NEXT_PUBLIC_STAKING_CAREL_ADDRESS` | No | Empty | Legacy alias for CAREL staking |
| `NEXT_PUBLIC_STAKING_STABLECOIN_ADDRESS` | No | Empty | Legacy alias for stablecoin staking |
| `NEXT_PUBLIC_STAKING_BTC_ADDRESS` | No | Empty | Legacy alias for BTC staking |
| `NEXT_PUBLIC_ZK_PRIVACY_ROUTER_ADDRESS` | Yes (Hide Mode) | Empty | V1 privacy router used by hide flow |
| `NEXT_PUBLIC_PRIVACY_ROUTER_ADDRESS` | No | Empty | Optional V2 privacy router fallback |
| `NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS` | Yes (Hide Mode) | Empty | `PrivateActionExecutor/ShieldedPoolV2` address |
| `NEXT_PUBLIC_STARKNET_DISCOUNT_SOULBOUND_ADDRESS` | No | Empty | Discount NFT contract for rewards UI |
| `NEXT_PUBLIC_DISCOUNT_SOULBOUND_ADDRESS` | No | Empty | Legacy alias for discount NFT contract |
| `NEXT_PUBLIC_STARKNET_AI_EXECUTOR_ADDRESS` | No | Empty | Optional direct AI executor override |
| `NEXT_PUBLIC_AI_EXECUTOR_ADDRESS` | No | Empty | Legacy alias for AI executor override |
| `NEXT_PUBLIC_CAREL_PROTOCOL_ADDRESS` | No | Empty | Legacy/event-only swap fallback address |
| `NEXT_PUBLIC_TREASURY_ADDRESS` | No | Empty | Optional target address for some UI payment flows |

### Token Addresses
| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_TOKEN_CAREL_ADDRESS` | Yes | Empty | CAREL token address for transfers and fee flows |
| `NEXT_PUBLIC_CAREL_TOKEN_ADDRESS` | No | Empty | Legacy alias for CAREL token |
| `NEXT_PUBLIC_TOKEN_STRK_ADDRESS` | Yes | Empty | STRK token address |
| `NEXT_PUBLIC_STRK_TOKEN_ADDRESS` | No | Empty | Legacy alias for STRK token |
| `NEXT_PUBLIC_TOKEN_ETH_ADDRESS` | Yes (if ETH pairs enabled) | `0x3` fallback in UI | ETH token mapping for calldata |
| `NEXT_PUBLIC_TOKEN_BTC_ADDRESS` | Yes (BTC/WBTC pairs) | Empty | BTC token mapping |
| `NEXT_PUBLIC_TOKEN_WBTC_ADDRESS` | Yes (WBTC pairs) | Empty | WBTC token mapping |
| `NEXT_PUBLIC_TOKEN_USDC_ADDRESS` | Yes (USDC pairs) | `0x6` fallback in UI | USDC token mapping |
| `NEXT_PUBLIC_TOKEN_USDT_ADDRESS` | Yes (USDT pairs) | `0x5` fallback in UI | USDT token mapping |
| `NEXT_PUBLIC_STRK_L1_TOKEN_ADDRESS` | No | Empty | ERC-20 STRK token on Ethereum Sepolia for L1 balance view |

### Hide Mode / Privacy
| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_HIDE_BALANCE_RELAYER_POOL_ENABLED` | Yes | `true` | Enables relayer/pool path for hide-mode swap/limit/stake |
| `NEXT_PUBLIC_HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED` | Yes | `false` | If `true`, frontend tries direct wallet-to-executor path |
| `NEXT_PUBLIC_HIDE_BALANCE_FALLBACK_TO_PUBLIC` | No | `false` | Allows fallback to normal mode when hide execution fails |
| `NEXT_PUBLIC_ENABLE_DEV_GARAGA_AUTOFILL` | No (must be `false` for real demo) | `false` | Dev helper for mock payload autofill |
| `NEXT_PUBLIC_SWAP_CONTRACT_EVENT_ONLY` | No | Empty/`false` | Blocks swap execution if contract is configured as event-only |

### Explorers and External URLs
| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_STARKNET_EXPLORER_URL` | No | `https://sepolia.voyager.online` | Primary Starknet explorer base URL |
| `NEXT_PUBLIC_STARKSCAN_SEPOLIA_URL` | No | Used as fallback for Starknet explorer | Secondary Starknet explorer base URL |
| `NEXT_PUBLIC_ETHERSCAN_SEPOLIA_URL` | No | `https://sepolia.etherscan.io` | Ethereum Sepolia explorer base URL |
| `NEXT_PUBLIC_BTC_TESTNET_EXPLORER_URL` | No | `https://mempool.space/testnet4` | BTC testnet explorer base URL |
| `NEXT_PUBLIC_ETH_SEPOLIA_FAUCET_URL` | No | `https://cloud.google.com/application/web3/faucet/ethereum/sepolia` | External ETH Sepolia faucet URL |
| `NEXT_PUBLIC_STRK_FAUCET_URL` | No | `https://faucet.starknet.io/` | External official STRK faucet URL |
| `NEXT_PUBLIC_BTC_TESTNET_FAUCET_URL` | No | `https://testnet4.info/` | External BTC testnet4 faucet URL shown in UI |
| `NEXT_PUBLIC_EVM_SEPOLIA_RPC_URL` | No | `https://rpc.sepolia.org` | EVM RPC used for MetaMask chain setup |
| `NEXT_PUBLIC_BTC_VAULT_ADDRESS` | Required for BTC bridge execution | Empty | Deposit vault shown for BTC order flow |
| `NEXT_PUBLIC_STARKGATE_ETH_BRIDGE_ADDRESS` | No | Empty | Direct StarkGate bridge contract (ETH Sepolia) |
| `NEXT_PUBLIC_STARKGATE_ETH_TOKEN_ADDRESS` | No | Empty | ETH token address used for StarkGate call |
| `NEXT_PUBLIC_DEV_WALLET_ADDRESS` | No | Empty | Optional destination for paid profile rename flow |

## Wallet Integration Matrix
| Network | Wallet | SDK |
| --- | --- | --- |
| Starknet Sepolia | Argent X, Braavos | `@starknet-io/get-starknet` |
| Ethereum Sepolia | MetaMask | `window.ethereum` + EVM JSON-RPC |
| Bitcoin Testnet | UniSat, Xverse | Injected wallet API in browser |

## Hide Mode Verification
Checklist before testing Hide Mode:
- `NEXT_PUBLIC_ZK_PRIVACY_ROUTER_ADDRESS` is set.
- `NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS` is set.
- `NEXT_PUBLIC_HIDE_BALANCE_RELAYER_POOL_ENABLED=true`.
- `NEXT_PUBLIC_HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED=false`.
- `NEXT_PUBLIC_ENABLE_DEV_GARAGA_AUTOFILL=false`.

Verify payload in browser console:
```js
JSON.parse(localStorage.getItem("trade_privacy_garaga_payload_v2") || "null")
```
Expected payload contains: `nullifier`, `commitment`, `proof[]`, and `public_inputs[]`.

Hide Mode troubleshooting:
| Symptom | Likely Cause | Fix |
| --- | --- | --- |
| Hide tx fails before wallet prompt | Missing router/executor env | Set privacy addresses and restart frontend |
| Payload exists but shows dummy values | Dev autofill or dummy backend payload | Disable dev autofill and verify backend prover config |
| Hide mode routes to normal tx | `NEXT_PUBLIC_HIDE_BALANCE_RELAYER_POOL_ENABLED` disabled | Set it to `true` and hard reload |
| Nullifier reused error | Same payload reused accidentally | Clear old localStorage payload and retry |
| Swap blocked with event-only warning | Event-only safety flag enabled | Set real swap contract and disable event-only mode |

## AI Assistant Tiers
| Tier | Cost | Capabilities |
| --- | --- | --- |
| Tier 1 | Free | Read-only assistant: basic query, market context, non-transaction guidance |
| Tier 2 | 1 CAREL | Assisted execution for swap/bridge flows |
| Tier 3 | 2 CAREL | Portfolio-level actions and advanced automation |

## AI Bridge L2 Behavior
Execution flow for AI bridge command:
1. User sends command (example: `bridge eth 0.005 to wbtc`) and confirms with `yes`.
2. Frontend runs route/liquidity pre-check using backend `POST /api/v1/bridge/quote`.
3. If pre-check fails (`insufficient liquidity`, amount out of allowed range, unsupported route), flow stops before on-chain setup and CAREL is not burned.
4. If pre-check passes, frontend continues to on-chain setup/signature:
   - ETH source: MetaMask signs Garden source transaction (approval/initiate when present).
   - WBTC source: Starknet wallet signs approval/initiate.
   - BTC source: order is created, then user sends BTC deposit.
5. After source tx is signed/submitted, frontend finalizes using `existing_bridge_id + onchain_tx_hash`.

Common messages:
- `No CAREL was burned` means pre-check stopped execution before setup burn.
- `No pending confirmation right now` appears when user sends `yes/no` without active pending command.

Timing interpretation in Garden Explorer:
- `Created at` / `Created X hours ago` = age of order record since creation.
- `Completed in 10 secs` = settlement duration once required on-chain/deposit steps actually started.
- Both values can appear together and are not contradictory.

## Build and Deploy
Local production run:
```bash
npm run build
npm run start
```

Docker:
```bash
docker build -t zkcarel-frontend .
docker run --rm -p 3000:3000 \
  -e NEXT_PUBLIC_BACKEND_URL=http://host.docker.internal:8080 \
  -e NEXT_PUBLIC_BACKEND_WS_URL=ws://host.docker.internal:8080 \
  zkcarel-frontend
```

Catatan singkat: jika ubah env, lakukan hard reload browser supaya cache runtime/env di klien tidak stale.
