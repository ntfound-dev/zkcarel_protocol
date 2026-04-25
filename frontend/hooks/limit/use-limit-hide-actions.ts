"use client"

import * as React from "react"
import type { PrivacyVerificationPayload } from "@/lib/api"
import type { useNotifications } from "@/hooks/notifications/use-notifications"
import type { WalletContextType } from "@/hooks/wallet/use-wallet"
import { autoSubmitPrivacyAction, preparePrivateExit } from "@/lib/api"
import { resolveNoirInputs } from "@/lib/privacy/noir-inputs"
import {
  decimalToU256Parts,
  invokeStarknetCallFromWallet,
  invokeStarknetCallsFromWallet,
  readStarknetShieldedPoolFixedAmountFromWallet,
  toHexFelt,
} from "@/lib/onchain-trade"
import {
  HIDE_BALANCE_MIN_NOTE_AGE_MS,
  PRIVATE_ACTION_EXECUTOR_ADDRESS,
  clearTradePrivacyPayload,
  formatRemainingDuration,
  inferUsdtTierFromDenomId,
  loadPendingHideNotes,
  loadTradePrivacyPayload,
  normalizeHexArray,
  persistTradePrivacyPayload,
  removePendingHideNote,
  upsertPendingHideNote,
  type PendingHideNoteRecord,
} from "@/lib/limit-utils"
import { HIDE_BALANCE_NOTE_VERSION, isStarknetEntrypointMissingError } from "@/lib/trade/trading-utils"

type TokenLike = { symbol: string; price: number }

type UseLimitHideActionsParams<TToken extends TokenLike> = {
  amount: string
  price: string
  expiry: string
  orderType: "buy" | "sell"
  payTokenSymbol: string
  selectedTokenSymbol: string
  receiveTokenSymbol: string
  tokens: TToken[]
  hideUsdtTierMin: number
  notifications: ReturnType<typeof useNotifications>
  wallet: WalletContextType
  starknetProviderHint: "starknet" | "argentx" | "braavos"
  resolveUsdPrice: (symbol: string) => number
  resolveAvailableBalance: (symbol: string) => number
  setOrderType: React.Dispatch<React.SetStateAction<"buy" | "sell">>
  setPayToken: React.Dispatch<React.SetStateAction<TToken>>
  setSelectedToken: React.Dispatch<React.SetStateAction<TToken>>
  setReceiveToken: React.Dispatch<React.SetStateAction<TToken>>
  setAmount: React.Dispatch<React.SetStateAction<string>>
  setHideUsdtTierMin: React.Dispatch<React.SetStateAction<number>>
  setBalanceHidden: React.Dispatch<React.SetStateAction<boolean>>
  setHasTradePrivacyPayload: React.Dispatch<React.SetStateAction<boolean>>
  setPendingHideNotes: React.Dispatch<React.SetStateAction<PendingHideNoteRecord[]>>
  setIsAutoPrivacyProvisioning: React.Dispatch<React.SetStateAction<boolean>>
  setPendingNoteActionCommitment: React.Dispatch<React.SetStateAction<string | null>>
  setManuallySelectedHideNote: (noteCommitment?: string, nullifier?: string) => void
  clearManuallySelectedHideNote: () => void
  isManuallySelectedHideNote: (noteCommitment?: string, nullifier?: string) => boolean
  autoPrivacyPayloadPromiseRef: React.MutableRefObject<
    Promise<PrivacyVerificationPayload | undefined> | null
  >
  tokenAddressMap: Record<string, string>
  tokenDecimals: Record<string, number>
  devAutoPayloadEnabled: boolean
}

const randomHexFelt = () => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return `0x${hex.replace(/^0+/, "") || "1"}`
}

const createDevTradePrivacyPayload = (): PrivacyVerificationPayload => ({
  verifier: "garaga",
  nullifier: randomHexFelt(),
  commitment: randomHexFelt(),
  proof: ["0x1"],
  public_inputs: ["0x1"],
})

const toU256HexPartsFromBigInt = (value: bigint): [string, string] => {
  const safe = value < BigInt(0) ? BigInt(0) : value
  const low = safe & ((BigInt(1) << BigInt(128)) - BigInt(1))
  const high = safe >> BigInt(128)
  return [toHexFelt(low), toHexFelt(high)]
}

