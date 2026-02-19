#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/private_executor_lite"

export RAYON_NUM_THREADS="${RAYON_NUM_THREADS:-1}"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}"

if command -v asdf >/dev/null 2>&1; then
  asdf exec snforge test "$@"
else
  snforge test "$@"
fi
