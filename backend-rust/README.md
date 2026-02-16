# CAREL Backend (Rust)

This backend is built with Rust + Axum for HTTP APIs and WebSocket. PostgreSQL is used for primary data storage, Redis for cache/session, and multiple background services run on startup.

**Architecture Summary**
- **HTTP API (Axum)**: Auth, swap, bridge, limit order, staking, portfolio, rewards, NFT, referral, social, faucet, deposit, notifications, transactions, charts, webhooks, AI.
- **WebSocket**: `notifications`, `prices`, `orders`.
- **Background Services**: event indexer, point calculator, price updater, limit order executor, snapshot/merkle job (optional).
- **Storage**: PostgreSQL (primary), Redis (notif/session pool).
- **Integrations**: Starknet/EVM RPC via HTTP, DEX/bridge aggregator (mock/heuristic in services).

**Folder Structure**
- `src/api`: HTTP handlers.
- `src/services`: business logic/background jobs.
- `src/indexer`: Starknet RPC + event parsing.
- `src/integrations`: third‑party integrations (bridge, etc).
- `src/models`: DTO + DB models.
- `src/websocket`: WS handlers.
- `migrations`: SQL schema/migrations.

**Main Flow**
1. `main.rs` loads config → connects DB → runs migrations → initializes Redis → builds router → starts background services → serves HTTP/WS.
2. Background services run in parallel (indexer, point calculator, price updater, limit order executor).
3. WebSocket streams push data to clients (notif/prices/orders).

**Configuration (.env)**
Required (minimum to boot API):
- `DATABASE_URL`
- `STARKNET_RPC_URL`
- `ETHEREUM_RPC_URL`
- `BACKEND_PRIVATE_KEY`, `BACKEND_PUBLIC_KEY`
- `JWT_SECRET`

Required for full on-chain integration (use placeholders for local-only dev):
- `CAREL_TOKEN_ADDRESS`
- `SNAPSHOT_DISTRIBUTOR_ADDRESS`
- `POINT_STORAGE_ADDRESS`
- `PRICE_ORACLE_ADDRESS`
- `LIMIT_ORDER_BOOK_ADDRESS`
- `AI_EXECUTOR_ADDRESS`
- `BRIDGE_AGGREGATOR_ADDRESS`
- `ZK_PRIVACY_ROUTER_ADDRESS`
- `PRIVATE_BTC_SWAP_ADDRESS`
- `DARK_POOL_ADDRESS`
- `PRIVATE_PAYMENTS_ADDRESS`
- `ANONYMOUS_CREDENTIALS_ADDRESS`

Optional (defaults apply if empty):
- `JWT_EXPIRY_HOURS`
- `FAUCET_*` (amount/cooldown/private key)
- `OPENAI_API_KEY`, `TWITTER_BEARER_TOKEN`, `TELEGRAM_BOT_TOKEN`, `DISCORD_BOT_TOKEN`
- `GEMINI_API_KEY` (Google Gemini API key)
- `GEMINI_API_URL` (default: `https://generativelanguage.googleapis.com/v1beta`)
- `GEMINI_MODEL` (default: `gemini-2.0-flash`)
- `AI_RATE_LIMIT_WINDOW_SECONDS` (default: `60`)
- `AI_RATE_LIMIT_GLOBAL_PER_WINDOW` (default: `40`)
- `AI_RATE_LIMIT_LEVEL_1_PER_WINDOW` (default: `20`)
- `AI_RATE_LIMIT_LEVEL_2_PER_WINDOW` (default: `10`)
- `AI_RATE_LIMIT_LEVEL_3_PER_WINDOW` (default: `8`)
- `POINT_CALCULATOR_BATCH_SIZE` (default: `500`, jumlah transaksi per batch saat kalkulasi points)
- `POINT_CALCULATOR_MAX_BATCHES_PER_TICK` (default: `20`, jumlah batch maksimum per interval worker)
- `PRIVACY_ROUTER_ADDRESS`
- `POINT_STORAGE_ADDRESS` (enables on-chain points→CAREL conversion)
- `STAKING_CAREL_ADDRESS` (optional, enables on-chain stake deposit/withdraw + position reads)
- `DISCOUNT_SOULBOUND_ADDRESS` (optional, enables on-chain NFT mint/discount reads)
- `TREASURY_ADDRESS` (optional, uses on-chain treasury balance as total distribution)
- `REFERRAL_SYSTEM_ADDRESS` (optional, enables on-chain referral syncing)
- `PRIVATE_BTC_SWAP_ADDRESS`, `DARK_POOL_ADDRESS`, `PRIVATE_PAYMENTS_ADDRESS`, `ANONYMOUS_CREDENTIALS_ADDRESS`
- `BRIDGE_PROVIDER_IDS` (map provider -> felt id)
  Example: `LayerSwap:0x4c535750,Atomiq:0x41544d51,Garden:0x47415244,StarkGate:0x53544754`
