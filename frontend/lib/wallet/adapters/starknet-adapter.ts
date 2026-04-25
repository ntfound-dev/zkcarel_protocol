import {
  STARKNET_API_VERSIONS,
  STARKNET_PROVIDER_ID_ALIASES,
  STARKNET_SWITCH_CHAIN_PAYLOADS,
  type WalletProviderType,
} from "@/lib/wallet-provider-config"
import { STARKNET_SEPOLIA_CHAIN_ID_TEXT, isStarknetSepolia, normalizeStarknetChainValue } from "@/lib/network-config"
import {
  normalizeSignatureValue,
  normalizeTokenBalance,
  signatureToHex,
  toShortString,
} from "@/lib/wallet/wallet-utils"

export type InjectedStarknet = {
  id?: string
  name?: string
  version?: string
  icon?: string | { dark?: string; light?: string }
  enable?: (opts?: { showModal?: boolean }) => Promise<void>
  selectedAddress?: string
  chainId?: string
  request?: (payload: { type?: string; method?: string; params?: unknown }) => Promise<unknown>
  on?: (...args: any[]) => void
  off?: (...args: any[]) => void
  account?: {
    address?: string
    signMessage?: (typedData: Record<string, any>) => Promise<any>
    getChainId?: () => Promise<unknown> | unknown
  }
  provider?: {
    getChainId?: () => Promise<unknown> | unknown
  }
}

function isUsableStarknetInjected(candidate: unknown): candidate is InjectedStarknet {
  if (!candidate || typeof candidate !== "object") return false
  const injected = candidate as InjectedStarknet
  return (
    typeof injected.request === "function" ||
    typeof injected.enable === "function" ||
    typeof injected.account?.signMessage === "function" ||
    typeof injected.account?.address === "string"
  )
}

function pickInjectedStarknet(...candidates: unknown[]): InjectedStarknet | null {
  for (const candidate of candidates) {
    if (isUsableStarknetInjected(candidate)) {
      return candidate
    }
  }
  return null
}

export function getInjectedStarknet(provider?: WalletProviderType): InjectedStarknet | null {
  if (typeof window === "undefined") return null
  const anyWindow = window as any
  const starknetDefault = anyWindow.starknet
  const starknetArgent =
    anyWindow.starknet_argentX ||
    anyWindow.argentX?.starknet ||
    anyWindow.argent?.starknet ||
    anyWindow.argentX
  const starknetBraavos =
    anyWindow.starknet_braavos ||
    anyWindow.braavos?.starknet ||
    anyWindow.braavosWallet?.starknet ||
    anyWindow.braavosStarknet
  const fallbackDefault = pickInjectedStarknet(starknetDefault)
  const hasConnectedAddress = (candidate: InjectedStarknet | null) =>
    Boolean(candidate?.selectedAddress || candidate?.account?.address)

  if (provider === "argentx") {
    const direct = pickInjectedStarknet(starknetArgent)
    if (direct) return direct
    if (fallbackDefault && hasStarknetProviderAlias(fallbackDefault, STARKNET_PROVIDER_ID_ALIASES.argentx)) {
      return fallbackDefault
    }
    return null
  }
  if (provider === "braavos") {
    const direct = pickInjectedStarknet(starknetBraavos)
    if (direct) return direct
    if (fallbackDefault && hasStarknetProviderAlias(fallbackDefault, STARKNET_PROVIDER_ID_ALIASES.braavos)) {
      return fallbackDefault
    }
    return null
  }
  const connected =
    (hasConnectedAddress(pickInjectedStarknet(starknetArgent)) &&
      pickInjectedStarknet(starknetArgent)) ||
    (hasConnectedAddress(pickInjectedStarknet(starknetBraavos)) &&
      pickInjectedStarknet(starknetBraavos)) ||
    (hasConnectedAddress(fallbackDefault) && fallbackDefault) ||
    null
  return connected || pickInjectedStarknet(starknetDefault, starknetArgent, starknetBraavos)
}

export function isStarknetWalletProvider(
  provider: WalletProviderType
): provider is "starknet" | "argentx" | "braavos" {
  return provider === "starknet" || provider === "argentx" || provider === "braavos"
}

