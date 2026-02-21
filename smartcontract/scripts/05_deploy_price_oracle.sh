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

is_truthy() {
  case "${1,,}" in
    1|true|yes|y|on) return 0 ;;
    *) return 1 ;;
  esac
}

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

append_token_config() {
  local current="$1"
  local token_addr="$2"
  local asset_id="$3"
  local decimals="$4"
  if [ -z "${token_addr}" ] || [ "${token_addr}" = "0x..." ] || [ "${token_addr}" = "0x0" ] || [ "${token_addr}" = "0x00" ]; then
    echo "${current}"
    return
  fi
  if [ -z "${asset_id}" ] || [ "${asset_id}" = "0" ]; then
    echo "${current}"
    return
  fi
  local entry="${token_addr}:${asset_id}:${decimals}"
  if [ -n "${current}" ]; then
    case ",${current}," in
      *",${entry},"*) echo "${current}" ;;
      *) echo "${current},${entry}" ;;
    esac
  else
    echo "${entry}"
  fi
}

require_env OWNER_ADDRESS
require_env PRAGMA_ORACLE_ADDRESS
require_env CHAINLINK_ORACLE_ADDRESS

TOKEN_CONFIGS=${TOKEN_CONFIGS:-""}
TOKEN_STRK_ADDRESS=${TOKEN_STRK_ADDRESS:-0x04718f5a0Fc34cC1AF16A1cdee98fFB20C31f5cD61D6Ab07201858f4287c938D}
TOKEN_USDC_ADDRESS=${TOKEN_USDC_ADDRESS:-0x0179cc8cb5ea0b143e17d649e8ad60d80c45c8132c4cf162d57eaf8297f529d8}
TOKEN_USDT_ADDRESS=${TOKEN_USDT_ADDRESS:-0x030fcbfd1f83fb2d697ad8bdd52e1d55a700b876bed1f4507875539581ed53e5}
TOKEN_WBTC_ADDRESS=${TOKEN_WBTC_ADDRESS:-0x0496bef3ed20371382fbe0ca6a5a64252c5c848f9f1f0cccf8110fc4def912d5}
TOKEN_ETH_ADDRESS=${TOKEN_ETH_ADDRESS:-0x0000000000000000000000000000000000000003}
ORACLE_ASSET_ID_BTC=${ORACLE_ASSET_ID_BTC:-18669995996566340}
ORACLE_ASSET_ID_ETH=${ORACLE_ASSET_ID_ETH:-19514442401534788}
ORACLE_ASSET_ID_STRK=${ORACLE_ASSET_ID_STRK:-6004514686061859652}
ORACLE_ASSET_ID_USDT=${ORACLE_ASSET_ID_USDT:-6148333044652921668}
ORACLE_ASSET_ID_USDC=${ORACLE_ASSET_ID_USDC:-6148332971638477636}
ORACLE_ASSET_ID_CAREL=${ORACLE_ASSET_ID_CAREL:-0}
if [ -z "${ORACLE_ASSET_ID_CAREL}" ] || [ "${ORACLE_ASSET_ID_CAREL}" = "0" ]; then
  ORACLE_ASSET_ID_CAREL="${ORACLE_ASSET_ID_USDC}"
  echo "ORACLE_ASSET_ID_CAREL is unset/0. Reusing USDC oracle asset id (${ORACLE_ASSET_ID_USDC}) for CAREL."
fi

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

if [ -z "${TOKEN_CONFIGS}" ]; then
  build_default_token_configs() {
    local out=""
    out="$(append_token_config "${out}" "${TOKEN_STRK_ADDRESS:-}" "${ORACLE_ASSET_ID_STRK}" 18)"
    out="$(append_token_config "${out}" "${TOKEN_WBTC_ADDRESS:-}" "${ORACLE_ASSET_ID_BTC}" 8)"
    out="$(append_token_config "${out}" "${TOKEN_USDT_ADDRESS:-}" "${ORACLE_ASSET_ID_USDT}" 6)"
    out="$(append_token_config "${out}" "${TOKEN_USDC_ADDRESS:-}" "${ORACLE_ASSET_ID_USDC}" 6)"
    out="$(append_token_config "${out}" "${TOKEN_ETH_ADDRESS:-}" "${ORACLE_ASSET_ID_ETH}" 18)"
    out="$(append_token_config "${out}" "${CAREL_TOKEN_ADDRESS:-}" "${ORACLE_ASSET_ID_CAREL}" 18)"

    echo "${out}"
  }

  TOKEN_CONFIGS="$(build_default_token_configs)"
  export TOKEN_CONFIGS
  echo "TOKEN_CONFIGS is empty. Using default oracle token configs: ${TOKEN_CONFIGS}"
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
    echo "- token=${token_addr} asset_id=${asset_id} decimals=${decimals}"

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

