# Consolidated Test Reports

## Backend
**Project:** CAREL Protocol Backend (`backend-rust`)
**Date:** March 5, 2026
**Command:** `cargo test`

### Summary
- Build profile: `test` (unoptimized + debuginfo)
- Compile result: success
- Collected tests (main suite): `208`
- Passed: `208`
- Failed: `0`
- Ignored: `0`
- Measured: `0`
- Filtered out: `0`
- Final status: **PASS**

### Execution Snapshot
```bash
cd /mnt/c/Users/frend/zkcare_protocol/backend-rust
cargo test
```

Observed tail:
- `running 208 tests`
- `test result: ok. 208 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out`

Notes:
- `src/bin/ai_e2e_tools.rs` has `0` tests and completed successfully.

### Coverage Notes
Executed suites include:
- API modules (`ai`, `auth`, `bridge`, `swap`, `stake`, `limit_order`, `nft`, `portfolio`, etc.)
- Services (`ai_service`, `point_calculator`, `route_optimizer`, `event_indexer`, etc.)
- Indexer and Starknet client utilities
- Crypto helpers and signature validation
- WebSocket payload behavior

### Conclusion
Backend automated tests are healthy for this run: **208/208 passing**.

### Recommended Commands
```bash
cd /mnt/c/Users/frend/zkcare_protocol/backend-rust
cargo test

cargo test -q
```

## Frontend
**Module:** `frontend`
**Date:** 2026-03-05

### Environment and Commands
#### Run A (existing system Node)
Environment:
- Node: `v18.19.1`
- npm: `9.2.0`

Commands:
```bash
npm run lint
npm run build
```

Results:
- `npm run lint`: **PASS** (warnings only, no errors)
- `npm run build`: **FAILED**

Key build output:
```text
You are using Node.js 18.19.1. For Next.js, Node.js version ">=20.9.0" is required.
```

#### Run B (required Node version)
Environment:
- Node: `v20.11.1`
- npm: `10.2.4`

Commands:
```bash
source ~/.nvm/nvm.sh
nvm install 20.11.1
nvm use 20.11.1
npm run lint
npm run build
```

Results:
- `npm run lint`: **PASS** (no warnings, no errors)
- `npm run build`: **PASS**

Key build output:
```text
Compiled successfully
Generating static pages ...
```

### Lint Summary
- ESLint completed with **0 errors** and **0 warnings**.

### Conclusion
- Frontend build is healthy on the required Node runtime (`>=20.9.0`), validated with Node `20.11.1`.
- Lint is clean under the current ESLint profile.

### Recommended Commands
```bash
cd /mnt/c/Users/frend/zkcare_protocol/frontend
source ~/.nvm/nvm.sh
nvm use 20.11.1
npm run lint
npm run build
```

## Smart Contracts
**Project:** CAREL Protocol Smart Contracts
**Date:** March 5, 2026
**Prepared by:** Local test run summary

### Scope
- `smartcontract/` (main package)
- `smartcontract/private_executor_lite/` (hide mode package)

### Environment
- Tooling: `scarb`, `snforge`
- Network: local test execution (no deployment required)

### Executive Summary
- Main package tests: **172/172 passed**
- `private_executor_lite` tests: **22/22 passed**
- No failing tests observed.

### Detailed Results
#### Main Package
Command:
```bash
cd /mnt/c/Users/frend/zkcare_protocol/smartcontract
scarb test
```

Result:
- Collected: `172 test(s)`
- Passed: `172`
- Failed: `0`

#### `private_executor_lite`
Command:
```bash
cd /mnt/c/Users/frend/zkcare_protocol/smartcontract
bash scripts/test_private_executor_lite.sh
```

Result:
- Collected: `22 test(s)`
- Passed: `22`
- Failed: `0`

### Recommended Commands
```bash
cd /mnt/c/Users/frend/zkcare_protocol/smartcontract
scarb test

bash scripts/test_private_executor_lite.sh

bash scripts/test_garaga_fast.sh
```
