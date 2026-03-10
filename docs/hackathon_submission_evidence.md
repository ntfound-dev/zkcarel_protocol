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

### Latest V3 AI Runtime Flow Links
- Level 2 bridge setup burn (`BTC -> WBTC`): https://sepolia.voyager.online/tx/0x105b72bf12c597b7d50fafb28a6693a86ff345c7fccc317c7f3e8ae719eccca
- Level 2 bridge source BTC tx: https://mempool.space/testnet/tx/4ef9527c246a419339c6872e2fa1b2816fdff3b5bf827d07425e57239d80e341
- Level 2 bridge Garden order: https://testnet-explorer.garden.finance/order/64d4d675c52c19485a2191136373a0b8a2d0034fe5e391093703e7791c5fc58d
- Level 3 private swap execution (`CAREL -> USDT`): https://sepolia.voyager.online/tx/0x499f455ff3d6eb3be051b266b5c9d92e3203b215d8e13e8e720fd1c50c441b3
- Level 3 private swap note deposit: https://sepolia.voyager.online/tx/0x153fac7e9cfeeb7e677a6463196f677ba6f7e7d087a3d544ce28418b2e09aac
- Level 3 private limit order setup burn: https://sepolia.voyager.online/tx/0x3c286b804550f59570bb3ab67397db1cea717ad273cc4dfd8add705254e486
- Level 3 private limit order execution: https://sepolia.voyager.online/tx/0x36c5b80895a18e3f41c659d1765efc68e8adf2b0ebf6a2f0451de8247dec8c4
- Level 3 private limit order note deposit: https://sepolia.voyager.online/tx/0x5d7b610eca7b06e04b96e7e9439cd669fa6b977c48398e4c50e71e8e9755fa
- Level 3 private stake setup burn: https://sepolia.voyager.online/tx/0x213eb0260f40cffd242e2341ee1264e57aeed5868e21448a122f1a7d83a5e8d
- Level 3 private stake execution: https://sepolia.voyager.online/tx/0x38117118a2c377de14fa9e2e23a4da5d2089e4f61477805b6c721210a38ab93
- Level 3 private stake note deposit: https://sepolia.voyager.online/tx/0x780eb5e8062ffc6c350be1020e8f35622a14e13c3e62e048354345df9949124

Runtime note:
- This snapshot follows the active V3 profile with `PRIVATE_ACTION_EXECUTOR_ADDRESS=0x0112a5f60db409d74c4e67b5c29c85c7fbeefffccf9762a37460a42854cc74c2`.
- AI bridge uses the public Level 2 bridge path.
- AI private `swap`, `limit order`, and `stake` use the Level 3 hide path.

