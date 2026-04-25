#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"

cd "$ROOT"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

if ! command -v sncast >/dev/null 2>&1; then
  echo "sncast not found in PATH" >&2
  exit 1
fi

EXTERNAL_RPC_URL="${RPC_URL:-}"
SNCAST_MAX_RETRIES="${SNCAST_MAX_RETRIES:-8}"
SNCAST_BASE_SLEEP_SECS="${SNCAST_BASE_SLEEP_SECS:-6}"
SNCAST_WAIT_TIMEOUT="${SNCAST_WAIT_TIMEOUT:-300}"
SNCAST_WAIT_RETRY_INTERVAL="${SNCAST_WAIT_RETRY_INTERVAL:-8}"
CONTRACT_READY_RETRIES="${CONTRACT_READY_RETRIES:-30}"
CONTRACT_READY_SLEEP_SECS="${CONTRACT_READY_SLEEP_SECS:-4}"

detect_rpc_spec_version() {
  local url="$1"
  local resp=""
  if [ -z "$url" ] || ! command -v curl >/dev/null 2>&1; then
    return 1
  fi
  resp="$(curl -sS --max-time 12 -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"starknet_specVersion","params":[]}' \
    "$url" 2>/dev/null || true)"
  echo "$resp" | sed -n 's/.*"result":"\([^"]*\)".*/\1/p' | head -n1
}

normalize_rpc_url() {
  local url="$1"
  local spec=""
  local with_v010=""
  local spec_v010=""
  if [ -z "$url" ] || ! command -v curl >/dev/null 2>&1; then
    echo "$url"
    return 0
  fi
  spec="$(detect_rpc_spec_version "$url")"
  case "$spec" in
    0.10.*|0.11.*|0.12.*|0.13.*)
      echo "$url"
      return 0
      ;;
  esac
  if [[ "$url" != */rpc/v0_10 ]]; then
    with_v010="${url%/}/rpc/v0_10"
    spec_v010="$(detect_rpc_spec_version "$with_v010")"
    case "$spec_v010" in
      0.10.*|0.11.*|0.12.*|0.13.*)
        echo "$with_v010"
        return 0
        ;;
    esac
  fi
  echo "$url"
}

run_sncast() {
  local attempt=1
  local out=""
  local status=0
  while [ "$attempt" -le "$SNCAST_MAX_RETRIES" ]; do
    if out="$("$@" 2>&1)"; then
      # Some sncast paths print "Error: ..." but still exit 0.
      if echo "$out" | grep -Eqi "^Error:|Transaction execution error|Unknown RPC error|JSON-RPC error"; then
        status=1
      else
        echo "$out"
        return 0
      fi
    else
      status=$?
    fi
    echo "$out" >&2
    if echo "$out" | grep -Eqi "cu limit exceeded|request too fast|too many requests|429|invalid transaction nonce|nonce is invalid|actual nonce|requested contract address .* is not deployed|error sending request for url|gateway/add_transaction|timeout"; then
      local sleep_secs=$((SNCAST_BASE_SLEEP_SECS * attempt))
      echo "Transient RPC/nonce issue. Retry $attempt/$SNCAST_MAX_RETRIES in ${sleep_secs}s..." >&2
      sleep "$sleep_secs"
      attempt=$((attempt + 1))
      continue
    fi
    return "$status"
  done
  return "$status"
}

wait_for_contract_ready() {
  local address="$1"
  local attempt=1
  local resp=""
  if [ -z "$RPC_URL" ] || ! command -v curl >/dev/null 2>&1; then
    return 0
  fi
  while [ "$attempt" -le "$CONTRACT_READY_RETRIES" ]; do
    resp="$(curl -sS --max-time 15 -H 'content-type: application/json' \
      --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"starknet_getClassHashAt\",\"params\":[\"latest\",\"$address\"]}" \
      "$RPC_URL" 2>/dev/null || true)"
    if echo "$resp" | grep -q '"result"'; then
      return 0
    fi
    echo "Waiting contract visibility on RPC ($attempt/$CONTRACT_READY_RETRIES): $address" >&2
    sleep "$CONTRACT_READY_SLEEP_SECS"
    attempt=$((attempt + 1))
  done
  echo "Warning: contract still not visible on RPC after retries; continuing with invoke retries." >&2
  return 1
}