export async function connectStarknetWallet(provider: WalletProviderType): Promise<InjectedStarknet | null> {
  const injected = getInjectedStarknet(provider)

  try {
    const coreMod = await import("@starknet-io/get-starknet-core")
    const getStarknetCore = (coreMod as any).getStarknet as (() => any) | undefined
    if (getStarknetCore) {
      const core = getStarknetCore()
      const available = (await core.getAvailableWallets()) as InjectedStarknet[]
      const lastConnected = (await core.getLastConnectedWallet().catch(() => null)) as
        | InjectedStarknet
        | null
      const selected = selectStarknetWallet(available, provider, lastConnected)
      if (selected) {
        const enabled = (await core.enable(selected)) as InjectedStarknet
        return pickInjectedStarknet(enabled, injected)
      }
    }
  } catch (error) {
    console.warn("get-starknet-core connect failed:", error)
  }

  try {
    const mod = await import("@starknet-io/get-starknet")
    const connect = (mod as any).connect as (opts?: any) => Promise<InjectedStarknet | null>
    if (connect) {
      const include = getStarknetIncludeFilter(provider)
      const connected = await connect({
        modalMode: "alwaysAsk",
        include,
      })
      if (isUsableStarknetInjected(connected)) {
        return connected
      }
    }
  } catch (error) {
    console.warn("get-starknet connect failed:", error)
  }

  return injected || null
}

function getStarknetIncludeFilter(provider: WalletProviderType): string[] | undefined {
  if (provider === "argentx" || provider === "braavos") {
    return STARKNET_PROVIDER_ID_ALIASES[provider]
  }
  return undefined
}

function selectStarknetWallet(
  wallets: InjectedStarknet[],
  provider: WalletProviderType,
  lastConnected?: InjectedStarknet | null
): InjectedStarknet | null {
  if (!wallets?.length) return lastConnected || null

  if (provider === "starknet") {
    if (lastConnected) {
      const match = wallets.find((wallet) => wallet.id === lastConnected.id)
      if (match) return match
    }
    return wallets[0]
  }

  if (provider === "argentx" || provider === "braavos") {
    const aliases = STARKNET_PROVIDER_ID_ALIASES[provider]
    const match = wallets.find((wallet) => hasStarknetProviderAlias(wallet, aliases))
    if (match) return match
  }

  return wallets[0] || null
}

function hasStarknetProviderAlias(wallet: InjectedStarknet, aliases: string[]): boolean {
  const id = normalizeProviderHint(wallet.id)
  const name = normalizeProviderHint(wallet.name)
  return aliases.some((alias) => {
    const needle = normalizeProviderHint(alias)
    return (!!id && id.includes(needle)) || (!!name && name.includes(needle))
  })
}

