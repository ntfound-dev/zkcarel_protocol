# Integration Update - 2026-02-13

Dokumen ini merangkum perubahan implementasi terbaru untuk flow on-chain bridge, provider routing, dan dynamic privacy verifier selector.

## Scope Perubahan

1. Bridge verification diperketat agar benar-benar on-chain.
2. Pemilihan provider bridge tidak lagi diam-diam fallback ke simulasi saat config kosong.
3. Selector verifier `garaga|tongo|semaphore` sekarang dinamis per request, tetap backward-compatible default `garaga`.
4. Dokumentasi env/config dan endpoint diperbarui.

## 1) Bridge On-Chain Verification (Backend)

Perubahan:
1. `onchain_tx_hash` bridge sekarang diverifikasi ke chain sesuai `from_chain`:
2. `starknet`: cek receipt, finality, dan status revert.
3. `ethereum`: panggil `eth_getTransactionReceipt`, validasi `status` dan `blockNumber`.
4. `bitcoin`: tetap validasi format txid, settlement asinkron via provider.
5. `block_number` transaksi bridge di DB sekarang diisi dari hasil verifikasi chain (bukan default `0`).

File terkait:
1. `backend-rust/src/api/bridge.rs`

## 2) Provider Routing Tanpa Fallback Diam-Diam

Perubahan:
1. `RouteOptimizer` hanya memilih provider yang benar-benar aktif/configured.
2. Konfigurasi dianggap non-aktif jika kosong atau nilai sentinel (`DISABLED`, `CHANGE_ME`, `REPLACE_ME`).
3. Atomiq bisa dinonaktifkan eksplisit via env tanpa menghapus kode.

File terkait:
1. `backend-rust/src/services/route_optimizer.rs`

## 3) Adapter Provider Real API

Perubahan `LayerSwap`:
1. Menggunakan header `X-LS-APIKEY`.
2. Endpoint quote/execute diperbarui sesuai integrasi API saat ini.
3. Error API sekarang di-return eksplisit (tidak fallback simulasi diam-diam).

Perubahan `Garden`:
1. Menggunakan header `garden-app-id`.
2. Menggunakan endpoint `v2` untuk quote/order.
3. Konversi amount ke base units dan parsing response `v2`.
4. Error API di-return eksplisit.

File terkait:
1. `backend-rust/src/integrations/bridge/layerswap.rs`
2. `backend-rust/src/integrations/bridge/garden.rs`

## 4) Dynamic Privacy Verifier Selector (Backward-Compatible)

Perubahan:
1. Request private flow bisa memilih verifier via field opsional:
2. `garaga`, `tongo`, atau `semaphore`.
3. Jika field tidak dikirim, default otomatis `garaga`.
4. Router address per verifier diambil dari env map:
5. `PRIVACY_VERIFIER_ROUTERS=garaga:0x...,tongo:0x...,semaphore:0x...`
6. Flow ini diterapkan di:
7. `POST /api/v1/swap/execute` (via `privacy.verifier`)
8. `POST /api/v1/bridge/execute` (via `privacy.verifier`)
9. `POST /api/v1/privacy/submit` (via `verifier`)

File terkait:
1. `backend-rust/src/services/privacy_verifier.rs`
2. `backend-rust/src/api/swap.rs`
3. `backend-rust/src/api/bridge.rs`
4. `backend-rust/src/api/privacy.rs`
5. `backend-rust/src/config.rs`
6. `backend-rust/.env`
7. `backend-rust/.env.testnet.example`

## 5) Konfigurasi Environment Baru

Tambahan config:
1. `PRIVACY_VERIFIER_ROUTERS`

Contoh:
```env
PRIVACY_VERIFIER_ROUTERS=garaga:0x00694e35433fe3ce49431e1816f4d4df9ab6d550a3f73f8f07f9c2cc69b6891b,tongo:0x...,semaphore:0x...
```

