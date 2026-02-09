#!/bin/bash
set -euo pipefail

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ] || [ "${!name}" = "0x..." ]; then
    echo "Missing env: $name" >&2
    exit 1
  fi
}

require_env OWNER_ADDRESS
require_env PRAGMA_ORACLE_ADDRESS
require_env CHAINLINK_ORACLE_ADDRESS

TOKEN_CONFIGS=${TOKEN_CONFIGS:-""}

if [ -z "${PRICE_ORACLE_ADDRESS:-}" ] || [ "${PRICE_ORACLE_ADDRESS}" = "0x..." ]; then
  echo "Deploying PriceOracle..."
  PRICE_ORACLE_ADDRESS=$(starkli deploy target/dev/smartcontract_PriceOracle.contract_class.json \
    --constructor-calldata \
    $PRAGMA_ORACLE_ADDRESS \
    $CHAINLINK_ORACLE_ADDRESS \
    $OWNER_ADDRESS | tail -n 1)
  echo "PRICE_ORACLE_ADDRESS=$PRICE_ORACLE_ADDRESS"
fi

if [ -n "${SWAP_AGGREGATOR_ADDRESS:-}" ] && [ "${SWAP_AGGREGATOR_ADDRESS}" != "0x..." ]; then
  echo "Wiring PriceOracle to SwapAggregator..."
  starkli invoke $SWAP_AGGREGATOR_ADDRESS set_price_oracle $PRICE_ORACLE_ADDRESS
fi

if [ -n "${ROUTER_ADDRESS:-}" ] && [ "${ROUTER_ADDRESS}" != "0x..." ]; then
  echo "Wiring PriceOracle to Router..."
  starkli invoke $ROUTER_ADDRESS set_price_oracle $PRICE_ORACLE_ADDRESS
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
      starkli invoke $SWAP_AGGREGATOR_ADDRESS set_token_oracle_config $token_addr $asset_id $decimals
    fi

    if [ -n "${ROUTER_ADDRESS:-}" ] && [ "${ROUTER_ADDRESS}" != "0x..." ]; then
      starkli invoke $ROUTER_ADDRESS set_token_oracle_config $token_addr $asset_id $decimals
    fi
  done
fi

echo "Price oracle setup complete."
