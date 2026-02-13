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

if ! command -v bc >/dev/null 2>&1; then
  echo "bc not found in PATH (required for big integer math)" >&2
  exit 1
fi

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

SNCAST_ACCOUNT="${SNCAST_ACCOUNT:-sepolia}"
ACTION_MODE="${ACTION_MODE:-full}" # full | rebalance | health
DRY_RUN="${DRY_RUN:-false}" # true/false
ALLOW_MINT="${ALLOW_MINT:-true}" # true/false
MINTABLE_SYMBOLS="${MINTABLE_SYMBOLS:-USDC,USDT,WBTC}"

SNCAST_MAX_RETRIES="${SNCAST_MAX_RETRIES:-8}"
SNCAST_BASE_SLEEP_SECS="${SNCAST_BASE_SLEEP_SECS:-6}"
SLEEP_BETWEEN_CALLS="${SLEEP_BETWEEN_CALLS:-1}"

TWO_POW_128="340282366920938463463374607431768211456"
ZERO_ADDRESS="0x0"

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ] || [ "${!name}" = "0x..." ] || [ "${!name}" = "0x0" ]; then
    echo "Missing env: $name" >&2
    exit 1
  fi
}

is_truthy() {
  case "${1,,}" in
    1|true|yes|y|on) return 0 ;;
    *) return 1 ;;
  esac
}

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

normalize_hex() {
  local v="${1,,}"
  if [[ "$v" != 0x* ]]; then
    echo "0x$v"
  else
    echo "$v"
  fi
}

trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf "%s" "$s"
}

hex_to_dec() {
  local hx
  hx="$(normalize_hex "$1")"
  hx="${hx#0x}"
  hx="${hx^^}"
  if [ -z "$hx" ]; then
    echo "0"
    return
  fi
  echo "ibase=16; $hx" | bc
}

dec_lt() {
  local a="$1"
  local b="$2"
  [ "$(echo "$a < $b" | bc)" -eq 1 ]
}

dec_lte() {
  local a="$1"
  local b="$2"
  [ "$(echo "$a <= $b" | bc)" -eq 1 ]
}

dec_gt() {
  local a="$1"
  local b="$2"
  [ "$(echo "$a > $b" | bc)" -eq 1 ]
}

dec_sub() {
  local a="$1"
  local b="$2"
  echo "$a - $b" | bc
}

dec_add() {
  local a="$1"
  local b="$2"
  echo "$a + $b" | bc
}

dec_to_u256_low() {
  local n="$1"
  echo "$n % $TWO_POW_128" | bc
}

dec_to_u256_high() {
  local n="$1"
  echo "$n / $TWO_POW_128" | bc
}

parse_response_raw_line() {
  local out="$1"
  echo "$out" | sed -n 's/^Response Raw:[[:space:]]*\[\(.*\)\][[:space:]]*$/\1/p' | head -n1
}

parse_u256_from_balance_call() {
  local out="$1"
  local raw
  raw="$(parse_response_raw_line "$out")"
  if [ -z "$raw" ]; then
    echo ""
    return 1
  fi

  IFS=',' read -r low_hex high_hex _ <<< "$raw"
  low_hex="$(trim "$low_hex")"
  high_hex="$(trim "$high_hex")"
  if [ -z "$low_hex" ] || [ -z "$high_hex" ]; then
    echo ""
    return 1
  fi
  local low_dec
  local high_dec
  low_dec="$(hex_to_dec "$low_hex")"
  high_dec="$(hex_to_dec "$high_hex")"
  echo "$high_dec * $TWO_POW_128 + $low_dec" | bc
}

parse_route_expected_from_call() {
  local out="$1"
  local raw
  raw="$(parse_response_raw_line "$out")"
  if [ -z "$raw" ]; then
    echo ""
    return 1
  fi

  IFS=',' read -r _dex exp_low_hex exp_high_hex _min_low_hex _min_high_hex _ <<< "$raw"
  exp_low_hex="$(trim "$exp_low_hex")"
  exp_high_hex="$(trim "$exp_high_hex")"
  if [ -z "$exp_low_hex" ] || [ -z "$exp_high_hex" ]; then
    echo ""
    return 1
  fi
  local exp_low
  local exp_high
  exp_low="$(hex_to_dec "$exp_low_hex")"
  exp_high="$(hex_to_dec "$exp_high_hex")"
  echo "$exp_high * $TWO_POW_128 + $exp_low" | bc
}

