import {
  EVM_SEPOLIA_CHAIN_ID,
  EVM_SEPOLIA_CHAIN_ID_HEX,
} from "@/lib/network-config"
import { EVM_SEPOLIA_CHAIN_PARAMS, type WalletProviderType } from "@/lib/wallet-provider-config"
import {
  normalizeEvmBalance,
  normalizeEvmDecimals,
  parseBigIntLike,
  sanitizeEvmAddress,
  sanitizeEvmAddressToWord,
  scaleBigIntBalance,
} from "@/lib/wallet/wallet-utils"

export type InjectedEvm = {
  isMetaMask?: boolean
  request: (payload: { method: string; params?: unknown[] }) => Promise<any>
  providers?: InjectedEvm[]
}

export function getInjectedEvm(provider: WalletProviderType): InjectedEvm | null {
  if (typeof window === "undefined") return null
  const anyWindow = window as any
  const ethereum = anyWindow.ethereum as InjectedEvm | undefined
  const providers = ethereum?.providers?.length ? ethereum.providers : []

  const isMetaMask = (p?: InjectedEvm) => !!p?.isMetaMask

  if (provider === "metamask") {
    if (providers.length) {
      const match = providers.find((p) => isMetaMask(p))
      if (match) return match
    }
    if (ethereum && isMetaMask(ethereum)) return ethereum
    return null
  }

  return ethereum || null
}

export function getPreferredEvmProvider(provider?: WalletProviderType | null): InjectedEvm | null {
  if (provider === "metamask") {
    return getInjectedEvm("metamask")
  }
  return getInjectedEvm("metamask")
}

export async function ensureEvmSepolia(injected: InjectedEvm): Promise<number> {
  let chainId = await readEvmChainId(injected)
  if (chainId === EVM_SEPOLIA_CHAIN_ID) return chainId

  try {
    await injected.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: EVM_SEPOLIA_CHAIN_ID_HEX }],
    })
  } catch (error: any) {
    const code = (error as { code?: number } | undefined)?.code
    if (code === 4902) {
      await injected.request({
        method: "wallet_addEthereumChain",
        params: [EVM_SEPOLIA_CHAIN_PARAMS],
      })
    } else {
      throw error
    }
  }

  chainId = await readEvmChainId(injected)
  return chainId
}

export async function fetchEvmBalance(injected: InjectedEvm, address: string): Promise<number | null> {
  try {
    const raw = await injected.request({ method: "eth_getBalance", params: [address, "latest"] })
    return normalizeEvmBalance(raw)
  } catch {
    return null
  }
}

export async function fetchEvmErc20Balance(
  injected: InjectedEvm,
  address: string,
  tokenAddress: string
): Promise<number | null> {
  if (!address || !tokenAddress) return null
  try {
    const owner = sanitizeEvmAddressToWord(address)
    const token = sanitizeEvmAddress(tokenAddress)
    if (!owner || !token) return null

    const rawBalance = await injected.request({
      method: "eth_call",
      params: [{ to: token, data: `0x70a08231${owner}` }, "latest"],
    })
    const rawDecimals = await injected.request({
      method: "eth_call",
      params: [{ to: token, data: "0x313ce567" }, "latest"],
    })

    const balance = parseBigIntLike(rawBalance)
    const decimals = normalizeEvmDecimals(rawDecimals)
    if (balance === null) return null
    return scaleBigIntBalance(balance, decimals)
  } catch {
    return null
  }
}

async function readEvmChainId(injected: InjectedEvm): Promise<number> {
  const chainHex = await injected.request({ method: "eth_chainId" })
  return parseEvmChainId(chainHex)
}

function parseEvmChainId(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    if (value.startsWith("0x")) {
      const parsed = Number.parseInt(value, 16)
      return Number.isFinite(parsed) ? parsed : 0
    }
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}
