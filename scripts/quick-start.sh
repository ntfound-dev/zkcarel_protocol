#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend-rust"
FRONTEND_DIR="$ROOT_DIR/frontend"
RUN_DIR="$ROOT_DIR/.run"
BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"
BACKEND_LOG="$RUN_DIR/backend.log"
FRONTEND_LOG="$RUN_DIR/frontend.log"

mkdir -p "$RUN_DIR"

if ! command -v cargo >/dev/null 2>&1; then
  echo "[quick-start] cargo not found. Install Rust first."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[quick-start] npm not found. Install Node.js first."
  exit 1
fi

if command -v pg_isready >/dev/null 2>&1; then
  if ! pg_isready >/dev/null 2>&1; then
    echo "[quick-start] PostgreSQL is not ready. Start it first."
    echo "  Example: sudo service postgresql start"
    exit 1
  fi
else
  echo "[quick-start] pg_isready not found. Skipping PostgreSQL precheck."
fi

if command -v redis-cli >/dev/null 2>&1; then
  if ! redis-cli ping >/dev/null 2>&1; then
    echo "[quick-start] Redis is not ready. Start it first."
    echo "  Example: sudo service redis-server start"
    exit 1
  fi
else
  echo "[quick-start] redis-cli not found. Skipping Redis precheck."
fi

if [[ ! -f "$BACKEND_DIR/.env" ]]; then
  echo "[quick-start] Missing backend-rust/.env"
  exit 1
fi

if [[ ! -f "$FRONTEND_DIR/.env.local" && ! -f "$FRONTEND_DIR/.env" ]]; then
  echo "[quick-start] Missing frontend .env (.env.local or .env)"
  exit 1
fi

if [[ -f "$BACKEND_PID_FILE" ]]; then
  old_pid="$(cat "$BACKEND_PID_FILE" || true)"
  if [[ -n "${old_pid:-}" ]] && kill -0 "$old_pid" >/dev/null 2>&1; then
    echo "[quick-start] Backend already running (pid=$old_pid)"
  fi
fi

if [[ -f "$FRONTEND_PID_FILE" ]]; then
  old_pid="$(cat "$FRONTEND_PID_FILE" || true)"
  if [[ -n "${old_pid:-}" ]] && kill -0 "$old_pid" >/dev/null 2>&1; then
    echo "[quick-start] Frontend already running (pid=$old_pid)"
  fi
fi

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  echo "[quick-start] Installing frontend dependencies..."
  (cd "$FRONTEND_DIR" && npm install)
fi

echo "[quick-start] Starting backend..."
(
  cd "$BACKEND_DIR"
  cargo run >"$BACKEND_LOG" 2>&1
) &
BACKEND_PID=$!
echo "$BACKEND_PID" >"$BACKEND_PID_FILE"

echo "[quick-start] Starting frontend..."
(
  cd "$FRONTEND_DIR"
  npm run dev >"$FRONTEND_LOG" 2>&1
) &
FRONTEND_PID=$!
echo "$FRONTEND_PID" >"$FRONTEND_PID_FILE"

sleep 5

echo "[quick-start] Done."
echo "  Frontend: http://localhost:3000"
echo "  Backend : http://localhost:8080"
echo "  Logs:"
echo "    $BACKEND_LOG"
echo "    $FRONTEND_LOG"
echo
echo "Use: ./scripts/quick-stop.sh"
