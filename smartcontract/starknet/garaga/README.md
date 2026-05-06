# Garaga — Noir Circuits + Cairo Verifiers

This directory contains the Noir ZK circuits for CAREL's private action proofs and the
artifacts produced by the Garaga toolchain. Cairo verifier contracts generated from
these circuits live in `smartcontract/starknet/cairo/src/garaga_verifiers/`.

The split is intentional: Noir circuit logic, proving artifacts, and Cairo verifier
output are kept separate so audit/review can clearly distinguish where each layer begins
and ends.

## Directory Layout

```
garaga/
├── circuits/
│   ├── starknet_note_v4/       # Shared Noir library — Poseidon hash, Merkle root,
│   │                           #   note commitment, nullifier primitives
│   ├── carel_swap/             # Private swap circuit
│   ├── carel_stake/            # Private stake circuit
│   ├── carel_limit/            # Private limit order circuit
│   ├── shadow_btc/             # BTC shadow bridge circuit (stub — see TODOs)
│   └── noir_bignum_vendor/     # Vendored noir-bignum library (shallow-cloned)
├── artifacts/
│   ├── carel_swap/             # proof/, vk.bin/ for swap verifier
│   ├── carel_stake/            # proof/, vk.bin/ for stake verifier
│   ├── carel_limit/            # proof/, vk.bin/ for limit verifier
│   └── shadow_btc/             # proof/, vk.bin/ for BTC verifier
└── verifiers/
    └── README.md               # Pointer — generated Cairo lives in cairo/src/garaga_verifiers/
```

## Shared Library — `starknet_note_v4`

All circuits depend on this shared Noir library. It implements:

| Function | Description |
|----------|-------------|
| `compute_nullifier_v4(note_secret)` | `Poseidon(note_secret, 0)` |
| `compute_note_commitment_v4(secret, amount, token)` | `Poseidon3(secret, amount, token)` |
| `compute_merkle_root_v4(leaf, path[20], bits[20])` | Depth-20 Poseidon Merkle root |
| `poseidon_hash_many_2(x, y)` | Two-input Poseidon over Stark252 field |
| `hades_permutation(state[3])` | Hades MDS permutation (4 full + 83 partial + 4 full rounds) |

The Poseidon implementation is over the Stark252 field using `noir-bignum` for modular
arithmetic. Reference test vectors are included in `starknet_note_v4/src/lib.nr`.

## Circuits

### `carel_swap` — Private Swap

Proves that a note owner is spending a valid note to authorize a swap action.

**Private inputs:**
- `note_secret`, `note_amount`, `note_token` — note preimage
- `merkle_path[20]`, `merkle_index[20]` — Merkle inclusion path
- `swap_token_in`, `swap_token_out`, `amount_in`, `min_amount_out`, `target_dex` — swap params (bound in action_hash)

**Public inputs:**
- `merkle_root`, `nullifier`, `action_hash`, `recipient`, `chain_id`, `contract_address`

**Constraints:**
- `nullifier == Poseidon(note_secret, 0)`
- `note_commitment` is a leaf of the Merkle tree at `merkle_root`
- `amount_in <= note_amount`

---

### `carel_stake` — Private Stake

Proves that a note owner is spending a valid note to authorize a stake action.

**Private inputs:**
- `note_secret`, `note_amount`, `note_token` — note preimage
- `merkle_path[20]`, `merkle_index[20]`
- `target_protocol`, `stake_token`, `stake_amount`, `min_yield_token`, `lock_duration`, `expected_apy_bps`

**Public inputs:**
- `merkle_root`, `nullifier`, `action_hash`, `recipient`, `chain_id`, `contract_address`

