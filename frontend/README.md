# CAREL Protocol Frontend

Frontend web app untuk CAREL Protocol (Next.js App Router). Terhubung ke backend via REST + WebSocket dan menampilkan swap, bridge, limit order, staking, portfolio, leaderboard, rewards, dan referral.

## README Scope
- Dokumen ini fokus ke **teknis frontend**: setup, env vars, integrasi API/WS, wallet flow, build/deploy.
- Untuk konteks produk, business model, dan roadmap level monorepo, lihat `README.md` di root.

## Prasyarat
- Node.js >= 20.9.0
- npm

## Setup Lokal
```bash
npm install
npm run dev
```
Buka `http://localhost:3000`.

### Environment Variables
Buat `.env.local` jika perlu.
```
NEXT_PUBLIC_BACKEND_URL=http://localhost:8080
NEXT_PUBLIC_BACKEND_WS_URL=ws://localhost:8080
NEXT_PUBLIC_COINGECKO_API_KEY=CG-xxxx
NEXT_PUBLIC_COINGECKO_IDS=BTC=bitcoin,ETH=ethereum,STRK=starknet,USDC=usd-coin,USDT=tether
NEXT_PUBLIC_PRICE_FALLBACKS=CAREL=1,USDC=1,USDT=1
NEXT_PUBLIC_STRK_L1_TOKEN_ADDRESS=0xca14007eff0db1f8135f4c25b34de49ab0d42766
NEXT_PUBLIC_EVM_SEPOLIA_RPC_URL=https://rpc.sepolia.org
NEXT_PUBLIC_ETHERSCAN_SEPOLIA_URL=https://sepolia.etherscan.io
NEXT_PUBLIC_STARKNET_EXPLORER_URL=https://sepolia.voyager.online
NEXT_PUBLIC_STARKSCAN_SEPOLIA_URL=https://sepolia.starkscan.co
NEXT_PUBLIC_BTC_TESTNET_EXPLORER_URL=https://mempool.space/testnet4
NEXT_PUBLIC_BTC_TESTNET_FAUCET_URL=https://testnet4.info/
NEXT_PUBLIC_BTC_VAULT_ADDRESS=tb1qxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
NEXT_PUBLIC_STARKNET_SWAP_CONTRACT_ADDRESS=0x...
NEXT_PUBLIC_SWAP_CONTRACT_EVENT_ONLY=0
NEXT_PUBLIC_STARKNET_BRIDGE_AGGREGATOR_ADDRESS=0x...
NEXT_PUBLIC_ZK_PRIVACY_ROUTER_ADDRESS=0x...
NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS=0x...
NEXT_PUBLIC_HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED=true
NEXT_PUBLIC_HIDE_BALANCE_RELAYER_POOL_ENABLED=true
NEXT_PUBLIC_STARKGATE_ETH_BRIDGE_ADDRESS=0x8453FC6Cd1bCfE8D4dFC069C400B433054d47bDc
NEXT_PUBLIC_STARKGATE_ETH_TOKEN_ADDRESS=0x0000000000000000000000000000000000455448
NEXT_PUBLIC_TOKEN_CAREL_ADDRESS=0x...
NEXT_PUBLIC_TOKEN_STRK_ADDRESS=0x...
NEXT_PUBLIC_TOKEN_ETH_ADDRESS=0x...
NEXT_PUBLIC_TOKEN_BTC_ADDRESS=0x...
NEXT_PUBLIC_TOKEN_WBTC_ADDRESS=0x...
NEXT_PUBLIC_TOKEN_USDC_ADDRESS=0x...
NEXT_PUBLIC_TOKEN_USDT_ADDRESS=0x...
NEXT_PUBLIC_STARKNET_DISCOUNT_SOULBOUND_ADDRESS=0x...
NEXT_PUBLIC_DEV_WALLET_ADDRESS=0x...
NEXT_PUBLIC_ENABLE_DEV_GARAGA_AUTOFILL=false
```
Catatan:
- Jika `NEXT_PUBLIC_BACKEND_WS_URL` tidak diisi, WebSocket memakai `NEXT_PUBLIC_BACKEND_URL` dan otomatis mengganti `http` -> `ws`.
- `NEXT_PUBLIC_COINGECKO_API_KEY` opsional (demo key juga bisa). Tanpa key, fetch CoinGecko tetap mencoba tapi rate limit lebih ketat.
- `NEXT_PUBLIC_COINGECKO_IDS` opsional. Format `TOKEN=coingecko_id`.
- `NEXT_PUBLIC_PRICE_FALLBACKS` opsional. Format `TOKEN=harga_usd`.
- `NEXT_PUBLIC_STRK_L1_TOKEN_ADDRESS` opsional, dipakai untuk baca saldo `STRK L1 (ERC20)` di Ethereum Sepolia lewat wallet EVM.
- `NEXT_PUBLIC_EVM_SEPOLIA_RPC_URL` dipakai saat wallet EVM perlu auto-switch / add network ke Sepolia.
- `NEXT_PUBLIC_STARKNET_EXPLORER_URL` opsional. Jika diisi, dipakai sebagai explorer utama Starknet (contoh Voyager) untuk link tx di UI.
- `NEXT_PUBLIC_ETHERSCAN_SEPOLIA_URL`, `NEXT_PUBLIC_STARKSCAN_SEPOLIA_URL`, `NEXT_PUBLIC_BTC_TESTNET_EXPLORER_URL` dipakai untuk link explorer testnet.
- Flow BTC native via Garden bersifat order-first: klik execute untuk membuat order, lalu kirim BTC ke `deposit_address` yang dikembalikan backend (`result.to`). Tidak perlu input txid BTC di form sebelum order dibuat.
- `NEXT_PUBLIC_STARKNET_SWAP_CONTRACT_ADDRESS` dipakai untuk submit transaksi swap langsung dari wallet Starknet.
- Flow swap Starknet sekarang memakai calldata dari backend (`onchain_calls`) dan wallet men-submit multicall `approve + execute_swap` ke kontrak swap real.
- `NEXT_PUBLIC_ZK_PRIVACY_ROUTER_ADDRESS` wajib untuk flow `Hide Balance` on-chain pada **Swap / Limit Order / Stake di Starknet** (`submit_private_action` + action call).
- `NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS` menunjuk ke hide executor aktif (`PrivateActionExecutor` v1 atau `ShieldedPoolV2`).
- `NEXT_PUBLIC_HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED`:
  - `false` untuk mode relayer/pool (direkomendasikan demo) agar backend yang submit transaksi hide.
  - `true` jika mau jalur wallet-to-executor langsung dari frontend.