### Latest Runtime Validation Snapshot (Mar 8, 2026)
- Level 2 bridge setup burn (`BTC -> WBTC`, awaiting BTC deposit): https://sepolia.voyager.online/tx/0x4c7097b619f520f6e95839cf35395855eb3f382b185e3faedaccd8a7b53d85d
- Level 2 bridge Garden order (`BTC -> WBTC`, awaiting BTC deposit): https://testnet-explorer.garden.finance/order/c400185ba5c1b12b6119f708dbfab07581d767abd31f8b64b05bac38e058f9d1
- Level 2 bridge setup burn (`ETH -> WBTC`): https://sepolia.voyager.online/tx/0x227281610079b37ab58ded5ebf18e075cc4073f742f835585f4e033cf799c45
- Level 2 bridge source tx (`ETH -> WBTC`): https://sepolia.etherscan.io/tx/0xa7aba511aee3b5e042b4e963a4bc966ea401b7ff9a78c646c6622d977a5f0552
- Level 2 bridge Garden order (`ETH -> WBTC`): https://testnet-explorer.garden.finance/order/0e359ff05c7fd359e399575a8c14c24859284a4b83d141400f1d6eb31551c826
- Level 3 private limit order setup burn (`USDT -> USDC`): https://sepolia.voyager.online/tx/0x4de127e1e153e33382cd73ff049d8ec1317660072613c332450b975a6abc66e
- Level 3 private limit order execution (`USDT -> USDC`): https://sepolia.voyager.online/tx/0x40ff375aa42c4eff9e6e2c550af7826a8a97c34a0616c731116a676b4076a49
- Level 3 private limit order note deposit (`USDT -> USDC`): https://sepolia.voyager.online/tx/0x3e3758f30aac26754eb6ab9632aea9cf6f447b2bce183195b175bf3aa4ba32c
- Level 3 private limit order setup burn (`CAREL -> USDC`): https://sepolia.voyager.online/tx/0xc14e9f3c3b4803685702612461bb9af561ae4efea13536d6864c057d7bd97a
- Level 3 private limit order execution (`CAREL -> USDC`): https://sepolia.voyager.online/tx/0x3b9b44271c2f1595fe3ee54daa275e9a9cea4bafcf70dc498207111290a6bb9
- Level 3 private limit order note deposit (`CAREL -> USDC`): https://sepolia.voyager.online/tx/0x1086754390f234f81db32a9203b9a264981112257887d7c1565eef676c3be0b
- Level 3 private limit order setup burn (`STRK -> USDT`): https://sepolia.voyager.online/tx/0x38fdc1a02937bf87636c902750601af26871f5876a19b7091e4fb374bd19bf7
- Level 3 private limit order execution (`STRK -> USDT`): https://sepolia.voyager.online/tx/0x66474d91f6ed8837ebade380053e63c1177e8a771b61c295a6c21ae90f8162e
- Level 3 private limit order note deposit (`STRK -> USDT`): https://sepolia.voyager.online/tx/0x29357253f3462ddd072a7aedbb9a7e74721c872faf42554e096de7238f819e7
- Level 3 private stake setup burn (`CAREL`): https://sepolia.voyager.online/tx/0x25a161119f1827f809dc683648648927b36659f167c15ff9dd85bc34b816fba
- Level 3 private stake execution (`CAREL`): https://sepolia.voyager.online/tx/0x36a9d5f3ad3e36d8b7dd53cde98e77248ee882290cba66d53569da600c588d5
- Level 3 private stake note deposit (`CAREL`): https://sepolia.voyager.online/tx/0x14de451288449488cc9a1e6d41aa040de05bf39bb54e464eeee58b8e199c61d
- Level 3 private swap setup burn (`WBTC -> CAREL`, tier `$250`): https://sepolia.voyager.online/tx/0x1f061ee517de778ec569ae92a1744510f3cc93e21ff0905c521fd6cab09eae4
- Level 3 private swap execution (`WBTC -> CAREL`, tier `$250`): https://sepolia.voyager.online/tx/0x1a8694311fceb50977c853177cf9f1f47c96ba3e93476af5910c510dc42413b
- Level 3 private swap note deposit (`WBTC -> CAREL`, tier `$250`): https://sepolia.voyager.online/tx/0x289371f5f3ba89598d2f5d72560dbd83fa69a31e6b52272d6be7fa8390a52c
- Level 3 private swap setup burn (`USDC -> STRK`, tier `$50`): https://sepolia.voyager.online/tx/0x39d00939c50ac742429bab4c4b3773e03fea2ee8893729e69b8aa7ae2450f47
- Level 3 private swap execution (`USDC -> STRK`, tier `$50`): https://sepolia.voyager.online/tx/0x709e47743b7521eeec9d581505398a92feb3cf331249cada898111e89302af7
- Level 3 private swap note deposit (`USDC -> STRK`, tier `$50`): https://sepolia.voyager.online/tx/0x6cf3e5f7791cac62ccc2ec0d13f7bb436dca12a5e3d6144f33889b92d4e2426

Snapshot notes:
- Level 3 private note size follows the selected hide tier for `swap`, `stake`, and `limit order`.
- For volatile assets such as `STRK` and `WBTC`, the final token amount is approximate to the selected USD tier.
- Current frontend behavior now shows cooldown status in chat after hide note deposit and marks AI-created transactions/orders/staking positions in the UI.
- Route and pool pre-checks are expected to stop unsupported or illiquid AI actions before CAREL burn.

