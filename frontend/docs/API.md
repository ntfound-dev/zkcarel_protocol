# ZkCarel API Documentation

## Base URL
```
Testnet: https://api-testnet.zkcarel.io/v1
Mainnet: https://api.zkcarel.io/v1 (Coming Soon)
```

## Authentication
All authenticated endpoints require a Bearer token in the Authorization header:
```
Authorization: Bearer YOUR_JWT_TOKEN
```

---

## Endpoints

### Authentication

#### POST /auth/connect
Connect wallet and generate JWT token

**Request Body:**
```json
{
  "address": "0x...",
  "signature": "0x...",
  "message": "Sign this message to authenticate with ZkCarel",
  "chainId": 1
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGc...",
    "expiresIn": 86400,
    "user": {
      "address": "0x...",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  }
}
```

---

### Swap & Bridge

#### POST /swap/quote
Get swap quote

**Request Body:**
```json
{
  "fromToken": "ETH",
  "toToken": "USDT",
  "amount": "1.5",
  "slippage": 0.5,
  "mode": "private"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "fromAmount": "1.5",
    "toAmount": "3247.82",
    "rate": "2165.21",
    "priceImpact": "0.12",
    "fee": "0.0075",
    "feeUSD": "16.24",
    "route": ["ETH", "wBTC", "USDT"],
    "estimatedGas": "0.002",
    "estimatedTime": "~3 min"
  }
}
```

#### POST /swap/execute
Execute swap transaction

**Request Body:**
```json
{
  "fromToken": "ETH",
  "toToken": "USDT",
  "amount": "1.5",
  "slippage": 0.5,
  "mode": "private",
  "deadline": 1800,
  "recipient": "0x..."
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "txHash": "0x...",
    "status": "pending",
    "fromAmount": "1.5",
    "toAmount": "3247.82"
  }
}
```

#### POST /bridge/quote
Get bridge quote for cross-chain transfers

**Request Body:**
```json
{
  "fromChain": "ethereum",
  "toChain": "starknet",
  "token": "ETH",
  "amount": "0.5"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "fromChain": "ethereum",
    "toChain": "starknet",
    "amount": "0.5",
    "estimatedReceive": "0.4985",
    "fee": "0.0015",
    "estimatedTime": "~10-15 min",
    "bridgeProvider": "StarkGate"
  }
}
```

---

### Limit Orders

#### POST /limit-order/create
Create a limit order

**Request Body:**
```json
{
  "type": "buy",
  "fromToken": "USDT",
  "toToken": "BTC",
  "price": "65000",
  "amount": "1000",
  "expiry": "7d",
  "recipient": "0x..."
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "orderId": "ORD_123456",
    "status": "active",
    "type": "buy",
    "fromToken": "USDT",
    "toToken": "BTC",
    "price": "65000",
    "amount": "1000",
    "filled": "0",
    "expiry": "2024-12-31T23:59:59Z",
    "createdAt": "2024-12-24T10:00:00Z"
  }
}
```

#### GET /limit-order/list
Get user's limit orders

**Query Parameters:**
- `status`: active | filled | expired | cancelled
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 10)

**Response:**
```json
{
  "success": true,
  "data": {
    "orders": [
      {
        "orderId": "ORD_123456",
        "status": "active",
        "type": "buy",
        "fromToken": "USDT",
        "toToken": "BTC",
        "price": "65000",
        "amount": "1000",
        "filled": "0",
        "createdAt": "2024-12-24T10:00:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 25
    }
  }
}
```

#### DELETE /limit-order/:orderId
Cancel a limit order

**Response:**
```json
{
  "success": true,
  "data": {
    "orderId": "ORD_123456",
    "status": "cancelled"
  }
}
```

---

### Staking

#### GET /stake/pools
Get available staking pools

**Response:**
```json
{
  "success": true,
  "data": {
    "pools": [
      {
        "poolId": "ETH_LIDO",
        "token": "ETH",
        "provider": "Lido",
        "apy": "4.2",
        "tvl": "1250000000",
        "lockPeriod": "flexible",
        "minStake": "0.01"
      }
    ]
  }
}
```

#### POST /stake/deposit
Stake tokens

**Request Body:**
```json
{
  "poolId": "ETH_LIDO",
  "amount": "1.5"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "stakeId": "STK_789012",
    "poolId": "ETH_LIDO",
    "amount": "1.5",
    "estimatedRewards": "0.063",
    "txHash": "0x..."
  }
}
```

