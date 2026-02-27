# Frontend Deploy Testnet (Starknet Sepolia)

Dokumen ini khusus deployment frontend CAREL.

## Scope
- Deploy frontend Next.js ke local atau Vercel.
- Menggunakan backend Rust yang sudah expose endpoint publik/stabil.

## Runtime Profile (MVP Proof)
Untuk konsisten dengan bukti tx di README:
- Frontend profile: `frontend/.env.local`
- Backend profile pasangan: `backend-rust/.env`
- Nilai URL backend bisa lokal (`http://localhost:<PORT>`) atau tunnel publik aktif.
- Cek nilai aktual di `frontend/.env.local` dan pastikan backend target benar-benar menjalankan profile `backend-rust/.env`.
- Jika backend pakai port lain (mis. `3000` dari template), update `NEXT_PUBLIC_BACKEND_URL` dan `NEXT_PUBLIC_BACKEND_WS_URL`.

## Prerequisites
- Node `>=20.9.0` (disarankan `20.11.1` sesuai `.nvmrc`)
- npm
- Env frontend sudah diisi (`.env.local` atau Vercel Environment Variables)

## 1) Local Run (Development/Test)
```bash
cd frontend
nvm use
npm install
npm run dev
```

Buka: `http://localhost:3000`

## 2) Production Build (Local Validation)
```bash
cd frontend
nvm use
npm run build
npm run start
```

## 3) Vercel Deploy (Recommended for Demo)
1. Import project `frontend/` ke Vercel.
2. Set semua `NEXT_PUBLIC_*` wajib dari `.env.example`.
3. Pastikan backend URL pakai endpoint publik stabil (bukan URL tunnel sementara jika tidak perlu).
4. Pastikan profile backend yang dituju memakai alamat kontrak yang sama dengan profile frontend.
5. Deploy.
6. Setiap ada perubahan `NEXT_PUBLIC_*`, lakukan redeploy (`without cache` disarankan).

## 4) Post-Deploy Checklist
- Wallet connect Starknet/EVM/BTC berhasil.
- Swap normal berhasil.
- Swap hide berhasil (sender relayer).
- Stake normal + hide berhasil.
- Limit order normal + hide berhasil.
- Bridge quote + execute berhasil.
- Explorer links dan tx hash tampil benar.

## 5) MVP Proof Links
- Normal Swap: https://sepolia.voyager.online/tx/0x22a53b1af0f7d62e19569a99b38d67e9165faad2804ca50a1b0a53f289bab98
- Hide Swap: https://sepolia.voyager.online/tx/0x71b6c99287c78b082d105dc7169faa56b419a3e2568b3ea9a70ef1ff653a2d2
- Normal Stake: https://sepolia.voyager.online/tx/0x3ffda88b060ad41b752e8410b13b567c2cca3aa1e32b29f60cf75d9f8b42d60
- Hide Stake: https://sepolia.voyager.online/tx/0x5fcac3b4578ebe8cf32dde9b0c6ab2390f1f1aa6bea731c3f779575abbdd4cf
- Normal Limit: https://sepolia.voyager.online/tx/0x737c40659dc5c7872ab1a89222d879bca68163b890a61f09b1875d52e4747a6
- Hide Limit: https://sepolia.voyager.online/tx/0x523c9721e57f69fddff4ed3be3935cce3b5782ca2c3b454df565c0be6b22ba3
- BTC bridge tx: https://mempool.space/testnet4/tx/d26a8f5d0213b4448722cde81e1f47e68b8efbd00c56ce4802e39c9b0898db4c
- Garden order: https://testnet-explorer.garden.finance/order/237be68816b9144b9d3533ca3ec8c4eb1e7c00b1649e9ec216d89469fd014e70
- ETH bridge tx: https://sepolia.etherscan.io/tx/0xab25b9261dc9f703e44cb89a34831ff03024b8fe89e32cce4a7e58b5d6dcdef3
