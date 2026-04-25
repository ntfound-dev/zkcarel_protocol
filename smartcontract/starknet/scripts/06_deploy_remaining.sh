#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
CONTRACT_ROOT="${CONTRACT_ROOT:-$ROOT/cairo}"
cd "$CONTRACT_ROOT"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

if ! command -v sncast >/dev/null 2>&1; then
  echo "sncast not found in PATH" >&2
  exit 1
fi

SNCAST_MAX_RETRIES="${SNCAST_MAX_RETRIES:-8}"
SNCAST_BASE_SLEEP_SECS="${SNCAST_BASE_SLEEP_SECS:-6}"

run_sncast() {
  local attempt=1
  local out=""
  local status=0
  while [ "$attempt" -le "$SNCAST_MAX_RETRIES" ]; do
    out="$("$@" 2>&1)" && {
      echo "$out"
      return 0
    }
    status=$?
    echo "$out" >&2
    if echo "$out" | grep -Eqi "cu limit exceeded|request too fast|too many requests|429|invalid transaction nonce|nonce is invalid|actual nonce"; then
      local sleep_secs=$((SNCAST_BASE_SLEEP_SECS * attempt))
      echo "Transient RPC/nonce issue. Retry $attempt/$SNCAST_MAX_RETRIES in ${sleep_secs}s..." >&2
      sleep "$sleep_secs"
      attempt=$((attempt + 1))
      continue
    fi
    return "$status"
  done
  return "$status"
}

# Load env
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

NET="${NET:-sepolia}"
RPC_URL=${RPC_URL:-}
SNCAST_NET_ARGS=(--network "$NET")
if [ -n "$RPC_URL" ] && [ "$RPC_URL" != "0x..." ]; then
  SNCAST_NET_ARGS=(--url "$RPC_URL")
fi
CHAIN_ID="${CHAIN_ID:-}"
if [ -z "$CHAIN_ID" ]; then
  case "$NET" in
    sepolia) CHAIN_ID=0x534e5f5345504f4c4941 ;;
    mainnet) CHAIN_ID=0x534e5f4d41494e ;;
  esac
fi
ADMIN="${ADMIN:-${OWNER_ADDRESS:-}}"
if [ -z "$ADMIN" ]; then
  echo "Missing ADMIN/OWNER_ADDRESS in $ENV_FILE" >&2
  exit 1
fi

BACKEND_SIGNER="${BACKEND_SIGNER:-$ADMIN}"
SHADOW_BRIDGE_OPERATOR="${SHADOW_BRIDGE_OPERATOR:-$BACKEND_SIGNER}"
FAUCET_RELAYER="${FAUCET_RELAYER:-$BACKEND_SIGNER}"
TREASURY_CONTRACT_ADDRESS="${TREASURY_CONTRACT_ADDRESS:-${TREASURY_ADDRESS:-}}"
NOW="${NOW:-$(date +%s)}"

GOVERNANCE_VOTING_DELAY="${GOVERNANCE_VOTING_DELAY:-0}"
GOVERNANCE_VOTING_PERIOD="${GOVERNANCE_VOTING_PERIOD:-0}"
GOVERNANCE_QUORUM="${GOVERNANCE_QUORUM:-}"
TIMELOCK_MIN_DELAY="${TIMELOCK_MIN_DELAY:-172800}"
DISCOUNT_EPOCH="${DISCOUNT_EPOCH:-0}"

BTC_LIGHT_CLIENT_ADDRESS="${BTC_LIGHT_CLIENT_ADDRESS:-0x0}"
BTC_MINT_TOKEN_ADDRESS="${BTC_MINT_TOKEN_ADDRESS:-0x0}"

REWARD_TOKEN_DEFAULT="${CAREL_TOKEN_ADDRESS:-0x0}"
WBTC_STAKING_TOKEN="${TOKEN_WBTC_ADDRESS:-${TOKEN_BTC_ADDRESS:-}}"

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

ARTIFACTS_FILE="$CONTRACT_ROOT/target/release/smartcontract.starknet_artifacts.json"
artifact_exists() {
  local name="$1"
  if [ ! -f "$ARTIFACTS_FILE" ]; then
    return 0
  fi
  rg -q "\"contract_name\"\\s*:\\s*\"${name}\"" "$ARTIFACTS_FILE"
}

