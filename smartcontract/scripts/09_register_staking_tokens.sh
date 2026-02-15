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

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ] || [ "${!name}" = "0x..." ] || [ "${!name}" = "0x0" ]; then
    echo "Missing env: $name" >&2
    exit 1
  fi
}

sncast_invoke() {
  local contract_address="$1"
  local function_name="$2"
  local token_address="$3"
  echo "Invoke $function_name($token_address) on $contract_address"
  sncast -a "$SNCAST_ACCOUNT" -w invoke \
    --network "$NET" \
    --contract-address "$contract_address" \
    --function "$function_name" \
    --calldata "$token_address"
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

echo "Done. USDC/USDT/STRK/WBTC registered for staking."
