# CAREL MVP - Analisis Bukti Transaksi (Normal vs Hide + Bridge)

Dokumen ini menganalisis 9 link bukti transaksi yang kamu kirim, berbasis data on-chain dan env runtime lokal.

Snapshot verifikasi: **25 Februari 2026**.

## 1) Problem dan Solusi (Fokus Smart Contract)

### Problem
- Sulit membedakan jalur kontrak yang benar-benar aktif di MVP vs kontrak yang ada untuk roadmap.
- Narasi `normal` vs `hide` sering tercampur, padahal jejak on-chain-nya berbeda.
- Perlu bukti yang bisa dicek juri langsung tanpa asumsi.

### Solusi
- Pegang `env` sebagai source of truth runtime.
- Validasi tx langsung dari receipt/calldata/event (bukan hanya dari UI).
- Fokus hide mode aktif di `smartcontract/private_executor_lite` (`ShieldedPoolV2`), bukan `garaga_real_bls`.

## 2) Source of Truth Env yang Dipakai

- `backend-rust/.env`
- `smartcontract/.env`
- `frontend/.env.local`

Nilai kunci yang konsisten di 3 env:
- `HIDE_BALANCE_EXECUTOR_KIND=shielded_pool_v2`
- `PRIVATE_ACTION_EXECUTOR_ADDRESS=0x060549e87e71903ffe1e6449aaa1e77d941de1a5117be3beabd0026d847c61fb`
- `SWAP_AGGREGATOR_ADDRESS=0x06f3e03be8a82746394c4ad20c6888dd260a69452a50eb3121252fdecacc6d28`
- `LIMIT_ORDER_BOOK_ADDRESS=0x06b189eef1358559681712ff6e9387c2f6d43309e27705d26daff4e3ba1fdf8a`
- `STAKING_STABLECOIN_ADDRESS=0x014f58753338f2f470c397a1c7ad1cfdc381a951b314ec2d7c9aec06a73a0aff`

Catatan penting:
- `ZK_PRIVACY_ROUTER_ADDRESS` pada `smartcontract/.env` bisa berbeda dengan profile runtime (`backend-rust/.env` + `frontend/.env.local`).
- Bukti tx MVP mengikuti profile runtime aktif, bukan semata katalog deploy smartcontract.

## 3) Hasil Uji Lokal Smart Contract

Dilakukan dari folder `smartcontract`:

- `bash scripts/test_core_fast.sh` -> **166 passed, 0 failed**
- `bash scripts/test_private_executor_lite.sh` -> **12 passed, 0 failed**

Jadi jalur SC utama + hide mode aktif terverifikasi jalan lokal.

## 4) Analisis 6 Tx Starknet (Normal vs Hide)

Alamat sender yang terdeteksi:
- User wallet (normal): `0x469de079832d5da0591fc5f8fd2957f70b908d62c5d0dcb057d030cfc827705`
- Relayer (hide): `0x289f797b9c2dc6c661fd058968d9ba39d01c7547f8259f01b7bce55696d0ff0`

Semua tx di bawah status: `ACCEPTED_ON_L1` + `SUCCEEDED`.

| Flow | Link | Sender on-chain | Kontrak aksi terdeteksi | Emitter `ShieldedPoolV2` (`0x060549...c61fb`) |
| --- | --- | --- | --- | --- |
| Normal Swap | https://sepolia.voyager.online/tx/0x22a53b1af0f7d62e19569a99b38d67e9165faad2804ca50a1b0a53f289bab98 | User wallet | `SwapAggregator` (`0x06f3...`) | Tidak ada |
| Hide Swap | https://sepolia.voyager.online/tx/0x71b6c99287c78b082d105dc7169faa56b419a3e2568b3ea9a70ef1ff653a2d2 | Relayer | `SwapAggregator` + executor | Ada |
| Normal Stake | https://sepolia.voyager.online/tx/0x3ffda88b060ad41b752e8410b13b567c2cca3aa1e32b29f60cf75d9f8b42d60 | User wallet | `StakingStablecoin` (`0x014f...`) | Tidak ada |
| Hide Stake | https://sepolia.voyager.online/tx/0x5fcac3b4578ebe8cf32dde9b0c6ab2390f1f1aa6bea731c3f779575abbdd4cf | Relayer | `StakingStablecoin` + executor | Ada |
| Normal Limit | https://sepolia.voyager.online/tx/0x737c40659dc5c7872ab1a89222d879bca68163b890a61f09b1875d52e4747a6 | User wallet | `LimitOrderBook` (`0x06b1...`) | Tidak ada |
| Hide Limit | https://sepolia.voyager.online/tx/0x523c9721e57f69fddff4ed3be3935cce3b5782ca2c3b454df565c0be6b22ba3 | Relayer | `LimitOrderBook` + executor | Ada |

## 5) Bukti Path Proof di Hide Mode (Dari Calldata)

Ketiga tx hide (`swap`, `stake`, `limit`) punya pola call yang sama:

1. `set_asset_rule`
2. `deposit_fixed_for`
3. `submit_private_action` (payload besar: `2322` field)
4. `execute_private_*` (sesuai action: swap/stake/limit)

Temuan penting:
- `sender_address` tx hide adalah relayer, bukan wallet user.
- Wallet user masih muncul di calldata sebagai bagian binding data (bukan sebagai sender).
- Ini konsisten dengan jalur `ShieldedPoolV2` di `private_executor_lite`.

## 6) Analisis 3 Bukti Bridge

### A) BTC Bridge Tx
- Link: https://mempool.space/testnet4/tx/d26a8f5d0213b4448722cde81e1f47e68b8efbd00c56ce4802e39c9b0898db4c
- Hasil:
  - Confirmed: `true`
  - Block: `123447`
  - Fee: `153 sats`
  - Output utama: `50000 sats` (0.0005 BTC)

### B) Garden Order
- Link: https://testnet-explorer.garden.finance/order/237be68816b9144b9d3533ca3ec8c4eb1e7c00b1649e9ec216d89469fd014e70
- Verifikasi API Garden (`/v2/orders/<id>`) menunjukkan:
  - `integrator`: `DocsTesting`
  - `created_at`: `2026-02-23T23:47:35Z`
  - Source: `bitcoin_testnet:btc`, amount `50000`
  - Source initiate tx: `d26a8f5d...:123447` (match BTC tx di atas)
  - Destination: `starknet_sepolia:wbtc`, amount `49850`

### C) ETH Bridge Tx
- Link: https://sepolia.etherscan.io/tx/0xab25b9261dc9f703e44cb89a34831ff03024b8fe89e32cce4a7e58b5d6dcdef3
- Hasil:
  - Status: `0x1` (success)
  - Value: `0.005 ETH`
  - `from`: `0x834de729cb9df77451dbc6bf7fd05f475b011ac7`
  - `to`: `0x006caa2c35c9f4df23dbf4985616ef2a8829bf22`

Catatan: dari data order Garden di atas, flow yang terkoneksi langsung adalah BTC -> WBTC. Tx ETH di sini valid, tapi tidak terikat langsung ke `order_id` tersebut dari payload yang dianalisis.

## 7) Kesimpulan Jujur untuk Juri

1. Perbedaan `normal` vs `hide` **terbukti on-chain**: normal dikirim wallet user, hide dikirim relayer.
2. Hide mode aktif MVP berjalan di `private_executor_lite/ShieldedPoolV2`, bukan jalur `garaga_real_bls`.
3. Jalur hide benar-benar memanggil `submit_private_action` + `execute_private_*` di tx yang sama.
4. Bukti bridge valid: BTC tx confirmed, Garden order match ke BTC tx, ETH tx juga success.
