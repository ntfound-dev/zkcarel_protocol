# CAREL NFT (Discount Soulbound) — Architecture & Ops Guide

## 1) Ringkasan
**Discount Soulbound** adalah NFT non‑transferable (SBT) yang memberi diskon fee/benefit tertentu sesuai tier. NFT ini:
- Tidak bisa diperjualbelikan (transfer dikunci di smart contract).
- Menggunakan **Format 2 IPFS** (1 URI per tier) agar hemat gas.
- Dibayar dengan **Points** (on‑chain via `PointStorage`) dan **sinkron** dengan DB off‑chain.
- Mendukung alur **pending/confirmed** agar UX tidak time‑out ketika Starknet lambat.

## 2) Kontrak Utama (Cairo)
**File:** `smartcontract/starknet/cairo/src/nft/discount_soulbound.cairo`

Fitur kunci:
- `mint_nft(tier)`: mint berdasarkan tier (1‑5). Konsumsi poin dilakukan **on‑chain** melalui `PointStorage`.
- `token_uri(token_id)`: mengambil URI berdasarkan **tier** (Format 2 IPFS).
- `use_discount(user)`: menandai pemakaian diskon.
- `recharge_nft(token_id)`: top‑up kuota diskon dengan **biaya poin** (anti infinite‑loop).
- **Soulbound**: `transfer_from` dan `safe_transfer_from` selalu revert.

## 3) Alur Mint NFT (Backend → On‑chain → DB)
### 3.1 Endpoint Mint
**POST** `/api/v1/nft/mint`
Payload:
```json
{
  "tier": 3,
  "onchain_tx_hash": "0x..."
}
```

**Perilaku (Opsi A – Pending Flow):**
1. Backend **verifikasi tx hash**: memeriksa sender, target contract, dan calldata `mint_nft(tier)`.
2. Backend **menyimpan status** `pending` ke DB (`transactions`).
3. Backend merespons **HTTP 202** dengan `status=pending`.

### 3.2 Endpoint Status
**GET** `/api/v1/nft/status/{tx_hash}`

Respons:
```json
{
  "success": true,
  "data": {
    "status": "pending|confirmed|failed",
    "tx_hash": "0x...",
    "tier": 3,
    "nft": { /* hanya muncul saat confirmed */ },
    "message": "..."
  }
}
```

Jika `confirmed`:
- Backend **update DB status → confirmed**
- Backend **consume points** pada epoch aktif
- Cache NFT user di‑invalidate

Jika `failed`:
- Status DB di‑update ke `failed`
- Points **tidak** dipotong

### 3.3 Endpoint Owned
**GET** `/api/v1/nft/owned` untuk mengambil NFT user dari on‑chain (cache TTL + fallback).

## 4) Frontend Flow
File utama:
- `frontend/hooks/rewards/use-rewards-actions.ts`

Langkah:
1. User sync points on‑chain.
2. User sign `mint_nft` via wallet.
3. Frontend memanggil `/api/v1/nft/mint`.
4. Jika `pending`, UI menampilkan status + **poll** `/api/v1/nft/status/{tx_hash}` hingga confirmed/failed.

## 5) IPFS / Filecoin Integration (Format 2)
### 5.1 Konsep
- **1 URI per Tier** (Format 2).
- Kontrak menyimpan mapping `tier -> IPFS CID`.
- `token_uri(token_id)` mengembalikan CID berdasarkan tier NFT.

### 5.2 SDK & Ops
Backend memiliki modul Filecoin/IPFS:
- `backend-rust/src/services/filecoin.rs`
- `backend-rust/src/services/ipfs.rs`

**Konfigurasi (ENV):**
- `FILECOIN_PIN_API_URL`
- `FILECOIN_PIN_API_KEY`
- `FILECOIN_PIN_GATEWAY_URL`
- `IPFS_API_URL`
- `IPFS_GATEWAY_URL`

**Saran Praktis:**
- Upload metadata JSON (name, image, attributes) ke IPFS/Filecoin.
- Set CID per tier via admin setter (di Cairo).
- Simpan mapping tier → CID off‑chain agar mudah audit.

## 6) Database (DB) & Dampak
### 6.1 Tabel `transactions`
Kolom baru:
- `status`: `pending | confirmed | failed`
- `nft_tier`: `SMALLINT`

### 6.2 Alur Status
- Saat mint: insert `pending`.
- Saat confirmed: update `confirmed` + consume points.
- Saat failed: update `failed`, points **tidak dipotong**.

### 6.3 Dampak Operasional
- **UX stabil**: tidak ada timeout saat Starknet padat.
- **Keamanan points**: tidak ada deduct sebelum receipt sukses.
- **Auditability**: semua tx hash dapat ditelusuri dan punya status jelas.

## 7) Rate Limit (Relayer Safety)
File: `backend-rust/src/services/nft_discount.rs`

ENV:
- `NFT_DISCOUNT_RATE_LIMIT_WINDOW_SECS` (default 60)
- `NFT_DISCOUNT_RATE_LIMIT_MAX` (default 8)

Tujuan: mencegah DDoS spam `use_discount` yang menguras saldo gas relayer.

## 8) Masalah → Solusi (Checklist Audit)
| Masalah | Solusi | Status |
|---|---|---|
| Impersonasi (mint by others) | Verifikasi tx hash + sender | ✅ |
| Race condition (points terpotong padahal tx gagal) | Pending → confirmed flow | ✅ |
| Replay tx_hash | Unik di DB `transactions` | ✅ |
| Diskon infinite (recharge gratis) | Recharge pakai poin | ✅ |
| Gas relayer habis | Rate limit per user/action | ✅ |

## 9) Inovasi
- **Format 2 IPFS** hemat gas (1 URI per tier).
- **Pending/confirmed flow** seperti exchange profesional (Binance‑style UX).
- **On‑chain proof** untuk ownership tanpa signature tambahan di backend.

## 10) Quick Ops Checklist
1. Jalankan migration terbaru.
2. Set `DISCOUNT_SOULBOUND_ADDRESS`.
3. Set IPFS/Filecoin env var.
4. Pastikan frontend polling status mint.
5. Monitor log `nft_mint` di backend.

---
Jika mau, bisa ditambah bagian “Monitoring & Alerting” (Sentry / Grafana) untuk status pending yang stuck > X menit.
