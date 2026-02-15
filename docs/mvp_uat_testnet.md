# MVP UAT Testnet Checklist

Date: 2026-02-13
Environment: Starknet Sepolia + Ethereum Sepolia + Bitcoin Testnet

## 0) Preflight

- [ ] Frontend build uses Node >= 20.9 (recommended 24).
- [ ] Backend starts without config error.
- [ ] Required env is filled:
  - Frontend:
    - `NEXT_PUBLIC_STARKNET_SWAP_CONTRACT_ADDRESS` (must be real on-chain swap contract that moves token balances, not event-only contract)
    - `NEXT_PUBLIC_STARKNET_BRIDGE_AGGREGATOR_ADDRESS`
    - `NEXT_PUBLIC_STARKNET_LIMIT_ORDER_BOOK_ADDRESS`
    - `NEXT_PUBLIC_STARKNET_DISCOUNT_SOULBOUND_ADDRESS`
  - Backend:
    - `LIMIT_ORDER_BOOK_ADDRESS`
    - `DISCOUNT_SOULBOUND_ADDRESS`
    - `ZK_PRIVACY_ROUTER_ADDRESS` (Garaga)
    - `SUMO_LOGIN_API_URL` (+ key if needed)
- [ ] Wallets linked per user: Starknet + EVM + BTC testnet.

Pass criteria:
- All services up, no fallback "backend mode" message for swap/bridge/limit-order/stake.

## 1) Identity and referral (Sumo + immutable bind)

- [ ] Login with Sumo token once.
- [ ] Verify same Sumo subject resolves to the same account on relogin.
- [ ] Set `display_name` once (or update as expected by product rule).
- [ ] Bind referral code on first login.
- [ ] Try rebinding referral with another code (must be rejected / ignored).

Pass criteria:
- 1 user = 1 account identity; referral bind is immutable.

## 2) Bridge ETH Sepolia -> Starknet Sepolia

Test case A (below threshold):
- [ ] Bridge < $10 equivalent ETH.
- [ ] Confirm tx hash exists on Etherscan.
- [ ] Confirm transaction appears in history.
- [ ] Confirm points = 0.

Test case B (eligible):
- [ ] Bridge >= $10 equivalent ETH.
- [ ] Confirm tx hash exists on Etherscan.
- [ ] Confirm `usd_value` > 0.
- [ ] Confirm points = `usd_value * 15` (before multiplier/bonus).

Pass criteria:
- Onchain tx hash mandatory and points rule follows ETH rate (15/$, min $10).

## 3) Bridge BTC native -> Starknet settlement

Flow:
- [ ] Send BTC testnet to bridge vault from BTC wallet.
- [ ] Paste BTC txid (64 hex) into UI field.
- [ ] Submit bridge request with that txid.
- [ ] Confirm txid exists in Mempool explorer.
- [ ] Confirm bridge record saved with BTC source.

Points:
- [ ] Test < $100 equivalent BTC -> points 0.
- [ ] Test >= $100 equivalent BTC -> points = `usd_value * 25`.

Pass criteria:
- BTC native flow works with user BTC txid evidence; rule 25/$ and min $100 applied.

## 4) Swap on Starknet (user-sign onchain)

- [ ] Execute swap STRK/USDT/USDC/WBTC/CAREL on Starknet pair.
- [ ] Confirm wallet signing popup appears.
- [ ] Confirm tx hash exists on Starkscan.
- [ ] Confirm `usd_value` is not raw token amount and is positive.
- [ ] Confirm points = `usd_value * 10` (subject to NFT/multiplier).

Pass criteria:
- Swap requires onchain tx hash and uses normalized USD volume.

## 5) Limit order on Starknet

- [ ] Create order (wallet signed).
- [ ] Cancel order (wallet signed).
- [ ] Create order that can be executed by keeper/executor.
- [ ] On execution, confirm `usd_value` computed from token prices (normalized).
- [ ] Confirm points = `usd_value * 10` (subject to NFT/multiplier).

Pass criteria:
- Create/cancel are onchain-signed; execution volume is normalized USD.

## 6) Stake on Starknet

- [ ] Stake < 100 CAREL -> points 0.
- [ ] Stake >= 100 CAREL -> points = `usd_value * 3`.
- [ ] Verify multiplier tiers apply on total points.

Pass criteria:
- Minimum 100 CAREL and 3 points per USD are enforced.

## 7) Garaga private mode

- [ ] Run swap in private mode with valid privacy payload.
- [ ] Run bridge in private mode with valid privacy payload.
- [ ] Confirm Garaga verification tx is triggered (or expected error when router not configured).
- [ ] Confirm private transactions are marked hidden in history where applicable.

Pass criteria:
- Private mode uses Garaga verification path, not transparent fallback.

## 8) NFT discount impact

- [ ] Sebelum mint, pastikan current tier UI = `None`.
- [ ] Mint Bronze NFT on-chain, pastikan tier aktif berubah ke `Bronze`.
- [ ] Repeat satu aksi (bridge/swap/limit/stake) sebelum vs sesudah NFT aktif.
- [ ] Verify effective points increase matches NFT discount factor.
- [ ] Gunakan NFT sampai `max_usage` habis, pastikan status discount jadi inactive (tanpa burn token).
- [ ] Mint ulang (remint) tier yang sama atau lebih tinggi, pastikan tier aktif kembali.
- [ ] Verifikasi tidak ada auto-reset usage tanpa remint.

Pass criteria:
- NFT discount modifies points outcome as configured.
- Tier progression mengikuti NFT aktif on-chain, bukan total points raw.
- Usage berkurang hanya pada transaksi yang sukses.

## 9) Leaderboard and totals

- [ ] Perform at least 1 action per feature: bridge, swap, limit-order, stake.
- [ ] Confirm points are reflected on leaderboard using `display_name`.
- [ ] Confirm total volume and points match expected formula.
- [ ] Confirm referral bonus added only when threshold conditions are met.

Pass criteria:
- Leaderboard displays correct user identity and point totals.

## 10) MVP sign-off gate

MVP is accepted only if all below are true:

- [ ] No backend-mode execution for swap/bridge/limit-order/stake.
- [ ] Onchain tx hash required and validated for all user actions.
- [ ] Points formulas are correct:
  - BTC bridge: 25/$, min $100
  - ETH bridge: 15/$, min $10
  - Swap: 10/$
  - Limit order: 10/$
  - Stake: 3/$, min 100 CAREL
- [ ] Garaga private path works.
- [ ] Sumo login identity mapping works.
- [ ] Leaderboard and referral totals consistent.

If any item fails, MVP status = NOT READY.
