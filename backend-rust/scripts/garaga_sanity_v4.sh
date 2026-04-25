#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
BACKEND_DIR=$(cd "${SCRIPT_DIR}/.." && pwd)
cd "${BACKEND_DIR}"

AUTO_PROVER_BIN="${GARAGA_AUTO_PROVER_BIN:-}"
if [[ -z "${AUTO_PROVER_BIN}" ]]; then
  if [[ -x "./target/debug/garaga_auto_prover" ]]; then
    AUTO_PROVER_BIN="./target/debug/garaga_auto_prover"
  elif [[ -x "./target/release/garaga_auto_prover" ]]; then
    AUTO_PROVER_BIN="./target/release/garaga_auto_prover"
  elif [[ -x "/usr/local/bin/garaga_auto_prover" ]]; then
    AUTO_PROVER_BIN="/usr/local/bin/garaga_auto_prover"
  fi
fi

if [[ -z "${AUTO_PROVER_BIN}" ]]; then
  echo "garaga_auto_prover binary not found. Build it or set GARAGA_AUTO_PROVER_BIN." >&2
  exit 1
fi

TMP_DIR=$(mktemp -d)
CTX_PATH="${TMP_DIR}/context.json"
PAYLOAD_PATH="${TMP_DIR}/payload.json"
PROOF_PATH="${TMP_DIR}/proof.bin"
PUBLIC_INPUTS_PATH="${TMP_DIR}/public_inputs.bin"

python3 - <<'PY' > "${CTX_PATH}"
import json
ctx = {
    "user_address": "0x111",
    "verifier": "garaga",
    "requested_at_unix": 1710000000,
    "tx_context": {
        "flow": "swap",
        "note_version": "v4",
        "from_token": "0x11",
        "to_token": "0x22",
        "amount": "5",
        "nonce": "n1",
        "root": "0x27c46bd4885255fc6d8bae5cacc6320132d0e31732b4a4c9f28022a77e01f6fd",
        "nullifier": "0x28bb28a2c7566e896a177dc7328d4298d197973bcac177fb8291984a1cc43b7f",
        "action_hash": "0x999",
        "recipient": "0xabc",
        "chain_id": "0x1",
        "contract_address": "0x555",
        "noir_inputs": {
            "note_secret": "0x01",
            "note_amount": "10",
            "note_token": "0x02",
            "merkle_path": [
                "0x0","0x0","0x0","0x0","0x0",
                "0x0","0x0","0x0","0x0","0x0",
                "0x0","0x0","0x0","0x0","0x0",
                "0x0","0x0","0x0","0x0","0x0"
            ],
            "merkle_index": [
                False,False,False,False,False,
                False,False,False,False,False,
                False,False,False,False,False,
                False,False,False,False,False
            ],
            "swap_token_in": "0x11",
            "swap_token_out": "0x22",
            "amount_in": "5",
            "min_amount_out": "1",
            "target_dex": "0x33",
            "merkle_root": "0x27c46bd4885255fc6d8bae5cacc6320132d0e31732b4a4c9f28022a77e01f6fd",
            "nullifier": "0x28bb28a2c7566e896a177dc7328d4298d197973bcac177fb8291984a1cc43b7f",
            "action_hash": "0x999",
            "recipient": "0xabc",
            "chain_id": "0x1",
            "contract_address": "0x555"
        }
    }
}
print(json.dumps(ctx))
PY

REMOTE_URL="${GARAGA_NOIR_PROVER_URL:-}"
REMOTE_MODE="${GARAGA_NOIR_PROVER_REQUEST_MODE:-context}"
REMOTE_TIMEOUT="${GARAGA_NOIR_PROVER_TIMEOUT_SECS:-120}"

if [[ -n "${REMOTE_URL}" ]]; then
  if ! curl -sS --fail --max-time 3 "${REMOTE_URL%/}/health" >/dev/null; then
    echo "Remote prover is not reachable at ${REMOTE_URL}. Start the stub or fix GARAGA_NOIR_PROVER_URL." >&2
    exit 1
  fi
fi

