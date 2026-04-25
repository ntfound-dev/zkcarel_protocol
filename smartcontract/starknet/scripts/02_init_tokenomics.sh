#!/bin/bash
set -euo pipefail

# Initialize tokenomics (default vesting + create schedules)
# Requires: sncast configured and VESTING_MANAGER_ADDRESS + beneficiary addresses set.

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

: "${VESTING_MANAGER_ADDRESS:?Missing VESTING_MANAGER_ADDRESS}"
: "${INVESTOR_ADDRESS:?Missing INVESTOR_ADDRESS}"
: "${EARLY_ACCESS_ADDRESS:?Missing EARLY_ACCESS_ADDRESS}"
: "${TEAM_ADDRESS:?Missing TEAM_ADDRESS}"
: "${MARKETING_ADDRESS:?Missing MARKETING_ADDRESS}"
: "${LISTING_ADDRESS:?Missing LISTING_ADDRESS}"
: "${ECOSYSTEM_ADDRESS:?Missing ECOSYSTEM_ADDRESS}"
: "${TREASURY_ADDRESS:?Missing TREASURY_ADDRESS}"

MONTH_SECONDS=2592000
VESTING_36=$((36 * MONTH_SECONDS))
VESTING_24=$((24 * MONTH_SECONDS))
VESTING_66=$((66 * MONTH_SECONDS))
CLIFF_6=$((6 * MONTH_SECONDS))
RELEASE_IMMEDIATE=${RELEASE_IMMEDIATE:-1}

invoke() {
  local fn="$1"
  shift
  sncast invoke --network "$NET" --contract-address "$VESTING_MANAGER_ADDRESS" --function "$fn" --calldata "$@"
}

# VestingCategory enum indices:
# 0 Investor, 1 Tim, 2 Marketing, 3 Listing, 4 EarlyAccess, 5 Ecosystem, 6 Treasury

echo "Setting default vesting config..."

invoke set_default_vesting_config 0 0 "$VESTING_36"
invoke set_default_vesting_config 1 "$CLIFF_6" "$VESTING_36"
invoke set_default_vesting_config 2 0 "$VESTING_24"
invoke set_default_vesting_config 3 0 0
invoke set_default_vesting_config 4 0 0
invoke set_default_vesting_config 5 0 "$VESTING_66"
invoke set_default_vesting_config 6 0 0

echo "Setting up tokenomics schedules..."
invoke setup_tokenomics \
  "$INVESTOR_ADDRESS" \
  "$EARLY_ACCESS_ADDRESS" \
  "$TEAM_ADDRESS" \
  "$MARKETING_ADDRESS" \
  "$LISTING_ADDRESS" \
  "$ECOSYSTEM_ADDRESS" \
  "$TREASURY_ADDRESS" \
  "$RELEASE_IMMEDIATE"

echo "Done."
