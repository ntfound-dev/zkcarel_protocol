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

stop_if_running() {
  local pid_file="$1"
  local name="$2"
  if [[ ! -f "$pid_file" ]]; then
    return
  fi

  local pid
  pid="$(cat "$pid_file" || true)"
  if [[ -z "${pid:-}" ]]; then
    rm -f "$pid_file"
    return
  fi

  if kill -0 "$pid" >/dev/null 2>&1; then
    echo "[quick-start] Restarting existing $name process (pid=$pid)"
    kill "$pid" >/dev/null 2>&1 || true
    sleep 1
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  fi
  rm -f "$pid_file"
}

stop_if_running "$BACKEND_PID_FILE" "backend"
stop_if_running "$FRONTEND_PID_FILE" "frontend"

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

if ! kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
  echo "[quick-start] Backend failed to start. See log: $BACKEND_LOG"
  tail -n 50 "$BACKEND_LOG" || true
  exit 1
fi

if ! kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
  echo "[quick-start] Frontend failed to start. See log: $FRONTEND_LOG"
  tail -n 50 "$FRONTEND_LOG" || true
  exit 1
fi

if command -v curl >/dev/null 2>&1; then
  if ! curl -fsS "http://127.0.0.1:8080/health" >/dev/null 2>&1; then
    echo "[quick-start] Warning: backend /health is not reachable yet (check $BACKEND_LOG)."
  fi
fi

echo "[quick-start] Done."
echo "  Frontend: http://localhost:3000"
echo "  Backend : http://localhost:8080"
echo "  Logs:"
echo "    $BACKEND_LOG"
echo "    $FRONTEND_LOG"
echo
echo "Use: ./scripts/quick-stop.sh"