PAYLOAD_JSON=$(
  GARAGA_PROVE_CMD="bash scripts/garaga_noir_prover.sh" \
  GARAGA_SYSTEM=honk \
  GARAGA_USE_HONK=true \
  GARAGA_ALLOW_PRECOMPUTED_PAYLOAD=false \
  GARAGA_ALLOW_STATEMENT_OVERRIDE=false \
  GARAGA_NOIR_PROVER_URL="${REMOTE_URL}" \
  GARAGA_NOIR_PROVER_REQUEST_MODE="${REMOTE_MODE}" \
  GARAGA_NOIR_PROVER_TIMEOUT_SECS="${REMOTE_TIMEOUT}" \
  GARAGA_PROOF_PATH="${PROOF_PATH}" \
  GARAGA_PUBLIC_INPUTS_PATH="${PUBLIC_INPUTS_PATH}" \
  GARAGA_ROOT_PUBLIC_INPUT_INDEX=0 \
  GARAGA_NULLIFIER_PUBLIC_INPUT_INDEX=1 \
  GARAGA_INTENT_HASH_PUBLIC_INPUT_INDEX=2 \
  GARAGA_RECIPIENT_PUBLIC_INPUT_INDEX=3 \
  GARAGA_CHAIN_ID_PUBLIC_INPUT_INDEX=4 \
  GARAGA_CONTRACT_PUBLIC_INPUT_INDEX=5 \
  GARAGA_COMMITMENT_PUBLIC_INPUT_INDEX=6 \
  GARAGA_NOIR_CIRCUITS_DIR="../smartcontract/starknet/garaga/circuits" \
  GARAGA_HONK_VK_PATH_SWAP="./garaga_honk_vk/carel_swap/vk" \
  "${AUTO_PROVER_BIN}" < "${CTX_PATH}"
)

printf '%s' "${PAYLOAD_JSON}" > "${PAYLOAD_PATH}"

python3 - <<'PY' "${CTX_PATH}" "${PAYLOAD_PATH}"
import json
import sys

def norm(value):
    if value is None:
        return None
    if isinstance(value, str):
        raw = value.strip().lower()
        if raw.startswith("0x"):
            raw = raw[2:]
            raw = raw.lstrip("0") or "0"
            return "0x" + raw
        return raw
    return value

ctx_path = sys.argv[1]
payload_path = sys.argv[2]
ctx = json.load(open(ctx_path))
payload = json.load(open(payload_path))

tx = ctx.get("tx_context", {})
noir_inputs = tx.get("noir_inputs", {})

expected = {
    "root": noir_inputs.get("merkle_root") or tx.get("root"),
    "nullifier": noir_inputs.get("nullifier") or tx.get("nullifier"),
    "action_hash": noir_inputs.get("action_hash") or tx.get("action_hash"),
    "recipient": noir_inputs.get("recipient") or tx.get("recipient"),
    "chain_id": noir_inputs.get("chain_id") or tx.get("chain_id"),
    "contract_address": noir_inputs.get("contract_address") or tx.get("contract_address"),
}

public_inputs = payload.get("public_inputs", [])
errors = []

if payload.get("note_version") != "v4":
    errors.append(f"note_version != v4 (got {payload.get('note_version')})")

if not payload.get("proof"):
    errors.append("proof is empty")

if len(public_inputs) < 6:
    errors.append(f"public_inputs too short: len={len(public_inputs)}")

index_checks = {
    0: expected["root"],
    1: expected["nullifier"],
    2: expected["action_hash"],
    3: expected["recipient"],
    4: expected["chain_id"],
    5: expected["contract_address"],
}

for idx, expected_value in index_checks.items():
    if expected_value is None:
        errors.append(f"missing expected value for public_inputs[{idx}]")
        continue
    if idx >= len(public_inputs):
        errors.append(f"public_inputs[{idx}] missing")
        continue
    if norm(public_inputs[idx]) != norm(expected_value):
        errors.append(
            f"public_inputs[{idx}] mismatch: got {public_inputs[idx]} expected {expected_value}"
        )

if errors:
    print("SANITY FAIL:")
    for err in errors:
        print("-", err)
    sys.exit(1)

print("SANITY OK: v4 payload generated and public inputs bind correctly.")
print(f"proof_len={len(payload.get('proof', []))} public_inputs_len={len(public_inputs)}")
PY

rm -rf "${TMP_DIR}"