### AI Agent Level 2 Bridge Transcript Evidence (Mar 10, 2026)
Agent banner (chat UI excerpt):
- "Welcome to CAREL Agent (Level 2). I can execute live DeFi actions after wallet confirmation. Each execution burns 1 CAREL."
- "Bridge execution usually has 2 steps: (1) Starknet setup burn, (2) source-chain transfer (BTC/ETH)."

Bridge `BTC -> WBTC` (0.005 BTC):
- Burn tx (Starknet setup, burns 1 CAREL): https://sepolia.voyager.online/tx/0x5187238b69de24ab2069e20e8afb8e1387eccbbbb41d50cb4ee1fcc0eb764e4
- Garden order: https://testnet-explorer.garden.finance/order/1c474904692e12d5188a3424dda6e215e578d08b6c9119152b15e864ad9701ed
- BTC deposit tx: https://mempool.space/testnet/tx/97aca2209b80cf5af2e4f62126181ffe4f203aab6dfe840012051f128e25201e

Bridge `ETH -> WBTC` (0.05 ETH):
- Burn tx (Starknet setup, burns 1 CAREL): https://sepolia.voyager.online/tx/0x75cb30c0d83b03713b5a071af233bfabae58aaa76df5c4b32ef7f61791ca764
- ETH source tx: https://sepolia.etherscan.io/tx/0x9a7c2f2f6a7c24c0f003bdef0a0c8420167974937c982cb0c308ebbec3f923a7
- Garden order: https://testnet-explorer.garden.finance/order/79bbcccc277274fb5294925ffc1e917b91af280ffd600d9f14fd0e47dc0dddc6

### AI Agent Level 3 Private Transcript Evidence (Mar 10, 2026)
Agent banner (chat UI excerpt):
- "Welcome to CAREL Agent (Level 3). I can run private Garaga-mode execution for swap, stake, and limit order. Each execution burns 2 CAREL. Bridge stays on Level 2."
- "Private hide flow uses a 60s cooldown after note deposit."

Private swap `CAREL -> USDT` (tier `$5`, burns `2 CAREL`, cooldown `60s`):
- Burn tx (Starknet setup): https://sepolia.voyager.online/tx/0x398efe083271845492dc2162b9de3362307b7b2cfeafdf2494fab8cebeb43c0
- Hide note deposit tx: https://sepolia.voyager.online/tx/0x153e78f4cd1575b49345828ff94698f47a0f3ceaf346ac3387eae4f67f49708
- Private execution tx: https://sepolia.voyager.online/tx/0x6ed77802ca6ec525a3b6086bff70b2fca5766f0c722893b89634dd8d524c3b1

Private swap `USDC -> STRK` (tier `$5`, burns `2 CAREL`, cooldown `60s`):
- Burn tx (Starknet setup): https://sepolia.voyager.online/tx/0x451c797777f1e26c905fdb0e4d69da36c3601b79fd172accac7499d16b85a05
- Hide note deposit tx: https://sepolia.voyager.online/tx/0x3353d6df2fb5b53d19dabba16efc07957b83059b7956228d67e5b31b9bef6ea
- Private execution tx: https://sepolia.voyager.online/tx/0x52f8691ae240b56a0f589ee05528c7dbc969d34947b7de1d73e78a9032c7aac

Private swap `STRK -> WBTC` (tier `$5`, burns `2 CAREL`, cooldown `60s`):
- Burn tx (Starknet setup): https://sepolia.voyager.online/tx/0x5cb25efbf221d4349e1c715bfc7271638fa26b57d15534eb71f7211c4c5473d
- Hide note deposit tx: https://sepolia.voyager.online/tx/0x5e2d3d10fdb814cee2261a7e0bd46a029c4d51e294f208f72207aaf7894c4e6
- Private execution tx: https://sepolia.voyager.online/tx/0x4d5d283ebc9cb2231d003190c471e22d1514096d434df52ba0bb6649106927a

