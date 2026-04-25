import { BTC_TESTNET_EXPLORER_BASE_URL, detectBtcAddressNetwork } from "@/lib/network-config"
import type { BtcWalletProviderType } from "@/lib/wallet-provider-config"
import {
  normalizeBtcAccounts,
  normalizeBtcAddress,
  normalizeBtcAuthSignature,
  normalizeBtcBalance,
  normalizeBtcTxHash,
  normalizeWalletError,
  withWalletTimeout,
} from "@/lib/wallet/wallet-utils"

const XVERSE_PROVIDER_ID = "XverseProviders.BitcoinProvider"
const XVERSE_CONNECT_MESSAGE = "Carel Protocol wants to connect your Bitcoin testnet wallet."

export type InjectedBtc = {
  request?: (payload: { method: string; params?: unknown[] }) => Promise<any>
  getAccounts?: () => Promise<string[]>
  requestAccounts?: () => Promise<string[]>
  signMessage?: (message: string, type?: string) => Promise<any>
  sendBitcoin?: (address: string, amount: number) => Promise<any>
  getBalance?: (address?: string) => Promise<any>
  getBalanceV2?: () => Promise<any>
  getChain?: () => Promise<any>
  switchChain?: (chain: string) => Promise<any>
  disconnect?: () => Promise<void>
}

type BtcChainInfo = {
  enum?: string
  name?: string
  network?: string
}

type SatsConnectResultLike<T> =
  | {
      status: "success"
      result: T
    }
  | {
      status: "error"
      error?: { message?: string }
    }

function isInjectedBtc(candidate: unknown): candidate is InjectedBtc {
  if (!candidate || typeof candidate !== "object") return false
  const provider = candidate as InjectedBtc
  return (
    typeof provider.request === "function" ||
    typeof provider.getAccounts === "function" ||
    typeof provider.requestAccounts === "function" ||
    typeof provider.getBalance === "function"
  )
}

function pickInjectedBtc(...candidates: unknown[]): InjectedBtc | null {
  for (const candidate of candidates) {
    if (isInjectedBtc(candidate)) return candidate
  }
  return null
}

export function getInjectedBtc(provider: BtcWalletProviderType): InjectedBtc | null {
  if (typeof window === "undefined") return null
  const anyWindow = window as any
  const genericBtc = pickInjectedBtc(
    anyWindow.btc,
    anyWindow.bitcoin,
    anyWindow.BitcoinProvider,
    anyWindow.satsConnect?.provider,
    anyWindow.leather?.bitcoin,
    anyWindow.okxwallet?.bitcoin
  )
  if (provider === "braavos_btc") {
    return pickInjectedBtc(
      anyWindow.braavos?.bitcoin ||
        anyWindow.braavos?.btc ||
        anyWindow.starknet_braavos?.bitcoin ||
        anyWindow.braavosWallet?.bitcoin ||
        anyWindow.braavosBtc,
      genericBtc
    )
  }
  if (provider === "xverse") {
    return pickInjectedBtc(
      anyWindow.xverse?.bitcoin ||
        anyWindow.xverseProviders?.bitcoin ||
        anyWindow.XverseProviders?.bitcoin ||
        anyWindow.XverseProviders?.BitcoinProvider ||
        anyWindow.BitcoinProvider,
      genericBtc
    )
  }
  if (provider === "unisat") {
    return pickInjectedBtc(anyWindow.unisat_wallet, anyWindow.unisatWallet, anyWindow.unisat, genericBtc)
  }
  return genericBtc
}

