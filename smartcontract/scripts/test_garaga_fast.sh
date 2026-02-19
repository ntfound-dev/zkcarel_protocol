#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/garaga_real_bls"

if command -v asdf >/dev/null 2>&1; then
  asdf exec snforge test "$@"
else
  snforge test "$@"
fi
