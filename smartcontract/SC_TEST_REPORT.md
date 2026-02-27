# Smart Contract Test Report

**Project:** CAREL Protocol Smart Contracts
**Date:** February 26, 2026
**Prepared by:** Local test run summary

## Scope
- `smartcontract/` (main package)
- `smartcontract/private_executor_lite/` (hide mode package)

## Environment
- Tooling: `scarb`, `snforge`
- Network: local test execution (no deployment required)

## Executive Summary
- Main package tests: **172/172 passed**
- `private_executor_lite` tests: **12/12 passed**
- No failing tests observed.

## Detailed Results
### 1) Main Package
Command:
```bash
cd /mnt/c/Users/frend/zkcare_protocol/smartcontract
scarb test
```
Result:
- Collected: `172 test(s)`
- Passed: `172`
- Failed: `0`

### 2) private_executor_lite
Command:
```bash
cd /mnt/c/Users/frend/zkcare_protocol/smartcontract
bash scripts/test_private_executor_lite.sh
```
Result:
- Collected: `12 test(s)`
- Passed: `12`
- Failed: `0`

## Recommended Canonical Commands
```bash
# Main package
cd /mnt/c/Users/frend/zkcare_protocol/smartcontract
scarb test

# private_executor_lite
bash scripts/test_private_executor_lite.sh

# Optional: Garaga verifier package
bash scripts/test_garaga_fast.sh
```

## Scope Note
- Report ini hanya untuk smartcontract package (`smartcontract` + `private_executor_lite`).
- Frontend dan backend punya report terpisah.
