# private_executor_lite

CPU-friendly Cairo project untuk test/deploy kontrak privacy layer tanpa compile dependency Garaga generator yang berat.

## Kontrak di project ini
- `PrivateActionExecutor`: executor hide-mode generasi awal (swap/limit/stake).
- `ShieldedPoolV2`: arsitektur V2 untuk hide-mode berbasis shielded note + relayer batching (lebih cocok untuk full-anon roadmap).

## Kenapa ada project ini
- `smartcontract/garaga_real_bls` memuat generated Groth16 verifier + dependency Garaga, compile sangat berat.
- Untuk laptop low CPU/RAM, kontrak executor/pool bisa diiterasi cepat di sini, lalu tetap pakai alamat verifier Garaga yang sudah dideploy.

## Run Tests
```bash
cd /mnt/c/Users/frend/zkcare_protocol/smartcontract/private_executor_lite
asdf exec snforge test
```

## Deploy `PrivateActionExecutor`
```bash
cd /mnt/c/Users/frend/zkcare_protocol/smartcontract/private_executor_lite
asdf exec sncast --wait -a sepolia declare --contract-name PrivateActionExecutor --url <RPC>
```

Constructor:
- `admin`
- `verifier` (alamat verifier Garaga existing)
- `relayer`
- `swap_target`
- `limit_order_target`
- `staking_target`

## Deploy `ShieldedPoolV2`
```bash
cd /mnt/c/Users/frend/zkcare_protocol/smartcontract/private_executor_lite
asdf exec sncast --wait -a sepolia declare --contract-name ShieldedPoolV2 --url <RPC>
```

Constructor:
- `admin`
- `verifier` (alamat verifier Garaga existing)
- `relayer`

Flow V2 (ringkas):
1. Admin set fixed denomination per token via `set_asset_rule`.
2. User deposit fixed amount ke pool via `deposit_fixed(token, note_commitment)`.
3. User submit proof intent via `submit_private_action` (bind `nullifier`, `commitment`, `action_hash`).
4. Eksekusi hide mode:
   - Swap: `execute_private_swap_with_payout` / `execute_private_swap_with_payout_batch`
   - Limit order: `execute_private_limit_order` / `execute_private_limit_order_batch`
   - Stake: `execute_private_stake` / `execute_private_stake_batch`
5. Single execute mendukung `owner/relayer/admin` (user bisa tanda tangan on-chain).
6. Optional fixed withdrawal via `withdraw_fixed`.
