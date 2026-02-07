# ZkCarel Smart Contract ABI Documentation

## Contract Addresses

### Testnet (Sepolia)
```
ZkCarelRouter: 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
ZkCarelNFT: 0x8f7B2aC9F4d8C5e4d5F9A3cB1E6D7f8a9c0b1d2e
ZkCarelStaking: 0x3a4B5c6D7e8F9a0b1c2D3e4F5a6B7c8D9e0F1a2b
ZkCarelPoints: 0x9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f
LimitOrderBook: 0x5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d
```

### Mainnet (Coming Soon)
TBA

---

## ZkCarelRouter

Main router contract for swaps and bridges.

### Functions

#### swap
Execute a token swap

```solidity
function swap(
    address fromToken,
    address toToken,
    uint256 amountIn,
    uint256 minAmountOut,
    address recipient,
    uint256 deadline,
    bool usePrivateMode
) external payable returns (uint256 amountOut)
```

**Parameters:**
- `fromToken`: Source token address (use 0x0 for ETH)
- `toToken`: Destination token address
- `amountIn`: Amount of source token to swap
- `minAmountOut`: Minimum acceptable output amount
- `recipient`: Address to receive output tokens
- `deadline`: Unix timestamp deadline
- `usePrivateMode`: Enable zero-knowledge privacy (higher fee)

**Events:**
```solidity
event Swap(
    address indexed user,
    address indexed fromToken,
    address indexed toToken,
    uint256 amountIn,
    uint256 amountOut,
    uint256 fee,
    bool privateMode
);
```

#### bridge
Bridge tokens cross-chain

```solidity
function bridge(
    uint256 targetChainId,
    address token,
    uint256 amount,
    address recipient
) external payable returns (bytes32 bridgeId)
```

**Parameters:**
- `targetChainId`: Destination chain ID
- `token`: Token address to bridge
- `amount`: Amount to bridge
- `recipient`: Recipient address on target chain

**Events:**
```solidity
event BridgeInitiated(
    bytes32 indexed bridgeId,
    address indexed user,
    uint256 indexed targetChainId,
    address token,
    uint256 amount,
    address recipient
);
```

#### getQuote
Get swap quote without executing

```solidity
function getQuote(
    address fromToken,
    address toToken,
    uint256 amountIn
) external view returns (
    uint256 amountOut,
    uint256 fee,
    address[] memory path
)
```

---

## ZkCarelNFT

NFT discount system contract (ERC-721).

### Functions

#### mint
Mint a discount NFT with points

```solidity
function mint(
    uint8 tier
) external returns (uint256 tokenId)
```

**Parameters:**
- `tier`: NFT tier (0=None, 1=Bronze, 2=Silver, 3=Gold, 4=Platinum, 5=Onyx)

**Events:**
```solidity
event NFTMinted(
    address indexed user,
    uint256 indexed tokenId,
    uint8 tier,
    uint256 pointsSpent,
    uint8 uses
);
```

#### useDiscount
Use one NFT discount count

```solidity
function useDiscount(
    uint256 tokenId
) external returns (bool)
```

**Returns:** `true` if discount was applied successfully

**Events:**
```solidity
event DiscountUsed(
    address indexed user,
    uint256 indexed tokenId,
    uint8 remainingUses
);

event NFTExpired(
    address indexed user,
    uint256 indexed tokenId
);
```

#### getActiveNFT
Get user's active NFT

```solidity
function getActiveNFT(
    address user
) external view returns (
    uint256 tokenId,
    uint8 tier,
    uint8 discount,
    uint8 uses,
    uint8 maxUses,
    bool isActive
)
```

#### getNFTInfo
Get NFT details

```solidity
function getNFTInfo(
    uint256 tokenId
) external view returns (
    uint8 tier,
    uint8 discount,
    uint8 uses,
    uint8 maxUses,
    address owner,
    uint256 mintedAt
)
```

---

## ZkCarelStaking

