# Backend Test Report

**Project:** CAREL Protocol Backend (`backend-rust`)
**Date:** February 25, 2026
**Command:** `cargo test`

## Summary
- Build profile: `test` (unoptimized + debuginfo)
- Compile result: success
- Collected tests: `188`
- Passed: `188`
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
- `test result: ok. 188 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out`

## Coverage Notes
Executed suites include:
- API modules (`ai`, `auth`, `bridge`, `swap`, `stake`, `limit_order`, `nft`, `portfolio`, etc.)
- Services (`ai_service`, `point_calculator`, `route_optimizer`, `event_indexer`, etc.)
- Indexer and Starknet client utilities
- Crypto helpers and signature validation
- WebSocket payload behavior

## Conclusion
Backend automated tests are healthy for this run: **188/188 passing**.

## Scope Note
- Report ini hanya untuk module backend (`backend-rust`).
- Frontend dan smartcontract punya report terpisah.

## Recommended Commands
```bash
# Full suite
cd /mnt/c/Users/frend/zkcare_protocol/backend-rust
cargo test

# Fast rerun
cargo test -q
```
