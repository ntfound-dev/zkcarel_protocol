# garaga_real_bls (Real Groth16 BLS Verifier)

This package contains the generated real Groth16 BLS12-381 verifier and a legacy-compatible executor path.
Use it when real on-chain proof verification is required.

## Table of Contents
- [Scope](#scope)
- [When to Use](#when-to-use)
- [Repository Contents](#repository-contents)
- [Build and Test](#build-and-test)
- [Deployment Notes](#deployment-notes)
- [Environment Integration](#environment-integration)
- [Current Constraints](#current-constraints)

## Scope
- Target: Starknet Sepolia (testnet), and future mainnet migration readiness.
- Focus: real Groth16 BLS12-381 verifier path.
- Not intended as daily MVP path due heavy compilation cost.

## When to Use
Use this package when:
- real Garaga BLS verifier is needed for on-chain proof verification,
- end-to-end proof validation is required without mock shortcuts,
- legacy deployments still depend on the earlier executor generation,
- preparing production migration toward real verifier enforcement.

Do not use this package for normal MVP iteration.
Use `smartcontract/private_executor_lite/README.md` for day-to-day hide-mode development.

## Repository Contents
- `Groth16VerifierBLS12_381` (generated verifier, heavy compile)
- `PrivateActionExecutor` (legacy-compatible executor path)

## Build and Test
From repository root:
```bash
bash smartcontract/scripts/test_garaga_fast.sh
```

Verifier fork test (heavier, default `ignored`):
```bash
bash smartcontract/scripts/test_garaga_fork.sh
```

Manual:
```bash
cd smartcontract/garaga_real_bls
asdf exec snforge test
```

## Deployment Notes
- Ensure `sncast` is installed.
- Declare and deploy verifier classes first.
- Run adapter/router wiring from scripts in `smartcontract/scripts/`.
- For Windows + WSL setups, use:
  `smartcontract/scripts/deploy_garaga_verifier_windows.ps1 -UseWsl`
- If `sncast` cannot resolve `scarb` or `universal-sierra-compiler`, ensure these paths are valid:
  - `SCARB=/home/frend/.asdf/installs/scarb/2.11.4/bin/scarb`
  - `UNIVERSAL_SIERRA_COMPILER=/home/frend/.local/bin/universal-sierra-compiler`

## Environment Integration
Minimum required settings:
- `GARAGA_VERIFIER_ADDRESS=<real verifier address>`
- `GARAGA_VERIFICATION_MODE=5`
- `PRIVACY_VERIFIER_KIND=garaga`

Sepolia latest snapshot (February 27, 2026):
- `GARAGA_VERIFIER_ADDRESS=0x04bc6f22779e528785ee27b844b93e92cf92d8ff0b6bed2f9b5cf41ee467ff45`
- `ClassHash=0x3c304b6fbde499591d6b79b6e3eb525a5673e1de9c02d46c575492065ed996a`

Re-wire adapter/router via:
- `smartcontract/scripts/04_deploy_adapters.sh`
- `smartcontract/scripts/07_wire_privacy_router_v2.sh`

## Current Constraints
- Compile cost is significantly higher than `private_executor_lite`.
- Not the default MVP path.
- Proof format must stay consistent with backend-generated payloads.
