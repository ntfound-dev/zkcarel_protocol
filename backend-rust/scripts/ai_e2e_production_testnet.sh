#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if ! command -v sncast >/dev/null 2>&1; then
  echo "sncast not found in PATH" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "jq not found in PATH" >&2
  exit 1
fi

AI_EXECUTOR_ADDRESS="${AI_EXECUTOR_ADDRESS:-}"
CAREL_TOKEN_ADDRESS="${CAREL_TOKEN_ADDRESS:-}"
AI_SIGNATURE_VERIFIER_ADDRESS="${AI_SIGNATURE_VERIFIER_ADDRESS:-}"
BACKEND_PRIVATE_KEY="${BACKEND_PRIVATE_KEY:-}"
BACKEND_ACCOUNT_ADDRESS="${BACKEND_ACCOUNT_ADDRESS:-}"
STARKNET_CHAIN_ID="${STARKNET_CHAIN_ID:-SN_SEPOLIA}"

USER_ALIAS="${USER_ALIAS:-deployer}"
USER_ADDRESS="${USER_ADDRESS:-}"
USER_PRIVATE_KEY="${USER_PRIVATE_KEY:-}"
BACKEND_ALIAS="${BACKEND_ALIAS:-sepolia}"
LEVEL="${LEVEL:-2}"
CONTEXT="${CONTEXT:-tier:2}"
APPROVE_AMOUNT_WEI="${APPROVE_AMOUNT_WEI:-5000000000000000000}" # default: 5 CAREL
PENDING_LIMIT="${PENDING_LIMIT:-20}"

if [ -z "$AI_EXECUTOR_ADDRESS" ] || [ -z "$CAREL_TOKEN_ADDRESS" ] || [ -z "$AI_SIGNATURE_VERIFIER_ADDRESS" ]; then
  echo "Missing AI contract addresses in env." >&2
  exit 1
fi
if [ -z "$BACKEND_PRIVATE_KEY" ] || [ -z "$BACKEND_ACCOUNT_ADDRESS" ]; then
  echo "Missing BACKEND_PRIVATE_KEY or BACKEND_ACCOUNT_ADDRESS in env." >&2
  exit 1
fi
if [ -z "$USER_ADDRESS" ] || [ -z "$USER_PRIVATE_KEY" ]; then
  cat >&2 <<'EOF'
Set USER_ADDRESS and USER_PRIVATE_KEY before running.
Example:
  export USER_ALIAS=deployer
  export USER_ADDRESS=0x0494...
  export USER_PRIVATE_KEY=0x549b...
EOF
  exit 1
fi

to_u256_low_high() {
  local value="$1"
  python3 - "$value" <<'PY'
import sys
v = int(sys.argv[1], 0)
low = v & ((1 << 128) - 1)
high = v >> 128
print(hex(low))
print(hex(high))
PY
}

invoke_retry() {
  local alias="$1"; shift
  local desc="$1"; shift
  local max=8
  local base=6
  local i=1
  local out=""
  local status=0
  while [ "$i" -le "$max" ]; do
    set +e
    out=$(sncast --wait --wait-timeout 300 --wait-retry-interval 8 --account "$alias" invoke --network sepolia "$@" 2>&1)
    status=$?
    set -e
    if [ "$status" -eq 0 ] && ! echo "$out" | grep -Eqi "^Error:|Unexpected RPC error|Transaction execution error|Unknown RPC error|JSON-RPC error"; then
      echo "$out"
      return 0
    fi
    echo "$out" >&2
    if echo "$out" | grep -Eqi "cu limit exceeded|request too fast|too many requests|429|invalid transaction nonce|nonce is invalid|actual nonce|timeout|error sending request|Unexpected RPC error|gateway/add_transaction"; then
      sleep $((base * i))
      i=$((i + 1))
      continue
    fi
    echo "$desc failed (non-retryable)." >&2
    return 1
  done
  echo "$desc failed (retry exhausted)." >&2
  return 1
}

call_json() {
  sncast -j call --network sepolia "$@"
}

