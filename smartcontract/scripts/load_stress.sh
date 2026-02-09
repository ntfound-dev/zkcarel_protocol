#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEST_NAME="smartcontract_integrationtest::test_load_stress::test_ai_executor_burst_load"
RUNS="${1:-1}"

cd "$ROOT_DIR"

echo "Running load test: $TEST_NAME"
echo "Runs: $RUNS"

for i in $(seq 1 "$RUNS"); do
  echo "Run $i/$RUNS"
  snforge test "$TEST_NAME" --exact
done
