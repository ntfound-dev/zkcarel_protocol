# Focus Milestones 2026-03-27

## Scope Freeze

- `BTC / shadow_btc` dipark sementara sebagai `artifacts-ready, deploy-pending`.
- Fokus aktif hanya:
  - `AI`
  - `Hide Balance V4: swap / limit order / stake / claim stake`
  - `NFT / IPFS`

## Current Baseline

- `Hide swap` verifier V4: deployed.
- `Hide limit order` verifier V4: deployed.
- `Hide stake / claim stake` verifier V4: deployed.
- `BTC / shadow_btc`: circuit, vk, stage, dan Cairo artifacts sudah ada, tetapi deploy belum tembus di device saat ini.

## Milestone 1: Stabilize Hide V4 Core

- Goal: `swap`, `limit order`, `stake`, dan `claim stake` hide mode stabil di testnet.
- Scope:
  - validasi end-to-end `swap`
  - validasi end-to-end `limit order`
  - validasi end-to-end `stake`
  - validasi `claim stake`
  - bersihkan error handling frontend/backend yang masih generik
- Exit criteria:
  - semua 4 flow berhasil minimal 1 kali di Sepolia
  - tidak ada lagi error generik yang menutupi akar masalah
  - runtime addresses dan verifier addresses terdokumentasi

## Milestone 2: AI Focus

- Goal: jalur AI kembali jadi fokus produk setelah hide core stabil.
- Scope:
  - audit runtime config AI
  - review payment / treasury / upgrade flow
  - review executor / relayer dependencies
  - pastikan error AI tidak mengganggu trade flow
- Exit criteria:
  - AI upgrade flow punya error message yang jelas
  - dependency env kritikal AI terdokumentasi
  - tidak ada regression ke trade / hide flow

## Milestone 3: NFT / IPFS

- Goal: NFT metadata dan IPFS flow rapih, predictable, dan siap dipakai produk.
- Scope:
  - audit metadata generation
  - audit pin / fetch / gateway fallback
  - audit ownership / mint dependencies
  - rapikan docs dan env untuk NFT/IPFS
- Exit criteria:
  - mint / metadata resolve berhasil konsisten
  - fallback gateway IPFS terdokumentasi
  - file / CID flow tidak ambigu

## Milestone 4: BTC Hide Backlog

- Status: parked.
- Current state:
  - `shadow_btc` rescue circuit sudah ada
  - bytecode sudah ada
  - vk sudah ada
  - Garaga stage dan Cairo dev artifacts sudah ada
  - on-chain declare / deploy belum selesai di device ini
- Unblock conditions:
  - host deploy yang lebih kuat, atau
  - jalur deploy yang tidak memaksa release rebuild berat di device sekarang

## Execution Order

1. `Hide swap / limit / stake / claim stake`
2. `AI`
3. `NFT / IPFS`
4. `BTC / shadow_btc`

## Notes

- Tidak ada `push` atau `commit`.
- Untuk sementara, jangan buka scope baru sebelum Milestone 1 clear.
