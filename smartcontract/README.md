# CAREL Smart Contracts

**Overview**
This folder contains the Cairo contracts for CAREL Protocol. It covers tokenomics, governance, rewards, staking, swaps, bridges, NFT discounts, and privacy primitives. The contracts are designed to work with the backend services that provide points, Merkle snapshots, and off-chain routing.

**Internal-Asset Mode**
- This branch is configured for **internal assets only**. External assets/integrations can be added later, but by default the protocol assumes internal assets (CAREL and protocol-wrapped assets).

**Token Price Estimate (Docs/Pitch)**
- Launch: $0.01
- Year 1: $0.05–0.08
- Year 2: $0.15–0.25
- Year 3: $0.50+
- Note: These are off-chain projections for docs/pitch only and are not enforced on-chain.

**Architecture**
- On-chain core: token, treasury, vesting, registry, fee collection.
- Protocol modules: swap, bridge, staking, rewards, NFT discounts, AI executor.
- Governance: proposals and timelock.
- Privacy (All‑in ZK): Shielded vault + verifier registry + privacy router (all modules expose ZK entrypoints).
- BTC-native bridge: light-client verified BTC deposits.
- Adapters: AI signature verifier, privacy verifier adapters. **External bridge adapters are optional/disabled in internal‑asset mode.**
- Privacy apps: private BTC swaps, dark pool orderbook, private payments, anonymous credentials.

**Directory Structure**
```text
smartcontract/
  src/
    ai/
      ai_executor.cairo
      ai_signature_verifier.cairo
    bridge/
      bridge_aggregator.cairo
      btc_native_bridge.cairo
      private_btc_swap.cairo
      private_swap.cairo
      swap_aggregator.cairo
      provider_adapter.cairo
      atomiq_adapter.cairo
      garden_adapter.cairo
      layerswap_adapter.cairo
    core/
      carel_protocol.cairo
      fee_collector.cairo
      registry.cairo
      token.cairo
      treasury.cairo
      vesting_manager.cairo
    governance/
      governance.cairo
      timelock.cairo
    nft/
      discount_soulbound.cairo
    privacy/
      action_types.cairo
      privacy_router.cairo
      shielded_vault.cairo
      verifier_registry.cairo
      zk_privacy_router.cairo
      privacy_adapter.cairo
      garaga_verifier_adapter.cairo
      tongo_verifier_adapter.cairo
      semaphore_verifier_adapter.cairo
      mock_verifiers.cairo
      sigma_verifier.cairo
      anonymous_credentials.cairo
      private_payments.cairo
    rewards/
      merkle_verifier.cairo
      referral_system.cairo
      snapshot_distributor.cairo
      point_storage.cairo
      rewards_escrow.cairo
    staking/
      staking_btc.cairo
      staking_carel.cairo
      staking_lp.cairo
      staking_stablecoin.cairo
    swap/
      private_swap.cairo
      router.cairo
    trading/
      dca_orders.cairo
      dark_pool.cairo
    utils/
      access_control.cairo
      emergency_pause.cairo
      leaderboard_view.cairo
      multisig.cairo
      price_oracle.cairo
      twap_oracle.cairo
  tests/
  scripts/
```

**Core Contracts**
- `src/core/token.cairo`: ERC20 CAREL with supply cap and minter/burner roles.
- `src/core/vesting_manager.cairo`: vesting schedules and tokenomics setup.
- `src/core/treasury.cairo`: fee custody, burn limits, rewards funding.
- `src/core/fee_collector.cairo`: swap/bridge/MEV fee accounting and split.
- `src/core/registry.cairo`: address registry for core modules.

**Protocol Modules**
- `src/bridge/bridge_aggregator.cairo`: bridge routing and fee events.
- `src/bridge/btc_native_bridge.cairo`: BTC deposit verification via light client and optional mint.
- `src/bridge/swap_aggregator.cairo`: swap routing and fee breakdown.
- `src/bridge/*_adapter.cairo`: provider adapters (Atomiq/Garden/LayerSwap) — **optional/disabled for internal‑asset mode**.
- `src/bridge/private_btc_swap.cairo`: confidential BTC swap commitments + proof verify.
- `src/swap/private_swap.cairo`: private swap with nullifier protection.
- `src/staking/*`: CAREL, BTC, LP, and stablecoin staking.
- `src/nft/discount_soulbound.cairo`: soulbound discount NFT tiers with finite usage (no auto-reset), unlimited remint, and optional recharge.
- `src/ai/ai_executor.cairo`: AI task execution with rate limits and optional fee.
- `src/ai/ai_signature_verifier.cairo`: allowlist-based signature verifier for AI actions.
  - Performance: use `batch_submit_actions`, `batch_execute_actions`, and `get_pending_actions_page` to avoid large loops.
