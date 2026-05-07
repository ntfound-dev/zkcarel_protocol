# CAREL Protocol Monorepo

Privacy-first DeFi execution layer on Starknet — swap, stake, limit order, bridge, with optional Hide Mode (ZK-relayed private execution) and autonomous AI agent routing (ERC-8004).

**Live on Starknet Sepolia testnet.**

- Frontend: https://carel-protocol.vercel.app
- Backend health: https://zkcarelprotocol-production.up.railway.app/health
- Docs: https://docs-site-two-teal.vercel.app

---

## Repository Structure

| Path | Stack | Purpose |
| --- | --- | --- |
| `frontend/` | Next.js | Trading UI, wallet UX, AI panel, rewards |
| `backend-rust/` | Rust + Axum | API, relayer, workers, bridge orchestration |
| `smartcontract/` | Cairo + Scarb/Snforge | Protocol contracts, privacy layer, AI executor |
| `docs-site/` | Nextra | Public documentation site |

---

## Quick Start

**Prerequisites:** Docker, Rust, Node.js, `sncast` (for contract deployment)

```bash
# 1. start postgres + redis
make docker-up

# 2. copy and fill env files
cp backend-rust/.env.example backend-rust/.env
cp frontend/.env.example frontend/.env.local

# 3. start frontend + backend
make dev
# open http://localhost:3000
```

```bash
make help       # show all commands
make stop       # stop frontend + backend
make prove      # backend with Garaga prover (needs ≥16GB RAM)
make test       # run all tests
make test-be    # backend Rust tests only
make test-sc    # Cairo/snforge tests only
make logs-be    # tail backend log
make logs-fe    # tail frontend log
make docs       # start docs site locally
```

**Deployment:**
```bash
make build-sc   # compile Cairo contracts (scarb build)
make deploy-sc  # build + deploy to Starknet Sepolia (sncast)
make deploy-be  # deploy backend to Railway (railway up)
make deploy-fe  # deploy frontend to Vercel (vercel --prod)
```

---

## Test Status

Latest snapshot (2026-05-07):

| Module | Result |
| --- | --- |
| Backend (`backend-rust`) | `208/208` pass |
| Smartcontract (`make test-sc`) | `109/109` pass, 0 warnings |
| Frontend | lint pass, build pass |

---

## Runtime Addresses (Starknet Sepolia)

Snapshot updated **18 March 2026**. Full inventory: `docs/runtime_addresses_sepolia_2026-03-18.md`.

| Contract | Address |
| --- | --- |
| CAREL Token | `0x0517f60f4ec4e1b2b748f0f642dfdcb32c0ddc893f777f2b595a4e4f6df51545` |
| Swap Aggregator | `0x03a62618aac9871ba9c2588f91b2397c511b74bc2b4eb9848de1e1fd0807f349` |
| Limit Order Book | `0x002b900401690afde0571675dbf982c5f52b68235cdfe7b04f0f0868ab24a2a8` |
| Staking CAREL | `0x07341f7062470231d58e5eb6420b58469391b4756d82d091ab69c30936ca7d46` |
| Staking Stablecoin | `0x03be7d988a8b0379915517db9b5d3272714229e1db53d4eb7cc3d551272981c7` |
| Staking WBTC | `0x00d5611d4cff0a794e475fc6771b88c329c74adb67481fdddfc3f083bd5fa578` |
| ShieldedPoolV4 | `0x00897405ab38dfe26ae10fdc8a28599291b29bb09060f667761c03edf578061f` |
| Privacy Router V4 | `0x0514361b7584954bada37cdaa923ef172722a74644fccae12c1443ae229b4065` |
| PrivacyIntermediary | `0x060c253818ae440583fae490baf688eb0ea5e0d4149da138b0c38d4564e65e2d` |
| AIExecutor | `0x031cc1d55f9e98f8a970b13dd72d09f8104a6875416da2f7bbb37243f9503dbf` |
| AIPlanRouter | `0x02cdffa746555b68279cf4fafd1ba5da6f2b08058cc5eb4a95fb5dcd03987420` |
| PointStorage | `0x05d3b87e47d008c48a5058cd2ff10893459c227f6c2b587674435931709c1dd1` |
| SnapshotDistributor | `0x040d1832545f7daa7e37f224175f8b6fd0984fd60b7d294ba790ec25094ca854` |
| ReferralSystem | `0x0106f99977e2961bdde5dc338607da00ba0da98abfd4b0dfcbe9953e7d14964c` |
| DiscountSoulbound | `0x0338ef369a49c73e1840c520540c9bd29322896269f0e089848d32cdd1afa042` |
| PriceOracle | `0x075c1746af30d08b9c08c6eb525c22fcb9eaa95adc74aee3d2b94eb7e319065f` |
| ShadowBridgeReceiver | `0x023a6858cde73047f5fb1baaf87b3249a8eed06b318b56c6289ea67f8457005f` |
| CarelMultiFaucet | `0x0277964147d63e375e50d3e660a86575221eb89442fa5fbf472d9a2990e0b448` |

---

## Documentation

Full docs at **https://docs-site-two-teal.vercel.app**

| Topic | Link |
| --- | --- |
| Quick start | [/quickstart](https://docs-site-two-teal.vercel.app/quickstart) |
| Architecture | [/architecture](https://docs-site-two-teal.vercel.app/architecture) |
| Hide Mode | [/hidemode](https://docs-site-two-teal.vercel.app/hidemode) |
| AI Agent | [/ai-agent](https://docs-site-two-teal.vercel.app/ai-agent) |
| Contracts | [/contracts](https://docs-site-two-teal.vercel.app/contracts) |
| Tokenomics | [/tokenomics](https://docs-site-two-teal.vercel.app/tokenomics) |
| Security | [/security](https://docs-site-two-teal.vercel.app/security) |
| Roadmap | [/roadmap](https://docs-site-two-teal.vercel.app/roadmap) |
| FAQ | [/faq](https://docs-site-two-teal.vercel.app/faq) |

Internal references: `docs/runtime_addresses_sepolia_2026-03-18.md`, `docs/test_reports.md`, `docs/security_audit_checklist.md`

---

## Current Constraints

- Testnet only — mainnet deployment pending external audit
- Hide Mode reduces wallet linkability but does **not** hide token pair, amount, or calldata
- Bridge availability depends on third-party provider liquidity (intermittent on testnet)
- Contract upgrades require redeploy — no proxy upgrade path currently
- Garaga Honk proof generation requires ≥16GB RAM, takes 30–90 seconds

---

## Roadmap

- **M1 (July 2026)** — ShieldedPoolV4 verifier fix, AIExecutor gas 5M→1.5M, TwapOracle gas 3.5M→200K, Noir circuits hardened, BTC Light Client PoW
- **M2 (September 2026)** — Battleship ZK game, Sumo Login, AI agent semi-autonomous, leaderboard/referral UI, Galxe campaign
- **M3 (November 2026)** — AI agent full autonomous (ERC-8004), Shadow Bitcoin Bridge, admin multisig, backend 10K user load
- **Growth phase** — mainnet deployment, CAREL token launch, external audit, QRIS/local bank onramp
