import {
  EVM_SEPOLIA_CHAIN_ID_HEX,
  EVM_SEPOLIA_CHAIN_NAME,
  ETHERSCAN_SEPOLIA_BASE_URL,
  STARKNET_SEPOLIA_CHAIN_ID_HEX,
  STARKNET_SEPOLIA_CHAIN_ID_TEXT,
} from "@/lib/network-config"

export type WalletProviderType = "starknet" | "argentx" | "braavos" | "metamask"
export type BtcWalletProviderType = "braavos_btc" | "xverse" | "unisat"

export const WALLET_PROVIDERS: { id: WalletProviderType; name: string; icon: string }[] = [
  { id: "starknet", name: "Starknet (Auto)", icon: "✨" },
  { id: "argentx", name: "Argent X", icon: "🧡" },
  { id: "braavos", name: "Braavos", icon: "🟠" },
  { id: "metamask", name: "MetaMask (ETH Sepolia)", icon: "🦊" },
]

export const STARKNET_WALLET_PROVIDERS: { id: WalletProviderType; name: string; icon: string }[] =
  [
    { id: "braavos", name: "Braavos", icon: "🟠" },
    { id: "argentx", name: "Argent X", icon: "🧡" },
  ]

export const BTC_WALLET_PROVIDERS: { id: BtcWalletProviderType; name: string; icon: string }[] = [
  { id: "xverse", name: "Xverse (BTC)", icon: "🟧" },
]

export const STARKNET_PROVIDER_ID_ALIASES: Record<"argentx" | "braavos", string[]> = {
  argentx: ["argentx", "argent_x", "argent"],
  braavos: ["braavos", "braavoswallet"],
}

export const STARKNET_API_VERSIONS = ["0.8.0", "0.7.0"] as const

export const STARKNET_SWITCH_CHAIN_PAYLOADS: Array<{ type: string; params?: unknown }> = [
  { type: "wallet_switchStarknetChain", params: { chainId: STARKNET_SEPOLIA_CHAIN_ID_HEX } },
  { type: "wallet_switchStarknetChain", params: { chainId: STARKNET_SEPOLIA_CHAIN_ID_TEXT } },
  { type: "wallet_switchStarknetChain", params: [{ chainId: STARKNET_SEPOLIA_CHAIN_ID_HEX }] },
  { type: "wallet_switchStarknetChain", params: [{ chainId: STARKNET_SEPOLIA_CHAIN_ID_TEXT }] },
  { type: "wallet_switchStarknetChain", params: [STARKNET_SEPOLIA_CHAIN_ID_HEX] },
  { type: "wallet_switchStarknetChain", params: STARKNET_SEPOLIA_CHAIN_ID_HEX },
  {
    type: "wallet_switchStarknetChain",
    params: { chainId: STARKNET_SEPOLIA_CHAIN_ID_HEX, api_version: STARKNET_API_VERSIONS[0] },
  },
  {
    type: "wallet_switchStarknetChain",
    params: { chainId: STARKNET_SEPOLIA_CHAIN_ID_TEXT, api_version: STARKNET_API_VERSIONS[0] },
  },
]

export const EVM_SEPOLIA_CHAIN_PARAMS = {
  chainId: EVM_SEPOLIA_CHAIN_ID_HEX,
  chainName: EVM_SEPOLIA_CHAIN_NAME,
  nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: [process.env.NEXT_PUBLIC_EVM_SEPOLIA_RPC_URL || "https://rpc.sepolia.org"],
  blockExplorerUrls: [ETHERSCAN_SEPOLIA_BASE_URL],
}
