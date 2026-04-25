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
  shift 2
  echo "Invoke $function_name on $contract_address"
  run_sncast sncast -a "$SNCAST_ACCOUNT" -w invoke \
    --network "$NET" \
    --contract-address "$contract_address" \
    --function "$function_name" \
    --calldata "$@"
}

require_env LIMIT_ORDER_BOOK_ADDRESS
require_env STAKING_CAREL_ADDRESS
require_env STAKING_LP_ADDRESS
require_env STAKING_STABLECOIN_ADDRESS
require_env STAKING_WBTC_ADDRESS

LIMIT_ORDER_PROTOCOL_FEE_BPS="${LIMIT_ORDER_PROTOCOL_FEE_BPS:-20}"
LIMIT_ORDER_EXECUTOR_FEE_BPS="${LIMIT_ORDER_EXECUTOR_FEE_BPS:-0}"
LIMIT_ORDER_FEE_RECIPIENT="${LIMIT_ORDER_FEE_RECIPIENT:-${FEE_COLLECTOR_ADDRESS:-${TREASURY_CONTRACT_ADDRESS:-}}}"

STAKING_REWARD_FEE_BPS="${STAKING_REWARD_FEE_BPS:-200}"
STAKING_REWARD_FEE_RECIPIENT="${STAKING_REWARD_FEE_RECIPIENT:-${TREASURY_CONTRACT_ADDRESS:-${DEV_WALLET:-}}}"

if [ -z "$LIMIT_ORDER_FEE_RECIPIENT" ] || [ "$LIMIT_ORDER_FEE_RECIPIENT" = "0x..." ] || [ "$LIMIT_ORDER_FEE_RECIPIENT" = "0x0" ]; then
  echo "Missing env: LIMIT_ORDER_FEE_RECIPIENT (or FEE_COLLECTOR_ADDRESS/TREASURY_CONTRACT_ADDRESS)" >&2
  exit 1
fi

if [ -z "$STAKING_REWARD_FEE_RECIPIENT" ] || [ "$STAKING_REWARD_FEE_RECIPIENT" = "0x..." ] || [ "$STAKING_REWARD_FEE_RECIPIENT" = "0x0" ]; then
  echo "Missing env: STAKING_REWARD_FEE_RECIPIENT (or TREASURY_CONTRACT_ADDRESS/DEV_WALLET)" >&2
  exit 1
fi

echo "Setting limit order fee config..."
sncast_invoke "$LIMIT_ORDER_BOOK_ADDRESS" "set_fee_config" \
  "$LIMIT_ORDER_PROTOCOL_FEE_BPS" \
  "$LIMIT_ORDER_EXECUTOR_FEE_BPS" \
  "$LIMIT_ORDER_FEE_RECIPIENT"

echo "Setting staking reward fee config..."
sncast_invoke "$STAKING_CAREL_ADDRESS" "set_reward_fee" \
  "$STAKING_REWARD_FEE_BPS" \
  "$STAKING_REWARD_FEE_RECIPIENT"

sncast_invoke "$STAKING_LP_ADDRESS" "set_reward_fee" \
  "$STAKING_REWARD_FEE_BPS" \
  "$STAKING_REWARD_FEE_RECIPIENT"

sncast_invoke "$STAKING_STABLECOIN_ADDRESS" "set_reward_fee" \
  "$STAKING_REWARD_FEE_BPS" \
  "$STAKING_REWARD_FEE_RECIPIENT"

sncast_invoke "$STAKING_WBTC_ADDRESS" "set_reward_fee" \
  "$STAKING_REWARD_FEE_BPS" \
  "$STAKING_REWARD_FEE_RECIPIENT"

echo "Done. Limit order + staking reward fees configured."
