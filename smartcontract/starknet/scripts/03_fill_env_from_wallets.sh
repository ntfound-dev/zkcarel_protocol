#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"
cd "$ROOT"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

if ! command -v sncast >/dev/null 2>&1; then
  echo "sncast not found in PATH" >&2
  exit 1
fi

NET=${NET:-}
if [ -z "$NET" ]; then
  if [ "${NETWORK:-}" = "starknet-sepolia" ]; then
    NET=sepolia
  else
    NET=${NETWORK:-sepolia}
  fi
fi

ACCOUNT_LIST="$(sncast account list 2>/dev/null || true)"
if [ -z "$ACCOUNT_LIST" ]; then
  echo "No accounts found. Create with: sncast account create --network $NET --name <name>" >&2
  exit 1
fi

get_addr() {
  local name="$1"
  local addr
  addr=$(echo "$ACCOUNT_LIST" | awk -v n="$name" '
    $1=="-" && $2==n":" {found=1; next}
    found && $1=="address:" {print $2; exit}
    found && $1=="-" {found=0}
  ')
  if [ -z "$addr" ]; then
    echo "" >&2
    return 1
  fi
  echo "$addr"
}

required=(deployer treasury dev investor early_access team marketing listing ecosystem)
for name in "${required[@]}"; do
  if ! get_addr "$name" >/dev/null; then
    echo "Missing sncast account: $name" >&2
    echo "Create with: sncast account create --network $NET --name $name" >&2
    exit 1
  fi
done

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
    perl -0pi -e "s|^${key}=.*$|${key}=${value}|mg" "$ENV_FILE"
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

echo "Updated $ENV_FILE from sncast accounts"