**Constraints:**
- `nullifier == Poseidon(note_secret, 0)`
- Merkle inclusion check
- `stake_amount <= note_amount`
- `note_token == stake_token` (token identity — can only stake the note's own token)

---

### `carel_limit` — Private Limit Order

Proves that a note owner is spending a valid note to authorize a limit order action.

**Private inputs:**
- `note_secret`, `note_amount`, `note_token` — note preimage
- `merkle_path[20]`, `merkle_index[20]`
- `swap_token_in`, `swap_token_out`, `amount_in`, `min_amount_out`
- `condition_type` (`0` = buy trigger, `1` = sell trigger), `trigger_price`, `price_oracle`, `target_dex`

**Public inputs:**
- `merkle_root`, `nullifier`, `action_hash`, `recipient`, `chain_id`, `contract_address`

**Constraints:**
- `nullifier == Poseidon(note_secret, 0)`
- Merkle inclusion check
- `amount_in <= note_amount`
- `condition_type <= 1`

---

### `shadow_btc` — BTC Shadow Bridge (stub)

Proves that a Bitcoin transaction has been included in a block and links it to a
ShieldedPoolV4 note commitment.

**Private inputs:**
- `note_secret`, `amount_satoshi`, `note_token` — note preimage
- `txid`, `merkle_path[32]`, `merkle_index[32]` — BTC Merkle path (depth 32)
- `block_merkle_root`, `block_hash`

**Public inputs:**
- `root`, `nullifier`, `action_hash`, `recipient`, `chain_id`, `contract_address`, `commitment`

**Constraints (current):**
- Merkle root computed from `txid` matches `block_merkle_root`
- `root == block_merkle_root`
- `nullifier == Poseidon(note_secret, 0)`
- `commitment == compute_note_commitment_v4(note_secret, amount_satoshi, note_token)`

> **TODO (v4-btc):** Current implementation uses Poseidon as a placeholder for the
> Bitcoin Merkle hash function. The following are not yet implemented:
> - Replace placeholder with `sha256d` Bitcoin gadget
> - Verify `sha256d(raw_tx) == txid`
> - Verify BTC Merkle root from txid using `sha256d` tree
> - Verify block header hash + PoW (`sha256d(header) == block_hash`)
>
> Do not use `shadow_btc` in production until all TODO items are implemented and audited.

---

## Build / Update Flow

### 1. Compile a circuit

```bash
cd circuits/carel_swap
nargo compile
```

Output: `target/carel_swap.json` (ACIR bytecode) and `target/vk/vk`.

### 2. Generate a proof (for testing / artifact refresh)

```bash
nargo prove
```

Output: `target/proof` and `target/public_inputs`. Copy these to `artifacts/<circuit>/proof/`.

### 3. Regenerate Cairo verifiers with Garaga

```bash
garaga gen --system ultra_keccak_zk_honk \
    --vk circuits/carel_swap/target/vk/vk \
    --output ../cairo/src/garaga_verifiers/swap_verifier/
```

Repeat for `carel_stake` → `stake_verifier/`, `carel_limit` → `limit_verifier/`,
`shadow_btc` → `btc_verifier/`.

### 4. Build the Cairo package

```bash
cd ../cairo
scarb build
```

### When to regenerate

Regenerate Cairo verifiers whenever a circuit's constraints, public input layout, or
verification key changes. The generated files (`honk_verifier.cairo`,
`honk_verifier_circuits.cairo`, `honk_verifier_constants.cairo`) are not edited
manually — run the Garaga step above instead.

## Note on `noir_bignum_vendor`

`circuits/noir_bignum_vendor/` is a shallow-cloned vendored copy of the
[`noir-bignum`](https://github.com/noir-lang/noir-bignum) library, pinned at the
version used when verifiers were generated. Do not update it without re-running the
full circuit compile + Garaga verifier generation pipeline, as the Stark252 limb
encoding must match between Noir and Cairo.

## V4 Design Notes

- V4 uses a single on-chain call that verifies proof + action hash in one step.
- All circuits share the same note/nullifier/Merkle primitive via `starknet_note_v4`.
- `chain_id` and `contract_address` are public inputs in every circuit, providing
  domain separation that prevents cross-chain and cross-contract proof replay.
- `action_hash` binds the specific action parameters (amounts, tokens, recipient) to
  the proof; the verifier contract checks that calldata matches `action_hash`.
