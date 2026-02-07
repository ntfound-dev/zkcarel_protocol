#!/bin/bash
# deploy.sh

echo "Compiling CAREL Protocol contracts..."

# Compile semua contract
scarb build

echo "Deploying to Starknet testnet..."

# Deploy CARELToken
starkli deploy target/dev/carel_protocol_CARELToken.contract_class.json \
  --constructor-calldata \
    0xOWNER_ADDRESS \
    0xVESTING_MANAGER_ADDRESS \
    0xTREASURY_ADDRESS

# Deploy VestingManager
starkli deploy target/dev/carel_protocol_VestingManager.contract_class.json \
  --constructor-calldata 0xCAREL_TOKEN_ADDRESS

# Deploy Treasury
starkli deploy target/dev/carel_protocol_Treasury.contract_class.json \
  --constructor-calldata \
    0xCAREL_TOKEN_ADDRESS \
    0xDEV_WALLET \
    0xLP_WALLET

# Deploy SnapshotMerkleDistributor
starkli deploy target/dev/carel_protocol_SnapshotMerkleDistributor.contract_class.json \
  --constructor-calldata \
    0xCAREL_TOKEN_ADDRESS \
    0xBACKEND_SIGNER \
    0xDEV_WALLET \
    0xTREASURY_WALLET

# Deploy ZkCarelPoints
starkli deploy target/dev/carel_protocol_ZkCarelPoints.contract_class.json \
  --constructor-calldata \
    0xCAREL_TOKEN_ADDRESS \
    0xNFT_CONTRACT_ADDRESS

# Deploy ZkCarelNFT
starkli deploy target/dev/carel_protocol_ZkCarelNFT.contract_class.json \
  --constructor-calldata 0xPOINTS_CONTRACT_ADDRESS

# Deploy ZkCarelStaking
starkli deploy target/dev/carel_protocol_ZkCarelStaking.contract_class.json \
  --constructor-calldata \
    0xCAREL_TOKEN_ADDRESS \
    0xPOINTS_CONTRACT_ADDRESS

# Deploy ZkCarelRouter
starkli deploy target/dev/carel_protocol_ZkCarelRouter.contract_class.json \
  --constructor-calldata \
    0xWETH_ADDRESS \
    0xTREASURY_ADDRESS \
    0xPOINTS_CONTRACT_ADDRESS \
    0xNFT_CONTRACT_ADDRESS

echo "Deployment complete!"
echo ""
echo "Contract Addresses:"
echo "CARELToken: 0x..."
echo "VestingManager: 0x..."
echo "Treasury: 0x..."
echo "SnapshotMerkleDistributor: 0x..."
echo "ZkCarelPoints: 0x..."
echo "ZkCarelNFT: 0x..."
echo "ZkCarelStaking: 0x..."
echo "ZkCarelRouter: 0x..."