- `NEXT_PUBLIC_HIDE_BALANCE_RELAYER_POOL_ENABLED=true` mengaktifkan jalur relayer/pool untuk hide mode `swap`, `limit order`, dan `stake` (backend submit on-chain, bukan wallet user).
  - Untuk stake multi-pool relayer, pastikan class `PrivateActionExecutor` terbaru sudah dideploy (punya `preview_stake_target_intent_hash_with_approval` + `execute_private_stake_with_target_and_approval`).
- `NEXT_PUBLIC_ENABLE_DEV_GARAGA_AUTOFILL` default `false`. Set `true` hanya untuk test lokal dengan mock payload Garaga.
- Untuk flow one-click `Hide Balance` (swap/limit/stake Starknet relayer mode, plus fallback wallet path), frontend akan memanggil backend `POST /api/v1/privacy/auto-submit` saat payload belum ada. Backend harus dikonfigurasi dengan file proof real (`PRIVACY_AUTO_GARAGA_*`).
- Bridge ke target `STRK` saat ini dimatikan. Untuk pair seperti `STRK/WBTC`, gunakan mode **Swap** di Starknet L2 (bukan Bridge).
- Pair bridge yang didukung pada testnet saat ini: `ETH↔BTC`, `BTC↔WBTC`, dan `ETH↔WBTC`.
- Jika backend mengembalikan error aggregator belum siap (DEX router/oracle belum aktif), UI tidak akan mengizinkan execute swap.
- `NEXT_PUBLIC_SWAP_CONTRACT_EVENT_ONLY` opsional (`1/true` atau `0/false`). Jika aktif, UI akan memblokir execute swap karena kontrak dianggap event-only (belum transfer token real).
- Nilai `NEXT_PUBLIC_STARKNET_SWAP_CONTRACT_ADDRESS` harus mengarah ke kontrak swap **real token transfer** (bukan kontrak event-only). Jika masih menunjuk ke `CAREL_PROTOCOL_ADDRESS` event-only, UI/backend akan memblokir execute agar tidak misleading.
- `NEXT_PUBLIC_STARKNET_BRIDGE_AGGREGATOR_ADDRESS` dipakai untuk submit transaksi bridge langsung dari wallet Starknet.
- `NEXT_PUBLIC_STARKGATE_ETH_BRIDGE_ADDRESS` dan `NEXT_PUBLIC_STARKGATE_ETH_TOKEN_ADDRESS` dipakai untuk bridge langsung ETH Sepolia -> Starknet via StarkGate (MetaMask sign tx ke kontrak StarkGate).
- `NEXT_PUBLIC_TOKEN_*_ADDRESS` dipakai sebagai mapping token saat membangun calldata on-chain.
- `NEXT_PUBLIC_TOKEN_WBTC_ADDRESS` wajib diisi untuk pair yang melibatkan `WBTC` agar swap memakai token address real (UI akan blokir execute jika kosong).
- `NEXT_PUBLIC_STARKNET_DISCOUNT_SOULBOUND_ADDRESS` dipakai untuk mint NFT discount langsung on-chain dari wallet.
- `NEXT_PUBLIC_DEV_WALLET_ADDRESS` dipakai untuk rename display-name berbayar (transfer 1 CAREL on-chain).
- `NEXT_PUBLIC_STARKNET_AI_EXECUTOR_ADDRESS` opsional:
  - jika diisi, frontend langsung pakai value ini untuk `submit_action`;
  - jika kosong, frontend akan auto-fetch dari backend `GET /api/v1/ai/config`.

