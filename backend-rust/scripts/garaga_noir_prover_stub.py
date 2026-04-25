#!/usr/bin/env python3
import argparse
import base64
import json
import os
import subprocess
import tempfile
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
DEFAULT_CMD = "bash scripts/garaga_noir_prover.sh"


def _json_response(handler, status, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class ProverHandler(BaseHTTPRequestHandler):
    server_version = "garaga-noir-prover-stub/0.1"

    def log_message(self, fmt, *args):
        # Keep logs concise; production services should use structured logging.
        return

    def do_GET(self):
        if self.path in ("/", "/health"):
            return _json_response(self, 200, {"ok": True})
        return _json_response(self, 404, {"error": "not found"})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else ""
            if not raw:
                return _json_response(self, 400, {"error": "empty body"})
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                return _json_response(self, 400, {"error": "invalid json"})

            if isinstance(payload, dict) and "context" in payload:
                context = payload.get("context")
            else:
                context = payload

            if not isinstance(context, dict):
                return _json_response(self, 400, {"error": "context must be a JSON object"})

            cmd = os.environ.get("GARAGA_NOIR_PROVER_CMD", DEFAULT_CMD)

            with tempfile.TemporaryDirectory() as tmp:
                tmp_path = Path(tmp)
                ctx_path = tmp_path / "context.json"
                proof_path = tmp_path / "proof.bin"
                public_inputs_path = tmp_path / "public_inputs.bin"
                ctx_path.write_text(json.dumps(context))

                env = os.environ.copy()
                env["GARAGA_CONTEXT_PATH"] = str(ctx_path)
                env["GARAGA_PROOF_PATH"] = str(proof_path)
                env["GARAGA_PUBLIC_INPUTS_PATH"] = str(public_inputs_path)
                # Avoid recursive calls back into this stub.
                env.pop("GARAGA_NOIR_PROVER_URL", None)
                env.pop("GARAGA_NOIR_PROVER_TOKEN", None)
                env.pop("GARAGA_NOIR_PROVER_AUTH", None)

                try:
                    subprocess.run(
                        cmd,
                        shell=True,
                        cwd=str(BACKEND_DIR),
                        env=env,
                        check=True,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                    )
                except subprocess.CalledProcessError as exc:
                    return _json_response(
                        self,
                        500,
                        {
                            "error": "prover failed",
                            "stdout": exc.stdout.decode("utf-8", "ignore"),
                            "stderr": exc.stderr.decode("utf-8", "ignore"),
                        },
                    )

                if not proof_path.exists() or not public_inputs_path.exists():
                    return _json_response(
                        self,
                        500,
                        {"error": "prover outputs missing"},
                    )

                proof_b64 = base64.b64encode(proof_path.read_bytes()).decode("utf-8")
                public_inputs_b64 = base64.b64encode(public_inputs_path.read_bytes()).decode("utf-8")

                return _json_response(
                    self,
                    200,
                    {"proof": proof_b64, "public_inputs": public_inputs_b64},
                )
        except Exception as exc:
            traceback.print_exc()
            try:
                return _json_response(
                    self,
                    500,
                    {"error": "stub exception", "detail": str(exc)},
                )
            except Exception:
                # If response fails, just drop the connection.
                return


def main():
    parser = argparse.ArgumentParser(description="Garaga Noir prover stub (JSON base64).")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()

    httpd = ThreadingHTTPServer((args.host, args.port), ProverHandler)
    print(f"[garaga-noir-prover-stub] listening on http://{args.host}:{args.port}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
