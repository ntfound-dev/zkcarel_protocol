#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
CONTRACT_ROOT="${CONTRACT_ROOT:-$ROOT/cairo}"
export CONTRACT_ROOT

DEPLOY_CACHE_ROOT="${DEPLOY_CACHE_ROOT:-$ROOT/.deploy-cache}"
mkdir -p "$DEPLOY_CACHE_ROOT"/xdg "$DEPLOY_CACHE_ROOT"/tmp
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$DEPLOY_CACHE_ROOT/xdg}"
export TMPDIR="${TMPDIR:-$DEPLOY_CACHE_ROOT/tmp}"

if ! command -v sncast >/dev/null 2>&1; then
  echo "sncast not found in PATH" >&2
  exit 1
fi

echo "Compiling CAREL Protocol contracts..."
if [ ! -f "$CONTRACT_ROOT/Scarb.toml" ]; then
  echo "Missing $CONTRACT_ROOT/Scarb.toml" >&2
  exit 1
fi
(cd "$CONTRACT_ROOT" && scarb build)

echo "Deploying contracts with sncast..."

# Deploy remaining core + optional contracts (fills .env)
bash "$ROOT/scripts/06_deploy_remaining.sh"

# Deploy adapters (AI/bridge/privacy)
bash "$ROOT/scripts/04_deploy_adapters.sh"

# Deploy dedicated ShieldedPool v4 verifier wrappers
bash "$ROOT/scripts/12a_deploy_shielded_pool_v4_verifiers.sh"

# Deploy ShieldedPool v4 (Hide Mode core)
bash "$ROOT/scripts/12_deploy_shielded_pool_v4.sh"

# Wire ShieldedPool v4 verifiers
bash "$ROOT/scripts/13_wire_shielded_pool_v4.sh"

# Deploy price oracle and wire
bash "$ROOT/scripts/05_deploy_price_oracle.sh"

echo "Done."
