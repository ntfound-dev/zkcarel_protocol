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

deploy_contract() {
  local var="$1"
  local name="$2"
  shift 2
  local current="${!var:-}"
  if ! needs_deploy "$current"; then
    echo "Skip $name ($var already set)"
    return 0
  fi

  echo "Deploy $name..."
  local declare_out
  if ! declare_out=$(run_sncast sncast declare --network "$NET" --contract-name "$name" 2>&1); then
    if echo "$declare_out" | grep -qi "already declared"; then
      echo "$declare_out"
    else
      echo "$declare_out" >&2
      exit 1
    fi
  else
    echo "$declare_out"
  fi

  local out=""
  local addr=""
  local deploy_attempt=1
  while [ "$deploy_attempt" -le "$SNCAST_MAX_RETRIES" ]; do
    if [ "$#" -gt 0 ]; then
      out=$(run_sncast sncast deploy --network "$NET" --contract-name "$name" --constructor-calldata "$@")
    else
      out=$(run_sncast sncast deploy --network "$NET" --contract-name "$name")
    fi
    echo "$out"
    addr=$(echo "$out" | awk '/Contract Address/ {print $NF; exit}')
    if [ -n "$addr" ]; then
      break
    fi
    if echo "$out" | grep -Eqi "cu limit exceeded|request too fast|too many requests|429|invalid transaction nonce|nonce is invalid|actual nonce"; then
      local sleep_secs=$((SNCAST_BASE_SLEEP_SECS * deploy_attempt))
      echo "Deploy output missing contract address due transient RPC/nonce issue. Retry $deploy_attempt/$SNCAST_MAX_RETRIES in ${sleep_secs}s..." >&2
      sleep "$sleep_secs"
      deploy_attempt=$((deploy_attempt + 1))
      continue
    fi
    break
  done
  if [ -z "$addr" ]; then
    echo "Failed to parse contract address for $name" >&2
    exit 1
  fi
  export "$var"="$addr"
  update_env "$var" "$addr"
  echo "-> $var=$addr"
  sleep 2
}

require_env OWNER_ADDRESS
require_env BACKEND_SIGNER
require_env BRIDGE_AGGREGATOR_ADDRESS
require_env ZK_PRIVACY_ROUTER_ADDRESS
require_env AI_EXECUTOR_ADDRESS

ATOMIQ_ENDPOINT=${ATOMIQ_ENDPOINT:-""}
GARDEN_ENDPOINT=${GARDEN_ENDPOINT:-""}
LAYERSWAP_ENDPOINT=${LAYERSWAP_ENDPOINT:-""}

GARAGA_VERIFIER_ADDRESS=${GARAGA_VERIFIER_ADDRESS:-${MOCK_GARAGA_VERIFIER_ADDRESS:-"0x0"}}
TONGO_VERIFIER_ADDRESS=${TONGO_VERIFIER_ADDRESS:-${MOCK_TONGO_VERIFIER_ADDRESS:-"0x0"}}
SEMAPHORE_VERIFIER_ADDRESS=${SEMAPHORE_VERIFIER_ADDRESS:-${MOCK_SEMAPHORE_VERIFIER_ADDRESS:-"0x0"}}
PRIVACY_VERIFIER_KIND=${PRIVACY_VERIFIER_KIND:-"garaga"}
GARAGA_VERIFICATION_MODE=${GARAGA_VERIFICATION_MODE:-"0"}

# ByteArray empty = [len=0, pending_word=0, pending_word_len=0]
BYTEARRAY_EMPTY=(0 0 0)

if [ -z "$ATOMIQ_ENDPOINT" ]; then
  ATOMIQ_ARGS=("${BYTEARRAY_EMPTY[@]}")
else
  ATOMIQ_ARGS=("$ATOMIQ_ENDPOINT")
fi

if [ -z "$GARDEN_ENDPOINT" ]; then
  GARDEN_ARGS=("${BYTEARRAY_EMPTY[@]}")
else
  GARDEN_ARGS=("$GARDEN_ENDPOINT")
fi

if [ -z "$LAYERSWAP_ENDPOINT" ]; then
  LAYERSWAP_ARGS=("${BYTEARRAY_EMPTY[@]}")
else
  LAYERSWAP_ARGS=("$LAYERSWAP_ENDPOINT")
fi

echo "=== Deploying AI/Bridge/Privacy adapters (sncast) ==="