export async function requestBtcAccounts(
  injected: InjectedBtc,
  options?: { requireTestnet4?: boolean; timeoutMs?: number }
): Promise<string[] | null> {
  const requireTestnet4 = Boolean(options?.requireTestnet4)
  const timeoutMs =
    typeof options?.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
      ? Math.max(2_000, Math.floor(options.timeoutMs))
      : 10_000
  const attempts = requireTestnet4
    ? [
        () => injected.request?.({ method: "requestAccounts", params: [{ network: "testnet4" }] }),
        () => injected.request?.({ method: "requestAccounts", params: ["testnet4"] }),
        () => injected.requestAccounts?.(),
        () => injected.request?.({ method: "requestAccounts" }),
        () => injected.request?.({ method: "getAccounts", params: [{ network: "testnet4" }] }),
        () => injected.request?.({ method: "getAccounts", params: ["testnet4"] }),
        () => injected.getAccounts?.(),
        () => injected.request?.({ method: "getAccounts" }),
      ]
    : [
        () => injected.request?.({ method: "requestAccounts", params: [{ network: "testnet4" }] }),
        () => injected.request?.({ method: "requestAccounts", params: ["testnet4"] }),
        () => injected.requestAccounts?.(),
        () => injected.request?.({ method: "requestAccounts" }),
        () => injected.request?.({ method: "requestAccounts", params: [{ network: "testnet" }] }),
        () => injected.request?.({ method: "requestAccounts", params: ["testnet"] }),
        () => injected.request?.({ method: "getAccounts", params: [{ network: "testnet4" }] }),
        () => injected.request?.({ method: "getAccounts", params: ["testnet4"] }),
        () => injected.getAccounts?.(),
        () => injected.request?.({ method: "getAccounts" }),
        () => injected.request?.({ method: "getAccounts", params: [{ network: "testnet" }] }),
        () => injected.request?.({ method: "getAccounts", params: ["testnet"] }),
      ]

  for (const attempt of attempts) {
    try {
      const result = await withWalletTimeout(async () => await attempt(), timeoutMs, "BTC wallet account request timed out.")
      const parsed = normalizeBtcAccounts(result)
      if (parsed.length > 0) {
        return parsed
      }
    } catch {
      // try next
    }
  }
  return null
}

export async function requestBtcAuthSignature(
  injected: InjectedBtc | null,
  message: string
): Promise<string> {
  if (!injected) {
    return ""
  }
  const attempts = [
    () => injected.signMessage?.(message),
    () => injected.signMessage?.(message, "ecdsa"),
    () => injected.request?.({ method: "signMessage", params: [message] }),
    () => injected.request?.({ method: "signMessage", params: [message, "ecdsa"] }),
    () => injected.request?.({ method: "signMessage", params: [{ message }] }),
    () => injected.request?.({ method: "personal_sign", params: [message] }),
  ]
  for (const attempt of attempts) {
    try {
      const result = await attempt()
      return normalizeBtcAuthSignature(result)
    } catch {
      // try next
    }
  }
  return ""
}

export async function fetchBtcBalance(injected: InjectedBtc, address: string): Promise<number | null> {
  const attempts = [
    () => injected.getBalanceV2?.(),
    () => injected.request?.({ method: "getBalanceV2" }),
    () => injected.getBalance?.(address),
    () => injected.getBalance?.(),
    () => injected.request?.({ method: "getBalance", params: [address] }),
    () => injected.request?.({ method: "getBalance" }),
  ]

  for (const attempt of attempts) {
    try {
      const raw = await attempt()
      const normalized = normalizeBtcBalance(raw)
      if (normalized !== null) return normalized
    } catch {
      // try next
    }
  }
  return null
}

export async function fetchBtcBalanceFromPublicApis(address: string): Promise<number | null> {
  const normalizedAddress = address.trim()
  if (!normalizedAddress) return null

  const base = BTC_TESTNET_EXPLORER_BASE_URL.trim().replace(/\/+$/, "")
  const candidates = [
    `${base}/api/address/${normalizedAddress}`,
    "https://mempool.space/testnet/api/address/" + normalizedAddress,
    "https://blockstream.info/testnet/api/address/" + normalizedAddress,
  ]
  const seen = new Set<string>()

  for (const url of candidates) {
    if (!url || seen.has(url)) continue
    seen.add(url)
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      })
      if (!response.ok) continue
      const payload = await response.json()
      const parsed = parseExplorerAddressBalance(payload)
      if (parsed !== null) return parsed
    } catch {
      // try next endpoint
    }
  }

  return null
}