Catatan:
1. Jika hanya `garaga` yang diisi, request `tongo`/`semaphore` akan ditolak dengan error konfigurasi.
2. Ini sengaja agar tidak ada fallback salah-verifier secara silent.

## 6) Contoh Payload

Swap execute (private + default verifier garaga):
```json
{
  "from_token": "STRK",
  "to_token": "USDC",
  "amount": "10",
  "min_amount_out": "9.9",
  "slippage": 0.5,
  "deadline": 1730000000,
  "onchain_tx_hash": "0x...",
  "mode": "private",
  "privacy": {
    "proof": ["0x1"],
    "public_inputs": ["0x2"]
  }
}
```

Bridge execute (private + verifier tongo):
```json
{
  "from_chain": "starknet",
  "to_chain": "starknet",
  "token": "STRK",
  "amount": "5",
  "recipient": "0x...",
  "onchain_tx_hash": "0x...",
  "mode": "private",
  "privacy": {
    "verifier": "tongo",
    "proof": ["0x1"],
    "public_inputs": ["0x2"]
  }
}
```

Privacy submit (verifier semaphore):
```json
{
  "verifier": "semaphore",
  "nullifier": "0x1",
  "commitment": "0x2",
  "proof": ["0x3"],
  "public_inputs": ["0x4"]
}
```

## Referensi & Link Resmi

Tongo:
1. https://github.com/fatlabsxyz/tongo
2. https://docs.tongo.cash/sdk/overview.html
3. https://docs.tongo.cash/sdk/quick-start.html

Sumo Login:
1. https://github.com/fatlabsxyz/sumo-login-cairo
2. https://sumologin.com/

Garaga:
1. https://www.npmjs.com/package/garaga
2. https://garaga.gitbook.io/garaga/building-powerful-applications

Semaphore:
1. https://docs.semaphore.pse.dev/
2. https://docs.semaphore.pse.dev/guides/identities
3. https://semaphore.pse.dev/learn

StarknetKit:
1. https://www.starknetkit.com/

LayerSwap:
1. https://docs.layerswap.io/integration/UI/Widget/Starknet/Starknet
2. https://docs.layerswap.io/integration/API
3. https://docs.layerswap.io/DepositAddress

Garden Finance:
1. https://docs.garden.finance/developers/sdk/nodejs/quickstart
2. https://docs.garden.finance/developers/core/order-lifecycle
3. https://docs.garden.finance/contracts/bitcoin
4. https://docs.garden.finance/api-reference/quickstart

## 7) Update Swap On-Chain Real Transfer (2026-02-13)

Perubahan:
1. `SwapAggregator.execute_swap` sekarang benar-benar memindahkan token on-chain:
2. `transfer_from(user -> swap_aggregator)` untuk token input.
3. fee (`dev_fee`, `lp_fee`, `mev_fee`) benar-benar ditransfer ke fee recipient.
4. route oracle (`dex_id='ORCL'`) sekarang executable (bukan diblok).
5. output token ditransfer ke user pada akhir eksekusi.

File kontrak:
1. `smartcontract/src/bridge/swap_aggregator.cairo`

Sinkronisasi backend:
1. quote/execute swap memakai `expected_amount_out` dari route on-chain agar angka UI sinkron dengan calldata wallet.
2. validasi amount > 0 ditambahkan.

File backend:
1. `backend-rust/src/api/swap.rs`

Deploy kontrak baru:
1. Class Hash: `0x0420029c0c5729d05e56db72ef60fe645d13e96b6a0ac80e6a6998bccc32315f`
2. Contract Address: `0x06f3e03be8a82746394c4ad20c6888dd260a69452a50eb3121252fdecacc6d28`

Link deploy:
1. Starkscan class: https://sepolia.starkscan.co/class/0x0420029c0c5729d05e56db72ef60fe645d13e96b6a0ac80e6a6998bccc32315f
2. Starkscan deploy tx: https://sepolia.starkscan.co/tx/0x0483969d37f9fb616ffc27d8b7c68773a95fce337c1b1e9c5cb9b79ba5aa53f4
3. Voyager contract: https://sepolia.voyager.online/contract/0x06f3e03be8a82746394c4ad20c6888dd260a69452a50eb3121252fdecacc6d28
4. Voyager deploy tx: https://sepolia.voyager.online/tx/0x0483969d37f9fb616ffc27d8b7c68773a95fce337c1b1e9c5cb9b79ba5aa53f4