### AI Agent Level 3 Private Limit Order Transcript Evidence (Mar 11-12, 2026)
Private limit order `USDT/USDC` (tier `$100`, price `1.25`, requested expiry `3d`):
- Hide note deposit tx: https://sepolia.voyager.online/tx/0x1164d8aa72cc72c765d54f212c280bacaceada13821f1e2a5cb26c50f4a21c9
- Private execution tx (order created `0x11cbe002...5443`, UI shows expiry `7d`): https://sepolia.voyager.online/tx/0x26396a09992fa86cd1159897ccb9c8d86403b5a82b94ddd192e0c9580f896aa
- Note: setup burn tx is not shown in this transcript (setup may have been reused).

Private limit order `CAREL/USDC` (tier `$10`, price `1.25`, expiry `1d`):
- Burn tx (Starknet setup): https://sepolia.voyager.online/tx/0x675047f8c755538f46a78c789520610a1169e0f5e26c49788b2960b399be4fd
- Hide note deposit tx: https://sepolia.voyager.online/tx/0x7c0fcea6571e1ba077ba426e217cecb35dafd89856690c0789a7ca8852eca2
- Private execution tx (order created `0x59115402...d2fe`): https://sepolia.voyager.online/tx/0x166bbf475ec39eee9a216fef5d35e8b838cba62bf8ba9699a224c45365cf70e

Private limit order `WBTC/USDC` (tier `$10`, price `68000`, expiry `1d`):
- Burn tx (Starknet setup): https://sepolia.voyager.online/tx/0x3153fba346cdba2e8dd92fc17ea4603950c382f9a8ca3bef2dcf268b20bdced
- Hide note deposit tx: https://sepolia.voyager.online/tx/0x1d09b1a15d48d97f8dcce84262803a297a2757b47638a80714d1c5b410d77ae
- Private execution tx (order created `0x84f7b3f5...9cc8`): https://sepolia.voyager.online/tx/0x6102cd1b609b94acbfcf2090d8cf23886feb5d174c50202c9a7e56ed9904ebe

### Manual Hide Flow Validation (Mar 10, 2026)
- Hide note deposit (user wallet, `approve` + `deposit_fixed_v3`, `CAREL` denom `0xa`, amount `10 CAREL`): https://sepolia.voyager.online/tx/0x1cae4f759730b228b51a27e776dd2dd4fb43bd78715fe6578201a51a2a84bcd
- Hide private swap execution (relayer, `submit_private_swap` + `execute_private_swap_with_payout`, `CAREL -> USDC`): https://sepolia.voyager.online/tx/0x61f4c7e353d793a2c7f066aa99d22dede2a2ff67c4231e2658722954a1646fe
- Hide note deposit (user wallet, `approve` + `deposit_fixed_v3`, `USDT` denom `0xa`, amount `10 USDT`): https://sepolia.voyager.online/tx/0x792cc7e0d939597600e407f0f1632963d37b720661b625dd285bb47d6369184
- Hide private limit order execution (relayer, `submit_private_limit` + `execute_private_limit_with_payout`, `USDT -> WBTC`): https://sepolia.voyager.online/tx/0x221d9deeca00ef656133f13562091d82507081d5299a9bfbe2ff48010260f50
- Hide note deposit (user wallet, `approve` + `deposit_fixed_v3`, `WBTC`): https://sepolia.voyager.online/tx/0x5bfd33ad05b4ddc4ed2e1c974577b11e9487aaf7592d282cb6851ed12db0d8e
- Hide private stake execution (relayer, `submit_private_stake` + `execute_private_stake_with_payout`, stake `WBTC` via `StakingBTC`): https://sepolia.voyager.online/tx/0x47abb39188bd05331da1cf9024bcf8be29107eae2317c2f6dcd03b1903125ed
- Hide note withdrawal (user wallet, `private_exit_v3`, `USDC` amount `10`): https://sepolia.voyager.online/tx/0x5bb254cc480a12525331bc911a2365efc0966f681fb7f8faa9e1068ddaf928d
- Hide note withdrawal (user wallet, `private_exit_v3`, `USDT` amount `10`): https://sepolia.voyager.online/tx/0xa9acb749f708346360beea84f8d35eacee3aa3bed1e7da10259f0c9d00032f
- Hide note withdrawal (user wallet, `private_exit_v3`, `USDT` amount `10`): https://sepolia.voyager.online/tx/0x45a918b757ce55b470097bb32f00b1436164294e0c303c9d2a6ac4d94047e7d

