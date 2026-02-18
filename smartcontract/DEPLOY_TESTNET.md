# Testnet Deploy (Starknet Sepolia)

This checklist assumes `scarb` + `sncast` are installed and a funded testnet account exists.

## 1) Env Setup

```bash
export NET=sepolia
export STARKNET_RPC_URL=https://api.zan.top/public/starknet-sepolia/rpc/v0_10
```

Set oracle addresses (Pragma is required for PriceOracle reads):
```bash
export PRAGMA_ORACLE_ADDRESS=0x36031daa264c24520b11d93af622c848b2499b66b41d611bac95e13cfca131a
export CHAINLINK_ORACLE_ADDRESS=0x0
```

RPC compatibility note:
- For large verifier declaration, prefer RPC `starknet_specVersion=0.10.0`.
- Older RPC (`0.8.1`) may fail with `Invalid block id` or `Mismatch compiled class hash`.
- If you have multiple `sncast` versions, use explicit binary:
```bash
/home/frend/.local/bin/sncast --version
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
4. **Treasury**: `Treasury(multisig_admin=ADMIN, token=CAREL)`
5. **PointStorage**: `PointStorage(backend_signer=ADMIN)`
6. **StakingCarel**: `StakingCarel(token=CAREL, reward_pool=ADMIN)`
7. **SnapshotDistributor**: `SnapshotDistributor(token=CAREL, staking=StakingCarel, dev=ADMIN, treasury=ADMIN, signer=ADMIN, protocol_start=NOW)`
8. **PriceOracle**: `PriceOracle(pragma=PRAGMA_ORACLE_ADDRESS, chainlink=CHAINLINK_ORACLE_ADDRESS, owner=ADMIN)`
9. **AIExecutor**: `AIExecutor(carel_token=CAREL, backend_signer=ADMIN)`
10. **BridgeAggregator**: `BridgeAggregator(owner=ADMIN, min_liquidity=0)`
11. **ZkPrivacyRouter**: `ZkPrivacyRouter(admin=ADMIN, verifier=GaragaAdapter)`
12. **PrivateBTCSwap**: `PrivateBTCSwap(admin=ADMIN, verifier=GaragaAdapter)`
13. **DarkPool**: `DarkPool(admin=ADMIN, verifier=GaragaAdapter)`
14. **PrivatePayments**: `PrivatePayments(admin=ADMIN, verifier=GaragaAdapter)`
15. **AnonymousCredentials**: `AnonymousCredentials(admin=ADMIN, verifier=GaragaAdapter)`
16. **DCA Orders** (limit order book): `DCAOrders(owner=ADMIN)`

### Optional: Deploy Garaga Real Verifier (BLS) + Wire V1 Router
Use this if you want real proof verification for Hide Balance flow (not mock verifier):

```bash
cd smartcontract/garaga_real_bls
RPC=https://api.zan.top/public/starknet-sepolia/rpc/v0_10
SN=/home/frend/.local/bin/sncast

# 1) Declare verifier class (generated project in garaga_real_bls)
$SN --wait -a sepolia -p sepolia declare \
  --contract-name Groth16VerifierBLS12_381 \
  --url $RPC

# 2) Deploy verifier instance
$SN --wait -a sepolia -p sepolia deploy \
  --class-hash 0x<CLASS_HASH_FROM_DECLARE> \
  --url $RPC
```

After deploy, wire addresses:
```bash
GARAGA_VERIFIER=0x<DEPLOYED_VERIFIER_ADDRESS>
GARAGA_ADAPTER=0x<GARAGA_ADAPTER_ADDRESS>
ZK_ROUTER=0x<ZK_PRIVACY_ROUTER_ADDRESS>

# adapter -> verifier real
$SN --wait -a sepolia -p sepolia invoke --contract-address $GARAGA_ADAPTER --function set_verifier --calldata $GARAGA_VERIFIER --url $RPC

# mode 5 = verify_groth16_proof_bls12_381(...) returning Option<Span<u256>>
$SN --wait -a sepolia -p sepolia invoke --contract-address $GARAGA_ADAPTER --function set_verification_mode --calldata 5 --url $RPC

# V1 router -> adapter
$SN --wait -a sepolia -p sepolia invoke --contract-address $ZK_ROUTER --function set_verifier --calldata $GARAGA_ADAPTER --url $RPC
```

## 4) Export addresses

Create a JSON mapping to plug into backend `.env`:

```json
{
  "CAREL_TOKEN_ADDRESS": "0x...",
  "SNAPSHOT_DISTRIBUTOR_ADDRESS": "0x...",
  "POINT_STORAGE_ADDRESS": "0x...",
  "STAKING_CAREL_ADDRESS": "0x...",
  "TREASURY_ADDRESS": "0x...",
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

## 6) V2 Privacy Wiring (Full ZKP)

Set default verifier in `VerifierRegistry` and wire `PrivacyRouter` into all contracts:

```bash
bash smartcontract/scripts/07_wire_privacy_router_v2.sh
```

Default verifier uses `PRIVACY_VERIFIER_KIND=garaga` and `GARAGA_ADAPTER_ADDRESS`. You can override with:

```bash
export PRIVACY_VERIFIER_KIND=tongo   # or semaphore
export PRIVACY_VERIFIER_ADDRESS=0x... # optional explicit
```

External asset modules (bridge/BTC) are optional. To wire them:

```bash
export PRIVACY_WIRE_EXTERNAL=1
```

## Notes
- The mock verifier makes proof checks always `true` (testnet only).
- `batch_submit_actions` is enabled only when signature verification + fees are disabled.
- If you want strict TWAP window, we can re-enable ring buffer (gas will increase).
- V1 `ZkPrivacyRouter.submit_private_action` now enforces binding: `public_inputs[0] == nullifier` and `public_inputs[1] == commitment`.
- For frontend Hide Balance on-chain flow, set `NEXT_PUBLIC_ENABLE_DEV_GARAGA_AUTOFILL=false`, hard reload frontend, submit real proof first via Privacy Router, then execute swap/bridge.
