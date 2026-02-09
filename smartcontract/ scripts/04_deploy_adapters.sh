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
require_env BACKEND_SIGNER
require_env BRIDGE_AGGREGATOR_ADDRESS
require_env ZK_PRIVACY_ROUTER_ADDRESS
require_env AI_EXECUTOR_ADDRESS

ATOMIQ_ENDPOINT=${ATOMIQ_ENDPOINT:-""}
GARDEN_ENDPOINT=${GARDEN_ENDPOINT:-""}
LAYERSWAP_ENDPOINT=${LAYERSWAP_ENDPOINT:-""}

GARAGA_VERIFIER_ADDRESS=${GARAGA_VERIFIER_ADDRESS:-"0x0"}
TONGO_VERIFIER_ADDRESS=${TONGO_VERIFIER_ADDRESS:-"0x0"}
SEMAPHORE_VERIFIER_ADDRESS=${SEMAPHORE_VERIFIER_ADDRESS:-"0x0"}
PRIVACY_VERIFIER_KIND=${PRIVACY_VERIFIER_KIND:-"garaga"}

echo "=== Deploying AI/Bridge/Privacy adapters ==="

echo "Deploy AISignatureVerifier..."
AI_SIGNATURE_VERIFIER_ADDRESS=$(starkli deploy target/dev/smartcontract_AISignatureVerifier.contract_class.json \
  --constructor-calldata \
  $BACKEND_SIGNER | tail -n 1)

echo "Deploy AtomiqAdapter..."
ATOMIQ_ADAPTER_ADDRESS=$(starkli deploy target/dev/smartcontract_AtomiqAdapter.contract_class.json \
  --constructor-calldata \
  $OWNER_ADDRESS \
  "$ATOMIQ_ENDPOINT" | tail -n 1)

echo "Deploy GardenAdapter..."
GARDEN_ADAPTER_ADDRESS=$(starkli deploy target/dev/smartcontract_GardenAdapter.contract_class.json \
  --constructor-calldata \
  $OWNER_ADDRESS \
  "$GARDEN_ENDPOINT" | tail -n 1)

echo "Deploy LayerSwapAdapter..."
LAYERSWAP_ADAPTER_ADDRESS=$(starkli deploy target/dev/smartcontract_LayerSwapAdapter.contract_class.json \
  --constructor-calldata \
  $OWNER_ADDRESS \
  "$LAYERSWAP_ENDPOINT" | tail -n 1)

echo "Deploy GaragaVerifierAdapter..."
GARAGA_ADAPTER_ADDRESS=$(starkli deploy target/dev/smartcontract_GaragaVerifierAdapter.contract_class.json \
  --constructor-calldata \
  $OWNER_ADDRESS \
  $GARAGA_VERIFIER_ADDRESS | tail -n 1)

echo "Deploy TongoVerifierAdapter..."
TONGO_ADAPTER_ADDRESS=$(starkli deploy target/dev/smartcontract_TongoVerifierAdapter.contract_class.json \
  --constructor-calldata \
  $OWNER_ADDRESS \
  $TONGO_VERIFIER_ADDRESS | tail -n 1)

echo "Deploy SemaphoreVerifierAdapter..."
SEMAPHORE_ADAPTER_ADDRESS=$(starkli deploy target/dev/smartcontract_SemaphoreVerifierAdapter.contract_class.json \
  --constructor-calldata \
  $OWNER_ADDRESS \
  $SEMAPHORE_VERIFIER_ADDRESS | tail -n 1)

echo "Configuring AI executor verifier..."
starkli invoke $AI_EXECUTOR_ADDRESS set_signature_verification $AI_SIGNATURE_VERIFIER_ADDRESS 1

echo "Configuring bridge adapters..."
starkli invoke $BRIDGE_AGGREGATOR_ADDRESS set_provider_adapter 'ATMQ' $ATOMIQ_ADAPTER_ADDRESS
starkli invoke $BRIDGE_AGGREGATOR_ADDRESS set_provider_adapter 'GARD' $GARDEN_ADAPTER_ADDRESS
starkli invoke $BRIDGE_AGGREGATOR_ADDRESS set_provider_adapter 'LSWP' $LAYERSWAP_ADAPTER_ADDRESS

echo "Configuring privacy router verifier..."
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

starkli invoke $ZK_PRIVACY_ROUTER_ADDRESS set_verifier $PRIVACY_ADAPTER_ADDRESS

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
