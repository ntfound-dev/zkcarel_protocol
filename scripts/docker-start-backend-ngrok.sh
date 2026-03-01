#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running. Start Docker Desktop first."
  exit 1
fi

echo "[1/3] Ensuring postgres + redis are running..."
docker compose up -d postgres redis

echo "[2/3] Starting backend container..."
docker compose up -d backend

echo "[3/3] Starting ngrok tunnel (profile: tunnel)..."
if [[ -z "${NGROK_AUTHTOKEN:-}" ]]; then
  echo "NGROK_AUTHTOKEN is empty in shell env."
  echo "If ngrok fails to connect, export token first:"
  echo "  export NGROK_AUTHTOKEN='YOUR_TOKEN'"
fi
docker compose --profile tunnel up -d ngrok

echo
echo "Services status:"
docker compose ps
echo
echo "Backend: http://localhost:8080"
echo "ngrok local UI: http://localhost:4040"
