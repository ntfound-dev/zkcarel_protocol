# ZkCarel - Privacy-First Crypto Trading Platform

ZkCarel is a next-generation decentralized trading platform that combines zero-knowledge privacy, cross-chain bridging, limit orders, staking, and an innovative NFT-based discount system. Built with a cyberpunk aesthetic and powered by advanced DeFi protocols.

## Features

### 🔒 Privacy-First Trading
- **Zero-Knowledge Swaps**: Trade with complete privacy using ZK-proof technology
- **Dual Mode Trading**: Choose between transparent (lower fees) or private (maximum privacy) modes
- **Encrypted Transactions**: All private mode transactions are shielded from public view

### 💱 Unified Trading Interface
- **Instant Swaps**: Best execution across multiple DEXs and liquidity sources
- **Cross-Chain Bridge**: Seamlessly move assets between Ethereum, Starknet, and more
- **Route Optimization**: Automatically finds the most efficient swap paths
- **Real-time Quotes**: Live pricing with minimal slippage

### 📊 Limit Orders
- **Set and Forget**: Create limit buy/sell orders at your target price
- **Multiple Expiry Options**: 1 day, 1 week, 1 month, or custom duration
- **Partial Fills**: Orders can be filled partially as liquidity becomes available
- **Price Alerts**: Get notified when your orders execute

### 💎 Stake & Earn
- **Multiple Staking Pools**: Stake ETH, BTC, STRK, CAREL, USDT, and USDC
- **Flexible or Locked**: Choose between flexible (withdraw anytime) or locked staking for higher APY
- **Auto-Compounding**: Rewards automatically compound for maximum yield
- **Multiple Providers**: Integrated with Lido, Aave, and Compound

### 🎮 NFT Discount System
- **Fee Discounts**: Mint NFTs with points to get 5%-50% trading fee discounts
- **Limited Uses**: Each NFT has a set number of uses (5-20 transactions)
- **Non-Transferable**: NFTs are soulbound to prevent abuse
- **Tiered System**: Bronze (5%), Silver (10%), Gold (25%), Platinum (35%), Onyx (50%)
- **Points-Based**: Mint NFTs using points earned from trading activity

### 🏆 Loyalty & Rewards
- **Lifetime Points**: Accumulate EverPoints based on total trading volume
- **Current Points**: Spendable points for NFT minting or CAREL conversion
- **Tier Progression**: Progress through Bronze, Silver, Gold, Platinum, and Onyx tiers
- **Seasonal Leaderboard**: Compete for top rankings and exclusive rewards

### 👥 Referral Program
- **Earn Commissions**: Get 5%-20% commission on referral trading fees
- **Tiered Rewards**: Higher tiers earn more per referral
- **Lifetime Earnings**: Track total earnings from all referrals
- **Social Sharing**: One-click share to Twitter, Telegram, and Discord

### 🌐 Multi-Chain Support
- Ethereum (Mainnet & Sepolia)
- Starknet (Mainnet & Goerli)
- More chains coming soon

## Tech Stack

### Frontend
- **Next.js 16**: React framework with App Router
- **TypeScript**: Type-safe development
- **Tailwind CSS v4**: Modern utility-first styling
- **shadcn/ui**: Beautiful component library
- **Zustand**: Lightweight state management
- **Recharts**: Advanced data visualization

### Smart Contracts
- **Solidity 0.8.x**: Ethereum smart contracts
- **Cairo**: Starknet smart contracts
- **OpenZeppelin**: Security-audited contract libraries
- **Hardhat**: Development and testing framework

### Design
- **Cyberpunk Theme**: Neon colors, glass morphism, and futuristic UI
- **Dark/Light Modes**: "Private" (dark) and "Transparent" (light) themes
- **Responsive**: Mobile-first design that works on all devices
- **Animations**: Smooth transitions and particle effects

## Getting Started

