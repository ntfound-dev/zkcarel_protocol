#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"

cd "$ROOT"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

if ! command -v sncast >/dev/null 2>&1; then
  echo "sncast not found in PATH" >&2
  exit 1
fi

SNCAST_MAX_RETRIES="${SNCAST_MAX_RETRIES:-8}"
SNCAST_BASE_SLEEP_SECS="${SNCAST_BASE_SLEEP_SECS:-6}"
SNCAST_WAIT_TIMEOUT="${SNCAST_WAIT_TIMEOUT:-300}"
SNCAST_WAIT_RETRY_INTERVAL="${SNCAST_WAIT_RETRY_INTERVAL:-8}"

run_sncast() {
  local attempt=1
  local out=""
  local status=0
  while [ "$attempt" -le "$SNCAST_MAX_RETRIES" ]; do
    if out="$("$@" 2>&1)"; then
      if echo "$out" | grep -Eqi "^Error:|Transaction execution error|Unknown RPC error|JSON-RPC error"; then
        status=1
      else
        echo "$out"
        return 0
      fi
    else
      status=$?
    fi

    echo "$out" >&2
    if echo "$out" | grep -Eqi "cu limit exceeded|request too fast|too many requests|429|invalid transaction nonce|nonce is invalid|actual nonce|error sending request for url|timeout|gateway/add_transaction"; then
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

update_env_file() {
  local file="$1"
  local key="$2"
  local val="$3"
  if [ ! -f "$file" ]; then
    return 0
  fi
  if grep -q "^${key}=" "$file"; then
    perl -0pi -e "s|^${key}=.*$|${key}=${val}|mg" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

is_placeholder_addr() {
  local value="${1:-}"
  [ -z "$value" ] || [ "$value" = "0x..." ] || [ "$value" = "0x0" ] || [ "$value" = "0x00" ]
}

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

NET="${NET:-}"
if [ -z "$NET" ]; then
  if [ "${NETWORK:-}" = "starknet-sepolia" ]; then
    NET="sepolia"
  else
    NET="${NETWORK:-sepolia}"
  fi
fi
RPC_URL="${RPC_URL:-${STARKNET_RPC_URL:-${STARKNET_API_RPC_URL:-}}}"
SNCAST_TARGET_ARGS=(--network "$NET")
if [ -n "$RPC_URL" ]; then
  SNCAST_TARGET_ARGS=(--url "$RPC_URL")
fi

OWNER="${OWNER_ADDRESS:-${ADMIN:-${BACKEND_SIGNER:-}}}"
EXECUTOR="${PRIVATE_ACTION_EXECUTOR_ADDRESS:-}"
EXECUTOR_KIND="${HIDE_BALANCE_EXECUTOR_KIND:-shielded_pool_v2}"

if is_placeholder_addr "$OWNER"; then
  echo "Missing OWNER_ADDRESS (or ADMIN/BACKEND_SIGNER fallback) in $ENV_FILE" >&2
  exit 1
fi
if is_placeholder_addr "$EXECUTOR"; then
  echo "Missing PRIVATE_ACTION_EXECUTOR_ADDRESS in $ENV_FILE" >&2
  exit 1
fi

echo "=== Deploy PrivacyIntermediary ==="
echo "Network   : $NET"
if [ -n "$RPC_URL" ]; then
  echo "RPC URL   : custom (from env)"
fi
echo "Owner     : $OWNER"
echo "Executor  : $EXECUTOR"
echo "Exec kind : $EXECUTOR_KIND"

declare_out=""
if ! declare_out=$(run_sncast sncast --wait --wait-timeout "$SNCAST_WAIT_TIMEOUT" --wait-retry-interval "$SNCAST_WAIT_RETRY_INTERVAL" declare "${SNCAST_TARGET_ARGS[@]}" --contract-name PrivacyIntermediary 2>&1); then
  if echo "$declare_out" | grep -qi "already declared"; then
    echo "$declare_out"
  else
    echo "$declare_out" >&2
    exit 1
  fi
else
  echo "$declare_out"
fi

deploy_out="$(run_sncast sncast --wait --wait-timeout "$SNCAST_WAIT_TIMEOUT" --wait-retry-interval "$SNCAST_WAIT_RETRY_INTERVAL" deploy "${SNCAST_TARGET_ARGS[@]}" --contract-name PrivacyIntermediary --constructor-calldata "$OWNER" "$EXECUTOR")"
echo "$deploy_out"

PRIVACY_INTERMEDIARY_ADDRESS_NEW="$(echo "$deploy_out" | awk '/Contract Address/ {print $NF; exit}')"
if is_placeholder_addr "$PRIVACY_INTERMEDIARY_ADDRESS_NEW"; then
  echo "Failed to parse deployed PrivacyIntermediary address." >&2
  exit 1
fi

echo "New PRIVACY_INTERMEDIARY_ADDRESS: $PRIVACY_INTERMEDIARY_ADDRESS_NEW"

# Best-effort wiring:
# - ShieldedPoolV2 path does not expose `set_intermediary` and does not require it.
# - PrivateActionExecutor path can be wired with `set_intermediary`.
case "${EXECUTOR_KIND,,}" in
  shielded_pool_v2|shielded-v2|v2)
    echo "Skip set_intermediary: executor kind '${EXECUTOR_KIND}' uses ShieldedPoolV2 path."
    ;;
  *)
    set +e
    set_intermediary_out="$(sncast --wait --wait-timeout "$SNCAST_WAIT_TIMEOUT" --wait-retry-interval "$SNCAST_WAIT_RETRY_INTERVAL" invoke "${SNCAST_TARGET_ARGS[@]}" --contract-address "$EXECUTOR" --function set_intermediary --calldata "$PRIVACY_INTERMEDIARY_ADDRESS_NEW" 2>&1)"
    set_intermediary_status=$?
    set -e
    if [ "$set_intermediary_status" -eq 0 ]; then
      echo "set_intermediary wired on executor."
    else
      if echo "$set_intermediary_out" | grep -qi "ENTRYPOINT_NOT_FOUND"; then
        echo "Warning: executor class does not expose set_intermediary. Check HIDE_BALANCE_EXECUTOR_KIND and executor address."
      else
        echo "Warning: set_intermediary invoke failed. Output:" >&2
        echo "$set_intermediary_out" >&2
      fi
    fi
    ;;
