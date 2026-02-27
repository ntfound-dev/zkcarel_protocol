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

set -a
source "$ENV_FILE"
set +a

NET=${NET:-}
if [ -z "$NET" ]; then
  if [ "${NETWORK:-}" = "starknet-sepolia" ]; then
    NET=sepolia
  else
    NET=${NETWORK:-sepolia}
  fi
fi

needs_addr() {
  local v="$1"
  if [ -z "$v" ] || [ "$v" = "0x..." ] || [ "$v" = "0x0" ]; then
    return 0
  fi
  return 1
}

require_addr() {
  local name="$1"
  local v="${!name:-}"
  if needs_addr "$v"; then
    echo "Missing env: $name" >&2
    exit 1
  fi
}

require_addr PRIVACY_ROUTER_ADDRESS
require_addr VERIFIER_REGISTRY_ADDRESS

# Select default verifier for V2 registry
PRIVACY_VERIFIER_ADDRESS=${PRIVACY_VERIFIER_ADDRESS:-""}
PRIVACY_VERIFIER_KIND=${PRIVACY_VERIFIER_KIND:-"garaga"}

if needs_addr "$PRIVACY_VERIFIER_ADDRESS"; then
  case "$PRIVACY_VERIFIER_KIND" in
    garaga)
      PRIVACY_VERIFIER_ADDRESS=${GARAGA_ADAPTER_ADDRESS:-""}
      ;;
    tongo)
      PRIVACY_VERIFIER_ADDRESS=${TONGO_ADAPTER_ADDRESS:-""}
      ;;
    semaphore)
      PRIVACY_VERIFIER_ADDRESS=${SEMAPHORE_ADAPTER_ADDRESS:-""}
      ;;
  esac
fi

if needs_addr "$PRIVACY_VERIFIER_ADDRESS"; then
  echo "Missing verifier address. Set PRIVACY_VERIFIER_ADDRESS or GARAGA/TONGO/SEMAPHORE adapter address." >&2
  exit 1
fi

PRIVACY_WIRE_EXTERNAL=${PRIVACY_WIRE_EXTERNAL:-0}
SLEEP_SECS=${SLEEP_SECS:-1}
MAX_RETRIES=${MAX_RETRIES:-5}
RETRY_SLEEP_SECS=${RETRY_SLEEP_SECS:-8}

invoke_retry() {
  local addr="$1"
  local fn="$2"
  shift 2

  local attempt=1
  while [ $attempt -le "$MAX_RETRIES" ]; do
    local out
    if out=$(sncast invoke --network "$NET" --contract-address "$addr" --function "$fn" --calldata "$@" 2>&1); then
      echo "$out"
      sleep "$SLEEP_SECS"
      return 0
    fi

    if echo "$out" | grep -qi "cu limit exceeded\\|Request too fast per second"; then
      echo "RPC rate limit hit. Retry $attempt/$MAX_RETRIES after ${RETRY_SLEEP_SECS}s..."
      sleep "$RETRY_SLEEP_SECS"
      attempt=$((attempt + 1))
      continue
    fi

    echo "$out" >&2
    return 1
  done

  echo "RPC rate limit still failing after $MAX_RETRIES retries." >&2
  return 1
}

set_verifier() {
  local action_hex="$1"
  invoke_retry "$VERIFIER_REGISTRY_ADDRESS" set_verifier "$action_hex" "$PRIVACY_VERIFIER_ADDRESS"
}

