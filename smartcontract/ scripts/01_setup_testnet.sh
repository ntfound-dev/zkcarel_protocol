#!/bin/bash

echo "=== Tokenomi CAREL Testnet Setup ==="

# 1. Setup environment
echo "1. Setting up environment..."
mkdir -p ../testnet-infra/{config,wallets,logs}

# 2. Generate testnet accounts
echo "2. Generating testnet accounts..."
starkli account oz init .testnet-wallets/deployer --network sepolia
starkli account oz init .testnet-wallets/treasury --network sepolia
starkli account oz init .testnet-wallets/dev --network sepolia
starkli account oz init .testnet-wallets/investor --network sepolia
starkli account oz init .testnet-wallets/early_access --network sepolia
starkli account oz init .testnet-wallets/team --network sepolia
starkli account oz init .testnet-wallets/marketing --network sepolia
starkli account oz init .testnet-wallets/listing --network sepolia
starkli account oz init .testnet-wallets/ecosystem --network sepolia

# 3. Fund accounts from faucet
echo "3. Funding accounts from faucet..."
echo "Please visit: https://faucet.starknet.io/"
echo "And fund these addresses:"
cat .testnet-wallets/deployer/account.json | jq -r '.address'
cat .testnet-wallets/treasury/account.json | jq -r '.address'

# 4. Setup configuration
echo "4. Creating configuration files..."
cat > .env.testnet << EOF
# Starknet Testnet Configuration
NETWORK=starknet-sepolia
RPC_URL=https://starknet-sepolia.public.blastapi.io

# Account Addresses
DEPLOYER_ADDRESS=$(cat .testnet-wallets/deployer/account.json | jq -r '.address')
TREASURY_ADDRESS=$(cat .testnet-wallets/treasury/account.json | jq -r '.address')
DEV_WALLET=$(cat .testnet-wallets/dev/account.json | jq -r '.address')
INVESTOR_ADDRESS=$(cat .testnet-wallets/investor/account.json | jq -r '.address')
EARLY_ACCESS_ADDRESS=$(cat .testnet-wallets/early_access/account.json | jq -r '.address')
TEAM_ADDRESS=$(cat .testnet-wallets/team/account.json | jq -r '.address')
MARKETING_ADDRESS=$(cat .testnet-wallets/marketing/account.json | jq -r '.address')
LISTING_ADDRESS=$(cat .testnet-wallets/listing/account.json | jq -r '.address')
ECOSYSTEM_ADDRESS=$(cat .testnet-wallets/ecosystem/account.json | jq -r '.address')

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
EOF

echo "Setup completed! Please update .env.testnet with actual addresses."
