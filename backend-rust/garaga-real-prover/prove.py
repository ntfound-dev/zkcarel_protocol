#!/usr/bin/env python3
"""
Real Garaga prover entrypoint for zkcare.

This script wraps the local Rust prover binary:
`backend-rust/garaga-real-prover/target/release/garaga-real-prover`

Modes:
- setup: generate proving key + VK JSON (and optional sample proof/public-inputs)
- prove: generate fresh proof/public-input files for one context payload
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def run(cmd: list[str], cwd: Path) -> None:
    proc = subprocess.run(
        cmd,
        cwd=str(cwd),
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        fail(
            "Command failed.\n"
            f"cmd: {' '.join(cmd)}\n"
            f"stdout:\n{proc.stdout}\n"
            f"stderr:\n{proc.stderr}"
        )


def ensure_binary(project_dir: Path) -> Path:
    bin_path = project_dir / "target" / "release" / "garaga-real-prover"
    if not bin_path.is_file():
        run(["cargo", "build", "--release"], cwd=project_dir)
    if not bin_path.is_file():
        fail(f"Prover binary not found after build: {bin_path}")
    return bin_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--setup", action="store_true", help="Generate PK + VK")
    parser.add_argument("--context", help="Path to context JSON")
    parser.add_argument("--proof", help="Output proof JSON path")
    parser.add_argument("--public-inputs", dest="public_inputs", help="Output public inputs JSON path")
    parser.add_argument(
        "--pk",
        default=os.getenv("GARAGA_PROVING_KEY_PATH", "").strip(),
        help="Path to proving key binary (default: GARAGA_PROVING_KEY_PATH or backend-rust/garaga_proving_key.bin)",
    )
    parser.add_argument(
        "--vk",
        default=os.getenv("GARAGA_VK_PATH", "").strip(),
        help="Path to VK JSON output (setup mode only; default: GARAGA_VK_PATH or backend-rust/garaga_vk.json)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    project_dir = Path(__file__).resolve().parent
    backend_dir = project_dir.parent

    pk_path = (
        Path(args.pk).expanduser().resolve()
        if args.pk
        else (backend_dir / "garaga_proving_key.bin").resolve()
    )
    vk_path = (
        Path(args.vk).expanduser().resolve()
        if args.vk
        else (backend_dir / "garaga_vk.json").resolve()
    )

    bin_path = ensure_binary(project_dir)

    if args.setup:
        sample_proof = backend_dir / "garaga_proof_raw.json"
        sample_public = backend_dir / "garaga_public_inputs_raw.json"
        cmd = [
            str(bin_path),
            "setup",
            "--pk-out",
            str(pk_path),
            "--vk-out",
            str(vk_path),
            "--sample-proof-out",
            str(sample_proof),
            "--sample-public-inputs-out",
            str(sample_public),
        ]
        run(cmd, cwd=project_dir)
        print(
            f"setup complete\npk={pk_path}\nvk={vk_path}\n"
            f"sample_proof={sample_proof}\nsample_public_inputs={sample_public}"
        )
        return

    context = Path(args.context).expanduser().resolve() if args.context else None
    proof_out = Path(args.proof).expanduser().resolve() if args.proof else None
    public_out = (
        Path(args.public_inputs).expanduser().resolve() if args.public_inputs else None
    )

    if proof_out is None or public_out is None:
        fail("prove mode requires --proof and --public-inputs")
    if not pk_path.is_file():
        fail(
            "Proving key not found.\n"
            f"expected: {pk_path}\n"
            "Run setup first: python3 backend-rust/garaga-real-prover/prove.py --setup"
        )

    cmd = [
        str(bin_path),
        "prove",
        "--pk",
        str(pk_path),
        "--proof-out",
        str(proof_out),
        "--public-inputs-out",
        str(public_out),
    ]
    if context is not None:
        cmd.extend(["--context", str(context)])

    run(cmd, cwd=project_dir)


if __name__ == "__main__":
    main()
