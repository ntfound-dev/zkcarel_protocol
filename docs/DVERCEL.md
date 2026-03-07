# Frontend Deploy Testnet (Starknet Sepolia)

This document is focused on CAREL frontend deployment.

## Scope
- Deploy the Next.js frontend locally or on Vercel.
- Use a Rust backend that already exposes stable/public endpoints.

## Runtime Profile (MVP Proof)
To stay consistent with proof transactions in the root README:
- Frontend profile: `frontend/.env.local`
- Paired backend profile: `backend-rust/.env`
- Backend URL can be local (`http://localhost:<PORT>`) or an active public tunnel.
- Check actual values in `frontend/.env.local` and ensure the target backend is running with `backend-rust/.env`.
- If backend uses a different port (for example `3000` from template), update `NEXT_PUBLIC_BACKEND_URL` and `NEXT_PUBLIC_BACKEND_WS_URL`.

## Prerequisites
- Node `>=20.9.0` (recommended `20.11.1` matching `.nvmrc`)
- npm
- Frontend env already filled (`.env.local` or Vercel Environment Variables)

## 1) Local Run (Development/Test)
```bash
cd frontend
nvm use
npm install
npm run dev
```

Open: `http://localhost:3000`

## 2) Production Build (Local Validation)
```bash
cd frontend
nvm use
npm run build
npm run start
```

## 3) Vercel Deploy (Recommended for Demo)
1. Import project `frontend/` to Vercel.
2. Set all required `NEXT_PUBLIC_*` variables from `.env.example`.
3. Ensure backend URL uses a stable public endpoint (not a temporary tunnel unless needed).
4. Ensure target backend profile uses the same contract addresses as frontend profile.
5. Deploy.
6. After any `NEXT_PUBLIC_*` change, redeploy (recommended `without cache`).

## 4) Post-Deploy Checklist
- Starknet/EVM/BTC wallet connection works.
- Normal swap works.
- Hide swap works (relayer as sender).
- Normal + hide stake works.
- Normal + hide limit order works.
- Bridge quote + execute works.
- AI bridge (`bridge btc ...` / `bridge eth ...`) runs from Level 2.
- AI Level 3 bridge is disabled by default (`AI_LEVEL3_BRIDGE_ENABLED=false`).
- Explorer links and tx hashes are displayed correctly.

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