sncast_invoke() {
  local contract_address="$1"
  local function_name="$2"
  shift 2
  if is_truthy "$DRY_RUN"; then
    echo "[DRY_RUN] sncast -a $SNCAST_ACCOUNT -w invoke --network $NET --contract-address $contract_address --function $function_name --calldata $*"
    return 0
  fi
  run_sncast sncast -a "$SNCAST_ACCOUNT" -w invoke \
    --network "$NET" \
    --contract-address "$contract_address" \
    --function "$function_name" \
    --calldata "$@"
}

sncast_call_balance() {
  local token="$1"
  local account="$2"
  local out
  out="$(run_sncast sncast call --network "$NET" --contract-address "$token" --function balance_of --calldata "$account")"
  parse_u256_from_balance_call "$out"
}

token_address_of() {
  local symbol="$1"
  case "$symbol" in
    STRK) echo "${TOKEN_STRK_ADDRESS:-}" ;;
    CAREL) echo "${CAREL_TOKEN_ADDRESS:-}" ;;
    USDC) echo "${TOKEN_USDC_ADDRESS:-}" ;;
    USDT) echo "${TOKEN_USDT_ADDRESS:-}" ;;
    WBTC) echo "${TOKEN_WBTC_ADDRESS:-${TOKEN_BTC_ADDRESS:-}}" ;;
    *) echo "" ;;
  esac
}

default_min_for() {
  local symbol="$1"
  case "$symbol" in
    STRK) echo "50000000000000000000" ;;           # 50 STRK
    CAREL) echo "100000000000000000000" ;;         # 100 CAREL
    USDC) echo "200000000" ;;                       # 200 USDC
    USDT) echo "200000000" ;;                       # 200 USDT
    WBTC) echo "50000000" ;;                        # 0.5 WBTC
    *) echo "0" ;;
  esac
}

default_target_for() {
  local symbol="$1"
  case "$symbol" in
    STRK) echo "200000000000000000000" ;;          # 200 STRK
    CAREL) echo "500000000000000000000" ;;         # 500 CAREL
    USDC) echo "1000000000" ;;                      # 1000 USDC
    USDT) echo "1000000000" ;;                      # 1000 USDT
    WBTC) echo "200000000" ;;                       # 2 WBTC
    *) echo "0" ;;
  esac
}

default_probe_for() {
  local symbol="$1"
  case "$symbol" in
    STRK) echo "1000000000000000000" ;;            # 1 STRK
    CAREL) echo "1000000000000000000" ;;           # 1 CAREL
    USDC) echo "1000000" ;;                         # 1 USDC
    USDT) echo "1000000" ;;                         # 1 USDT
    WBTC) echo "10000000" ;;                        # 0.1 WBTC
    *) echo "0" ;;
  esac
}

token_min_for() {
  local symbol="$1"
  local var="LIQ_MIN_${symbol}"
  local def
  def="$(default_min_for "$symbol")"
  echo "${!var:-$def}"
}

token_target_for() {
  local symbol="$1"
  local var="LIQ_TARGET_${symbol}"
  local def
  def="$(default_target_for "$symbol")"
  echo "${!var:-$def}"
}

token_probe_for() {
  local symbol="$1"
  local var="HEALTH_PROBE_${symbol}"
  local def
  def="$(default_probe_for "$symbol")"
  echo "${!var:-$def}"
}

symbol_is_mintable() {
  local symbol="$1"
  IFS=',' read -r -a arr <<< "$MINTABLE_SYMBOLS"
  for s in "${arr[@]}"; do
    s="$(trim "$s")"
    if [ "$s" = "$symbol" ]; then
      return 0
    fi
  done
  return 1
}

valid_token_address() {
  local addr="${1:-}"
  if [ -z "$addr" ] || [ "$addr" = "0x..." ] || [ "$addr" = "$ZERO_ADDRESS" ]; then
    return 1
  fi
  return 0
}

require_env SWAP_AGGREGATOR_ADDRESS
require_env OWNER_ADDRESS

TOKENS=(STRK WBTC USDT USDC CAREL)

rebalance_total=0
rebalance_topped_up=0
rebalance_failed=0
health_routes_ok=0
health_routes_failed=0
liquidity_failed=0

