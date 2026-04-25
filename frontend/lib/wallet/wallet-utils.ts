export function normalizeHex(value: string | number): string {
  if (typeof value === "number") {
    return value.toString(16)
  }
  if (value.startsWith("0x")) {
    return value.slice(2)
  }
  if (/^[0-9]+$/.test(value)) {
    try {
      return BigInt(value).toString(16)
    } catch {
      return value
    }
  }
  return value
}

export function feltToPaddedHex(value: string | number): string {
  const hex = normalizeHex(value)
  return hex.padStart(64, "0")
}

export function normalizeSignatureValue(signature: any): string | null {
  if (!signature) return null
  if (typeof signature === "string") {
    const trimmed = signature.trim()
    if (!trimmed) return null
    return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`
  }
  if (Array.isArray(signature)) {
    if (signature.length === 0) return null
    const parts = signature.map((item) => feltToPaddedHex(item))
    return `0x${parts.join("")}`
  }
  if (typeof signature === "object" && "signature" in signature) {
    return normalizeSignatureValue(signature.signature)
  }
  return null
}

export function randomHex(bytes: number): string {
  if (typeof window === "undefined" || !window.crypto?.getRandomValues) {
    return `0x${"a".repeat(bytes * 2)}`
  }
  const buffer = new Uint8Array(bytes)
  window.crypto.getRandomValues(buffer)
  return `0x${Array.from(buffer).map((b) => b.toString(16).padStart(2, "0")).join("")}`
}

export function signatureToHex(signature: any): string | null {
  return normalizeSignatureValue(signature)
}

export function toShortString(value: string): string {
  if (value.length <= 31) return value
  return value.slice(0, 31)
}

export function pow10BigInt(exponent: number): bigint {
  const safeExponent = Number.isFinite(exponent) && exponent > 0 ? Math.floor(exponent) : 0
  let result = BigInt(1)
  const ten = BigInt(10)
  for (let i = 0; i < safeExponent; i += 1) {
    result *= ten
  }
  return result
}

export function toBigInt(value: any): bigint | null {
  if (typeof value === "bigint") return value
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.floor(value))
  }
  if (typeof value === "string") {
    try {
      if (value.startsWith("0x")) return BigInt(value)
      if (/^[0-9]+$/.test(value)) return BigInt(value)
    } catch {
      return null
    }
  }
  if (typeof value === "object" && value) {
    if ("low" in value && "high" in value) {
      try {
        const low = toBigInt((value as any).low) ?? BigInt(0)
        const high = toBigInt((value as any).high) ?? BigInt(0)
        return (high << BigInt(128)) + low
      } catch {
        return null
      }
    }
    if ("amount" in value) return toBigInt((value as any).amount)
    if ("balance" in value) return toBigInt((value as any).balance)
  }
  return null
}

export function normalizeTokenBalance(raw: any, decimals: number): number | null {
  if (raw === null || raw === undefined) return null
  const dec =
    typeof raw?.decimals === "number" && Number.isFinite(raw.decimals) ? raw.decimals : decimals
  const amount = toBigInt(raw)
  if (amount === null) return null
  try {
    const divisor = pow10BigInt(dec)
    const whole = Number(amount / divisor)
    const fraction = Number(amount % divisor) / Number(divisor)
    return whole + fraction
  } catch {
    return null
  }
}

export function parseBigIntLike(value: unknown): bigint | null {
  if (typeof value === "bigint") return value
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.floor(value))
  if (typeof value === "string" && value) {
    try {
      if (value.startsWith("0x")) return BigInt(value)
      if (/^[0-9]+$/.test(value)) return BigInt(value)
    } catch {
      return null
    }
  }
  return null
}

export function scaleBigIntBalance(value: bigint, decimals: number): number | null {
  try {
    const divisor = pow10BigInt(decimals)
    const whole = Number(value / divisor)
    const fraction = Number(value % divisor) / Number(divisor)
    return whole + fraction
  } catch {
    return null
  }
}

export function normalizeEvmBalance(value: any): number | null {
  if (typeof value !== "string") return null
  try {
    const wei = BigInt(value)
    const divisor = pow10BigInt(18)
    const whole = Number(wei / divisor)
    const fraction = Number(wei % divisor) / Number(divisor)
    return whole + fraction
  } catch {
    return null
  }
}

export function sanitizeEvmAddress(address: string): string | null {
  const trimmed = address.trim()
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return null
  return trimmed
}

export function sanitizeEvmAddressToWord(address: string): string | null {
  const normalized = sanitizeEvmAddress(address)
  if (!normalized) return null
  return normalized.slice(2).toLowerCase().padStart(64, "0")
}

export function clampDecimals(value: number): number {
  const rounded = Math.floor(value)
  if (rounded < 0) return 0
  if (rounded > 36) return 36
  return rounded
}

export function normalizeEvmDecimals(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampDecimals(value)
  }
  if (typeof value === "string" && value) {
    try {
      const parsed = value.startsWith("0x")
        ? Number.parseInt(value, 16)
        : Number.parseInt(value, 10)
      if (Number.isFinite(parsed)) {
        return clampDecimals(parsed)
      }
    } catch {
      return 18
    }
  }
  return 18
}

export function normalizeBtcAuthSignature(raw: unknown): string {
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (!trimmed) return ""

    // If it's hex, keep hex (backend can convert).
    if (/^(0x)?[0-9a-fA-F]+$/.test(trimmed)) {
      const body = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed
      return `0x${body.toLowerCase()}`
    }

    // If it already looks like base64 (common for BIP-322), keep as-is.
    if (/^[A-Za-z0-9+/]+=*$/.test(trimmed) && trimmed.length >= 16) {
      return trimmed
    }

    // Fallback: return the raw string so backend can decide how to handle it.
    return trimmed
  }
  return ""
}

export function normalizeBtcTxHash(raw: unknown): string | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (!trimmed) return null
    const compact = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed
    if (/^[0-9a-fA-F]{64}$/.test(compact)) {
      return compact.toLowerCase()
    }
    return null
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const nested = normalizeBtcTxHash(item)
      if (nested) return nested
    }
    return null
  }
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>
    const keys = [
      "txid",
      "txId",
      "tx_hash",
      "txHash",
      "transaction_hash",
      "transactionHash",
      "hash",
      "result",
      "data",
    ]
    for (const key of keys) {
      if (!(key in record)) continue
      const nested = normalizeBtcTxHash(record[key])
      if (nested) return nested
    }
  }
  return null
}

export function normalizeBtcAddress(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const lower = trimmed.toLowerCase()
  const looksLikeBtcAddress =
    lower.startsWith("tb1") ||
    lower.startsWith("bcrt1") ||
    lower.startsWith("bc1") ||
    lower.startsWith("1") ||
    lower.startsWith("2") ||
    lower.startsWith("3") ||
    lower.startsWith("m") ||
    lower.startsWith("n")
  return looksLikeBtcAddress ? trimmed : null
}

export function normalizeBtcAccounts(result: unknown): string[] {
  if (typeof result === "string") {
    const normalized = normalizeBtcAddress(result)
    return normalized ? [normalized] : []
  }
  if (Array.isArray(result)) {
    return result.flatMap((item) => normalizeBtcAccounts(item))
  }
  if (!result || typeof result !== "object") return []

  const record = result as Record<string, unknown>
  const directKeys = ["address", "btcAddress", "paymentAddress", "ordinalAddress", "bitcoinAddress"]
  for (const key of directKeys) {
    const value = record[key]
    if (typeof value === "string") {
      const normalized = normalizeBtcAddress(value)
      if (normalized) return [normalized]
    }
  }

  const nestedKeys = ["accounts", "addresses", "result", "data", "wallets"]
  for (const key of nestedKeys) {
    if (key in record) {
      const parsed = normalizeBtcAccounts(record[key])
      if (parsed.length > 0) return parsed
    }
  }

  return []
}

export function normalizeBtcBalance(raw: any): number | null {
  if (raw === null || raw === undefined) return null
  const normalizeScaled = (value: number): number | null => {
    if (!Number.isFinite(value) || value < 0) return null
    return value
  }

  if (typeof raw === "number" || typeof raw === "string") {
    const candidate = Number(raw)
    if (!Number.isFinite(candidate)) return null
    if (Number.isInteger(candidate) && candidate > 100) {
      return normalizeScaled(candidate / 100_000_000)
    }
    return normalizeScaled(candidate)
  }

  if (typeof raw === "object") {
    const totalCandidate = Number(raw.total ?? raw.balance ?? raw.amount ?? raw.finalizedBalance)
    const confirmedCandidate = Number(raw.confirmed ?? raw.confirmedBalance)
    const unconfirmedCandidate = Number(
      raw.unconfirmed ?? raw.unconfirmedBalance ?? raw.pending ?? raw.pendingBalance
    )
    const candidate =
      Number.isFinite(confirmedCandidate) && Number.isFinite(unconfirmedCandidate)
        ? confirmedCandidate + unconfirmedCandidate
        : Number.isFinite(totalCandidate)
        ? totalCandidate
        : Number(raw.satoshi ?? raw.satoshis)
    if (!Number.isFinite(candidate)) return null
    const keys = new Set(Object.keys(raw))
    const looksLikeSatoshiPayload =
      keys.has("satoshi") ||
      keys.has("satoshis") ||
      keys.has("confirmed") ||
      keys.has("unconfirmed") ||
      Number.isInteger(candidate)
    if (looksLikeSatoshiPayload) {
      return normalizeScaled(candidate / 100_000_000)
    }
    return normalizeScaled(candidate)
  }

  return null
}

export function normalizeWalletError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) {
    const message = (error.message || "").trim()
    if (message) {
      if (/unexpected token|not valid json|decodetoken|decode token/i.test(message)) {
        return new Error(
          "Xverse session data appears corrupted. Close all Xverse popups, lock/unlock extension, then retry. If it persists, clear Xverse extension data or reinstall extension."
        )
      }
      if (
        /user rejected|user denied|rejected request|transaction rejected|user canceled|user cancelled|request cancelled|request canceled|declined|dismissed|aborted/i.test(
          message
        )
      ) {
        return new Error("Request rejected in wallet.")
      }
      if (/already pending|request of type .* already pending/i.test(message)) {
        return new Error("Wallet request already pending. Open wallet extension.")
      }
      if (/unknown chain|unsupported chain|chain .* not added|unrecognized chain/i.test(message)) {
        return new Error("Target network is not available in wallet.")
      }
      return new Error(message)
    }
    return new Error(fallbackMessage)
  }
  if (typeof error === "string" && error.trim()) {
    return new Error(error.trim())
  }
  if (typeof error === "object" && error) {
    const messageCandidates = [
      (error as { message?: unknown }).message,
      (error as { reason?: unknown }).reason,
      (error as { data?: { message?: unknown } }).data?.message,
      (error as { error?: { message?: unknown } }).error?.message,
    ]
    const message = messageCandidates.find(
      (candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0
    )
    if (message) {
      const normalized = message.trim()
      if (
        /user rejected|user denied|rejected request|transaction rejected|user canceled|user cancelled|request cancelled|request canceled|declined|dismissed|aborted/i.test(
          normalized
        )
      ) {
        return new Error("Request rejected in wallet.")
      }
      if (/already pending|request of type .* already pending/i.test(normalized)) {
        return new Error("Wallet request already pending. Open wallet extension.")
      }
      if (/unknown chain|unsupported chain|chain .* not added|unrecognized chain/i.test(normalized)) {
        return new Error("Target network is not available in wallet.")
      }
      return new Error(normalized)
    }
    const code = (error as { code?: unknown }).code
    if (typeof code === "number") {
      if (code === 4001) return new Error("Request rejected in wallet.")
      if (code === -32002) return new Error("Wallet request already pending. Open wallet extension.")
      if (code === 4902) return new Error("Target network is not available in wallet.")
    }
  }
  return new Error(fallbackMessage)
}

export async function withWalletTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  return await Promise.race([
    operation(),
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => {
        clearTimeout(timer)
        reject(new Error(timeoutMessage))
      }, timeoutMs)
    }),
  ])
}
