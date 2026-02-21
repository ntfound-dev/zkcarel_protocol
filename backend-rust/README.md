# CAREL Backend (Rust + Axum)
This README documents backend architecture, configuration, API surface, workers, and deployment paths used by CAREL Protocol.

## Table of Contents
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
  - [Required - Boot](#required---boot)
  - [Required - On-chain Integration](#required---on-chain-integration)
  - [Hide Mode / Privacy](#hide-mode--privacy)
  - [AI and Rate Limiting](#ai-and-rate-limiting)
  - [Bridge Providers](#bridge-providers)
  - [Price Feeds](#price-feeds)
  - [Optional Features](#optional-features)
  - [Optional Dev/Debug](#optional-devdebug)
- [Current Sepolia Wiring](#current-sepolia-wiring)
- [API Endpoints by Domain](#api-endpoints-by-domain)
- [Background Services](#background-services)
- [Docker](#docker)
- [Operational Constraints](#operational-constraints)

## Architecture
- Framework: Axum + Tokio.
- Storage: PostgreSQL (`sqlx`) + Redis.
- Chain integrations: Starknet Sepolia, Ethereum Sepolia, BTC testnet (provider-dependent).
- Runtime responsibilities:
  - API for auth, trading, privacy, rewards, social, AI, and game flows.
  - Relayer path for Hide Mode (`swap`, `limit order`, `stake`).
  - Background workers for indexing, prices, points, and order execution.

## Quick Start
```bash
# terminal 1
cd backend-rust
cargo run
```

For full demo setup, use [`../DEMO.md`](../DEMO.md).

## Environment Variables

### Required - Boot
| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `HOST` | No | `0.0.0.0` | Bind host |
| `PORT` | No | `3000` | API port |
| `ENVIRONMENT` | No | `development` | Runtime mode (`development`, `testnet`, etc.) |
| `DATABASE_URL` | Yes | None | PostgreSQL DSN |
| `DATABASE_MAX_CONNECTIONS` | No | `100` | SQL pool size |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis endpoint |
| `STARKNET_RPC_URL` | Yes | None | Base Starknet RPC |
| `STARKNET_CHAIN_ID` | No | `SN_MAIN` | Chain id (`SN_SEPOLIA` for current testnet wiring) |
| `ETHEREUM_RPC_URL` | Yes | None | EVM RPC endpoint |
| `BACKEND_PRIVATE_KEY` | Yes | None | Relayer signer private key |
| `BACKEND_PUBLIC_KEY` | Yes | None | Relayer signer public key |
| `BACKEND_ACCOUNT_ADDRESS` | No | Derived fallback | Explicit Starknet account address override |
| `JWT_SECRET` | Yes | None | JWT signing secret |
| `JWT_EXPIRY_HOURS` | No | `24` | JWT TTL |
| `CORS_ALLOWED_ORIGINS` | No | `*` | CORS allowlist |

### Required - On-chain Integration
| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `CAREL_TOKEN_ADDRESS` | Yes | None | CAREL ERC20 |
| `SNAPSHOT_DISTRIBUTOR_ADDRESS` | Yes | None | Rewards distributor |
| `POINT_STORAGE_ADDRESS` | Yes | None | Points storage/convert contract |
| `PRICE_ORACLE_ADDRESS` | Yes | None | Oracle contract |
| `LIMIT_ORDER_BOOK_ADDRESS` | Yes | None | Limit order book contract |
| `AI_EXECUTOR_ADDRESS` | Yes | None | AI executor contract |
| `BRIDGE_AGGREGATOR_ADDRESS` | Yes | None | Bridge aggregator contract |
| `ZK_PRIVACY_ROUTER_ADDRESS` | Yes | None | V1 privacy router |
| `PRIVATE_BTC_SWAP_ADDRESS` | Yes | None | Private BTC swap contract |
| `DARK_POOL_ADDRESS` | Yes | None | Dark pool contract |
| `PRIVATE_PAYMENTS_ADDRESS` | Yes | None | Private payments contract |
| `ANONYMOUS_CREDENTIALS_ADDRESS` | Yes | None | Anonymous credentials contract |
| `STARKNET_SWAP_CONTRACT_ADDRESS` | Required for live swap execute | Empty | Swap execution contract |
| `SWAP_AGGREGATOR_ADDRESS` | No | Empty | Alias/fallback for swap contract |
| `CAREL_PROTOCOL_ADDRESS` | No | Empty | Legacy event-only protocol contract reference |
| `PRIVATE_ACTION_EXECUTOR_ADDRESS` | Required for Hide Mode | Empty | `PrivateActionExecutor/ShieldedPoolV2` |
| `HIDE_BALANCE_EXECUTOR_KIND` | No | `private_action_executor_v1` | Set `shielded_pool_v2` for current Sepolia wiring |
| `HIDE_BALANCE_RELAYER_POOL_ENABLED` | No | `true` | Enables relayer pool path for hide-mode flows |
| `PRIVACY_ROUTER_ADDRESS` | No | Empty | Optional V2 privacy router |
| `BATTLESHIP_GARAGA_ADDRESS` | No | Empty | Battleship on-chain target |
| `BATTLESHIP_CONTRACT_ADDRESS` | No | Empty | Legacy alias for Battleship address |
| `STAKING_CAREL_ADDRESS` | No | Empty | CAREL staking pool |
| `STAKING_STABLECOIN_ADDRESS` | No | Empty | Stablecoin staking pool |
| `STAKING_BTC_ADDRESS` | No | Empty | BTC/WBTC staking pool |
| `DISCOUNT_SOULBOUND_ADDRESS` | No | Empty | Discount NFT contract |
| `TREASURY_ADDRESS` | No | Empty | Treasury contract |
| `REFERRAL_SYSTEM_ADDRESS` | No | Empty | Referral contract |
| `AI_SIGNATURE_VERIFIER_ADDRESS` | No | Empty | Optional signature gate for AI action prep |

### Hide Mode / Privacy
Key variables:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PRIVACY_AUTO_GARAGA_PROVER_CMD` | Yes for one-click hide flow | Auto-detected if script exists | Command used to generate payload per request |
| `PRIVACY_AUTO_GARAGA_PROVER_TIMEOUT_MS` | No | `45000` | Timeout for prover command |
| `PRIVACY_AUTO_GARAGA_PAYLOAD_FILE` | No | Auto-detected if present | Static payload fallback source |
| `PRIVACY_AUTO_GARAGA_PROOF_FILE` | No | Empty | Standalone proof JSON path |
| `PRIVACY_AUTO_GARAGA_PUBLIC_INPUTS_FILE` | No | Empty | Standalone public inputs JSON path |
| `PRIVACY_VERIFIER_ROUTERS` | No | Empty | Mapping `verifier:router` |
| `GARAGA_PRECOMPUTED_PAYLOAD_PATH` | No | Empty | Precomputed payload JSON for shared dev mode |
| `GARAGA_ALLOW_PRECOMPUTED_PAYLOAD` | No | `false` | Explicitly allow precomputed payload usage |
| `GARAGA_DYNAMIC_BINDING` | No | `false` | Rebind nullifier/commitment per request |
| `GARAGA_PROVE_CMD` | Required in strict mode | Empty | Real prover command |
| `GARAGA_VK_PATH` | Required in strict mode | Empty | Verification key JSON |
| `GARAGA_PROOF_PATH` | Required in strict mode | Empty | Proof JSON output/input path |
| `GARAGA_PUBLIC_INPUTS_PATH` | Conditional | Empty | Public input JSON path |
| `GARAGA_NULLIFIER_PUBLIC_INPUT_INDEX` | No | `0` | Public input index for nullifier |
| `GARAGA_COMMITMENT_PUBLIC_INPUT_INDEX` | No | `1` | Public input index for commitment |
| `GARAGA_INTENT_HASH_PUBLIC_INPUT_INDEX` | No | `2` | Public input index for intent hash binding |
| `GARAGA_TIMEOUT_SECS` | No | `45` | Timeout used by auto prover script |
| `GARAGA_UVX_CMD` | No | `uvx --python 3.10` | CLI launcher used by script |
| `GARAGA_SYSTEM` | No | `groth16` | Proof system mode in script |
| `GARAGA_OUTPUT_DIR` | No | `/tmp/garaga_auto_prover` | Working dir for generated artifacts |
| `GARAGA_REAL_PROVER_CMD` | No | Empty | Optional wrapper for external real prover |
| `GARAGA_REAL_PROVER_TIMEOUT_SECS` | No | `180` | Timeout for `garaga_prove_static.py` wrapper |

Dev shared mode example:
```bash
PRIVACY_AUTO_GARAGA_PROVER_CMD="python3 scripts/garaga_auto_prover.py"
PRIVACY_AUTO_GARAGA_PROVER_TIMEOUT_MS=45000
PRIVATE_ACTION_EXECUTOR_ADDRESS=0x07e18b8314a17989a74ba12e6a68856a9e4791ce254d8491ad2b4addc7e5bf8e
HIDE_BALANCE_EXECUTOR_KIND=shielded_pool_v2
HIDE_BALANCE_RELAYER_POOL_ENABLED=true
GARAGA_PRECOMPUTED_PAYLOAD_PATH=garaga_payload.json
GARAGA_ALLOW_PRECOMPUTED_PAYLOAD=true
GARAGA_DYNAMIC_BINDING=true
GARAGA_NULLIFIER_PUBLIC_INPUT_INDEX=0
GARAGA_COMMITMENT_PUBLIC_INPUT_INDEX=1
GARAGA_INTENT_HASH_PUBLIC_INPUT_INDEX=2
```

Strict production mode example:
```bash
PRIVACY_AUTO_GARAGA_PROVER_CMD="python3 scripts/garaga_auto_prover.py"
PRIVACY_AUTO_GARAGA_PROVER_TIMEOUT_MS=45000
PRIVATE_ACTION_EXECUTOR_ADDRESS=0x07e18b8314a17989a74ba12e6a68856a9e4791ce254d8491ad2b4addc7e5bf8e
HIDE_BALANCE_EXECUTOR_KIND=shielded_pool_v2
HIDE_BALANCE_RELAYER_POOL_ENABLED=true
GARAGA_PRECOMPUTED_PAYLOAD_PATH=
GARAGA_ALLOW_PRECOMPUTED_PAYLOAD=false
GARAGA_DYNAMIC_BINDING=false
GARAGA_PROVE_CMD="python3 /abs/path/to/real_prover.py"
GARAGA_VK_PATH=/abs/path/vk.json
GARAGA_PROOF_PATH=/tmp/zkcare_garaga/proof.json
GARAGA_PUBLIC_INPUTS_PATH=/tmp/zkcare_garaga/public_inputs.json
GARAGA_NULLIFIER_PUBLIC_INPUT_INDEX=0
GARAGA_COMMITMENT_PUBLIC_INPUT_INDEX=1
GARAGA_INTENT_HASH_PUBLIC_INPUT_INDEX=2
```

### AI and Rate Limiting
| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | No | Empty | Optional LLM provider key |
| `CAIRO_CODER_API_KEY` | No | Empty | Cairo Coder API key (`x-api-key`) |
| `CAIRO_CODER_API_URL` | No | `https://api.cairo-coder.com/v1/chat/completions` | Cairo Coder chat completion URL |
| `CAIRO_CODER_MODEL` | No | Empty | Optional model name forwarded to Cairo Coder request |
| `GEMINI_API_KEY` | No | Empty | Gemini API key |
| `GOOGLE_GEMINI_API_KEY` | No | Empty | Alias for Gemini key |
| `GEMINI_API_URL` | No | `https://generativelanguage.googleapis.com/v1beta` | Gemini base URL |
| `GEMINI_MODEL` | No | `gemini-2.0-flash` | Gemini model name |
| `AI_LEVEL_BURN_ADDRESS` | Recommended | Empty | Burn destination used to verify L2/L3 upgrade payments |
| `TWITTER_BEARER_TOKEN` | No | Empty | Optional token for social verification features |
| `TELEGRAM_BOT_TOKEN` | No | Empty | Optional token for social verification features |
| `DISCORD_BOT_TOKEN` | No | Empty | Optional token for social verification features |
| `AI_RATE_LIMIT_WINDOW_SECONDS` | No | `60` | Rate-limit window size |
| `AI_RATE_LIMIT_GLOBAL_PER_WINDOW` | No | `40` | Global AI cap/window |
| `AI_RATE_LIMIT_LEVEL_1_PER_WINDOW` | No | `20` | Tier 1 cap/window |
| `AI_RATE_LIMIT_LEVEL_2_PER_WINDOW` | No | `10` | Tier 2 cap/window |
| `AI_RATE_LIMIT_LEVEL_3_PER_WINDOW` | No | `8` | Tier 3 cap/window |
| `RATE_LIMIT_PUBLIC` | No | `100` | Global unauthenticated API cap/window |
| `RATE_LIMIT_AUTHENTICATED` | No | `300` | Authenticated API cap/window |

### Bridge Providers
| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `LAYERSWAP_API_KEY` | No | Empty | LayerSwap auth |
| `LAYERSWAP_API_URL` | No | `https://api.layerswap.io/api/v2` | LayerSwap base URL |
| `ATOMIQ_API_KEY` | No | Empty | Atomiq auth |
| `ATOMIQ_API_URL` | No | Empty | Atomiq base URL |
| `GARDEN_APP_ID` | Recommended for Garden | Empty | Garden app-id header |
| `GARDEN_API_KEY` | No | Empty | Legacy Garden auth alias |
| `GARDEN_API_URL` | No | Empty | Garden base URL |
| `BRIDGE_FORCE_GARDEN` | No | `false` | Force bridge route selection to Garden provider when available |
| `SUMO_LOGIN_API_KEY` | No | Empty | Sumo Login auth |
| `SUMO_LOGIN_API_URL` | No | Empty | Sumo Login base URL |
| `XVERSE_API_KEY` | No | Empty | Xverse auth |
| `XVERSE_API_URL` | No | Empty | Xverse base URL |
| `UNISAT_API_KEY` | No | Empty | UniSat API key for BTC reads |
| `BRIDGE_PROVIDER_IDS` | No | Empty | Provider felt mapping (`LayerSwap`, `Atomiq`, `Garden`, `StarkGate`) |

### Price Feeds
| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `ORACLE_ASSET_IDS` | No | Empty | Oracle symbol-to-id mapping |
| `PRICE_TOKENS` | No | `BTC,ETH,STRK,CAREL,USDT,USDC` | Price updater token set |
| `COINGECKO_API_URL` | No | `https://api.coingecko.com/api/v3` | CoinGecko base URL |
| `COINGECKO_API_KEY` | No | Empty | CoinGecko API key |
| `COINGECKO_IDS` | No | Empty | Symbol-to-CoinGecko id map |

### Optional Features
| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `TOKEN_STRK_ADDRESS` | No | Empty | STRK token address cache/source |
| `TOKEN_ETH_ADDRESS` | No | Empty | ETH token address cache/source |
| `TOKEN_BTC_ADDRESS` | No | Empty | BTC token address cache/source |
| `TOKEN_STRK_L1_ADDRESS` | No | Empty | L1 STRK token address |
| `SOCIAL_TASKS_JSON` | No | Empty | Dynamic social-task catalog JSON |
| `ADMIN_MANUAL_KEY` | No | Empty | Protects `/api/v1/admin/points/reset` |
| `DEV_WALLET_ADDRESS` | No | Empty | Dev wallet for paid rename verification |
| `DEV_WALLET` | No | Empty | Legacy alias for `DEV_WALLET_ADDRESS` |
| `FAUCET_BTC_AMOUNT` | No | Contract constant fallback | BTC faucet amount override |
| `FAUCET_STRK_AMOUNT` | No | Contract constant fallback | STRK faucet amount override |
| `FAUCET_CAREL_AMOUNT` | No | Contract constant fallback | CAREL faucet amount override |
| `FAUCET_COOLDOWN_HOURS` | No | Contract constant fallback | Faucet cooldown override |
| `FAUCET_CAREL_UNLIMITED` | No | `false` | Disables CAREL cooldown limits |
| `STRIPE_SECRET_KEY` | No | Empty | Fiat on-ramp provider key |
| `MOONPAY_API_KEY` | No | Empty | Fiat on-ramp provider key |
| `POINT_CALCULATOR_BATCH_SIZE` | No | `500` | Points worker batch size |
| `POINT_CALCULATOR_MAX_BATCHES_PER_TICK` | No | `20` | Max points batches per interval |

### Optional Dev/Debug
| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `STARKNET_API_RPC_URL` | No | Fallback to `STARKNET_RPC_URL` | API call RPC override |
| `STARKNET_INDEXER_RPC_URL` | No | Fallback to `STARKNET_RPC_URL` | Indexer RPC override |
| `STARKNET_RPC_MAX_INFLIGHT` | No | `6` | Max concurrent Starknet RPC requests |
| `EVM_RPC_MAX_INFLIGHT` | No | `8` | Max concurrent EVM RPC requests |
| `ENABLE_EVENT_INDEXER` | No | `true` | Enable/disable event indexer worker |
| `USE_STARKNET_RPC` | No | `false` | Toggle Starknet RPC scan path in indexer |
| `USE_BLOCK_PROCESSOR` | No | `false` | Use block processor mode for indexer |
| `RUN_EPOCH_JOBS` | No | `false` | Run epoch finalize jobs at startup |
| `INDEXER_INITIAL_BACKFILL_BLOCKS` | No | `128` | Initial indexer lookback window |
| `INDEXER_MAX_BLOCKS_PER_TICK` | No | `32` | Max blocks processed per indexer tick |
| `ENABLE_BTC_BRIDGE_WATCHER` | No | `false` | Enable BTC watcher process |
| `BTC_VAULT_ADDRESS` | No | Placeholder | Vault address watched by BTC bridge worker |
| `BTC_PRICE_API_URL` | No | CoinGecko simple price endpoint | BTC/USD source for bridge worker |
| `POINT_TOKEN_ADDRESS` | No | Empty | Bridge worker mint target (preferred) |
| `POINT_TOKEN_CONTRACT_ADDRESS` | No | Empty | Legacy alias for mint target |
| `BRIDGE_ADMIN_PRIVATE_KEY` | No | Uses `BACKEND_PRIVATE_KEY` | Bridge watcher signer key |
| `BRIDGE_ADMIN_ACCOUNT_ADDRESS` | No | Uses `BACKEND_ACCOUNT_ADDRESS` | Bridge watcher signer address |
| `DEFAULT_STARKNET_RECIPIENT` | No | Empty | BTC watcher fallback recipient |
| `BTC_TO_STARKNET_MAP` | No | Empty | JSON map for BTC address-to-Starknet recipient |
| `SWAP_CONTRACT_EVENT_ONLY` | No | `false` | Forces swap execute guard |
| `NEXT_PUBLIC_SWAP_CONTRACT_EVENT_ONLY` | No | `false` | Frontend alias accepted by backend |
| `NEXT_PUBLIC_STARKNET_SWAP_CONTRACT_ADDRESS` | No | Empty | Frontend alias fallback |
| `NEXT_PUBLIC_CAREL_PROTOCOL_ADDRESS` | No | Empty | Frontend alias fallback for event-only detection |
| `NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS` | No | Empty | Frontend alias fallback |
| `NEXT_PUBLIC_STARKNET_STAKING_CAREL_ADDRESS` | No | Empty | Frontend alias fallback |
| `NEXT_PUBLIC_STARKNET_STAKING_STABLECOIN_ADDRESS` | No | Empty | Frontend alias fallback |
| `NEXT_PUBLIC_STARKNET_STAKING_BTC_ADDRESS` | No | Empty | Frontend alias fallback |

## Current Sepolia Wiring
Active wiring currently used in this repo:

| Variable | Value |
| --- | --- |
| `PRIVATE_ACTION_EXECUTOR_ADDRESS` | `0x07e18b8314a17989a74ba12e6a68856a9e4791ce254d8491ad2b4addc7e5bf8e` |
| `HIDE_BALANCE_EXECUTOR_KIND` | `shielded_pool_v2` |
| `ZK_PRIVACY_ROUTER_ADDRESS` | `0x0682719dbe8364fc5c772f49ecb63ea2f2cf5aa919b7d5baffb4448bb4438d1f` |
| `STARKNET_SWAP_CONTRACT_ADDRESS` | `0x06f3e03be8a82746394c4ad20c6888dd260a69452a50eb3121252fdecacc6d28` |
| `LIMIT_ORDER_BOOK_ADDRESS` | `0x06b189eef1358559681712ff6e9387c2f6d43309e27705d26daff4e3ba1fdf8a` |
| `BATTLESHIP_GARAGA_ADDRESS` | `0x04ea26d455d6d79f185a728ac59cac029a6a5bf2a3ca3b4b75f04b4e8c267dd2` |
| `STAKING_CAREL_ADDRESS` | `0x06ed000cdf98b371dbb0b8f6a5aa5b114fb218e3c75a261d7692ceb55825accb` |
| `STAKING_STABLECOIN_ADDRESS` | `0x014f58753338f2f470c397a1c7ad1cfdc381a951b314ec2d7c9aec06a73a0aff` |
| `STAKING_BTC_ADDRESS` | `0x030098330968d105bf0a0068011b3f166e595582828dbbfaf8e5e204420b1f3b` |
| `PRIVACY_AUTO_GARAGA_PROVER_CMD` | `python3 scripts/garaga_auto_prover.py` |
| `GARAGA_ALLOW_PRECOMPUTED_PAYLOAD` | `true` |
| `GARAGA_DYNAMIC_BINDING` | `true` |
| `GARAGA_NULLIFIER_PUBLIC_INPUT_INDEX` | `0` |
| `GARAGA_COMMITMENT_PUBLIC_INPUT_INDEX` | `1` |
| `GARAGA_INTENT_HASH_PUBLIC_INPUT_INDEX` | `2` |

## API Endpoints by Domain

### Health
- `GET /health`

### Auth and Profile
- `POST /api/v1/auth/connect`
- `POST /api/v1/auth/refresh`
- `GET /api/v1/profile/me`
- `PUT /api/v1/profile/display-name`

### Trading
- `POST /api/v1/swap/quote`
- `POST /api/v1/swap/execute`
- `POST /api/v1/bridge/quote`
- `POST /api/v1/bridge/execute`
- `GET /api/v1/bridge/status/{bridge_id}`
- `POST /api/v1/limit-order/create`
- `GET /api/v1/limit-order/list`
- `DELETE /api/v1/limit-order/{order_id}`
- `GET /api/v1/stake/pools`
- `POST /api/v1/stake/deposit`
- `POST /api/v1/stake/withdraw`
- `POST /api/v1/stake/claim`
- `GET /api/v1/stake/positions`

### Garden Proxy
- `GET /api/v1/garden/volume`
- `GET /api/v1/garden/fees`
- `GET /api/v1/garden/chains`
- `GET /api/v1/garden/assets`
- `GET /api/v1/garden/liquidity`
- `GET /api/v1/garden/orders`
- `GET /api/v1/garden/orders/{order_id}`
- `GET /api/v1/garden/orders/{order_id}/instant-refund-hash`
- `GET /api/v1/garden/schemas/{name}`
- `GET /api/v1/garden/apps/earnings`

### Portfolio and Wallet
- `GET /api/v1/portfolio/balance`
- `GET /api/v1/portfolio/history`
- `GET /api/v1/portfolio/ohlcv`
- `GET /api/v1/portfolio/analytics`
- `POST /api/v1/wallet/onchain-balances`
- `POST /api/v1/wallet/link`
- `GET /api/v1/wallet/linked`

### Leaderboard and Rewards
- `GET /api/v1/leaderboard/{type}`
- `GET /api/v1/leaderboard/global`
- `GET /api/v1/leaderboard/global/{epoch}`
- `GET /api/v1/leaderboard/user/{address}`
- `GET /api/v1/leaderboard/user/{address}/categories`
- `GET /api/v1/rewards/points`
- `POST /api/v1/rewards/sync-onchain`
- `POST /api/v1/rewards/claim`
- `POST /api/v1/rewards/convert`

### Referral, NFT, Social, and Admin
- `POST /api/v1/nft/mint`
- `GET /api/v1/nft/owned`
- `GET /api/v1/referral/code`
- `GET /api/v1/referral/stats`
- `GET /api/v1/referral/history`
- `GET /api/v1/social/tasks`
- `POST /api/v1/social/verify`
- `POST /api/v1/admin/points/reset`

### Privacy and Private Apps
- `POST /api/v1/privacy/submit`
- `POST /api/v1/privacy/auto-submit`
- `POST /api/v1/privacy/prepare-private-execution`
- `POST /api/v1/private-btc-swap/initiate`
- `POST /api/v1/private-btc-swap/finalize`
- `GET /api/v1/private-btc-swap/nullifier/{nullifier}`
- `POST /api/v1/dark-pool/order`
- `POST /api/v1/dark-pool/match`
- `GET /api/v1/dark-pool/nullifier/{nullifier}`
- `POST /api/v1/private-payments/submit`
- `POST /api/v1/private-payments/finalize`
- `GET /api/v1/private-payments/nullifier/{nullifier}`
- `POST /api/v1/credentials/submit`
- `GET /api/v1/credentials/nullifier/{nullifier}`

### AI
- `POST /api/v1/ai/prepare-action`
- `GET /api/v1/ai/config`
- `POST /api/v1/ai/execute`
- `GET /api/v1/ai/pending`

### Battleship
- `POST /api/v1/battleship/create`
- `POST /api/v1/battleship/join`
- `POST /api/v1/battleship/place-ships`
- `POST /api/v1/battleship/fire`
- `POST /api/v1/battleship/respond`
- `POST /api/v1/battleship/claim-timeout`
- `GET /api/v1/battleship/state/{game_id}`

### Other API Domains
- Faucet: `POST /api/v1/faucet/claim`, `GET /api/v1/faucet/status`, `GET /api/v1/faucet/stats`
- Deposit: `POST /api/v1/deposit/bank-transfer`, `POST /api/v1/deposit/qris`, `POST /api/v1/deposit/card`, `GET /api/v1/deposit/status/{id}`
- Notifications: `GET /api/v1/notifications/list`, `POST /api/v1/notifications/mark-read`, `PUT /api/v1/notifications/preferences`, `GET /api/v1/notifications/stats`
- Transactions: `GET /api/v1/transactions/history`, `GET /api/v1/transactions/{tx_hash}`, `POST /api/v1/transactions/export`
- Charts/Market: `GET /api/v1/chart/{token}/ohlcv`, `GET /api/v1/chart/{token}/indicators`, `GET /api/v1/market/depth/{token}`
- Webhooks: `POST /api/v1/webhooks/register`, `GET /api/v1/webhooks/list`, `DELETE /api/v1/webhooks/{id}`, `GET /api/v1/webhooks/logs`

### WebSocket
- `GET /ws/notifications`
- `GET /ws/prices`
- `GET /ws/orders`

## Background Services
- Event indexer (`EventIndexer`) for Starknet events.
- Point calculator worker.
- Price updater worker.
- Limit order executor worker.
- Optional epoch finalization jobs (`RUN_EPOCH_JOBS`).
- Optional BTC bridge watcher (`ENABLE_BTC_BRIDGE_WATCHER`).

## Docker
Build image:
```bash
cd backend-rust
docker build -f docker -t carel-backend .
```

Run image:
```bash
docker run --env-file .env -p 8080:8080 -e HOST=0.0.0.0 carel-backend
```

Compose from monorepo root:
```bash
docker compose up --build backend postgres redis
```

## Operational Constraints
- Hide Mode improves unlinkability, but public chain metadata is still observable.
- Bridge flow depends on third-party provider availability.
- RPC rate limits can affect quotes, indexer progression, and wallet reads.
- TWAP currently uses a running average, not a strict fixed-time window.
- Gas targets are not met yet for AI rate-limit path (~4.9-5.1M) and TWAP (~3.4M).
- `MockGaragaVerifier` is for testnet only and must not be used on mainnet.
- Battleship state is currently stored in backend memory; full on-chain state is pending.
- No proxy upgrade mechanism is deployed; upgrades require redeploy plus migration.
