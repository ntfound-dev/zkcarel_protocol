# Integration Update - 2026-02-13

This document summarizes implementation updates for on-chain bridge flow, provider routing, and dynamic privacy verifier selection.

## Change Scope

1. Bridge verification was hardened to enforce true on-chain checks.
2. Bridge provider selection no longer silently falls back to simulation when config is empty.
3. Privacy verifier selector `garaga|tongo|semaphore` is now dynamic per request, with backward-compatible default `garaga`.
4. Env/config and endpoint documentation was updated.

## 1) Bridge On-Chain Verification (Backend)

Changes:
1. Bridge `onchain_tx_hash` is now validated against chain based on `from_chain`.
2. `starknet`: check receipt, finality, and revert status.
3. `ethereum`: call `eth_getTransactionReceipt`, validate `status` and `blockNumber`.
4. `bitcoin`: keep txid format validation; settlement remains asynchronous via provider.
5. Bridge transaction `block_number` in DB is now filled from chain verification result (not default `0`).

Related file:
1. `backend-rust/src/api/bridge.rs`

## 2) Provider Routing Without Silent Fallback

Changes:
1. `RouteOptimizer` now chooses only providers that are actually active/configured.
2. Config is treated as inactive if empty or using sentinel values (`DISABLED`, `CHANGE_ME`, `REPLACE_ME`).
3. Atomiq can now be disabled explicitly via env without removing code.

Related file:
1. `backend-rust/src/services/route_optimizer.rs`

## 3) Real Provider API Adapters

`LayerSwap` updates:
1. Uses `X-LS-APIKEY` header.
2. Quote/execute endpoints updated to match current API integration.
3. API errors are returned explicitly (no silent simulation fallback).

`Garden` updates:
1. Uses `garden-app-id` header.
2. Uses `v2` endpoints for quote/order.
3. Converts amount into base units and parses `v2` response schema.
4. API errors are returned explicitly.

Related files:
1. `backend-rust/src/integrations/bridge/layerswap.rs`
2. `backend-rust/src/integrations/bridge/garden.rs`

## 4) Dynamic Privacy Verifier Selector (Backward-Compatible)

Changes:
1. Private-flow requests can choose verifier through optional field:
2. `garaga`, `tongo`, or `semaphore`.
3. If field is missing, default is `garaga`.
4. Router address per verifier is read from env map:
5. `PRIVACY_VERIFIER_ROUTERS=garaga:0x...,tongo:0x...,semaphore:0x...`
6. Applied on:
7. `POST /api/v1/swap/execute` (via `privacy.verifier`)
8. `POST /api/v1/bridge/execute` (via `privacy.verifier`)
9. `POST /api/v1/privacy/submit` (via `verifier`)

Related files:
1. `backend-rust/src/services/privacy_verifier.rs`
2. `backend-rust/src/api/swap.rs`
3. `backend-rust/src/api/bridge.rs`
4. `backend-rust/src/api/privacy.rs`
5. `backend-rust/src/config.rs`
6. `backend-rust/.env`
7. `backend-rust/.env.testnet.example`

## 5) New Environment Configuration

Added config:
1. `PRIVACY_VERIFIER_ROUTERS`

Example:
```env
PRIVACY_VERIFIER_ROUTERS=garaga:0x00694e35433fe3ce49431e1816f4d4df9ab6d550a3f73f8f07f9c2cc69b6891b,tongo:0x...,semaphore:0x...
```

Notes:
1. If only `garaga` is configured, `tongo`/`semaphore` requests are rejected with configuration error.
2. This is intentional to prevent silent wrong-verifier fallback.

## 6) Example Payloads

Swap execute (private + default `garaga`):
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

Bridge execute (private + `tongo` verifier):
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

Privacy submit (`semaphore` verifier):
```json
{
  "verifier": "semaphore",
  "nullifier": "0x1",
  "commitment": "0x2",
  "proof": ["0x3"],
  "public_inputs": ["0x4"]
}
```

## References & Official Links

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

## 7) Swap On-Chain Real Transfer Update (2026-02-13)

Changes:
1. `SwapAggregator.execute_swap` now performs real on-chain token movement:
2. `transfer_from(user -> swap_aggregator)` for input token.
3. Fees (`dev_fee`, `lp_fee`, `mev_fee`) are truly transferred to fee recipient.
4. Oracle route (`dex_id='ORCL'`) is now executable (not blocked).
5. Output token is transferred to user at execution end.

