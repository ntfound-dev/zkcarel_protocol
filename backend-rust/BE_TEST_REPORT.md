# Backend Test Report

**Project:** CAREL Protocol Backend (`backend-rust`)  
**Date:** February 24, 2026  
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

Observed highlights:

- `Compiling carel-backend v0.1.0`
- `Finished 'test' profile target(s) in 3m 34s`
- `running 188 tests`
- `test result: ok. 188 passed; 0 failed`

## Coverage Notes (from executed suites)

The run includes unit/integration tests across:

- API modules (`ai`, `auth`, `bridge`, `swap`, `stake`, `limit_order`, `nft`, `portfolio`, etc.)
- Services (`ai_service`, `point_calculator`, `route_optimizer`, `event_indexer`, etc.)
- Indexer and Starknet client utilities
- Crypto helpers and signature validation
- WebSocket payload behavior

## Conclusion

Backend automated tests are healthy for this run: **188/188 passing** with no failures.

## Recommended Retest Commands

```bash
# Full backend suite
cd /mnt/c/Users/frend/zkcare_protocol/backend-rust
cargo test

# Faster re-run without rebuild noise
cargo test -q
```
