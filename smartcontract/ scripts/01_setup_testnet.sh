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