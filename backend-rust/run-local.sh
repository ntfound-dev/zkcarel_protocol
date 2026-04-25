#!/usr/bin/env bash
set -euo pipefail

cd /mnt/c/Users/frend/zkcare_protocol/backend-rust

# Resolve repo root (backend-rust) for absolute paths.
ROOT_DIR="$(pwd)"

# Use a short target dir to avoid long path issues on /mnt/c.
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-/tmp/zkcare_target}"
mkdir -p "$CARGO_TARGET_DIR"

# Load .env into the process environment without expanding nested $VARS.
# This keeps GARAGA_* placeholders intact and enables USE_STARKNET_RPC, etc.
load_env_file() {
  local file="$1"
  [ -f "$file" ] || return 0
  local line key val
  while IFS= read -r line || [ -n "$line" ]; do
    # Trim leading/trailing whitespace
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    # Skip blanks and comments
    [ -z "$line" ] && continue
    [ "${line:0:1}" = "#" ] && continue
    # Require key=value
    if [[ "$line" != *"="* ]]; then
      continue
    fi
    key="${line%%=*}"
    val="${line#*=}"
    # Trim whitespace around key/value
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    val="${val#"${val%%[![:space:]]*}"}"
    val="${val%"${val##*[![:space:]]}"}"
    # Strip surrounding quotes (keep inner $VARS literal)
    if [[ "$val" == \"*\" && "$val" == *\" ]]; then
      val="${val:1:-1}"
    elif [[ "$val" == \'*\' && "$val" == *\' ]]; then
      val="${val:1:-1}"
    fi
    # Respect existing environment (platform overrides win)
    if [[ -z "${!key+x}" ]]; then
      export "$key=$val"
    fi
  done < "$file"
}

load_env_file "/mnt/c/Users/frend/zkcare_protocol/backend-rust/.env"

# Build Garaga helpers (debug binaries by default, matches .env)
cargo build --bin garaga_auto_prover

# Build Filecoin synapse wrapper (always).
# This binary wraps the Node script and is only needed if you enable Filecoin uploads.
cargo build --bin filecoin_synapse
  if [[ -z "${FILECOIN_SYNAPSE_SCRIPT:-}" ]]; then
    export FILECOIN_SYNAPSE_SCRIPT="$ROOT_DIR/target/debug/filecoin_synapse"
  fi

# Run backend
cargo run