echo "=== Liquidity Rebalance + Health Check ==="
echo "Network          : $NET"
echo "Sncast account   : $SNCAST_ACCOUNT"
echo "Action mode      : $ACTION_MODE"
echo "Dry run          : $DRY_RUN"
echo "Allow mint       : $ALLOW_MINT"
echo "Swap aggregator  : $SWAP_AGGREGATOR_ADDRESS"
echo "Owner address    : $OWNER_ADDRESS"
echo

rebalance_one_token() {
  local symbol="$1"
  local token_addr
  token_addr="$(token_address_of "$symbol")"
  if ! valid_token_address "$token_addr"; then
    echo "[SKIP] $symbol address is not configured"
    return 0
  fi

  local min_bal
  local target_bal
  min_bal="$(token_min_for "$symbol")"
  target_bal="$(token_target_for "$symbol")"

  if dec_lte "$min_bal" "0" || dec_lte "$target_bal" "0"; then
    echo "[SKIP] $symbol min/target <= 0"
    return 0
  fi

  if dec_lt "$target_bal" "$min_bal"; then
    echo "[FAIL] $symbol target < min (target=$target_bal, min=$min_bal)"
    rebalance_failed=$((rebalance_failed + 1))
    return 1
  fi

  local agg_bal
  local owner_bal
  agg_bal="$(sncast_call_balance "$token_addr" "$SWAP_AGGREGATOR_ADDRESS")"
  owner_bal="$(sncast_call_balance "$token_addr" "$OWNER_ADDRESS")"
  rebalance_total=$((rebalance_total + 1))

  echo "[INFO] $symbol agg=$agg_bal owner=$owner_bal min=$min_bal target=$target_bal"

  if dec_lt "$agg_bal" "$min_bal"; then
    local needed
    needed="$(dec_sub "$target_bal" "$agg_bal")"
    if dec_lte "$needed" "0"; then
      echo "[WARN] $symbol computed top-up <= 0, skip"
      return 0
    fi

    if dec_lt "$owner_bal" "$needed"; then
      local shortfall
      shortfall="$(dec_sub "$needed" "$owner_bal")"
      if is_truthy "$ALLOW_MINT" && symbol_is_mintable "$symbol"; then
        local mint_low
        local mint_high
        mint_low="$(dec_to_u256_low "$shortfall")"
        mint_high="$(dec_to_u256_high "$shortfall")"
        echo "[ACTION] Mint $symbol shortfall=$shortfall to owner"
        sncast_invoke "$token_addr" "mint" "$OWNER_ADDRESS" "$mint_low" "$mint_high" >/dev/null
        owner_bal="$(sncast_call_balance "$token_addr" "$OWNER_ADDRESS")"
      fi
    fi

    if dec_lt "$owner_bal" "$needed"; then
      echo "[FAIL] $symbol owner balance insufficient after mint/refresh (owner=$owner_bal, need=$needed)"
      rebalance_failed=$((rebalance_failed + 1))
      return 1
    fi

    local need_low
    local need_high
    need_low="$(dec_to_u256_low "$needed")"
    need_high="$(dec_to_u256_high "$needed")"
    echo "[ACTION] Transfer $symbol amount=$needed to swap aggregator"
    sncast_invoke "$token_addr" "transfer" "$SWAP_AGGREGATOR_ADDRESS" "$need_low" "$need_high" >/dev/null

    local agg_after
    agg_after="$(sncast_call_balance "$token_addr" "$SWAP_AGGREGATOR_ADDRESS")"
    if dec_lt "$agg_after" "$min_bal"; then
      echo "[FAIL] $symbol top-up executed but agg balance still below min (agg_after=$agg_after)"
      rebalance_failed=$((rebalance_failed + 1))
      return 1
    fi
    rebalance_topped_up=$((rebalance_topped_up + 1))
    echo "[OK] $symbol rebalanced agg_after=$agg_after"
  else
    echo "[OK] $symbol liquidity already healthy"
  fi
}

