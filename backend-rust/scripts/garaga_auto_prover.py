#!/usr/bin/env python3
"""
Garaga auto prover bridge for backend `/api/v1/privacy/auto-submit`.

Input  (stdin JSON, from backend):
{
  "user_address": "0x...",
  "verifier": "garaga",
  "requested_at_unix": 1771390000,
  "tx_context": { ... }
}

Output (stdout JSON, consumed by backend):
{
  "nullifier": "0x...",
  "commitment": "0x...",
  "proof": ["0x...", "..."],          # full_proof_with_hints
  "public_inputs": ["0x...", "..."]
}

Environment:
- GARAGA_VK_PATH                (required)
- GARAGA_PROOF_PATH             (required)
- GARAGA_PUBLIC_INPUTS_PATH     (optional if proof json already contains public_inputs)
- GARAGA_UVX_CMD                (default: "uvx --python 3.10")
- GARAGA_SYSTEM                 (default: "groth16")
- GARAGA_TIMEOUT_SECS           (default: 45)
- GARAGA_PROVE_CMD              (required: run per-request to regenerate proof/public files)
                                Extra envs passed to this command:
                                GARAGA_CONTEXT_PATH, GARAGA_OUTPUT_DIR,
                                GARAGA_PROOF_PATH, GARAGA_PUBLIC_INPUTS_PATH
- GARAGA_PRECOMPUTED_PAYLOAD_PATH (optional; JSON containing proof/public_inputs.
                                   If set, skip `garaga calldata` and read payload directly.)
- GARAGA_ALLOW_PRECOMPUTED_PAYLOAD (default: false; must be true/1/yes to allow
                                    GARAGA_PRECOMPUTED_PAYLOAD_PATH in non-strict mode)
- GARAGA_DYNAMIC_BINDING         (default: false; generate fresh nullifier/commitment
                                  and overwrite binding slots in public_inputs.
                                  Useful for shared developer payload mode.)
- GARAGA_NULLIFIER_PUBLIC_INPUT_INDEX   (default: 0)
- GARAGA_COMMITMENT_PUBLIC_INPUT_INDEX  (default: 1)
"""

from __future__ import annotations

import ast
import hashlib
import json
import os
import secrets
import shlex
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

STARKNET_PRIME = (1 << 251) + (17 << 192) + 1


def fail(message: str, code: int = 1) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(code)


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


def run_shell(command: str, timeout_secs: int, extra_env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
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


def make_dynamic_binding(stdin_payload: dict[str, Any]) -> tuple[str, str]:
    seed = {
        "user_address": stdin_payload.get("user_address"),
        "verifier": stdin_payload.get("verifier"),
        "requested_at_unix": stdin_payload.get("requested_at_unix"),
        "nonce": secrets.token_hex(16),
        "time_ns": time.time_ns(),
    }
    raw = json.dumps(seed, sort_keys=True).encode("utf-8")
    nullifier_hash = hashlib.sha256(raw + b":nullifier").digest()
    commitment_hash = hashlib.sha256(raw + b":commitment").digest()
    nullifier = to_hex_felt(int.from_bytes(nullifier_hash[:16], byteorder="big"))
    commitment = to_hex_felt(int.from_bytes(commitment_hash[:16], byteorder="big"))
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
    }
    if public_inputs_path:
        extra_env["GARAGA_PUBLIC_INPUTS_PATH"] = str(public_inputs_path)

    result = run_shell(prove_cmd, timeout_secs=timeout_secs, extra_env=extra_env)
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

    # fallback: try from proof json if it includes public_inputs.
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


def main() -> None:
    stdin_payload = parse_stdin_payload()

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
    if bool_env("GARAGA_DYNAMIC_BINDING", False):
        nullifier, commitment = make_dynamic_binding(stdin_payload)
        public_inputs = apply_binding_to_public_inputs(public_inputs, nullifier, commitment)
    else:
        nullifier, commitment = bind_nullifier_commitment_from_public_inputs(public_inputs)

    payload = {
        "nullifier": nullifier,
        "commitment": commitment,
        "proof": proof,
        "public_inputs": public_inputs,
    }
    sys.stdout.write(json.dumps(payload))


if __name__ == "__main__":
    main()