deploy_contract AI_SIGNATURE_VERIFIER_ADDRESS AISignatureVerifier "$BACKEND_SIGNER"

deploy_contract ATOMIQ_ADAPTER_ADDRESS AtomiqAdapter "$OWNER_ADDRESS" "${ATOMIQ_ARGS[@]}"

deploy_contract GARDEN_ADAPTER_ADDRESS GardenAdapter "$OWNER_ADDRESS" "${GARDEN_ARGS[@]}"

deploy_contract LAYERSWAP_ADAPTER_ADDRESS LayerSwapAdapter "$OWNER_ADDRESS" "${LAYERSWAP_ARGS[@]}"

deploy_contract GARAGA_ADAPTER_ADDRESS GaragaVerifierAdapter "$OWNER_ADDRESS" "$GARAGA_VERIFIER_ADDRESS"

deploy_contract TONGO_ADAPTER_ADDRESS TongoVerifierAdapter "$OWNER_ADDRESS" "$TONGO_VERIFIER_ADDRESS"

deploy_contract SEMAPHORE_ADAPTER_ADDRESS SemaphoreVerifierAdapter "$OWNER_ADDRESS" "$SEMAPHORE_VERIFIER_ADDRESS"

# Configure AI executor verifier
echo "Configuring AI executor verifier..."
run_sncast sncast invoke --network "$NET" --contract-address "$AI_EXECUTOR_ADDRESS" --function set_signature_verification --calldata "$AI_SIGNATURE_VERIFIER_ADDRESS" 1 >/dev/null

# Configure bridge adapters
echo "Configuring bridge adapters..."
run_sncast sncast invoke --network "$NET" --contract-address "$BRIDGE_AGGREGATOR_ADDRESS" --function set_provider_adapter --calldata 0x41544d51 "$ATOMIQ_ADAPTER_ADDRESS" >/dev/null
run_sncast sncast invoke --network "$NET" --contract-address "$BRIDGE_AGGREGATOR_ADDRESS" --function set_provider_adapter --calldata 0x47415244 "$GARDEN_ADAPTER_ADDRESS" >/dev/null
run_sncast sncast invoke --network "$NET" --contract-address "$BRIDGE_AGGREGATOR_ADDRESS" --function set_provider_adapter --calldata 0x4c535750 "$LAYERSWAP_ADAPTER_ADDRESS" >/dev/null

# Configure Garaga adapter mode
echo "Configuring Garaga verification mode..."
run_sncast sncast invoke --network "$NET" --contract-address "$GARAGA_ADAPTER_ADDRESS" --function set_verification_mode --calldata "$GARAGA_VERIFICATION_MODE" >/dev/null

# Configure privacy router verifier (V1)
echo "Configuring privacy router verifier (V1)..."
case "$PRIVACY_VERIFIER_KIND" in
  garaga)
    PRIVACY_ADAPTER_ADDRESS=$GARAGA_ADAPTER_ADDRESS
    ;;
  tongo)
    PRIVACY_ADAPTER_ADDRESS=$TONGO_ADAPTER_ADDRESS
    ;;
  semaphore)
    PRIVACY_ADAPTER_ADDRESS=$SEMAPHORE_ADAPTER_ADDRESS
    ;;
  *)
    echo "Unknown PRIVACY_VERIFIER_KIND: $PRIVACY_VERIFIER_KIND" >&2
    exit 1
    ;;
 esac

run_sncast sncast invoke --network "$NET" --contract-address "$ZK_PRIVACY_ROUTER_ADDRESS" --function set_verifier --calldata "$PRIVACY_ADAPTER_ADDRESS" >/dev/null

echo "=== Deployment complete ==="
cat <<EOM
AI_SIGNATURE_VERIFIER_ADDRESS=$AI_SIGNATURE_VERIFIER_ADDRESS
ATOMIQ_ADAPTER_ADDRESS=$ATOMIQ_ADAPTER_ADDRESS
GARDEN_ADAPTER_ADDRESS=$GARDEN_ADAPTER_ADDRESS
LAYERSWAP_ADAPTER_ADDRESS=$LAYERSWAP_ADAPTER_ADDRESS
GARAGA_ADAPTER_ADDRESS=$GARAGA_ADAPTER_ADDRESS
TONGO_ADAPTER_ADDRESS=$TONGO_ADAPTER_ADDRESS
SEMAPHORE_ADAPTER_ADDRESS=$SEMAPHORE_ADAPTER_ADDRESS
EOM
