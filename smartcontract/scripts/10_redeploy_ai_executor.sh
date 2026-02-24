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

SNCAST_MAX_RETRIES="${SNCAST_MAX_RETRIES:-8}"
SNCAST_BASE_SLEEP_SECS="${SNCAST_BASE_SLEEP_SECS:-6}"

run_sncast() {
  local attempt=1
  local out=""
  local status=0
  while [ "$attempt" -le "$SNCAST_MAX_RETRIES" ]; do
    out="$("$@" 2>&1)" && {
      echo "$out"
      return 0
    }
    status=$?
    echo "$out" >&2
    if echo "$out" | grep -Eqi "cu limit exceeded|request too fast|too many requests|429|invalid transaction nonce|nonce is invalid|actual nonce"; then
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

BACKEND_SIGNER="${BACKEND_SIGNER:-${OWNER_ADDRESS:-}}"
CAREL_TOKEN_ADDRESS="${CAREL_TOKEN_ADDRESS:-}"
AI_SIGNATURE_VERIFIER_ADDRESS="${AI_SIGNATURE_VERIFIER_ADDRESS:-}"
TARGET_RATE_LIMIT="${AI_EXECUTOR_TARGET_RATE_LIMIT:-${AI_EXECUTOR_RATE_LIMIT:-1000}}"

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
echo "Signer  : $BACKEND_SIGNER"
echo "CAREL   : $CAREL_TOKEN_ADDRESS"

declare_out=""
if ! declare_out=$(run_sncast sncast declare --network "$NET" --contract-name AIExecutor 2>&1); then
  if echo "$declare_out" | grep -qi "already declared"; then
    echo "$declare_out"
  else
    echo "$declare_out" >&2
    exit 1
  fi
else
  echo "$declare_out"
fi

deploy_out="$(run_sncast sncast deploy --network "$NET" --contract-name AIExecutor --constructor-calldata "$CAREL_TOKEN_ADDRESS" "$BACKEND_SIGNER")"
echo "$deploy_out"
AI_EXECUTOR_ADDRESS_NEW="$(echo "$deploy_out" | awk '/Contract Address/ {print $NF; exit}')"

if is_placeholder_addr "$AI_EXECUTOR_ADDRESS_NEW"; then
  echo "Failed to parse AI executor address from deploy output." >&2
  exit 1
fi

echo "New AI_EXECUTOR_ADDRESS: $AI_EXECUTOR_ADDRESS_NEW"

# Set admin params on the new executor
echo "Setting executor rate limit to $TARGET_RATE_LIMIT ..."
run_sncast sncast invoke --network "$NET" --contract-address "$AI_EXECUTOR_ADDRESS_NEW" --function set_rate_limit --calldata "$TARGET_RATE_LIMIT" 0 >/dev/null

if ! is_placeholder_addr "$AI_SIGNATURE_VERIFIER_ADDRESS"; then
  echo "Setting signature verifier on new executor ..."
  run_sncast sncast invoke --network "$NET" --contract-address "$AI_EXECUTOR_ADDRESS_NEW" --function set_signature_verification --calldata "$AI_SIGNATURE_VERIFIER_ADDRESS" 1 >/dev/null
fi

echo "Granting CAREL burner role to new executor ..."
run_sncast sncast invoke --network "$NET" --contract-address "$CAREL_TOKEN_ADDRESS" --function set_burner --calldata "$AI_EXECUTOR_ADDRESS_NEW" >/dev/null

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
