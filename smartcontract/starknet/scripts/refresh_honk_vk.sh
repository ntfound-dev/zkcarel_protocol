#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOME_BUILD_ROOT="${HOME_BUILD_ROOT:-$HOME/.zkcare-noir-build}"
BUILD_CPUSET="${BUILD_CPUSET:-}"
BUILD_NICE_LEVEL="${BUILD_NICE_LEVEL:-10}"
BUILD_IONICE_CLASS="${BUILD_IONICE_CLASS:-3}"
BUILD_RAYON_THREADS="${BUILD_RAYON_THREADS:-2}"
ASDF_DIR="${ASDF_DIR:-$HOME/.asdf}"
NARGO_EXTRA_ARGS="${NARGO_EXTRA_ARGS:-}"
BB_EXTRA_ARGS="${BB_EXTRA_ARGS:-}"

FLOW="${1:-}"
if [[ -z "$FLOW" ]]; then
  echo "Usage: $0 <swap|limit|stake|shadow_btc>" >&2
  exit 1
fi

case "$FLOW" in
  swap)
    CIRCUIT="carel_swap"
    ;;
  limit)
    CIRCUIT="carel_limit"
    ;;
  stake)
    CIRCUIT="carel_stake"
    ;;
  btc|shadow_btc|shadow-btc)
    CIRCUIT="shadow_btc"
    ;;
  *)
    echo "Unsupported flow: $FLOW" >&2
    exit 1
    ;;
esac

export PATH="$HOME/.asdf/shims:$HOME/.asdf/bin:$HOME/.nargo/bin:$HOME/.bb:$PATH"

CIRCUIT_DIR="$ROOT/garaga/circuits/$CIRCUIT"
SRC_TARGET_DIR="$CIRCUIT_DIR/target"
SRC_CIRCUITS_ROOT="$ROOT/garaga/circuits"
BUILD_CIRCUITS_ROOT="$HOME_BUILD_ROOT/circuits"
BUILD_DIR="$BUILD_CIRCUITS_ROOT/$CIRCUIT"
BUILD_TARGET_DIR="$BUILD_DIR/target"
BYTECODE_PATH="$BUILD_TARGET_DIR/${CIRCUIT}.json"
VK_DIR="$BUILD_TARGET_DIR/vk"

if [[ ! -d "$CIRCUIT_DIR" ]]; then
  echo "Circuit directory not found: $CIRCUIT_DIR" >&2
  exit 1
fi

mkdir -p "$HOME_BUILD_ROOT"
echo "Syncing circuits into Linux filesystem..."
rsync -a --delete \
  --exclude 'target/' \
  "$SRC_CIRCUITS_ROOT/" "$BUILD_CIRCUITS_ROOT/"

run_build() {
  (
    cd "$BUILD_DIR"
    if [[ -d "$ASDF_DIR/shims" ]]; then
      export PATH="$ASDF_DIR/shims:$ASDF_DIR/bin:$HOME/.nargo/bin:$HOME/.bb:$PATH"
    fi
    export RAYON_NUM_THREADS="$BUILD_RAYON_THREADS"
    export CARGO_BUILD_JOBS=1
    export MALLOC_ARENA_MAX=2

    local -a cmd=( "$@" )
    if [[ -n "$BUILD_CPUSET" ]] && command -v taskset >/dev/null 2>&1; then
      cmd=( taskset -c "$BUILD_CPUSET" "${cmd[@]}" )
    fi
    if command -v ionice >/dev/null 2>&1; then
      cmd=( ionice -c "$BUILD_IONICE_CLASS" "${cmd[@]}" )
    fi
    cmd=( nice -n "$BUILD_NICE_LEVEL" "${cmd[@]}" )
    "${cmd[@]}"
  )
}

echo "nargo binary: $(command -v nargo)"
echo "bb binary: $(command -v bb)"
if [[ -n "$NARGO_EXTRA_ARGS" ]]; then
  echo "nargo extra args: $NARGO_EXTRA_ARGS"
fi
if [[ -n "$BB_EXTRA_ARGS" ]]; then
  echo "bb extra args: $BB_EXTRA_ARGS"
fi

echo "Refreshing ACIR for $CIRCUIT ..."
read -r -a NARGO_ARGS <<< "$NARGO_EXTRA_ARGS"
run_build nargo compile --force "${NARGO_ARGS[@]}"

echo "Writing VK for $CIRCUIT ..."
mkdir -p "$VK_DIR"
read -r -a BB_ARGS <<< "$BB_EXTRA_ARGS"
run_build bb write_vk -s ultra_honk --oracle_hash keccak -b "$BYTECODE_PATH" -o "$VK_DIR" "${BB_ARGS[@]}"

echo "Syncing refreshed target back into repo..."
mkdir -p "$SRC_TARGET_DIR"
rsync -a --delete "$BUILD_TARGET_DIR/" "$SRC_TARGET_DIR/"

echo "Done."
echo "Bytecode: $SRC_TARGET_DIR/${CIRCUIT}.json"
echo "VK: $SRC_TARGET_DIR/vk/vk"
