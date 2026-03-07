# Shadow Bitcoin Plan

Raw draft for the `Shadow Bitcoin` plan so it does not get lost again.

## Safe Architecture Draft

### Quote Engine
- calculate rate, fee, slippage, and expiry.
- expose `/quote`, `/execute`, and `/status`.

### Order + State Machine
- status: `created -> source_seen -> source_finalized -> destination_initiated -> destination_redeemed / refunded / expired`.
- store the idempotency key and audit log.

### Watcher Multi-chain
- Bitcoin testnet watcher (UTXO + confirmations).
- Starknet watcher (events + tx receipts).
- retry queue + dead-letter queue.

### Liquidity Vault
- BTC and WBTC inventory.
- rebalance rules and minimum reserve threshold.
- circuit breaker when reserves are too thin.

### Relayer + Privacy Layer
- submit destination transactions through the relayer.
- hide metadata and batch when needed.

### Risk Controls
- per-order limit, per-wallet daily limit, AML/rule checks.
- timeout and auto-refund flow.

### Operator Console
- view stuck orders, force retry, manual refund, RPC health.

## Verification Options

### Option 1: Bitcoin Light Client (SPV)
The Cairo contract stores Bitcoin block headers and verifies a Merkle proof that the transaction is included in the block.

```text
Bitcoin                          Starknet Cairo Contract
────────                         ───────────────────────
Block Header #850000             store_header(header, pow_proof)
  └── Merkle Root                  → verify Proof of Work
       └── your TX                 → update chain tip

User submit:                     verify_tx_inclusion(
  - raw TX                           tx, merkle_path, block_header
  - Merkle path (branch)          )
  - Block header                    → check that sha256d(tx) is in the Merkle tree
                                    → check that the header is already stored
                                    → ✅ TX is proven to exist on Bitcoin
```

Advantages:
- Proven pattern (similar to BTC Relay), easier to understand, and does not require ZK proving time.

Tradeoffs:
- Requires someone to keep submitting Bitcoin headers to Starknet. This can be permissionless, but someone still has to push them.
- Gas cost is high if many headers need to be stored.
- PoW verification in Cairo is heavy (double SHA-256 thousands of times for difficulty checks).

### Option 2: ZK Proof of Bitcoin TX
The user generates a ZK proof (Groth16/STARK) that proves:

> "This transaction exists in a valid Bitcoin block with N confirmations"

```text
Off-chain (user/prover)          Starknet Cairo Contract
───────────────────────          ───────────────────────
Input:                           verify_btc_zk_proof(
  - Bitcoin TX                      proof,
  - Merkle path                     public_inputs: [txid, amount, recipient]
  - Block headers chain          )
  - PoW validity                    → Garaga verifies Groth16
                                    → if valid: release token
↓
generate_proof()  [heavy, ~1-5 minutes]
↓
submit proof to Starknet
```

Advantages:
- Fully trustless once the proof is submitted, no one needs to maintain a chain relay, more private, and one Starknet transaction is enough.

Tradeoffs:
- Proof generation is heavy — Bitcoin header chain verification circuits are very complex (SHA256d in ZK means millions of constraints).
- Not mature yet; still closer to research territory.
- Proving time can be 5-30 minutes.