const scaledBigIntToDecimalString = (value: bigint, decimals: number): string => {
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

export const useLimitHideActions = <TToken extends TokenLike>({
  amount,
  price,
  expiry,
  orderType,
  payTokenSymbol,
  selectedTokenSymbol,
  receiveTokenSymbol,
  tokens,
  hideUsdtTierMin,
  notifications,
  wallet,
  starknetProviderHint,
  resolveUsdPrice,
  resolveAvailableBalance,
  setOrderType,
  setPayToken,
  setSelectedToken,
  setReceiveToken,
  setAmount,
  setHideUsdtTierMin,
  setBalanceHidden,
  setHasTradePrivacyPayload,
  setPendingHideNotes,
  setIsAutoPrivacyProvisioning,
  setPendingNoteActionCommitment,
  setManuallySelectedHideNote,
  clearManuallySelectedHideNote,
  isManuallySelectedHideNote,
  autoPrivacyPayloadPromiseRef,
  tokenAddressMap,
  tokenDecimals,
  devAutoPayloadEnabled,
}: UseLimitHideActionsParams<TToken>) => {
  const resolveHideBalancePrivacyPayload = React.useCallback(
    async (): Promise<PrivacyVerificationPayload | undefined> => {
      if (autoPrivacyPayloadPromiseRef.current) return autoPrivacyPayloadPromiseRef.current

      const task = (async () => {
        if (devAutoPayloadEnabled) {
          const generated = createDevTradePrivacyPayload()
          persistTradePrivacyPayload(generated)
          setHasTradePrivacyPayload(true)
          return generated
        }

        if (!wallet.isConnected) return undefined

        setIsAutoPrivacyProvisioning(true)
        try {
          const cachedPayload = loadTradePrivacyPayload()
          const noirInputs = await resolveNoirInputs({
            existing: cachedPayload?.noir_inputs,
            context: {
              flow: "limit_order",
              from_token: orderType === "buy" ? payTokenSymbol : selectedTokenSymbol,
              to_token: orderType === "buy" ? selectedTokenSymbol : receiveTokenSymbol,
              amount,
              from_network: "starknet",
              to_network: "starknet",
              note_version: HIDE_BALANCE_NOTE_VERSION || "v4",
              denom_id: String(hideUsdtTierMin),
              note_commitment: cachedPayload?.note_commitment || cachedPayload?.commitment,
              note_deposit_tx_hash: cachedPayload?.note_deposit_tx_hash,
              nullifier: cachedPayload?.nullifier,
              root: cachedPayload?.root,
              spendable_at_unix: cachedPayload?.spendable_at_unix,
            },
          })
          if (!noirInputs) {
            throw new Error(
              "Noir inputs belum tersedia. Aktifkan sumber noir_inputs (window.noirInputsProvider atau NEXT_PUBLIC_NOIR_INPUTS_URL)."
            )
          }
          const response = await autoSubmitPrivacyAction({
            verifier: "garaga",
            submit_onchain: false,
            tx_context: {
              flow: "limit_order",
              from_token: orderType === "buy" ? payTokenSymbol : selectedTokenSymbol,
              to_token: orderType === "buy" ? selectedTokenSymbol : receiveTokenSymbol,
              amount,
              from_network: "starknet",
              to_network: "starknet",
              note_version: HIDE_BALANCE_NOTE_VERSION || "v4",
              noir_inputs: noirInputs,
              denom_id: String(hideUsdtTierMin),
              note_commitment: cachedPayload?.note_commitment || cachedPayload?.commitment,
              note_deposit_tx_hash: cachedPayload?.note_deposit_tx_hash,
              nullifier: cachedPayload?.nullifier,
              root: cachedPayload?.root,
              spendable_at_unix: cachedPayload?.spendable_at_unix,
            },
          })
          const responseProof = normalizeHexArray(response.payload?.proof)
          const responsePublicInputs = normalizeHexArray(response.payload?.public_inputs)
          const responseNoirInputs =
            (response.payload as PrivacyVerificationPayload | undefined)?.noir_inputs || noirInputs
          const payload: PrivacyVerificationPayload = {
            verifier: (response.payload?.verifier || "garaga").trim() || "garaga",
            note_version:
              response.payload?.note_version?.trim() || HIDE_BALANCE_NOTE_VERSION || "v4",
            executor_address: response.payload?.executor_address?.trim() || undefined,
            root: response.payload?.root?.trim() || undefined,
            nullifier: response.payload?.nullifier?.trim(),
            commitment: response.payload?.commitment?.trim(),
            recipient: response.payload?.recipient?.trim() || undefined,
            note_commitment:
              response.payload?.note_commitment?.trim() ||
              response.payload?.commitment?.trim() ||
              undefined,
            note_deposit_tx_hash: cachedPayload?.note_deposit_tx_hash,
            noir_inputs: responseNoirInputs,
            denom_id: response.payload?.denom_id?.trim() || String(hideUsdtTierMin),
            spendable_at_unix:
              typeof response.payload?.spendable_at_unix === "number" &&
              Number.isFinite(response.payload.spendable_at_unix)
                ? Math.floor(response.payload.spendable_at_unix)
                : undefined,
            proof: responseProof,
            public_inputs: responsePublicInputs,
          }
          const proof = normalizeHexArray(payload.proof)
          const publicInputs = normalizeHexArray(payload.public_inputs)
          if (!payload.nullifier || !payload.commitment || proof.length === 0 || publicInputs.length === 0) {
            throw new Error("Auto Garaga payload is incomplete from backend.")
          }
          if (
            proof.length === 1 &&
            publicInputs.length === 1 &&
            proof[0]?.toLowerCase() === "0x1" &&
            publicInputs[0]?.toLowerCase() === "0x1"
          ) {
            throw new Error("Auto Garaga payload from backend is still dummy (0x1).")
          }
          const normalizedPayload: PrivacyVerificationPayload = {
            verifier: payload.verifier,
            note_version: payload.note_version,
            executor_address: payload.executor_address,
            root: payload.root,
            nullifier: payload.nullifier,
            commitment: payload.commitment,
            recipient: payload.recipient,
            note_commitment: payload.note_commitment,
            note_deposit_tx_hash: payload.note_deposit_tx_hash,
            noir_inputs: responseNoirInputs,
            denom_id: payload.denom_id,
            spendable_at_unix: payload.spendable_at_unix,
            proof,
            public_inputs: publicInputs,
          }
          persistTradePrivacyPayload(normalizedPayload)
          setHasTradePrivacyPayload(true)
          return normalizedPayload
        } catch (error) {
          notifications.addNotification({
            type: "error",
            title: "Auto Garaga payload failed",
            message: error instanceof Error ? error.message : "Unable to prepare Garaga payload automatically.",
          })
          return undefined
        } finally {
          setIsAutoPrivacyProvisioning(false)
        }
      })()

      autoPrivacyPayloadPromiseRef.current = task
      try {
        return await task
      } finally {
        autoPrivacyPayloadPromiseRef.current = null
      }
    },
    [
      amount,
      devAutoPayloadEnabled,
      hideUsdtTierMin,
      notifications,
      orderType,
      payTokenSymbol,
      receiveTokenSymbol,
      selectedTokenSymbol,
      setHasTradePrivacyPayload,
      setIsAutoPrivacyProvisioning,
      wallet.isConnected,
    ]
  )

  const ensureHideNoteDeposited = React.useCallback(
    async ({
      payload,
      tokenSymbol,
      amountText,
      fallbackTierUsdt,
    }: {
      payload: PrivacyVerificationPayload
      tokenSymbol: string
      amountText: string
      fallbackTierUsdt: number
    }): Promise<number> => {
      const defaultExecutor = (PRIVATE_ACTION_EXECUTOR_ADDRESS || "").trim()
      const payloadExecutor = (payload.executor_address || "").trim()
      const executorAddress =
        HIDE_BALANCE_NOTE_VERSION === "v4" && defaultExecutor
          ? defaultExecutor
          : (payloadExecutor || defaultExecutor || "").trim()
      if (!executorAddress) {
        throw new Error(
          "NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS is not configured for hide note deposit."
        )
      }

      const symbol = tokenSymbol.toUpperCase()
      const tokenAddress = (tokenAddressMap[symbol] || "").trim()
      if (!tokenAddress) {
        throw new Error(`Token address for ${symbol} is not configured.`)
      }

      const noteCommitment = (payload.note_commitment || payload.commitment || "").trim()
      if (!noteCommitment) {
        throw new Error("Hide note commitment missing in privacy payload.")
      }
      const nullifier = (payload.nullifier || "").trim()
      if (!nullifier) {
        throw new Error("Hide nullifier missing in privacy payload.")
      }

      const denomId = (payload.denom_id || String(fallbackTierUsdt)).trim()
      if (!denomId) {
        throw new Error("Hide denom_id missing in privacy payload.")
      }

      const decimals = tokenDecimals[symbol] ?? 18
      let fixedAmountText = (amountText || "").trim()
      try {
        const fixedAmountRaw = await readStarknetShieldedPoolFixedAmountFromWallet(
          executorAddress,
          tokenAddress,
          denomId,
          starknetProviderHint
        )
        if (fixedAmountRaw !== null && fixedAmountRaw > BigInt(0)) {
          fixedAmountText = scaledBigIntToDecimalString(fixedAmountRaw, decimals)
        }
      } catch {
        // fallback to local estimate
      }
      const parsedAmount = Number.parseFloat(fixedAmountText || "0")
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        const tokenPriceUsd = resolveUsdPrice(symbol)
        if (!Number.isFinite(tokenPriceUsd) || tokenPriceUsd <= 0) {
          throw new Error(`Cannot derive fixed amount for ${symbol}: token price is unavailable.`)
        }
        const precision = Math.min(decimals >= 10 ? 8 : 6, 8)
        fixedAmountText = (fallbackTierUsdt / tokenPriceUsd).toFixed(precision).replace(/\.?0+$/, "")
      }
      const fixedAmountValue = Number.parseFloat(fixedAmountText || "0")
      const availableBalance = resolveAvailableBalance(symbol)
      if (
        Number.isFinite(fixedAmountValue) &&
        fixedAmountValue > 0 &&
        Number.isFinite(availableBalance) &&
        availableBalance + 1e-12 < fixedAmountValue
      ) {
        throw new Error(
          `Insufficient ${symbol} balance for selected hide tier. Required ${fixedAmountValue.toLocaleString(undefined, {
            maximumFractionDigits: 8,
          })} ${symbol}, available ${availableBalance.toLocaleString(undefined, {
            maximumFractionDigits: 8,
          })} ${symbol}.`
        )
      }
      const [requiredLow, requiredHigh] = decimalToU256Parts(fixedAmountText, decimals)
      const requiredAmountUnits =
        BigInt(requiredLow) + (BigInt(requiredHigh) << BigInt(128))
      const approvalAmountUnits =
        (requiredAmountUnits * BigInt(10_100) + BigInt(9_999)) / BigInt(10_000)
      const [approvalLow, approvalHigh] = toU256HexPartsFromBigInt(approvalAmountUnits)

      const approvalCall = {
        contractAddress: tokenAddress,
        entrypoint: "approve",
        calldata: [executorAddress, approvalLow, approvalHigh],
      }
      const depositEntrypoint = "deposit_fixed_v4"
      const depositCalldata = [tokenAddress, toHexFelt(denomId), toHexFelt(noteCommitment), "0x0"]
      const depositCall = {
        contractAddress: executorAddress,
        entrypoint: depositEntrypoint,
        calldata: depositCalldata,
      }

      notifications.addNotification({
        type: "info",
        title: "Wallet signature required",
        message: `Confirm approve (+1% buffer) + hide note deposit (${fixedAmountText} ${symbol}) in one transaction.`,
      })

      let txHash = ""
      try {
        txHash = await invokeStarknetCallsFromWallet(
          [approvalCall, depositCall],
          starknetProviderHint
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || "")
        if (/multicall/i.test(message) || isStarknetEntrypointMissingError(error)) {
          notifications.addNotification({
            type: "warning",
            title: "Multicall gagal",
            message:
              "Wallet multicall gagal. Coba ulang dengan dua tanda tangan: approve dulu, lalu deposit.",
          })
          try {
            await invokeStarknetCallFromWallet(approvalCall, starknetProviderHint)
            txHash = await invokeStarknetCallFromWallet(depositCall, starknetProviderHint)
          } catch (sequentialError) {
            if (isStarknetEntrypointMissingError(sequentialError)) {
              throw new Error(
                `Entrypoint deposit tidak ditemukan di executor ${executorAddress}. Pastikan PRIVATE_ACTION_EXECUTOR_ADDRESS menunjuk ShieldedPool v4.`
              )
            }
            throw sequentialError
          }
        } else {
          throw error
        }
      }

      const spendableAtUnix =
        Math.floor(Date.now() / 1000) + Math.floor(HIDE_BALANCE_MIN_NOTE_AGE_MS / 1000)
      persistTradePrivacyPayload({
        ...payload,
        note_version: HIDE_BALANCE_NOTE_VERSION || "v4",
        executor_address: executorAddress,
        note_commitment: noteCommitment,
        note_deposit_tx_hash: txHash,
        commitment: payload.commitment || noteCommitment,
        nullifier,
        denom_id: denomId,
        spendable_at_unix: spendableAtUnix,
      })
      setHasTradePrivacyPayload(true)
      upsertPendingHideNote({
        note_version: HIDE_BALANCE_NOTE_VERSION || "v4",
        note_commitment: noteCommitment,
        note_deposit_tx_hash: txHash,
        nullifier,
        executor_address: executorAddress,
        verifier: (payload.verifier || "garaga").trim() || "garaga",
        root: (payload.root || "").trim() || undefined,
        proof: normalizeHexArray(payload.proof),
        public_inputs: normalizeHexArray(payload.public_inputs),
        noir_inputs: payload.noir_inputs,
        denom_id: denomId,
        token_symbol: symbol,
        target_token_symbol: (orderType === "buy" ? selectedTokenSymbol : receiveTokenSymbol).toUpperCase(),
        amount: fixedAmountText,
        deposited_at_unix: Math.floor(Date.now() / 1000),
        spendable_at_unix: spendableAtUnix,
      })
      setPendingHideNotes(loadPendingHideNotes())

      notifications.addNotification({
        type: "success",
        title: "Hide note deposited",
        message: `Note deposit submitted (${txHash.slice(0, 10)}...). Private order unlocks in ${formatRemainingDuration(HIDE_BALANCE_MIN_NOTE_AGE_MS)}.`,
        txHash,
        txNetwork: "starknet",
      })

      return spendableAtUnix
    },
    [
      notifications,
      orderType,
      receiveTokenSymbol,
      resolveAvailableBalance,
      resolveUsdPrice,
      selectedTokenSymbol,
      starknetProviderHint,
      tokenAddressMap,
      tokenDecimals,
    ]
  )

  const handleUsePendingHideNote = React.useCallback(
    async (
      note: PendingHideNoteRecord,
      confirmOrder: (options?: {
        manualExecuteFromPendingNote?: boolean
        overridePayload?: PrivacyVerificationPayload
        overrideOrderType?: "buy" | "sell"
        overrideFromToken?: string
        overrideToToken?: string
        overrideAmount?: string
        overridePrice?: string
        overrideExpiry?: string
      }) => Promise<void>
    ) => {
      const spendableAt = Number(note.spendable_at_unix || 0)
      const remainingMs = spendableAt > 0 ? Math.max(0, spendableAt * 1000 - Date.now()) : 0
      if (remainingMs > 0) {
        notifications.addNotification({
          type: "warning",
          title: "Mixing window active",
          message: `Hide note is still mixing. Ready in ${formatRemainingDuration(remainingMs)}.`,
        })
        return
      }

      const fromSymbol = (note.token_symbol || "").trim().toUpperCase()
      const toSymbol = (note.target_token_symbol || "").trim().toUpperCase()
      if (!fromSymbol || !toSymbol) {
        notifications.addNotification({
          type: "error",
          title: "Hide note invalid",
          message: "Selected note is missing token route metadata.",
        })
        return
      }
      const fromTokenItem = tokens.find((item) => item.symbol.toUpperCase() === fromSymbol)
      const toTokenItem = tokens.find((item) => item.symbol.toUpperCase() === toSymbol)
      if (!fromTokenItem || !toTokenItem) {
        notifications.addNotification({
          type: "error",
          title: "Unsupported token route",
          message: `Cannot execute pending note route ${fromSymbol} -> ${toSymbol}.`,
        })
        return
      }

      const routeOrderType: "buy" | "sell" = fromSymbol === "USDT" || fromSymbol === "USDC" ? "buy" : "sell"
      const payload: PrivacyVerificationPayload = {
        verifier: (note.verifier || "garaga").trim() || "garaga",
        note_version: HIDE_BALANCE_NOTE_VERSION || "v4",
        executor_address: note.executor_address?.trim() || PRIVATE_ACTION_EXECUTOR_ADDRESS || undefined,
        root: note.root?.trim() || undefined,
        nullifier: (note.nullifier || "").trim(),
        commitment: note.note_commitment,
        note_commitment: note.note_commitment,
        noir_inputs: note.noir_inputs,
        denom_id: note.denom_id?.trim() || undefined,
        spendable_at_unix: note.spendable_at_unix,
        proof: normalizeHexArray(note.proof),
        public_inputs: normalizeHexArray(note.public_inputs),
      }
      const noteAmountText = (note.amount || "").trim() || amount
      if (!noteAmountText || Number.parseFloat(noteAmountText) <= 0) {
        notifications.addNotification({
          type: "error",
          title: "Invalid note amount",
          message: "Selected note amount is invalid. Deposit a new note and retry.",
        })
        return
      }

      const pricedTokenSymbol = routeOrderType === "buy" ? toSymbol : fromSymbol
      const pricedToken = tokens.find((item) => item.symbol.toUpperCase() === pricedTokenSymbol)
      const fallbackPrice =
        Number.isFinite(pricedToken?.price || 0) ? Number(pricedToken?.price || 0) : 0
      const executionPriceText =
        Number.parseFloat(price) > 0 ? price : fallbackPrice > 0 ? String(fallbackPrice) : ""
      if (Number.parseFloat(executionPriceText) <= 0) {
        notifications.addNotification({
          type: "error",
          title: "Price is required",
          message: "Set target price first before running Private Order now.",
        })
        return
      }

      persistTradePrivacyPayload(payload)
      setHasTradePrivacyPayload(true)
      setBalanceHidden(true)
      setManuallySelectedHideNote(note.note_commitment, note.nullifier)
      setOrderType(routeOrderType)
      if (routeOrderType === "buy") {
        setPayToken(fromTokenItem)
        setSelectedToken(toTokenItem)
      } else {
        setSelectedToken(fromTokenItem)
        setReceiveToken(toTokenItem)
      }
      setAmount(noteAmountText)
      if (note.denom_id?.trim()) {
        setHideUsdtTierMin(inferUsdtTierFromDenomId(note.denom_id.trim()))
      }

      notifications.addNotification({
        type: "info",
        title: "Submitting private order",
        message: `Running Private Order now for ${noteAmountText} ${fromSymbol} -> ${toSymbol}.`,
      })

      setPendingNoteActionCommitment(note.note_commitment)
      try {
        await confirmOrder({
          manualExecuteFromPendingNote: true,
          overridePayload: payload,
          overrideOrderType: routeOrderType,
          overrideFromToken: fromSymbol,
          overrideToToken: toSymbol,
          overrideAmount: noteAmountText,
          overridePrice: executionPriceText,
          overrideExpiry: expiry,
        })
      } finally {
        setPendingNoteActionCommitment(null)
      }
    },
    [
      amount,
      expiry,
      notifications,
      price,
      setAmount,
      setBalanceHidden,
      setHasTradePrivacyPayload,
      setHideUsdtTierMin,
      setManuallySelectedHideNote,
      setOrderType,
      setPayToken,
      setPendingNoteActionCommitment,
      setReceiveToken,
      setSelectedToken,
      tokens,
    ]
  )

  const handleWithdrawPendingHideNote = React.useCallback(
    async (note: PendingHideNoteRecord) => {
      const noteCommitment = (note.note_commitment || "").trim()
      if (!noteCommitment) return
      const noteNullifier = (note.nullifier || "").trim()
      if (!noteNullifier) {
        notifications.addNotification({
          type: "error",
          title: "Withdraw failed",
          message: "Nullifier tidak tersedia untuk note ini.",
        })
        return
      }
      const root = (note.root || "").trim()
      if (!root) {
        notifications.addNotification({
          type: "error",
          title: "Withdraw failed",
          message: "Root tidak tersedia untuk note ini.",
        })
        return
      }
      const defaultExecutor = (PRIVATE_ACTION_EXECUTOR_ADDRESS || "").trim()
      const payloadExecutor = (note.executor_address || "").trim()
      const executorAddress =
        HIDE_BALANCE_NOTE_VERSION === "v4" && defaultExecutor
          ? defaultExecutor
          : (payloadExecutor || defaultExecutor || "").trim()
      if (!executorAddress) {
        notifications.addNotification({
          type: "error",
          title: "Withdraw failed",
          message: "Executor address is missing for this note.",
        })
        return
      }
      const tokenSymbol = (note.token_symbol || "").trim().toUpperCase()
      const tokenAddress = (tokenAddressMap[tokenSymbol] || "").trim()
      if (!tokenAddress) {
        notifications.addNotification({
          type: "error",
          title: "Withdraw failed",
          message: `Token address untuk ${tokenSymbol || "note"} tidak tersedia.`,
        })
        return
      }
      const amountText = (note.amount || "").trim()
      if (!amountText) {
        notifications.addNotification({
          type: "error",
          title: "Withdraw failed",
          message: "Jumlah note tidak tersedia untuk private exit.",
        })
        return
      }
      const decimals = tokenDecimals[tokenSymbol] ?? 18
      const [amountLow, amountHigh] = decimalToU256Parts(amountText, decimals)
      const recipientAddress = (wallet.starknetAddress || wallet.address || "").trim()
      if (!recipientAddress) {
        notifications.addNotification({
          type: "error",
          title: "Withdraw failed",
          message: "Alamat Starknet wallet belum tersedia.",
        })
        return
      }
      try {
        const preparedExit = await preparePrivateExit({
          verifier: (note.verifier || "garaga").trim() || "garaga",
          executor_address: executorAddress,
          root,
          nullifier: noteNullifier,
          note_commitment: noteCommitment,
          denom_id: (note.denom_id || "").trim() || undefined,
          token: tokenAddress,
          amount_low: amountLow,
          amount_high: amountHigh,
          recipient: recipientAddress,
          tx_context: {
            flow: "exit",
            note_version: HIDE_BALANCE_NOTE_VERSION || "v4",
            root,
            nullifier: noteNullifier,
            recipient: recipientAddress,
            note_commitment: noteCommitment,
            denom_id: (note.denom_id || "").trim() || undefined,
            from_token: tokenSymbol,
            amount: amountText,
          },
        })
        const exitCalls = preparedExit.onchain_calls
          .filter((call) => {
            return (
              typeof call.contract_address === "string" &&
              call.contract_address.trim().length > 0 &&
              typeof call.entrypoint === "string" &&
              call.entrypoint.trim().length > 0
            )
          })
          .map((call) => ({
            contractAddress: call.contract_address.trim(),
            entrypoint: call.entrypoint.trim(),
            calldata: Array.isArray(call.calldata) ? call.calldata.map((item) => String(item)) : [],
          }))
        if (exitCalls.length === 0) {
          throw new Error("prepare-private-exit returned empty onchain_calls")
        }
        notifications.addNotification({
          type: "info",
          title: "Wallet signature required",
          message: `Confirm private exit for ${amountText} ${tokenSymbol} in your Starknet wallet.`,
        })
        const txHash = await invokeStarknetCallsFromWallet(exitCalls, starknetProviderHint)
        removePendingHideNote(noteCommitment, noteNullifier)
        if (isManuallySelectedHideNote(noteCommitment, noteNullifier)) {
          clearManuallySelectedHideNote()
        }
        clearTradePrivacyPayload()
        setHasTradePrivacyPayload(false)
        setBalanceHidden(false)
        notifications.addNotification({
          type: "success",
          title: "Withdraw submitted",
          message: `Private exit submitted (${txHash.slice(0, 10)}...).`,
          txHash,
          txNetwork: "starknet",
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || "")
        notifications.addNotification({
          type: "error",
          title: "Withdraw failed",
          message,
        })
      }
    },
    [
      clearManuallySelectedHideNote,
      isManuallySelectedHideNote,
      notifications,
      setBalanceHidden,
      setHasTradePrivacyPayload,
      starknetProviderHint,
      tokenAddressMap,
      tokenDecimals,
      wallet.address,
      wallet.starknetAddress,
    ]
  )

  return {
    resolveHideBalancePrivacyPayload,
    ensureHideNoteDeposited,
    handleUsePendingHideNote,
    handleWithdrawPendingHideNote,
  }
}
