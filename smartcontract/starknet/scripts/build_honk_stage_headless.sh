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

SRC_STAGE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage)
      SRC_STAGE="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: $0 --stage <path-to-generated-stage-package>" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$SRC_STAGE" ]]; then
  echo "Missing --stage argument" >&2
  exit 1
fi

if [[ ! -f "$SRC_STAGE/Scarb.toml" ]]; then
  echo "Missing stage manifest: $SRC_STAGE/Scarb.toml" >&2
  exit 1
fi

STAGE_NAME="$(basename "$SRC_STAGE")"
DST_STAGE="$HOME_BUILD_ROOT/$STAGE_NAME"
LOG_FILE="$LOG_DIR/build_${STAGE_NAME}.log"

mkdir -p "$HOME_BUILD_ROOT" "$LOG_DIR"

run_build() {
  local workdir="$1"
  shift

  (
    cd "$workdir"
    if [[ -d "$ASDF_DIR/shims" ]]; then
      export PATH="$ASDF_DIR/shims:$ASDF_DIR/bin:$PATH"
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

echo "Syncing stage into Linux filesystem..."
rsync -a --delete "$SRC_STAGE/" "$DST_STAGE/"

perl -0pi -e 's/casm-add-pythonic-hints = true/casm-add-pythonic-hints = false/g' \
  "$DST_STAGE/Scarb.toml"

if [[ -d "$ASDF_DIR/shims" ]]; then
  export PATH="$ASDF_DIR/shims:$ASDF_DIR/bin:$PATH"
fi

echo "Building $STAGE_NAME in $DST_STAGE ..."
echo "scarb binary: $(command -v scarb)"
echo "scarb version: $(scarb --version | head -n 1)"
run_build "$DST_STAGE" scarb build --target-kinds starknet-contract \
  2>&1 | tee "$LOG_FILE"

echo "Done."
echo "Artifacts: $DST_STAGE/target"
echo "Log: $LOG_FILE"
