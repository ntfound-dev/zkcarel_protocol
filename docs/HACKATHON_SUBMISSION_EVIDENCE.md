# Hackathon Submission and Proof Links

## Hackathon Eligibility and Judging Alignment
### Stage One (Tahap Pertama)
Focus: basic eligibility and track alignment.

Track alignment in this repository:
- Bitcoin track: BTC-related bridge and private BTC roadmap under `bridge` and `private_btc_swap` modules.
- Privacy track: ZK payload flow (`nullifier`, `commitment`, proof/public inputs), relayer path, and private executor.
- Open innovation track: integrated FE/BE/SC execution system with AI-assisted flow and loyalty module.

### Stage Two (Tahap Kedua)
Equal-weight judging criteria:
- Technology Execution: build quality and reliability.
- Innovation: originality and technical differentiation.
- Impact: real user/problem relevance.
- Presentation: clarity of explanation and demo evidence.
- Progress: measurable work completed during hackathon.

Evidence mapping:

| Criterion | Evidence in Repo |
| --- | --- |
| Technology Execution | `backend-rust/BE_TEST_REPORT.md`, `smartcontract/SC_TEST_REPORT.md`, runtime flow docs |
| Innovation | hide-mode relayer + ZK binding, AI-assisted execution, loyalty/points integration |
| Impact | unified execution flow (swap/bridge/stake/limit) and failure pre-check path |
| Presentation | architecture docs + README structure + demo proof links |
| Progress | deployment updates, runtime env audits, and test reports dated during hackathon cycle |

## Submission Checklist (Hackathon)
Required assets:
- Project description
- Demo video (max 3 minutes)
- Functional demo URL (`https://carel-protocol.vercel.app`)
- Public code repository
- README
- Starknet wallet address
- Optional: pitch deck

Language:
- English content, or content with English translation.

## Proof Transactions
Use these links as audit evidence.

Scope note:
- Demo-flow links are historical MVP proof and not the full deployment footprint.

### Latest Deployment/Upgrade Transactions (Feb 26-27, 2026)
- Garaga verifier declare: https://sepolia.voyager.online/tx/0x3077ad4d20d1b9acc70fc18af1be0356b3e2c5a803f3ac4b83766523616b51f
- Garaga verifier deploy: https://sepolia.voyager.online/tx/0x0261ba1337d96733010f049591f5c65a3f33a080006d76f7dca4de958e8b0b66
- AI Executor deploy: https://sepolia.voyager.online/tx/0x057ee4fb05d584d4d5dc1fd54ceed57a6e5638b3fe8f2e8de6f222b66b6c2b9a
- AI Executor config 1: https://sepolia.voyager.online/tx/0x00c473fff1062e048d407b8e378337ce2f86489487cf31f5346ea2ebdb9eba46
- AI Executor config 2: https://sepolia.voyager.online/tx/0x002bb9b874a213c2b20d03acf8827e3db1912ead8abea5934e5aa0640e076a61
- AI Executor config 3: https://sepolia.voyager.online/tx/0x046c27a0f32d84dd42f3094a90c0b90f2e3501d63518ee5f93e9f7bc08180ae8
- AI Executor config 4: https://sepolia.voyager.online/tx/0x075f6f5bb1ae646a31f5f0373749b4fe99c164b05cfcfe0ac52ad3fd6e4e9462
- AI Executor config 5: https://sepolia.voyager.online/tx/0x0722f5eea40ab5fd4b89f96484ca373cfbf31a5fc5c1a92dd218c29739c08cd0
- AI Executor config 6: https://sepolia.voyager.online/tx/0x0105bcf4255238c6aac5e02d66e6ee39f65ba41f060530f54b6cae3553bb4423
- CAREL burner grant: https://sepolia.voyager.online/tx/0x0745212c6e5a3cab6f62f8111aa946ef4bafd5b540b7d68dbbc70c9eee8e3158

### Historical MVP Demo-Flow Links (Feb 23-25, 2026)
- Normal Swap: https://sepolia.voyager.online/tx/0x22a53b1af0f7d62e19569a99b38d67e9165faad2804ca50a1b0a53f289bab98
- Hide Swap: https://sepolia.voyager.online/tx/0x71b6c99287c78b082d105dc7169faa56b419a3e2568b3ea9a70ef1ff653a2d2
- Normal Stake: https://sepolia.voyager.online/tx/0x3ffda88b060ad41b752e8410b13b567c2cca3aa1e32b29f60cf75d9f8b42d60
- Hide Stake: https://sepolia.voyager.online/tx/0x5fcac3b4578ebe8cf32dde9b0c6ab2390f1f1aa6bea731c3f779575abbdd4cf
- Normal Limit: https://sepolia.voyager.online/tx/0x737c40659dc5c7872ab1a89222d879bca68163b890a61f09b1875d52e4747a6
- Hide Limit: https://sepolia.voyager.online/tx/0x523c9721e57f69fddff4ed3be3935cce3b5782ca2c3b454df565c0be6b22ba3
- BTC bridge tx: https://mempool.space/testnet4/tx/d26a8f5d0213b4448722cde81e1f47e68b8efbd00c56ce4802e39c9b0898db4c
- Garden order: https://testnet-explorer.garden.finance/order/237be68816b9144b9d3533ca3ec8c4eb1e7c00b1649e9ec216d89469fd014e70
- ETH bridge tx: https://sepolia.etherscan.io/tx/0xab25b9261dc9f703e44cb89a34831ff03024b8fe89e32cce4a7e58b5d6dcdef3

### Deployment and Wiring Scope (Beyond 9 Demo Links)
- Base deployment order is 22 contracts (`smartcontract/DEPLOY_TESTNET.md`), so at least 22 deploy transactions.
- Additional documented upgrade/wiring activity:
- Real Garaga verifier redeploy (February 27, 2026): declare `0x3077ad4d20d1b9acc70fc18af1be0356b3e2c5a803f3ac4b83766523616b51f`, deploy `0x0261ba1337d96733010f049591f5c65a3f33a080006d76f7dca4de958e8b0b66`.
- AI Executor upgrade (February 26, 2026): deploy `0x057ee4fb05d584d4d5dc1fd54ceed57a6e5638b3fe8f2e8de6f222b66b6c2b9a`, plus 6 config tx and 1 CAREL burner grant tx (listed in `smartcontract/DEPLOY_TESTNET.md`).
- V2 privacy wiring script maps 32 verifier actions and wires up to 36 contracts/modules (30 default + 6 optional external modules).
- Staking token registration script adds 4 invoke tx (USDC, USDT, STRK, WBTC).
- Documented deploy+wiring activity commonly exceeds 100 tx across full setup/redeploy cycles (excluding RPC retry attempts).
- Quick deployer check: `https://sepolia.voyager.online/contract/[DEPLOYER_ADDRESS]`.
