import type { TokenCatalogItem } from "@/lib/trading-types"

export type TokenMeta = {
  symbol: string
  name: string
  icon: string
  network: string
}

export const tokenMetaCatalog: TokenMeta[] = [
  { symbol: "BTC", name: "Bitcoin", icon: "₿", network: "Bitcoin Testnet" },
  { symbol: "ETH", name: "Ethereum", icon: "Ξ", network: "Ethereum Sepolia" },
  { symbol: "STRK", name: "StarkNet", icon: "◈", network: "Starknet Sepolia" },
  { symbol: "CAREL", name: "Carel Protocol", icon: "◇", network: "Starknet Sepolia" },
  { symbol: "USDC", name: "USD Coin", icon: "⭕", network: "Starknet Sepolia" },
  { symbol: "USDT", name: "Tether", icon: "₮", network: "Starknet Sepolia" },
  { symbol: "WBTC", name: "Wrapped BTC", icon: "₿", network: "Starknet Sepolia" },
]

export const TRADING_SYMBOLS = ["BTC", "ETH", "STRK", "CAREL", "USDC", "USDT", "WBTC"]
export const MARKET_TICKER_SYMBOLS = ["BTC", "ETH", "STRK", "USDC", "USDT", "CAREL"]
export const LIMIT_ORDER_SYMBOLS = ["STRK", "WBTC", "CAREL", "USDT", "USDC"]

export const getTokenMetaBySymbols = (symbols: string[]) => {
  const symbolSet = new Set(symbols.map((symbol) => symbol.toUpperCase()))
  return tokenMetaCatalog.filter((token) => symbolSet.has(token.symbol))
}

export const getTradeTokenCatalog = (symbols: string[] = TRADING_SYMBOLS): TokenCatalogItem[] => {
  return getTokenMetaBySymbols(symbols).map((token) => ({
    symbol: token.symbol,
    name: token.name,
    icon: token.icon,
    price: 0,
    network: token.network,
  }))
}

export const tradeTokenCatalog = getTradeTokenCatalog()
export const marketTickerTokens = getTokenMetaBySymbols(MARKET_TICKER_SYMBOLS)
