import {
  BTC_TESTNET_EXPLORER_BASE_URL,
  ETHERSCAN_SEPOLIA_BASE_URL,
  STARKSCAN_SEPOLIA_BASE_URL,
} from "@/lib/network-config"
import {
  invokeStarknetCallFromWallet,
  invokeStarknetCallsFromWallet,
} from "@/lib/onchain-trade"

export const STATIC_CAREL_TOKEN_ADDRESS =
  process.env.NEXT_PUBLIC_TOKEN_CAREL_ADDRESS ||
  process.env.NEXT_PUBLIC_CAREL_TOKEN_ADDRESS ||
  ""
export const STATIC_STARKNET_AI_EXECUTOR_ADDRESS =
  process.env.NEXT_PUBLIC_STARKNET_AI_EXECUTOR_ADDRESS ||
  process.env.NEXT_PUBLIC_AI_EXECUTOR_ADDRESS ||
  ""

export const AI_REQUIRE_FRESH_SETUP_PER_EXECUTION =
  (process.env.NEXT_PUBLIC_AI_REQUIRE_FRESH_SETUP_PER_EXECUTION || "false").toLowerCase() ===
  "true"

const AI_HIDE_MIN_NOTE_AGE_SECS_RAW =
  process.env.NEXT_PUBLIC_AI_HIDE_MIN_NOTE_AGE_SECS ||
  process.env.NEXT_PUBLIC_HIDE_BALANCE_MIN_NOTE_AGE_SECS ||
  "60"
const AI_HIDE_MIN_NOTE_AGE_SECS = Number.parseInt(AI_HIDE_MIN_NOTE_AGE_SECS_RAW, 10)
export const AI_HIDE_MIN_NOTE_AGE_MS =
  (Number.isFinite(AI_HIDE_MIN_NOTE_AGE_SECS) && AI_HIDE_MIN_NOTE_AGE_SECS > 0
    ? AI_HIDE_MIN_NOTE_AGE_SECS
    : 60) * 1000
export const AI_HIDE_AUTO_EXECUTE_AFTER_COOLDOWN =
  (process.env.NEXT_PUBLIC_AI_HIDE_AUTO_EXECUTE_AFTER_COOLDOWN || "true").toLowerCase() !==
  "false"

export const AI_TIERS = [
  {
    id: 1,
    name: "Level 1",
    cost: 0,
    costLabel: "FREE",
    description: "Basic queries, price check",
  },
  {
    id: 2,
    name: "Level 2",
    cost: 5,
    costLabel: "5 CAREL",
    description: "Swap/bridge/stake/claim/limit execution",
  },
  {
    id: 3,
    name: "Level 3",
    cost: 10,
    costLabel: "10 CAREL",
    description: "Private Garaga execution for swap/stake/limit",
  },
] as const

export const BRIDGE_COMMAND_REGEX = /\b(bridge|brigde|briedge|jembatan)\b/i
export const TIER2_ONCHAIN_COMMAND_REGEX =
  /\b(swap|bridge|brigde|briedge|stake|claim|limit(?:\s|-)?order|cancel\s+order)\b/i
export const TIER3_ONCHAIN_COMMAND_REGEX =
  /\b(swap|bridge|brigde|briedge|stake|unstake|claim|limit(?:\s|-)?order|cancel\s+order|portfolio|rebalance|alert|price alert)\b/i

export const AI_TOKEN_ADDRESS_MAP: Record<string, string> = {
  CAREL:
    process.env.NEXT_PUBLIC_TOKEN_CAREL_ADDRESS ||
    process.env.NEXT_PUBLIC_CAREL_TOKEN_ADDRESS ||
    "0x0517f60f4ec4e1b2b748f0f642dfdcb32c0ddc893f777f2b595a4e4f6df51545",
  STRK:
    process.env.NEXT_PUBLIC_TOKEN_STRK_ADDRESS ||
    "0x04718f5a0Fc34cC1AF16A1cdee98fFB20C31f5cD61D6Ab07201858f4287c938D",
  USDT:
    process.env.NEXT_PUBLIC_TOKEN_USDT_ADDRESS ||
    "0x07439bce89f5559b3f6aa1793291c5bb20c03adf5bac57debe4d7209c2cb053b",
  USDC:
    process.env.NEXT_PUBLIC_TOKEN_USDC_ADDRESS ||
    "0x05a26f9680c5dc0c36dcf1670d7f51f24ba0080d15fedb7396d23a77bf5c1924",
  WBTC:
    process.env.NEXT_PUBLIC_TOKEN_WBTC_ADDRESS ||
    process.env.NEXT_PUBLIC_TOKEN_BTC_ADDRESS ||
    "0x496bef3ed20371382fbe0ca6a5a64252c5c848f9f1f0cccf8110fc4def912d5",
  BTC:
    process.env.NEXT_PUBLIC_TOKEN_BTC_ADDRESS ||
    process.env.NEXT_PUBLIC_TOKEN_WBTC_ADDRESS ||
    "0x496bef3ed20371382fbe0ca6a5a64252c5c848f9f1f0cccf8110fc4def912d5",
}
export const STARKNET_WBTC_STAKING_TOKEN_ADDRESS = (
  process.env.NEXT_PUBLIC_TOKEN_WBTC_ADDRESS ||
  "0x496bef3ed20371382fbe0ca6a5a64252c5c848f9f1f0cccf8110fc4def912d5"
).trim()
export const AI_TOKEN_DECIMALS: Record<string, number> = {
  CAREL: 18,
  STRK: 18,
  USDT: 6,
  USDC: 6,
  WBTC: 8,
  BTC: 8,
}
export const AI_HIDE_USDT_TIER_OPTIONS = [
  { minUsdt: 5, bonusPercent: 5 },
  { minUsdt: 10, bonusPercent: 10 },
  { minUsdt: 50, bonusPercent: 20 },
  { minUsdt: 100, bonusPercent: 30 },
  { minUsdt: 250, bonusPercent: 50 },
] as const
export type AiHideUsdtTierOption = (typeof AI_HIDE_USDT_TIER_OPTIONS)[number]