#### POST /stake/withdraw
Withdraw staked tokens

**Request Body:**
```json
{
  "stakeId": "STK_789012",
  "amount": "1.5"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "stakeId": "STK_789012",
    "amount": "1.5",
    "rewards": "0.065",
    "txHash": "0x..."
  }
}
```

---

### Portfolio

#### GET /portfolio/balance
Get user's portfolio balance

**Response:**
```json
{
  "success": true,
  "data": {
    "totalValue": 100000,
    "pnl": 15200,
    "pnlPercent": 15.2,
    "assets": [
      {
        "symbol": "BTC",
        "name": "Bitcoin",
        "balance": "0.5",
        "value": 32500,
        "change": 12.5
      }
    ]
  }
}
```

#### GET /portfolio/history
Get portfolio value history

**Query Parameters:**
- `period`: 24h | 7d | 30d | all

**Response:**
```json
{
  "success": true,
  "data": {
    "history": [
      {
        "timestamp": "2024-12-24T00:00:00Z",
        "value": 85000
      }
    ]
  }
}
```

---

### Leaderboard

#### GET /leaderboard/:type
Get leaderboard data

**Parameters:**
- `type`: total | trading | referral

**Query Parameters:**
- `page`: Page number
- `limit`: Items per page

**Response:**
```json
{
  "success": true,
  "data": {
    "leaderboard": [
      {
        "rank": 1,
        "address": "0x...",
        "points": 45200,
        "change": 2
      }
    ],
    "userRank": {
      "rank": 15,
      "points": 25400
    }
  }
}
```

---

### Rewards & NFTs

#### GET /rewards/points
Get user points balance

**Response:**
```json
{
  "success": true,
  "data": {
    "lifetimePoints": 4200,
    "currentPoints": 5850,
    "tier": "Silver"
  }
}
```

#### POST /nft/mint
Mint discount NFT with points

**Request Body:**
```json
{
  "tier": "Bronze"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "nftId": "NFT_001",
    "tier": "Bronze",
    "discount": "5%",
    "uses": 5,
    "maxUses": 5,
    "pointsSpent": 1000,
    "txHash": "0x..."
  }
}
```

#### GET /nft/owned
Get user's owned NFTs

**Response:**
```json
{
  "success": true,
  "data": {
    "nfts": [
      {
        "nftId": "NFT_001",
        "tier": "Bronze",
        "discount": "5%",
        "uses": 3,
        "maxUses": 5,
        "status": "active"
      }
    ]
  }
}
```

---

### Referral

#### GET /referral/code
Get user's referral code

**Response:**
```json
{
  "success": true,
  "data": {
    "code": "CAREL_ABC123",
    "link": "https://zkcarel.io/ref/CAREL_ABC123",
    "totalReferrals": 25,
    "totalEarned": 1250
  }
}
```

#### GET /referral/stats
Get referral statistics

**Response:**
```json
{
  "success": true,
  "data": {
    "totalReferrals": 25,
    "activeReferrals": 18,
    "totalEarned": 1250,
    "tier": "Silver",
    "commission": "15%",
    "recent": [
      {
        "address": "0x...",
        "joinedAt": "2024-12-20T10:00:00Z",
        "earned": 50
      }
    ]
  }
}
```

---

### Faucet

#### POST /faucet/claim
Claim testnet tokens

**Request Body:**
```json
{
  "token": "BTC"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "token": "BTC",
    "amount": "0.001",
    "txHash": "0x...",
    "nextClaimIn": 86400
  }
}
```

---

## Error Codes

| Code | Message | Description |
|------|---------|-------------|
| 400 | Bad Request | Invalid request parameters |
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource not found |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server error |

**Error Response Format:**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_AMOUNT",
    "message": "Amount must be greater than 0",
    "details": {}
  }
}
```

---

## Rate Limits

- Public endpoints: 100 requests per minute
- Authenticated endpoints: 300 requests per minute
- Swap execution: 30 requests per minute

Headers included in responses:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640000000
```

---

## Webhooks

Subscribe to events via webhooks:

### Supported Events
- `swap.completed`
- `swap.failed`
- `order.filled`
- `order.expired`
- `stake.rewards`
- `nft.expired`

**Webhook Payload:**
```json
{
  "event": "swap.completed",
  "timestamp": "2024-12-24T10:00:00Z",
  "data": {
    "txHash": "0x...",
    "fromToken": "ETH",
    "toToken": "USDT",
    "amount": "1.5"
  }
}
```
