#!/usr/bin/env python3
"""
Garaga auto prover bridge for backend `/api/v1/privacy/auto-submit`.

Modes:
- default: bridge mode (stdin JSON -> stdout payload JSON)
- --prove: execute real prover command that writes proof/public inputs files
- --test: run two sample payloads and ensure proof is not static
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
import shlex
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

STARKNET_PRIME = (1 << 251) + (17 << 192) + 1


def fail(message: str, code: int = 1) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(code)


def warn(message: str) -> None:
    print(f"[garaga-auto-prover] {message}", file=sys.stderr)


def getenv_required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        fail(f"Missing required env: {name}")
    return value


def parse_stdin_payload() -> dict[str, Any]:
    raw = sys.stdin.read().strip()
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        fail(f"Invalid stdin JSON: {exc}")
    if not isinstance(value, dict):
        fail("stdin JSON must be an object")
    return value


def run_shell(
    command: str,
    timeout_secs: int,
    extra_env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    if extra_env:
        env.update(extra_env)
    try:
        return subprocess.run(
            ["bash", "-lc", command],
            text=True,
            capture_output=True,
            timeout=timeout_secs,
            env=env,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        fail(f"Command timeout ({timeout_secs}s): {command}\n{exc}")
    except OSError as exc:
        fail(f"Failed to run command: {command}\n{exc}")


def to_hex_felt(value: Any) -> str:
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            fail("Empty felt string encountered")
        if raw.lower().startswith("0x"):
            intval = int(raw, 16)
        else:
            intval = int(raw, 10)
    elif isinstance(value, int):
        intval = value
    else:
        fail(f"Unsupported felt type: {type(value).__name__}")
    intval %= STARKNET_PRIME
    return hex(intval)


def parse_json_array_file(path: Path, expected_key: str | None = None) -> list[str]:
    if not path.exists():
        fail(f"File not found: {path}")
    try:
        obj = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        fail(f"Invalid JSON in {path}: {exc}")

    payload: Any
    if isinstance(obj, list):
        payload = obj
    elif isinstance(obj, dict):
        if expected_key and expected_key in obj:
            payload = obj[expected_key]
        elif "public_inputs" in obj:
            payload = obj["public_inputs"]
        elif "proof" in obj:
            payload = obj["proof"]
        else:
            fail(f"JSON object in {path} does not contain expected array field")
    else:
        fail(f"JSON in {path} must be array or object")

    if not isinstance(payload, list) or not payload:
        fail(f"Array in {path} is empty or invalid")
    return [to_hex_felt(item) for item in payload]


def _looks_like_groth16_proof_dict(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    keys = {str(key).strip().lower() for key in value.keys()}
    has_a = "a" in keys or "pi_a" in keys or "ar" in keys
    has_b = "b" in keys or "pi_b" in keys or "bs" in keys
    has_c = "c" in keys or "pi_c" in keys or "krs" in keys
    return has_a and has_b and has_c


def validate_proof_json_file(path: Path) -> None:
    if not path.exists():
        fail(f"File not found: {path}")
    try:
        obj = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        fail(f"Invalid JSON in {path}: {exc}")

    # Legacy bridge format: direct array or object field that already contains felt array.
    if isinstance(obj, list) and obj:
        return
    if isinstance(obj, dict):
        proof_value = obj.get("proof")
        if isinstance(proof_value, list) and proof_value:
            return
        # Real Groth16 JSON formats (snarkjs/gnark-like) consumed by `garaga calldata`.
        if _looks_like_groth16_proof_dict(obj):
            return
        if _looks_like_groth16_proof_dict(proof_value):
            return
    fail(
        "Unsupported proof JSON format. Expected felt-array format or a Groth16 proof object "
        f"(snarkjs/gnark style). file={path}"
    )


def parse_index(name: str, default: int) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        parsed = int(raw)
    except ValueError:
        fail(f"Invalid integer env {name}={raw!r}")
    if parsed < 0:
        fail(f"{name} must be >= 0")
    return parsed


def bind_nullifier_commitment_from_public_inputs(public_inputs: list[str]) -> tuple[str, str]:
    nullifier_idx = parse_index("GARAGA_NULLIFIER_PUBLIC_INPUT_INDEX", 0)
    commitment_idx = parse_index("GARAGA_COMMITMENT_PUBLIC_INPUT_INDEX", 1)
    required_len = max(nullifier_idx, commitment_idx) + 1
    if len(public_inputs) < required_len:
        fail(
            "public_inputs too short to bind nullifier/commitment: "
            f"len={len(public_inputs)}, required>={required_len}, "
            f"nullifier_idx={nullifier_idx}, commitment_idx={commitment_idx}"
        )
    nullifier = to_hex_felt(public_inputs[nullifier_idx])
    commitment = to_hex_felt(public_inputs[commitment_idx])
    return nullifier, commitment


def bool_env(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _tx_field(tx_context: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = tx_context.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def compute_intent_hash(stdin_payload: dict[str, Any]) -> tuple[str, str]:
    tx_context_raw = stdin_payload.get("tx_context")
    tx_context = tx_context_raw if isinstance(tx_context_raw, dict) else {}
    flow = _tx_field(tx_context, "flow", "action_type").lower()
    user_address = str(stdin_payload.get("user_address", "")).strip().lower()
    nonce = _tx_field(tx_context, "nonce")
    if not nonce:
        nonce = str(stdin_payload.get("requested_at_unix", "")).strip()
    if not nonce:
        nonce = str(time.time_ns())

    if flow == "swap":
        preimage = [
            user_address,
            _tx_field(tx_context, "from_token"),
            _tx_field(tx_context, "to_token"),
            _tx_field(tx_context, "amount"),
            nonce,
        ]
    elif flow in {"limit", "limit_order", "limit-order"}:
        preimage = [
            user_address,
            _tx_field(tx_context, "from_token"),
            _tx_field(tx_context, "to_token"),
            _tx_field(tx_context, "amount"),
            _tx_field(tx_context, "price"),
            nonce,
        ]
    elif flow == "stake":
        token = _tx_field(tx_context, "token", "from_token")
        pool = _tx_field(tx_context, "pool")
        if not pool:
            pool = token
        preimage = [user_address, token, _tx_field(tx_context, "amount"), pool, nonce]
    else:
        preimage = [user_address, json.dumps(tx_context, sort_keys=True), nonce]

    digest = hashlib.sha256("|".join(preimage).encode("utf-8")).digest()
    intent_hash = to_hex_felt(int.from_bytes(digest, byteorder="big"))
    return intent_hash, nonce


def make_dynamic_binding(
    stdin_payload: dict[str, Any],
    intent_hash: str,
    nonce: str,
) -> tuple[str, str]:
    requested_at = str(stdin_payload.get("requested_at_unix", "")).strip()
    seed = f"{intent_hash}|{nonce}|{requested_at}|{stdin_payload.get('verifier', '')}"
    raw = seed.encode("utf-8")
    nullifier_hash = hashlib.sha256(raw + b":nullifier").digest()
    commitment_hash = hashlib.sha256(raw + b":commitment").digest()
    nullifier = to_hex_felt(int.from_bytes(nullifier_hash, byteorder="big"))
    commitment = to_hex_felt(int.from_bytes(commitment_hash, byteorder="big"))
    return nullifier, commitment


def apply_binding_to_public_inputs(
    public_inputs: list[str],
    nullifier: str,
    commitment: str,
) -> list[str]:
    nullifier_idx = parse_index("GARAGA_NULLIFIER_PUBLIC_INPUT_INDEX", 0)
    commitment_idx = parse_index("GARAGA_COMMITMENT_PUBLIC_INPUT_INDEX", 1)
    required_len = max(nullifier_idx, commitment_idx) + 1
    while len(public_inputs) < required_len:
        public_inputs.append("0x0")
    public_inputs[nullifier_idx] = to_hex_felt(nullifier)
    public_inputs[commitment_idx] = to_hex_felt(commitment)
    return public_inputs


@dataclass
class RedisQueueLease:
    redis_url: str
    key: str
    acquired: bool = False

    def release(self) -> None:
        if not self.acquired:
            return
        try:
            current = int(redis_cli(self.redis_url, ["DECR", self.key]).strip() or "0")
            if current <= 0:
                redis_cli(self.redis_url, ["DEL", self.key])
        except Exception:
            # Best-effort release. TTL handles stale slots.
            pass


def redis_cli(
    redis_url: str,
    args: list[str],
    timeout_secs: int = 5,
    hard_fail: bool = True,
) -> str:
    cmd = ["redis-cli", "--raw", "--no-auth-warning", "-u", redis_url, *args]
    try:
        proc = subprocess.run(
            cmd,
            text=True,
            capture_output=True,
            timeout=timeout_secs,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        if hard_fail:
            fail(f"redis-cli timeout: {' '.join(args)} ({exc})")
        warn(f"redis-cli timeout (ignored): {' '.join(args)} ({exc})")
        return ""
    except OSError as exc:
        if hard_fail:
            fail(f"Failed to run redis-cli: {exc}")
        warn(f"Failed to run redis-cli (ignored): {exc}")
        return ""
    if proc.returncode != 0:
        if hard_fail:
            fail(
                "Redis queue command failed.\n"
                f"command: {' '.join(args)}\n"
                f"stdout:\n{proc.stdout}\n"
                f"stderr:\n{proc.stderr}"
            )
        warn(
            "Redis queue command failed (ignored).\n"
            f"command: {' '.join(args)}\n"
            f"stdout:\n{proc.stdout}\n"
            f"stderr:\n{proc.stderr}"
        )
        return ""
    return proc.stdout


def acquire_prover_queue_slot(job_timeout_secs: int) -> RedisQueueLease:
    redis_url = os.getenv("GARAGA_REDIS_URL", "").strip() or os.getenv("REDIS_URL", "").strip()
    fail_open = bool_env("GARAGA_PROVER_QUEUE_FAIL_OPEN", True)
    if not redis_url:
        if fail_open:
            warn(
                "Redis queue disabled: REDIS_URL/GARAGA_REDIS_URL not set; "
                "continuing prover without queue lock."
            )
            return RedisQueueLease(redis_url="", key="", acquired=False)
        fail("Missing REDIS_URL (or GARAGA_REDIS_URL) for Garaga prover Redis queue.")

    max_concurrent = int(os.getenv("GARAGA_PROVER_MAX_CONCURRENT", "2").strip() or "2")
    queue_timeout_secs = int(os.getenv("GARAGA_PROVER_QUEUE_TIMEOUT_SECS", "30").strip() or "30")
    slot_ttl_default = max(job_timeout_secs + 30, 60)
    slot_ttl_secs = int(
        os.getenv("GARAGA_PROVER_QUEUE_SLOT_TTL_SECS", str(slot_ttl_default)).strip()
        or str(slot_ttl_default)
    )
    key = os.getenv("GARAGA_PROVER_QUEUE_KEY", "garaga:prover:active").strip() or "garaga:prover:active"

    lease = RedisQueueLease(redis_url=redis_url, key=key, acquired=False)
    deadline = time.monotonic() + queue_timeout_secs

    while True:
        incr_raw = redis_cli(
            redis_url,
            ["INCR", key],
            hard_fail=not fail_open,
        )
        if not incr_raw:
            warn("Redis queue unavailable; continuing prover without queue lock.")
            return RedisQueueLease(redis_url="", key="", acquired=False)
        try:
            current = int(incr_raw.strip() or "0")
        except ValueError:
            if fail_open:
                warn(
                    f"Invalid Redis INCR response {incr_raw!r}; continuing prover without queue lock."
                )
                return RedisQueueLease(redis_url="", key="", acquired=False)
            fail(f"Invalid Redis INCR response: {incr_raw!r}")
        expire_raw = redis_cli(
            redis_url,
            ["EXPIRE", key, str(slot_ttl_secs)],
            hard_fail=not fail_open,
        )
        if not expire_raw and fail_open:
            # Undo slot increment when TTL refresh fails, then continue without queue gating.
            redis_cli(redis_url, ["DECR", key], hard_fail=False)
            warn("Redis queue EXPIRE failed; continuing prover without queue lock.")
            return RedisQueueLease(redis_url="", key="", acquired=False)
        if current <= max_concurrent:
            lease.acquired = True
            return lease

        decr_raw = redis_cli(redis_url, ["DECR", key], hard_fail=not fail_open)
        if not decr_raw and fail_open:
            warn("Redis queue DECR failed; continuing prover without queue lock.")
            return RedisQueueLease(redis_url="", key="", acquired=False)
        if time.monotonic() >= deadline:
            fail(
                "Garaga prover queue timeout after "
                f"{queue_timeout_secs}s (max concurrent={max_concurrent})."
            )
        time.sleep(0.2)


def maybe_run_external_prover(
    prove_cmd: str | None,
    stdin_payload: dict[str, Any],
    output_dir: Path,
    proof_path: Path,
    public_inputs_path: Path | None,
    timeout_secs: int,
) -> None:
    if not prove_cmd:
        return

    output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as tmp:
        json.dump(stdin_payload, tmp)
        tmp.flush()
        context_path = tmp.name

    extra_env = {
        "GARAGA_CONTEXT_PATH": context_path,
        "GARAGA_OUTPUT_DIR": str(output_dir),
        "GARAGA_PROOF_PATH": str(proof_path),
        "GARAGA_QUEUE_SKIP": "1",
    }
    if public_inputs_path:
        extra_env["GARAGA_PUBLIC_INPUTS_PATH"] = str(public_inputs_path)

    lease: RedisQueueLease | None = None
    if not bool_env("GARAGA_QUEUE_SKIP", False):
        lease = acquire_prover_queue_slot(job_timeout_secs=timeout_secs)
    try:
        result = run_shell(prove_cmd, timeout_secs=timeout_secs, extra_env=extra_env)
    finally:
        if lease is not None:
            lease.release()

    if result.returncode != 0:
        fail(
            "GARAGA_PROVE_CMD failed.\n"
            f"command: {prove_cmd}\n"
            f"stdout:\n{result.stdout}\n"
            f"stderr:\n{result.stderr}"
        )


def generate_full_proof_with_hints(
    uvx_cmd: str,
    system: str,
    vk_path: Path,
    proof_path: Path,
    public_inputs_path: Path | None,
    timeout_secs: int,
) -> list[str]:
    parts = [
        uvx_cmd,
        "garaga calldata",
        f"--system {shlex.quote(system)}",
        f"--vk {shlex.quote(str(vk_path))}",
        f"--proof {shlex.quote(str(proof_path))}",
    ]
    if public_inputs_path:
        parts.append(f"--public-inputs {shlex.quote(str(public_inputs_path))}")
    parts.append("--format array")
    cmd = " ".join(parts)
    result = run_shell(cmd, timeout_secs=timeout_secs)
    if result.returncode != 0:
        fail(
            "Failed to run garaga calldata.\n"
            f"command: {cmd}\n"
            f"stdout:\n{result.stdout}\n"
            f"stderr:\n{result.stderr}"
        )
    raw = result.stdout.strip()
    if not raw:
        fail("garaga calldata returned empty stdout")
    try:
        values = ast.literal_eval(raw)
    except Exception as exc:  # noqa: BLE001
        fail(f"Unable to parse garaga calldata output as array: {exc}\nraw={raw[:200]}...")
    if not isinstance(values, list) or not values:
        fail("garaga calldata output is empty array")
    return [to_hex_felt(v) for v in values]


def resolve_public_inputs(public_inputs_path: Path | None, proof_path: Path) -> list[str]:
    if public_inputs_path:
        return parse_json_array_file(public_inputs_path, expected_key="public_inputs")

    try:
        return parse_json_array_file(proof_path, expected_key="public_inputs")
    except SystemExit:
        fail(
            "public_inputs not found. Set GARAGA_PUBLIC_INPUTS_PATH, or include public_inputs inside proof JSON."
        )
    return []


def maybe_load_precomputed_payload(path: Path | None) -> tuple[list[str], list[str]] | None:
    if path is None:
        return None
    proof = parse_json_array_file(path, expected_key="proof")
    public_inputs = parse_json_array_file(path, expected_key="public_inputs")
    return proof, public_inputs


def build_payload(stdin_payload: dict[str, Any]) -> dict[str, Any]:
    uvx_cmd = os.getenv("GARAGA_UVX_CMD", "uvx --python 3.10").strip()
    system = os.getenv("GARAGA_SYSTEM", "groth16").strip() or "groth16"
    timeout_secs = int(os.getenv("GARAGA_TIMEOUT_SECS", "45"))

    vk_raw = os.getenv("GARAGA_VK_PATH", "").strip()
    proof_raw = os.getenv("GARAGA_PROOF_PATH", "").strip()
    proof_path = (
        Path(proof_raw).expanduser()
        if proof_raw
        else Path("/tmp/garaga_auto_prover/proof.json")
    )
    public_inputs_raw = os.getenv("GARAGA_PUBLIC_INPUTS_PATH", "").strip()
    public_inputs_path = Path(public_inputs_raw).expanduser() if public_inputs_raw else None
    precomputed_payload_raw = os.getenv("GARAGA_PRECOMPUTED_PAYLOAD_PATH", "").strip()
    precomputed_payload_path = (
        Path(precomputed_payload_raw).expanduser() if precomputed_payload_raw else None
    )
    allow_precomputed_payload = bool_env("GARAGA_ALLOW_PRECOMPUTED_PAYLOAD", False)
    if precomputed_payload_path is not None and not allow_precomputed_payload:
        fail(
            "GARAGA_PRECOMPUTED_PAYLOAD_PATH is disabled in strict mode. "
            "Set GARAGA_PROVE_CMD for real per-request prover, "
            "or explicitly set GARAGA_ALLOW_PRECOMPUTED_PAYLOAD=true for developer mode."
        )
    precomputed_payload = maybe_load_precomputed_payload(precomputed_payload_path)

    prove_cmd = os.getenv("GARAGA_PROVE_CMD", "").strip()
    if not prove_cmd and precomputed_payload is None:
        fail(
            "Missing required env: GARAGA_PROVE_CMD. "
            "Real per-request prover is mandatory."
        )
    if not proof_raw and precomputed_payload is None:
        fail("Missing required env: GARAGA_PROOF_PATH")
    output_dir = Path(os.getenv("GARAGA_OUTPUT_DIR", "/tmp/garaga_auto_prover")).expanduser()
    if prove_cmd:
        maybe_run_external_prover(
            prove_cmd=prove_cmd,
            stdin_payload=stdin_payload,
            output_dir=output_dir,
            proof_path=proof_path,
            public_inputs_path=public_inputs_path,
            timeout_secs=timeout_secs,
        )

    if precomputed_payload is not None:
        proof, public_inputs = precomputed_payload
    else:
        if not vk_raw:
            fail("Missing required env: GARAGA_VK_PATH")
        vk_path = Path(vk_raw).expanduser()
        proof = generate_full_proof_with_hints(
            uvx_cmd=uvx_cmd,
            system=system,
            vk_path=vk_path,
            proof_path=proof_path,
            public_inputs_path=public_inputs_path,
            timeout_secs=timeout_secs,
        )
        public_inputs = resolve_public_inputs(
            public_inputs_path=public_inputs_path,
            proof_path=proof_path,
        )

    intent_hash, nonce = compute_intent_hash(stdin_payload)
    if bool_env("GARAGA_DYNAMIC_BINDING", False):
        nullifier, commitment = make_dynamic_binding(stdin_payload, intent_hash, nonce)
        public_inputs = apply_binding_to_public_inputs(public_inputs, nullifier, commitment)
    else:
        nullifier, commitment = bind_nullifier_commitment_from_public_inputs(public_inputs)

    return {
        "nullifier": nullifier,
        "commitment": commitment,
        "intent_hash": intent_hash,
        "proof": proof,
        "public_inputs": public_inputs,
    }


def run_prove_mode() -> None:
    real_cmd = resolve_real_prover_cmd(os.getenv("GARAGA_REAL_PROVER_CMD", "").strip())
    if not real_cmd:
        fail(
            "Missing GARAGA_REAL_PROVER_CMD for --prove mode. "
            "Configure real prover command to generate fresh proof files per request."
        )
    timeout_secs = int(os.getenv("GARAGA_REAL_PROVER_TIMEOUT_SECS", "45"))
    result = run_shell(real_cmd, timeout_secs=timeout_secs)
    if result.returncode != 0:
        fail(
            "GARAGA_REAL_PROVER_CMD failed.\n"
            f"command: {real_cmd}\n"
            f"stdout:\n{result.stdout}\n"
            f"stderr:\n{result.stderr}"
        )

    proof_path = Path(getenv_required("GARAGA_PROOF_PATH")).expanduser()
    public_inputs_path = Path(getenv_required("GARAGA_PUBLIC_INPUTS_PATH")).expanduser()
    validate_proof_json_file(proof_path)
    _ = parse_json_array_file(public_inputs_path, expected_key="public_inputs")

    sys.stdout.write(json.dumps({"ok": True}))


def run_warmup_mode() -> None:
    base_timeout_secs = int(os.getenv("GARAGA_TIMEOUT_SECS", "45"))
    warmup_timeout_raw = os.getenv("GARAGA_WARMUP_TIMEOUT_SECS", "").strip()
    if warmup_timeout_raw:
        timeout_secs = int(warmup_timeout_raw)
    else:
        timeout_secs = max(base_timeout_secs, 120)
    uvx_cmd = os.getenv("GARAGA_UVX_CMD", "uvx --python 3.10").strip()
    system = os.getenv("GARAGA_SYSTEM", "groth16").strip() or "groth16"
    vk_path = Path(getenv_required("GARAGA_VK_PATH")).expanduser()
    proof_path = Path(getenv_required("GARAGA_PROOF_PATH")).expanduser()
    public_inputs_raw = os.getenv("GARAGA_PUBLIC_INPUTS_PATH", "").strip()
    public_inputs_path = Path(public_inputs_raw).expanduser() if public_inputs_raw else None

    if not vk_path.exists():
        fail(f"GARAGA warmup skipped: VK not found at {vk_path}")
    validate_proof_json_file(proof_path)
    _ = resolve_public_inputs(public_inputs_path=public_inputs_path, proof_path=proof_path)

    calldata = generate_full_proof_with_hints(
        uvx_cmd=uvx_cmd,
        system=system,
        vk_path=vk_path,
        proof_path=proof_path,
        public_inputs_path=public_inputs_path,
        timeout_secs=timeout_secs,
    )
    sys.stdout.write(
        json.dumps(
            {
                "ok": True,
                "warmed": True,
                "proof_len": len(calldata),
            }
        )
    )


def resolve_real_prover_cmd(raw_cmd: str) -> str:
    cmd = raw_cmd.strip()
    if not cmd:
        return cmd

    fallback_candidates = [
        Path("./garaga-real-prover/prove.py"),
        Path("backend-rust/garaga-real-prover/prove.py"),
        Path("/app/garaga-real-prover/prove.py"),
    ]
    fallback_path = next(
        (str(candidate.resolve()) for candidate in fallback_candidates if candidate.is_file()),
        None,
    )

    def replace_path_if_missing(path_literal: str) -> None:
        nonlocal cmd
        if path_literal not in cmd:
            return
        if Path(path_literal).expanduser().is_file():
            return
        if not fallback_path:
            fail(
                "GARAGA_REAL_PROVER_CMD points to missing prover script path "
                f"'{path_literal}', and no local fallback was found. "
                "Set GARAGA_REAL_PROVER_CMD to a valid prove.py location."
            )
        print(
            f"[garaga-auto-prover] GARAGA_REAL_PROVER_CMD path '{path_literal}' not found; "
            f"using '{fallback_path}'",
            file=sys.stderr,
        )
        cmd = cmd.replace(path_literal, fallback_path)

    for bad_path in (
        "/PATH/ASLI/garaga-real-prover/prove.py",
        "/abs/path/to/garaga-real-prover/prove.py",
        "/opt/garaga-real-prover/prove.py",
        "./garaga-real-prover/prove.py",
        "backend-rust/garaga-real-prover/prove.py",
    ):
        replace_path_if_missing(bad_path)

    return cmd


def run_test_mode() -> None:
    sample_a = {
        "user_address": "0x111",
        "verifier": "garaga",
        "requested_at_unix": int(time.time()),
        "tx_context": {
            "flow": "swap",
            "from_token": "USDC",
            "to_token": "ETH",
            "amount": "100",
            "nonce": "n1",
        },
    }
    sample_b = {
        "user_address": "0x222",
        "verifier": "garaga",
        "requested_at_unix": int(time.time()) + 1,
        "tx_context": {
            "flow": "swap",
            "from_token": "USDC",
            "to_token": "ETH",
            "amount": "101",
            "nonce": "n2",
        },
    }

    payload_a = build_payload(sample_a)
    payload_b = build_payload(sample_b)
    same_proof = payload_a["proof"] == payload_b["proof"]
    if same_proof:
        fail(
            "Static proof detected in --test mode: proof arrays are identical for different inputs."
        )

    result = {
        "ok": True,
        "proof_a_len": len(payload_a["proof"]),
        "proof_b_len": len(payload_b["proof"]),
        "proof_a_sha256": hashlib.sha256(
            json.dumps(payload_a["proof"], separators=(",", ":")).encode("utf-8")
        ).hexdigest(),
        "proof_b_sha256": hashlib.sha256(
            json.dumps(payload_b["proof"], separators=(",", ":")).encode("utf-8")
        ).hexdigest(),
    }
    sys.stdout.write(json.dumps(result))


def main() -> None:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--prove", action="store_true")
    parser.add_argument("--test", action="store_true")
    parser.add_argument("--warmup", action="store_true")
    args, _unknown = parser.parse_known_args()

    if args.warmup:
        run_warmup_mode()
        return
    if args.prove:
        run_prove_mode()
        return
    if args.test:
        run_test_mode()
        return

    stdin_payload = parse_stdin_payload()
    payload = build_payload(stdin_payload)
    sys.stdout.write(json.dumps(payload))


if __name__ == "__main__":
    main()