deploy_contract() {
  local var="$1"
  local name="$2"
  shift 2
  if ! artifact_exists "$name"; then
    echo "Skip $name (artifact not found)"
    return 0
  fi
  local current="${!var:-}"
  if ! needs_deploy "$current"; then
    echo "Skip $name ($var already set)"
    return 0
  fi

  echo "Deploying $name -> $var"
  local declare_out
  if ! declare_out=$(run_sncast sncast declare "${SNCAST_NET_ARGS[@]}" --contract-name "$name" 2>&1); then
    if echo "$declare_out" | grep -qi "already declared"; then
      echo "$declare_out"
    else
      echo "$declare_out" >&2
      exit 1
    fi
  else
    echo "$declare_out"
  fi

  local out=""
  local addr=""
  local deploy_attempt=1
  while [ "$deploy_attempt" -le "$SNCAST_MAX_RETRIES" ]; do
    if [ "$#" -gt 0 ]; then
      out=$(run_sncast sncast deploy "${SNCAST_NET_ARGS[@]}" --contract-name "$name" --constructor-calldata "$@")
    else
      out=$(run_sncast sncast deploy "${SNCAST_NET_ARGS[@]}" --contract-name "$name")
    fi
    echo "$out"
    addr=$(echo "$out" | awk '/Contract Address/ {print $NF; exit}')
    if [ -n "$addr" ]; then
      break
    fi
    if echo "$out" | grep -Eqi "cu limit exceeded|request too fast|too many requests|429|invalid transaction nonce|nonce is invalid|actual nonce"; then
      local sleep_secs=$((SNCAST_BASE_SLEEP_SECS * deploy_attempt))
      echo "Deploy output missing contract address due transient RPC/nonce issue. Retry $deploy_attempt/$SNCAST_MAX_RETRIES in ${sleep_secs}s..." >&2
      sleep "$sleep_secs"
      deploy_attempt=$((deploy_attempt + 1))
      continue
    fi
    break
  done

  if [ -z "$addr" ]; then
    echo "Failed to parse contract address for $name" >&2
    exit 1
  fi

  export "$var"="$addr"
  update_env "$var" "$addr"
  echo "-> $var=$addr"
  sleep 2
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
TOKEN_ADMIN="${TOKEN_ADMIN:-${MULTISIG_ADDRESS:-$ADMIN}}"
TREASURY_ADMIN="${TREASURY_ADMIN:-${MULTISIG_ADDRESS:-$ADMIN}}"

deploy_contract CAREL_TOKEN_ADDRESS CarelToken "$TOKEN_ADMIN"

if ! needs_deploy "${CAREL_TOKEN_ADDRESS:-}"; then
  deploy_contract TREASURY_CONTRACT_ADDRESS Treasury "$TREASURY_ADMIN" "$CAREL_TOKEN_ADDRESS"
else
  echo "Skip Treasury (CAREL_TOKEN_ADDRESS missing)"
fi

TREASURY_TARGET="${TREASURY_CONTRACT_ADDRESS:-${TREASURY_ADDRESS:-}}"
if needs_deploy "$TREASURY_TARGET"; then
  echo "Skip FeeCollector (TREASURY_ADDRESS missing)"
else
  deploy_contract FEE_COLLECTOR_ADDRESS FeeCollector "$ADMIN" "$TREASURY_TARGET"
fi

if ! needs_deploy "${CAREL_TOKEN_ADDRESS:-}"; then
  deploy_contract VESTING_MANAGER_ADDRESS VestingManager "$ADMIN" "$CAREL_TOKEN_ADDRESS" "$NOW"
else
  echo "Skip VestingManager (CAREL_TOKEN_ADDRESS missing)"
fi

deploy_contract REGISTRY_ADDRESS Registry 0

deploy_contract EMERGENCY_PAUSE_ADDRESS EmergencyPause "$ADMIN" "${GUARDIAN_ADDRESS:-$ADMIN}"

deploy_contract CAREL_PROTOCOL_ADDRESS CarelProtocol "$ADMIN"

deploy_contract TWAP_ORACLE_ADDRESS TWAPOracle "$ADMIN"

# Rewards / NFT
deploy_contract POINT_STORAGE_ADDRESS PointStorage "$BACKEND_SIGNER"
deploy_contract POINT_TOKEN_ADDRESS PointToken "$ADMIN"
deploy_contract MERKLE_VERIFIER_ADDRESS MerkleVerifier
if ! needs_deploy "${CAREL_TOKEN_ADDRESS:-}"; then
  deploy_contract REWARDS_ESCROW_ADDRESS RewardsEscrow "$ADMIN" "$CAREL_TOKEN_ADDRESS"
fi

if ! needs_deploy "${POINT_STORAGE_ADDRESS:-}"; then
  deploy_contract REFERRAL_SYSTEM_ADDRESS ReferralSystem "$ADMIN" "$BACKEND_SIGNER" "$POINT_STORAGE_ADDRESS"
  deploy_contract DISCOUNT_SOULBOUND_ADDRESS DiscountSoulbound "$POINT_STORAGE_ADDRESS" "$DISCOUNT_EPOCH"
  if [ -n "${DISCOUNT_SOULBOUND_ADDRESS:-}" ]; then
    echo "Authorizing DiscountSoulbound as PointStorage consumer..."
    add_consumer_out=$(run_sncast sncast invoke "${SNCAST_NET_ARGS[@]}" --contract-address "$POINT_STORAGE_ADDRESS" --function add_consumer --calldata "$DISCOUNT_SOULBOUND_ADDRESS")
    echo "$add_consumer_out"
  fi
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
  REWARD_POOL_ADDRESS="${REWARD_POOL_ADDRESS:-${TREASURY_CONTRACT_ADDRESS:-${REWARDS_ESCROW_ADDRESS:-${TREASURY_ADDRESS:-}}}}"
  if needs_deploy "$REWARD_POOL_ADDRESS"; then
    echo "Skip StakingCarel (reward pool missing)"
  else
    deploy_contract STAKING_CAREL_ADDRESS StakingCarel "$REWARD_TOKEN_DEFAULT" "$REWARD_POOL_ADDRESS" "$ADMIN"
  fi
  if [ -z "$WBTC_STAKING_TOKEN" ] || [ "$WBTC_STAKING_TOKEN" = "0x..." ] || [ "$WBTC_STAKING_TOKEN" = "0x0" ] || [ "$WBTC_STAKING_TOKEN" = "0x00" ]; then
    echo "Missing TOKEN_WBTC_ADDRESS/TOKEN_BTC_ADDRESS for WBTCStaking constructor" >&2
    exit 1
  fi
  deploy_contract STAKING_WBTC_ADDRESS WBTCStaking "$REWARD_TOKEN_DEFAULT" "$ADMIN" "$WBTC_STAKING_TOKEN"
  deploy_contract STAKING_LP_ADDRESS LPStaking "$REWARD_TOKEN_DEFAULT" "$ADMIN"
  deploy_contract STAKING_STABLECOIN_ADDRESS StakingStablecoin "$REWARD_TOKEN_DEFAULT" "$ADMIN"
else
  echo "Skip BTC/LP/Stablecoin staking (CAREL_TOKEN_ADDRESS missing)"
fi

if ! needs_deploy "${CAREL_TOKEN_ADDRESS:-}" && ! needs_deploy "${STAKING_CAREL_ADDRESS:-}" && ! needs_deploy "$TREASURY_TARGET"; then
  deploy_contract SNAPSHOT_DISTRIBUTOR_ADDRESS SnapshotDistributor "$CAREL_TOKEN_ADDRESS" "$STAKING_CAREL_ADDRESS" "$ADMIN" "$TREASURY_TARGET" "$BACKEND_SIGNER" "$NOW"
else
  echo "Skip SnapshotDistributor (missing CAREL token, staking carel, or treasury)"
fi

# Governance
if [ -n "$GOVERNANCE_VOTING_DELAY" ] && [ -n "$GOVERNANCE_VOTING_PERIOD" ] && [ -n "$CAREL_TOKEN_ADDRESS" ] && [ -n "$GOVERNANCE_QUORUM" ]; then
  deploy_contract GOVERNANCE_ADDRESS Governance "$GOVERNANCE_VOTING_DELAY" "$GOVERNANCE_VOTING_PERIOD" "$CAREL_TOKEN_ADDRESS" "$ADMIN" "$GOVERNANCE_QUORUM"
fi

deploy_contract TIMELOCK_ADDRESS Timelock "$ADMIN" "$TIMELOCK_MIN_DELAY"

# AI
deploy_contract AI_SIGNATURE_VERIFIER_ADDRESS AISignatureVerifier "$ADMIN"
if ! needs_deploy "${CAREL_TOKEN_ADDRESS:-}"; then
  deploy_contract AI_EXECUTOR_ADDRESS AIExecutor "$CAREL_TOKEN_ADDRESS" "$BACKEND_SIGNER"
else
  echo "Skip AIExecutor (CAREL_TOKEN_ADDRESS missing)"
fi

deploy_contract ERC8004_VALIDATION_REGISTRY_ADDRESS ERC8004ValidationRegistry "$ADMIN"
if [ -n "$CHAIN_ID" ]; then
  deploy_contract ERC8004_IDENTITY_REGISTRY_ADDRESS ERC8004IdentityRegistry "$ADMIN" "$CHAIN_ID"
else
  echo "Skip ERC8004IdentityRegistry (CHAIN_ID missing)"
fi

if [ -n "${ERC8004_REPUTATION_MAX_WEIGHT_LOW:-}" ] || [ -n "${ERC8004_REPUTATION_MAX_WEIGHT_HIGH:-}" ]; then
  MAX_WEIGHT_LOW="${ERC8004_REPUTATION_MAX_WEIGHT_LOW:-0}"
  MAX_WEIGHT_HIGH="${ERC8004_REPUTATION_MAX_WEIGHT_HIGH:-0}"
  deploy_contract ERC8004_REPUTATION_REGISTRY_ADDRESS ERC8004ReputationRegistry "$ADMIN" "$MAX_WEIGHT_LOW" "$MAX_WEIGHT_HIGH"
else
  echo "Skip ERC8004ReputationRegistry (set ERC8004_REPUTATION_MAX_WEIGHT_LOW/HIGH to deploy)"
fi

if ! needs_deploy "${AI_EXECUTOR_ADDRESS:-}" && ! needs_deploy "${ERC8004_IDENTITY_REGISTRY_ADDRESS:-}" && ! needs_deploy "${AI_SIGNATURE_VERIFIER_ADDRESS:-}" && [ -n "$CHAIN_ID" ]; then
  deploy_contract AI_PLAN_ROUTER_ADDRESS AIPlanRouter "$ADMIN" "$AI_EXECUTOR_ADDRESS" "$ERC8004_IDENTITY_REGISTRY_ADDRESS" "$AI_SIGNATURE_VERIFIER_ADDRESS" "$CHAIN_ID"
else
  echo "Skip AIPlanRouter (missing executor, identity registry, signature verifier, or chain id)"
fi

# Swap / Trading
deploy_contract SWAP_AGGREGATOR_ADDRESS SwapAggregator "$ADMIN"
deploy_contract LIMIT_ORDER_BOOK_ADDRESS LimitOrderBook "$ADMIN"

# Privacy + bridge primitives
deploy_contract BTC_LIGHT_CLIENT_ADDRESS btc_light_client
deploy_contract CAREL_STAKE_VAULT_ADDRESS carel_stake_vault "$ADMIN"

if ! needs_deploy "${AI_EXECUTOR_ADDRESS:-}"; then
  deploy_contract PRIVACY_INTERMEDIARY_ADDRESS PrivacyIntermediary "$ADMIN" "$AI_EXECUTOR_ADDRESS"
else
  echo "Skip PrivacyIntermediary (AI_EXECUTOR_ADDRESS missing)"
fi

if ! needs_deploy "${SHIELDED_POOL_V4_ADDRESS:-}"; then
  deploy_contract PRIVACY_ROUTER_V4_ADDRESS PrivacyRouterV4 "$ADMIN" "$SHIELDED_POOL_V4_ADDRESS"
else
  echo "Skip PrivacyRouterV4 (SHIELDED_POOL_V4_ADDRESS missing)"
fi

if [ -n "${SHADOW_BRIDGE_OPERATOR:-}" ] && ! needs_deploy "${SHIELDED_POOL_V4_ADDRESS:-}" && ! needs_deploy "${CAREL_TOKEN_ADDRESS:-}"; then
  deploy_contract SHADOW_BRIDGE_RECEIVER_ADDRESS shadow_bridge_receiver "$ADMIN" "$SHADOW_BRIDGE_OPERATOR" "$SHIELDED_POOL_V4_ADDRESS" "$CAREL_TOKEN_ADDRESS"
else
  echo "Skip shadow_bridge_receiver (set SHADOW_BRIDGE_OPERATOR, SHIELDED_POOL_V4_ADDRESS, CAREL_TOKEN_ADDRESS to deploy)"
fi

if [ -n "${FAUCET_RELAYER:-}" ]; then
  deploy_contract CAREL_MULTI_FAUCET_ADDRESS CarelMultiFaucet "$ADMIN" "$FAUCET_RELAYER"
else
  echo "Skip CarelMultiFaucet (set FAUCET_RELAYER to deploy)"
fi

echo "Done. Updated $ENV_FILE"
