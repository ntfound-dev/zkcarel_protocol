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

deploy_contract() {
  local var="$1"
  local name="$2"
  shift 2
  echo "Deploy $name..."
  local out
  if [ "$#" -gt 0 ]; then
    out=$(sncast deploy --network "$NET" --contract-name "$name" --constructor-calldata "$@")
  else
    out=$(sncast deploy --network "$NET" --contract-name "$name")
  fi
  echo "$out"
  local addr
  addr=$(echo "$out" | awk '/Contract Address/ {print $NF; exit}')
  if [ -z "$addr" ]; then
    echo "Failed to parse contract address for $name" >&2
    exit 1
  fi
  export "$var"="$addr"
  update_env "$var" "$addr"
  echo "-> $var=$addr"
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
sncast invoke --network "$NET" --contract-address "$AI_EXECUTOR_ADDRESS" --function set_signature_verification --calldata "$AI_SIGNATURE_VERIFIER_ADDRESS" 1

# Configure bridge adapters
echo "Configuring bridge adapters..."
sncast invoke --network "$NET" --contract-address "$BRIDGE_AGGREGATOR_ADDRESS" --function set_provider_adapter --calldata 0x41544d51 "$ATOMIQ_ADAPTER_ADDRESS"
sncast invoke --network "$NET" --contract-address "$BRIDGE_AGGREGATOR_ADDRESS" --function set_provider_adapter --calldata 0x47415244 "$GARDEN_ADAPTER_ADDRESS"
sncast invoke --network "$NET" --contract-address "$BRIDGE_AGGREGATOR_ADDRESS" --function set_provider_adapter --calldata 0x4c535750 "$LAYERSWAP_ADAPTER_ADDRESS"

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

sncast invoke --network "$NET" --contract-address "$ZK_PRIVACY_ROUTER_ADDRESS" --function set_verifier --calldata "$PRIVACY_ADAPTER_ADDRESS"

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