- `src/rewards/*`: points storage, referral logic, Merkle distributor, escrow.
- `src/privacy/privacy_router.cairo`: unified privacy router (verifier registry + shielded vault).
- `src/privacy/shielded_vault.cairo`: Merkle root + nullifier/commitment registry.
- `src/privacy/verifier_registry.cairo`: action_type → verifier mapping.
- `src/privacy/zk_privacy_router.cairo`: legacy ZK router (still used by some privacy apps).
- `src/privacy/*_verifier_adapter.cairo`: Garaga/Tongo/Semaphore verifier adapters.
- `src/privacy/sigma_verifier.cairo`: standalone Sigma protocol verifier.
- `src/privacy/anonymous_credentials.cairo`: anonymous credential proofs with nullifiers.
- `src/privacy/private_payments.cairo`: confidential transfers via commitments.
- `src/trading/dark_pool.cairo`: private order commitments + match verification.
- `src/utils/price_oracle.cairo`: on-chain price oracle used for rate/quote calculations.

**Governance**
- `src/governance/governance.cairo`: proposal, vote, execute.
- `src/governance/timelock.cairo`: queued execution with minimum delay.

**Key Flows**
1. Swap
- User swaps via router/aggregator.
- Fees split into LP and treasury/dev per `fee_collector.cairo`.

2. Bridge
- Best route selection + fee split (provider/dev).
- BTC-native deposits verified via light client in `btc_native_bridge.cairo`.

3. Points and Rewards
- Backend computes points and submits to `PointStorage`.
- `PointStorage.convert_points_to_carel(epoch, user_points, total_distribution)` can be used to derive CAREL allocation for a season (epoch) based on global points.
- Distribution mode:
  - Early testnet uses `3%` total supply pool (tokenomics EarlyAccess phase).
  - Mainnet uses monthly ecosystem distribution.
- `SnapshotDistributor` applies claim fee `5%` split `2.5%` treasury/management + `2.5%` dev.

4. Referral
- `ReferralSystem` records referee points per epoch and accrues bonus.
- Referrer claims bonus into `PointStorage`.

5. NFT Discounts
- Points consumed on mint through `PointStorage.consume_points(...)`.
- NFT remains permanent and non-transferable (soulbound).
- Usage quota is finite per NFT and does not auto-reset.
- When quota reaches max usage, NFT is inactive (not burned).
- User can mint again (same/higher tier) to reactivate discount.

6. Private BTC Swap
- User submits encrypted commitment + proof to `PrivateBTCSwap`.
- Settlement uses nullifiers to prevent replay.

7. Dark Pool
- Orders submitted as encrypted commitments.
- Matching proves validity and settles on-chain with nullifier checks.

8. Vesting / Tokenomics
- `VestingManager` creates schedules per category and enforces supply cap.

**User Scenario Tests**
- `tests/test_user_scenarios.cairo`: end-to-end user flows (bridge, swap, limit order/keeper execution, points lifecycle, NFT discount, referral, staking, governance, timelock, treasury, private payments, dark pool, AI executor).

**Configuration**
- `smartcontract/.env` used by scripts for deploy and tokenomics.
- Testnet wallets are created by `scripts/01_setup_testnet.sh`.
- `scripts/03_fill_env_from_wallets.sh` fills `.env` from wallets.

**DiscountSoulbound Technical Details**
- Constructor: `constructor(point_storage, epoch)` sets default tier configs and admin.
- Default tier config:
  - Bronze: `cost=5000`, `discount=5`, `max_usage=5`
  - Silver: `cost=15000`, `discount=10`, `max_usage=7`
  - Gold: `cost=50000`, `discount=25`, `max_usage=10`
  - Platinum: `cost=150000`, `discount=35`, `max_usage=15`
  - Onyx: `cost=500000`, `discount=50`, `max_usage=20`
- `mint_nft(tier)`:
  - consume points from `PointStorage`,
  - mint token baru,
  - set `user_nft[user]` ke token terbaru (active pointer).
- `use_discount_batch(user, uses)`:
  - gagal jika melebihi sisa usage,
  - sukses jika cukup quota dan menambah `used_in_period`.