- `ORACLE_ASSET_IDS` (map token -> Pragma pair id for `TOKEN/USD`)
  Example: `BTC:18669995996566340,ETH:19514442401534788,STRK:6004514686061859652,USDT:6148333044652921668,USDC:6148332971638477636,CAREL:0`
  - `CAREL:0` berarti skip Pragma dan gunakan fallback price di `PriceOracle`.
- `PRICE_TOKENS` (list token untuk price updater, default: `BTC,ETH,STRK,CAREL,USDT,USDC`)
- `COINGECKO_API_URL` (default `https://api.coingecko.com/api/v3`)
- `COINGECKO_API_KEY` (opsional; pakai header `x-cg-demo-api-key`)
- `COINGECKO_IDS` (map symbol -> CoinGecko id)
  Example: `BTC:bitcoin,ETH:ethereum,STRK:starknet,USDT:tether,USDC:usd-coin`
- `LAYERSWAP_API_KEY`, `LAYERSWAP_API_URL`
- `ATOMIQ_API_KEY`, `ATOMIQ_API_URL`
- `GARDEN_APP_ID` (preferred) or `GARDEN_API_KEY` (legacy alias), `GARDEN_API_URL`
  - `GARDEN_APP_ID` is sent as header `garden-app-id` for Garden auth.
  - `GARDEN_API_URL` is the Garden base endpoint (ex: `https://testnet.api.garden.finance`).
- `SUMO_LOGIN_API_KEY`, `SUMO_LOGIN_API_URL`
- `XVERSE_API_KEY`, `XVERSE_API_URL`
- `PRIVACY_VERIFIER_ROUTERS` (map verifier -> router address)
- `SOCIAL_TASKS_JSON` (dynamic social task catalog tanpa ubah frontend)
  Example:
  ```json
  [
    { "id": "twitter_follow", "title": "X: Follow", "description": "Follow official X", "points": 5, "provider": "twitter" },
    { "id": "telegram_join_channel", "points": 5, "provider": "telegram" }
  ]
  ```
- `ADMIN_MANUAL_KEY` (aktifkan endpoint manual reset points)
- `DEV_WALLET_ADDRESS` (wajib untuk verifikasi rename display-name berbayar 1 CAREL)
- `SWAP_CONTRACT_EVENT_ONLY` (`1/true` untuk memblokir `/swap/quote` dan `/swap/execute` jika kontrak swap masih event-only)
- `STARKNET_SWAP_CONTRACT_ADDRESS` harus menunjuk kontrak swap real (interface `get_best_swap_route` + `execute_swap`) untuk flow wallet `approve + execute_swap`.
  - `/api/v1/swap/quote` sekarang mengembalikan `onchain_calls` siap-sign wallet (multicall `approve` lalu `execute_swap`).
  - Jika kontrak aggregator belum punya DEX router aktif/oracle quote, `/swap/quote` akan gagal dengan pesan konfigurasi aggregator belum siap.
  Example: `garaga:0x...,tongo:0x...,semaphore:0x...`
- `STRIPE_SECRET_KEY`, `MOONPAY_API_KEY`
- `RUN_EPOCH_JOBS`, `USE_STARKNET_RPC`, `USE_BLOCK_PROCESSOR`, `INDEXER_DIAGNOSTICS`

Testnet template:
- Copy `.env.testnet.example` and fill deployed contract addresses + keys.

**Run Locally**
1. Start PostgreSQL + Redis (system services) or use docker-compose.
2. Fill `.env`.
3. Run:
```bash
cd backend-rust
cargo run
```
Migrations run automatically at startup.

**Local Dev Without Docker (Recommended for low‑spec PC)**
Start services:
```bash
sudo service postgresql start
sudo service redis-server start

pg_isready
redis-cli ping
```

Initialize DB user + database (matches `.env` default):
```bash
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD '100720';"
sudo -u postgres createdb zkcare_db
```

If you want a different user/password, update `DATABASE_URL` in `.env`.

**WSL Build Note (Windows mount)**
If you build from `/mnt/c/...`, Rust sometimes fails with `failed to create encoded metadata`.
Use a Linux target dir:
```bash
export CARGO_TARGET_DIR=/home/frend/.cargo-target/zkcare_backend
cargo run
```

