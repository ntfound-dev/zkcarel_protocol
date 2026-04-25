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

RPC_URL=${RPC_URL:-}
SNCAST_NET_ARGS=(--network "$NET")
if [ -n "$RPC_URL" ] && [ "$RPC_URL" != "0x..." ]; then
  SNCAST_NET_ARGS=(--url "$RPC_URL")
fi

if ! command -v sncast >/dev/null 2>&1; then
  echo "sncast not found in PATH" >&2
  exit 1
fi

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ] || [ "${!name}" = "0x..." ]; then
    echo "Missing env: $name" >&2
    exit 1
  fi
}

require_env SHIELDED_POOL_V4_ADDRESS

SWAP_VERIFIER=${SHIELDED_POOL_V4_SWAP_VERIFIER:-${GARAGA_ADAPTER_ADDRESS:-}}
LIMIT_VERIFIER=${SHIELDED_POOL_V4_LIMIT_VERIFIER:-${GARAGA_ADAPTER_ADDRESS:-}}
STAKE_VERIFIER=${SHIELDED_POOL_V4_STAKE_VERIFIER:-${GARAGA_ADAPTER_ADDRESS:-}}

if [ -z "$SWAP_VERIFIER" ] || [ "$SWAP_VERIFIER" = "0x..." ] || [ "$SWAP_VERIFIER" = "0x0" ]; then
  echo "Missing swap verifier (set SHIELDED_POOL_V4_SWAP_VERIFIER or GARAGA_ADAPTER_ADDRESS)" >&2
  exit 1
fi
if [ -z "$LIMIT_VERIFIER" ] || [ "$LIMIT_VERIFIER" = "0x..." ] || [ "$LIMIT_VERIFIER" = "0x0" ]; then
  echo "Missing limit verifier (set SHIELDED_POOL_V4_LIMIT_VERIFIER or GARAGA_ADAPTER_ADDRESS)" >&2
  exit 1
fi
if [ -z "$STAKE_VERIFIER" ] || [ "$STAKE_VERIFIER" = "0x..." ] || [ "$STAKE_VERIFIER" = "0x0" ]; then
  echo "Missing stake verifier (set SHIELDED_POOL_V4_STAKE_VERIFIER or GARAGA_ADAPTER_ADDRESS)" >&2
  exit 1
fi

echo "Setting ShieldedPool v4 verifiers..."
sncast invoke "${SNCAST_NET_ARGS[@]}" --contract-address "$SHIELDED_POOL_V4_ADDRESS" --function set_verifiers --calldata \
  "$SWAP_VERIFIER" "$LIMIT_VERIFIER" "$STAKE_VERIFIER"

echo "Done."