### Prerequisites
```bash
node >= 18.0.0
npm >= 9.0.0
```

### Installation

1. Clone the repository:
```bash
git clone https://github.com/zkcarel/zkcarel.git
cd zkcarel
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env.local
```

Edit `.env.local` with your configuration:
```env
NEXT_PUBLIC_NETWORK=testnet
NEXT_PUBLIC_API_URL=https://api-testnet.zkcarel.io/v1
NEXT_PUBLIC_ROUTER_ADDRESS=0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
NEXT_PUBLIC_NFT_ADDRESS=0x8f7B2aC9F4d8C5e4d5F9A3cB1E6D7f8a9c0b1d2e
```

4. Run the development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the application.

### Build for Production
```bash
npm run build
npm run start
```

## Project Structure

```
zkcarel/
├── app/                    # Next.js app directory
│   ├── layout.tsx         # Root layout
│   ├── page.tsx           # Homepage
│   └── globals.css        # Global styles & theme
├── components/            # React components
│   ├── enhanced-navigation.tsx    # Main navigation with wallet
│   ├── featured-cards.tsx         # Homepage feature cards
│   ├── trading-interface.tsx      # Swap & bridge UI
│   ├── limit-order.tsx            # Limit order interface
│   ├── stake-earn.tsx             # Staking interface
│   ├── portfolio-dashboard.tsx    # Portfolio overview
│   ├── leaderboard.tsx            # Rankings
│   ├── rewards-hub.tsx            # NFTs & loyalty
│   ├── referral-system.tsx        # Referral program
│   ├── settings-page.tsx          # User settings
│   ├── floating-ai-assistant.tsx  # AI chatbot
│   └── ui/                        # shadcn/ui components
├── hooks/                 # Custom React hooks
│   ├── use-wallet.ts     # Wallet connection
│   ├── use-notifications.ts       # Notifications
│   └── use-mobile.ts     # Mobile detection
├── lib/                  # Utilities
│   └── utils.ts          # Helper functions
├── docs/                 # Documentation
│   ├── API.md           # API documentation
│   └── ABI.md           # Smart contract ABIs
└── public/              # Static assets
```

## Key Components

### Navigation
- Wallet connection (MetaMask, OKX, WalletConnect, Coinbase, Trust Wallet)
- Network selector (Testnet/Mainnet)
- Faucet for testnet tokens (BTC, STRK, CAREL)
- Deposit options (Bank Transfer, QRIS, Visa/Mastercard)
- Notifications panel
- Transaction history
- Help center

### Trading
- Token selection with search
- Amount input with max button
- Mode toggle (Private/Transparent)
- Route visualization
- Price impact and fee display
- Slippage and deadline settings
- Execute with confirmation flow

### Limit Orders
- Buy/Sell tabs
- Price chart integration
- Target price with percentage presets
- Amount input
- Expiry selection
- Custom recipient address
- Active orders list with cancel functionality

### Staking
- Stablecoin pools (USDT, USDC)
- Crypto pools (BTC, ETH, STRK, CAREL)
- Provider selection (Lido, Aave, Compound)
- APY display
- TVL (Total Value Locked)
- Flexible/Locked period selection
- Staking positions tracker
- Rewards calculator

### NFT Discount System
- 6 tiers: None, Bronze, Silver, Gold, Platinum, Onyx
- Uses counter (5-20 per NFT)
- Point-based minting
- Non-transferable (soulbound)
- Active NFT display
- Automatic expiry when uses depleted
- Re-mint option

### Portfolio
- Total value display
- PnL (Profit & Loss) tracking
- Asset allocation chart
- Individual asset cards
- Historical performance graph
- Transaction history
- View details dialog

### Leaderboard
- Three tabs: Total Points, Trading Volume, Referrals
- Top 100 rankings
- User position highlight
- Position change indicators
- Season countdown

