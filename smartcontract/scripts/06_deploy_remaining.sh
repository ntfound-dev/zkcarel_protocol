#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
cd "$ROOT"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

if ! command -v sncast >/dev/null 2>&1; then
  echo "sncast not found in PATH" >&2
  exit 1
fi

# Load env
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

NET="${NET:-sepolia}"
ADMIN="${ADMIN:-${OWNER_ADDRESS:-}}"
if [ -z "$ADMIN" ]; then
  echo "Missing ADMIN/OWNER_ADDRESS in $ENV_FILE" >&2
  exit 1
fi

BACKEND_SIGNER="${BACKEND_SIGNER:-$ADMIN}"
TREASURY_CONTRACT_ADDRESS="${TREASURY_CONTRACT_ADDRESS:-${TREASURY_ADDRESS:-}}"
NOW="${NOW:-$(date +%s)}"

GOVERNANCE_VOTING_DELAY="${GOVERNANCE_VOTING_DELAY:-0}"
GOVERNANCE_VOTING_PERIOD="${GOVERNANCE_VOTING_PERIOD:-0}"
TIMELOCK_MIN_DELAY="${TIMELOCK_MIN_DELAY:-0}"
DISCOUNT_EPOCH="${DISCOUNT_EPOCH:-0}"

BTC_LIGHT_CLIENT_ADDRESS="${BTC_LIGHT_CLIENT_ADDRESS:-0x0}"
BTC_MINT_TOKEN_ADDRESS="${BTC_MINT_TOKEN_ADDRESS:-0x0}"

REWARD_TOKEN_DEFAULT="${CAREL_TOKEN_ADDRESS:-0x0}"

needs_deploy() {
  local val="${1:-}"
  if [ -z "$val" ]; then
    return 0
  fi
  if [ "$val" = "0x..." ] || [ "$val" = "0x0" ] || [ "$val" = "0x00" ]; then
    return 0
  fi
  return 1
}