## Hide Balance (Garaga Real) Checklist
Gunakan checklist ini untuk **swap/limit order/stake Starknet private on-chain** (bukan mock, one-click).
Catatan:
- Mode Hide relayer/pool saat ini tersedia untuk Swap, Limit Order, dan Stake di Starknet L2 (STRK), tidak untuk Bridge.
- Bridge ke `STRK` nonaktif sementara. Jika butuh `STRK <-> WBTC`, lakukan lewat Swap Starknet.

1. Frontend env:
```bash
NEXT_PUBLIC_ZK_PRIVACY_ROUTER_ADDRESS=0x...
NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS=0x046a57b936093f3c5c7ea40512d8ca7a00e080b2881735f16a1a8760236d104c
NEXT_PUBLIC_HIDE_BALANCE_PRIVATE_EXECUTOR_ENABLED=false
NEXT_PUBLIC_HIDE_BALANCE_RELAYER_POOL_ENABLED=true
NEXT_PUBLIC_ENABLE_DEV_GARAGA_AUTOFILL=false
```
2. Di backend, set salah satu konfigurasi auto payload:
   - `PRIVACY_AUTO_GARAGA_PAYLOAD_FILE=/path/payload.json` (berisi `proof[]` + `public_inputs[]`), atau
   - `PRIVACY_AUTO_GARAGA_PROOF_FILE` + `PRIVACY_AUTO_GARAGA_PUBLIC_INPUTS_FILE`.
3. Restart backend dan hard reload frontend (Ctrl+Shift+R), tetap di browser profile yang sama.
4. User cukup klik icon `Hide Balance` lalu submit action on-chain (Swap / Create-Cancel Limit Order / Stake-Unstake):
   - frontend auto minta payload ke backend,
   - payload disimpan ke localStorage,
   - action lanjut tanpa isi manual form Privacy Router.