Contract file:
1. `smartcontract/src/bridge/swap_aggregator.cairo`

Backend synchronization:
1. Swap quote/execute now uses `expected_amount_out` from on-chain route so UI values stay aligned with wallet calldata.
2. Validation for `amount > 0` was added.

Backend file:
1. `backend-rust/src/api/swap.rs`

New contract deployment:
1. Class Hash: `0x0420029c0c5729d05e56db72ef60fe645d13e96b6a0ac80e6a6998bccc32315f`
2. Contract Address: `0x06f3e03be8a82746394c4ad20c6888dd260a69452a50eb3121252fdecacc6d28`

Deployment links:
1. Starkscan class: https://sepolia.starkscan.co/class/0x0420029c0c5729d05e56db72ef60fe645d13e96b6a0ac80e6a6998bccc32315f
2. Starkscan deploy tx: https://sepolia.starkscan.co/tx/0x0483969d37f9fb616ffc27d8b7c68773a95fce337c1b1e9c5cb9b79ba5aa53f4
3. Voyager contract: https://sepolia.voyager.online/contract/0x06f3e03be8a82746394c4ad20c6888dd260a69452a50eb3121252fdecacc6d28
4. Voyager deploy tx: https://sepolia.voyager.online/tx/0x0483969d37f9fb616ffc27d8b7c68773a95fce337c1b1e9c5cb9b79ba5aa53f4

Example real-transfer swap tx verification:
1. STRK -> CAREL tx: `0x0669e087ff25125535ff906ef617e416b7df202dea8b09359e16810b886247a7`
2. CAREL -> STRK tx: `0x00c1e9afaf136c7fa239f04e8dd81caba840fb1fa420bf6d37a9e2fb8a57714a`
3. Voyager tx1: https://sepolia.voyager.online/tx/0x0669e087ff25125535ff906ef617e416b7df202dea8b09359e16810b886247a7
4. Voyager tx2: https://sepolia.voyager.online/tx/0x00c1e9afaf136c7fa239f04e8dd81caba840fb1fa420bf6d37a9e2fb8a57714a

Operational notes:
1. ORCL route requires output-token liquidity in swap aggregator contract.
2. Initial liquidity was seeded for `STRK<->CAREL` to enable real transfer execution.
3. `USDC/USDT/WBTC` pairs still require valid Starknet token addresses + liquidity before user rollout.

## 8) Activation of Starknet USDC/USDT/WBTC (On-Chain)

Status:
1. Valid Starknet tokens for `USDC/USDT/WBTC` were created (custom decimals `6/6/8`).
2. Wiring completed for `SwapAggregator` + `PriceOracle` + backend/frontend env.
3. Liquidity funded into swap contract so cross-token pairs can execute real transfer.

New contracts:
1. MockERC20 class: `0x027f9bbf49962b137afa2245a81892129cc853f7fa623c5a07cae46e99901824`
2. USDC: `0x0179cc8cb5ea0b143e17d649e8ad60d80c45c8132c4cf162d57eaf8297f529d8`
3. USDT: `0x030fcbfd1f83fb2d697ad8bdd52e1d55a700b876bed1f4507875539581ed53e5`
4. WBTC: `0x016f2d46ab5cc2244aeeb195cf76f75e7a316a92b71d56618c1bf1b69ab70998`

Deployment links:
1. MockERC20 class: https://sepolia.starkscan.co/class/0x027f9bbf49962b137afa2245a81892129cc853f7fa623c5a07cae46e99901824
2. Deploy USDC tx: https://sepolia.starkscan.co/tx/0x04ba5c5e4d955aa790b706cea6d81e19ad115e9107820885fbfd6cf47bcc91f1
3. Deploy USDT tx: https://sepolia.starkscan.co/tx/0x023e8904fe1b729b6b39acd62434161e4a7b3436dba3196406bc3f6452643f84
4. Deploy WBTC tx: https://sepolia.starkscan.co/tx/0x0286bcc785d86bf4f2bf9e2be49fa6ec979e296777d5f72d80c90a5a84564f97

Main env wiring:
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

Example quote API after activation:
1. `STRK -> USDC` success.
2. `USDC -> WBTC` success.
3. `WBTC -> USDT` success.
4. `USDT -> CAREL` success.

