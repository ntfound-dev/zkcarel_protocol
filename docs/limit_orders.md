# CAREL Limit Orders — API & Ops Guide

## 1) Ringkasan
Limit order berjalan lewat backend API (membuat, melihat, membatalkan) dan relayer/contract mengeksekusi saat harga tercapai. Dokumen ini menjelaskan endpoint utama yang dipakai UI.

## 2) Endpoint API
### 2.1 Create Limit Order
**POST** `/api/v1/limit-order/create`

Payload:
```json
{
  "from_token": "STRK",
  "to_token": "USDC",
  "amount": "10",
  "price": "1.2",
  "expiry": "1d",
  "recipient": "0x...",
  "client_order_id": "client-uuid",
  "onchain_tx_hash": "0x...",
  "hide_balance": true,
  "privacy": { "proof": [], "public_inputs": [], "payload": [] }
}
```

Response (contoh):
```json
{
  "success": true,
  "data": {
    "order_id": "0x...",
    "status": "submitted_onchain",
    "created_at": "2026-03-15T12:00:00Z",
    "nft_discount_percent": "5",
    "estimated_points_earned": "12.5",
    "points_pending": true,
    "privacy_tx_hash": "0x..."
  }
}
```

Catatan:
- `expiry`: `1d` | `7d` | `30d`.
- `hide_balance` + `privacy` dipakai untuk Hide Mode.

### 2.2 List Orders
**GET** `/api/v1/limit-order/list?status=active&page=1&limit=10`

Query:
- `status`: `active` | `filled` | `cancelled` (opsional)
- `page`, `limit`

Response:
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "order_id": "0x...",
        "owner": "0x...",
        "from_token": "STRK",
        "to_token": "USDC",
        "amount": "10",
        "filled": "0",
        "price": "1.2",
        "expiry": "2026-03-16T12:00:00Z",
        "recipient": "0x...",
        "status": 0,
        "created_at": "2026-03-15T12:00:00Z"
      }
    ],
    "page": 1,
    "limit": 10,
    "total": 42
  }
}
```

### 2.3 Cancel Order
**DELETE** `/api/v1/limit-order/{order_id}`

Payload:
```json
{
  "onchain_tx_hash": "0x...",
  "hide_balance": true,
  "privacy": { "proof": [], "public_inputs": [], "payload": [] }
}
```

Response:
```json
{
  "success": true,
  "data": "Order cancelled successfully"
}
```

## 3) Status Mapping
- `0` = active
- `1` = partially_filled
- `2` = filled
- `3` = cancelled
- `4` = expired

## 4) Frontend Usage
Frontend memakai client di:
- `frontend/lib/api/index.ts` → `createLimitOrder`, `listLimitOrders`, `cancelLimitOrder`

## 5) Ops Checklist
- Pastikan index DB `idx_limit_orders_owner_status` sudah aktif.
- Pastikan relayer/guardian menyinkronkan status `filled/cancelled` ke DB.
