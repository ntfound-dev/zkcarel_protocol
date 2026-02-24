#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

NET="${NET:-${NETWORK:-sepolia}}"
if [ "$NET" = "starknet-sepolia" ]; then
  NET="sepolia"
fi

SNCAST_ACCOUNT="${SNCAST_ACCOUNT:-sepolia}"
WBTC_TOKEN="${TOKEN_WBTC_ADDRESS:-${TOKEN_BTC_ADDRESS:-}}"
SNCAST_MAX_RETRIES="${SNCAST_MAX_RETRIES:-8}"
SNCAST_BASE_SLEEP_SECS="${SNCAST_BASE_SLEEP_SECS:-6}"

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ] || [ "${!name}" = "0x..." ] || [ "${!name}" = "0x0" ]; then
    echo "Missing env: $name" >&2
    exit 1
  fi
}

run_sncast() {
  local attempt=1
  local out=""
  local status=0
  while [ "$attempt" -le "$SNCAST_MAX_RETRIES" ]; do
    out="$("$@" 2>&1)"
    status=$?
    if [ "$status" -eq 0 ] && echo "$out" | grep -Eqi "^Error:|Unknown RPC error|JSON-RPC error"; then
      status=1
    fi
    if [ "$status" -eq 0 ]; then
      echo "$out"
      return 0
    fi
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

sncast_invoke() {
  local contract_address="$1"
  local function_name="$2"
  local token_address="$3"
  echo "Invoke $function_name($token_address) on $contract_address"
  run_sncast sncast -a "$SNCAST_ACCOUNT" -w invoke \
    --network "$NET" \
    --contract-address "$contract_address" \
    --function "$function_name" \
    --calldata "$token_address"
}

sncast_call_bool() {
  local contract_address="$1"
  local function_name="$2"
  local token_address="$3"
  run_sncast sncast -a "$SNCAST_ACCOUNT" call \
    --network "$NET" \
    --contract-address "$contract_address" \
    --function "$function_name" \
    --calldata "$token_address"
}

verify_token_supported() {
  local contract_address="$1"
  local checker_fn="$2"
  local token_address="$3"
  local label="$4"
  local call_out
  call_out="$(sncast_call_bool "$contract_address" "$checker_fn" "$token_address")"
  echo "$call_out"
  if ! echo "$call_out" | grep -Eqi "Response:\s+true|Response Raw:\s+\[0x1\]"; then
    echo "Verification failed: ${label} is still not allowlisted on contract ${contract_address}." >&2
    exit 1
  fi
  echo "Verified: ${label} is allowlisted."
}

require_env STAKING_STABLECOIN_ADDRESS
require_env STAKING_BTC_ADDRESS
require_env TOKEN_USDC_ADDRESS
require_env TOKEN_USDT_ADDRESS
require_env TOKEN_STRK_ADDRESS

if [ -z "$WBTC_TOKEN" ] || [ "$WBTC_TOKEN" = "0x..." ] || [ "$WBTC_TOKEN" = "0x0" ]; then
  echo "Missing env: TOKEN_WBTC_ADDRESS (or TOKEN_BTC_ADDRESS)" >&2
  exit 1
fi

echo "Register accepted tokens for staking contracts..."
sncast_invoke "$STAKING_STABLECOIN_ADDRESS" "add_stablecoin" "$TOKEN_USDC_ADDRESS"
sncast_invoke "$STAKING_STABLECOIN_ADDRESS" "add_stablecoin" "$TOKEN_USDT_ADDRESS"
sncast_invoke "$STAKING_STABLECOIN_ADDRESS" "add_stablecoin" "$TOKEN_STRK_ADDRESS"
sncast_invoke "$STAKING_BTC_ADDRESS" "add_btc_token" "$WBTC_TOKEN"

echo "Verifying allowlists..."
verify_token_supported "$STAKING_STABLECOIN_ADDRESS" "is_accepted_token" "$TOKEN_USDC_ADDRESS" "USDC"
verify_token_supported "$STAKING_STABLECOIN_ADDRESS" "is_accepted_token" "$TOKEN_USDT_ADDRESS" "USDT"
verify_token_supported "$STAKING_STABLECOIN_ADDRESS" "is_accepted_token" "$TOKEN_STRK_ADDRESS" "STRK"
verify_token_supported "$STAKING_BTC_ADDRESS" "is_token_accepted" "$WBTC_TOKEN" "WBTC"

echo "Done. USDC/USDT/STRK/WBTC registered for staking."
