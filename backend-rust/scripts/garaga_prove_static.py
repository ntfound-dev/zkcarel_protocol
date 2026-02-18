#!/usr/bin/env python3
"""
Real prover bridge command for GARAGA_PROVE_CMD.

This script delegates proof generation to GARAGA_REAL_PROVER_CMD on each request.
It does not generate proof by itself.

Required env:
- GARAGA_REAL_PROVER_CMD       shell command that MUST produce fresh files:
    - GARAGA_PROOF_PATH
    - GARAGA_PUBLIC_INPUTS_PATH
- GARAGA_PROOF_PATH            output proof JSON path
- GARAGA_PUBLIC_INPUTS_PATH    output public inputs JSON path

Optional env:
- GARAGA_CONTEXT_PATH          request context JSON from backend
- GARAGA_OUTPUT_DIR            output directory hint
- GARAGA_REAL_PROVER_TIMEOUT_SECS (default: 180)
"""

from __future__ import annotations

import os
import subprocess
import sys
import json
from pathlib import Path


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def getenv_required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        fail(f"Missing required env: {name}")
    return value


def validate_json_array_or_object(path: Path, label: str) -> None:
    if not path.is_file():
        fail(f"{label} output file not found: {path}")
    try:
        payload = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        fail(f"{label} output is not valid JSON: {path} ({exc})")
    if not isinstance(payload, (list, dict)):
        fail(f"{label} output must be JSON array/object: {path}")


def main() -> None:
    prove_cmd = getenv_required("GARAGA_REAL_PROVER_CMD")
    proof_out = Path(getenv_required("GARAGA_PROOF_PATH")).expanduser()
    pub_out = Path(getenv_required("GARAGA_PUBLIC_INPUTS_PATH")).expanduser()
    timeout_secs = int(os.getenv("GARAGA_REAL_PROVER_TIMEOUT_SECS", "180").strip() or "180")

    if proof_out.parent:
        proof_out.parent.mkdir(parents=True, exist_ok=True)
    if pub_out.parent:
        pub_out.parent.mkdir(parents=True, exist_ok=True)

    proc = subprocess.run(
        ["bash", "-lc", prove_cmd],
        text=True,
        capture_output=True,
        timeout=timeout_secs,
        env=os.environ.copy(),
        check=False,
    )
    if proc.returncode != 0:
        fail(
            "GARAGA_REAL_PROVER_CMD failed.\n"
            f"command: {prove_cmd}\n"
            f"stdout:\n{proc.stdout}\n"
            f"stderr:\n{proc.stderr}"
        )

    validate_json_array_or_object(proof_out, "proof")
    validate_json_array_or_object(pub_out, "public_inputs")


if __name__ == "__main__":
    main()
