# ZkCarel Frontend

Frontend web app untuk ZkCarel (Next.js App Router). Terhubung ke backend via REST + WebSocket dan menampilkan swap, bridge, limit order, staking, portfolio, leaderboard, rewards, dan referral.

## Prasyarat
- Node.js >= 18 (disarankan 20)
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
```
Catatan:
- Jika `NEXT_PUBLIC_BACKEND_WS_URL` tidak diisi, WebSocket memakai `NEXT_PUBLIC_BACKEND_URL` dan otomatis mengganti `http` -> `ws`.

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
- WebSocket notifications menggunakan query `?token=`.
- Wallet: frontend memakai injected Starknet wallet (Argent X/Braavos). Jika tidak ada, fallback ke demo address.
- AI Tier 2/3 membutuhkan `action_id` on-chain (frontend meminta input).
- Privacy Router tersedia lewat menu (More → Privacy Router) untuk submit proof V2/V1.