update_env() {
  local key="$1"
  local val="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    perl -0pi -e "s|^${key}=.*$|${key}=${val}|mg" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

deploy_contract() {
  local var="$1"
  local name="$2"
  shift 2
  local current="${!var:-}"
  if ! needs_deploy "$current"; then
    echo "Skip $name ($var already set)"
    return 0
  fi

  echo "Deploying $name -> $var"
  local out
  if [ "$#" -gt 0 ]; then
    out=$(sncast deploy --network "$NET" --contract-name "$name" --constructor-calldata "$@")
  else
    out=$(sncast deploy --network "$NET" --contract-name "$name")
  fi
  echo "$out"

  local addr
  addr=$(echo "$out" | awk '/Contract Address/ {print $NF; exit}')
  if [ -z "$addr" ]; then
    echo "Failed to parse contract address for $name" >&2
    exit 1
  fi

  export "$var"="$addr"
  update_env "$var" "$addr"
  echo "-> $var=$addr"
}

# Multisig
MULTISIG_REQUIRED="${MULTISIG_REQUIRED:-1}"
IFS=',' read -r -a MULTISIG_OWNERS_ARR <<< "${MULTISIG_OWNERS:-$ADMIN}"
MULTISIG_OWNERS_LEN="${#MULTISIG_OWNERS_ARR[@]}"
# u256 required = (low, high)
REQUIRED_LOW="$MULTISIG_REQUIRED"
REQUIRED_HIGH="0"

deploy_contract MULTISIG_ADDRESS Multisig "$MULTISIG_OWNERS_LEN" "${MULTISIG_OWNERS_ARR[@]}" "$REQUIRED_LOW" "$REQUIRED_HIGH"

# Core
if ! needs_deploy "${CAREL_TOKEN_ADDRESS:-}"; then
  deploy_contract VESTING_MANAGER_ADDRESS VestingManager "$ADMIN" "$CAREL_TOKEN_ADDRESS" "$NOW"
else
  echo "Skip VestingManager (CAREL_TOKEN_ADDRESS missing)"
fi

if ! needs_deploy "${TREASURY_CONTRACT_ADDRESS:-}"; then
  deploy_contract FEE_COLLECTOR_ADDRESS FeeCollector "$ADMIN" "$TREASURY_CONTRACT_ADDRESS"
else
  echo "Skip FeeCollector (TREASURY_CONTRACT_ADDRESS missing)"
fi

deploy_contract REGISTRY_ADDRESS Registry 0

deploy_contract ACCESS_CONTROL_ADDRESS AccessControlContract "$ADMIN"

deploy_contract EMERGENCY_PAUSE_ADDRESS EmergencyPause "$ADMIN" "${GUARDIAN_ADDRESS:-$ADMIN}"

deploy_contract CAREL_PROTOCOL_ADDRESS CarelProtocol

deploy_contract TWAP_ORACLE_ADDRESS TWAPOracle

# Rewards / NFT
if ! needs_deploy "${CAREL_TOKEN_ADDRESS:-}"; then
  deploy_contract REWARDS_ESCROW_ADDRESS RewardsEscrow "$ADMIN" "$CAREL_TOKEN_ADDRESS"
fi

deploy_contract LEADERBOARD_VIEW_ADDRESS LeaderboardView "$ADMIN" "$BACKEND_SIGNER"

deploy_contract MERKLE_VERIFIER_ADDRESS MerkleVerifier

if ! needs_deploy "${POINT_STORAGE_ADDRESS:-}"; then
  deploy_contract DISCOUNT_SOULBOUND_ADDRESS DiscountSoulbound "$POINT_STORAGE_ADDRESS" "$DISCOUNT_EPOCH"
  if needs_deploy "${NFT_CONTRACT_ADDRESS:-}" && [ -n "${DISCOUNT_SOULBOUND_ADDRESS:-}" ]; then
    update_env NFT_CONTRACT_ADDRESS "$DISCOUNT_SOULBOUND_ADDRESS"
    export NFT_CONTRACT_ADDRESS="$DISCOUNT_SOULBOUND_ADDRESS"
    echo "-> NFT_CONTRACT_ADDRESS=$DISCOUNT_SOULBOUND_ADDRESS"
  fi
else
  echo "Skip DiscountSoulbound (POINT_STORAGE_ADDRESS missing)"
fi

# Staking (use CAREL token as default reward token for testnet)
if ! needs_deploy "$REWARD_TOKEN_DEFAULT" && [ "$REWARD_TOKEN_DEFAULT" != "0x0" ]; then
  deploy_contract STAKING_BTC_ADDRESS BTCStaking "$REWARD_TOKEN_DEFAULT" "$ADMIN"
  deploy_contract STAKING_LP_ADDRESS LPStaking "$REWARD_TOKEN_DEFAULT" "$ADMIN"
  deploy_contract STAKING_STABLECOIN_ADDRESS StakingStablecoin "$REWARD_TOKEN_DEFAULT" "$ADMIN"
else
  echo "Skip BTC/LP/Stablecoin staking (CAREL_TOKEN_ADDRESS missing)"
fi

# Governance
if [ -n "$GOVERNANCE_VOTING_DELAY" ] && [ -n "$GOVERNANCE_VOTING_PERIOD" ]; then
  deploy_contract GOVERNANCE_ADDRESS Governance "$GOVERNANCE_VOTING_DELAY" "$GOVERNANCE_VOTING_PERIOD"
fi

deploy_contract TIMELOCK_ADDRESS Timelock "$ADMIN" "$TIMELOCK_MIN_DELAY"

# AI
deploy_contract AI_SIGNATURE_VERIFIER_ADDRESS AISignatureVerifier "$ADMIN"

# Bridge / Swap
deploy_contract SWAP_AGGREGATOR_ADDRESS SwapAggregator "$ADMIN"

deploy_contract BTC_NATIVE_BRIDGE_ADDRESS BtcNativeBridge "$ADMIN" "$BTC_LIGHT_CLIENT_ADDRESS" "$BTC_MINT_TOKEN_ADDRESS"

# Privacy verifiers + adapters
if needs_deploy "${MOCK_TONGO_VERIFIER_ADDRESS:-}"; then
  deploy_contract MOCK_TONGO_VERIFIER_ADDRESS MockTongoVerifier "$ADMIN" 1
fi
if needs_deploy "${TONGO_VERIFIER_ADDRESS:-}" && [ -n "${MOCK_TONGO_VERIFIER_ADDRESS:-}" ]; then
  update_env TONGO_VERIFIER_ADDRESS "$MOCK_TONGO_VERIFIER_ADDRESS"
  export TONGO_VERIFIER_ADDRESS="$MOCK_TONGO_VERIFIER_ADDRESS"
  echo "-> TONGO_VERIFIER_ADDRESS=$MOCK_TONGO_VERIFIER_ADDRESS"
fi
if [ -n "${TONGO_VERIFIER_ADDRESS:-}" ]; then
  deploy_contract TONGO_ADAPTER_ADDRESS TongoVerifierAdapter "$ADMIN" "$TONGO_VERIFIER_ADDRESS"
fi

if needs_deploy "${MOCK_SEMAPHORE_VERIFIER_ADDRESS:-}"; then
  deploy_contract MOCK_SEMAPHORE_VERIFIER_ADDRESS MockSemaphoreVerifier "$ADMIN" 1
fi
if needs_deploy "${SEMAPHORE_VERIFIER_ADDRESS:-}" && [ -n "${MOCK_SEMAPHORE_VERIFIER_ADDRESS:-}" ]; then
  update_env SEMAPHORE_VERIFIER_ADDRESS "$MOCK_SEMAPHORE_VERIFIER_ADDRESS"
  export SEMAPHORE_VERIFIER_ADDRESS="$MOCK_SEMAPHORE_VERIFIER_ADDRESS"
  echo "-> SEMAPHORE_VERIFIER_ADDRESS=$MOCK_SEMAPHORE_VERIFIER_ADDRESS"
fi
if [ -n "${SEMAPHORE_VERIFIER_ADDRESS:-}" ]; then
  deploy_contract SEMAPHORE_ADAPTER_ADDRESS SemaphoreVerifierAdapter "$ADMIN" "$SEMAPHORE_VERIFIER_ADDRESS"
fi

deploy_contract SIGMA_VERIFIER_ADDRESS SigmaVerifier

deploy_contract VERIFIER_REGISTRY_ADDRESS VerifierRegistry "$ADMIN"

deploy_contract SHIELDED_VAULT_ADDRESS ShieldedVault "$ADMIN" 0

deploy_contract PRIVACY_ROUTER_ADDRESS PrivacyRouter "$ADMIN" "$SHIELDED_VAULT_ADDRESS" "$VERIFIER_REGISTRY_ADDRESS"

# Private swap (bridge) uses Tongo adapter if available
if [ -n "${TONGO_ADAPTER_ADDRESS:-}" ]; then
  deploy_contract PRIVATE_SWAP_ADDRESS PrivateSwap "$TONGO_ADAPTER_ADDRESS"
elif [ -n "${TONGO_VERIFIER_ADDRESS:-}" ]; then
  deploy_contract PRIVATE_SWAP_ADDRESS PrivateSwap "$TONGO_VERIFIER_ADDRESS"
else
  echo "Skip PrivateSwap (no Tongo verifier/adapter)"
fi

# Bridge adapters (ByteArray endpoint: empty)
BYTEARRAY_EMPTY=(0 0 0)

deploy_contract ATOMIQ_ADAPTER_ADDRESS AtomiqAdapter "$ADMIN" "${BYTEARRAY_EMPTY[@]}"

deploy_contract GARDEN_ADAPTER_ADDRESS GardenAdapter "$ADMIN" "${BYTEARRAY_EMPTY[@]}"

deploy_contract LAYERSWAP_ADAPTER_ADDRESS LayerSwapAdapter "$ADMIN" "${BYTEARRAY_EMPTY[@]}"

echo "Done. Updated $ENV_FILE"
