# CAREL Backend (Rust)

This backend is built with Rust + Axum for HTTP APIs and WebSocket. PostgreSQL is used for primary data storage, Redis for cache/session, and multiple background services run on startup.

## README Scope
- Dokumen ini fokus ke **teknis backend**: API, service, config, deployment, observability, troubleshooting.
- Untuk konteks produk, business model, dan roadmap level monorepo, lihat `README.md` di root.

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
- `PRIVACY_AUTO_GARAGA_PROVER_CMD` (wajib; prover command per-request, baca JSON dari stdin, output JSON berisi `nullifier`, `commitment`, `proof[]`, `public_inputs[]`)
- `PRIVACY_AUTO_GARAGA_PROVER_TIMEOUT_MS` (timeout command prover, default `45000`)
- `GARAGA_PROVE_CMD` (wajib; command prover real yang dijalankan oleh script bridge per request)
- `GARAGA_NULLIFIER_PUBLIC_INPUT_INDEX` + `GARAGA_COMMITMENT_PUBLIC_INPUT_INDEX` (default `0` + `1`, harus match urutan public input circuit)
- `GARAGA_INTENT_HASH_PUBLIC_INPUT_INDEX` (default `2`, dipakai flow hide executor untuk bind intent hash)
- `BATTLESHIP_GARAGA_ADDRESS` (opsional; alamat kontrak `BattleshipGaraga` untuk target integrasi on-chain mode game)
- `PRIVATE_ACTION_EXECUTOR_ADDRESS` (opsional tapi direkomendasikan; alamat hide executor on-chain: `PrivateActionExecutor` v1 atau `ShieldedPoolV2`)
- `HIDE_BALANCE_EXECUTOR_KIND` (default `private_action_executor_v1`; set `shielded_pool_v2` jika executor yang dipakai adalah `ShieldedPoolV2`)
- `HIDE_BALANCE_RELAYER_POOL_ENABLED` (default `true`; berlaku untuk hide-mode `swap` + `limit order` + `stake` via backend relayer/pool, tanpa `onchain_tx_hash` dari wallet user)
- `STAKING_STABLECOIN_ADDRESS` (opsional tapi direkomendasikan; target staking relayer untuk `USDC/USDT/STRK`)
- `STAKING_BTC_ADDRESS` (opsional tapi direkomendasikan; target staking relayer untuk `WBTC`)
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
- Hide Balance supports 2 modes:
  - Dev shared mode: team pakai `garaga_payload.json` + dynamic binding (mudah dipakai semua developer).
  - Strict production mode: prover real per-request (tanpa fallback static payload).
- Relayer/pool mode: backend submit call hide executor dari akun relayer, bukan dari wallet user (`swap|limit|stake`).
  - `PrivateActionExecutor` v1: `submit_private_intent + execute_private_*`
  - `ShieldedPoolV2`: `submit_private_action + execute_private_*`

Current Sepolia wiring used by this repo (latest):
- `PRIVATE_ACTION_EXECUTOR_ADDRESS=0x07e18b8314a17989a74ba12e6a68856a9e4791ce254d8491ad2b4addc7e5bf8e`
- `HIDE_BALANCE_EXECUTOR_KIND=shielded_pool_v2`
- `ZK_PRIVACY_ROUTER_ADDRESS=0x0682719dbe8364fc5c772f49ecb63ea2f2cf5aa919b7d5baffb4448bb4438d1f`
- `BATTLESHIP_GARAGA_ADDRESS=0x04ea26d455d6d79f185a728ac59cac029a6a5bf2a3ca3b4b75f04b4e8c267dd2`
- `STARKNET_SWAP_CONTRACT_ADDRESS=0x06f3e03be8a82746394c4ad20c6888dd260a69452a50eb3121252fdecacc6d28`
- `LIMIT_ORDER_BOOK_ADDRESS=0x06b189eef1358559681712ff6e9387c2f6d43309e27705d26daff4e3ba1fdf8a`
- `STAKING_CAREL_ADDRESS=0x06ed000cdf98b371dbb0b8f6a5aa5b114fb218e3c75a261d7692ceb55825accb`
- `STAKING_STABLECOIN_ADDRESS=0x014f58753338f2f470c397a1c7ad1cfdc381a951b314ec2d7c9aec06a73a0aff`
- `STAKING_BTC_ADDRESS=0x030098330968d105bf0a0068011b3f166e595582828dbbfaf8e5e204420b1f3b`

One-click auto prover command (dev shared mode):
```bash
# backend-rust/.env
PRIVACY_AUTO_GARAGA_PROVER_CMD="python3 scripts/garaga_auto_prover.py"
PRIVACY_AUTO_GARAGA_PROVER_TIMEOUT_MS=45000
HIDE_BALANCE_RELAYER_POOL_ENABLED=true
HIDE_BALANCE_EXECUTOR_KIND=shielded_pool_v2
GARAGA_PRECOMPUTED_PAYLOAD_PATH=garaga_payload.json
GARAGA_ALLOW_PRECOMPUTED_PAYLOAD=true
GARAGA_DYNAMIC_BINDING=true
GARAGA_PROVE_CMD=
GARAGA_NULLIFIER_PUBLIC_INPUT_INDEX=0
GARAGA_COMMITMENT_PUBLIC_INPUT_INDEX=1
```