health_liquidity_one_token() {
  local symbol="$1"
  local token_addr
  token_addr="$(token_address_of "$symbol")"
  if ! valid_token_address "$token_addr"; then
    echo "[SKIP] Liquidity health $symbol (address missing)"
    return 0
  fi

  local min_bal
  min_bal="$(token_min_for "$symbol")"
  if dec_lte "$min_bal" "0"; then
    echo "[SKIP] Liquidity health $symbol (min<=0)"
    return 0
  fi

  local agg_bal
  agg_bal="$(sncast_call_balance "$token_addr" "$SWAP_AGGREGATOR_ADDRESS")"
  if dec_lt "$agg_bal" "$min_bal"; then
    echo "[FAIL] Liquidity low $symbol agg=$agg_bal min=$min_bal"
    liquidity_failed=$((liquidity_failed + 1))
    return 1
  fi
  echo "[OK] Liquidity $symbol agg=$agg_bal min=$min_bal"
}

health_route_pair() {
  local from_symbol="$1"
  local to_symbol="$2"
  local from_addr
  local to_addr
  from_addr="$(token_address_of "$from_symbol")"
  to_addr="$(token_address_of "$to_symbol")"

  if ! valid_token_address "$from_addr" || ! valid_token_address "$to_addr"; then
    echo "[SKIP] Route $from_symbol->$to_symbol (token address missing)"
    return 0
  fi

  local probe_amount
  probe_amount="$(token_probe_for "$from_symbol")"
  if dec_lte "$probe_amount" "0"; then
    echo "[SKIP] Route $from_symbol->$to_symbol (probe amount <=0)"
    return 0
  fi

  local out
  if ! out="$(run_sncast sncast call --network "$NET" --contract-address "$SWAP_AGGREGATOR_ADDRESS" --function get_best_swap_route --calldata "$from_addr" "$to_addr" "$probe_amount" 0)"; then
    echo "[FAIL] Route call failed $from_symbol->$to_symbol"
    health_routes_failed=$((health_routes_failed + 1))
    return 1
  fi

  local expected
  if ! expected="$(parse_route_expected_from_call "$out")"; then
    echo "[FAIL] Route parse failed $from_symbol->$to_symbol"
    health_routes_failed=$((health_routes_failed + 1))
    return 1
  fi

  if dec_lte "$expected" "0"; then
    echo "[FAIL] Route zero output $from_symbol->$to_symbol"
    health_routes_failed=$((health_routes_failed + 1))
    return 1
  fi

  health_routes_ok=$((health_routes_ok + 1))
  echo "[OK] Route $from_symbol->$to_symbol expected_out=$expected"
}

if [ "$ACTION_MODE" = "full" ] || [ "$ACTION_MODE" = "rebalance" ]; then
  echo "=== Rebalance Step ==="
  for symbol in "${TOKENS[@]}"; do
    rebalance_one_token "$symbol" || true
    if [ "$SLEEP_BETWEEN_CALLS" != "0" ]; then
      sleep "$SLEEP_BETWEEN_CALLS"
    fi
  done
  echo
fi

if [ "$ACTION_MODE" = "full" ] || [ "$ACTION_MODE" = "health" ]; then
  echo "=== Liquidity Health Step ==="
  for symbol in "${TOKENS[@]}"; do
    health_liquidity_one_token "$symbol" || true
    if [ "$SLEEP_BETWEEN_CALLS" != "0" ]; then
      sleep "$SLEEP_BETWEEN_CALLS"
    fi
  done
  echo

  echo "=== Route Health Step ==="
  for from_symbol in "${TOKENS[@]}"; do
    for to_symbol in "${TOKENS[@]}"; do
      if [ "$from_symbol" = "$to_symbol" ]; then
        continue
      fi
      health_route_pair "$from_symbol" "$to_symbol" || true
      if [ "$SLEEP_BETWEEN_CALLS" != "0" ]; then
        sleep "$SLEEP_BETWEEN_CALLS"
      fi
    done
  done
  echo
fi

echo "=== Summary ==="
echo "Rebalance checked  : $rebalance_total token(s)"
echo "Rebalance top-ups  : $rebalance_topped_up"
echo "Rebalance failures : $rebalance_failed"
echo "Liquidity failures : $liquidity_failed"
echo "Route ok           : $health_routes_ok"
echo "Route failed       : $health_routes_failed"

if [ "$rebalance_failed" -gt 0 ] || [ "$liquidity_failed" -gt 0 ] || [ "$health_routes_failed" -gt 0 ]; then
  echo "Result: FAILED" >&2
  exit 1
fi

echo "Result: OK"