echo "== AI E2E production-testnet =="
echo "AIExecutor : $AI_EXECUTOR_ADDRESS"
echo "Verifier   : $AI_SIGNATURE_VERIFIER_ADDRESS"
echo "User       : $USER_ALIAS ($USER_ADDRESS)"
echo "Backend    : $BACKEND_ALIAS ($BACKEND_ACCOUNT_ADDRESS)"

if [ "${USER_ADDRESS,,}" = "${BACKEND_ACCOUNT_ADDRESS,,}" ]; then
  echo "USER_ADDRESS must be different from BACKEND_ACCOUNT_ADDRESS." >&2
  exit 1
fi

echo
echo "1) Force-enable signature verification on AIExecutor..."
ENABLE_OUT=$(invoke_retry "$BACKEND_ALIAS" "set_signature_verification" \
  --contract-address "$AI_EXECUTOR_ADDRESS" \
  --function set_signature_verification \
  --calldata "$AI_SIGNATURE_VERIFIER_ADDRESS" 1)
echo "$ENABLE_OUT"
ENABLE_TX=$(echo "$ENABLE_OUT" | awk '/Transaction Hash/ {print $NF; exit}')

echo
echo "2) Pending before submit..."
PENDING_BEFORE_JSON=$(call_json --contract-address "$AI_EXECUTOR_ADDRESS" --function get_pending_actions_page --calldata "$USER_ADDRESS" 0 "$PENDING_LIMIT")
echo "$PENDING_BEFORE_JSON"

echo
echo "3) Prepare and sign user action hash..."
PREP_JSON=$(cd "$ROOT" && cargo run --quiet --bin ai_e2e_tools -- prepare-sign "$USER_ADDRESS" "$USER_PRIVATE_KEY" "$LEVEL" "$CONTEXT" "$STARKNET_CHAIN_ID")
echo "$PREP_JSON" > /tmp/ai_prepare_sign_latest.json
cat /tmp/ai_prepare_sign_latest.json

ACTION_TYPE=$(jq -r '.action_type' /tmp/ai_prepare_sign_latest.json)
MESSAGE_HASH=$(jq -r '.message_hash' /tmp/ai_prepare_sign_latest.json)
USER_SIG_R=$(jq -r '.user_signature.r' /tmp/ai_prepare_sign_latest.json)
USER_SIG_S=$(jq -r '.user_signature.s' /tmp/ai_prepare_sign_latest.json)
BA0=$(jq -r '.params_bytearray_calldata[0]' /tmp/ai_prepare_sign_latest.json)
BA1=$(jq -r '.params_bytearray_calldata[1]' /tmp/ai_prepare_sign_latest.json)
BA2=$(jq -r '.params_bytearray_calldata[2]' /tmp/ai_prepare_sign_latest.json)

readarray -t APPROVE_U256 < <(to_u256_low_high "$APPROVE_AMOUNT_WEI")
APPROVE_LOW="${APPROVE_U256[0]}"
APPROVE_HIGH="${APPROVE_U256[1]}"

echo
echo "4) Approve CAREL for AIExecutor..."
APPROVE_OUT=$(invoke_retry "$USER_ALIAS" "approve" \
  --contract-address "$CAREL_TOKEN_ADDRESS" \
  --function approve \
  --calldata "$AI_EXECUTOR_ADDRESS" "$APPROVE_LOW" "$APPROVE_HIGH")
echo "$APPROVE_OUT"
APPROVE_TX=$(echo "$APPROVE_OUT" | awk '/Transaction Hash/ {print $NF; exit}')

echo
echo "5) submit_action..."
SUBMIT_OUT=$(invoke_retry "$USER_ALIAS" "submit_action" \
  --contract-address "$AI_EXECUTOR_ADDRESS" \
  --function submit_action \
  --calldata "$ACTION_TYPE" "$BA0" "$BA1" "$BA2" "$MESSAGE_HASH" 2 "$USER_SIG_R" "$USER_SIG_S")
echo "$SUBMIT_OUT"
SUBMIT_TX=$(echo "$SUBMIT_OUT" | awk '/Transaction Hash/ {print $NF; exit}')

