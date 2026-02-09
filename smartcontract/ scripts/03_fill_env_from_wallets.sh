#!/bin/bash
set -euo pipefail

ENV_FILE="../.env"
WALLETS_DIR="../.testnet-wallets"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

required=(deployer treasury dev investor early_access team marketing listing ecosystem)
for name in "${required[@]}"; do
  if [ ! -f "$WALLETS_DIR/$name/account.json" ]; then
    echo "Missing wallet: $WALLETS_DIR/$name/account.json" >&2
    exit 1
  fi
  if ! command -v jq >/dev/null 2>&1; then
    echo "jq is required to parse account.json" >&2
    exit 1
  fi
  done

get_addr() {
  local name="$1"
  jq -r '.address' "$WALLETS_DIR/$name/account.json"
}

OWNER_ADDRESS=$(get_addr deployer)
DEPLOYER_ADDRESS=$(get_addr deployer)
TREASURY_ADDRESS=$(get_addr treasury)
DEV_WALLET=$(get_addr dev)
LP_WALLET=$(get_addr treasury)
BACKEND_SIGNER=$(get_addr dev)

INVESTOR_ADDRESS=$(get_addr investor)
EARLY_ACCESS_ADDRESS=$(get_addr early_access)
TEAM_ADDRESS=$(get_addr team)
MARKETING_ADDRESS=$(get_addr marketing)
LISTING_ADDRESS=$(get_addr listing)
ECOSYSTEM_ADDRESS=$(get_addr ecosystem)

update_key() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
}

update_key OWNER_ADDRESS "$OWNER_ADDRESS"
update_key DEPLOYER_ADDRESS "$DEPLOYER_ADDRESS"
update_key TREASURY_ADDRESS "$TREASURY_ADDRESS"
update_key DEV_WALLET "$DEV_WALLET"
update_key LP_WALLET "$LP_WALLET"
update_key BACKEND_SIGNER "$BACKEND_SIGNER"

update_key INVESTOR_ADDRESS "$INVESTOR_ADDRESS"
update_key EARLY_ACCESS_ADDRESS "$EARLY_ACCESS_ADDRESS"
update_key TEAM_ADDRESS "$TEAM_ADDRESS"
update_key MARKETING_ADDRESS "$MARKETING_ADDRESS"
update_key LISTING_ADDRESS "$LISTING_ADDRESS"
update_key ECOSYSTEM_ADDRESS "$ECOSYSTEM_ADDRESS"

echo "Updated $ENV_FILE from $WALLETS_DIR"