export async function sendBtcTransferWithInjectedWallet(
  injected: InjectedBtc,
  toAddress: string,
  amountSats: number
): Promise<string> {
  const recipients = [{ address: toAddress, amount: amountSats }]
  const attempts = [
    () =>
      injected.request?.({
        method: "sendTransfer",
        params: [{ recipients }],
      }),
    () =>
      injected.request?.({
        method: "sendTransfer",
        params: [recipients],
      }),
    () => injected.sendBitcoin?.(toAddress, amountSats),
    () => injected.request?.({ method: "sendBitcoin", params: [toAddress, amountSats] }),
    () =>
      injected.request?.({
        method: "sendBitcoin",
        params: [{ address: toAddress, amount: amountSats }],
      }),
  ]

  let lastError: unknown = null
  for (const attempt of attempts) {
    try {
      const result = await withWalletTimeout(async () => await attempt(), 4_500, "BTC wallet transfer request timed out.")
      const txHash = normalizeBtcTxHash(result)
      if (txHash) return txHash
    } catch (error) {
      lastError = error
      const normalized = normalizeWalletError(error, "Failed to send BTC transaction from wallet.")
      if (/already pending/i.test(normalized.message) || /request rejected/i.test(normalized.message)) {
        throw normalized
      }
    }
  }

  throw normalizeWalletError(lastError, "Failed to send BTC transaction from wallet.")
}

export async function sendBtcTransferViaXverse(toAddress: string, amountSats: number): Promise<string> {
  const sats = await import("sats-connect")
  const providerId = sats.DefaultAdaptersInfo?.xverse?.id || XVERSE_PROVIDER_ID
  if (!sats.isProviderInstalled(providerId)) {
    throw new Error("BTC wallet extension not detected. Install UniSat or Xverse (optional jika hanya pakai ETH/STRK).")
  }
  const request = sats.request as (method: string, params: unknown, providerId?: string) => Promise<SatsConnectResultLike<unknown>>
  const response = await withWalletTimeout(
    async () =>
      await request(
        "sendTransfer",
        {
          recipients: [{ address: toAddress, amount: amountSats }],
        },
        providerId
      ),
    20_000,
    "Xverse transfer request timed out. Open wallet popup and retry."
  )
  const result = unwrapSatsConnectResult<Record<string, unknown>>(response, "Failed to send BTC from Xverse wallet.")
  const txHash = normalizeBtcTxHash(result)
  if (!txHash) {
    throw new Error("Xverse did not return a BTC transaction hash.")
  }
  return txHash
}

