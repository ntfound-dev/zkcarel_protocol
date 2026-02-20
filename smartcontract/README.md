# CAREL Smart Contracts
This README lists the contract modules, repository structure, and test/build entry points for the Cairo layer.

## Table of Contents
- [Scope](#scope)
- [Repository Structure](#repository-structure)
- [Contract Catalog](#contract-catalog)
  - [Core Protocol](#core-protocol)
  - [Trading](#trading)
  - [Privacy Layer](#privacy-layer)
  - [Gamification](#gamification)
- [Build and Test](#build-and-test)
- [Deployment Docs](#deployment-docs)
- [Deployed Addresses (Starknet Sepolia)](#deployed-addresses-starknet-sepolia)
- [Current Constraints](#current-constraints)

## Scope
This document intentionally avoids deployment step-by-step details and focuses on what exists in the contract workspace today.

## Repository Structure
```text
smartcontract/
  src/                      # Main Cairo contracts
    core/                   # Token, treasury, registry, fee collector
    bridge/                 # Swap/bridge aggregators and provider adapters
    staking/                # CAREL/stablecoin/BTC staking pools
    trading/                # Limit order, dark pool, battleship
    privacy/                # Routers, verifier adapters, private apps
    rewards/                # Points, referrals, snapshot distribution
    nft/                    # Discount soulbound NFT
    ai/                     # AI executor + optional verifier
    utils/                  # Shared helpers/oracles
  garaga_real_bls/          # Real Garaga verifier + private executor project
  private_executor_lite/    # Lightweight executor project for lower-spec testing
  tests/                    # Snforge test suites
  scripts/                  # Build, test, deploy, and wiring helpers
```

## Contract Catalog

### Core Protocol
| Contract | File | Purpose |
| --- | --- | --- |
| `CarelToken` | `src/core/token.cairo` | CAREL ERC20 mint/burn base |
| `Treasury` | `src/core/treasury.cairo` | Treasury custody and controlled operations |
| `FeeCollector` | `src/core/fee_collector.cairo` | Fee accounting and splits |
| `Registry` | `src/core/registry.cairo` | Core contract registry |
| `VestingManager` | `src/core/vesting_manager.cairo` | Vesting schedules and tokenomics controls |
| `PointStorage` | `src/rewards/point_storage.cairo` | Points ledger and conversion primitives |
| `SnapshotDistributor` | `src/rewards/snapshot_distributor.cairo` | Snapshot-based claim distribution |
| `ReferralSystem` | `src/rewards/referral_system.cairo` | Referral tracking and rewards |

### Trading
| Contract | File | Purpose |
| --- | --- | --- |
| `SwapAggregator` | `src/bridge/swap_aggregator.cairo` | Starknet swap routing and execution hooks |
| `BridgeAggregator` | `src/bridge/bridge_aggregator.cairo` | Cross-chain route aggregation |
| `DCAOrders` (Limit Order Book) | `src/trading/dca_orders.cairo` | Limit-order create/cancel/execute logic |
| `StakingCarel` | `src/staking/staking_carel.cairo` | CAREL staking pool |
| `StakingStablecoin` | `src/staking/staking_stablecoin.cairo` | Stablecoin staking pool |
| `StakingBTC` | `src/staking/staking_btc.cairo` | BTC/WBTC staking pool |

### Privacy Layer
| Contract | File | Purpose |
| --- | --- | --- |
| `ZkPrivacyRouter` | `src/privacy/zk_privacy_router.cairo` | V1 privacy submit path |
| `PrivacyRouter` | `src/privacy/privacy_router.cairo` | V2 privacy router architecture |
| `GaragaVerifierAdapter` | `src/privacy/garaga_verifier_adapter.cairo` | Adapter for Garaga verifier contracts |
| `ShieldedVault` | `src/privacy/shielded_vault.cairo` | Root/nullifier/commitment storage |
| `VerifierRegistry` | `src/privacy/verifier_registry.cairo` | Verifier routing by action type |
| `PrivateBTCSwap` | `src/bridge/private_btc_swap.cairo` | Private BTC swap flow |
| `DarkPool` | `src/trading/dark_pool.cairo` | Private order commitment/matching |
| `PrivatePayments` | `src/privacy/private_payments.cairo` | Confidential payment flows |
| `AnonymousCredentials` | `src/privacy/anonymous_credentials.cairo` | Nullifier-based credential proofs |
| `PrivateActionExecutor` / `ShieldedPoolV2` | `garaga_real_bls/src/private_action_executor.cairo` | Private action execution for hide-mode relayer |

Privacy flow (text architecture):
```text
ZkPrivacyRouter -> GaragaVerifierAdapter -> Verifier
```

### Gamification
| Contract | File | Purpose |
| --- | --- | --- |
| `BattleshipGaraga` | `src/trading/battleship_garaga.cairo` | ZK-gated battleship game actions |
| `DiscountSoulbound` | `src/nft/discount_soulbound.cairo` | Non-transferable NFT discount tiers |
| `AIExecutor` | `src/ai/ai_executor.cairo` | Tiered AI action fee and execution gate |

## Build and Test
Build core contracts:
```bash
cd smartcontract
scarb build
```

Run test suites:
```bash
# core contracts
bash scripts/test_core_fast.sh

# Garaga verifier + executor flows
bash scripts/test_garaga_fast.sh
```

Lightweight executor tests (low-spec friendly):
```bash
bash scripts/test_private_executor_lite.sh
```

Current project status: `145/145` tests passing on the active testnet-oriented branch configuration.

## Deployment Docs
For Starknet Sepolia deployment order, constructor args, and wiring scripts, see [`DEPLOY_TESTNET.md`](DEPLOY_TESTNET.md).

## Deployed Addresses (Starknet Sepolia)
| Contract | Address |
| --- | --- |
| `ZkPrivacyRouter` | `0x0682719dbe8364fc5c772f49ecb63ea2f2cf5aa919b7d5baffb4448bb4438d1f` |
| `PrivateActionExecutor / ShieldedPoolV2` | `0x07e18b8314a17989a74ba12e6a68856a9e4791ce254d8491ad2b4addc7e5bf8e` |
| `Swap Aggregator` | `0x06f3e03be8a82746394c4ad20c6888dd260a69452a50eb3121252fdecacc6d28` |
| `Limit Order Book` | `0x06b189eef1358559681712ff6e9387c2f6d43309e27705d26daff4e3ba1fdf8a` |
| `BattleshipGaraga` | `0x04ea26d455d6d79f185a728ac59cac029a6a5bf2a3ca3b4b75f04b4e8c267dd2` |
| `StakingCarel` | `0x06ed000cdf98b371dbb0b8f6a5aa5b114fb218e3c75a261d7692ceb55825accb` |
| `StakingStablecoin` | `0x014f58753338f2f470c397a1c7ad1cfdc381a951b314ec2d7c9aec06a73a0aff` |
| `StakingBTC` | `0x030098330968d105bf0a0068011b3f166e595582828dbbfaf8e5e204420b1f3b` |

## Current Constraints
- `MockGaragaVerifier` is testnet-only and must never be used on mainnet.
- Hide Mode improves privacy posture but cannot fully hide public chain metadata.
- TWAP and AI gas profiles are still above target.
- Battleship full-state persistence is not fully on-chain yet.
- No proxy upgrade path; upgrades require redeploy plus migration.
