#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TMP_ROOT="${GARAGA_TMP_ROOT:-/tmp/garaga-noir}"

mkdir -p "${TMP_ROOT}"

if [[ -z "${RAYON_NUM_THREADS:-}" ]]; then
  export RAYON_NUM_THREADS="${GARAGA_NOIR_RAYON_THREADS:-1}"
fi

should_prefer_tmp_paths() {
  local candidate
  for candidate in "$@"; do
    if [[ -n "${candidate}" && "${candidate}" == /mnt/* ]]; then
      return 0
    fi
  done
  return 1
}

if should_prefer_tmp_paths "${PROJECT_ROOT}" "${HOME:-}" "${XDG_CACHE_HOME:-}" "${NARGO_HOME:-}"; then
  export HOME="${GARAGA_NOIR_HOME:-${TMP_ROOT}/home}"
  export XDG_CACHE_HOME="${GARAGA_XDG_CACHE_HOME:-${TMP_ROOT}/xdg-cache}"
  export NARGO_HOME="${GARAGA_NARGO_HOME:-${TMP_ROOT}/nargo-home}"
  export TMPDIR="${GARAGA_TMPDIR:-${TMP_ROOT}/tmp}"
fi

if [[ -z "${HOME:-}" || ! -w "${HOME:-/}" ]]; then
  export HOME="${GARAGA_NOIR_HOME:-${PROJECT_ROOT}/.garaga-home}"
fi
if [[ -z "${XDG_CACHE_HOME:-}" || ! -w "${XDG_CACHE_HOME:-/}" ]]; then
  export XDG_CACHE_HOME="${GARAGA_XDG_CACHE_HOME:-${HOME}/.cache}"
fi
if [[ -z "${NARGO_HOME:-}" || ! -w "${NARGO_HOME:-/}" ]]; then
  export NARGO_HOME="${GARAGA_NARGO_HOME:-${HOME}/.nargo}"
fi

mkdir -p "${HOME}" "${XDG_CACHE_HOME}" "${NARGO_HOME}" "${TMPDIR:-${TMP_ROOT}/tmp}"

if [[ -z "${GARAGA_CONTEXT_PATH:-}" ]]; then
  echo "Missing GARAGA_CONTEXT_PATH" >&2
  exit 1
fi
if [[ ! -f "${GARAGA_CONTEXT_PATH}" ]]; then
  echo "GARAGA_CONTEXT_PATH not found: ${GARAGA_CONTEXT_PATH}" >&2
  exit 1
fi
if [[ -z "${GARAGA_PROOF_PATH:-}" || -z "${GARAGA_PUBLIC_INPUTS_PATH:-}" ]]; then
  echo "Missing GARAGA_PROOF_PATH or GARAGA_PUBLIC_INPUTS_PATH" >&2
  exit 1
fi

if [[ -n "${GARAGA_NOIR_PROVER_URL:-}" ]]; then
  AUTH_HEADER=""
  if [[ -n "${GARAGA_NOIR_PROVER_AUTH:-}" ]]; then
    AUTH_HEADER="Authorization: ${GARAGA_NOIR_PROVER_AUTH}"
  elif [[ -n "${GARAGA_NOIR_PROVER_TOKEN:-}" ]]; then
    AUTH_HEADER="Authorization: Bearer ${GARAGA_NOIR_PROVER_TOKEN}"
  fi

  REQUEST_MODE="${GARAGA_NOIR_PROVER_REQUEST_MODE:-context}"
  TIMEOUT_SECS="${GARAGA_NOIR_PROVER_TIMEOUT_SECS:-120}"
  if [[ "${REQUEST_MODE}" == "wrapped" ]]; then
    payload=$(python3 - <<'PY'
import json
import os
with open(os.environ['GARAGA_CONTEXT_PATH'], 'r') as f:
    ctx = json.load(f)
print(json.dumps({"context": ctx}))
PY
)
    response=$(
      curl -sS --fail --max-time "${TIMEOUT_SECS}" \
        -H "Content-Type: application/json" \
        ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
        -X POST "${GARAGA_NOIR_PROVER_URL}" \
        --data "${payload}"
    )
  else
    response=$(
      curl -sS --fail --max-time "${TIMEOUT_SECS}" \
        -H "Content-Type: application/json" \
        ${AUTH_HEADER:+-H "$AUTH_HEADER"} \
        -X POST "${GARAGA_NOIR_PROVER_URL}" \
        --data-binary @"${GARAGA_CONTEXT_PATH}"
    )
  fi

  python3 - <<'PY'
import base64
import json
import os
import sys

raw = sys.stdin.read().strip()
if not raw:
    print("Empty response from GARAGA_NOIR_PROVER_URL", file=sys.stderr)
    sys.exit(1)

try:
    resp = json.loads(raw)
except Exception as exc:
    print(f"Invalid JSON from GARAGA_NOIR_PROVER_URL: {exc}", file=sys.stderr)
    sys.exit(1)

if isinstance(resp, dict) and isinstance(resp.get("data"), dict):
    resp = resp["data"]

if isinstance(resp, dict) and resp.get("error"):
    print(f"Remote prover error: {resp.get('error')}", file=sys.stderr)
    sys.exit(1)

def pick(obj, keys):
    for key in keys:
        if isinstance(obj, dict) and key in obj:
            return obj[key]
    return None

def decode_blob(value, label):
    if isinstance(value, list) and all(isinstance(v, int) for v in value):
        return bytes(value)
    if isinstance(value, str):
        trimmed = value.strip()
        if trimmed.startswith("0x"):
            try:
                return bytes.fromhex(trimmed[2:])
            except Exception:
                pass
        for decoder in ("base64", "hex"):
            try:
                if decoder == "base64":
                    return base64.b64decode(trimmed, validate=True)
                return bytes.fromhex(trimmed)
            except Exception:
                continue
    raise ValueError(f"Unsupported {label} format from remote prover")

proof_raw = pick(resp, ["proof", "proof_base64", "proof_b64", "proof_bytes"])
public_inputs_raw = pick(resp, ["public_inputs", "public_inputs_base64", "public_inputs_b64", "public_inputs_bytes"])

if proof_raw is None or public_inputs_raw is None:
    print("Remote prover response missing proof/public_inputs", file=sys.stderr)
    sys.exit(1)

proof_bytes = decode_blob(proof_raw, "proof")
public_inputs_bytes = decode_blob(public_inputs_raw, "public_inputs")

proof_path = os.environ["GARAGA_PROOF_PATH"]
public_inputs_path = os.environ["GARAGA_PUBLIC_INPUTS_PATH"]

os.makedirs(os.path.dirname(proof_path), exist_ok=True)
os.makedirs(os.path.dirname(public_inputs_path), exist_ok=True)

with open(proof_path, "wb") as f:
    f.write(proof_bytes)
with open(public_inputs_path, "wb") as f:
    f.write(public_inputs_bytes)
PY
<<<"${response}"

  exit 0
fi

FLOW=$(
  python3 - <<'PY'
import json, os
with open(os.environ['GARAGA_CONTEXT_PATH'], 'r') as f:
    ctx = json.load(f)
flow = ''
if isinstance(ctx, dict):
    tx = ctx.get('tx_context') or {}
    if isinstance(tx, dict):
        flow = (tx.get('flow') or tx.get('action_type') or '').strip().lower()
print(flow)
PY
)

if [[ -z "${FLOW}" ]]; then
  echo "Missing tx_context.flow for Noir prover" >&2
  exit 1
fi

case "${FLOW}" in
  swap|bridge)
    CIRCUIT="carel_swap"
    ;;
  limit|limit_order|limit-order)
    CIRCUIT="carel_limit"
    ;;
  stake)
    CIRCUIT="carel_stake"
    ;;
  btc|shadow_btc|shadow-btc)
    CIRCUIT="shadow_btc"
    ;;
  *)
    echo "Unsupported flow for Noir prover: ${FLOW}" >&2
    exit 1
    ;;
 esac

CIRCUITS_DIR=${GARAGA_NOIR_CIRCUITS_DIR:-"../smartcontract/starknet/garaga/circuits"}
if [[ "${CIRCUITS_DIR}" != /* ]]; then
  CIRCUITS_DIR="$(cd "${PROJECT_ROOT}" && cd "${CIRCUITS_DIR}" && pwd)"
fi
CIRCUIT_DIR="${CIRCUITS_DIR}/${CIRCUIT}"
if [[ ! -d "${CIRCUIT_DIR}" ]]; then
  echo "Circuit dir not found: ${CIRCUIT_DIR}" >&2
  exit 1
fi

stage_circuits_dir() {
  local source_dir="$1"
  local run_root
  local staged_dir

  run_root="$(mktemp -d "${TMP_ROOT}/${CIRCUIT}.XXXXXX")"
  staged_dir="${run_root}/circuits"
  mkdir -p "${staged_dir}"
  cp -a "${source_dir}/." "${staged_dir}/"
  echo "${staged_dir}"
}

if should_prefer_tmp_paths "${CIRCUITS_DIR}"; then
  CIRCUITS_DIR="$(stage_circuits_dir "${CIRCUITS_DIR}")"
  CIRCUIT_DIR="${CIRCUITS_DIR}/${CIRCUIT}"
fi

# NOTE:
# Current nargo runtime in this environment resolves witness inputs from `Prover.toml`
# even when `--prover-name` is passed. Keep writing `Prover.auto.toml` for inspection,
# but also overwrite the canonical `Prover.toml` that `nargo execute` actually consumes.
PROVER_NAME="Prover"
PROVER_PATH="${CIRCUIT_DIR}/${PROVER_NAME}.toml"
PROVER_DEBUG_PATH="${CIRCUIT_DIR}/Prover.auto.toml"
export CIRCUIT
export PROVER_PATH
export PROVER_DEBUG_PATH

python3 - <<'PY'
import json
import os
import sys

def to_felt(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return str(int(value))
    if isinstance(value, str):
        raw = value.strip()
        if raw.startswith('0x') or raw.isdigit():
            return raw
        # encode ascii to felt-style hex
        return '0x' + raw.encode().hex()
    return str(value)

def normalize_value(value):
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return value
    return to_felt(value)

ctx_path = os.environ['GARAGA_CONTEXT_PATH']
with open(ctx_path, 'r') as f:
    ctx = json.load(f)

if not isinstance(ctx, dict):
    print('GARAGA_CONTEXT_PATH must be JSON object', file=sys.stderr)
    sys.exit(1)

tx = ctx.get('tx_context') or {}
if not isinstance(tx, dict):
    tx = {}

inputs = tx.get('noir_inputs') or tx.get('noirInputs') or {}
if not isinstance(inputs, dict):
    inputs = {}

ctx_inputs = ctx.get('noir_inputs') or ctx.get('noirInputs') or {}
if isinstance(ctx_inputs, dict):
    if not inputs:
        inputs = dict(ctx_inputs)
    else:
        for key, value in ctx_inputs.items():
            if key not in inputs:
                inputs[key] = value

circuit = os.environ['CIRCUIT']

# Authoritative statement fields from tx_context for public inputs / executor binding.
# These must override any stale noir_inputs cached on the client.
statement_overrides = {
    'merkle_root': tx.get('root'),
    'root': tx.get('root'),
    'nullifier': tx.get('nullifier'),
    'action_hash': tx.get('action_hash') or tx.get('intent_hash') or ctx.get('action_hash') or ctx.get('intent_hash'),
    'chain_id': tx.get('chain_id') or tx.get('chainId') or os.environ.get('GARAGA_CHAIN_ID') or os.environ.get('STARKNET_CHAIN_ID'),
    'contract_address': tx.get('contract_address') or tx.get('pool_address') or tx.get('shielded_pool_address') or tx.get('executor_address')
        or os.environ.get('PRIVATE_ACTION_EXECUTOR_ADDRESS') or os.environ.get('SHIELDED_POOL_V4_ADDRESS') or os.environ.get('HIDE_BALANCE_POOL_ADDRESS'),
    'block_merkle_root': tx.get('block_merkle_root') or tx.get('blockRoot'),
    'block_hash': tx.get('block_hash') or tx.get('blockHash'),
}

for key, value in statement_overrides.items():
    if value is not None:
        inputs[key] = normalize_value(value)

# Optional recipient remains caller-controlled unless tx_context explicitly sets it.
recipient_override = tx.get('recipient')
if recipient_override is not None:
    inputs['recipient'] = normalize_value(recipient_override)

# Flow-specific authoritative overrides from tx_context/action context.
flow_overrides = {}
if circuit == 'carel_swap':
    flow_overrides = {
        'swap_token_in': tx.get('approval_token') or tx.get('from_token') or tx.get('fromToken'),
        'swap_token_out': tx.get('payout_token') or tx.get('to_token') or tx.get('toToken'),
        'amount_in': tx.get('approval_amount_low') or tx.get('amount_in') or tx.get('amountIn') or tx.get('amount'),
        'min_amount_out': tx.get('min_payout_low') or tx.get('min_amount_out') or tx.get('minAmountOut') or tx.get('min_payout') or tx.get('minPayout'),
        'target_dex': tx.get('action_target') or tx.get('target_dex') or tx.get('targetDex') or tx.get('swap_contract') or tx.get('swap_router') or tx.get('router'),
    }
elif circuit == 'carel_limit':
    flow_overrides = {
        'swap_token_in': tx.get('approval_token') or tx.get('from_token') or tx.get('fromToken'),
        'swap_token_out': tx.get('payout_token') or tx.get('to_token') or tx.get('toToken'),
        'amount_in': tx.get('approval_amount_low') or tx.get('amount_in') or tx.get('amountIn') or tx.get('amount'),
        'min_amount_out': tx.get('min_payout_low') or tx.get('min_amount_out') or tx.get('minAmountOut') or tx.get('min_payout') or tx.get('minPayout'),
        'target_dex': tx.get('action_target') or tx.get('target_dex') or tx.get('targetDex') or tx.get('swap_contract') or tx.get('swap_router') or tx.get('router'),
    }
elif circuit == 'carel_stake':
    flow_overrides = {
        'stake_token': tx.get('approval_token') or tx.get('stake_token') or tx.get('stakeToken') or tx.get('from_token') or tx.get('token'),
        'stake_amount': tx.get('approval_amount_low') or tx.get('stake_amount') or tx.get('stakeAmount') or tx.get('amount'),
        'min_yield_token': tx.get('payout_token') or tx.get('min_yield_token') or tx.get('minYieldToken'),
        'target_protocol': tx.get('action_target') or tx.get('target_protocol') or tx.get('targetProtocol') or tx.get('protocol'),
    }

for key, value in flow_overrides.items():
    if value is not None:
        inputs[key] = normalize_value(value)
required = {
    'carel_swap': [
        'note_secret','note_amount','note_token',
        'merkle_path','merkle_index',
        'swap_token_in','swap_token_out','amount_in','min_amount_out','target_dex',
        'merkle_root','nullifier','action_hash','recipient','chain_id','contract_address',
    ],
    'carel_limit': [
        'note_secret','note_amount','note_token',
        'merkle_path','merkle_index',
        'swap_token_in','swap_token_out','amount_in','min_amount_out','condition_type','trigger_price','price_oracle','target_dex',
        'merkle_root','nullifier','action_hash','recipient','chain_id','contract_address',
    ],
    'carel_stake': [
        'note_secret','note_amount','note_token',
        'merkle_path','merkle_index',
        'target_protocol','stake_token','stake_amount','min_yield_token','lock_duration','expected_apy_bps',
        'merkle_root','nullifier','action_hash','recipient','chain_id','contract_address',
    ],
    'shadow_btc': [
        'note_secret','amount_satoshi','note_token','txid',
        'merkle_path','merkle_index',
        'block_merkle_root','block_hash',
        'root','nullifier','action_hash','recipient','chain_id','contract_address','commitment',
    ],
}

req = required.get(circuit, [])

def alias_pick(key, aliases):
    if key in inputs:
        return
    for alias in aliases:
        value = None
        if isinstance(tx, dict) and alias in tx:
            value = tx.get(alias)
        if value is None and isinstance(ctx, dict) and alias in ctx:
            value = ctx.get(alias)
        if value is None:
            continue
        if key == 'min_amount_out' and isinstance(value, str) and ':' in value:
            value = value.split(':')[0]
        inputs[key] = normalize_value(value)
        return

# Generic aliases for common fields
alias_pick('note_secret', ['note_secret','noteSecret'])
alias_pick('note_amount', ['note_amount','noteAmount'])
alias_pick('note_token', ['note_token','noteToken','token'])
alias_pick('merkle_path', ['merkle_path','merklePath'])
alias_pick('merkle_index', ['merkle_index','merkleIndex'])
alias_pick('commitment', ['commitment','note_commitment','noteCommitment'])
alias_pick('amount_satoshi', ['amount_satoshi','amountSatoshi','amount_sats','amountSats'])
alias_pick('txid', ['txid','txId','btc_txid','btcTxid'])

if circuit == 'carel_swap':
    alias_pick('swap_token_in', ['swap_token_in','swapTokenIn','from_token','fromToken','token_in'])
    alias_pick('swap_token_out', ['swap_token_out','swapTokenOut','to_token','toToken','token_out'])
    alias_pick('amount_in', ['amount_in','amountIn','amount'])
    alias_pick('min_amount_out', ['min_amount_out','minAmountOut','min_output','minOutput','min_payout','minPayout'])
    alias_pick('target_dex', ['target_dex','targetDex','dex','router','action_target','swap_contract','swap_router'])
elif circuit == 'carel_limit':
    alias_pick('swap_token_in', ['swap_token_in','swapTokenIn','from_token','fromToken','token_in'])
    alias_pick('swap_token_out', ['swap_token_out','swapTokenOut','to_token','toToken','token_out'])
    alias_pick('amount_in', ['amount_in','amountIn','amount'])
    alias_pick('min_amount_out', ['min_amount_out','minAmountOut','min_output','minOutput','min_payout','minPayout'])
    alias_pick('target_dex', ['target_dex','targetDex','dex','router','action_target','swap_contract','swap_router'])
    alias_pick('condition_type', ['condition_type','conditionType','condition'])
    alias_pick('trigger_price', ['trigger_price','triggerPrice','price'])
    alias_pick('price_oracle', ['price_oracle','priceOracle','oracle'])
elif circuit == 'carel_stake':
    alias_pick('target_protocol', ['target_protocol','targetProtocol','protocol'])
    alias_pick('stake_token', ['stake_token','stakeToken','from_token','fromToken','token'])
    alias_pick('stake_amount', ['stake_amount','stakeAmount','amount'])
    alias_pick('min_yield_token', ['min_yield_token','minYieldToken','yield_token','yieldToken'])
    alias_pick('lock_duration', ['lock_duration','lockDuration','lock_duration_secs','lockDurationSecs'])
    alias_pick('expected_apy_bps', ['expected_apy_bps','expectedApyBps','apy_bps','apyBps'])

missing = [k for k in req if k not in inputs or inputs[k] in (None, '', [])]
if missing:
    print('Missing noir_inputs keys: ' + ', '.join(missing), file=sys.stderr)
    print('Provide tx_context.noir_inputs (or tx_context fields with matching names) for V4/Noir proofs.', file=sys.stderr)
    sys.exit(1)

prover_path = os.environ['PROVER_PATH']

def toml_value(val):
    if isinstance(val, bool):
        return 'true' if val else 'false'
    if isinstance(val, (int, float)):
        return str(int(val))
    if isinstance(val, str):
        return '"' + val.replace('"', '\\"') + '"'
    if isinstance(val, list):
        return '[' + ', '.join(toml_value(v) for v in val) + ']'
    return '"' + str(val) + '"'

rendered = ''.join(f"{key} = {toml_value(inputs[key])}\n" for key in req)

with open(prover_path, 'w') as f:
    f.write(rendered)

debug_path = os.environ.get('PROVER_DEBUG_PATH', '').strip()
if debug_path:
    with open(debug_path, 'w') as f:
        f.write(rendered)
PY

NARGO_BIN=${GARAGA_NOIR_NARGO_BIN:-"/home/frend/.nargo/bin/nargo"}
BB_BIN=${GARAGA_BB_BIN:-"/home/frend/.bb/bb"}

if [[ ! -x "${NARGO_BIN}" ]]; then
  echo "nargo not found: ${NARGO_BIN}" >&2
  exit 1
fi
if [[ ! -x "${BB_BIN}" ]]; then
  echo "bb not found: ${BB_BIN}" >&2
  exit 1
fi

bool_env() {
  local raw="${1:-}"
  raw="$(printf '%s' "${raw}" | tr '[:upper:]' '[:lower:]')"
  [[ "${raw}" == "1" || "${raw}" == "true" || "${raw}" == "yes" || "${raw}" == "on" ]]
}

USE_PREBUILT_WITNESS="${GARAGA_USE_PREBUILT_WITNESS:-}"
PREBUILT_WITNESS_PATH="${GARAGA_PREBUILT_WITNESS_PATH:-target/${CIRCUIT}.gz}"
PREBUILT_VK_PATH="${GARAGA_PREBUILT_VK_PATH:-target/vk/vk}"

if bool_env "${USE_PREBUILT_WITNESS}"; then
  OUT_DIR=$(dirname "${GARAGA_PROOF_PATH}")
  mkdir -p "${OUT_DIR}"

  (
    cd "${CIRCUIT_DIR}"
    if [[ ! -f "${PREBUILT_WITNESS_PATH}" ]]; then
      echo "Prebuilt witness not found: ${CIRCUIT_DIR}/${PREBUILT_WITNESS_PATH}" >&2
      exit 1
    fi

    if [[ -f "${PREBUILT_VK_PATH}" ]]; then
      "${BB_BIN}" prove \
        -s ultra_honk \
        --oracle_hash keccak \
        -k "${PREBUILT_VK_PATH}" \
        --vk_policy check \
        -b "target/${CIRCUIT}.json" \
        -w "${PREBUILT_WITNESS_PATH}" \
        -o "${OUT_DIR}"
    else
      "${BB_BIN}" prove \
        -s ultra_honk \
        --oracle_hash keccak \
        --write_vk \
        -b "target/${CIRCUIT}.json" \
        -w "${PREBUILT_WITNESS_PATH}" \
        -o "${OUT_DIR}"
    fi
  )

  cp "${OUT_DIR}/proof" "${GARAGA_PROOF_PATH}"
  cp "${OUT_DIR}/public_inputs" "${GARAGA_PUBLIC_INPUTS_PATH}"
  exit 0
fi

(
  cd "${CIRCUIT_DIR}"
  "${NARGO_BIN}" execute --prover-name "${PROVER_NAME}"
)

OUT_DIR=$(dirname "${GARAGA_PROOF_PATH}")
mkdir -p "${OUT_DIR}"

(
  cd "${CIRCUIT_DIR}"
  "${BB_BIN}" prove -s ultra_honk --oracle_hash keccak --write_vk -b "target/${CIRCUIT}.json" -w "target/${CIRCUIT}.gz" -o "${OUT_DIR}"
)

cp "${OUT_DIR}/proof" "${GARAGA_PROOF_PATH}"
cp "${OUT_DIR}/public_inputs" "${GARAGA_PUBLIC_INPUTS_PATH}"
