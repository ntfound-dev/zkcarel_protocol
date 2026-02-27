"use client"

import {
  EVM_SEPOLIA_CHAIN_ID,
  EVM_SEPOLIA_CHAIN_ID_HEX,
  isStarknetSepolia,
  normalizeStarknetChainValue,
} from "@/lib/network-config"
import {
  EVM_SEPOLIA_CHAIN_PARAMS,
  STARKNET_API_VERSIONS,
  STARKNET_PROVIDER_ID_ALIASES,
  STARKNET_SWITCH_CHAIN_PAYLOADS,
  type WalletProviderType,
} from "@/lib/wallet-provider-config"

type StarknetWalletHint = Extract<WalletProviderType, "starknet" | "argentx" | "braavos">

type InjectedStarknet = {
  id?: string
  name?: string
  chainId?: string
  selectedAddress?: string
  request?: (payload: { type?: string; method?: string; params?: unknown }) => Promise<unknown>
  enable?: (opts?: { showModal?: boolean }) => Promise<unknown>
  account?: {
    address?: string
    execute?: (calls: unknown) => Promise<unknown>
    signMessage?: (typedData: Record<string, unknown>) => Promise<unknown>
    getChainId?: () => Promise<unknown> | unknown
  }
  provider?: {
    getChainId?: () => Promise<unknown> | unknown
  }
}

type InjectedEvm = {
  isMetaMask?: boolean
  request: (payload: { method: string; params?: unknown[] }) => Promise<unknown>
  providers?: InjectedEvm[]
}

export type StarknetInvokeCall = {
  contractAddress: string
  entrypoint: string
  calldata: Array<string | number | bigint>
}

export type StarknetInvokeReadableMetadata = {
  action_type?: string
  from_token?: string
  to_token?: string
  amount?: string
  fee?: string
  privacy?: string
}

export type StarknetInvokeOptions = {
  readableMetadata?: StarknetInvokeReadableMetadata
}

const BIGINT_ZERO = BigInt(0)
const BIGINT_ONE = BigInt(1)
const TWO_POW_128 = powBigInt(2, 128)
const MAX_U128 = TWO_POW_128 - BIGINT_ONE

function isHexSelector(value: string) {
  return /^0x[0-9a-fA-F]+$/.test((value || "").trim())
}

function normalizeSelectorLikeValue(value: string): string {
  const trimmed = (value || "").trim()
  if (!trimmed) return trimmed
  if (isHexSelector(trimmed)) {
    return `0x${trimmed.slice(2).toLowerCase()}`
  }
  if (/^\d+$/.test(trimmed)) {
    return `0x${BigInt(trimmed).toString(16)}`
  }
  return trimmed
}

