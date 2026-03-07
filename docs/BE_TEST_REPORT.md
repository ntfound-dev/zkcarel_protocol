# Backend Test Report

**Project:** CAREL Protocol Backend (`backend-rust`)
**Date:** March 5, 2026
**Command:** `cargo test`

## Summary
- Build profile: `test` (unoptimized + debuginfo)
- Compile result: success
- Collected tests (main suite): `208`
- Passed: `208`
- Failed: `0`
- Ignored: `0`
- Measured: `0`
- Filtered out: `0`
- Final status: **PASS**

## Execution Snapshot
```bash
cd /mnt/c/Users/frend/zkcare_protocol/backend-rust
cargo test
```

Observed tail:
- `running 208 tests`
- `test result: ok. 208 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out`

Notes:
- `src/bin/ai_e2e_tools.rs` has `0` tests and completed successfully.

## Coverage Notes
Executed suites include:
- API modules (`ai`, `auth`, `bridge`, `swap`, `stake`, `limit_order`, `nft`, `portfolio`, etc.)
- Services (`ai_service`, `point_calculator`, `route_optimizer`, `event_indexer`, etc.)
- Indexer and Starknet client utilities
- Crypto helpers and signature validation
- WebSocket payload behavior

## Conclusion
Backend automated tests are healthy for this run: **208/208 passing**.

## Scope Note
- This report covers only the backend module (`backend-rust`).
- Frontend and smart contract modules have separate reports.

## Recommended Commands
```bash
# Full suite
cd /mnt/c/Users/frend/zkcare_protocol/backend-rust
cargo test

# Fast rerun
cargo test -q
```