echo
echo "6) Detect pending action_id..."
PENDING_AFTER_JSON=$(call_json --contract-address "$AI_EXECUTOR_ADDRESS" --function get_pending_actions_page --calldata "$USER_ADDRESS" 0 "$PENDING_LIMIT")
echo "$PENDING_AFTER_JSON"
ACTION_ID=$(echo "$PENDING_AFTER_JSON" | jq -r '.response_raw[1] // empty')
if [ -z "$ACTION_ID" ]; then
  echo "No pending action id found for user after submit_action." >&2
  exit 1
fi
echo "action_id = $ACTION_ID"

echo
echo "7) Read action_hash and sign with backend key..."
ACTION_HASH_JSON=$(call_json --contract-address "$AI_EXECUTOR_ADDRESS" --function get_action_hash --calldata "$ACTION_ID")
echo "$ACTION_HASH_JSON"
ACTION_HASH=$(echo "$ACTION_HASH_JSON" | jq -r '.response_raw[0]')
if [ "$ACTION_HASH" = "0x0" ]; then
  echo "action_hash is zero. Signature verification is likely disabled on-chain." >&2
  exit 1
fi
BACK_SIG_JSON=$(cd "$ROOT" && cargo run --quiet --bin ai_e2e_tools -- sign-hash "$BACKEND_PRIVATE_KEY" "$ACTION_HASH")
echo "$BACK_SIG_JSON" > /tmp/ai_backend_sig_latest.json
cat /tmp/ai_backend_sig_latest.json
BACK_SIG_R=$(jq -r '.signature.r' /tmp/ai_backend_sig_latest.json)
BACK_SIG_S=$(jq -r '.signature.s' /tmp/ai_backend_sig_latest.json)

echo
echo "8) execute_action..."
EXECUTE_OUT=$(invoke_retry "$BACKEND_ALIAS" "execute_action" \
  --contract-address "$AI_EXECUTOR_ADDRESS" \
  --function execute_action \
  --calldata "$ACTION_ID" 2 "$BACK_SIG_R" "$BACK_SIG_S")
echo "$EXECUTE_OUT"
EXECUTE_TX=$(echo "$EXECUTE_OUT" | awk '/Transaction Hash/ {print $NF; exit}')

echo
echo "9) Pending after execute..."
PENDING_FINAL_JSON=$(call_json --contract-address "$AI_EXECUTOR_ADDRESS" --function get_pending_actions_page --calldata "$USER_ADDRESS" 0 "$PENDING_LIMIT")
echo "$PENDING_FINAL_JSON"

RESULT_JSON=/tmp/ai_e2e_production_testnet_result.json
cat > "$RESULT_JSON" <<JSON
{
  "chain_id": "$STARKNET_CHAIN_ID",
  "user_alias": "$USER_ALIAS",
  "user_address": "$USER_ADDRESS",
  "backend_alias": "$BACKEND_ALIAS",
  "backend_address": "$BACKEND_ACCOUNT_ADDRESS",
  "ai_executor": "$AI_EXECUTOR_ADDRESS",
  "ai_verifier": "$AI_SIGNATURE_VERIFIER_ADDRESS",
  "carel_token": "$CAREL_TOKEN_ADDRESS",
  "level": $LEVEL,
  "context": "$CONTEXT",
  "message_hash": "$MESSAGE_HASH",
  "action_hash": "$ACTION_HASH",
  "action_id_felt": "$ACTION_ID",
  "user_signature": { "r": "$USER_SIG_R", "s": "$USER_SIG_S" },
  "backend_signature": { "r": "$BACK_SIG_R", "s": "$BACK_SIG_S" },
  "tx": {
    "enable_signature_verification": "$ENABLE_TX",
    "approve": "$APPROVE_TX",
    "submit_action": "$SUBMIT_TX",
    "execute_action": "$EXECUTE_TX"
  },
  "pending_before": $PENDING_BEFORE_JSON,
  "pending_after_submit": $PENDING_AFTER_JSON,
  "pending_after_execute": $PENDING_FINAL_JSON
}
JSON

echo
echo "== DONE =="
echo "Result file: $RESULT_JSON"
cat "$RESULT_JSON" | jq .

DOC_FILE="$REPO_ROOT/docs/AI_E2E_PREPARE_SIGN_SUBMIT_EXECUTE_2026-02-26.md"
if [ -f "$DOC_FILE" ]; then
  echo
  echo "Tip: append result manually into $DOC_FILE"
fi
