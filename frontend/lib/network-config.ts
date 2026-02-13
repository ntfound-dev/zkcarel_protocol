export const STARKNET_SEPOLIA_CHAIN_ID_TEXT = "SN_SEPOLIA"
export const STARKNET_SEPOLIA_CHAIN_ID_HEX = "0x534e5f5345504f4c4941"

export const EVM_SEPOLIA_CHAIN_ID = 11155111
export const EVM_SEPOLIA_CHAIN_ID_HEX = "0xaa36a7"
export const EVM_SEPOLIA_CHAIN_NAME = "Sepolia"

export const BITCOIN_TESTNET_LABEL = "Bitcoin Testnet"

export const ETHERSCAN_SEPOLIA_BASE_URL =
  process.env.NEXT_PUBLIC_ETHERSCAN_SEPOLIA_URL || "https://sepolia.etherscan.io"
export const STARKNET_EXPLORER_SEPOLIA_BASE_URL =
  process.env.NEXT_PUBLIC_STARKNET_EXPLORER_URL ||
  process.env.NEXT_PUBLIC_STARKSCAN_SEPOLIA_URL ||
  "https://sepolia.voyager.online"
export const STARKSCAN_SEPOLIA_BASE_URL = STARKNET_EXPLORER_SEPOLIA_BASE_URL
export const BTC_TESTNET_EXPLORER_BASE_URL =
  process.env.NEXT_PUBLIC_BTC_TESTNET_EXPLORER_URL || "https://mempool.space/testnet"

export function normalizeStarknetChainValue(chainId?: string): string {
  if (!chainId) return ""
  const normalized = chainId.trim()
  if (!normalized) return ""
  const upper = normalized.toUpperCase()
  if (!upper.startsWith("0X")) return upper
  const hexBody = upper.slice(2)
  if (!/^[0-9A-F]+$/.test(hexBody) || hexBody.length % 2 !== 0) return upper

  let decoded = ""
  for (let i = 0; i < hexBody.length; i += 2) {
    const byte = Number.parseInt(hexBody.slice(i, i + 2), 16)
    if (!Number.isFinite(byte)) return upper
    decoded += String.fromCharCode(byte)
  }
  return decoded.toUpperCase()
}

export function isStarknetSepolia(chainId?: string): boolean {
  const normalized = normalizeStarknetChainValue(chainId)
  return normalized.includes("SEPOLIA") || normalized === STARKNET_SEPOLIA_CHAIN_ID_TEXT
}

export type BtcAddressNetwork = "mainnet" | "testnet" | "unknown"

export function detectBtcAddressNetwork(address?: string | null): BtcAddressNetwork {
  if (!address) return "unknown"
  const lower = address.trim().toLowerCase()
  if (!lower) return "unknown"

  if (
    lower.startsWith("tb1") ||
    lower.startsWith("bcrt1") ||
    lower.startsWith("2") ||
    lower.startsWith("m") ||
    lower.startsWith("n")
  ) {
    return "testnet"
  }

  if (lower.startsWith("bc1") || lower.startsWith("1") || lower.startsWith("3")) {
    return "mainnet"
  }

  return "unknown"
}

export function formatNetworkLabel(network: "starknet" | "evm" | "btc"): string {
  if (network === "starknet") return "Starknet Sepolia"
  if (network === "evm") return "Ethereum Sepolia"
  return BITCOIN_TESTNET_LABEL
}
