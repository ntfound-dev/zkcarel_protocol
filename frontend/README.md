# ZkCarel Frontend

Frontend web app untuk ZkCarel (Next.js App Router). Terhubung ke backend via REST + WebSocket dan menampilkan swap, bridge, limit order, staking, portfolio, leaderboard, rewards, dan referral.

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
NEXT_PUBLIC_STARKSCAN_SEPOLIA_URL=https://sepolia.starkscan.co
NEXT_PUBLIC_BTC_TESTNET_EXPLORER_URL=https://mempool.space/testnet
NEXT_PUBLIC_STARKNET_SWAP_CONTRACT_ADDRESS=0x...
NEXT_PUBLIC_STARKNET_BRIDGE_AGGREGATOR_ADDRESS=0x...
NEXT_PUBLIC_STARKGATE_ETH_BRIDGE_ADDRESS=0x8453FC6Cd1bCfE8D4dFC069C400B433054d47bDc
NEXT_PUBLIC_STARKGATE_ETH_TOKEN_ADDRESS=0x0000000000000000000000000000000000455448
NEXT_PUBLIC_TOKEN_CAREL_ADDRESS=0x...
NEXT_PUBLIC_TOKEN_STRK_ADDRESS=0x...
NEXT_PUBLIC_TOKEN_ETH_ADDRESS=0x...
NEXT_PUBLIC_TOKEN_BTC_ADDRESS=0x...
NEXT_PUBLIC_TOKEN_WBTC_ADDRESS=0x...
NEXT_PUBLIC_TOKEN_USDC_ADDRESS=0x...
NEXT_PUBLIC_TOKEN_USDT_ADDRESS=0x...
```
Catatan:
- Jika `NEXT_PUBLIC_BACKEND_WS_URL` tidak diisi, WebSocket memakai `NEXT_PUBLIC_BACKEND_URL` dan otomatis mengganti `http` -> `ws`.
- `NEXT_PUBLIC_COINGECKO_API_KEY` opsional (demo key juga bisa). Tanpa key, fetch CoinGecko tetap mencoba tapi rate limit lebih ketat.
- `NEXT_PUBLIC_COINGECKO_IDS` opsional. Format `TOKEN=coingecko_id`.
- `NEXT_PUBLIC_PRICE_FALLBACKS` opsional. Format `TOKEN=harga_usd`.
- `NEXT_PUBLIC_STRK_L1_TOKEN_ADDRESS` opsional, dipakai untuk baca saldo `STRK L1 (ERC20)` di Ethereum Sepolia lewat wallet EVM.
- `NEXT_PUBLIC_EVM_SEPOLIA_RPC_URL` dipakai saat wallet EVM perlu auto-switch / add network ke Sepolia.
- `NEXT_PUBLIC_ETHERSCAN_SEPOLIA_URL`, `NEXT_PUBLIC_STARKSCAN_SEPOLIA_URL`, `NEXT_PUBLIC_BTC_TESTNET_EXPLORER_URL` dipakai untuk link explorer testnet.
- `NEXT_PUBLIC_STARKNET_SWAP_CONTRACT_ADDRESS` dipakai untuk submit transaksi swap langsung dari wallet Starknet.
- `NEXT_PUBLIC_STARKNET_BRIDGE_AGGREGATOR_ADDRESS` dipakai untuk submit transaksi bridge langsung dari wallet Starknet.
- `NEXT_PUBLIC_STARKGATE_ETH_BRIDGE_ADDRESS` dan `NEXT_PUBLIC_STARKGATE_ETH_TOKEN_ADDRESS` dipakai untuk bridge langsung ETH Sepolia -> Starknet via StarkGate (MetaMask sign tx ke kontrak StarkGate).
- `NEXT_PUBLIC_TOKEN_*_ADDRESS` dipakai sebagai mapping token saat membangun calldata on-chain.

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
- Wallet SDK: memakai `@starknet-io/get-starknet` untuk Starknet, MetaMask (EVM) via `window.ethereum`, dan `sats-connect` untuk koneksi native Xverse (BTC testnet).
- Network enforcement: wallet di-validate ke `Starknet Sepolia`, `Ethereum Sepolia (11155111)`, dan `Bitcoin native testnet` (alamat testnet).
- AI Tier 2/3 membutuhkan `action_id` on-chain. Frontend bisa membuat `action_id` via wallet kalau `NEXT_PUBLIC_STARKNET_AI_EXECUTOR_ADDRESS` diisi.
- Jika `signature_verification` pada AI executor aktif, backend harus mengisi `AI_SIGNATURE_VERIFIER_ADDRESS` agar endpoint prepare signature berjalan.
- Privacy Router tersedia lewat menu (More → Privacy Router) untuk submit proof V2/V1.
- Beberapa field angka dari backend dapat berupa `number` atau `string` (contoh: analytics/limit order/OHLCV). UI harus memperlakukan sebagai nilai numerik.