# Optional: source fallback prices from CoinGecko before writing on-chain fallback values.
USE_COINGECKO_FALLBACK="${USE_COINGECKO_FALLBACK:-false}"
COINGECKO_API_BASE="${COINGECKO_API_BASE:-https://api.coingecko.com/api/v3}"
COINGECKO_STRK_ID="${COINGECKO_STRK_ID:-starknet}"
COINGECKO_WBTC_ID="${COINGECKO_WBTC_ID:-wrapped-bitcoin}"
COINGECKO_ETH_ID="${COINGECKO_ETH_ID:-ethereum}"
COINGECKO_USDC_ID="${COINGECKO_USDC_ID:-usd-coin}"
COINGECKO_USDT_ID="${COINGECKO_USDT_ID:-tether}"
COINGECKO_CAREL_ID="${COINGECKO_CAREL_ID:-}"

usd_price_to_1e18() {
  local usd="$1"
  if ! command -v bc >/dev/null 2>&1; then
    return 1
  fi
  echo "scale=0; (${usd} * 1000000000000000000) / 1" | bc
}

fetch_coingecko_usd() {
  local coin_id="$1"
  if [ -z "$coin_id" ]; then
    return 1
  fi
  local url="${COINGECKO_API_BASE%/}/simple/price?ids=${coin_id}&vs_currencies=usd"
  local body
  body="$(curl -fsSL --retry 3 --retry-delay 2 "$url" 2>/dev/null)" || return 1
  echo "$body" | jq -r --arg id "$coin_id" '.[$id].usd // empty'
}

apply_coingecko_fallback() {
  local label="$1"
  local coin_id="$2"
  local var_name="$3"
  local usd
  usd="$(fetch_coingecko_usd "$coin_id")" || {
    echo "[WARN] CoinGecko fetch failed for ${label} (${coin_id}), keeping existing ${var_name}=${!var_name:-0}."
    return
  }
  if [ -z "$usd" ] || [ "$usd" = "null" ]; then
    echo "[WARN] CoinGecko returned empty price for ${label} (${coin_id}), keeping existing ${var_name}=${!var_name:-0}."
    return
  fi
  local scaled
  scaled="$(usd_price_to_1e18 "$usd")" || {
    echo "[WARN] Failed to convert CoinGecko USD to 1e18 for ${label}, keeping existing ${var_name}=${!var_name:-0}."
    return
  }
  if [ -z "$scaled" ] || [ "$scaled" = "0" ]; then
    echo "[WARN] CoinGecko scaled price is zero for ${label}, keeping existing ${var_name}=${!var_name:-0}."
    return
  fi
  printf -v "$var_name" "%s" "$scaled"
  export "$var_name"
  echo "[OK] ${label} CoinGecko USD=${usd} => ${var_name}=${scaled}"
}

STRK_FALLBACK_PRICE="${STRK_FALLBACK_PRICE:-50000000000000000}" # $0.05 (18 decimals)
WBTC_FALLBACK_PRICE="${WBTC_FALLBACK_PRICE:-65000000000000000000000}" # $65,000
ETH_FALLBACK_PRICE="${ETH_FALLBACK_PRICE:-3000000000000000000000}" # $3,000
USDC_FALLBACK_PRICE="${USDC_FALLBACK_PRICE:-1000000000000000000}" # $1
USDT_FALLBACK_PRICE="${USDT_FALLBACK_PRICE:-1000000000000000000}" # $1
CAREL_FALLBACK_PRICE="${CAREL_FALLBACK_PRICE:-1000000000000000000}" # $1

if is_truthy "$USE_COINGECKO_FALLBACK"; then
  if ! command -v jq >/dev/null 2>&1; then
    echo "jq not found in PATH (required when USE_COINGECKO_FALLBACK=true)" >&2
    exit 1
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl not found in PATH (required when USE_COINGECKO_FALLBACK=true)" >&2
    exit 1
  fi
  if ! command -v bc >/dev/null 2>&1; then
    echo "bc not found in PATH (required when USE_COINGECKO_FALLBACK=true)" >&2
    exit 1
  fi
  echo "Resolving fallback prices from CoinGecko..."
  apply_coingecko_fallback "STRK" "$COINGECKO_STRK_ID" STRK_FALLBACK_PRICE
  apply_coingecko_fallback "WBTC" "$COINGECKO_WBTC_ID" WBTC_FALLBACK_PRICE
  apply_coingecko_fallback "ETH" "$COINGECKO_ETH_ID" ETH_FALLBACK_PRICE
  apply_coingecko_fallback "USDC" "$COINGECKO_USDC_ID" USDC_FALLBACK_PRICE
  apply_coingecko_fallback "USDT" "$COINGECKO_USDT_ID" USDT_FALLBACK_PRICE
  apply_coingecko_fallback "CAREL" "$COINGECKO_CAREL_ID" CAREL_FALLBACK_PRICE
fi

