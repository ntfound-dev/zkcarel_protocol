#!/bin/bash
set -euo pipefail

# Initialize tokenomics (default vesting + create schedules)
# Requires: starkli configured and VESTING_MANAGER_ADDRESS + beneficiary addresses set.

if [ -f .env ]; then
  set -a
  source .env
  set +a
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

# VestingCategory enum indices:
# 0 Investor, 1 Tim, 2 Marketing, 3 Listing, 4 EarlyAccess, 5 Ecosystem, 6 Treasury

echo "Setting default vesting config..."

starkli invoke "$VESTING_MANAGER_ADDRESS" set_default_vesting_config 0 0 "$VESTING_36"
starkli invoke "$VESTING_MANAGER_ADDRESS" set_default_vesting_config 1 "$CLIFF_6" "$VESTING_36"
starkli invoke "$VESTING_MANAGER_ADDRESS" set_default_vesting_config 2 0 "$VESTING_24"
starkli invoke "$VESTING_MANAGER_ADDRESS" set_default_vesting_config 3 0 0
starkli invoke "$VESTING_MANAGER_ADDRESS" set_default_vesting_config 4 0 0
starkli invoke "$VESTING_MANAGER_ADDRESS" set_default_vesting_config 5 0 "$VESTING_66"
starkli invoke "$VESTING_MANAGER_ADDRESS" set_default_vesting_config 6 0 0

echo "Setting up tokenomics schedules..."
starkli invoke "$VESTING_MANAGER_ADDRESS" setup_tokenomics \
  "$INVESTOR_ADDRESS" \
  "$EARLY_ACCESS_ADDRESS" \
  "$TEAM_ADDRESS" \
  "$MARKETING_ADDRESS" \
  "$LISTING_ADDRESS" \
  "$ECOSYSTEM_ADDRESS" \
  "$TREASURY_ADDRESS" \
  "$RELEASE_IMMEDIATE"

echo "Done."