Contoh verifikasi tx swap real transfer:
1. STRK -> CAREL tx: `0x0669e087ff25125535ff906ef617e416b7df202dea8b09359e16810b886247a7`
2. CAREL -> STRK tx: `0x00c1e9afaf136c7fa239f04e8dd81caba840fb1fa420bf6d37a9e2fb8a57714a`
3. Voyager tx1: https://sepolia.voyager.online/tx/0x0669e087ff25125535ff906ef617e416b7df202dea8b09359e16810b886247a7
4. Voyager tx2: https://sepolia.voyager.online/tx/0x00c1e9afaf136c7fa239f04e8dd81caba840fb1fa420bf6d37a9e2fb8a57714a

Catatan operasional:
1. ORCL route butuh likuiditas output token pada kontrak swap aggregator.
2. Untuk pair STRK<->CAREL sudah diisi likuiditas awal agar eksekusi real transfer berjalan.
3. Pair USDC/USDT/WBTC tetap butuh address token Starknet yang valid + likuiditas sebelum diaktifkan ke user.

## 8) Aktivasi USDC/USDT/WBTC Starknet (On-Chain)

Status:
1. Sudah dibuat token Starknet valid untuk USDC/USDT/WBTC (custom decimals 6/6/8).
2. Sudah di-wire ke `SwapAggregator` + `PriceOracle` + backend/frontend env.
3. Sudah di-fund liquidity ke kontrak swap agar pair lintas token bisa execute real transfer.

Kontrak baru:
1. MockERC20 class: `0x027f9bbf49962b137afa2245a81892129cc853f7fa623c5a07cae46e99901824`
2. USDC: `0x0179cc8cb5ea0b143e17d649e8ad60d80c45c8132c4cf162d57eaf8297f529d8`
3. USDT: `0x030fcbfd1f83fb2d697ad8bdd52e1d55a700b876bed1f4507875539581ed53e5`
4. WBTC: `0x016f2d46ab5cc2244aeeb195cf76f75e7a316a92b71d56618c1bf1b69ab70998`

Link deploy:
1. MockERC20 class: https://sepolia.starkscan.co/class/0x027f9bbf49962b137afa2245a81892129cc853f7fa623c5a07cae46e99901824
2. Deploy USDC tx: https://sepolia.starkscan.co/tx/0x04ba5c5e4d955aa790b706cea6d81e19ad115e9107820885fbfd6cf47bcc91f1
3. Deploy USDT tx: https://sepolia.starkscan.co/tx/0x023e8904fe1b729b6b39acd62434161e4a7b3436dba3196406bc3f6452643f84
4. Deploy WBTC tx: https://sepolia.starkscan.co/tx/0x0286bcc785d86bf4f2bf9e2be49fa6ec979e296777d5f72d80c90a5a84564f97

Wiring env utama:
1. `backend-rust/.env`:
2. `TOKEN_USDC_ADDRESS=0x0179...29d8`
3. `TOKEN_USDT_ADDRESS=0x030f...53e5`
4. `TOKEN_WBTC_ADDRESS=0x016f...0998`
5. `TOKEN_BTC_ADDRESS=0x016f...0998`
6. `frontend/.env.local`:
7. `NEXT_PUBLIC_TOKEN_USDC_ADDRESS=0x0179...29d8`
8. `NEXT_PUBLIC_TOKEN_USDT_ADDRESS=0x030f...53e5`
9. `NEXT_PUBLIC_TOKEN_WBTC_ADDRESS=0x016f...0998`
10. `NEXT_PUBLIC_TOKEN_BTC_ADDRESS=0x016f...0998`

