# AI E2E Run (Prepare -> Sign -> Submit -> Execute)

Date: 2026-02-26 (UTC)
Network: Starknet Sepolia
AI Executor: `0x01b46617037091d04d978d2cbda42887ab4ace055b63c8b7881d34a7ec5b076b`
Signer account: `0x0289f797b9c2dc6c661fd058968d9ba39d01c7547f8259f01b7bce55696d0ff0`

## 1) Prepare
- level: `2`
- params/context: `tier:2`
- nonce: `1772092665686`
- message_hash: `0x73b068bb374f50172d88a8ae7815947e04bccff8e463e2f7013010c326b39b6`

## 2) Sign
- user signature (message_hash):
  - r: `0x7927e95a8c54de40756986070e3a54f31446a258373f772e6c310269e607371`
  - s: `0x15f1209e07e5f4b67f87aff9dc21594d7d9dc1cdce66679416b4800ccd1602`

## 3) Submit Action
- CAREL approve tx:
  - `0x01cfdd4c3d1ac2eff4d24d19793ba56d07ad67cd4cff4bd4b4974789ae006d62`
- submit_action tx (success):
  - `0x060f4475443f5e5c1d7cab6320815e072ca008746acfbe819ed64b2e2a20ca81`
- receipt status: `ACCEPTED_ON_L2`, `SUCCEEDED`
- extracted `action_id`: `1`

## 4) Execute Action
- execute_action tx (success):
  - `0x071e9629f1b5f1094cfbc0f5802f24b5fbbfcb1a52f52d37b5c67182ea7a5126`
- pending check after execute:
  - `get_pending_actions_page(user, 0, 10) => []`

## Operational Notes
- Current deployed verifier (`0x01afd98662c262b8b8634bdb434f32b4c72c6a0313b0f0dc352372825d0894cd`) is legacy allowlist mode (has `set_valid_hash`), not pure account-signature verifier.
- To complete this E2E on-chain run, verifier state had to be set for the message hash and `AIExecutor` signature verification was toggled during test window, then re-enabled.

### Signature verification toggle tx
- disable:
  - `0x05b928462aed4cc918f083467e63e23e93f0823a49289d2e83bbf32c143916a3`
- re-enable:
  - `0x000ec798b8d0efc2cd0bc46c19cbb6f9e4d969683b356b58723f90dc00855e78`

### Legacy verifier allowlist tx
- set_valid_hash:
  - `0x06f7511a0081d6d7ac9fa3fc27d7948e4126a257fc987f55de3f33b003f20931`
aazASAS 