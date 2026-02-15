# ZkCarel / CAREL Protocol Monorepo

Monorepo ini adalah pusat produk ZkCarel (Web3 privacy-first trading).  
`README` root ini fokus ke **fitur produk dan model bisnis**.  
Detail teknis implementasi kode ada di:
- `backend-rust/README.md`
- `frontend/README.md`
- `smartcontract/README.md`

## Product Scope
- Unified user identity: 1 user dapat mengaitkan 3 address (`Starknet Sepolia` + `ETH Sepolia` + `BTC Testnet`).
- Trading core: swap, bridge, limit order, staking.
- Loyalty core: points, leaderboard, referral, social tasks.
- NFT utility: soulbound discount NFT untuk pengurangan fee transaksi.
- Privacy layer: privacy router + private actions (sesuai kontrak aktif).

## Business Model (Current)
- Points didapat dari aktivitas transaksi sukses (`swap`, `bridge`, `limit order`, `stake`).
- Points dipakai untuk mint NFT discount dan nantinya untuk konversi/claim rewards.
- Tier loyalty ditentukan oleh **NFT aktif on-chain**, bukan hanya angka points.
- NFT discount berlaku ke fee transaksi selama usage masih tersedia.

## AI Assistant

| Level | Cost | Features |
|---|---:|---|
| Level 1 | FREE | Basic queries, price check |
| Level 2 | 1 CAREL | Auto swap/bridge execution |
| Level 3 | 2 CAREL | Portfolio management, alerts |

Rules:
- Fee AI Level 2/3 dibayar on-chain via kontrak `AIExecutor`.
- Pembayaran CAREL untuk AI diproses sebagai fee dan diburn oleh kontrak (sesuai logic executor aktif).
- Akses Level 2/3 memerlukan `action_id` on-chain valid.

## Rewards Distribution
- Early testnet memakai pool distribusi sebesar **3% total supply CAREL**.
- Mainnet diarahkan ke distribusi bulanan dari alokasi ecosystem.
- Claim rewards dikenakan fee total **5%**.
- Estimasi reward user dihitung dari proporsi points user terhadap total points global (agregasi linked wallets user).

## NFT Discount System (Soulbound)

| Tier | Point Cost | Discount | Max Use |
|---|---:|---:|---:|
| Dasar | Free | 0% | ∞ |
| Bronze | 5,000 | 5% | 5 |
| Silver | 15,000 | 10% | 7 |
| Gold | 50,000 | 25% | 10 |
| Platinum | 150,000 | 35% | 15 |
| Onyx | 500,000 | 50% | 20 |

Rules:
- Soulbound (non-transferable).
- Unlimited mint (selama points cukup).
- NFT tidak diburn saat usage habis, status menjadi inactive.
- Usage berkurang hanya saat transaksi sukses.
- Upgrade tier dilakukan dengan mint tier lebih tinggi.

## Staking & Multiplier
- CAREL staking tier memengaruhi multiplier points global untuk aktivitas trading.
- User tanpa stake CAREL aktif tidak mendapat bonus multiplier (base multiplier tetap 1x).
- Produk staking lain (STRK/USDC/USDT/WBTC/BTC route) tetap mengikuti pool dan kontrak aktif.

## Referral Rules
- Bonus referral berlaku ke **referrer + referee**.
- Threshold aktivasi referral bonus: referee harus mencapai minimal **$20 transaksi sukses**.

## Social Task Points
- Twitter/X: Follow (5), Like (2), Retweet (3), Comment (10)
- Telegram: Join channel/group (5 per task)
- Discord: Join (5), Verify (10), Role (5)
- Task catalog dapat diperbarui tanpa ubah UI (via backend config).

## Repository Structure
- `smartcontract/` → Cairo contracts + deployment scripts
- `backend-rust/` → Rust API + background workers + indexing
- `frontend/` → Next.js UI
- `docs/` → supporting docs, integration notes

## Docker (Root Compose)
- File compose root: `docker-compose.yml`
- Start full stack:
  - `docker compose up --build`
- Service ports:
  - Frontend: `http://localhost:3000`
  - Backend API: `http://localhost:8080`
  - Postgres: `localhost:5432`
  - Redis: `localhost:6379`
- Backend env source default: `backend-rust/.env` (dengan override `DATABASE_URL` dan `REDIS_URL` ke service container).

## Technical Docs
- Backend technical/API/config: `backend-rust/README.md`
- Frontend technical/env/integration: `frontend/README.md`
- Smart contract architecture/deploy: `smartcontract/README.md`
- Additional notes: `docs/`

## License
MIT, see `LICENSE`.
