#!/usr/bin/env bash
set -euo pipefail

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required"
  exit 1
fi

BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"

# Auth (optional)
AUTH_TOKEN="${AUTH_TOKEN:-}"
AUTH_ADDR="${AUTH_ADDR:-0xabc123}"
AUTH_SIG="${AUTH_SIG:-0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}"
AUTH_MSG="${AUTH_MSG:-test}"
AUTH_CHAIN_ID="${AUTH_CHAIN_ID:-1}"

# Bridge quote
BRIDGE_FROM="${BRIDGE_FROM:-starknet}"
BRIDGE_TO="${BRIDGE_TO:-ethereum}"
BRIDGE_TOKEN="${BRIDGE_TOKEN:-USDC}"
BRIDGE_AMOUNT="${BRIDGE_AMOUNT:-10}"

# Limit order
ORDER_FROM="${ORDER_FROM:-USDC}"
ORDER_TO="${ORDER_TO:-CAREL}"
ORDER_AMOUNT="${ORDER_AMOUNT:-10}"
ORDER_PRICE="${ORDER_PRICE:-1}"
ORDER_EXPIRY="${ORDER_EXPIRY:-7d}"

# Stake
STAKE_POOL="${STAKE_POOL:-CAREL}"
STAKE_AMOUNT="${STAKE_AMOUNT:-100}"

print_section() {
  echo
  echo "== $1 =="
}

extract_token() {
  local resp="$1"
  local token=""

  if command -v jq >/dev/null 2>&1; then
    token="$(printf '%s' "$resp" | jq -r '.data.token // empty' || true)"
  fi

  if [ -z "$token" ] && command -v node >/dev/null 2>&1; then
    token="$(printf '%s' "$resp" | node -e 'const fs=require("fs");const input=fs.readFileSync(0,"utf8");try{const data=JSON.parse(input);process.stdout.write((data.data&&data.data.token)||"");}catch(e){process.stdout.write("");}' || true)"
  fi

  if [ -z "$token" ]; then
    token="$(printf '%s' "$resp" | sed -n 's/.*"token":"\\([^"]*\\)".*/\\1/p' || true)"
  fi

  printf '%s' "$token"
}

if [ -z "$AUTH_TOKEN" ]; then
  print_section "Auth Connect"
  AUTH_RESP="$(curl -sS -X POST "$BASE_URL/api/v1/auth/connect" \
    -H 'Content-Type: application/json' \
    -d "{\"address\":\"$AUTH_ADDR\",\"signature\":\"$AUTH_SIG\",\"message\":\"$AUTH_MSG\",\"chain_id\":$AUTH_CHAIN_ID}")"
  echo "$AUTH_RESP"
  AUTH_TOKEN="$(extract_token "$AUTH_RESP")"
fi

if [ -z "$AUTH_TOKEN" ]; then
  echo "Failed to get auth token. Set AUTH_TOKEN env or check /auth/connect response."
  exit 1
fi

print_section "Health"
curl -sS "$BASE_URL/health"
echo

print_section "Bridge Quote"
curl -sS -X POST "$BASE_URL/api/v1/bridge/quote" \
  -H 'Content-Type: application/json' \
  -d "{\"from_chain\":\"$BRIDGE_FROM\",\"to_chain\":\"$BRIDGE_TO\",\"token\":\"$BRIDGE_TOKEN\",\"amount\":\"$BRIDGE_AMOUNT\"}"
echo

print_section "Limit Order Create"
curl -sS -X POST "$BASE_URL/api/v1/limit-order/create" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"from_token\":\"$ORDER_FROM\",\"to_token\":\"$ORDER_TO\",\"amount\":\"$ORDER_AMOUNT\",\"price\":\"$ORDER_PRICE\",\"expiry\":\"$ORDER_EXPIRY\",\"recipient\":null}"
echo

print_section "Limit Order List"
curl -sS -X GET "$BASE_URL/api/v1/limit-order/list?page=1&limit=5" \
  -H "Authorization: Bearer $AUTH_TOKEN"
echo

print_section "Stake Pools"
curl -sS "$BASE_URL/api/v1/stake/pools"
echo

print_section "Stake Deposit"
curl -sS -X POST "$BASE_URL/api/v1/stake/deposit" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "{\"pool_id\":\"$STAKE_POOL\",\"amount\":\"$STAKE_AMOUNT\"}"
echo

print_section "Stake Positions"
curl -sS -X GET "$BASE_URL/api/v1/stake/positions" \
  -H "Authorization: Bearer $AUTH_TOKEN"
echo
