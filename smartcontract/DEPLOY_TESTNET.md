# Testnet Deploy (Starknet Sepolia)

This checklist assumes `scarb` + `starkli` are installed and a funded testnet account exists.

## 1) Env Setup

```bash
export STARKNET_RPC_URL=https://starknet-sepolia.public.blastapi.io
export STARKNET_ACCOUNT=~/.starkli/account.json
export STARKNET_KEYSTORE=~/.starkli/keystore.json
```

## 2) Build

```bash
cd smartcontract
scarb build
```

## 3) Deploy order (minimal for backend integration)

> Use your deployer address as `ADMIN`.

1. **Mock verifier** (testnet): `MockGaragaVerifier(admin, true)`
2. **Garaga adapter**: `GaragaVerifierAdapter(admin, mock_garaga_verifier)`
3. **CAREL token**: `CarelToken(multisig_admin=ADMIN)`
4. **PointStorage**: `PointStorage(backend_signer=ADMIN)`
5. **StakingCarel**: `StakingCarel(token=CAREL, reward_pool=ADMIN)`
6. **SnapshotDistributor**: `SnapshotDistributor(token=CAREL, staking=StakingCarel, dev=ADMIN, treasury=ADMIN, signer=ADMIN, protocol_start=NOW)`
7. **PriceOracle**: `PriceOracle(pragma=0x0, chainlink=0x0, owner=ADMIN)`
8. **AIExecutor**: `AIExecutor(carel_token=CAREL, backend_signer=ADMIN)`
9. **BridgeAggregator**: `BridgeAggregator(owner=ADMIN, min_liquidity=0)`
10. **ZkPrivacyRouter**: `ZkPrivacyRouter(admin=ADMIN, verifier=GaragaAdapter)`
11. **PrivateBTCSwap**: `PrivateBTCSwap(admin=ADMIN, verifier=GaragaAdapter)`
12. **DarkPool**: `DarkPool(admin=ADMIN, verifier=GaragaAdapter)`
13. **PrivatePayments**: `PrivatePayments(admin=ADMIN, verifier=GaragaAdapter)`
14. **AnonymousCredentials**: `AnonymousCredentials(admin=ADMIN, verifier=GaragaAdapter)`
15. **DCA Orders** (limit order book): `DCAOrders(owner=ADMIN)`

## 4) Export addresses

Create a JSON mapping to plug into backend `.env`:

```json
{
  "CAREL_TOKEN_ADDRESS": "0x...",
  "SNAPSHOT_DISTRIBUTOR_ADDRESS": "0x...",
  "POINT_STORAGE_ADDRESS": "0x...",
  "PRICE_ORACLE_ADDRESS": "0x...",
  "LIMIT_ORDER_BOOK_ADDRESS": "0x...",
  "REFERRAL_SYSTEM_ADDRESS": "0x...",
  "AI_EXECUTOR_ADDRESS": "0x...",
  "BRIDGE_AGGREGATOR_ADDRESS": "0x...",
  "ZK_PRIVACY_ROUTER_ADDRESS": "0x...",
  "PRIVATE_BTC_SWAP_ADDRESS": "0x...",
  "DARK_POOL_ADDRESS": "0x...",
  "PRIVATE_PAYMENTS_ADDRESS": "0x...",
  "ANONYMOUS_CREDENTIALS_ADDRESS": "0x..."
}
```

## 5) Backend

Copy `backend-rust/.env.testnet.example` → `.env` and fill contract addresses + keys.

Start backend:

```bash
cd backend-rust
cargo run
```

## Notes
- The mock verifier makes proof checks always `true` (testnet only).
- `batch_submit_actions` is enabled only when signature verification + fees are disabled.
- If you want strict TWAP window, we can re-enable ring buffer (gas will increase).