**Run Tests**
```bash
cd backend-rust
cargo test
```

**Smoke Test (API)**
Quick end-to-end check with curl:
```bash
cd backend-rust
./scripts/smoke_test_api.sh
```
Env overrides: `BASE_URL`, `AUTH_TOKEN`, `BRIDGE_*`, `ORDER_*`, `STAKE_*`.

**Docker**
Dockerfile: `backend-rust/docker`
```bash
docker build -f docker -t carel-backend .

docker run --env-file .env -p 8080:8080 \
  -e HOST=0.0.0.0 \
  carel-backend
```

**Docker Compose**
Gunakan compose root monorepo:
```bash
cd ..
docker compose up --build
```
Atau jalankan service backend saja:
```bash
cd ..
docker compose up --build backend postgres redis
```

**Key Endpoints**
- Health: `GET /health`
- Auth: `POST /api/v1/auth/connect`, `POST /api/v1/auth/refresh`
- Profile: `GET /api/v1/profile/me`, `PUT /api/v1/profile/display-name`
- Swap/Bridge: `POST /api/v1/swap/quote`, `POST /api/v1/bridge/quote`, `GET /api/v1/bridge/status/{bridge_id}`
- Orders: `POST /api/v1/limit-order/create`, `GET /api/v1/limit-order/list`
- Social: `GET /api/v1/social/tasks`, `POST /api/v1/social/verify`
- Admin manual: `POST /api/v1/admin/points/reset` (header `x-admin-key`)
- AI: `POST /api/v1/ai/execute`, `GET /api/v1/ai/pending`
- Webhook: `POST /api/v1/webhooks/register`
- Privacy: `POST /api/v1/privacy/submit` (auto‑detects V1 `ZkPrivacyRouter` vs V2 `PrivacyRouter`)
- Private BTC swap: `POST /api/v1/private-btc-swap/initiate`, `POST /api/v1/private-btc-swap/finalize`
- Dark pool: `POST /api/v1/dark-pool/order`, `POST /api/v1/dark-pool/match`
- Private payments: `POST /api/v1/private-payments/submit`, `POST /api/v1/private-payments/finalize`
- Anonymous credentials: `POST /api/v1/credentials/submit`
- Nullifier checks:
  - `GET /api/v1/credentials/nullifier/{nullifier}`
  - `GET /api/v1/dark-pool/nullifier/{nullifier}`
  - `GET /api/v1/private-payments/nullifier/{nullifier}`
  - `GET /api/v1/private-btc-swap/nullifier/{nullifier}`
- Leaderboard global metrics: `GET /api/v1/leaderboard/global`
- Leaderboard global metrics (epoch): `GET /api/v1/leaderboard/global/{epoch}`

**WebSocket**
- `GET /ws/notifications`
- `GET /ws/prices`
- `GET /ws/orders`

**Technical Notes**
- Testnet mode (`ENVIRONMENT=development/testnet`) changes several calculations (gas/score).
- `RUN_EPOCH_JOBS=1` triggers epoch finalize + merkle root at startup.
- `USE_STARKNET_RPC=1` & `USE_BLOCK_PROCESSOR=1` enable full RPC indexer.
- Rewards conversion (`/api/v1/rewards/convert`) uses on-chain `PointStorage.convert_points_to_carel(...)` when `POINT_STORAGE_ADDRESS` is configured.
- Event indexer reads contract addresses from `.env` and skips placeholder `0x0000...` entries. Populate `BRIDGE_AGGREGATOR_ADDRESS`, `SNAPSHOT_DISTRIBUTOR_ADDRESS`, `LIMIT_ORDER_BOOK_ADDRESS`, plus optional `STAKING_CAREL_ADDRESS`/`REFERRAL_SYSTEM_ADDRESS` to enable indexing.
- Private flow supports verifier selector per request: `garaga|tongo|semaphore`. If omitted, default is `garaga`.
- Bridge flow validates on-chain tx hash receipt for source Starknet/Ethereum. Source BTC native (Garden order-first) can proceed without user tx hash at submit time.
- AI assistant:
  - level 1: free,
  - level 2: 1 CAREL,
  - level 3: 2 CAREL,
  - fee level 2/3 diproses on-chain lewat `AIExecutor.submit_action(...)`,
  - kontrak AI executor saat ini menarik fee lalu `burn(fee)` CAREL.
- AI action guard per level aktif:
  - level 1 hanya read-only query (price/balance/points/market),
  - level 2 hanya swap/bridge,
  - level 3 hanya portfolio/alert.