## 9) Full Pair + Real Transfer Verification (2026-02-14)

Backend quote matrix (`POST /api/v1/swap/quote`) for all pair directions:
1. `STRK/WBTC/USDT/USDC/CAREL` cross-pair matrix (20 directions, excluding self-pair) all `OK`.
2. No `FAIL` pair in current on-chain token whitelist.

Latest real-transfer execution examples:
1. `approve STRK` tx: https://sepolia.starkscan.co/tx/0x06397fde2f81597f3686dd90a965f7af802e58749be88fd80767ac7d4316920c
2. `execute_swap STRK -> USDC` tx: https://sepolia.starkscan.co/tx/0x07ae4b8addb30debacb3df7aa31a1c9876ffa540d23a9973dcfea8db4dd62927
3. `approve USDT` tx: https://sepolia.starkscan.co/tx/0x04add10ae61c37f3d8fc53e083428a682d3c9f26241135feccdd48b852d71847
4. `execute_swap USDT -> WBTC` tx: https://sepolia.starkscan.co/tx/0x0408f9718e757aa8775e44536a672a3eebf7c91bdf4d1a46d470b295598567e0

Balance validation after execute:
1. `STRK -> USDC`: user STRK balance decreases, user USDC balance increases.
2. `USDT -> WBTC`: user USDT balance decreases, user WBTC balance increases.
3. This confirms real token transfer behavior (not event-only).

## 10) Automated Liquidity Rebalance + Health Check

New script:
1. `smartcontract/scripts/08_rebalance_liquidity_healthcheck.sh`

Functions:
1. Automatically rebalance liquidity to `SWAP_AGGREGATOR_ADDRESS` when token balance is below minimum.
2. Liquidity health check per token (`STRK/WBTC/USDT/USDC/CAREL`).
3. On-chain route health check across full pair matrix (20 directions) via `get_best_swap_route`.
4. Automatic retry for RPC rate-limit/nonce transient errors.

Execution modes:
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
4. Dry-run (no write invoke tx):
```bash
cd smartcontract
DRY_RUN=true ACTION_MODE=full ./scripts/08_rebalance_liquidity_healthcheck.sh
```

Important variables (optional override):
1. `SNCAST_ACCOUNT` (default: `sepolia`)
2. `ALLOW_MINT` (default: `true`) for mintable testnet tokens.
3. `MINTABLE_SYMBOLS` (default: `USDC,USDT,WBTC`)
4. `LIQ_MIN_<SYMBOL>` and `LIQ_TARGET_<SYMBOL>` in base units.
5. Example: `LIQ_MIN_USDC=200000000`, `LIQ_TARGET_USDC=1000000000`
6. `HEALTH_PROBE_<SYMBOL>` for per-token quote probe amounts.
7. `SLEEP_BETWEEN_CALLS` for spacing between calls when RPC returns frequent 429.

Example periodic schedule (every 5 minutes):
```bash
*/5 * * * * cd /mnt/c/Users/frend/zkcare_protocol/smartcontract && ./scripts/08_rebalance_liquidity_healthcheck.sh >> /tmp/zkcare_rebalance.log 2>&1
```

## 11) Live Balance UI Fix + CAREL Faucet Activation (2026-02-14)

Issue:
1. Swap succeeded on-chain, but `CAREL/USDC/USDT/WBTC` balances in UI did not update immediately.
2. Main cause: frontend live on-chain balance previously read only `STRK/ETH/BTC`; other Starknet tokens fell back to backend portfolio (could lag).

Patch:
1. Backend endpoint `POST /api/v1/wallet/onchain-balances` now returns:
2. `carel`, `usdc`, `usdt`, `wbtc` (in addition to `strk_l2/strk_l1/eth/btc`).
3. Frontend `useWallet` now stores and refreshes on-chain values for:
4. `CAREL`, `USDC`, `USDT`, `WBTC`.
5. Trading UI now reads live on-chain source balance for those Starknet tokens.

Related files:
1. `backend-rust/src/api/wallet.rs`
2. `frontend/lib/api.ts`
3. `frontend/hooks/use-wallet.tsx`
4. `frontend/components/trading-interface.tsx`