Analysis (what these prove on-chain):
- Actors:
  - User wallet / account: `0x0469de079832d5da0591fc5f8fd2957f70b908d62c5d0dcb057d030cfc827705`
  - Hide relayer / executor submitter: `0x0289f797b9c2dc6c661fd058968d9ba39d01c7547f8259f01b7bce55696d0ff0`
  - Hide executor (V3, `deposit_fixed_v3` + `private_exit_v3` entrypoints): `0x075cdfaaf113cfaf458fc695cc9ec694a5b581fd8572d18fc83aee7d8d57be3c`
  - Note: the executor address above is taken directly from the decoded calldata of these tx (Mar 10, 2026) and can differ from older runtime/env snapshots in this repo.
- Target contracts (called by the executor during private execution):
  - `SwapAggregator`: `0x06f3e03be8a82746394c4ad20c6888dd260a69452a50eb3121252fdecacc6d28`
  - `LimitOrderBook`: `0x06b189eef1358559681712ff6e9387c2f6d43309e27705d26daff4e3ba1fdf8a`
  - `StakingBTC`: `0x01fa14e91abade76d753d718640a14540032c307832a435f8781d446b288cdf8`
- Private swap (`CAREL -> USDC`) evidence:
  - `0x1cae...bcd`: user signs `approve(token=CAREL, spender=executor)` then `deposit_fixed_v3(token=CAREL, denom_id=0xa, note_commitment=...)`; internal `transfer_from` moves the fixed note amount into the executor.
  - `0x61f4...6fe`: relayer signs `submit_private_swap(root=0x11, nullifier, proof)` then `execute_private_swap_with_payout(target=SwapAggregator, approval_token=CAREL, payout_token=USDC, min_payout=...)`; token transfers show `USDC` ends at the user via the executor.
- Private limit order (`USDT -> WBTC`) evidence:
  - `0x792c...184`: user signs `approve(token=USDT, spender=executor)` then `deposit_fixed_v3(token=USDT, denom_id=0xa, note_commitment=...)`.
  - `0x221d...0f50`: relayer signs `submit_private_limit(...)` then `execute_private_limit_with_payout(target=LimitOrderBook, approval_token=USDT, payout_token=WBTC, min_payout=0)`.
  - `min_payout=0` and Voyager showing `0 WBTC` transferred is consistent with a placed order that does not fill immediately (order creation rather than swap-like payout).
- Private stake (stake `WBTC`) evidence:
  - `0x5bfd...0d8e`: user signs `approve(token=WBTC, spender=executor)` then `deposit_fixed_v3(token=WBTC, denom_id=..., note_commitment=...)`.
  - `0x47ab...25ed`: relayer signs `submit_private_stake(...)` then `execute_private_stake_with_payout(target=StakingBTC, approval_token=WBTC)`; transfers show `WBTC` moved into the staking contract.
- Private exit (note withdrawal) evidence:
  - `0x5bb2...928d`, `0xa9ac...032f`, `0x45a9...7e7d`: user signs `private_exit_v3(root=0x11, nullifier, proof, token, amount, recipient=user)`.
  - These tx are signed by the user wallet (no relayer) and transfer the specified token amount from the executor back to the user, proving user-controlled withdrawal.

Privacy impact (what stays public vs what is obfuscated):
- What the ZK layer hides (cryptographically):
  - The specific deposited note being spent: private execution/exit uses `nullifier` + ZK proof and does **not** reveal `note_commitment`.
  - The secret behind the note commitment: observers can see deposits but cannot prove which deposit is being spent without additional off-chain correlation.
  - Relayer tampering: the proof binds `recipient` and `action_hash`/`exit_hash`, so the relayer cannot change the intended action/exit details without invalidating the proof.
- What still remains public on-chain (by design):
  - Deposit/exit token + fixed denomination amount, plus depositor/recipient addresses (ERC20 transfers are public).
  - When the relayer executes, the action call data and resulting token transfers are visible (`target`, `approval_token`, `payout_token`, `approval_amount`, `payout_amount`, etc.).