5. Verifikasi cepat di browser console:
```js
JSON.parse(localStorage.getItem("trade_privacy_garaga_payload_v2") || "null")
```
   - Harus berisi `nullifier`, `commitment`, `proof[]`, `public_inputs[]`.
   - Jika `proof/public_inputs` = `["0x1"]`, payload dianggap dummy dan akan ditolak untuk mode real.

Troubleshooting:
- Jika muncul pesan payload belum siap, cek backend env `PRIVACY_AUTO_GARAGA_*` dan pastikan file JSON valid.
- Jika di explorer field `proof` / `public_inputs` terlihat `["0x1"]`, payload masih dummy/mock. Pastikan autofill dev OFF dan kirim proof real.
- Jika error ini "kumat lagi", penyebab paling umum:
  - backend auto payload belum terkonfigurasi atau file tidak bisa dibaca,
  - cache/localStorage browser terhapus,
  - pindah browser/profile/tab private window.

## Build Production
```bash
npm run build
npm run start
```

## Docker
### Build
```bash
docker build -t zkcarel-frontend .
```

### Run
```bash
docker run --rm -p 3000:3000 \
  -e NEXT_PUBLIC_BACKEND_URL=http://host.docker.internal:8080 \
  -e NEXT_PUBLIC_BACKEND_WS_URL=ws://host.docker.internal:8080 \
  zkcarel-frontend
```
Buka `http://localhost:3000`.

### Docker Compose
```bash
cd ..
docker compose up --build frontend
```
Atau jalankan full stack dari root:
```bash
cd ..
docker compose up --build
```

## Struktur Direktori Singkat
```
app/              # Next.js App Router
components/       # UI & feature components
hooks/            # Custom hooks (wallet, notifications, dll)
lib/              # API client & utilities
styles/           # Global styles
public/           # Static assets
```

## Catatan Integrasi
- JWT disimpan di `localStorage` dengan key `auth_token` dan otomatis disertakan sebagai header `Authorization`.
- Session wallet juga disimpan (`wallet_address`, `wallet_provider`) agar reconnect otomatis saat reload.
- WebSocket notifications menggunakan query `?token=`.
- Wallet: frontend memakai injected Starknet wallet (Argent X/Braavos). Jika tidak ada, pengguna perlu connect wallet untuk mengakses fitur on-chain.
- Wallet SDK: memakai `@starknet-io/get-starknet` untuk Starknet, MetaMask (EVM) via `window.ethereum`, serta wallet BTC native testnet (UniSat/Xverse).
- Network enforcement: wallet di-validate ke `Starknet Sepolia`, `Ethereum Sepolia (11155111)`, dan `Bitcoin native testnet` (alamat testnet).
- AI Tier 2/3 membutuhkan `action_id` on-chain.
- Frontend mendukung auto-setup action_id:
  - cek pending action,
  - jika belum ada, call `POST /api/v1/ai/prepare-action`,
  - lalu wallet sign `submit_action` ke kontrak executor.
- Executor address tidak wajib hardcoded di env frontend; bisa auto-resolve dari backend runtime config (`GET /api/v1/ai/config`).
- Jika `signature_verification` pada AI executor aktif, backend harus mengisi `AI_SIGNATURE_VERIFIER_ADDRESS` agar endpoint prepare signature berjalan.
- AI level model di UI:
  - Level 1: FREE (basic queries, price check)
  - Level 2: 1 CAREL (auto swap/bridge execution)
  - Level 3: 2 CAREL (portfolio management, alerts)
- Fee level 2/3 dibayar saat submit action on-chain; kontrak executor menangani burn CAREL.
- Privacy Router tersedia lewat menu (More → Privacy Router) untuk submit proof V2/V1.
- Beberapa field angka dari backend dapat berupa `number` atau `string` (contoh: analytics/limit order/OHLCV). UI harus memperlakukan sebagai nilai numerik.
- Display name:
  - first set gratis,
  - rename berikutnya frontend akan minta wallet sign transfer `1 CAREL` ke dev wallet lalu kirim `rename_onchain_tx_hash` ke backend.
- Social tasks list dimuat dinamis dari backend (`GET /api/v1/social/tasks`), jadi penambahan task bisa dilakukan dari config backend tanpa ubah komponen UI.