update_env_file() {
  local file="$1"
  local key="$2"
  local val="$3"
  if [ ! -f "$file" ]; then
    return 0
  fi
  if grep -q "^${key}=" "$file"; then
    perl -0pi -e "s|^${key}=.*$|${key}=${val}|mg" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

is_placeholder_addr() {
  local value="${1:-}"
  [ -z "$value" ] || [ "$value" = "0x..." ] || [ "$value" = "0x0" ] || [ "$value" = "0x00" ]
}

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

NET="${NET:-}"
if [ -z "$NET" ]; then
  if [ "${NETWORK:-}" = "starknet-sepolia" ]; then
    NET="sepolia"
  else
    NET="${NETWORK:-sepolia}"
  fi
fi
RPC_URL="${EXTERNAL_RPC_URL:-${RPC_URL:-${STARKNET_RPC_URL:-${STARKNET_API_RPC_URL:-}}}}"
if [ -n "$RPC_URL" ]; then
  RPC_URL_NORMALIZED="$(normalize_rpc_url "$RPC_URL")"
  if [ "$RPC_URL_NORMALIZED" != "$RPC_URL" ]; then
    echo "RPC URL adjusted to v0_10 endpoint for sncast compatibility."
  fi
  RPC_URL="$RPC_URL_NORMALIZED"
fi
SNCAST_TARGET_ARGS=(--network "$NET")
if [ -n "$RPC_URL" ]; then
  SNCAST_TARGET_ARGS=(--url "$RPC_URL")
fi

BACKEND_SIGNER="${BACKEND_SIGNER:-${OWNER_ADDRESS:-}}"
CAREL_TOKEN_ADDRESS="${CAREL_TOKEN_ADDRESS:-}"
AI_SIGNATURE_VERIFIER_ADDRESS="${AI_SIGNATURE_VERIFIER_ADDRESS:-}"
TARGET_RATE_LIMIT="${AI_EXECUTOR_TARGET_RATE_LIMIT:-${AI_EXECUTOR_RATE_LIMIT:-1000}}"
AI_EXECUTOR_LEVEL2_PRICE_WEI="${AI_EXECUTOR_LEVEL2_PRICE_WEI:-1000000000000000000}"
AI_EXECUTOR_LEVEL3_PRICE_WEI="${AI_EXECUTOR_LEVEL3_PRICE_WEI:-2000000000000000000}"
AI_EXECUTOR_FEE_ENABLED="${AI_EXECUTOR_FEE_ENABLED:-1}"
AI_EXECUTOR_SIGNATURE_VERIFICATION_ENABLED="${AI_EXECUTOR_SIGNATURE_VERIFICATION_ENABLED:-1}"
AI_EXECUTOR_MAX_PENDING_SCAN="${AI_EXECUTOR_MAX_PENDING_SCAN:-200}"
AI_EXECUTOR_MAX_ACTIONS_PER_USER="${AI_EXECUTOR_MAX_ACTIONS_PER_USER:-100}"
AI_EXECUTOR_MAX_BATCH_EXECUTE="${AI_EXECUTOR_MAX_BATCH_EXECUTE:-20}"

if is_placeholder_addr "$BACKEND_SIGNER"; then
  echo "Missing BACKEND_SIGNER (or OWNER_ADDRESS fallback) in $ENV_FILE" >&2
  exit 1
fi
if is_placeholder_addr "$CAREL_TOKEN_ADDRESS"; then
  echo "Missing CAREL_TOKEN_ADDRESS in $ENV_FILE" >&2
  exit 1
fi

echo "=== Redeploy AIExecutor ==="
echo "Network : $NET"
if [ -n "$RPC_URL" ]; then
  echo "RPC URL : custom (from env)"
fi
echo "Signer  : $BACKEND_SIGNER"
echo "CAREL   : $CAREL_TOKEN_ADDRESS"
echo "L2 fee  : $AI_EXECUTOR_LEVEL2_PRICE_WEI wei"
echo "L3 fee  : $AI_EXECUTOR_LEVEL3_PRICE_WEI wei"

declare_out=""
if ! declare_out=$(run_sncast sncast --wait --wait-timeout "$SNCAST_WAIT_TIMEOUT" --wait-retry-interval "$SNCAST_WAIT_RETRY_INTERVAL" declare "${SNCAST_TARGET_ARGS[@]}" --contract-name AIExecutor 2>&1); then
  if echo "$declare_out" | grep -qi "already declared"; then
    echo "$declare_out"
  else
    echo "$declare_out" >&2
    exit 1
  fi
else
  echo "$declare_out"
fi

deploy_out="$(run_sncast sncast --wait --wait-timeout "$SNCAST_WAIT_TIMEOUT" --wait-retry-interval "$SNCAST_WAIT_RETRY_INTERVAL" deploy "${SNCAST_TARGET_ARGS[@]}" --contract-name AIExecutor --constructor-calldata "$CAREL_TOKEN_ADDRESS" "$BACKEND_SIGNER")"
echo "$deploy_out"
AI_EXECUTOR_ADDRESS_NEW="$(echo "$deploy_out" | awk '/Contract Address/ {print $NF; exit}')"

if is_placeholder_addr "$AI_EXECUTOR_ADDRESS_NEW"; then
  echo "Failed to parse AI executor address from deploy output." >&2
  exit 1
fi

echo "New AI_EXECUTOR_ADDRESS: $AI_EXECUTOR_ADDRESS_NEW"
wait_for_contract_ready "$AI_EXECUTOR_ADDRESS_NEW" || true

# Set admin params on the new executor
echo "Setting executor rate limit to $TARGET_RATE_LIMIT ..."
run_sncast sncast --wait --wait-timeout "$SNCAST_WAIT_TIMEOUT" --wait-retry-interval "$SNCAST_WAIT_RETRY_INTERVAL" invoke "${SNCAST_TARGET_ARGS[@]}" --contract-address "$AI_EXECUTOR_ADDRESS_NEW" --function set_rate_limit --calldata "$TARGET_RATE_LIMIT" 0 >/dev/null

echo "Setting executor fee config (L2/L3) ..."
run_sncast sncast --wait --wait-timeout "$SNCAST_WAIT_TIMEOUT" --wait-retry-interval "$SNCAST_WAIT_RETRY_INTERVAL" invoke "${SNCAST_TARGET_ARGS[@]}" --contract-address "$AI_EXECUTOR_ADDRESS_NEW" --function set_fee_config --calldata "$AI_EXECUTOR_LEVEL2_PRICE_WEI" 0 "$AI_EXECUTOR_LEVEL3_PRICE_WEI" 0 "$AI_EXECUTOR_FEE_ENABLED" >/dev/null

echo "Setting executor max limits (pending/user/batch) ..."
run_sncast sncast --wait --wait-timeout "$SNCAST_WAIT_TIMEOUT" --wait-retry-interval "$SNCAST_WAIT_RETRY_INTERVAL" invoke "${SNCAST_TARGET_ARGS[@]}" --contract-address "$AI_EXECUTOR_ADDRESS_NEW" --function set_max_pending_scan --calldata "$AI_EXECUTOR_MAX_PENDING_SCAN" >/dev/null
run_sncast sncast --wait --wait-timeout "$SNCAST_WAIT_TIMEOUT" --wait-retry-interval "$SNCAST_WAIT_RETRY_INTERVAL" invoke "${SNCAST_TARGET_ARGS[@]}" --contract-address "$AI_EXECUTOR_ADDRESS_NEW" --function set_max_actions_per_user --calldata "$AI_EXECUTOR_MAX_ACTIONS_PER_USER" >/dev/null
run_sncast sncast --wait --wait-timeout "$SNCAST_WAIT_TIMEOUT" --wait-retry-interval "$SNCAST_WAIT_RETRY_INTERVAL" invoke "${SNCAST_TARGET_ARGS[@]}" --contract-address "$AI_EXECUTOR_ADDRESS_NEW" --function set_max_batch_execute --calldata "$AI_EXECUTOR_MAX_BATCH_EXECUTE" >/dev/null

if [ "$AI_EXECUTOR_SIGNATURE_VERIFICATION_ENABLED" = "1" ]; then
  if is_placeholder_addr "$AI_SIGNATURE_VERIFIER_ADDRESS"; then
    echo "AI_SIGNATURE_VERIFIER_ADDRESS is required when AI_EXECUTOR_SIGNATURE_VERIFICATION_ENABLED=1" >&2
    exit 1
  fi
  echo "Enabling signature verifier on new executor ..."
  run_sncast sncast --wait --wait-timeout "$SNCAST_WAIT_TIMEOUT" --wait-retry-interval "$SNCAST_WAIT_RETRY_INTERVAL" invoke "${SNCAST_TARGET_ARGS[@]}" --contract-address "$AI_EXECUTOR_ADDRESS_NEW" --function set_signature_verification --calldata "$AI_SIGNATURE_VERIFIER_ADDRESS" 1 >/dev/null
else
  echo "Disabling signature verifier on new executor ..."
  run_sncast sncast --wait --wait-timeout "$SNCAST_WAIT_TIMEOUT" --wait-retry-interval "$SNCAST_WAIT_RETRY_INTERVAL" invoke "${SNCAST_TARGET_ARGS[@]}" --contract-address "$AI_EXECUTOR_ADDRESS_NEW" --function set_signature_verification --calldata 0x0 0 >/dev/null
fi

echo "Granting CAREL burner role to new executor ..."
run_sncast sncast --wait --wait-timeout "$SNCAST_WAIT_TIMEOUT" --wait-retry-interval "$SNCAST_WAIT_RETRY_INTERVAL" invoke "${SNCAST_TARGET_ARGS[@]}" --contract-address "$CAREL_TOKEN_ADDRESS" --function set_burner --calldata "$AI_EXECUTOR_ADDRESS_NEW" >/dev/null

# Sync envs
update_env_file "$ENV_FILE" "AI_EXECUTOR_ADDRESS" "$AI_EXECUTOR_ADDRESS_NEW"
update_env_file "$REPO_ROOT/backend-rust/.env" "AI_EXECUTOR_ADDRESS" "$AI_EXECUTOR_ADDRESS_NEW"
update_env_file "$REPO_ROOT/frontend/.env" "NEXT_PUBLIC_STARKNET_AI_EXECUTOR_ADDRESS" "$AI_EXECUTOR_ADDRESS_NEW"
update_env_file "$REPO_ROOT/frontend/.env" "NEXT_PUBLIC_AI_EXECUTOR_ADDRESS" "$AI_EXECUTOR_ADDRESS_NEW"
update_env_file "$REPO_ROOT/frontend/.env.local" "NEXT_PUBLIC_STARKNET_AI_EXECUTOR_ADDRESS" "$AI_EXECUTOR_ADDRESS_NEW"
update_env_file "$REPO_ROOT/frontend/.env.local" "NEXT_PUBLIC_AI_EXECUTOR_ADDRESS" "$AI_EXECUTOR_ADDRESS_NEW"

echo
echo "=== Done ==="
echo "Updated:"
echo "- $ENV_FILE (AI_EXECUTOR_ADDRESS)"
echo "- $REPO_ROOT/backend-rust/.env (AI_EXECUTOR_ADDRESS)"
echo "- $REPO_ROOT/frontend/.env (NEXT_PUBLIC_STARKNET_AI_EXECUTOR_ADDRESS, NEXT_PUBLIC_AI_EXECUTOR_ADDRESS)"
if [ -f "$REPO_ROOT/frontend/.env.local" ]; then
  echo "- $REPO_ROOT/frontend/.env.local (NEXT_PUBLIC_STARKNET_AI_EXECUTOR_ADDRESS, NEXT_PUBLIC_AI_EXECUTOR_ADDRESS)"
fi
echo
echo "Restart services:"
echo "1) backend-rust"
echo "2) frontend"