# Register all action types to default verifier
# Hex values from smartcontract/src/privacy/action_types.cairo
set_verifier 0x414343455353 # ACCESS
set_verifier 0x544f4b454e # TOKEN
set_verifier 0x5452454153555259 # TREASURY
set_verifier 0x474f5645524e # GOVERN
set_verifier 0x5354414b494e47 # STAKING
set_verifier 0x4e4654 # NFT
set_verifier 0x53574150 # SWAP
set_verifier 0x425249444745 # BRIDGE
set_verifier 0x4f5241434c45 # ORACLE
set_verifier 0x54574150 # TWAP
set_verifier 0x4c4541444552 # LEADER
set_verifier 0x504f494e5453 # POINTS
set_verifier 0x524546455252414c # REFERRAL
set_verifier 0x4149 # AI
set_verifier 0x464545 # FEE
set_verifier 0x5245474953545259 # REGISTRY
set_verifier 0x50524f544f434f4c # PROTOCOL
set_verifier 0x56455354494e47 # VESTING
set_verifier 0x54494d454c4f434b # TIMELOCK
set_verifier 0x53574150414747 # SWAPAGG
set_verifier 0x425443425249444745 # BTCBRIDGE
set_verifier 0x52455741524453 # REWARDS
set_verifier 0x534e415053484f54 # SNAPSHOT
set_verifier 0x444341 # DCA
set_verifier 0x454d455247454e4359 # EMERGENCY
set_verifier 0x4d554c5449534947 # MULTISIG
set_verifier 0x50524956414359 # PRIVACY
set_verifier 0x4441524b504f4f4c # DARKPOOL
set_verifier 0x5052495653574150 # PRIVSWAP
set_verifier 0x5042544353574150 # PBTCSWAP
set_verifier 0x5041594d454e54 # PAYMENT
set_verifier 0x414e4f4e43524544 # ANONCRED

wire_privacy_router() {
  local name="$1"
  local addr="${!name:-}"
  if needs_addr "$addr"; then
    return 0
  fi
  echo "set_privacy_router -> $name=$addr"
  invoke_retry "$addr" set_privacy_router "$PRIVACY_ROUTER_ADDRESS"
}

# Wire V2 router into all contracts that expose set_privacy_router
wire_privacy_router CAREL_TOKEN_ADDRESS
wire_privacy_router TREASURY_CONTRACT_ADDRESS
wire_privacy_router VESTING_MANAGER_ADDRESS
wire_privacy_router FEE_COLLECTOR_ADDRESS
wire_privacy_router REGISTRY_ADDRESS
wire_privacy_router MULTISIG_ADDRESS
wire_privacy_router ACCESS_CONTROL_ADDRESS
wire_privacy_router EMERGENCY_PAUSE_ADDRESS
wire_privacy_router CAREL_PROTOCOL_ADDRESS
wire_privacy_router TWAP_ORACLE_ADDRESS
wire_privacy_router PRICE_ORACLE_ADDRESS
wire_privacy_router POINT_STORAGE_ADDRESS
wire_privacy_router STAKING_CAREL_ADDRESS
wire_privacy_router STAKING_BTC_ADDRESS
wire_privacy_router STAKING_LP_ADDRESS
wire_privacy_router STAKING_STABLECOIN_ADDRESS
wire_privacy_router SNAPSHOT_DISTRIBUTOR_ADDRESS
wire_privacy_router REWARDS_ESCROW_ADDRESS
wire_privacy_router REFERRAL_SYSTEM_ADDRESS
wire_privacy_router LEADERBOARD_VIEW_ADDRESS
wire_privacy_router DISCOUNT_SOULBOUND_ADDRESS
wire_privacy_router GOVERNANCE_ADDRESS
wire_privacy_router TIMELOCK_ADDRESS
wire_privacy_router AI_EXECUTOR_ADDRESS
wire_privacy_router AI_SIGNATURE_VERIFIER_ADDRESS
wire_privacy_router SWAP_AGGREGATOR_ADDRESS
wire_privacy_router PRIVATE_SWAP_ADDRESS
# DarkPool/PrivatePayments use direct verifier, no set_privacy_router entrypoint
wire_privacy_router ANONYMOUS_CREDENTIALS_ADDRESS
# Runtime FE/BE uses LIMIT_ORDER_BOOK_ADDRESS; KEEPER_NETWORK_ADDRESS kept as catalog alias.
wire_privacy_router LIMIT_ORDER_BOOK_ADDRESS
wire_privacy_router KEEPER_NETWORK_ADDRESS

# External assets (optional)
if [ "$PRIVACY_WIRE_EXTERNAL" = "1" ]; then
  wire_privacy_router BRIDGE_AGGREGATOR_ADDRESS
  wire_privacy_router BTC_NATIVE_BRIDGE_ADDRESS
  wire_privacy_router PRIVATE_BTC_SWAP_ADDRESS
  wire_privacy_router ATOMIQ_ADAPTER_ADDRESS
  wire_privacy_router GARDEN_ADAPTER_ADDRESS
  wire_privacy_router LAYERSWAP_ADAPTER_ADDRESS
else
  echo "Skipping external asset modules (set PRIVACY_WIRE_EXTERNAL=1 to include)."
fi

echo "V2 privacy wiring complete."
