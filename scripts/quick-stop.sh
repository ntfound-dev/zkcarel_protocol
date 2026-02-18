#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"
BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"

stop_pid_file() {
  local pid_file="$1"
  local name="$2"
  if [[ ! -f "$pid_file" ]]; then
    echo "[quick-stop] $name pid file not found."
    return
  fi
  local pid
  pid="$(cat "$pid_file" || true)"
  if [[ -z "${pid:-}" ]]; then
    echo "[quick-stop] $name pid file empty."
    rm -f "$pid_file"
    return
  fi
  if kill -0 "$pid" >/dev/null 2>&1; then
    kill "$pid" >/dev/null 2>&1 || true
    sleep 1
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
    echo "[quick-stop] Stopped $name (pid=$pid)"
  else
    echo "[quick-stop] $name already stopped (pid=$pid)"
  fi
  rm -f "$pid_file"
}

stop_pid_file "$BACKEND_PID_FILE" "backend"
stop_pid_file "$FRONTEND_PID_FILE" "frontend"

echo "[quick-stop] Done."