export const SUPPORTED_SWAP_TOKENS = new Set(["USDT", "USDC", "STRK", "WBTC", "CAREL"])
export const SUPPORTED_LIMIT_ORDER_TOKENS = new Set(["USDT", "USDC", "STRK", "WBTC", "CAREL"])
export const SUPPORTED_STAKE_TOKENS = new Set(["CAREL", "USDC", "USDT", "STRK", "WBTC"])

const GARDEN_ORDER_EXPLORER_BASE_URL =
  process.env.NEXT_PUBLIC_GARDEN_ORDER_EXPLORER_URL ||
  "https://testnet-explorer.garden.finance/order"

export type TxExplorerNetwork = "starknet" | "evm" | "btc"

export type OptimisticExecutionPreview = {
  title: string
  fromToken: string
  toToken: string
  amountText: string
  estimatedPoints: string
}

export type BridgeAddressContext = {
  address?: string | null
  starknetAddress?: string | null
  evmAddress?: string | null
  btcAddress?: string | null
}

export function normalizeMessageText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

export function tierTotalCostCarel(tier: number): number {
  const found = AI_TIERS.find((item) => item.id === tier)
  return typeof found?.cost === "number" ? found.cost : 0
}

export function incrementalTierUpgradeCost(currentTier: number, targetTier: number): number {
  const currentCost = tierTotalCostCarel(currentTier)
  const targetCost = tierTotalCostCarel(targetTier)
  return Math.max(0, targetCost - currentCost)
}

export function normalizeAiCommandInput(value: string): string {
  let text = normalizeMessageText(value)
  if (!text) return text

  text = text.replace(/(\d)\s*,\s*(\d)/g, "$1.$2")
  text = text.replace(/\s*\/\s*/g, "/")

  const replacements: Array<[RegExp, string]> = [
    [/\b(plesae|plese|plz|pls)\b/gi, "please"],
    [/\b(brigde|briedge)\b/gi, "bridge"],
    [/\b(privat|prvate|privte)\b/gi, "private"],
    [/\b(swpa|sawp)\b/gi, "swap"],
    [/\b(stkae|staek|satke)\b/gi, "stake"],
    [/\b(cliam|clain)\b/gi, "claim"],
    [/\b(limti|lmit|limt)\b/gi, "limit"],
    [/\b(ordre|ordr)\b/gi, "order"],
    [/\b(expirty|expriy|expiri)\b/gi, "expiry"],
    [/\bsrtk\b/gi, "STRK"],
  ]

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement)
  }

  return normalizeMessageText(text)
}

export function sanitizeDecimalInput(raw: string, maxDecimals = 18): string {
  const cleaned = raw.replace(/,/g, "").replace(/[^\d.]/g, "")
  if (!cleaned) return ""
  const firstDot = cleaned.indexOf(".")
  if (firstDot === -1) {
    const noLeading = cleaned.replace(/^0+(?=\d)/, "")
    return noLeading || "0"
  }
  const intPartRaw = cleaned.slice(0, firstDot).replace(/\./g, "")
  const fracRaw = cleaned.slice(firstDot + 1).replace(/\./g, "")
  const intPart = intPartRaw.replace(/^0+(?=\d)/, "") || "0"
  const fracPart = fracRaw.slice(0, Math.max(0, maxDecimals))
  return `${intPart}.${fracPart}`
}

export function trimDecimalZeros(raw: string): string {
  return raw
    .replace(/(\.\d*?[1-9])0+$/, "$1")
    .replace(/\.0+$/, "")
    .replace(/\.$/, "")
}

export function scaledBigIntToDecimalString(value: bigint, decimals: number): string {
  if (decimals <= 0) return value.toString()
  const base = BigInt(10) ** BigInt(decimals)
  const whole = value / base
  const fraction = value % base
  if (fraction === BigInt(0)) return whole.toString()
  const fractionRaw = fraction
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "")
  return `${whole.toString()}.${fractionRaw}`
}