One-click auto prover command (strict real per-request mode):
```bash
# backend-rust/.env
PRIVACY_AUTO_GARAGA_PROVER_CMD="python3 scripts/garaga_auto_prover.py"
PRIVACY_AUTO_GARAGA_PROVER_TIMEOUT_MS=45000

# Script input/output paths
GARAGA_VK_PATH=/home/frend/.cache/uv/archive-v0/2CAwRqVRwTyQG0W0y5eWE/lib/python3.10/site-packages/garaga/starknet/groth16_contract_generator/examples/snarkjs_vk_bls12381.json
GARAGA_PROOF_PATH=/home/frend/.cache/uv/archive-v0/2CAwRqVRwTyQG0W0y5eWE/lib/python3.10/site-packages/garaga/starknet/groth16_contract_generator/examples/snarkjs_proof_bls12381.json
GARAGA_PUBLIC_INPUTS_PATH=/home/frend/.cache/uv/archive-v0/2CAwRqVRwTyQG0W0y5eWE/lib/python3.10/site-packages/garaga/starknet/groth16_contract_generator/examples/snarkjs_public_bls12381.json
GARAGA_PRECOMPUTED_PAYLOAD_PATH=
GARAGA_ALLOW_PRECOMPUTED_PAYLOAD=false
GARAGA_PROVE_CMD="python3 /abs/path/to/your_real_prover.py"
GARAGA_NULLIFIER_PUBLIC_INPUT_INDEX=0
GARAGA_COMMITMENT_PUBLIC_INPUT_INDEX=1
```
`GARAGA_PROVE_CMD` menerima env:
- `GARAGA_CONTEXT_PATH` (JSON context request dari frontend/backend)
- `GARAGA_PROOF_PATH`
- `GARAGA_PUBLIC_INPUTS_PATH`
- `GARAGA_OUTPUT_DIR`

Contract expectation (router strict check):
- `public_inputs[0] == nullifier`
- `public_inputs[1] == commitment`

**Run Locally**
1. Start PostgreSQL + Redis (system services) or use docker-compose.
2. Fill `.env`.
3. Run:
```bash
cd backend-rust
cargo run
```
Migrations run automatically at startup.

**Quick Start (from repo root)**
```bash
./scripts/quick-start.sh
```
Stop:
```bash
./scripts/quick-stop.sh
```

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
- AI:
  - `GET /api/v1/ai/config` (runtime config untuk frontend: apakah executor terkonfigurasi + alamat executor)
  - `POST /api/v1/ai/prepare-action`
  - `POST /api/v1/ai/execute`
  - `GET /api/v1/ai/pending`
- Webhook: `POST /api/v1/webhooks/register`
- Privacy:
  - `POST /api/v1/privacy/submit` (manual submit payload)
  - `POST /api/v1/privacy/auto-submit` (auto-prepare payload dari file config backend, opsional auto submit on-chain)
  - `POST /api/v1/privacy/prepare-private-execution` (prepare hide-mode calldata untuk `PrivateActionExecutor`: `submit_private_intent + execute_private_*` untuk flow `swap|limit|stake`)
- Battleship:
  - `POST /api/v1/battleship/create`
  - `POST /api/v1/battleship/join`
  - `POST /api/v1/battleship/place-ships`
  - `POST /api/v1/battleship/fire`
  - `POST /api/v1/battleship/claim-timeout`
  - `GET /api/v1/battleship/state/{game_id}`
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
- Hide Balance auto-flow:
  - frontend bisa minta payload ke `POST /api/v1/privacy/auto-submit` (UI saat ini dipakai untuk swap Starknet ↔ Starknet),
  - backend prioritas jalankan `PRIVACY_AUTO_GARAGA_PROVER_CMD` (jika di-set),
  - fallback ke file payload real (bukan `0x1`) dari env `PRIVACY_AUTO_GARAGA_*`,
  - payload dikembalikan ke frontend untuk dipakai di call `submit_private_action` saat execute swap.
- Bridge policy saat ini:
  - destination `STRK` untuk route cross-chain diblokir (`Bridge -> STRK` disabled),
  - pair terkait `STRK` seperti `STRK/WBTC` harus lewat Swap di Starknet L2.
  - pair bridge yang didukung pada testnet saat ini: `ETH<->BTC`, `BTC<->WBTC`, `ETH<->WBTC`.
- Bridge flow validates on-chain tx hash receipt for source Starknet/Ethereum. Source BTC native (Garden order-first) can proceed without user tx hash at submit time.
- Battleship API saat ini state game disimpan di backend memory store (`OnceLock<RwLock<...>>`) untuk gameplay cepat. Kontrak `BattleshipGaraga` sudah tersedia di Sepolia untuk wiring on-chain tahap berikutnya.
- AI assistant:
  - level 1: free,
  - level 2: 1 CAREL,
  - level 3: 2 CAREL,
  - fee level 2/3 diproses on-chain lewat `AIExecutor.submit_action(...)`,
  - kontrak AI executor saat ini menarik fee lalu `burn(fee)` CAREL.
- Frontend dapat auto-resolve executor address via endpoint `GET /api/v1/ai/config`.
  - Jika `AI_EXECUTOR_ADDRESS` kosong/placeholder (`0x0000...`), endpoint akan menandai `executor_configured=false`.
  - Ini dipakai UI untuk menampilkan error setup yang lebih jelas sebelum user submit action on-chain.
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
