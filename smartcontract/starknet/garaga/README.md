# Garaga (Noir + Cairo)

This folder is intentionally split so audit/review can see clearly where Noir ends
and Cairo begins.

## Layout
- `circuits/`  
  Noir sources for private actions (swap/limit/stake/shadow_btc). This is the
  only place we edit circuit logic.
- `verifiers/`  
  Pointer folder only. Generated Cairo verifiers now live in
  `smartcontract/starknet/cairo/src/garaga_verifiers/`.
- `old/`  
  Pointer folder only. Legacy Cairo (v3/private_executor_lite) has been archived
  to `smartcontract/starknet/garaga/archive/`.
- `archive/`  
  Legacy Cairo code kept for reference.

## Build/Update Flow (high-level)
1. Edit Noir in `circuits/*/src/*.nr`.
2. Compile circuits and generate proving artifacts.
3. Use Garaga to generate Cairo verifiers into
   `smartcontract/starknet/cairo/src/garaga_verifiers/`.
4. Wire verifiers into the ShieldedPool V4 contracts.

## Notes
- V4 flows are designed for a single on-chain call that verifies proof + action
  hash in one step.
- V3 legacy uses a two-call flow; keep it isolated in `archive/`.