/**
 * Runs `invokeStarknetCallsFromWallet` and handles related side effects.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export async function invokeStarknetCallsFromWallet(
  calls: StarknetInvokeCall[],
  providerHint: StarknetWalletHint = "starknet",
  options?: StarknetInvokeOptions
): Promise<string> {
  if (!Array.isArray(calls) || calls.length === 0) {
    throw new Error("No Starknet calls to execute.")
  }

  const injected = getInjectedStarknet(providerHint)
  if (!injected) {
    throw new Error("No Starknet wallet detected. Install Braavos or ArgentX.")
  }

  await ensureStarknetAccounts(injected)
  const chainId = await ensureStarknetSepolia(injected)
  if (!isStarknetSepolia(chainId)) {
    const normalized = normalizeStarknetChainValue(chainId || "")
    throw new Error(
      `Please switch wallet network to Starknet Sepolia before signing transaction. Current network: ${
        normalized || "unknown"
      }.`
    )
  }

  const normalizedCalls = calls.map((call) => ({
    contractAddress: call.contractAddress,
    entrypoint: normalizeSelectorLikeValue(call.entrypoint),
    calldata: call.calldata.map((item) => toHexFelt(item)),
  }))
  const isSelectorCall = (entrypoint: string) => isHexSelector(entrypoint)
  const toMixedCallShape = (
    call: { contractAddress: string; entrypoint: string; calldata: string[] },
    style: "snake" | "camel" | "to",
    preferEntryPointSelector = false
  ): Record<string, unknown> => {
    if (style === "snake") {
      if (isSelectorCall(call.entrypoint)) {
        return preferEntryPointSelector
          ? {
              contract_address: call.contractAddress,
              entry_point_selector: call.entrypoint,
              calldata: call.calldata,
            }
          : {
              contract_address: call.contractAddress,
              selector: call.entrypoint,
              calldata: call.calldata,
            }
      }
      return {
        contract_address: call.contractAddress,
        entry_point: call.entrypoint,
        calldata: call.calldata,
      }
    }
    if (style === "camel") {
      if (isSelectorCall(call.entrypoint)) {
        return preferEntryPointSelector
          ? {
              contractAddress: call.contractAddress,
              entryPointSelector: call.entrypoint,
              calldata: call.calldata,
            }
          : {
              contractAddress: call.contractAddress,
              selector: call.entrypoint,
              calldata: call.calldata,
            }
      }
      return {
        contractAddress: call.contractAddress,
        entrypoint: call.entrypoint,
        calldata: call.calldata,
      }
    }
    if (isSelectorCall(call.entrypoint)) {
      return preferEntryPointSelector
        ? {
            to: call.contractAddress,
            entry_point_selector: call.entrypoint,
            calldata: call.calldata,
          }
        : {
            to: call.contractAddress,
            selector: call.entrypoint,
            calldata: call.calldata,
          }
    }
    return {
      to: call.contractAddress,
      entrypoint: call.entrypoint,
      calldata: call.calldata,
    }
  }
  const executeCallsMixedTo = normalizedCalls.map((call) => toMixedCallShape(call, "to"))
  const executeCallsMixedCamel = normalizedCalls.map((call) => toMixedCallShape(call, "camel"))
  const executeCallsMixedSnake = normalizedCalls.map((call) => toMixedCallShape(call, "snake"))
  const executeCallsMixedEntryPointSelectorSnake = normalizedCalls.map((call) =>
    toMixedCallShape(call, "snake", true)
  )
  const executeCallsMixedEntryPointSelectorTo = normalizedCalls.map((call) =>
    toMixedCallShape(call, "to", true)
  )
  const executeCallsEntrypointCamel = normalizedCalls.map((call) => ({
    contractAddress: call.contractAddress,
    entrypoint: call.entrypoint,
    calldata: call.calldata,
  }))
  const executeCallsEntrypointSnake = normalizedCalls.map((call) => ({
    contract_address: call.contractAddress,
    entry_point: call.entrypoint,
    calldata: call.calldata,
  }))
  const invokeCallsMixedEntryPointSelectorSnake = executeCallsMixedEntryPointSelectorSnake
  const invokeCallsMixedEntryPointSelectorCamel = normalizedCalls.map((call) =>
    toMixedCallShape(call, "camel", true)
  )
  const invokeCallsMixedSnake = executeCallsMixedSnake
  const invokeCallsMixedCamel = executeCallsMixedCamel
  const invokeCallsMixedTo = executeCallsMixedTo
  const invokeCallsEntrypointCamel = executeCallsEntrypointCamel
  const invokeCallsEntrypointSnake = executeCallsEntrypointSnake
  const readableMetadata = normalizeReadableInvokeMetadata(options?.readableMetadata)
  const attemptErrors: string[] = []
  const walletIdAlias = normalizeAlias(injected.id)
  const walletNameAlias = normalizeAlias(injected.name)
  const isArgentLikeWallet =
    walletIdAlias.includes("argent") ||
    walletNameAlias.includes("argent") ||
    walletIdAlias.includes("ready") ||
    walletNameAlias.includes("ready")
  const requiresStrictWalletInvoke =
    normalizedCalls.length > 2 ||
    normalizedCalls.some((call) => call.entrypoint === "submit_private_action")
  const preferWalletRequestPath = normalizedCalls.length >= 2 || isArgentLikeWallet
  const account = injected.account as InjectedStarknet["account"] | undefined
  const runAccountExecuteAttempts = async (): Promise<string | null> => {
    if (!account?.execute || requiresStrictWalletInvoke) return null
    const attempts: Array<Array<Record<string, unknown>>> = [
      executeCallsEntrypointCamel,
      executeCallsEntrypointSnake,
      executeCallsMixedTo,
      executeCallsMixedCamel,
      executeCallsMixedSnake,
      executeCallsMixedEntryPointSelectorSnake,
      executeCallsMixedEntryPointSelectorTo,
    ]
    for (const payload of attempts) {
      try {
        const result = await account.execute(payload)
        const txHash = extractTxHash(result)
        if (txHash) return txHash
        attemptErrors.push("account.execute returned without tx hash")
      } catch (error) {
        if (isWalletUserRejectedError(error)) {
          throw new Error("Wallet signature was rejected.")
        }
        attemptErrors.push(`account.execute failed: ${walletErrorMessage(error)}`)
      }
    }
    return null
  }

  const requestPayloads: Array<{ type: string; params: unknown }> = [
    ...(readableMetadata
      ? [
          {
            type: "wallet_addInvokeTransaction",
            params: {
              calls: invokeCallsEntrypointSnake,
              readable_metadata: readableMetadata,
              tx_metadata: readableMetadata,
              transaction_metadata: readableMetadata,
            },
          },
          {
            type: "wallet_addInvokeTransaction",
            params: [
              {
                calls: invokeCallsEntrypointSnake,
                readable_metadata: readableMetadata,
                tx_metadata: readableMetadata,
                transaction_metadata: readableMetadata,
              },
            ],
          },
          {
            type: "starknet_addInvokeTransaction",
            params: {
              calls: invokeCallsEntrypointSnake,
              readable_metadata: readableMetadata,
              tx_metadata: readableMetadata,
              transaction_metadata: readableMetadata,
            },
          },
          {
            type: "starknet_addInvokeTransaction",
            params: [
              {
                calls: invokeCallsEntrypointSnake,
                readable_metadata: readableMetadata,
                tx_metadata: readableMetadata,
                transaction_metadata: readableMetadata,
              },
            ],
          },
        ]
      : []),
    { type: "wallet_addInvokeTransaction", params: invokeCallsEntrypointSnake },
    { type: "wallet_addInvokeTransaction", params: [invokeCallsEntrypointSnake] },
    { type: "wallet_addInvokeTransaction", params: invokeCallsEntrypointCamel },
    { type: "wallet_addInvokeTransaction", params: [invokeCallsEntrypointCamel] },
    { type: "wallet_addInvokeTransaction", params: invokeCallsMixedSnake },
    { type: "wallet_addInvokeTransaction", params: [invokeCallsMixedSnake] },
    { type: "wallet_addInvokeTransaction", params: invokeCallsMixedCamel },
    { type: "wallet_addInvokeTransaction", params: [invokeCallsMixedCamel] },
    { type: "wallet_addInvokeTransaction", params: invokeCallsMixedTo },
    { type: "wallet_addInvokeTransaction", params: [invokeCallsMixedTo] },
    { type: "wallet_addInvokeTransaction", params: { calls: invokeCallsEntrypointSnake } },
    { type: "wallet_addInvokeTransaction", params: [{ calls: invokeCallsEntrypointSnake }] },
    { type: "wallet_addInvokeTransaction", params: { calls: invokeCallsEntrypointCamel } },
    { type: "wallet_addInvokeTransaction", params: { calls: invokeCallsMixedEntryPointSelectorSnake } },
    { type: "wallet_addInvokeTransaction", params: [{ calls: invokeCallsMixedEntryPointSelectorSnake }] },
    { type: "wallet_addInvokeTransaction", params: { calls: invokeCallsMixedEntryPointSelectorCamel } },
    { type: "wallet_addInvokeTransaction", params: { calls: invokeCallsMixedSnake } },
    { type: "wallet_addInvokeTransaction", params: [{ calls: invokeCallsMixedSnake }] },
    { type: "wallet_addInvokeTransaction", params: { calls: invokeCallsMixedCamel } },
    { type: "wallet_addInvokeTransaction", params: { calls: invokeCallsMixedTo } },
    { type: "starknet_addInvokeTransaction", params: invokeCallsEntrypointSnake },
    { type: "starknet_addInvokeTransaction", params: [invokeCallsEntrypointSnake] },
    { type: "starknet_addInvokeTransaction", params: invokeCallsMixedSnake },
    { type: "starknet_addInvokeTransaction", params: [invokeCallsMixedSnake] },
    { type: "starknet_addInvokeTransaction", params: { calls: invokeCallsEntrypointSnake } },
    { type: "starknet_addInvokeTransaction", params: [{ calls: invokeCallsEntrypointSnake }] },
  ]

  const runWalletRequestAttempts = async (): Promise<string | null> => {
    if (!injected.request) return null
    for (const payload of requestPayloads) {
      try {
        const result = await requestStarknet(injected, payload)
        const txHash = extractTxHash(result)
        if (txHash) return txHash
        attemptErrors.push(`wallet request returned without tx hash (${payload.type})`)
      } catch (error) {
        if (isWalletUserRejectedError(error)) {
          throw new Error("Wallet signature was rejected.")
        }
        attemptErrors.push(`${payload.type} failed: ${walletErrorMessage(error)}`)
      }
    }
    return null
  }

  if (preferWalletRequestPath) {
    const requestTxHash = await runWalletRequestAttempts()
    if (requestTxHash) return requestTxHash
    const accountTxHash = await runAccountExecuteAttempts()
    if (accountTxHash) return accountTxHash
  } else {
    const accountTxHash = await runAccountExecuteAttempts()
    if (accountTxHash) return accountTxHash
    const requestTxHash = await runWalletRequestAttempts()
    if (requestTxHash) return requestTxHash
  }

  if (!injected.request && !account?.execute) {
    throw new Error("Injected Starknet wallet does not support transaction requests or account execution.")
  }

  const meaningfulErrors = attemptErrors.filter(
    (item) => !/unknown request type|unsupported request type|method not found/i.test(item)
  )
  const detail =
    meaningfulErrors[meaningfulErrors.length - 1] ||
    (attemptErrors.length > 0 ? attemptErrors[attemptErrors.length - 1] : null)
  if (detail) {
    throw new Error(`Failed to submit Starknet transaction from wallet. ${detail}`)
  }
  throw new Error("Failed to submit Starknet transaction from wallet.")
}

// Internal helper that normalizes optional readable metadata for wallet invoke requests.
function normalizeReadableInvokeMetadata(
  metadata?: StarknetInvokeReadableMetadata
): StarknetInvokeReadableMetadata | null {
  if (!metadata || typeof metadata !== "object") return null
  const normalized: StarknetInvokeReadableMetadata = {}
  const fields: Array<keyof StarknetInvokeReadableMetadata> = [
    "action_type",
    "from_token",
    "to_token",
    "amount",
    "fee",
    "privacy",
  ]
  for (const field of fields) {
    const value = metadata[field]
    if (typeof value !== "string") continue
    const cleaned = value.trim()
    if (!cleaned) continue
    normalized[field] = cleaned
  }
  return Object.keys(normalized).length > 0 ? normalized : null
}

/**
 * Runs `invokeStarknetCallFromWallet` and handles related side effects.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export async function invokeStarknetCallFromWallet(
  call: StarknetInvokeCall,
  providerHint: StarknetWalletHint = "starknet"
): Promise<string> {
  return invokeStarknetCallsFromWallet([call], providerHint)
}

/**
 * Runs `signStarknetTypedDataFromWallet` and handles related side effects.
 *
 * @param typedData - Input used by `signStarknetTypedDataFromWallet` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export async function signStarknetTypedDataFromWallet(
  typedData: Record<string, unknown>,
  providerHint: StarknetWalletHint = "starknet"
): Promise<string[]> {
  if (!typedData || typeof typedData !== "object") {
    throw new Error("Typed data payload is required for Starknet signature.")
  }

  const injected = getInjectedStarknet(providerHint)
  if (!injected) {
    throw new Error("No Starknet wallet detected. Install Braavos or ArgentX.")
  }

  await ensureStarknetAccounts(injected)
  const chainId = await ensureStarknetSepolia(injected)
  if (!isStarknetSepolia(chainId)) {
    const normalized = normalizeStarknetChainValue(chainId || "")
    throw new Error(
      `Please switch wallet network to Starknet Sepolia before signing message. Current network: ${
        normalized || "unknown"
      }.`
    )
  }

  const signerAddress = (injected.selectedAddress || injected.account?.address || "").trim()
  const signatureErrors: string[] = []

  if (injected.request) {
    const requestPayloads: Array<{ type: string; params: unknown }> = [
      { type: "wallet_signTypedData", params: typedData },
      { type: "wallet_signTypedData", params: [typedData] },
      { type: "wallet_signTypedData", params: { typedData } },
      { type: "starknet_signTypedData", params: typedData },
      { type: "starknet_signTypedData", params: [typedData] },
      { type: "signTypedData", params: typedData },
      { type: "signTypedData", params: [typedData] },
    ]
    if (signerAddress) {
      requestPayloads.push(
        { type: "wallet_signTypedData", params: [signerAddress, typedData] },
        { type: "starknet_signTypedData", params: [signerAddress, typedData] },
        { type: "signTypedData", params: [signerAddress, typedData] }
      )
    }
    for (const payload of requestPayloads) {
      try {
        const result = await requestStarknet(injected, payload)
        const signature = parseStarknetSignature(result)
        if (signature && signature.length > 0) return signature
        signatureErrors.push(`${payload.type} returned without valid signature`)
      } catch (error) {
        if (isWalletUserRejectedError(error)) {
          throw new Error("Wallet signature was rejected.")
        }
        signatureErrors.push(`${payload.type} failed: ${walletErrorMessage(error)}`)
      }
    }
  }

  if (typeof injected.account?.signMessage === "function") {
    try {
      const result = await injected.account.signMessage(typedData)
      const signature = parseStarknetSignature(result)
      if (signature && signature.length > 0) return signature
      signatureErrors.push("account.signMessage returned without valid signature")
    } catch (error) {
      if (isWalletUserRejectedError(error)) {
        throw new Error("Wallet signature was rejected.")
      }
      signatureErrors.push(`account.signMessage failed: ${walletErrorMessage(error)}`)
    }
  }

  const meaningfulErrors = signatureErrors.filter(
    (item) => !/unknown request type|unsupported request type|method not found/i.test(item)
  )
  const detail =
    meaningfulErrors[meaningfulErrors.length - 1] ||
    (signatureErrors.length > 0 ? signatureErrors[signatureErrors.length - 1] : null)
  if (detail) {
    throw new Error(`Failed to sign Starknet typed data from wallet. ${detail}`)
  }
  throw new Error("Failed to sign Starknet typed data from wallet.")
}

export function buildErc20ApproveCall(
  tokenAddress: string,
  spenderAddress: string,
  amountLow: string | number | bigint,
  amountHigh: string | number | bigint
): StarknetInvokeCall {
  const token = tokenAddress.trim()
  const spender = spenderAddress.trim()
  if (!token || !spender) {
    throw new Error("Token and spender address are required for ERC20 approve.")
  }
  return {
    contractAddress: token,
    entrypoint: "approve",
    calldata: [spender, amountLow, amountHigh],
  }
}

export async function signPrivacyParamsForRelayer(
  typedData: Record<string, unknown>,
  providerHint: StarknetWalletHint = "starknet"
): Promise<string[]> {
  return signStarknetTypedDataFromWallet(typedData, providerHint)
}

export async function signStarknetMessageHashFromWallet(
  messageHash: string,
  providerHint: StarknetWalletHint = "starknet"
): Promise<string[]> {
  const normalizedHash = toHexFelt(messageHash)
  const injected = getInjectedStarknet(providerHint)
  if (!injected) {
    throw new Error("No Starknet wallet detected. Install Braavos or ArgentX.")
  }

  await ensureStarknetAccounts(injected)
  const chainId = await ensureStarknetSepolia(injected)
  if (!isStarknetSepolia(chainId)) {
    const normalized = normalizeStarknetChainValue(chainId || "")
    throw new Error(
      `Please switch wallet network to Starknet Sepolia before signing message. Current network: ${
        normalized || "unknown"
      }.`
    )
  }

  const signerAddress = (injected.selectedAddress || injected.account?.address || "").trim()
  const signatureErrors: string[] = []

  if (injected.request) {
    const requestPayloads: Array<{ type: string; params: unknown }> = [
      { type: "wallet_signMessage", params: { message: normalizedHash } },
      { type: "wallet_signMessage", params: [{ message: normalizedHash }] },
      { type: "wallet_signMessage", params: [normalizedHash] },
      { type: "starknet_signMessage", params: { message: normalizedHash } },
      { type: "starknet_signMessage", params: [{ message: normalizedHash }] },
      { type: "starknet_signMessage", params: [normalizedHash] },
      { type: "signMessage", params: { message: normalizedHash } },
      { type: "signMessage", params: [normalizedHash] },
    ]
    if (signerAddress) {
      requestPayloads.push(
        { type: "wallet_signMessage", params: [signerAddress, normalizedHash] },
        { type: "starknet_signMessage", params: [signerAddress, normalizedHash] },
        { type: "signMessage", params: [signerAddress, normalizedHash] }
      )
    }
    for (const payload of requestPayloads) {
      try {
        const result = await requestStarknet(injected, payload)
        const signature = parseStarknetSignature(result)
        if (signature && signature.length > 0) return signature
        signatureErrors.push(`${payload.type} returned without valid signature`)
      } catch (error) {
        if (isWalletUserRejectedError(error)) {
          throw new Error("Wallet signature was rejected.")
        }
        signatureErrors.push(`${payload.type} failed: ${walletErrorMessage(error)}`)
      }
    }
  }

  if (typeof injected.account?.signMessage === "function") {
    const accountPayloads: Array<unknown> = [
      { message: normalizedHash },
      normalizedHash,
      [normalizedHash],
    ]
    for (const payload of accountPayloads) {
      try {
        const result = await injected.account.signMessage(payload as Record<string, unknown>)
        const signature = parseStarknetSignature(result)
        if (signature && signature.length > 0) return signature
        signatureErrors.push("account.signMessage returned without valid signature")
      } catch (error) {
        if (isWalletUserRejectedError(error)) {
          throw new Error("Wallet signature was rejected.")
        }
        signatureErrors.push(`account.signMessage failed: ${walletErrorMessage(error)}`)
      }
    }
  }

  const meaningfulErrors = signatureErrors.filter(
    (item) => !/unknown request type|unsupported request type|method not found/i.test(item)
  )
  const detail =
    meaningfulErrors[meaningfulErrors.length - 1] ||
    (signatureErrors.length > 0 ? signatureErrors[signatureErrors.length - 1] : null)
  if (detail) {
    throw new Error(`Failed to sign Starknet message hash from wallet. ${detail}`)
  }
  throw new Error("Failed to sign Starknet message hash from wallet.")
}

export async function submitSignedPrivacyParamsToRelayer(options: {
  endpoint: string
  payload: Record<string, unknown>
  authToken?: string
}): Promise<Record<string, unknown>> {
  const endpoint = options.endpoint.trim()
  if (!endpoint) {
    throw new Error("Relayer endpoint is required.")
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (options.authToken && options.authToken.trim()) {
    headers.Authorization = `Bearer ${options.authToken.trim()}`
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(options.payload),
  })
  const raw = await response.text()
  let parsed: Record<string, unknown> = {}
  if (raw.trim()) {
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>
    } catch {
      throw new Error(`Relayer returned non-JSON response (${response.status}).`)
    }
  }
  if (!response.ok) {
    const message =
      typeof parsed?.message === "string" && parsed.message.trim()
        ? parsed.message.trim()
        : `Relayer request failed (${response.status}).`
    throw new Error(message)
  }
  return parsed
}

/**
 * Runs `sendEvmNativeTransferFromWallet` and handles related side effects.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export async function sendEvmNativeTransferFromWallet(
  to: string,
  amountEth: string
): Promise<string> {
  const recipient = to.trim()
  if (!recipient) {
    throw new Error("EVM bridge receiver address is empty.")
  }
  const evm = getInjectedEvmMetaMask()
  if (!evm) {
    throw new Error("MetaMask not detected. Install MetaMask for Ethereum bridge signature.")
  }

  const from = await requestEvmAccount(evm)
  await ensureEvmSepolia(evm)
  const valueWei = parseDecimalToScaledBigInt(amountEth, 18)
  if (valueWei <= BIGINT_ZERO) {
    throw new Error("Bridge amount must be positive.")
  }

  const txHash = await evm.request({
    method: "eth_sendTransaction",
    params: [
      {
        from,
        to: recipient,
        value: toHexFelt(valueWei),
      },
    ],
  })

  const normalized = extractTxHash(txHash)
  if (!normalized) {
    throw new Error("Failed to get tx hash from MetaMask transaction.")
  }
  return normalized
}

/**
 * Runs `sendEvmTransactionFromWallet` and handles related side effects.
 *
 * @param tx - Input used by `sendEvmTransactionFromWallet` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export async function sendEvmTransactionFromWallet(tx: {
  to: string
  value?: string
  data?: string
  chain_id?: number
  gas_limit?: number
}): Promise<string> {
  const recipient = normalizeEvmAddress(tx.to)
  if (!recipient) {
    throw new Error("Garden EVM transaction has invalid recipient address.")
  }
  if (typeof tx.chain_id === "number" && tx.chain_id > 0 && tx.chain_id !== EVM_SEPOLIA_CHAIN_ID) {
    throw new Error(`Unsupported Garden EVM chain_id ${tx.chain_id}. Expected ${EVM_SEPOLIA_CHAIN_ID}.`)
  }

  const evm = getInjectedEvmMetaMask()
  if (!evm) {
    throw new Error("MetaMask not detected. Install MetaMask for Ethereum bridge signature.")
  }
  const from = await requestEvmAccount(evm)
  await ensureEvmSepolia(evm)

  const valueRaw = (tx.value || "").trim()
  const value = valueRaw ? toHexFelt(valueRaw) : "0x0"
  const dataRaw = (tx.data || "").trim()
  const data = dataRaw
    ? dataRaw.startsWith("0x") || dataRaw.startsWith("0X")
      ? `0x${dataRaw.slice(2)}`
      : `0x${dataRaw}`
    : undefined

  const payload: Record<string, unknown> = {
    from,
    to: recipient,
    value,
  }
  if (data && data.length > 2) {
    payload.data = data
  }
  if (typeof tx.gas_limit === "number" && Number.isFinite(tx.gas_limit) && tx.gas_limit > 0) {
    payload.gas = `0x${Math.trunc(tx.gas_limit).toString(16)}`
  }

  const txHash = await evm.request({
    method: "eth_sendTransaction",
    params: [payload],
  })
  const normalized = extractTxHash(txHash)
  if (!normalized) {
    throw new Error("Failed to get tx hash from Garden EVM transaction.")
  }
  return normalized
}

/**
 * Fetches data for `getConnectedEvmAddressFromWallet`.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export async function getConnectedEvmAddressFromWallet(): Promise<string> {
  const evm = getInjectedEvmMetaMask()
  if (!evm) {
    throw new Error("MetaMask not detected. Install MetaMask for Ethereum bridge signature.")
  }
  const account = await requestEvmAccount(evm)
  const normalized = normalizeEvmAddress(account)
  if (!normalized) {
    throw new Error("MetaMask returned invalid EVM account address.")
  }
  return normalized
}

/**
 * Runs `sendEvmStarkgateEthDepositFromWallet` and handles related side effects.
 *
 * @param params - Input used by `sendEvmStarkgateEthDepositFromWallet` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export async function sendEvmStarkgateEthDepositFromWallet(params: {
  bridgeAddress: string
  tokenAddress: string
  amountEth: string
  l2Recipient: string
  feeWei?: bigint | null
}): Promise<string> {
  const bridgeAddress = normalizeEvmAddress(params.bridgeAddress)
  const tokenAddress = normalizeEvmAddress(params.tokenAddress)
  if (!bridgeAddress) {
    throw new Error("StarkGate bridge address is invalid.")
  }
  if (!tokenAddress) {
    throw new Error("StarkGate token address is invalid.")
  }

  const l2RecipientRaw = params.l2Recipient.trim()
  if (!l2RecipientRaw.startsWith("0x") && !/^\d+$/.test(l2RecipientRaw)) {
    throw new Error("L2 recipient must be a Starknet address (felt hex).")
  }

  const amountWei = parseDecimalToScaledBigInt(params.amountEth, 18)
  if (amountWei <= BIGINT_ZERO) {
    throw new Error("Bridge amount must be positive.")
  }

  const evm = getInjectedEvmMetaMask()
  if (!evm) {
    throw new Error("MetaMask not detected. Install MetaMask for Ethereum bridge.")
  }
  const from = await requestEvmAccount(evm)
  await ensureEvmSepolia(evm)

  const recipientU256 = parseUint256(l2RecipientRaw)
  const feeWei =
    params.feeWei ??
    (await estimateStarkgateDepositFeeWei(bridgeAddress)) ??
    BigInt("50000000000000") // 0.00005 ETH fallback
  const valueWei = amountWei + feeWei

  const dataV2 = encodeStarkgateDepositV2(tokenAddress, amountWei, recipientU256)
  try {
    const txHash = await evm.request({
      method: "eth_sendTransaction",
      params: [
        {
          from,
          to: bridgeAddress,
          value: toHexFelt(valueWei),
          data: dataV2,
        },
      ],
    })
    const normalized = extractTxHash(txHash)
    if (normalized) return normalized
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "")
    const shouldFallback =
      /execution reverted|method not found|selector|function/i.test(message)
    if (!shouldFallback) throw error
  }

  const dataLegacy = encodeStarkgateDepositLegacy(amountWei, recipientU256)
  const txHash = await evm.request({
    method: "eth_sendTransaction",
    params: [
      {
        from,
        to: bridgeAddress,
        value: toHexFelt(valueWei),
        data: dataLegacy,
      },
    ],
  })
  const normalized = extractTxHash(txHash)
  if (!normalized) {
    throw new Error("Failed to get tx hash from StarkGate deposit transaction.")
  }
  return normalized
}

/**
 * Handles `estimateStarkgateDepositFeeWei` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export async function estimateStarkgateDepositFeeWei(
  bridgeAddress: string
): Promise<bigint | null> {
  const normalizedBridge = normalizeEvmAddress(bridgeAddress)
  if (!normalizedBridge) return null
  const data = "0xaf8bc15e" // estimateDepositFeeWei()

  const rpcUrl = process.env.NEXT_PUBLIC_EVM_SEPOLIA_RPC_URL || ""
  if (rpcUrl) {
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "eth_call",
          params: [{ to: normalizedBridge, data }, "latest"],
        }),
      })
      const payload = (await response.json()) as { result?: string }
      if (payload?.result && payload.result.startsWith("0x")) {
        return BigInt(payload.result)
      }
    } catch {
      // fallback to injected provider
    }
  }

  const evm = getInjectedEvmMetaMask()
  if (!evm) return null
  try {
    const result = await evm.request({
      method: "eth_call",
      params: [{ to: normalizedBridge, data }, "latest"],
    })
    if (typeof result === "string" && result.startsWith("0x")) {
      return BigInt(result)
    }
  } catch {
    return null
  }
  return null
}

/**
 * Handles `estimateEvmNetworkFeeWei` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export async function estimateEvmNetworkFeeWei(
  gasLimit: bigint = BigInt(210000)
): Promise<bigint | null> {
  if (gasLimit <= BIGINT_ZERO) return null

  const rpcUrl = process.env.NEXT_PUBLIC_EVM_SEPOLIA_RPC_URL || ""
  if (rpcUrl) {
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "eth_gasPrice",
          params: [],
        }),
      })
      const payload = (await response.json()) as { result?: string }
      if (payload?.result && payload.result.startsWith("0x")) {
        const gasPriceWei = BigInt(payload.result)
        return gasPriceWei * gasLimit
      }
    } catch {
      // fallback to injected provider
    }
  }

  const evm = getInjectedEvmMetaMask()
  if (!evm) return null
  try {
    const result = await evm.request({
      method: "eth_gasPrice",
      params: [],
    })
    if (typeof result === "string" && result.startsWith("0x")) {
      const gasPriceWei = BigInt(result)
      return gasPriceWei * gasLimit
    }
  } catch {
    return null
  }
  return null
}

/**
 * Handles `bigintWeiToUnitNumber` logic.
 *
 * @param value - Input used by `bigintWeiToUnitNumber` to compute state, payload, or request behavior.
 * @param decimals - Input used by `bigintWeiToUnitNumber` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function bigintWeiToUnitNumber(value: bigint, decimals: number): number {
  if (decimals <= 0) return Number(value)
  const divisor = powBigInt(10, decimals)
  const whole = Number(value / divisor)
  const fraction = Number(value % divisor) / Number(divisor)
  return whole + fraction
}

/**
 * Handles `unitNumberToScaledBigInt` logic.
 *
 * @param value - Input used by `unitNumberToScaledBigInt` to compute state, payload, or request behavior.
 * @param decimals - Input used by `unitNumberToScaledBigInt` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function unitNumberToScaledBigInt(value: number, decimals: number): bigint {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Invalid unit amount.")
  }
  const normalized = value.toLocaleString("en-US", {
    useGrouping: false,
    maximumFractionDigits: Math.max(0, decimals),
  })
  return parseDecimalToScaledBigInt(normalized, decimals)
}

/**
 * Handles `decimalToU256Parts` logic.
 *
 * @param value - Input used by `decimalToU256Parts` to compute state, payload, or request behavior.
 * @param decimals - Input used by `decimalToU256Parts` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function decimalToU256Parts(value: string, decimals: number): [string, string] {
  const scaled = parseDecimalToScaledBigInt(value, decimals)
  if (scaled < BIGINT_ZERO) {
    throw new Error("Amount must be positive.")
  }
  const low = scaled & MAX_U128
  const high = scaled >> BigInt(128)
  return [toHexFelt(low), toHexFelt(high)]
}

/**
 * Parses or transforms values for `parseEstimatedMinutes`.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function parseEstimatedMinutes(label?: string): number {
  if (!label) return 15
  const match = label.match(/\d+/)
  if (!match) return 15
  const parsed = Number.parseInt(match[0], 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 15
  return parsed
}

/**
 * Handles `toHexFelt` logic.
 *
 * @param value - Input used by `toHexFelt` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function toHexFelt(value: string | number | bigint): string {
  if (typeof value === "bigint") {
    return `0x${value.toString(16)}`
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error("Invalid felt number.")
    }
    return `0x${BigInt(Math.trunc(value)).toString(16)}`
  }

  const raw = value.trim()
  if (!raw) return "0x0"
  if (raw.startsWith("0x") || raw.startsWith("0X")) {
    return `0x${raw.slice(2).toLowerCase()}`
  }
  if (/^\d+$/.test(raw)) {
    return `0x${BigInt(raw).toString(16)}`
  }
  return stringToFelt(raw)
}

/**
 * Handles `providerIdToFeltHex` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
export function providerIdToFeltHex(provider?: string): string {
  const normalized = (provider || "").trim().toLowerCase()
  const known: Record<string, string> = {
    layerswap: "0x4c535750",
    atomiq: "0x41544d51",
    garden: "0x47415244",
    starkgate: "0x53544754",
  }
  const knownValue = known[normalized]
  if (knownValue) return knownValue
  return stringToFelt(provider || "unknown")
}

/**
 * Parses or transforms values for `parseDecimalToScaledBigInt`.
 *
 * @param value - Input used by `parseDecimalToScaledBigInt` to compute state, payload, or request behavior.
 * @param decimals - Input used by `parseDecimalToScaledBigInt` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function parseDecimalToScaledBigInt(value: string, decimals: number): bigint {
  const raw = value.trim()
  if (!raw) return BIGINT_ZERO
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`Invalid decimal value: ${value}`)
  }
  const [wholePart, fracPartRaw = ""] = raw.split(".")
  const fracPart = fracPartRaw.slice(0, decimals).padEnd(decimals, "0")
  const whole = BigInt(wholePart)
  const frac = fracPart ? BigInt(fracPart) : BIGINT_ZERO
  return whole * powBigInt(10, decimals) + frac
}

/**
 * Parses or transforms values for `parseUint256`.
 *
 * @param value - Input used by `parseUint256` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function parseUint256(value: string): bigint {
  const raw = value.trim()
  if (!raw) return BIGINT_ZERO
  if (raw.startsWith("0x") || raw.startsWith("0X")) {
    return BigInt(raw)
  }
  if (/^\d+$/.test(raw)) {
    return BigInt(raw)
  }
  throw new Error("Invalid uint256 value.")
}

/**
 * Parses or transforms values for `normalizeEvmAddress`.
 *
 * @param address - Input used by `normalizeEvmAddress` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function normalizeEvmAddress(address: string): string | null {
  const raw = address.trim()
  if (!raw) return null
  const normalized = raw.startsWith("0x") ? raw : `0x${raw}`
  if (!/^0x[0-9a-fA-F]{40}$/.test(normalized)) return null
  return normalized
}

/**
 * Parses or transforms values for `encodeStarkgateDepositV2`.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function encodeStarkgateDepositV2(
  tokenAddress: string,
  amountWei: bigint,
  l2Recipient: bigint
): string {
  const selector = "0x0efe6a8b" // deposit(address,uint256,uint256)
  const encoded = [
    encodeAbiAddress(tokenAddress),
    encodeAbiUint256(amountWei),
    encodeAbiUint256(l2Recipient),
  ].join("")
  return `${selector}${encoded}`
}

/**
 * Parses or transforms values for `encodeStarkgateDepositLegacy`.
 *
 * @param amountWei - Input used by `encodeStarkgateDepositLegacy` to compute state, payload, or request behavior.
 * @param l2Recipient - Input used by `encodeStarkgateDepositLegacy` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function encodeStarkgateDepositLegacy(amountWei: bigint, l2Recipient: bigint): string {
  const selector = "0xe2bbb158" // deposit(uint256,uint256)
  const encoded = [encodeAbiUint256(amountWei), encodeAbiUint256(l2Recipient)].join("")
  return `${selector}${encoded}`
}

/**
 * Parses or transforms values for `encodeAbiUint256`.
 *
 * @param value - Input used by `encodeAbiUint256` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function encodeAbiUint256(value: bigint): string {
  if (value < BIGINT_ZERO) {
    throw new Error("uint256 cannot be negative.")
  }
  let hex = value.toString(16)
  if (hex.length > 64) {
    throw new Error("uint256 overflow.")
  }
  hex = hex.padStart(64, "0")
  return hex
}

/**
 * Parses or transforms values for `encodeAbiAddress`.
 *
 * @param address - Input used by `encodeAbiAddress` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function encodeAbiAddress(address: string): string {
  const normalized = normalizeEvmAddress(address)
  if (!normalized) {
    throw new Error("Invalid EVM address for ABI encoding.")
  }
  return normalized.slice(2).toLowerCase().padStart(64, "0")
}

/**
 * Fetches data for `getInjectedEvmMetaMask`.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function getInjectedEvmMetaMask(): InjectedEvm | null {
  if (typeof window === "undefined") return null
  const anyWindow = window as any
  const ethereum = anyWindow.ethereum as InjectedEvm | undefined
  if (!ethereum) return null
  const providers = ethereum.providers?.length ? ethereum.providers : []
  if (providers.length) {
    const metaMask = providers.find((provider) => provider?.isMetaMask)
    if (metaMask) return metaMask
  }
  if (ethereum.isMetaMask) return ethereum
  return null
}

/**
 * Runs `requestEvmAccount` and handles related side effects.
 *
 * @param evm - Input used by `requestEvmAccount` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
async function requestEvmAccount(evm: InjectedEvm): Promise<string> {
  const accounts = await evm.request({ method: "eth_requestAccounts" })
  const first = Array.isArray(accounts) ? accounts[0] : null
  if (typeof first !== "string" || !first.trim()) {
    throw new Error("No EVM account returned. Unlock MetaMask and retry.")
  }
  return first
}

/**
 * Runs `ensureEvmSepolia` and handles related side effects.
 *
 * @param evm - Input used by `ensureEvmSepolia` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
async function ensureEvmSepolia(evm: InjectedEvm): Promise<void> {
  const chainId = await readEvmChainId(evm)
  if (chainId === EVM_SEPOLIA_CHAIN_ID) return

  try {
    await evm.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: EVM_SEPOLIA_CHAIN_ID_HEX }],
    })
  } catch (error) {
    const code = (error as { code?: number } | undefined)?.code
    if (code !== 4902) {
      throw error
    }
    await evm.request({
      method: "wallet_addEthereumChain",
      params: [EVM_SEPOLIA_CHAIN_PARAMS as unknown as Record<string, unknown>],
    })
  }

  const finalChainId = await readEvmChainId(evm)
  if (finalChainId !== EVM_SEPOLIA_CHAIN_ID) {
    throw new Error("Please switch MetaMask network to Ethereum Sepolia.")
  }
}

/**
 * Fetches data for `readEvmChainId`.
 *
 * @param evm - Input used by `readEvmChainId` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
async function readEvmChainId(evm: InjectedEvm): Promise<number> {
  const raw = await evm.request({ method: "eth_chainId" })
  if (typeof raw === "string") {
    if (raw.startsWith("0x") || raw.startsWith("0X")) {
      return Number.parseInt(raw, 16)
    }
    return Number.parseInt(raw, 10)
  }
  if (typeof raw === "number") return raw
  return NaN
}

/**
 * Fetches data for `getInjectedStarknet`.
 *
 * @param providerHint - Input used by `getInjectedStarknet` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function getInjectedStarknet(providerHint: StarknetWalletHint): InjectedStarknet | null {
  if (typeof window === "undefined") return null
  const anyWindow = window as any
  const defaultProvider = pickInjectedStarknet(anyWindow.starknet)
  const argent = pickInjectedStarknet(
    anyWindow.starknet_argentX,
    anyWindow.argentX?.starknet,
    anyWindow.argent?.starknet,
    anyWindow.argentX
  )
  const braavos = pickInjectedStarknet(
    anyWindow.starknet_braavos,
    anyWindow.braavos?.starknet,
    anyWindow.braavosWallet?.starknet
  )

  if (providerHint === "argentx") return argent || pickProviderByAlias(defaultProvider, "argentx")
  if (providerHint === "braavos") return braavos || pickProviderByAlias(defaultProvider, "braavos")
  return defaultProvider || argent || braavos
}

/**
 * Handles `pickProviderByAlias` logic.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function pickProviderByAlias(
  provider: InjectedStarknet | null,
  kind: "argentx" | "braavos"
): InjectedStarknet | null {
  if (!provider) return null
  const aliases = STARKNET_PROVIDER_ID_ALIASES[kind]
  const id = normalizeAlias(provider.id)
  const name = normalizeAlias(provider.name)
  const matches = aliases.some((alias) => {
    const needle = normalizeAlias(alias)
    return id.includes(needle) || name.includes(needle)
  })
  return matches ? provider : null
}

/**
 * Parses or transforms values for `normalizeAlias`.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function normalizeAlias(value?: string): string {
  return (value || "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

/**
 * Checks conditions for `isUsableInjected`.
 *
 * @param candidate - Input used by `isUsableInjected` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function isUsableInjected(candidate: unknown): candidate is InjectedStarknet {
  if (!candidate || typeof candidate !== "object") return false
  const injected = candidate as InjectedStarknet
  return (
    typeof injected.request === "function" ||
    typeof injected.enable === "function" ||
    typeof injected.account?.execute === "function"
  )
}

/**
 * Handles `pickInjectedStarknet` logic.
 *
 * @param candidates - Input used by `pickInjectedStarknet` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function pickInjectedStarknet(...candidates: unknown[]): InjectedStarknet | null {
  for (const candidate of candidates) {
    if (isUsableInjected(candidate)) return candidate
  }
  return null
}

/**
 * Runs `ensureStarknetAccounts` and handles related side effects.
 *
 * @param injected - Input used by `ensureStarknetAccounts` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
async function ensureStarknetAccounts(injected: InjectedStarknet): Promise<void> {
  if (injected.selectedAddress || injected.account?.address) return
  if (injected.request) {
    const attempts: Array<{ type: string; params?: unknown }> = [{ type: "wallet_requestAccounts" }]
    STARKNET_API_VERSIONS.forEach((version) => {
      attempts.push({ type: "wallet_requestAccounts", params: { api_version: version } })
      attempts.push({
        type: "wallet_requestAccounts",
        params: { api_version: version, silent_mode: false },
      })
    })
    attempts.push({ type: "wallet_requestAccounts", params: { silent_mode: false } })
    for (const payload of attempts) {
      try {
        await requestStarknet(injected, payload)
        if (injected.selectedAddress || injected.account?.address) return
      } catch {
        // continue
      }
    }
  }
  if (injected.enable) {
    try {
      await injected.enable({ showModal: true })
    } catch {
      // no-op
    }
  }
}

/**
 * Runs `ensureStarknetSepolia` and handles related side effects.
 *
 * @param injected - Input used by `ensureStarknetSepolia` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
async function ensureStarknetSepolia(injected: InjectedStarknet): Promise<string | undefined> {
  let chainId = await readStarknetChainId(injected)
  if (isStarknetSepolia(chainId)) return chainId
  if (!injected.request) return chainId
  for (const payload of STARKNET_SWITCH_CHAIN_PAYLOADS) {
    try {
      await requestStarknet(injected, payload)
      chainId = await readStarknetChainId(injected)
      if (isStarknetSepolia(chainId)) return chainId
    } catch {
      // continue
    }
  }
  return chainId
}

/**
 * Fetches data for `readStarknetChainId`.
 *
 * @param injected - Input used by `readStarknetChainId` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
async function readStarknetChainId(injected: InjectedStarknet): Promise<string | undefined> {
  if (typeof injected.chainId === "string" && injected.chainId.trim()) {
    return injected.chainId
  }
  const attempts: Array<{ type: string; params?: unknown }> = [
    { type: "wallet_getChainId" },
    { type: "wallet_requestChainId" },
    { type: "starknet_chainId" },
  ]
  STARKNET_API_VERSIONS.forEach((version) => {
    attempts.push({ type: "wallet_getChainId", params: { api_version: version } })
    attempts.push({ type: "wallet_requestChainId", params: { api_version: version } })
  })
  if (injected.request) {
    for (const payload of attempts) {
      try {
        const result = await requestStarknet(injected, payload)
        const parsed = parseChainId(result)
        if (parsed) {
          injected.chainId = parsed
          return parsed
        }
      } catch {
        // continue
      }
    }
  }

  const fromAccount = await readChainIdGetter(injected.account?.getChainId)
  if (fromAccount) return fromAccount
  const fromProvider = await readChainIdGetter(injected.provider?.getChainId)
  if (fromProvider) return fromProvider
  return undefined
}

/**
 * Fetches data for `readChainIdGetter`.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
async function readChainIdGetter(
  getter?: (() => Promise<unknown> | unknown) | undefined
): Promise<string | undefined> {
  if (!getter) return undefined
  try {
    const value = await getter()
    return parseChainId(value) || undefined
  } catch {
    return undefined
  }
}

/**
 * Parses or transforms values for `parseChainId`.
 *
 * @param value - Input used by `parseChainId` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function parseChainId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) {
    return `0x${Math.trunc(value).toString(16)}`
  }
  if (typeof value === "bigint") {
    return `0x${value.toString(16)}`
  }
  if (Array.isArray(value) && value.length > 0) {
    return parseChainId(value[0])
  }
  if (typeof value === "object" && value) {
    return (
      parseChainId((value as { chainId?: unknown }).chainId) ||
      parseChainId((value as { result?: unknown }).result) ||
      parseChainId((value as { data?: unknown }).data)
    )
  }
  return null
}

/**
 * Checks conditions for `isWalletUserRejectedError`.
 *
 * @param error - Input used by `isWalletUserRejectedError` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function isWalletUserRejectedError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code
  if (code === 4001 || code === "4001") return true
  const message = walletErrorMessage(error).toLowerCase()
  return (
    message.includes("user rejected") ||
    message.includes("rejected by user") ||
    message.includes("user denied") ||
    message.includes("request rejected") ||
    message.includes("cancelled") ||
    message.includes("canceled")
  )
}

/**
 * Handles `walletErrorMessage` logic.
 *
 * @param error - Input used by `walletErrorMessage` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function walletErrorMessage(error: unknown): string {
  if (!error) return "Unknown Starknet wallet error."
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message || "Unknown Starknet wallet error."
  if (typeof error === "object") {
    const anyError = error as {
      message?: unknown
      data?: { message?: unknown }
      error?: { message?: unknown }
    }
    const direct = anyError.message
    if (typeof direct === "string" && direct.trim()) return direct
    const nested = anyError.data?.message
    if (typeof nested === "string" && nested.trim()) return nested
    const nestedError = anyError.error?.message
    if (typeof nestedError === "string" && nestedError.trim()) return nestedError
  }
  return String(error)
}

/**
 * Runs `requestStarknet` and handles related side effects.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
async function requestStarknet(
  injected: InjectedStarknet,
  payload: { type: string; params?: unknown }
): Promise<unknown> {
  if (!injected.request) throw new Error("Starknet request() unavailable.")
  const variants: Array<{ type?: string; method?: string; params?: unknown }> = []
  const paramsCandidates =
    payload.params !== undefined && !Array.isArray(payload.params)
      ? [payload.params, [payload.params]]
      : [payload.params]

  for (const params of paramsCandidates) {
    variants.push({ type: payload.type, method: payload.type, params })
    variants.push({ type: payload.type, params })
  }
  for (const params of paramsCandidates) {
    variants.push({ method: payload.type, params })
  }

  let lastError: unknown = null
  let lastTypeError: unknown = null
  for (const variant of variants) {
    try {
      return await injected.request(variant)
    } catch (error) {
      lastError = error
      if (variant.type) {
        lastTypeError = error
      }
    }
  }
  throw lastTypeError || lastError || new Error("Starknet wallet request failed.")
}

/**
 * Parses or transforms values for `normalizeSignatureFelt`.
 *
 * @param value - Input used by `normalizeSignatureFelt` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function normalizeSignatureFelt(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) return null
    if (/^0x[0-9a-fA-F]+$/.test(trimmed) || /^\d+$/.test(trimmed)) {
      try {
        return toHexFelt(trimmed)
      } catch {
        return null
      }
    }
    return null
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null
    return toHexFelt(value)
  }
  if (typeof value === "bigint") {
    if (value < BIGINT_ZERO) return null
    return toHexFelt(value)
  }
  return null
}

/**
 * Parses or transforms values for `parseStarknetSignature`.
 *
 * @param value - Input used by `parseStarknetSignature` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function parseStarknetSignature(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    const parsed = value.map((item) => normalizeSignatureFelt(item)).filter((item): item is string => !!item)
    if (parsed.length > 0) return parsed
    return null
  }
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) return null
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const decoded = JSON.parse(trimmed)
        return parseStarknetSignature(decoded)
      } catch {
        // continue fallback parsing
      }
    }
    if (trimmed.includes(",")) {
      const parsed = trimmed
        .split(",")
        .map((item) => normalizeSignatureFelt(item))
        .filter((item): item is string => !!item)
      if (parsed.length > 0) return parsed
    }
    const single = normalizeSignatureFelt(trimmed)
    return single ? [single] : null
  }
  if (typeof value === "object" && value) {
    const anyValue = value as {
      r?: unknown
      s?: unknown
      signature?: unknown
      signatures?: unknown
      sig?: unknown
      result?: unknown
      data?: unknown
    }
    const r = normalizeSignatureFelt(anyValue.r)
    const s = normalizeSignatureFelt(anyValue.s)
    if (r && s) return [r, s]

    const numericKeys = Object.keys(anyValue).filter((key) => /^\d+$/.test(key))
    if (numericKeys.length > 0) {
      const orderedValues = numericKeys
        .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
        .map((key) => (anyValue as Record<string, unknown>)[key])
      const parsedNumeric = parseStarknetSignature(orderedValues)
      if (parsedNumeric && parsedNumeric.length > 0) return parsedNumeric
    }

    const nestedCandidates = [
      anyValue.signature,
      anyValue.signatures,
      anyValue.sig,
      anyValue.result,
      anyValue.data,
    ]
    for (const nested of nestedCandidates) {
      const parsed = parseStarknetSignature(nested)
      if (parsed && parsed.length > 0) return parsed
    }
  }
  return null
}

/**
 * Handles `extractTxHash` logic.
 *
 * @param value - Input used by `extractTxHash` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function extractTxHash(value: unknown): string | null {
  if (typeof value === "string") {
    return isHexHash(value) ? value.toLowerCase() : null
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const hash = extractTxHash(item)
      if (hash) return hash
    }
    return null
  }
  if (typeof value === "object" && value) {
    const candidates = [
      (value as any).transaction_hash,
      (value as any).transactionHash,
      (value as any).tx_hash,
      (value as any).hash,
      (value as any).result,
    ]
    for (const candidate of candidates) {
      const hash = extractTxHash(candidate)
      if (hash) return hash
    }
  }
  return null
}

/**
 * Checks conditions for `isHexHash`.
 *
 * @param value - Input used by `isHexHash` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function isHexHash(value: string): boolean {
  const v = value.trim()
  if (!v.startsWith("0x")) return false
  if (v.length > 66) return false
  return /^[0-9a-fA-F]+$/.test(v.slice(2))
}

/**
 * Handles `stringToFelt` logic.
 *
 * @param value - Input used by `stringToFelt` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function stringToFelt(value: string): string {
  if (!value) return "0x0"
  const bytes = new TextEncoder().encode(value)
  let hex = ""
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0")
  }
  return `0x${hex || "0"}`
}

/**
 * Handles `powBigInt` logic.
 *
 * @param base - Input used by `powBigInt` to compute state, payload, or request behavior.
 * @param exponent - Input used by `powBigInt` to compute state, payload, or request behavior.
 *
 * @returns Result consumed by caller flow, UI state updates, or async chaining.
 * @remarks May trigger network calls, Hide Mode processing, or local state mutations.
 */
function powBigInt(base: number, exponent: number): bigint {
  let result = BIGINT_ONE
  const baseBigInt = BigInt(base)
  for (let i = 0; i < exponent; i += 1) {
    result *= baseBigInt
  }
  return result
}