- What "privacy" practically means in this system:
  - **Sender privacy** vs normal mode: the user wallet is not the `sender_address` that interacts with DEX/limit/stake targets (relayer + executor do).
  - **Conditional unlinkability**: linking a deposit to a later action/exit is probabilistic and improves with more same-denom notes and larger time gaps.
- Linkability risks (important for demo claims):
  - If the payout/exit recipient is the same wallet that deposited (as in several links above), observers can correlate by address.
  - Small anonymity sets on testnet + fast execution can reduce unlinkability (timing correlation).
- How to improve privacy in practice:
  - Use a fresh recipient for payouts/exits, wait past cooldown, and avoid withdrawing immediately after a deposit.

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

## Detailed MVP Transaction Analysis
This section keeps the earlier detailed analysis of the 9 MVP proof links.

Verification snapshot date: **February 25, 2026**.

Current runtime update (March 5, 2026):
- Hide-mode baseline has moved to V3:
  - `HIDE_BALANCE_EXECUTOR_KIND=shielded_pool_v3`
  - `HIDE_BALANCE_POOL_VERSION_DEFAULT=v3`
  - `HIDE_BALANCE_V2_REDEEM_ONLY=true`
  - `PRIVATE_ACTION_EXECUTOR_ADDRESS=0x0112a5f60db409d74c4e67b5c29c85c7fbeefffccf9762a37460a42854cc74c2`
- This section is kept as historical analysis for the earlier V2-era links.

### Problem and Approach
#### Problem
- It is easy to mix up contracts that are actively used in MVP runtime versus contracts deployed for roadmap scope.
- `normal` and `hide` flows are often described together, while their on-chain traces are different.
- Reviewers need auditable evidence from chain data, not assumptions.

#### Approach
- Use runtime `env` as source of truth.
- Validate receipts/calldata/events directly, not only UI behavior.
- In this snapshot, active hide path was in `smartcontract/private_executor_lite` (`ShieldedPoolV2`), not `garaga_real_bls`.

### Source-of-Truth Environments Used
- `backend-rust/.env`
- `smartcontract/.env`
- `frontend/.env.local`

Key values aligned across the three env files on the February 25, 2026 snapshot:
- `HIDE_BALANCE_EXECUTOR_KIND=shielded_pool_v2`
- `PRIVATE_ACTION_EXECUTOR_ADDRESS=0x060549e87e71903ffe1e6449aaa1e77d941de1a5117be3beabd0026d847c61fb`
- `SWAP_AGGREGATOR_ADDRESS=0x06f3e03be8a82746394c4ad20c6888dd260a69452a50eb3121252fdecacc6d28`
- `LIMIT_ORDER_BOOK_ADDRESS=0x06b189eef1358559681712ff6e9387c2f6d43309e27705d26daff4e3ba1fdf8a`
- `STAKING_STABLECOIN_ADDRESS=0x014f58753338f2f470c397a1c7ad1cfdc381a951b314ec2d7c9aec06a73a0aff`

Important note:
- `ZK_PRIVACY_ROUTER_ADDRESS` in `smartcontract/.env` may differ from runtime profile (`backend-rust/.env` + `frontend/.env.local`).
- MVP tx proof verification should follow the active runtime profile.

### Local Smart Contract Test Result
Executed from `smartcontract`:
- `bash scripts/test_core_fast.sh` -> **166 passed, 0 failed**
- `bash scripts/test_private_executor_lite.sh` -> **12 passed, 0 failed**

Result: core path and active hide path for this snapshot were locally verified.

### Analysis of 6 Starknet Transactions (Normal vs Hide)
Detected sender addresses:
- User wallet (normal): `0x469de079832d5da0591fc5f8fd2957f70b908d62c5d0dcb057d030cfc827705`
- Relayer (hide): `0x289f797b9c2dc6c661fd058968d9ba39d01c7547f8259f01b7bce55696d0ff0`

All tx below were `ACCEPTED_ON_L1` + `SUCCEEDED`.

