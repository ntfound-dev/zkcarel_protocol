#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v sncast >/dev/null 2>&1; then
  echo "sncast not found in PATH" >&2
  exit 1
fi

echo "Compiling CAREL Protocol contracts..."
scarb build

echo "Deploying contracts with sncast..."

# Deploy remaining core + optional contracts (fills .env)
bash "$ROOT/scripts/06_deploy_remaining.sh"

# Deploy adapters (AI/bridge/privacy)
bash "$ROOT/scripts/04_deploy_adapters.sh"

# Deploy price oracle and wire
bash "$ROOT/scripts/05_deploy_price_oracle.sh"

echo "Done."
