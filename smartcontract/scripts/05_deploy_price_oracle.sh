#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"
cd "$ROOT"

if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

NET=${NET:-}
if [ -z "$NET" ]; then
  if [ "${NETWORK:-}" = "starknet-sepolia" ]; then
    NET=sepolia
  else
    NET=${NETWORK:-sepolia}
  fi
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
    if echo "$out" | grep -Eqi "cu limit exceeded|request too fast|too many requests|429"; then
      local sleep_secs=$((SNCAST_BASE_SLEEP_SECS * attempt))
      echo "Rate-limited RPC. Retry $attempt/$SNCAST_MAX_RETRIES in ${sleep_secs}s..." >&2
      sleep "$sleep_secs"
      attempt=$((attempt + 1))
      continue
    fi
    return "$status"
  done
  return "$status"
}

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ] || [ "${!name}" = "0x..." ]; then
    echo "Missing env: $name" >&2
    exit 1
  fi
}

update_env() {
  local key="$1"
  local val="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    perl -0pi -e "s|^${key}=.*$|${key}=${val}|mg" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

require_env OWNER_ADDRESS
require_env PRAGMA_ORACLE_ADDRESS
require_env CHAINLINK_ORACLE_ADDRESS

TOKEN_CONFIGS=${TOKEN_CONFIGS:-""}
TOKEN_STRK_ADDRESS=${TOKEN_STRK_ADDRESS:-0x0000000000000000000000000000000000000004}
TOKEN_USDC_ADDRESS=${TOKEN_USDC_ADDRESS:-0x0000000000000000000000000000000000000006}

if [ -z "${PRICE_ORACLE_ADDRESS:-}" ] || [ "${PRICE_ORACLE_ADDRESS}" = "0x..." ]; then
  echo "Declaring PriceOracle..."
  declare_out=$(run_sncast sncast declare --network "$NET" --contract-name PriceOracle 2>&1) || {
    if echo "$declare_out" | grep -qi "already declared"; then
      echo "$declare_out"
    else
      echo "$declare_out" >&2
      exit 1
    fi
  }
  echo "$declare_out"
  echo "Deploying PriceOracle..."
  out=$(run_sncast sncast deploy --network "$NET" --contract-name PriceOracle --constructor-calldata \
    "$PRAGMA_ORACLE_ADDRESS" \
    "$CHAINLINK_ORACLE_ADDRESS" \
    "$OWNER_ADDRESS")
  echo "$out"
  PRICE_ORACLE_ADDRESS=$(echo "$out" | awk '/Contract Address/ {print $NF; exit}')
  if [ -z "$PRICE_ORACLE_ADDRESS" ]; then
    echo "Failed to parse PRICE_ORACLE_ADDRESS" >&2
    exit 1
  fi
  update_env PRICE_ORACLE_ADDRESS "$PRICE_ORACLE_ADDRESS"
  echo "PRICE_ORACLE_ADDRESS=$PRICE_ORACLE_ADDRESS"
fi

if [ -n "${SWAP_AGGREGATOR_ADDRESS:-}" ] && [ "${SWAP_AGGREGATOR_ADDRESS}" != "0x..." ]; then
  echo "Wiring PriceOracle to SwapAggregator..."
  run_sncast sncast invoke --network "$NET" --contract-address "$SWAP_AGGREGATOR_ADDRESS" --function set_price_oracle --calldata "$PRICE_ORACLE_ADDRESS" >/dev/null
fi

if [ -n "${ROUTER_ADDRESS:-}" ] && [ "${ROUTER_ADDRESS}" != "0x..." ]; then
  echo "Wiring PriceOracle to Router..."
  run_sncast sncast invoke --network "$NET" --contract-address "$ROUTER_ADDRESS" --function set_price_oracle --calldata "$PRICE_ORACLE_ADDRESS" >/dev/null
fi

if [ -n "${TOKEN_CONFIGS}" ]; then
  echo "Setting token configs..."
  IFS=',' read -ra TOKENS <<< "$TOKEN_CONFIGS"
  for entry in "${TOKENS[@]}"; do
    [ -z "$entry" ] && continue
    IFS=':' read -ra PARTS <<< "$entry"
    if [ ${#PARTS[@]} -ne 3 ]; then
      echo "Invalid TOKEN_CONFIGS entry: $entry" >&2
      exit 1
    fi
    token_addr="${PARTS[0]}"
    asset_id="${PARTS[1]}"
    decimals="${PARTS[2]}"

    if [ -n "${SWAP_AGGREGATOR_ADDRESS:-}" ] && [ "${SWAP_AGGREGATOR_ADDRESS}" != "0x..." ]; then
      run_sncast sncast invoke --network "$NET" --contract-address "$SWAP_AGGREGATOR_ADDRESS" --function set_token_oracle_config --calldata "$token_addr" "$asset_id" "$decimals" >/dev/null
    fi

    if [ -n "${ROUTER_ADDRESS:-}" ] && [ "${ROUTER_ADDRESS}" != "0x..." ]; then
      run_sncast sncast invoke --network "$NET" --contract-address "$ROUTER_ADDRESS" --function set_token_oracle_config --calldata "$token_addr" "$asset_id" "$decimals" >/dev/null
    fi
  done
fi

set_fallback_price() {
  local label="$1"
  local token_addr="$2"
  local price_low="$3"
  local price_high="${4:-0}"
  if [ -z "$price_low" ] || [ "$price_low" = "0" ]; then
    return
  fi
  echo "Setting ${label} fallback price..."
  run_sncast sncast invoke --network "$NET" --contract-address "$PRICE_ORACLE_ADDRESS" \
    --function set_fallback_price --calldata "$token_addr" "$price_low" "$price_high" >/dev/null
  if [ -n "${SLEEP_SECS:-}" ] && [ "${SLEEP_SECS}" != "0" ]; then
    sleep "$SLEEP_SECS"
  fi
}

if [ -n "${CAREL_FALLBACK_PRICE:-}" ] && [ "${CAREL_FALLBACK_PRICE}" != "0" ]; then
  if [ -z "${CAREL_TOKEN_ADDRESS:-}" ] || [ "${CAREL_TOKEN_ADDRESS}" = "0x..." ]; then
    echo "Missing env: CAREL_TOKEN_ADDRESS (required for CAREL_FALLBACK_PRICE)" >&2
    exit 1
  fi
  CAREL_FALLBACK_PRICE_LOW=${CAREL_FALLBACK_PRICE_LOW:-$CAREL_FALLBACK_PRICE}
  CAREL_FALLBACK_PRICE_HIGH=${CAREL_FALLBACK_PRICE_HIGH:-0}
  set_fallback_price "CAREL" "$CAREL_TOKEN_ADDRESS" "$CAREL_FALLBACK_PRICE_LOW" "$CAREL_FALLBACK_PRICE_HIGH"
fi

if [ -n "${STRK_FALLBACK_PRICE:-}" ] && [ "${STRK_FALLBACK_PRICE}" != "0" ]; then
  STRK_FALLBACK_PRICE_LOW=${STRK_FALLBACK_PRICE_LOW:-$STRK_FALLBACK_PRICE}
  STRK_FALLBACK_PRICE_HIGH=${STRK_FALLBACK_PRICE_HIGH:-0}
  set_fallback_price "STRK" "$TOKEN_STRK_ADDRESS" "$STRK_FALLBACK_PRICE_LOW" "$STRK_FALLBACK_PRICE_HIGH"
fi

if [ -n "${USDC_FALLBACK_PRICE:-}" ] && [ "${USDC_FALLBACK_PRICE}" != "0" ]; then
  USDC_FALLBACK_PRICE_LOW=${USDC_FALLBACK_PRICE_LOW:-$USDC_FALLBACK_PRICE}
  USDC_FALLBACK_PRICE_HIGH=${USDC_FALLBACK_PRICE_HIGH:-0}
  set_fallback_price "USDC" "$TOKEN_USDC_ADDRESS" "$USDC_FALLBACK_PRICE_LOW" "$USDC_FALLBACK_PRICE_HIGH"
fi

echo "Price oracle setup complete."
