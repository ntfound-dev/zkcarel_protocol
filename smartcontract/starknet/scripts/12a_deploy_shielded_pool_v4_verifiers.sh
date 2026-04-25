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
  echo "Missing $CAIRO_DIR/Scarb.toml." >&2
  exit 1
fi

update_env() {
  local key="$1"
  local val="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    perl -0pi -e "s|^${key}=.*$|${key}=${val}|mg" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

needs_deploy() {
  local val="${1:-}"
  if [ -z "$val" ] || [ "$val" = "0x..." ] || [ "$val" = "0x0" ] || [ "$val" = "0x00" ]; then
    return 0
  fi
  return 1
}

deploy_wrapper_verifier() {
  local env_key="$1"
  local contract_name="$2"
  local current="${!env_key:-}"

  if ! needs_deploy "$current" && [ "${FORCE_REDEPLOY_SHIELDED_POOL_V4_VERIFIERS:-0}" != "1" ]; then
    echo "Skip ${env_key} (${current} already set)"
    return 0
  fi

  echo "Declaring ${contract_name}..."
  local declare_log="${LOG_DIR}/${env_key}_declare.log"
  if ! sncast declare "${SNCAST_NET_ARGS[@]}" --contract-name "$contract_name" >"$declare_log" 2>&1; then
    if ! grep -qi "already declared" "$declare_log"; then
      cat "$declare_log" >&2
      exit 1
    fi
  fi
  cat "$declare_log"

  echo "Deploying ${contract_name}..."
  local deploy_out
  deploy_out=$(sncast deploy "${SNCAST_NET_ARGS[@]}" --contract-name "$contract_name")
  echo "$deploy_out"

  local addr
  addr=$(echo "$deploy_out" | awk '/Contract Address/ {print $NF; exit}')
  if [ -z "$addr" ]; then
    echo "Failed to parse deployed address for ${contract_name}" >&2
    exit 1
  fi

  update_env "$env_key" "$addr"
  export "${env_key}=$addr"
  echo "-> ${env_key}=${addr}"
}

cd "$CAIRO_DIR"

if [ ! -f "$CAIRO_DIR/target/dev/smartcontract.starknet_artifacts.json" ] && [ ! -f "$CAIRO_DIR/target/release/smartcontract.starknet_artifacts.json" ]; then
  echo "Building Cairo contracts first..."
  scarb build
fi

deploy_wrapper_verifier \
  SHIELDED_POOL_V4_SWAP_VERIFIER \
  smartcontract::garaga_verifiers::swap_verifier::honk_verifier::UltraKeccakZKHonkVerifier

deploy_wrapper_verifier \
  SHIELDED_POOL_V4_LIMIT_VERIFIER \
  smartcontract::garaga_verifiers::limit_verifier::honk_verifier::UltraKeccakZKHonkVerifier

deploy_wrapper_verifier \
  SHIELDED_POOL_V4_STAKE_VERIFIER \
  smartcontract::garaga_verifiers::stake_verifier::honk_verifier::UltraKeccakZKHonkVerifier

echo "Done."