- AI rate limiter per-user aktif via Redis (bucket global + mode on-chain/off-chain).
- Jika `GEMINI_API_KEY` terisi, backend akan memakai Gemini untuk menyusun response natural language (dengan fallback ke deterministic intent bila Gemini error/timeout).
- Display-name rename flow:
  - first set display name: gratis (langsung tersimpan di backend),
  - rename berikutnya wajib transfer `>=1 CAREL` ke `DEV_WALLET_ADDRESS`,
  - client kirim `rename_onchain_tx_hash`,
  - backend verifikasi sender + calldata `transfer` + receipt confirmed di Starknet sebelum update nama,
  - tx hash disimpan sebagai `rename_fee` untuk mencegah reuse/replay.
- Manual reset points:
  - endpoint `POST /api/v1/admin/points/reset`,
  - mode per-user (`user_address`) atau global (`reset_all=true`),
  - opsional `clear_transactions=true` untuk hapus histori transaksi terkait points.

**Latest Integration Update**
- Detail perubahan bridge verification, provider routing, dynamic verifier selector, dan link referensi: `../docs/integration_update_2026_02_13.md`

**Example Payloads**
Auth connect (Sumo Login)
```json
{
  "address": "0x1234",
  "signature": "",
  "message": "",
  "chain_id": 0,
  "sumo_login_token": "sumo_token_here"
}
```
Private BTC swap (initiate)
```json
{
  "ciphertext": "0x1234",
  "commitment": "0xabcd",
  "proof": ["0x1", "0x2"],
  "public_inputs": ["0x99"]
}
```
Private BTC swap (finalize)
```json
{
  "swap_id": 1,
  "recipient": "0x123456",
  "nullifier": "0xdeadbeef",
  "proof": ["0x1", "0x2"],
  "public_inputs": ["0x99"]
}
```
Bridge execute with Xverse recipient
```json
{
  "from_chain": "btc",
  "to_chain": "starknet",
  "token": "BTC",
  "amount": "0.01",
  "recipient": "0x1234...",
  "xverse_user_id": "user_123",
  "onchain_tx_hash": "fa28fab8ae02404513796fbb4674347bff278e8806c8f5d29fecff534e94a07d"
}
```
Dark pool submit
```json
{
  "ciphertext": "0xaaaa",
  "commitment": "0xbbbb",
  "proof": ["0x1"],
  "public_inputs": ["0x2"]
}
```
Dark pool match
```json
{
  "order_id": 1,
  "nullifier": "0x1111",
  "proof": ["0x1"],
  "public_inputs": ["0x2"]
}
```
Private payments submit
```json
{
  "ciphertext": "0xaaaa",
  "commitment": "0xbbbb",
  "amount_commitment": "0xcccc",
  "proof": ["0x1"],
  "public_inputs": ["0x2"]
}
```
Private payments finalize
```json
{
  "payment_id": 1,
  "recipient": "0x123456",
  "nullifier": "0x2222",
  "proof": ["0x1"],
  "public_inputs": ["0x2"]
}
```
Anonymous credentials submit
```json
{
  "nullifier": "0x3333",
  "proof": ["0x1"],
  "public_inputs": ["0x2"]
}
```
Nullifier check response
```json
{
  "nullifier": "0xdeadbeef",
  "used": true
}
```

**Integrations Roadmap (Backend)**
- ZK social login dApp using Sumo Login (privacy auth).
- BTC wallet + bridge integration using Xverse API.

**Leaderboard Global Metrics**
- Global points, total volume, and total referrals are aggregated on the backend and exposed via leaderboard endpoints for analytics and UI widgets.
Privacy submit (V2 / PrivacyRouter)
```json
{
  "action_type": "BRIDGE",
  "old_root": "0x1",
  "new_root": "0x2",
  "nullifiers": ["0xaaa"],
  "commitments": ["0xbbb"],
  "proof": ["0x1"],
  "public_inputs": ["0x2"]
}
```
Privacy submit (V1 / ZkPrivacyRouter)
```json
{
  "nullifier": "0xaaa",
  "commitment": "0xbbb",
  "proof": ["0x1"],
  "public_inputs": ["0x2"]
}
```

AI execute (Tier 2/3 requires `action_id`)
```json
{
  "command": "analyze",
  "context": "tier:2",
  "level": 2,
  "action_id": 12
}
```

AI prepare signature window (for signature_verification ON)
```json
{
  "level": 2,
  "context": "tier:2",
  "window_seconds": 45
}
```

Rewards convert (epoch/distribution optional)
```json
{
  "points": 1200,
  "epoch": 5,
  "total_distribution_carel": 27777777.77
}
```
