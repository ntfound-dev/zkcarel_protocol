#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_DIR="$ROOT/scripts"

discover_default_garaga_checkout() {
  local candidate
  for candidate in /home/frend/.cargo/git/checkouts/garaga-*/*; do
    [[ -f "$candidate/pyproject.toml" ]] || continue
    if grep -Fq 'version = "1.1.0"' "$candidate/pyproject.toml"; then
      echo "$candidate"
      return 0
    fi
  done

  for candidate in /home/frend/.cargo/git/checkouts/garaga-*/*; do
    [[ -f "$candidate/pyproject.toml" ]] || continue
    echo "$candidate"
    return 0
  done

  return 1
}

GARAGA_CHECKOUT_DEFAULT="$(discover_default_garaga_checkout || true)"
GARAGA_CHECKOUT="${GARAGA_CHECKOUT:-$GARAGA_CHECKOUT_DEFAULT}"

if [[ ! -d "$GARAGA_CHECKOUT" ]]; then
  echo "Garaga checkout not found: $GARAGA_CHECKOUT" >&2
  echo "Set GARAGA_CHECKOUT to a local Garaga repo checkout." >&2
  exit 1
fi

GARAGA_PYTHON="${GARAGA_PYTHON:-$GARAGA_CHECKOUT/.venv/bin/python}"

run_stage_generator() {
  if [[ -x "$GARAGA_PYTHON" ]]; then
    "$GARAGA_PYTHON" "$SCRIPT_DIR/generate_honk_stage.py" "$@"
  else
    uv run --directory "$GARAGA_CHECKOUT" python "$SCRIPT_DIR/generate_honk_stage.py" "$@"
  fi
}

if [[ $# -eq 0 ]]; then
  FLOWS=(limit stake)
else
  FLOWS=( "$@" )
fi

project_name_for_flow() {
  case "$1" in
    limit) echo "limit_verifier_v4" ;;
    stake) echo "stake_verifier_v4" ;;
    btc|shadow_btc|shadow-btc) echo "btc_verifier_v4" ;;
    *)
      echo "Unsupported build flow: $1" >&2
      exit 1
      ;;
  esac
}

circuit_for_flow() {
  case "$1" in
    limit) echo "carel_limit" ;;
    stake) echo "carel_stake" ;;
    btc|shadow_btc|shadow-btc) echo "shadow_btc" ;;
    *)
      echo "Unsupported build flow: $1" >&2
      exit 1
      ;;
  esac
}

for flow in "${FLOWS[@]}"; do
  if [[ "$flow" == "btc" || "$flow" == "shadow_btc" || "$flow" == "shadow-btc" ]]; then
    cat >&2 <<'EOF'
Building shadow_btc only rescues the verifier/circuit path.
The backend private-btc-swap API route is still not wired end-to-end, and the
Bitcoin sha256d/block-header checks in the circuit remain TODOs.
EOF
  fi

  circuit="$(circuit_for_flow "$flow")"
  project_name="$(project_name_for_flow "$flow")"
  stage_parent="$ROOT/.garaga-stage/$flow"
  vk_path="$ROOT/garaga/circuits/$circuit/target/vk/vk"

  "$SCRIPT_DIR/refresh_honk_vk.sh" "$flow"

  run_stage_generator \
    --vk "$vk_path" \
    --out-dir "$stage_parent" \
    --project-name "$project_name" \
    --force-clean

  "$SCRIPT_DIR/build_honk_stage_headless.sh" \
    --stage "$stage_parent/$project_name"
done

echo "Done."