Staking contract for earning rewards.

### Functions

#### stake
Stake tokens to earn rewards

```solidity
function stake(
    address token,
    uint256 amount,
    uint8 poolId
) external returns (uint256 stakeId)
```

**Parameters:**
- `token`: Token address to stake
- `amount`: Amount to stake
- `poolId`: Staking pool identifier

**Events:**
```solidity
event Staked(
    address indexed user,
    uint256 indexed stakeId,
    address token,
    uint256 amount,
    uint8 poolId
);
```

#### unstake
Withdraw staked tokens

```solidity
function unstake(
    uint256 stakeId,
    uint256 amount
) external returns (uint256 withdrawn, uint256 rewards)
```

**Events:**
```solidity
event Unstaked(
    address indexed user,
    uint256 indexed stakeId,
    uint256 amount,
    uint256 rewards
);
```

#### claimRewards
Claim accumulated staking rewards

```solidity
function claimRewards(
    uint256 stakeId
) external returns (uint256 rewards)
```

**Events:**
```solidity
event RewardsClaimed(
    address indexed user,
    uint256 indexed stakeId,
    uint256 rewards
);
```

#### getStakeInfo
Get staking position details

```solidity
function getStakeInfo(
    uint256 stakeId
) external view returns (
    address owner,
    address token,
    uint256 amount,
    uint256 stakedAt,
    uint256 lastRewardClaim,
    uint256 pendingRewards,
    uint8 poolId
)
```

#### getPoolInfo
Get pool information

```solidity
function getPoolInfo(
    uint8 poolId
) external view returns (
    address token,
    uint256 apy,
    uint256 tvl,
    uint256 minStake,
    bool isActive
)
```

---

## ZkCarelPoints

Points management contract.

### Functions

#### getPoints
Get user's point balance

```solidity
function getPoints(
    address user
) external view returns (
    uint256 lifetimePoints,
    uint256 currentPoints,
    uint8 tier
)
```

#### addPoints
Add points for trading activity (only callable by router)

```solidity
function addPoints(
    address user,
    uint256 amount,
    string memory activity
) external
```

**Events:**
```solidity
event PointsEarned(
    address indexed user,
    uint256 amount,
    string activity,
    uint256 newTotal
);
```

#### spendPoints
Spend points (only callable by NFT contract)

```solidity
function spendPoints(
    address user,
    uint256 amount
) external returns (bool)
```

**Events:**
```solidity
event PointsSpent(
    address indexed user,
    uint256 amount,
    uint256 remaining
);
```

#### convertToCAREL
Convert points to CAREL tokens

```solidity
function convertToCAREL(
    uint256 points
) external returns (uint256 carelAmount)
```

**Events:**
```solidity
event PointsConverted(
    address indexed user,
    uint256 points,
    uint256 carelAmount
);
```

---

## LimitOrderBook

Limit order contract.

### Functions

#### createOrder
Create a new limit order

```solidity
function createOrder(
    address fromToken,
    address toToken,
    uint256 amount,
    uint256 price,
    uint256 expiry,
    address recipient
) external returns (bytes32 orderId)
```

**Parameters:**
- `fromToken`: Token to sell
- `toToken`: Token to buy
- `amount`: Amount to sell
- `price`: Target price (in wei, 18 decimals)
- `expiry`: Order expiry timestamp
- `recipient`: Address to receive bought tokens

**Events:**
```solidity
event OrderCreated(
    bytes32 indexed orderId,
    address indexed user,
    address fromToken,
    address toToken,
    uint256 amount,
    uint256 price,
    uint256 expiry
);
```

#### cancelOrder
Cancel an active order

```solidity
function cancelOrder(
    bytes32 orderId
) external
```

**Events:**
```solidity
event OrderCancelled(
    bytes32 indexed orderId,
    address indexed user
);
```

#### fillOrder
Fill a limit order (callable by anyone or keeper)

```solidity
function fillOrder(
    bytes32 orderId,
    uint256 amountToFill
) external returns (uint256 filled)
```

