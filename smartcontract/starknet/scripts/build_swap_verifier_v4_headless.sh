#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOME_BUILD_ROOT="${HOME_BUILD_ROOT:-$HOME/.zkcare-build}"
LOG_DIR="${DEPLOY_LOG_DIR:-$ROOT/.deploy-logs}"
BUILD_CPUSET="${BUILD_CPUSET:-}"
BUILD_NICE_LEVEL="${BUILD_NICE_LEVEL:-10}"
BUILD_IONICE_CLASS="${BUILD_IONICE_CLASS:-3}"
BUILD_RAYON_THREADS="${BUILD_RAYON_THREADS:-2}"
ASDF_DIR="${ASDF_DIR:-$HOME/.asdf}"

SRC_SWAP_STAGE="$ROOT/.garaga-stage/swap/swap_verifier_v4"
SRC_ADAPTER="$ROOT/honk_wrapper_adapter"
DST_SWAP_STAGE="$HOME_BUILD_ROOT/swap_verifier_v4"
DST_ADAPTER="$HOME_BUILD_ROOT/honk_wrapper_adapter"

mkdir -p "$HOME_BUILD_ROOT" "$LOG_DIR"

run_build() {
  local workdir="$1"
  shift

  (
    cd "$workdir"
    if [ -d "$ASDF_DIR/shims" ]; then
      export PATH="$ASDF_DIR/shims:$ASDF_DIR/bin:$PATH"
    fi
    export RAYON_NUM_THREADS="$BUILD_RAYON_THREADS"
    export CARGO_BUILD_JOBS=1
    export MALLOC_ARENA_MAX=2

    local -a cmd=( "$@" )
    if [ -n "$BUILD_CPUSET" ] && command -v taskset >/dev/null 2>&1; then
      cmd=( taskset -c "$BUILD_CPUSET" "${cmd[@]}" )
    fi
    if command -v ionice >/dev/null 2>&1; then
      cmd=( ionice -c "$BUILD_IONICE_CLASS" "${cmd[@]}" )
    fi
    cmd=( nice -n "$BUILD_NICE_LEVEL" "${cmd[@]}" )

    "${cmd[@]}"
  )
}

if [ ! -f "$SRC_SWAP_STAGE/Scarb.toml" ]; then
  echo "Missing staged swap verifier package: $SRC_SWAP_STAGE" >&2
  exit 1
fi

if [ ! -f "$SRC_ADAPTER/Scarb.toml" ]; then
  echo "Missing honk wrapper adapter package: $SRC_ADAPTER" >&2
  exit 1
fi

echo "Syncing build sources into Linux filesystem..."
rsync -a --delete "$SRC_SWAP_STAGE/" "$DST_SWAP_STAGE/"
rsync -a --delete "$SRC_ADAPTER/" "$DST_ADAPTER/"

# Pythonic hints are not needed for deployment and slow down raw verifier builds.
perl -0pi -e 's/casm-add-pythonic-hints = true/casm-add-pythonic-hints = false/g' \
  "$DST_SWAP_STAGE/Scarb.toml"

echo "Building raw swap verifier in $DST_SWAP_STAGE ..."
if [ -d "$ASDF_DIR/shims" ]; then
  export PATH="$ASDF_DIR/shims:$ASDF_DIR/bin:$PATH"
fi
echo "scarb binary: $(command -v scarb)"
echo "scarb version: $(scarb --version | head -n 1)"
run_build "$DST_SWAP_STAGE" scarb build --target-kinds starknet-contract \
  2>&1 | tee "$LOG_DIR/build_swap_verifier_v4.log"

echo "Building honk wrapper adapter in $DST_ADAPTER ..."
run_build "$DST_ADAPTER" scarb build --target-kinds starknet-contract \
  2>&1 | tee "$LOG_DIR/build_honk_wrapper_adapter.log"

echo "Done."
echo "Raw verifier artifacts: $DST_SWAP_STAGE/target"
echo "Adapter artifacts: $DST_ADAPTER/target"