export function formatDurationHhMmSs(ms: number): string {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0
  const totalSec = Math.floor(safeMs / 1000)
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
    seconds
  ).padStart(2, "0")}`
}

export function formatSwapMinAmountOut(quotedOutRaw: string, slippagePercent: number): string {
  const quotedOut = Number.parseFloat(String(quotedOutRaw || "0"))
  if (!Number.isFinite(quotedOut) || quotedOut <= 0) return "0"
  const safeSlippage = Number.isFinite(slippagePercent) ? Math.max(0, slippagePercent) : 0
  const minOut = quotedOut * Math.max(0, 1 - safeSlippage / 100)
  const precision = quotedOut < 1 ? 12 : 8
  const normalized = minOut.toFixed(precision).replace(/\.?0+$/, "")
  return normalized || "0"
}

export function normalizeHexArray(values?: string[] | null): string[] {
  if (!Array.isArray(values)) return []
  return values
    .map((item) => (typeof item === "string" ? item.trim() : String(item ?? "").trim()))
    .filter((item) => item.length > 0)
}

export function normalizeHexNumberish(value: string): string {
  const raw = (value || "").trim()
  if (!raw) return "0x0"
  if (raw.startsWith("0x") || raw.startsWith("0X")) {
    const compact = raw.slice(2).replace(/^0+/, "")
    return `0x${(compact || "0").toLowerCase()}`
  }
  if (/^\d+$/.test(raw)) {
    return `0x${BigInt(raw).toString(16)}`
  }
  return raw.toLowerCase()
}

export function resolveStakeTokenSymbol(value: string): string {
  const normalized = value.trim().toUpperCase()
  if (normalized === "BTC" || normalized === "BITCOIN") return "WBTC"
  return normalized
}

export function parseBridgeTokensFromCommand(
  command: string
): { fromToken: string; toToken: string; amountText: string } | null {
  const normalized = normalizeMessageText(command).replace(/[,()]/g, " ")
  const withAmountTokenFirst = normalized.match(
    /\b(?:bridge|brigde|briedge|jembatan)\b\s+([a-z0-9]{2,12})\s+([0-9]+(?:\.[0-9]+)?)\s*(?:to|ke|->|→)\s*([a-z0-9]{2,12})\b/i
  )
  if (withAmountTokenFirst) {
    const fromToken = (withAmountTokenFirst[1] || "").trim().toUpperCase()
    const amountText = (withAmountTokenFirst[2] || "").trim()
    const toToken = (withAmountTokenFirst[3] || "").trim().toUpperCase()
    if (fromToken && toToken) {
      return { fromToken, toToken, amountText }
    }
  }

  const withAmountAmountFirst = normalized.match(
    /\b(?:bridge|brigde|briedge|jembatan)\b\s+([0-9]+(?:\.[0-9]+)?)\s*([a-z0-9]{2,12})\s*(?:to|ke|->|→)\s*([a-z0-9]{2,12})\b/i
  )
  if (withAmountAmountFirst) {
    const amountText = (withAmountAmountFirst[1] || "").trim()
    const fromToken = (withAmountAmountFirst[2] || "").trim().toUpperCase()
    const toToken = (withAmountAmountFirst[3] || "").trim().toUpperCase()
    if (fromToken && toToken) {
      return { fromToken, toToken, amountText }
    }
  }

  const withoutAmount = normalized.match(
    /\b(?:bridge|brigde|briedge|jembatan)\b\s+([a-z0-9]{2,12})\s*(?:to|ke|->|→)\s*([a-z0-9]{2,12})\b/i
  )
  if (withoutAmount) {
    const fromToken = (withoutAmount[1] || "").trim().toUpperCase()
    const toToken = (withoutAmount[2] || "").trim().toUpperCase()
    if (fromToken && toToken) {
      return { fromToken, toToken, amountText: "" }
    }
  }
  return null
}

export function parseSwapTokensFromCommand(
  command: string
): { fromToken: string; toToken: string; amountText: string } | null {
  const normalized = normalizeMessageText(command).replace(/[,()]/g, " ")
  const amountFirst = normalized.match(
    /\b(?:please\s+)?(?:(?:hide|private)\s+)?(?:swap|tukar)\b\s+([0-9]+(?:\.[0-9]+)?)\s*([a-z0-9]{2,12})\s*(?:to|ke|->|→)\s*([a-z0-9]{2,12})\b/i
  )
  if (amountFirst) {
    const amountText = (amountFirst[1] || "").trim()
    const fromToken = (amountFirst[2] || "").trim().toUpperCase()
    const toToken = (amountFirst[3] || "").trim().toUpperCase()
    if (fromToken && toToken && amountText) {
      return { fromToken, toToken, amountText }
    }
  }

  const tokenFirst = normalized.match(
    /\b(?:please\s+)?(?:(?:hide|private)\s+)?(?:swap|tukar)\b\s+([a-z0-9]{2,12})\s+([0-9]+(?:\.[0-9]+)?)\s*(?:to|ke|->|→)\s*([a-z0-9]{2,12})\b/i
  )
  if (tokenFirst) {
    const fromToken = (tokenFirst[1] || "").trim().toUpperCase()
    const amountText = (tokenFirst[2] || "").trim()
    const toToken = (tokenFirst[3] || "").trim().toUpperCase()
    if (fromToken && toToken && amountText) {
      return { fromToken, toToken, amountText }
    }
  }
  return null
}

export function parseHideTierFromCommand(command: string): number | null {
  const normalized = normalizeMessageText(command)
  const hasTierKeyword = /\b(hide\s*tier|tier\s*hide|tier|denom|denomination)\b/i.test(normalized)
  if (!hasTierKeyword) return null
  const amountMatch = normalized.match(/\$?\s*(5|10|50|100|250)\b/i)
  if (!amountMatch) return null
  const tier = Number.parseInt(amountMatch[1] || "", 10)
  if (!Number.isFinite(tier)) return null
  return AI_HIDE_USDT_TIER_OPTIONS.some((option) => option.minUsdt === tier) ? tier : null
}

export function parseHideTierFromAmountText(amountText: string): number | null {
  const parsed = Number.parseFloat((amountText || "").trim())
  if (!Number.isFinite(parsed)) return null
  return AI_HIDE_USDT_TIER_OPTIONS.some((option) => option.minUsdt === parsed) ? parsed : null
}

export function inferHideTierFromPrivateCommand(command: string): number | null {
  const explicitTier = parseHideTierFromCommand(command)
  if (explicitTier) return explicitTier

  const normalized = normalizeMessageText(command)
  if (!/\b(private|hide)\b/i.test(normalized)) return null

  const swapIntent = parseSwapTokensFromCommand(command)
  if (swapIntent?.amountText) {
    const swapTier = parseHideTierFromAmountText(swapIntent.amountText)
    if (swapTier) return swapTier
  }

  const stakeIntent = parseStakeTokenAmountFromCommand(command)
  if (stakeIntent?.amountText) {
    const stakeTier = parseHideTierFromAmountText(stakeIntent.amountText)
    if (stakeTier) return stakeTier
  }

  const limitIntent = parseLimitOrderIntentFromCommand(command)
  if (limitIntent?.amountText) {
    const limitTier = parseHideTierFromAmountText(limitIntent.amountText)
    if (limitTier) return limitTier
  }

  return null
}

export function buildPrivateHideTierHint(command: string, selectedTierUsdt: number): string {
  const normalized = normalizeMessageText(command)
  const isPrivateHideCommand = /\b(private|hide)\b/i.test(normalized)
  if (!isPrivateHideCommand) return ""

  const swapIntent = parseSwapTokensFromCommand(command)
  const stakeIntent = parseStakeTokenAmountFromCommand(command)
  const limitIntent = parseLimitOrderIntentFromCommand(command)
  const sourceToken = (
    stakeIntent?.token ||
    limitIntent?.fromToken ||
    swapIntent?.fromToken ||
    ""
  )
    .trim()
    .toUpperCase()

  const baseLine = `\nSelected hide tier: $${selectedTierUsdt}. In L3 private mode, the selected hide tier controls the deposited note size.`
  if (!sourceToken) return baseLine
  if (sourceToken === "USDT" || sourceToken === "USDC" || sourceToken === "CAREL") {
    return `${baseLine} For ${sourceToken}, the deposited amount follows that tier directly.`
  }
  return `${baseLine} For ${sourceToken}, the final token amount is approximate and is resolved at execution time from the on-chain rule or live quote.`
}

export function parseLimitOrderIntentFromCommand(
  command: string
): { fromToken: string; toToken: string; amountText: string; priceText: string; expiry: string } | null {
  const normalized = normalizeMessageText(command).replace(/[,()]/g, " ")
  const pairFormat = normalized.match(
    /\b(?:(?:hide|private)\s+)?limit(?:\s|-)?order\b\s+([a-z0-9]{2,12})\s*\/\s*([a-z0-9]{2,12})\s+(?:amount\s+)?([0-9]+(?:\.[0-9]+)?)\s+(?:at|price)\s+([0-9]+(?:\.[0-9]+)?)(?:\s+expiry\s+([a-z0-9]+))?/i
  )
  if (pairFormat) {
    return {
      fromToken: (pairFormat[1] || "").trim().toUpperCase(),
      toToken: (pairFormat[2] || "").trim().toUpperCase(),
      amountText: (pairFormat[3] || "").trim(),
      priceText: (pairFormat[4] || "").trim(),
      expiry: ((pairFormat[5] || "7d").trim() || "7d").toLowerCase(),
    }
  }

  const tierLeading = normalized.match(
    /\b(?:(?:hide|private)\s+)?limit(?:\s|-)?order\b\s+(?:hide\s+)?tier\s+\$?\s*([0-9]+(?:\.[0-9]+)?)\s+([a-z0-9]{2,12})\s*\/\s*([a-z0-9]{2,12})\s+(?:at|price)\s+([0-9]+(?:\.[0-9]+)?)(?:\s+expiry\s+([a-z0-9]+))?/i
  )
  if (tierLeading) {
    return {
      fromToken: (tierLeading[2] || "").trim().toUpperCase(),
      toToken: (tierLeading[3] || "").trim().toUpperCase(),
      amountText: (tierLeading[1] || "").trim(),
      priceText: (tierLeading[4] || "").trim(),
      expiry: ((tierLeading[5] || "7d").trim() || "7d").toLowerCase(),
    }
  }

  const tierTrailing = normalized.match(
    /\b(?:(?:hide|private)\s+)?limit(?:\s|-)?order\b\s+([a-z0-9]{2,12})\s*\/\s*([a-z0-9]{2,12})\s+(?:hide\s+)?tier\s+\$?\s*([0-9]+(?:\.[0-9]+)?)\s+(?:at|price)\s+([0-9]+(?:\.[0-9]+)?)(?:\s+expiry\s+([a-z0-9]+))?/i
  )
  if (tierTrailing) {
    return {
      fromToken: (tierTrailing[1] || "").trim().toUpperCase(),
      toToken: (tierTrailing[2] || "").trim().toUpperCase(),
      amountText: (tierTrailing[3] || "").trim(),
      priceText: (tierTrailing[4] || "").trim(),
      expiry: ((tierTrailing[5] || "7d").trim() || "7d").toLowerCase(),
    }
  }

  const tierValueFirst = normalized.match(
    /\b(?:(?:hide|private)\s+)?limit(?:\s|-)?order\b\s+([0-9]+(?:\.[0-9]+)?)\s+(?:hide\s+)?tier\s+([a-z0-9]{2,12})\s*\/\s*([a-z0-9]{2,12})\s+(?:at|price)\s+([0-9]+(?:\.[0-9]+)?)(?:\s+expiry\s+([a-z0-9]+))?/i
  )
  if (tierValueFirst) {
    return {
      fromToken: (tierValueFirst[2] || "").trim().toUpperCase(),
      toToken: (tierValueFirst[3] || "").trim().toUpperCase(),
      amountText: (tierValueFirst[1] || "").trim(),
      priceText: (tierValueFirst[4] || "").trim(),
      expiry: ((tierValueFirst[5] || "7d").trim() || "7d").toLowerCase(),
    }
  }
  return null
}

export function parseStakeTokenAmountFromCommand(
  command: string
): { token: string; amountText: string } | null {
  const normalized = normalizeMessageText(command).replace(/[,()]/g, " ")
  const tierSyntax = normalized.match(
    /\b(?:(?:hide|private)\s+)?stake\b\s+([0-9]+(?:\.[0-9]+)?)\s+(?:hide\s+)?tier\s+\$?\s*([a-z0-9]{2,12})\b/i
  )
  if (tierSyntax) {
    const amountText = (tierSyntax[1] || "").trim()
    const token = resolveStakeTokenSymbol((tierSyntax[2] || "").trim())
    if (!amountText || !token) return null
    return { token, amountText }
  }

  const tierSyntaxTrailing = normalized.match(
    /\b(?:(?:hide|private)\s+)?stake\b\s+([a-z0-9]{2,12})\s+(?:with\s+)?(?:hide\s+)?tier\s+\$?\s*([0-9]+(?:\.[0-9]+)?)\b/i
  )
  if (tierSyntaxTrailing) {
    const token = resolveStakeTokenSymbol((tierSyntaxTrailing[1] || "").trim())
    const amountText = (tierSyntaxTrailing[2] || "").trim()
    if (!amountText || !token) return null
    return { token, amountText }
  }

  const direct = normalized.match(
    /\b(?:(?:hide|private)\s+)?stake\b\s+([0-9]+(?:\.[0-9]+)?)\s+(?!tier\b)([a-z0-9]{2,12})\b/i
  )
  if (direct) {
    const amountText = (direct[1] || "").trim()
    const token = resolveStakeTokenSymbol((direct[2] || "").trim())
    if (!amountText || !token) return null
    return { token, amountText }
  }

  return null
}

export function parseStakeTokenHintFromCommand(
  command: string
): { token: string; amountText?: string } | null {
  const directStake = parseStakeTokenAmountFromCommand(command)
  if (directStake) return directStake

  const normalized = normalizeMessageText(command).replace(/[,()]/g, " ")
  const unstakeWithAmount = normalized.match(
    /\b(?:(?:hide|private)\s+)?unstake\b\s+([0-9]+(?:\.[0-9]+)?)\s+([a-z0-9]{2,12})\b/i
  )
  if (unstakeWithAmount) {
    const amountText = (unstakeWithAmount[1] || "").trim()
    const token = resolveStakeTokenSymbol((unstakeWithAmount[2] || "").trim())
    if (token) return { token, amountText }
  }

  const claimToken = normalized.match(
    /\b(?:(?:hide|private)\s+)?claim(?:\s+staking)?(?:\s+rewards?)?\s+([a-z0-9]{2,12})\b/i
  )
  if (claimToken) {
    const token = resolveStakeTokenSymbol((claimToken[1] || "").trim())
    if (token) return { token }
  }
  return null
}

export function parseLimitOrderIdFromCancelCommand(command: string): string {
  const match = command.match(/\bcancel\s+order\s+([^\s]+)/i)
  if (!match) return ""
  const raw = (match[1] || "").trim().replace(/[.,!?;:)\]]+$/g, "")
  const lower = raw.toLowerCase()
  if (!raw || lower === "<id>" || lower === "id" || lower === "<order_id>" || lower === "order_id") {
    return ""
  }
  if (/^0x[0-9a-f]+$/i.test(raw) || /^\d+$/.test(raw)) {
    return raw
  }
  return ""
}

export function requiresOnchainActionForCommand(tier: number, command: string): boolean {
  if (tier < 2) return false
  const normalized = command.trim()
  if (!normalized) return false
  if (tier === 2) return TIER2_ONCHAIN_COMMAND_REGEX.test(normalized)
  return TIER3_ONCHAIN_COMMAND_REGEX.test(normalized)
}

export function isErc20InsufficientBalanceError(message: string): boolean {
  return /erc20:\s*insufficient balance|insufficient balance/i.test(message)
}

export function isWalletCancellationMessage(message: string): boolean {
  const lower = (message || "").toLowerCase()
  return (
    lower.includes("user_refused_op") ||
    lower.includes("user refused op") ||
    lower.includes("user rejected") ||
    lower.includes("rejected by user") ||
    lower.includes("request rejected") ||
    lower.includes("user denied") ||
    lower.includes("denied by user") ||
    lower.includes("cancelled") ||
    lower.includes("canceled") ||
    lower.includes("declined")
  )
}

export function formatDecimalTokenAmount(raw: string, decimals: number, precision = 6): string {
  const normalized = (raw || "").replace(/\D/g, "")
  if (!normalized) return "0"
  const trimmed = normalized.replace(/^0+/, "") || "0"
  if (trimmed === "0") return "0"
  if (trimmed.length <= decimals) {
    const fraction = trimmed
      .padStart(decimals, "0")
      .replace(/0+$/, "")
      .slice(0, precision)
    return fraction ? `0.${fraction}` : "0"
  }
  const whole = trimmed.slice(0, trimmed.length - decimals)
  const fraction = trimmed
    .slice(trimmed.length - decimals)
    .replace(/0+$/, "")
    .slice(0, precision)
  return fraction ? `${whole}.${fraction}` : whole
}

export function isResourceBoundsExceedBalanceError(message: string): boolean {
  const lower = (message || "").toLowerCase()
  return (
    lower.includes("validationfailure") &&
    lower.includes("resources bounds") &&
    lower.includes("exceed balance")
  )
}

export function extractExceedBalanceRaw(message: string): string | null {
  const match = message.match(/exceed balance\s*\((\d+)\)/i)
  if (!match) return null
  return match[1] || null
}

export function formatSetupFailureMessage(
  rawMessage: string,
  requiredCarel: number,
  knownCarelBalance: number | null
): string {
  const lowerRaw = rawMessage.toLowerCase()
  if (isResourceBoundsExceedBalanceError(rawMessage)) {
    const rawBalance = extractExceedBalanceRaw(rawMessage)
    const balanceHint = rawBalance
      ? ` Wallet STRK balance is ~${formatDecimalTokenAmount(rawBalance, 18)} STRK.`
      : ""
    return (
      "Insufficient STRK to cover Starknet max-fee/resource-bounds for execution setup." +
      `${balanceHint} Top up STRK (recommended >= 5 STRK), then retry Auto Setup On-Chain.`
    )
  }
  if (isErc20InsufficientBalanceError(rawMessage) || /fee transfer failed/i.test(lowerRaw)) {
    const balanceHint =
      typeof knownCarelBalance === "number" && Number.isFinite(knownCarelBalance)
        ? ` Current CAREL balance: ~${knownCarelBalance.toFixed(6)}.`
        : ""
    return (
      `Insufficient CAREL for execution setup. This transaction burns ${requiredCarel} CAREL on-chain.` +
      `${balanceHint} Top up CAREL, then retry Auto Setup.`
    )
  }
  return rawMessage
}

export function formatExecutionFailureMessage(rawMessage: string, command: string): string {
  const lowerRaw = rawMessage.toLowerCase()
  if (isWalletCancellationMessage(rawMessage)) {
    return "The wallet request was rejected by the user."
  }
  if (/hide note\/pool balance tidak cukup untuk swap ini/i.test(lowerRaw)) {
    const match = rawMessage.match(
      /Requested\s+(.+?),\s+available\s+([0-9.]+)\s+([A-Za-z0-9_]+)\s+di executor/i
    )
    if (match) {
      return `Executor hide note balance is too low for this swap. Requested ${match[1]}, available ${match[2]} ${match[3]} in the executor. Select a smaller note or deposit a new note.`
    }
    return "Executor hide note balance is too low for this swap. Select a smaller note or deposit a new note."
  }
  if (/hide note\/pool balance tidak cukup untuk stake ini/i.test(lowerRaw)) {
    const match = rawMessage.match(/Requested\s+(.+?)\s+([A-Za-z0-9_]+),/i)
    if (match) {
      return `Executor hide note balance is too low for this stake. Requested ${match[1]} ${match[2]}. Select a smaller note or deposit a new note.`
    }
    return "Executor hide note balance is too low for this stake. Select a smaller note or deposit a new note."
  }
  if (/likuiditas on-chain/i.test(lowerRaw)) {
    return "On-chain liquidity is too low for this swap route right now. Reduce the amount or top up swap liquidity, then retry."
  }
  if (/pool belum didukung untuk on-chain staking/i.test(lowerRaw)) {
    return "This staking pool is not supported for on-chain staking."
  }
  if (/hide balance v3 note belum terdaftar|hide balance note belum terdaftar/i.test(lowerRaw)) {
    return "Hide Balance note is not registered yet. Deposit the note first."
  }
  if (/shieldedpoolv3 root belum diinisialisasi|shieldedpool root belum diinisialisasi/i.test(lowerRaw)) {
    return "Shielded pool root is not initialized yet (get_root=0)."
  }
  if (/swap real token belum aktif/i.test(lowerRaw)) {
    return "Real-token swap is not active yet. The configured swap contract is still event-only. Activate an on-chain swap router that moves real tokens, then retry."
  }
  if (/deposit note baru ke v2 diblok|gunakan v3 untuk note baru/i.test(lowerRaw)) {
    return "Legacy Hide Balance pools are disabled. Create a V4 note and retry."
  }
  if (
    /\b(stake|unstake|claim)\b/i.test(command) &&
    /token\s+btc\s+tidak\s+didukung|token\s+.*\s+tidak\s+didukung/i.test(lowerRaw)
  ) {
    return "WBTC (Starknet) token is not registered in the WBTCStaking allowlist yet. Admin must register WBTC first (run `smartcontract/scripts/09_register_staking_tokens.sh` or call `add_wbtc_token`), then retry."
  }
  if (
    /\bstake\b/i.test(command) &&
    /wallet_addinvoketransaction failed: invalid transaction/i.test(lowerRaw) &&
    /expected\":\s*\"array\"/i.test(rawMessage)
  ) {
    return "Wallet rejected multicall payload format for this staking transaction. Retry once; if it still fails, the app will fallback to separate approve + stake signatures."
  }
  if (/\bclaim\b/i.test(command) && isErc20InsufficientBalanceError(rawMessage)) {
    return "Claim reverted with `ERC20: insufficient balance`. The staking reward pool likely has insufficient on-chain reward liquidity right now. Retry later or top up reward token liquidity, then claim again."
  }
  return rawMessage
}

export function isRelayerAllowanceErrorMessage(message: string): boolean {
  return /(insufficient allowance|shielded note funding failed|deposit_fixed_for|allowance)/i.test(
    message || ""
  )
}

export function isWalletMulticallPayloadError(message: string): boolean {
  const lower = message.toLowerCase()
  const isWalletInvokeFailure =
    /wallet_addinvoketransaction failed|account\.execute failed|failed to submit starknet transaction from wallet/i.test(
      lower
    )
  if (!isWalletInvokeFailure) return false
  return (
    /invalid_union|invalid input/i.test(lower) ||
    /expected\":\s*\"array\"/i.test(message) ||
    /expected':\s*'array'/i.test(message)
  )
}

export function isWalletMulticallExecutionError(message: string): boolean {
  const lower = message.toLowerCase()
  const isWalletInvokeFailure =
    /wallet_addinvoketransaction failed|account\.execute failed|failed to submit starknet transaction from wallet/i.test(
      lower
    )
  if (!isWalletInvokeFailure) return false
  return (
    /argent\/multicall-failed|multicall-failed|invalid user signature|entrypoint_failed/i.test(
      lower
    )
  )
}

export async function invokeWalletCallsWithSequentialFallback(
  calls: Parameters<typeof invokeStarknetCallsFromWallet>[0],
  providerHint: Parameters<typeof invokeStarknetCallsFromWallet>[1],
  options?: { allowSequentialFallback?: boolean; onFallback?: () => void }
): Promise<string> {
  try {
    return await invokeStarknetCallsFromWallet(calls, providerHint)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "")
    const shouldFallbackSequentially =
      options?.allowSequentialFallback &&
      calls.length >= 2 &&
      (isWalletMulticallPayloadError(message) || isWalletMulticallExecutionError(message))
    if (!shouldFallbackSequentially) {
      throw error
    }
    options.onFallback?.()
    let lastTxHash = ""
    for (const call of calls) {
      lastTxHash = await invokeStarknetCallFromWallet(call, providerHint)
    }
    return lastTxHash
  }
}

export function isAffirmativeConfirmation(value: string): boolean {
  return /^(yes|yess|yesss|yse|ye|y|ya|iya|yup|ok|okay|oke|lanjut|proceed|confirm)$/i.test(
    value.trim()
  )
}

export function isNegativeConfirmation(value: string): boolean {
  return /^(no|nope|nop|n|tidak|ga|gak|batal|cancel|stop)$/i.test(value.trim())
}

export function executionBurnAmountCarel(tier: number): number {
  return tier >= 3 ? 2 : 1
}

export function estimateOptimisticPoints(amountText: string, tier: number): string {
  const amount = Number.parseFloat(amountText)
  if (!Number.isFinite(amount) || amount <= 0) {
    return tier >= 3 ? "~1.40 pts" : "~1.20 pts"
  }
  const base = Math.max(1, amount)
  const multiplier = tier >= 3 ? 1.4 : 1.2
  return `~${(base * multiplier).toFixed(2)} pts`
}

export function buildOptimisticExecutionPreview(
  command: string,
  tier: number,
  selectedHideTierUsdt?: number
): OptimisticExecutionPreview | null {
  if (tier < 2) return null
  const normalized = normalizeAiCommandInput(command)
  if (!normalized) return null

  const swap = parseSwapTokensFromCommand(normalized)
  if (swap && swap.amountText) {
    return {
      title: "Swap Preview",
      fromToken: swap.fromToken,
      toToken: swap.toToken,
      amountText: swap.amountText,
      estimatedPoints: estimateOptimisticPoints(swap.amountText, tier),
    }
  }

  if (tier >= 3 && /\b(private|hide)\b/i.test(normalized)) {
    const privateSwapPair = normalized.match(
      /\b(?:please\s+)?(?:(?:hide|private)\s+)?(?:swap|tukar)\b\s+([a-z0-9]{2,12})\s*(?:to|ke|->|→)\s*([a-z0-9]{2,12})\b/i
    )
    if (privateSwapPair) {
      const inferredTier = parseHideTierFromCommand(normalized)
      const tierUsdt =
        inferredTier ||
        (typeof selectedHideTierUsdt === "number" && Number.isFinite(selectedHideTierUsdt)
          ? selectedHideTierUsdt
          : 0)
      const fromToken = (privateSwapPair[1] || "").trim().toUpperCase()
      const toToken = (privateSwapPair[2] || "").trim().toUpperCase()
      if (fromToken && toToken && tierUsdt > 0) {
        const tierAmountLabel =
          fromToken === "USDT" || fromToken === "USDC" || fromToken === "CAREL"
            ? String(tierUsdt)
            : `$${tierUsdt} tier`
        return {
          title: "Swap Preview",
          fromToken,
          toToken,
          amountText: tierAmountLabel,
          estimatedPoints: estimateOptimisticPoints(String(tierUsdt), tier),
        }
      }
    }
  }

  const bridge = parseBridgeTokensFromCommand(normalized)
  if (bridge && bridge.amountText) {
    return {
      title: "Bridge Preview",
      fromToken: bridge.fromToken,
      toToken: bridge.toToken,
      amountText: bridge.amountText,
      estimatedPoints: estimateOptimisticPoints(bridge.amountText, tier),
    }
  }

  const stake = parseStakeTokenAmountFromCommand(normalized)
  if (stake && stake.amountText) {
    return {
      title: "Stake Preview",
      fromToken: stake.token,
      toToken: stake.token,
      amountText: stake.amountText,
      estimatedPoints: estimateOptimisticPoints(stake.amountText, tier),
    }
  }

  const limit = parseLimitOrderIntentFromCommand(normalized)
  if (limit && limit.amountText) {
    return {
      title: "Limit Order Preview",
      fromToken: limit.fromToken,
      toToken: limit.toToken,
      amountText: limit.amountText,
      estimatedPoints: estimateOptimisticPoints(limit.amountText, tier),
    }
  }

  return null
}

export function formatBtcFromSats(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0.00000000 BTC"
  return `${(value / 100_000_000).toFixed(8)} BTC`
}

export function bridgeTargetChainForToken(token: string): string {
  const normalized = token.toUpperCase()
  if (normalized === "BTC") return "bitcoin"
  if (normalized === "WBTC") return "starknet"
  if (normalized === "ETH" || normalized === "WETH") return "ethereum"
  return "starknet"
}

export function isSupportedBridgePair(
  fromChain: string,
  toChain: string,
  fromToken: string,
  toToken: string
): boolean {
  const from = fromToken.trim().toUpperCase()
  const to = toToken.trim().toUpperCase()
  return (
    (fromChain === "ethereum" && toChain === "bitcoin" && from === "ETH" && to === "BTC") ||
    (fromChain === "bitcoin" && toChain === "ethereum" && from === "BTC" && to === "ETH") ||
    (fromChain === "bitcoin" && toChain === "starknet" && from === "BTC" && to === "WBTC") ||
    (fromChain === "starknet" && toChain === "bitcoin" && from === "WBTC" && to === "BTC") ||
    (fromChain === "ethereum" && toChain === "starknet" && from === "ETH" && to === "WBTC") ||
    (fromChain === "starknet" && toChain === "ethereum" && from === "WBTC" && to === "ETH")
  )
}

export function missingSourceAddressMessage(chain: string): string {
  if (chain === "bitcoin") {
    return "BTC source address is missing. Connect UniSat/Xverse first."
  }
  if (chain === "ethereum") {
    return "Ethereum source address is missing. Connect MetaMask first."
  }
  return "Starknet source address is missing. Connect ArgentX/Braavos first."
}

export function missingDestinationAddressMessage(chain: string): string {
  if (chain === "bitcoin") {
    return "BTC destination address is missing. Connect UniSat/Xverse first."
  }
  if (chain === "ethereum") {
    return "Ethereum destination address is missing. Connect MetaMask first."
  }
  return "Starknet destination address is missing. Connect ArgentX/Braavos first."
}

export function bridgeAddressRequirementError(
  fromToken: string,
  toToken: string,
  walletContext: BridgeAddressContext
): string | null {
  const fromChain = bridgeTargetChainForToken(fromToken)
  const toChain = bridgeTargetChainForToken(toToken)
  const sourceOwner =
    fromChain === "bitcoin"
      ? walletContext.btcAddress || ""
      : fromChain === "ethereum"
        ? walletContext.evmAddress || ""
        : walletContext.starknetAddress || walletContext.address || ""
  const recipient =
    toChain === "bitcoin"
      ? walletContext.btcAddress || ""
      : toChain === "ethereum"
        ? walletContext.evmAddress || ""
        : walletContext.starknetAddress || walletContext.address || ""

  if (!sourceOwner) return missingSourceAddressMessage(fromChain)
  if (!recipient) return missingDestinationAddressMessage(toChain)
  return null
}

export function buildGardenOrderExplorerUrl(orderId: string): string {
  const normalizedOrderId = orderId.trim()
  if (!normalizedOrderId) return ""
  const base = GARDEN_ORDER_EXPLORER_BASE_URL.trim().replace(/\/$/, "")
  if (!base) return ""
  return `${base}/${encodeURIComponent(normalizedOrderId)}`
}

export function buildTxExplorerUrl(txHash: string, network: TxExplorerNetwork): string {
  const normalizedHash = txHash.trim()
  if (!normalizedHash) return ""
  if (network === "starknet") {
    const base = STARKSCAN_SEPOLIA_BASE_URL.trim().replace(/\/$/, "")
    return base ? `${base}/tx/${normalizedHash}` : ""
  }
  if (network === "evm") {
    const base = ETHERSCAN_SEPOLIA_BASE_URL.trim().replace(/\/$/, "")
    return base ? `${base}/tx/${normalizedHash}` : ""
  }
  const btcHash = normalizedHash.startsWith("0x") ? normalizedHash.slice(2) : normalizedHash
  const base = BTC_TESTNET_EXPLORER_BASE_URL.trim().replace(/\/$/, "")
  return base ? `${base}/tx/${btcHash}` : ""
}

export function nowTimestampLabel(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export function shortAddress(value: string, head = 6, tail = 4): string {
  const normalized = (value || "").trim()
  if (!normalized) return "-"
  if (normalized.length <= head + tail + 3) return normalized
  return `${normalized.slice(0, head)}...${normalized.slice(-tail)}`
}

export const TRAILING_URL_PUNCTUATION = new Set([".", ",", "!", "?", ";", ":", ")", "]", "}"])

export function splitUrlWithTrailingPunctuation(rawUrl: string): { url: string; trailing: string } {
  if (!rawUrl) return { url: "", trailing: "" }
  let end = rawUrl.length
  while (end > 0 && TRAILING_URL_PUNCTUATION.has(rawUrl[end - 1])) {
    end -= 1
  }
  return {
    url: rawUrl.slice(0, end),
    trailing: rawUrl.slice(end),
  }
}