| Flow | Link | On-chain sender | Detected action contract | `ShieldedPoolV2` emitter (`0x060549...c61fb`) |
| --- | --- | --- | --- | --- |
| Normal Swap | https://sepolia.voyager.online/tx/0x22a53b1af0f7d62e19569a99b38d67e9165faad2804ca50a1b0a53f289bab98 | User wallet | `SwapAggregator` (`0x06f3...`) | No |
| Hide Swap | https://sepolia.voyager.online/tx/0x71b6c99287c78b082d105dc7169faa56b419a3e2568b3ea9a70ef1ff653a2d2 | Relayer | `SwapAggregator` + executor | Yes |
| Normal Stake | https://sepolia.voyager.online/tx/0x3ffda88b060ad41b752e8410b13b567c2cca3aa1e32b29f60cf75d9f8b42d60 | User wallet | `StakingStablecoin` (`0x014f...`) | No |
| Hide Stake | https://sepolia.voyager.online/tx/0x5fcac3b4578ebe8cf32dde9b0c6ab2390f1f1aa6bea731c3f779575abbdd4cf | Relayer | `StakingStablecoin` + executor | Yes |
| Normal Limit | https://sepolia.voyager.online/tx/0x737c40659dc5c7872ab1a89222d879bca68163b890a61f09b1875d52e4747a6 | User wallet | `LimitOrderBook` (`0x06b1...`) | No |
| Hide Limit | https://sepolia.voyager.online/tx/0x523c9721e57f69fddff4ed3be3935cce3b5782ca2c3b454df565c0be6b22ba3 | Relayer | `LimitOrderBook` + executor | Yes |

### Hide-Mode Proof Path Evidence
All three hide transactions (`swap`, `stake`, `limit`) follow the same call pattern:
1. `set_asset_rule`
2. `deposit_fixed_for`
3. `submit_private_action` (large payload: `2322` fields)
4. `execute_private_*` (swap/stake/limit)

Key findings:
- `sender_address` for hide tx is relayer, not user wallet.
- User wallet can still appear in calldata binding data but is not the final sender.
- This is consistent with `ShieldedPoolV2` path in `private_executor_lite` for that snapshot.

### Analysis of 3 Bridge Evidence Links
#### BTC Bridge Tx
- Link: https://mempool.space/testnet4/tx/d26a8f5d0213b4448722cde81e1f47e68b8efbd00c56ce4802e39c9b0898db4c
- Result:
  - Confirmed: `true`
  - Block: `123447`
  - Fee: `153 sats`
  - Main output: `50000 sats` (0.0005 BTC)

#### Garden Order
- Link: https://testnet-explorer.garden.finance/order/237be68816b9144b9d3533ca3ec8c4eb1e7c00b1649e9ec216d89469fd014e70
- Garden API verification (`/v2/orders/<id>`) shows:
  - `integrator`: `DocsTesting`
  - `created_at`: `2026-02-23T23:47:35Z`
  - Source: `bitcoin_testnet:btc`, amount `50000`
  - Source initiate tx: `d26a8f5d...:123447` (matches BTC tx above)
  - Destination: `starknet_sepolia:wbtc`, amount `49850`

#### ETH Bridge Tx
- Link: https://sepolia.etherscan.io/tx/0xab25b9261dc9f703e44cb89a34831ff03024b8fe89e32cce4a7e58b5d6dcdef3
- Result:
  - Status: `0x1` (success)
  - Value: `0.005 ETH`
  - `from`: `0x834de729cb9df77451dbc6bf7fd05f475b011ac7`
  - `to`: `0x006caa2c35c9f4df23dbf4985616ef2a8829bf22`

Note:
- Based on Garden order payload, the directly linked route is BTC -> WBTC.
- The ETH tx is valid but not directly tied to that specific `order_id` in this analyzed payload.

### Practical Reviewer Summary
1. `normal` vs `hide` difference is provable on-chain: normal sent by user wallet, hide sent by relayer.
2. In this historical snapshot, active hide path was `private_executor_lite/ShieldedPoolV2`, not `garaga_real_bls`.
3. Hide path explicitly executes `submit_private_action` + `execute_private_*` in the same tx flow.
4. Bridge evidence is valid: BTC tx confirmed, Garden order matches BTC tx, ETH tx also succeeded.