esac

# Sync envs
update_env_file "$ENV_FILE" "PRIVACY_INTERMEDIARY_ADDRESS" "$PRIVACY_INTERMEDIARY_ADDRESS_NEW"
update_env_file "$REPO_ROOT/backend-rust/.env" "PRIVACY_INTERMEDIARY_ADDRESS" "$PRIVACY_INTERMEDIARY_ADDRESS_NEW"
update_env_file "$REPO_ROOT/backend-rust/deploy.env" "PRIVACY_INTERMEDIARY_ADDRESS" "$PRIVACY_INTERMEDIARY_ADDRESS_NEW"
update_env_file "$REPO_ROOT/frontend/.env" "NEXT_PUBLIC_PRIVACY_INTERMEDIARY_ADDRESS" "$PRIVACY_INTERMEDIARY_ADDRESS_NEW"
update_env_file "$REPO_ROOT/frontend/.env.local" "NEXT_PUBLIC_PRIVACY_INTERMEDIARY_ADDRESS" "$PRIVACY_INTERMEDIARY_ADDRESS_NEW"

echo
echo "=== Done ==="
echo "Updated:"
echo "- $ENV_FILE (PRIVACY_INTERMEDIARY_ADDRESS)"
echo "- $REPO_ROOT/backend-rust/.env (PRIVACY_INTERMEDIARY_ADDRESS)"
echo "- $REPO_ROOT/backend-rust/deploy.env (PRIVACY_INTERMEDIARY_ADDRESS)"
echo "- $REPO_ROOT/frontend/.env (NEXT_PUBLIC_PRIVACY_INTERMEDIARY_ADDRESS)"
echo "- $REPO_ROOT/frontend/.env.local (NEXT_PUBLIC_PRIVACY_INTERMEDIARY_ADDRESS)"