**Events:**
```solidity
event OrderFilled(
    bytes32 indexed orderId,
    address indexed filler,
    uint256 amountFilled,
    uint256 totalFilled
);

event OrderCompleted(
    bytes32 indexed orderId,
    address indexed user
);
```

#### getOrder
Get order details

```solidity
function getOrder(
    bytes32 orderId
) external view returns (
    address owner,
    address fromToken,
    address toToken,
    uint256 amount,
    uint256 filled,
    uint256 price,
    uint256 expiry,
    uint8 status
)
```

**Status codes:**
- 0: Active
- 1: Partially Filled
- 2: Filled
- 3: Cancelled
- 4: Expired

#### getUserOrders
Get all orders for a user

```solidity
function getUserOrders(
    address user,
    uint8 status
) external view returns (bytes32[] memory orderIds)
```

---

## Common Data Structures

### SwapParams
```solidity
struct SwapParams {
    address fromToken;
    address toToken;
    uint256 amountIn;
    uint256 minAmountOut;
    address recipient;
    uint256 deadline;
    bool usePrivateMode;
}
```

### NFTInfo
```solidity
struct NFTInfo {
    uint8 tier;
    uint8 discount;
    uint8 uses;
    uint8 maxUses;
    address owner;
    uint256 mintedAt;
    bool isActive;
}
```

### StakePosition
```solidity
struct StakePosition {
    address owner;
    address token;
    uint256 amount;
    uint256 stakedAt;
    uint256 lastRewardClaim;
    uint256 pendingRewards;
    uint8 poolId;
    bool isActive;
}
```

### LimitOrder
```solidity
struct LimitOrder {
    bytes32 orderId;
    address owner;
    address fromToken;
    address toToken;
    uint256 amount;
    uint256 filled;
    uint256 price;
    uint256 expiry;
    address recipient;
    uint8 status;
    uint256 createdAt;
}
```

---

## Integration Examples

### Web3.js Example
```javascript
const Web3 = require('web3');
const web3 = new Web3('https://sepolia.infura.io/v3/YOUR_KEY');

const routerABI = [...]; // Import from ABI file
const router = new web3.eth.Contract(routerABI, ROUTER_ADDRESS);

// Execute swap
const swap = await router.methods.swap(
    fromToken,
    toToken,
    amountIn,
    minAmountOut,
    recipient,
    deadline,
    false
).send({ from: userAddress, value: ethValue });
```

### Ethers.js Example
```javascript
const { ethers } = require('ethers');

const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const signer = provider.getSigner();
const router = new ethers.Contract(ROUTER_ADDRESS, routerABI, signer);

// Execute swap
const tx = await router.swap(
    fromToken,
    toToken,
    amountIn,
    minAmountOut,
    recipient,
    deadline,
    false,
    { value: ethValue }
);
await tx.wait();
```

### Starknet.js Example
```javascript
const { Provider, Contract } = require('starknet');

const provider = new Provider({ sequencer: { network: 'sepolia-alpha' } });
const router = new Contract(routerABI, ROUTER_ADDRESS, provider);

// Execute swap
const result = await router.swap(
    fromToken,
    toToken,
    amountIn,
    minAmountOut,
    recipient,
    deadline,
    false
);
```

---

## Security

### Best Practices
1. Always set appropriate `minAmountOut` to protect against slippage
2. Use reasonable `deadline` values (typically 10-30 minutes)
3. Verify contract addresses before interacting
4. Check allowances before swaps
5. Monitor events for transaction confirmation

### Audits
- CertiK Audit: Completed (Dec 2024)
- SlowMist Audit: Completed (Nov 2024)
- Immunefi Bug Bounty: Active

---

## Support

For integration support:
- Documentation: https://docs.zkcarel.io
- Discord: https://discord.gg/zkcarel
- Telegram: https://t.me/zkcarel
- Email: dev@zkcarel.io