export async function connectBtcWalletViaXverse(): Promise<{ address: string; balance: number | null }> {
  try {
    const sats = await import("sats-connect")
    const providerId = sats.DefaultAdaptersInfo?.xverse?.id || XVERSE_PROVIDER_ID
    if (!sats.isProviderInstalled(providerId)) {
      throw new Error("BTC wallet extension not detected. Install UniSat or Xverse (optional jika hanya pakai ETH/STRK).")
    }
    const request = sats.request as (method: string, params: unknown, providerId?: string) => Promise<SatsConnectResultLike<unknown>>

    const preferredBtcNetwork =
      (sats.BitcoinNetworkType as unknown as { Testnet4?: unknown }).Testnet4 ?? sats.BitcoinNetworkType.Testnet

    const connectResponse = await withWalletTimeout(
      async () =>
        await request(
          "wallet_connect",
          {
            addresses: [sats.AddressPurpose.Payment, sats.AddressPurpose.Ordinals],
            network: preferredBtcNetwork,
            message: XVERSE_CONNECT_MESSAGE,
          },
          providerId
        ),
      45_000,
      "Xverse connect request timed out. Open wallet popup and retry."
    )
    const connectResult = unwrapSatsConnectResult<{ addresses?: unknown }>(
      connectResponse,
      "Failed to connect Xverse wallet."
    )

    let btcAddress = extractBtcAddressFromSatsConnectAddresses(connectResult.addresses)

    if (!btcAddress) {
      const accountResponse = await request("wallet_getAccount", null, providerId)
      const accountResult = unwrapSatsConnectResult<{ addresses?: unknown }>(
        accountResponse,
        "Failed to fetch account from Xverse wallet."
      )
      btcAddress = extractBtcAddressFromSatsConnectAddresses(accountResult.addresses)
    }

    if (!btcAddress) {
      const legacyResponse = await request(
        "getAccounts",
        { purposes: [sats.AddressPurpose.Payment], message: XVERSE_CONNECT_MESSAGE },
        providerId
      )
      const legacyResult = unwrapSatsConnectResult<unknown>(legacyResponse, "Failed to fetch payment account from Xverse wallet.")
      btcAddress = extractBtcAddressFromSatsConnectAddresses(legacyResult)
    }

    if (!btcAddress) {
      throw new Error("Xverse did not return a BTC payment address.")
    }

    try {
      const networkResponse = await request("wallet_getNetwork", null, providerId)
      const networkResult = unwrapSatsConnectResult<{ bitcoin?: { name?: string } }>(
        networkResponse,
        "Failed to read Xverse network."
      )
      const networkName = networkResult.bitcoin?.name
      if (networkName && !isXverseTestnetNetwork(networkName)) {
        throw new Error(
          `Please switch Xverse network to Bitcoin Testnet before connecting. Current network: ${networkName}.`
        )
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("Please switch Xverse network to Bitcoin Testnet")) {
        throw error
      }
      const inferredNetwork = detectBtcAddressNetwork(btcAddress)
      if (inferredNetwork !== "testnet") {
        throw new Error("BTC wallet must be on Bitcoin testnet (native).")
      }
    }

    let btcBalance: number | null = null
    try {
      const balanceResponse = await request("getBalance", null, providerId)
      const balanceResult = unwrapSatsConnectResult<unknown>(balanceResponse, "Failed to read BTC balance.")
      btcBalance = normalizeBtcBalance(balanceResult)
    } catch {
      btcBalance = null
    }

    return { address: btcAddress, balance: btcBalance }
  } catch (error) {
    throw normalizeXverseConnectError(error)
  }
}

export function normalizeXverseConnectError(error: unknown): Error {
  if (error instanceof Error) {
    const message = error.message.trim()
    if (/provider.*not found|not installed|extension/i.test(message)) {
      return new Error("BTC wallet extension not detected. Install UniSat or Xverse (optional jika hanya pakai ETH/STRK).")
    }
    if (/reject|cancel/i.test(message)) {
      return new Error("Request rejected in Xverse wallet.")
    }
    if (/unexpected token|not valid json|decodetoken/i.test(message)) {
      return new Error(
        "Xverse session data appears corrupted. Close all Xverse popups, lock/unlock extension, then retry. If it persists, clear Xverse extension data or reinstall extension."
      )
    }
    return new Error(message || "Failed to connect Xverse wallet.")
  }
  if (typeof error === "string" && error.trim()) {
    return new Error(error.trim())
  }
  return new Error("Failed to connect Xverse wallet.")
}

export async function ensureUniSatTestnet4(injected: InjectedBtc): Promise<void> {
  const current = await getBtcChainInfo(injected)
  if (current?.enum === "BITCOIN_TESTNET4") return

  await switchBtcChain(injected, "BITCOIN_TESTNET4")

  const afterSwitch = await getBtcChainInfo(injected)
  if (afterSwitch?.enum && afterSwitch.enum !== "BITCOIN_TESTNET4") {
    throw new Error(
      "UniSat wallet must be on Bitcoin Testnet4. Please switch network to BITCOIN_TESTNET4 in UniSat."
    )
  }
}