### Rewards Hub
- Lifetime points (EverPoints)
- Current spendable points
- Tier progression bar
- Points to CAREL conversion
- NFT gallery
- How it works guide

### Referral System
- Unique referral code
- Shareable link
- Copy to clipboard
- Social media share buttons
- Commission tier display
- Total referrals count
- Earnings tracker
- Recent referrals list

## API Integration

### REST API
Base URL: `https://api-testnet.zkcarel.io/v1`

See [API.md](./docs/API.md) for complete documentation.

Example swap quote request:
```typescript
const response = await fetch('https://api-testnet.zkcarel.io/v1/swap/quote', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_JWT_TOKEN'
  },
  body: JSON.stringify({
    fromToken: 'ETH',
    toToken: 'USDT',
    amount: '1.5',
    slippage: 0.5,
    mode: 'private'
  })
});

const data = await response.json();
```

### Smart Contracts
See [ABI.md](./docs/ABI.md) for contract addresses and ABIs.

Example swap execution:
```typescript
import { ethers } from 'ethers';

const router = new ethers.Contract(ROUTER_ADDRESS, routerABI, signer);

const tx = await router.swap(
  fromToken,
  toToken,
  amountIn,
  minAmountOut,
  recipient,
  deadline,
  usePrivateMode,
  { value: ethValue }
);

await tx.wait();
```

## Testing

### Run Tests
```bash
npm run test
```

### Test Coverage
```bash
npm run test:coverage
```

### E2E Tests
```bash
npm run test:e2e
```

## Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Style
- Follow the existing code style
- Use TypeScript for type safety
- Write meaningful commit messages
- Add tests for new features
- Update documentation

### Development Guidelines
- Use semantic HTML
- Follow accessibility best practices
- Optimize for performance
- Mobile-first responsive design
- Test on multiple browsers

## Security

### Audits
- CertiK Audit: Completed (Dec 2024)
- SlowMist Audit: Completed (Nov 2024)

### Bug Bounty
We have an active bug bounty program on Immunefi. Report vulnerabilities to earn rewards up to $100,000.

### Responsible Disclosure
If you discover a security vulnerability, please email security@zkcarel.io. Do not open public issues for security vulnerabilities.

## Roadmap

### Q1 2025
- [x] Testnet launch
- [x] Swap & Bridge functionality
- [x] Limit orders
- [x] Staking pools
- [x] NFT discount system
- [ ] Mainnet launch
- [ ] Mobile app (iOS/Android)

### Q2 2025
- [ ] Advanced charting tools
- [ ] Portfolio analytics
- [ ] Automated trading strategies
- [ ] Governance token launch
- [ ] DAO implementation

### Q3 2025
- [ ] Options trading
- [ ] Lending/Borrowing
- [ ] Perpetual futures
- [ ] Cross-margin trading
- [ ] Additional chain integrations

### Q4 2025
- [ ] Mobile wallet integration
- [ ] Fiat on/off ramp
- [ ] Credit card purchases
- [ ] Social trading features
- [ ] API for third-party integrations

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Links

- **Website**: https://zkcarel.io
- **Documentation**: https://docs.zkcarel.io
- **Twitter**: https://x.com/zkcarel
- **Telegram**: https://t.me/zkcarel
- **Discord**: https://discord.gg/zkcarel
- **GitHub**: https://github.com/zkcarel
- **Medium**: https://medium.com/@zkcarel

## Support

Need help? Reach out to us:
- Email: support@zkcarel.io
- Discord: https://discord.gg/zkcarel
- Telegram: https://t.me/zkcarel_support
- Documentation: https://docs.zkcarel.io

## Acknowledgments

- OpenZeppelin for secure smart contract libraries
- shadcn/ui for beautiful components
- Tailwind CSS for styling utilities
- Vercel for hosting and deployment
- All our contributors and community members

---

**Built with ❤️ by the ZkCarel Team**

*Trade with privacy. Trade with confidence. Trade with ZkCarel.*