- `has_active_discount(user)`:
  - `active = used_in_period < max_usage`,
  - return `(active, discount_rate)`.
- `transfer(...)` selalu revert untuk enforce soulbound.
- `recharge_nft()` tersedia hanya jika `tier_recharge_costs[tier] > 0` (default saat ini `0`).

Important integration note:
- Karena `mint_nft` memanggil `PointStorage.consume_points`, kontrak `DiscountSoulbound` harus terdaftar sebagai `authorized_consumer` di `PointStorage`.
- Script `scripts/06_deploy_remaining.sh` sekarang otomatis invoke `PointStorage.add_consumer(DISCOUNT_SOULBOUND_ADDRESS)` setelah deploy/redeploy.

**Fee Defaults (Plan-Aligned)**
- Swap fee: 0.30% (0.20% LP + 0.10% dev/treasury).
- Bridge fee: 0.40% (0.30% provider + 0.10% dev).
- MEV protection: 0.15% optional.
- Rewards claim fee: 5.00% (2.50% management/treasury + 2.50% dev).
- AI assistant: 1 CAREL (Level 2), 2 CAREL (Level 3), burned on collection.

**On-Chain Price Rates**
- `PriceOracle` resolves token prices from Pragma + cached fallback.
- `SwapAggregator.get_oracle_quote(...)` exposes oracle-based rates for on-chain quoting.
- Set `PRAGMA_ORACLE_ADDRESS` (Sepolia: `0x36031daa264c24520b11d93af622c848b2499b66b41d611bac95e13cfca131a`).
- `CHAINLINK_ORACLE_ADDRESS` can be `0x0` on testnet.

**Deploy (Testnet)**
1. Create wallets
```bash
cd smartcontract
bash scripts/01_setup_testnet.sh
```
2. Fund `DEPLOYER_ADDRESS` with STRK Sepolia.
3. Fill `.env`
```bash
bash scripts/03_fill_env_from_wallets.sh
```

**Backend Integration**
- Backend reads points from DB but converts to CAREL using on-chain `PointStorage.convert_points_to_carel(...)` when configured.
- Privacy submissions:
  - V2 (recommended): `PrivacyRouter.submit_action(action_type, old_root, new_root, nullifiers, commitments, public_inputs, proof)`
  - V1 (legacy): `ZkPrivacyRouter.submit_private_action(nullifier, commitment, proof, public_inputs)`
- AI level 2/3: backend must validate `action_id` is pending on-chain via `AIExecutor.get_pending_actions_page(...)` before serving response.
- Environment variables expected by backend:
  - `POINT_STORAGE_ADDRESS`
  - `ZK_PRIVACY_ROUTER_ADDRESS` (V1)
  - `PRIVACY_ROUTER_ADDRESS` (V2)
4. Build and deploy
```bash
scarb build
bash scripts/deploy.sh
```
5. Initialize tokenomics
```bash
bash scripts/02_init_tokenomics.sh
```
6. Deploy adapters (AI/bridge/privacy)
```bash
bash scripts/04_deploy_adapters.sh
```
Optional Garaga verifier mode before deploy adapters:
- `GARAGA_VERIFICATION_MODE=0` legacy `verify_proof(proof, public_inputs)` (default)
- `GARAGA_VERIFICATION_MODE=1` `verify_ultra_starknet_honk_proof(full_proof_with_hints)`
- `GARAGA_VERIFICATION_MODE=2` `verify_groth16_proof_bn254(full_proof_with_hints)`
- `GARAGA_VERIFICATION_MODE=3` `verify_groth16_proof_bls12_381(full_proof_with_hints)`
7. Deploy price oracle and set token configs
```bash
bash scripts/05_deploy_price_oracle.sh
```
8. Wire V2 privacy (full ZKP)
```bash
bash scripts/07_wire_privacy_router_v2.sh
```
External asset modules (bridge/BTC) are optional:
```bash
export PRIVACY_WIRE_EXTERNAL=1
bash scripts/07_wire_privacy_router_v2.sh
```

**Testing**
```bash
cd smartcontract
scarb test
```

**Backend Dependencies**
- Merkle roots must be submitted by backend signer to `SnapshotDistributor`.
- Referral points can be synced on-chain by backend to `ReferralSystem.record_referee_points`.
- Backend signer address must match on-chain signer configuration.

**Security Notes**
- Use multisig for admin roles.
- Keep backend signing keys off-chain and rotate when needed.
- Audit checklist available at `smartcontract/security_audit_checklist.md`.
