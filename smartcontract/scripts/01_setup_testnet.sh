#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=== Tokenomi CAREL Testnet Setup (sncast) ==="

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

# 1. Setup environment
echo "1. Setting up environment..."
mkdir -p ../testnet-infra/{config,wallets,logs}

# 2. Generate testnet accounts
accounts=(deployer treasury dev investor early_access team marketing listing ecosystem)

echo "2. Generating testnet accounts (sncast)..."
ACCOUNT_LIST="$(sncast account list 2>/dev/null || true)"

account_exists() {
  local name="$1"
  echo "$ACCOUNT_LIST" | awk -v n="$name" '$1=="-" && $2==n":" {found=1} END {exit found?0:1}'
}

for name in "${accounts[@]}"; do
  if account_exists "$name"; then
    echo "- $name already exists (skip create)"
  else
    sncast account create --network "$NET" --name "$name"
  fi
done

ACCOUNT_LIST="$(sncast account list 2>/dev/null || true)"

get_addr() {
  local name="$1"
  local addr
  addr=$(echo "$ACCOUNT_LIST" | awk -v n="$name" '
    $1=="-" && $2==n":" {found=1; next}
    found && $1=="address:" {print $2; exit}
    found && $1=="-" {found=0}
  ')
  if [ -z "$addr" ]; then
    echo "0x..."
  else
    echo "$addr"
  fi
}

# 3. Fund accounts from faucet
echo "3. Funding accounts from faucet..."
echo "Please visit: https://faucet.starknet.io/"
echo "And fund these addresses:"
echo "- deployer:  $(get_addr deployer)"
echo "- treasury:  $(get_addr treasury)"

# Optional: Deploy accounts after funding
echo "After funding, deploy accounts (sncast):"
for name in "${accounts[@]}"; do
  echo "sncast account deploy --network $NET --name $name"
done

# 4. Setup configuration
echo "4. Creating configuration files..."
cat > "$ROOT/.env.testnet" << ENVEOF
# Starknet Testnet Configuration
NETWORK=starknet-sepolia
RPC_URL=https://starknet-sepolia.public.blastapi.io

# Account Addresses
DEPLOYER_ADDRESS=$(get_addr deployer)
TREASURY_ADDRESS=$(get_addr treasury)
DEV_WALLET=$(get_addr dev)
INVESTOR_ADDRESS=$(get_addr investor)
EARLY_ACCESS_ADDRESS=$(get_addr early_access)
TEAM_ADDRESS=$(get_addr team)
MARKETING_ADDRESS=$(get_addr marketing)
LISTING_ADDRESS=$(get_addr listing)
ECOSYSTEM_ADDRESS=$(get_addr ecosystem)

# Emergency Council (Testnet)
COUNCIL_1=0x...
COUNCIL_2=0x...
COUNCIL_3=0x...

# Test Tokens
TEST_USDC=0x...
TEST_ETH=0x...

# Bridge Endpoints
ETH_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
BTC_TESTNET=http://user:pass@localhost:18332
ENVEOF

echo "Setup completed! Please update .env.testnet with actual addresses if needed."