Contoh quote API setelah aktivasi:
1. `STRK -> USDC` sukses.
2. `USDC -> WBTC` sukses.
3. `WBTC -> USDT` sukses.
4. `USDT -> CAREL` sukses.

## 9) Verifikasi Full Pair + Real Transfer (2026-02-14)

Matrix quote backend (`POST /api/v1/swap/quote`) untuk semua arah pair:
1. `STRK/WBTC/USDT/USDC/CAREL` antar-sesama pair (20 arah, tanpa self-pair) seluruhnya `OK`.
2. Tidak ada pair `FAIL` pada whitelist token on-chain saat ini.

Contoh transaksi execute real transfer terbaru:
1. `approve STRK` tx: https://sepolia.starkscan.co/tx/0x06397fde2f81597f3686dd90a965f7af802e58749be88fd80767ac7d4316920c
2. `execute_swap STRK -> USDC` tx: https://sepolia.starkscan.co/tx/0x07ae4b8addb30debacb3df7aa31a1c9876ffa540d23a9973dcfea8db4dd62927
3. `approve USDT` tx: https://sepolia.starkscan.co/tx/0x04add10ae61c37f3d8fc53e083428a682d3c9f26241135feccdd48b852d71847
4. `execute_swap USDT -> WBTC` tx: https://sepolia.starkscan.co/tx/0x0408f9718e757aa8775e44536a672a3eebf7c91bdf4d1a46d470b295598567e0

Validasi saldo setelah execute:
1. `STRK -> USDC`: saldo STRK user turun, saldo USDC user naik.
2. `USDT -> WBTC`: saldo USDT user turun, saldo WBTC user naik.
3. Ini memastikan transfer token real (bukan event-only).

## 10) Otomasi Rebalance Liquidity + Health Check

Script baru:
1. `smartcontract/scripts/08_rebalance_liquidity_healthcheck.sh`

Fungsi:
1. Rebalance liquidity otomatis ke `SWAP_AGGREGATOR_ADDRESS` jika balance token di bawah minimum.
2. Health check liquidity per token (`STRK/WBTC/USDT/USDC/CAREL`).
3. Health check route on-chain seluruh pair (20 arah) via `get_best_swap_route`.
4. Retry otomatis saat RPC rate-limit/nonce transient.

Mode eksekusi:
1. Full (rebalance + health):
```bash
cd smartcontract
./scripts/08_rebalance_liquidity_healthcheck.sh
```
2. Health-only:
```bash
cd smartcontract
ACTION_MODE=health ./scripts/08_rebalance_liquidity_healthcheck.sh
```
3. Rebalance-only:
```bash
cd smartcontract
ACTION_MODE=rebalance ./scripts/08_rebalance_liquidity_healthcheck.sh
```
4. Dry-run (tanpa invoke write tx):
```bash
cd smartcontract
DRY_RUN=true ACTION_MODE=full ./scripts/08_rebalance_liquidity_healthcheck.sh
```

Variabel penting (opsional override):
1. `SNCAST_ACCOUNT` (default: `sepolia`)
2. `ALLOW_MINT` (default: `true`) untuk token mintable testnet.
3. `MINTABLE_SYMBOLS` (default: `USDC,USDT,WBTC`)
4. `LIQ_MIN_<SYMBOL>` dan `LIQ_TARGET_<SYMBOL>` dalam base units:
5. contoh: `LIQ_MIN_USDC=200000000`, `LIQ_TARGET_USDC=1000000000`
6. `HEALTH_PROBE_<SYMBOL>` untuk nominal probe quote per token.
7. `SLEEP_BETWEEN_CALLS` untuk jeda antar call jika RPC sering 429.

Contoh jadwal berkala (setiap 5 menit):
```bash
*/5 * * * * cd /mnt/c/Users/frend/zkcare_protocol/smartcontract && ./scripts/08_rebalance_liquidity_healthcheck.sh >> /tmp/zkcare_rebalance.log 2>&1
```
