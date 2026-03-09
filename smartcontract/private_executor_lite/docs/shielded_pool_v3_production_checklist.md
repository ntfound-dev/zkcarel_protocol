# ShieldedPoolV3 Production Checklist

This checklist is the minimum sign-off set before promoting `ShieldedPoolV3` beyond testnet.

## 1. Circuit Audit for `private_exit_v3`

`private_exit_v3` trusts the verifier/circuit to bind `token` and `amount` to the spent note.
That means the circuit audit must explicitly confirm:

- The exit proof exposes and binds the same `root`, `nullifier`, `recipient`, and exit hash that the contract checks.
- The exit hash inside the circuit is computed over the same tuple as the contract:
  `contract_address`, `chain_id`, `ACTION_PRIVATE_EXIT_V3`, `token`, `amount.low`, `amount.high`, `recipient`.
- The note commitment formula inside the circuit actually commits to the asset identity and amount being exited.
- The Merkle path proves inclusion against the same tree semantics used by on-chain `set_root`.
- The nullifier formula is unique per note and cannot be malleated across multiple witnesses.
- Public outputs are canonical field encodings; no silent truncation or alternate encodings are accepted.
- Cross-chain and cross-deployment replay is impossible because the circuit and contract both use the same domain separator.
- Negative tests exist for mismatched `token`, mismatched `amount`, mismatched `recipient`, stale `root`, and reused `nullifier`.

If any of the points above cannot be proven from the circuit, `private_exit_v3` must not be treated as production-safe.

## 2. Submission / Execution Circuit Alignment

The submit and execute path must stay aligned with the contract hash logic:

- `action_hash` in the circuit must bind:
  `contract_address`, `chain_id`, `action_type`, `target`, `selector`, `calldata_hash`,
  `approval_token`, `approval_amount`, `payout_token`, `min_payout`.
- The proof public outputs must include `root`, `nullifier`, `action_hash`, and `recipient`.
- If stronger protection against proof theft before first inclusion is required, bind a submitter key or signed intent in the circuit or submission envelope.

## 3. Governance Requirements

For production deployment, treat the constructor `admin` as a governance contract address, not a personal wallet.

Minimum recommendation:

- Deploy with a multisig as `admin`.
- Keep `relayer` separate from `admin`.
- Use a documented operating procedure for `set_root`, `set_relayer`, and `set_asset_rule`.
- Keep the verifier upgrade delay enabled and monitored.
- Test `pause()` / `unpause()` in the same environment used for deployment rehearsals.

## 4. Operational Readiness

- Run `snforge test` on the exact revision being deployed.
- Verify the deployed class hash matches the reviewed build artifact.
- Publish the production admin, relayer, and verifier addresses before enabling deposits.
- Rehearse the incident workflow:
  `pause -> cancel stuck actions if needed -> rotate relayer/verifier/admin -> unpause`.
