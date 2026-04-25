#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"
CAIRO_DIR="$ROOT/cairo"
LOG_DIR="${DEPLOY_LOG_DIR:-$ROOT/.deploy-logs}"
cd "$ROOT"
mkdir -p "$LOG_DIR"

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

RPC_URL=${RPC_URL:-}
SNCAST_NET_ARGS=(--network "$NET")
if [ -n "$RPC_URL" ] && [ "$RPC_URL" != "0x..." ]; then
  SNCAST_NET_ARGS=(--url "$RPC_URL")
fi

if ! command -v sncast >/dev/null 2>&1; then
  echo "sncast not found in PATH" >&2
  exit 1
fi

if [ ! -f "$CAIRO_DIR/Scarb.toml" ]; then
  echo "Missing $CAIRO_DIR/Scarb.toml (ShieldedPool v4 package)." >&2
  exit 1
fi

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ] || [ "${!name}" = "0x..." ]; then
    echo "Missing env: $name" >&2
    exit 1
  fi
}

needs_deploy() {
  local val="${1:-}"
  if [ -z "$val" ]; then
    return 0
  fi
  if [ "$val" = "0x..." ] || [ "$val" = "0x0" ] || [ "$val" = "0x00" ]; then
    return 0
  fi
  return 1
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

ADMIN=${ADMIN:-${OWNER_ADDRESS:-}}
require_env ADMIN

CONTRACT_NAME=${SHIELDED_POOL_V4_CONTRACT_NAME:-shielded_pool_v4}
INITIAL_ROOT=${SHIELDED_POOL_V4_INITIAL_ROOT:-0}

if ! needs_deploy "${SHIELDED_POOL_V4_ADDRESS:-}"; then
  echo "Skip ShieldedPool v4 (SHIELDED_POOL_V4_ADDRESS already set)"
  exit 0
fi

cd "$CAIRO_DIR"

echo "Declaring $CONTRACT_NAME from $CAIRO_DIR..."
DECLARE_LOG="$LOG_DIR/shielded_pool_v4_declare.log"
if ! sncast declare "${SNCAST_NET_ARGS[@]}" --contract-name "$CONTRACT_NAME" >"$DECLARE_LOG" 2>&1; then
  if ! grep -qi "already declared" "$DECLARE_LOG"; then
    cat "$DECLARE_LOG" >&2
    exit 1
  fi
else
  cat "$DECLARE_LOG"
fi

echo "Deploying $CONTRACT_NAME..."
DEPLOY_OUT=$(sncast deploy "${SNCAST_NET_ARGS[@]}" --contract-name "$CONTRACT_NAME" --constructor-calldata "$ADMIN" "$INITIAL_ROOT")

echo "$DEPLOY_OUT"
ADDR=$(echo "$DEPLOY_OUT" | awk '/Contract Address/ {print $NF; exit}')
if [ -z "$ADDR" ]; then
  echo "Failed to parse ShieldedPool v4 contract address" >&2
  exit 1
fi

cd "$ROOT"
update_env SHIELDED_POOL_V4_ADDRESS "$ADDR"
export SHIELDED_POOL_V4_ADDRESS="$ADDR"

echo "-> SHIELDED_POOL_V4_ADDRESS=$ADDR"