function unwrapSatsConnectResult<T>(response: unknown, fallbackMessage: string): T {
  const parsed = response as SatsConnectResultLike<unknown> | null
  if (parsed?.status === "success") {
    return parsed.result as T
  }
  const message = parsed?.status === "error" ? parsed.error?.message?.trim() : ""
  throw new Error(message || fallbackMessage)
}

function extractBtcAddressFromSatsConnectAddresses(payload: unknown): string | null {
  if (!Array.isArray(payload)) return null
  const records = payload as Array<{
    address?: string
    purpose?: string
  }>
  const payment = records.find((record) => {
    const purpose = (record.purpose || "").toLowerCase()
    return purpose === "payment"
  })
  const fallback = payment || records[0]
  if (!fallback?.address) return null
  return normalizeBtcAddress(fallback.address)
}

function isXverseTestnetNetwork(name: unknown): boolean {
  if (typeof name !== "string") return false
  const normalized = name.toLowerCase()
  return (
    normalized.includes("testnet") ||
    normalized.includes("testnet4") ||
    normalized.includes("signet") ||
    normalized.includes("regtest")
  )
}

function normalizeBtcChainInfo(raw: unknown): BtcChainInfo | null {
  if (!raw || typeof raw !== "object") return null
  const record = raw as Record<string, unknown>
  const enumValue = typeof record.enum === "string" ? record.enum : undefined
  const nameValue = typeof record.name === "string" ? record.name : undefined
  const networkValue = typeof record.network === "string" ? record.network : undefined
  if (!enumValue && !nameValue && !networkValue) return null
  return {
    enum: enumValue,
    name: nameValue,
    network: networkValue,
  }
}

async function getBtcChainInfo(injected: InjectedBtc): Promise<BtcChainInfo | null> {
  const attempts = [() => injected.getChain?.(), () => injected.request?.({ method: "getChain" })]
  for (const attempt of attempts) {
    try {
      const raw = await attempt()
      const normalized = normalizeBtcChainInfo(raw)
      if (normalized) return normalized
    } catch {
      // try next
    }
  }
  return null
}

async function switchBtcChain(injected: InjectedBtc, chainEnum: string): Promise<BtcChainInfo | null> {
  const attempts = [
    () => injected.switchChain?.(chainEnum),
    () => injected.request?.({ method: "switchChain", params: [chainEnum] }),
  ]
  for (const attempt of attempts) {
    try {
      const raw = await attempt()
      const normalized = normalizeBtcChainInfo(raw)
      if (normalized) return normalized
    } catch {
      // try next
    }
  }
  return null
}

function parseExplorerAddressBalance(payload: any): number | null {
  if (!payload || typeof payload !== "object") return null
  const chainFunded = Number(payload?.chain_stats?.funded_txo_sum)
  const chainSpent = Number(payload?.chain_stats?.spent_txo_sum)
  const mempoolFunded = Number(payload?.mempool_stats?.funded_txo_sum)
  const mempoolSpent = Number(payload?.mempool_stats?.spent_txo_sum)

  if (Number.isFinite(chainFunded) && Number.isFinite(chainSpent)) {
    const confirmedSats = Math.max(0, chainFunded - chainSpent)
    const pendingSats =
      Number.isFinite(mempoolFunded) && Number.isFinite(mempoolSpent) ? mempoolFunded - mempoolSpent : 0
    const totalSats = Math.max(0, confirmedSats + pendingSats)
    return totalSats / 100_000_000
  }

  const fallback = Number(
    payload?.balance ?? payload?.sats ?? payload?.confirmed ?? payload?.total ?? payload?.amount
  )
  if (!Number.isFinite(fallback)) return null
  return fallback / 100_000_000
}