if [ -n "${CAREL_TOKEN_ADDRESS:-}" ] && [ "${CAREL_TOKEN_ADDRESS}" != "0x..." ] && [ "${CAREL_TOKEN_ADDRESS}" != "0x0" ] && [ -n "${CAREL_FALLBACK_PRICE}" ] && [ "${CAREL_FALLBACK_PRICE}" != "0" ]; then
  CAREL_FALLBACK_PRICE_LOW=${CAREL_FALLBACK_PRICE_LOW:-$CAREL_FALLBACK_PRICE}
  CAREL_FALLBACK_PRICE_HIGH=${CAREL_FALLBACK_PRICE_HIGH:-0}
  set_fallback_price "CAREL" "$CAREL_TOKEN_ADDRESS" "$CAREL_FALLBACK_PRICE_LOW" "$CAREL_FALLBACK_PRICE_HIGH"
fi

if [ -n "${TOKEN_STRK_ADDRESS:-}" ] && [ "${TOKEN_STRK_ADDRESS}" != "0x..." ] && [ "${TOKEN_STRK_ADDRESS}" != "0x0" ] && [ -n "${STRK_FALLBACK_PRICE}" ] && [ "${STRK_FALLBACK_PRICE}" != "0" ]; then
  STRK_FALLBACK_PRICE_LOW=${STRK_FALLBACK_PRICE_LOW:-$STRK_FALLBACK_PRICE}
  STRK_FALLBACK_PRICE_HIGH=${STRK_FALLBACK_PRICE_HIGH:-0}
  set_fallback_price "STRK" "$TOKEN_STRK_ADDRESS" "$STRK_FALLBACK_PRICE_LOW" "$STRK_FALLBACK_PRICE_HIGH"
fi

if [ -n "${TOKEN_WBTC_ADDRESS:-}" ] && [ "${TOKEN_WBTC_ADDRESS}" != "0x..." ] && [ "${TOKEN_WBTC_ADDRESS}" != "0x0" ] && [ -n "${WBTC_FALLBACK_PRICE}" ] && [ "${WBTC_FALLBACK_PRICE}" != "0" ]; then
  WBTC_FALLBACK_PRICE_LOW=${WBTC_FALLBACK_PRICE_LOW:-$WBTC_FALLBACK_PRICE}
  WBTC_FALLBACK_PRICE_HIGH=${WBTC_FALLBACK_PRICE_HIGH:-0}
  set_fallback_price "WBTC" "$TOKEN_WBTC_ADDRESS" "$WBTC_FALLBACK_PRICE_LOW" "$WBTC_FALLBACK_PRICE_HIGH"
fi

if [ -n "${TOKEN_ETH_ADDRESS:-}" ] && [ "${TOKEN_ETH_ADDRESS}" != "0x..." ] && [ "${TOKEN_ETH_ADDRESS}" != "0x0" ] && [ -n "${ETH_FALLBACK_PRICE}" ] && [ "${ETH_FALLBACK_PRICE}" != "0" ]; then
  ETH_FALLBACK_PRICE_LOW=${ETH_FALLBACK_PRICE_LOW:-$ETH_FALLBACK_PRICE}
  ETH_FALLBACK_PRICE_HIGH=${ETH_FALLBACK_PRICE_HIGH:-0}
  set_fallback_price "ETH" "$TOKEN_ETH_ADDRESS" "$ETH_FALLBACK_PRICE_LOW" "$ETH_FALLBACK_PRICE_HIGH"
fi

if [ -n "${TOKEN_USDC_ADDRESS:-}" ] && [ "${TOKEN_USDC_ADDRESS}" != "0x..." ] && [ "${TOKEN_USDC_ADDRESS}" != "0x0" ] && [ -n "${USDC_FALLBACK_PRICE}" ] && [ "${USDC_FALLBACK_PRICE}" != "0" ]; then
  USDC_FALLBACK_PRICE_LOW=${USDC_FALLBACK_PRICE_LOW:-$USDC_FALLBACK_PRICE}
  USDC_FALLBACK_PRICE_HIGH=${USDC_FALLBACK_PRICE_HIGH:-0}
  set_fallback_price "USDC" "$TOKEN_USDC_ADDRESS" "$USDC_FALLBACK_PRICE_LOW" "$USDC_FALLBACK_PRICE_HIGH"
fi

if [ -n "${TOKEN_USDT_ADDRESS:-}" ] && [ "${TOKEN_USDT_ADDRESS}" != "0x..." ] && [ "${TOKEN_USDT_ADDRESS}" != "0x0" ] && [ -n "${USDT_FALLBACK_PRICE}" ] && [ "${USDT_FALLBACK_PRICE}" != "0" ]; then
  USDT_FALLBACK_PRICE_LOW=${USDT_FALLBACK_PRICE_LOW:-$USDT_FALLBACK_PRICE}
  USDT_FALLBACK_PRICE_HIGH=${USDT_FALLBACK_PRICE_HIGH:-0}
  set_fallback_price "USDT" "$TOKEN_USDT_ADDRESS" "$USDT_FALLBACK_PRICE_LOW" "$USDT_FALLBACK_PRICE_HIGH"
fi

echo "Price oracle setup complete."