function normalizeProviderHint(value?: string): string {
  if (!value) return ""
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

export async function signStarknetMessage(
  injected: InjectedStarknet,
  address: string,
  message: string,
  chainIdOverride?: string
): Promise<string | null> {
  if (!address) return null
  const shortMessage = toShortString(message)
  const typedData = {
    domain: {
      name: "Carel Protocol",
      version: "1",
      chainId: chainIdOverride || injected.chainId || STARKNET_SEPOLIA_CHAIN_ID_TEXT,
    },
    types: {
      StarkNetDomain: [
        { name: "name", type: "felt" },
        { name: "version", type: "felt" },
        { name: "chainId", type: "felt" },
      ],
      Message: [
        { name: "address", type: "felt" },
        { name: "contents", type: "felt" },
      ],
    },
    primaryType: "Message",
    message: {
      address,
      contents: shortMessage,
    },
  }

  if (injected.request) {
    try {
      const signature = await requestStarknet(injected, {
        type: "wallet_signTypedData",
        params: typedData as unknown,
      })
      const normalized = normalizeSignatureValue(signature)
      if (normalized) return normalized
    } catch {
      // fall back to legacy signer
    }
  }

  if (!injected.account?.signMessage) return null
  try {
    const signature = await injected.account.signMessage(typedData)
    return signatureToHex(signature)
  } catch {
    return null
  }
}

export async function requestAccounts(injected: InjectedStarknet): Promise<string[] | null> {
  if (injected.request) {
    const attempts: Array<{ type: string; params?: unknown }> = [{ type: "wallet_requestAccounts" }]
    STARKNET_API_VERSIONS.forEach((version) => {
      attempts.push({
        type: "wallet_requestAccounts",
        params: { api_version: version },
      })
      attempts.push({
        type: "wallet_requestAccounts",
        params: { api_version: version, silent_mode: false },
      })
    })
    attempts.push({ type: "wallet_requestAccounts", params: { silent_mode: false } })
    for (const payload of attempts) {
      try {
        const result = await requestStarknet(injected, payload)
        rememberStarknetSelectedAddress(injected, result)
        if (Array.isArray(result)) {
          return result as string[]
        }
      } catch (error) {
        console.warn("wallet_requestAccounts failed:", error)
      }
    }
  }

  if (injected.enable) {
    try {
      const result = await injected.enable({ showModal: true })
      rememberStarknetSelectedAddress(injected, result)
      if (Array.isArray(result)) {
        return result as string[]
      }
    } catch (error) {
      console.warn("wallet enable failed:", error)
    }
  }

  return null
}

export async function fetchStarknetBalance(
  injected: InjectedStarknet,
  address: string,
  tokenAddress: string,
  decimals: number
): Promise<number | null> {
  return fetchStarknetTokenBalance(injected, address, tokenAddress, decimals)
}

export async function fetchStarknetTokenBalance(
  injected: InjectedStarknet,
  address: string,
  tokenAddress: string,
  decimals: number
): Promise<number | null> {
  const target: any = injected.account || injected
  if (!target?.getBalance || !address || !tokenAddress) return null

  const attempts = [
    () => target.getBalance(address, "latest", tokenAddress),
    () => target.getBalance(address, tokenAddress),
    () => target.getBalance(tokenAddress),
  ]

  for (const attempt of attempts) {
    try {
      const raw = await attempt()
      const normalized = normalizeStarknetTokenBalance(raw, decimals)
      if (normalized !== null) return normalized
    } catch {
      // try next signature
    }
  }

  return null
}

function normalizeStarknetTokenBalance(raw: any, decimals: number): number | null {
  return normalizeTokenBalance(raw, decimals)
}

export async function ensureStarknetSepolia(injected: InjectedStarknet): Promise<string | undefined> {
  let chainId = await readStarknetChainId(injected)
  if (isStarknetSepolia(chainId)) return chainId
  if (!injected.request) return chainId

  for (const payload of STARKNET_SWITCH_CHAIN_PAYLOADS) {
    try {
      await requestStarknet(injected, payload)
      chainId = await readStarknetChainId(injected)
      if (isStarknetSepolia(chainId)) return chainId
    } catch {
      // try next payload signature
    }
  }

  return chainId
}

export async function readStarknetChainId(injected: InjectedStarknet): Promise<string | undefined> {
  const fromCurrent = parseStarknetChainIdResult(injected.chainId)
  if (fromCurrent) {
    injected.chainId = fromCurrent
    return fromCurrent
  }

  const fromCurrentObject =
    parseStarknetChainIdResult((injected as { chain_id?: unknown }).chain_id) ||
    parseStarknetChainIdResult((injected as { network?: unknown }).network)
  if (fromCurrentObject) {
    injected.chainId = fromCurrentObject
    return fromCurrentObject
  }

  const attempts: Array<{ type: string; params?: unknown }> = [
    { type: "wallet_getChainId" },
    { type: "wallet_requestChainId" },
  ]
  STARKNET_API_VERSIONS.forEach((version) => {
    attempts.push({ type: "wallet_getChainId", params: { api_version: version } })
    attempts.push({ type: "wallet_requestChainId", params: { api_version: version } })
  })
  attempts.push({ type: "starknet_chainId" })
  attempts.push({ type: "starknet_getChainId" })
  attempts.push({ type: "wallet_chainId" })
  attempts.push({ type: "getChainId" })

  if (injected.request) {
    for (const payload of attempts) {
      try {
        const result = await requestStarknet(injected, payload)
        const parsed = parseStarknetChainIdResult(result)
        if (parsed) {
          injected.chainId = parsed
          return parsed
        }
      } catch {
        // try next request type
      }
    }
  }

  const fromAccountField =
    parseStarknetChainIdResult((injected.account as { chainId?: unknown } | undefined)?.chainId) ||
    parseStarknetChainIdResult((injected.account as { chain_id?: unknown } | undefined)?.chain_id) ||
    parseStarknetChainIdResult((injected.account as { network?: unknown } | undefined)?.network)
  if (fromAccountField) {
    injected.chainId = fromAccountField
    return fromAccountField
  }

  const fromAccount = await readStarknetChainIdFromGetter(injected.account?.getChainId)
  if (fromAccount) {
    injected.chainId = fromAccount
    return fromAccount
  }

  const fromProviderField =
    parseStarknetChainIdResult((injected.provider as { chainId?: unknown } | undefined)?.chainId) ||
    parseStarknetChainIdResult((injected.provider as { chain_id?: unknown } | undefined)?.chain_id) ||
    parseStarknetChainIdResult((injected.provider as { network?: unknown } | undefined)?.network)
  if (fromProviderField) {
    injected.chainId = fromProviderField
    return fromProviderField
  }

  const fromProvider = await readStarknetChainIdFromGetter(injected.provider?.getChainId)
  if (fromProvider) {
    injected.chainId = fromProvider
    return fromProvider
  }

  return injected.chainId
}

async function requestStarknet(
  injected: InjectedStarknet,
  payload: { type: string; params?: unknown }
): Promise<unknown> {
  if (!injected.request) {
    throw new Error("Injected Starknet wallet does not support request().")
  }
  const variants = buildStarknetRequestVariants(payload)
  let lastError: unknown = null
  for (const variant of variants) {
    try {
      return await injected.request(variant)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error("Starknet wallet request failed.")
}

function buildStarknetRequestVariants(payload: {
  type: string
  params?: unknown
}): Array<{ type?: string; method?: string; params?: unknown }> {
  const variants: Array<{ type?: string; method?: string; params?: unknown }> = [
    { type: payload.type, params: payload.params },
    { method: payload.type, params: payload.params },
  ]

  if (payload.params !== undefined && !Array.isArray(payload.params)) {
    variants.push({ type: payload.type, params: [payload.params] })
    variants.push({ method: payload.type, params: [payload.params] })
  }

  return variants
}

function parseStarknetChainIdResult(result: unknown): string | null {
  if (typeof result === "string" && result) {
    const trimmed = result.trim()
    if (!trimmed) return null
    const upper = trimmed.toUpperCase()
    if (upper === "UNKNOWN" || upper === "NULL" || upper === "UNDEFINED") return null
    return trimmed
  }
  if (typeof result === "number" && Number.isFinite(result)) {
    return `0x${Math.floor(result).toString(16)}`
  }
  if (typeof result === "bigint") {
    return `0x${result.toString(16)}`
  }
  if (Array.isArray(result) && typeof result[0] === "string" && result[0]) {
    return result[0]
  }
  if (Array.isArray(result) && result[0] !== undefined) {
    return parseStarknetChainIdResult(result[0])
  }
  if (typeof result === "object" && result) {
    const fromChainId = parseStarknetChainIdResult((result as { chainId?: unknown }).chainId)
    if (fromChainId) return fromChainId
    const fromChainIdSnake = parseStarknetChainIdResult((result as { chain_id?: unknown }).chain_id)
    if (fromChainIdSnake) return fromChainIdSnake
    const fromNetwork = parseStarknetChainIdResult((result as { network?: unknown }).network)
    if (fromNetwork) return fromNetwork
    const fromNetworkId = parseStarknetChainIdResult((result as { networkId?: unknown }).networkId)
    if (fromNetworkId) return fromNetworkId
    const fromNetworkIdSnake = parseStarknetChainIdResult((result as { network_id?: unknown }).network_id)
    if (fromNetworkIdSnake) return fromNetworkIdSnake
    const fromChain = parseStarknetChainIdResult((result as { chain?: unknown }).chain)
    if (fromChain) return fromChain
    const fromValue = parseStarknetChainIdResult((result as { value?: unknown }).value)
    if (fromValue) return fromValue
    const fromResult = parseStarknetChainIdResult((result as { result?: unknown }).result)
    if (fromResult) return fromResult
    const fromData = parseStarknetChainIdResult((result as { data?: unknown }).data)
    if (fromData) return fromData
    const fromPayload = parseStarknetChainIdResult((result as { payload?: unknown }).payload)
    if (fromPayload) return fromPayload
  }
  return null
}

export function isReadableStarknetChainId(chainId?: string): boolean {
  if (!chainId) return false
  const normalized = normalizeStarknetChainValue(chainId)
  if (!normalized) return false
  const upper = normalized.trim().toUpperCase()
  return upper !== "UNKNOWN" && upper !== "NULL" && upper !== "UNDEFINED"
}

async function readStarknetChainIdFromGetter(
  getter?: (() => Promise<unknown> | unknown) | null
): Promise<string | undefined> {
  if (!getter) return undefined
  try {
    const result = await getter()
    return parseStarknetChainIdResult(result) || undefined
  } catch {
    return undefined
  }
}

function rememberStarknetSelectedAddress(injected: InjectedStarknet, result: unknown): string | null {
  const address =
    parseStarknetAddressResult(result) ||
    parseStarknetAddressResult(injected.selectedAddress) ||
    parseStarknetAddressResult(injected.account?.address)
  if (address) {
    injected.selectedAddress = address
    return address
  }
  return null
}

function parseStarknetAddressResult(result: unknown): string | null {
  if (typeof result === "string") {
    const trimmed = result.trim()
    if (/^0x[0-9a-fA-F]+$/.test(trimmed)) return trimmed
    return null
  }
  if (Array.isArray(result)) {
    for (const item of result) {
      const parsed = parseStarknetAddressResult(item)
      if (parsed) return parsed
    }
    return null
  }
  if (typeof result === "object" && result) {
    return (
      parseStarknetAddressResult((result as { address?: unknown }).address) ||
      parseStarknetAddressResult((result as { selectedAddress?: unknown }).selectedAddress) ||
      parseStarknetAddressResult((result as { account?: unknown }).account) ||
      parseStarknetAddressResult((result as { accounts?: unknown }).accounts) ||
      parseStarknetAddressResult((result as { result?: unknown }).result) ||
      parseStarknetAddressResult((result as { data?: unknown }).data)
    )
  }
  return null
}