CAREL faucet:
1. `FAUCET_CAREL_AMOUNT` set to `25` in `backend-rust/.env`.
2. `FAUCET_CAREL_UNLIMITED=true` enabled for testnet QA mode (claim CAREL without cooldown).
3. Backend signer/faucet wallet topped up with CAREL via mint.
4. Mint tx: https://sepolia.starkscan.co/tx/0x05e3c540952f4bd6949d4e5a5c0fd74a7c1cd18a1261ff0442a6adf4e8ab8617
5. Backend signer CAREL balance after top-up: `1000.04243 CAREL` (base unit: `1000042430000000000000`).

## 12) Temporary Notes Before Limit-Order Focus

1. Swap aggregator and token transfer flow are running as real on-chain execution.
2. CAREL uses the project's main token contract.
3. In this phase, `USDC/USDT/WBTC` are still Starknet testnet mock tokens for internal QA.
4. Backend CAREL faucet is currently set to unlimited (testnet/dev only) to prevent balance bottlenecks during limit-order testing.

## 13) Discount Soulbound NFT Update (2026-02-15)

Implemented business-model changes:
1. Tier is determined by active on-chain discount NFT, not directly by total points.
2. User lifetime points can keep increasing without limit.
3. Current points are used for NFT mint and decrease on mint.
4. NFT is soulbound (non-transferable).
5. NFT is not burned when usage is exhausted; status changes to inactive.
6. Unlimited remint is enabled (user can mint again while points are sufficient).

Current active tier config:
1. Bronze: cost `5000`, discount `5%`, max use `5`
2. Silver: cost `15000`, discount `10%`, max use `7`
3. Gold: cost `50000`, discount `25%`, max use `10`
4. Platinum: cost `150000`, discount `35%`, max use `15`
5. Onyx: cost `500000`, discount `50%`, max use `20`

Related files:
1. `smartcontract/src/nft/discount_soulbound.cairo`
2. `frontend/components/rewards-hub.tsx`
3. `backend-rust/src/api/nft.rs`

## 14) DiscountSoulbound Redeploy + Authorization Fix (2026-02-15)

Issue:
1. NFT mint failed with error `Caller is not authorized`.
2. Root cause: new `DiscountSoulbound` contract was not yet registered as `authorized_consumer` in `PointStorage`.

Fix:
1. Redeploy `DiscountSoulbound` contract.
2. Update env addresses:
3. `backend-rust/.env` -> `DISCOUNT_SOULBOUND_ADDRESS`
4. `frontend/.env` + `frontend/.env.local` -> `NEXT_PUBLIC_STARKNET_DISCOUNT_SOULBOUND_ADDRESS` and `NEXT_PUBLIC_DISCOUNT_SOULBOUND_ADDRESS`
5. Invoke `PointStorage.add_consumer(DISCOUNT_SOULBOUND_ADDRESS)` so `mint_nft -> consume_points` is authorized.
6. Patch deploy script to auto-add consumer after redeploy.

Deployment details:
1. Class hash: `0x02639624ccc7d46135fef2c78bfcd47a5b9bbab24e03339655deb5cb5e1774c7`
2. Contract address: `0x05b4c1e3578fd605b44b1950c749f01b2f652b8fd7a77135801d8d31af6fe809`
3. Declare tx: `0x029ca8e1aa78e661abe2178fff9bb8530e9d17b54e7c7346239154724292217d`
4. Deploy tx: `0x06fe2368ea1ef7dd882ee38e8a1b6d43d03be849e17265c04c088b78cc87b288`
5. Add consumer tx: `0x025e0a290ebbf7a988cbac8ce22e757fdb3236a998c2dff59ae3273625d066dd`

Explorer links:
1. Starkscan class: https://sepolia.starkscan.co/class/0x02639624ccc7d46135fef2c78bfcd47a5b9bbab24e03339655deb5cb5e1774c7
2. Starkscan contract: https://sepolia.starkscan.co/contract/0x05b4c1e3578fd605b44b1950c749f01b2f652b8fd7a77135801d8d31af6fe809
3. Voyager contract: https://sepolia.voyager.online/contract/0x05b4c1e3578fd605b44b1950c749f01b2f652b8fd7a77135801d8d31af6fe809

Script patch:
1. `smartcontract/scripts/06_deploy_remaining.sh` now automatically invokes:
```bash
sncast invoke --network sepolia \
  --contract-address $POINT_STORAGE_ADDRESS \
  --function add_consumer \
  --calldata $DISCOUNT_SOULBOUND_ADDRESS
```
