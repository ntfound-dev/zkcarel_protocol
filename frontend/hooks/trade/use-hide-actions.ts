"use client"

import * as React from "react"
import type { PrivacyVerificationPayload } from "@/lib/api"
import type { PendingHideNoteRecord, TokenWithBalance } from "@/lib/trading-types"
import type { useNotifications } from "@/hooks/notifications/use-notifications"
import type { WalletContextType } from "@/hooks/wallet/use-wallet"
import { preparePrivateExit } from "@/lib/api"
import {
  decimalToU256Parts,
  invokeStarknetCallFromWallet,
  invokeStarknetCallsFromWallet,
  readStarknetShieldedPoolFixedAmountFromWallet,
  toHexFelt,
} from "@/lib/onchain-trade"
import {
  HIDE_BALANCE_MIN_NOTE_AGE_MS,
  HIDE_BALANCE_NOTE_VERSION,
  PRIVATE_ACTION_EXECUTOR_ADDRESS,
  formatRemainingDuration,
  inferHideRootFromPublicInputs,
  isStarknetEntrypointMissingError,
  loadPendingHideNotes,
  loadTradePrivacyPayload,
  normalizeHexArray,
  persistTradePrivacyPayload,
  removePendingHideNote,
  resolveTokenAddress,
  resolveTokenDecimals,
  sanitizeDecimalInput,
  scaledBigIntToDecimalString,
  upsertPendingHideNote,
} from "@/lib/trading-utils"

type AllowanceReader = (args: {
  tokenAddress: string
  ownerAddress: string
  spender: string
  providerHint: "starknet" | "argentx" | "braavos"
  forceRefresh?: boolean
}) => Promise<bigint | null>

type AllowanceWaiter = (args: {
  tokenAddress: string
  ownerAddress: string
  spender: string
  requiredAllowance: bigint
  providerHint: "starknet" | "argentx" | "braavos"
  timeoutMs?: number
}) => Promise<boolean>

type UseHideActionsParams = {
  fromToken: TokenWithBalance
  toToken: TokenWithBalance
  fromAmount: string
  inferredHideDenomId: string
  hideBalanceOnchain: boolean
  starknetProviderHint: "starknet" | "argentx" | "braavos"
  notifications: ReturnType<typeof useNotifications>
  wallet: WalletContextType
  resolveTokenPrice: (symbol: string) => number
  setFromAmount: React.Dispatch<React.SetStateAction<string>>
  setHasTradePrivacyPayload: React.Dispatch<React.SetStateAction<boolean>>
  setPendingHideNotes: React.Dispatch<React.SetStateAction<PendingHideNoteRecord[]>>
  setBalanceHidden: React.Dispatch<React.SetStateAction<boolean>>
  setIsCancellingHideNote: React.Dispatch<React.SetStateAction<boolean>>
  clearTradePrivacyPayload: () => void
  clearManuallySelectedHideNote: () => void
  isManuallySelectedHideNote: (commitment?: string, nullifier?: string) => boolean
  readAllowanceCached: AllowanceReader
  waitForAllowance: AllowanceWaiter
}

export function useHideActions({
  fromToken,
  toToken,
  fromAmount,
  inferredHideDenomId,
  hideBalanceOnchain,
  starknetProviderHint,
  notifications,
  wallet,
  resolveTokenPrice,
  setFromAmount,
  setHasTradePrivacyPayload,
  setPendingHideNotes,
  setBalanceHidden,
  setIsCancellingHideNote,
  clearTradePrivacyPayload,
  clearManuallySelectedHideNote,
  isManuallySelectedHideNote,
  readAllowanceCached,
  waitForAllowance,
}: UseHideActionsParams) {
  const resolveHideFixedAmountText = React.useCallback(
    async ({
      executorAddress,
      tokenSymbol,
      denomId,
      fallbackAmount,
      fallbackKind = "usd",
    }: {
      executorAddress?: string
      tokenSymbol?: string
      denomId?: string
      fallbackAmount?: string
      fallbackKind?: "usd" | "token"
    }): Promise<string> => {
      const resolvedTokenSymbol = (tokenSymbol || fromToken.symbol).trim().toUpperCase()
      const resolvedDenomId = (denomId || "").trim()
      const decimals = resolveTokenDecimals(resolvedTokenSymbol || fromToken.symbol)
      const fallbackTokenAmount =
        fallbackKind === "token" ? sanitizeDecimalInput(fallbackAmount || "", decimals) : ""
      const fallbackUsdValue =
        fallbackKind === "usd"
          ? Number.parseFloat(fallbackAmount || resolvedDenomId || "0")
          : Number.NaN
      const fallbackFromUsd =
        Number.isFinite(fallbackUsdValue) && fallbackUsdValue > 0
          ? (() => {
              const stable = resolvedTokenSymbol === "USDT" || resolvedTokenSymbol === "USDC"
              const tokenUsdPrice = stable ? 1 : resolveTokenPrice(resolvedTokenSymbol)
              if (!Number.isFinite(tokenUsdPrice) || tokenUsdPrice <= 0) return ""
              const converted = fallbackUsdValue / tokenUsdPrice
              return sanitizeDecimalInput(String(converted), decimals)
            })()
          : ""

      if (!resolvedDenomId) {
        return fallbackFromUsd || fallbackTokenAmount || ""
      }

      const defaultExecutor = (PRIVATE_ACTION_EXECUTOR_ADDRESS || "").trim()
      const resolvedExecutor =
        HIDE_BALANCE_NOTE_VERSION === "v4" && defaultExecutor
          ? defaultExecutor
          : (executorAddress || defaultExecutor || "").trim()
      const tokenAddress = resolveTokenAddress(resolvedTokenSymbol).trim()
      if (!resolvedExecutor || !tokenAddress) {
        return fallbackFromUsd || fallbackTokenAmount || ""
      }

      try {
        const fixedAmount = await readStarknetShieldedPoolFixedAmountFromWallet(
          resolvedExecutor,
          tokenAddress,
          resolvedDenomId,
          "starknet"
        )
        if (fixedAmount !== null) {
          if (fixedAmount > BigInt(0)) {
            const text = sanitizeDecimalInput(
              scaledBigIntToDecimalString(fixedAmount, decimals),
              decimals
            )
            if (text) return text
          } else {
            return ""
          }
        }
      } catch {
        // fallback to cached/local values below
      }

      return fallbackFromUsd || fallbackTokenAmount || ""
    },
    [fromToken.symbol, resolveTokenPrice]
  )

  const ensureHideNoteDeposited = React.useCallback(
    async (payload: PrivacyVerificationPayload): Promise<number> => {
      const defaultExecutor = (PRIVATE_ACTION_EXECUTOR_ADDRESS || "").trim()
      const payloadExecutor = (payload.executor_address || "").trim()
      const executorAddress =
        HIDE_BALANCE_NOTE_VERSION === "v4" && defaultExecutor
          ? defaultExecutor
          : (payloadExecutor || defaultExecutor || "").trim()
      if (!executorAddress) {
        throw new Error(
          "NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS belum di-set untuk hide note deposit."
        )
      }

      const tokenSymbol = fromToken.symbol.toUpperCase()
      const tokenAddress = resolveTokenAddress(tokenSymbol).trim()
      if (!tokenAddress) {
        throw new Error(`Token address for ${tokenSymbol} is not configured.`)
      }

      const noteCommitment = (payload.note_commitment || payload.commitment || "").trim()
      if (!noteCommitment) {
        throw new Error("Hide note commitment missing in privacy payload.")
      }
      const nullifier = (payload.nullifier || "").trim()
      if (!nullifier) {
        throw new Error("Hide nullifier missing in privacy payload.")
      }
      if (isManuallySelectedHideNote(noteCommitment, nullifier)) {
        throw new Error(
          "Active hide note was manually selected. Auto-deposit is disabled for selected notes; swap must use the selected note directly."
        )
      }

      const denomId = (payload.denom_id || inferredHideDenomId || "").trim()
      if (!denomId) {
        throw new Error("Hide denom_id missing in privacy payload.")
      }

      const denomAmountText = await resolveHideFixedAmountText({
        executorAddress,
        tokenSymbol,
        denomId,
        fallbackAmount: denomId,
        fallbackKind: "usd",
      })
      if (!denomAmountText) {
        throw new Error("Failed to resolve fixed note amount for selected hide denom.")
      }
      if (fromAmount !== denomAmountText) {
        setFromAmount(denomAmountText)
      }
      const requiredAmountDecimal = Number.parseFloat(denomAmountText || "0")
      const availableBalance =
        tokenSymbol === "STRK"
          ? wallet.onchainBalance.STRK_L2 ?? wallet.balance.STRK ?? 0
          : tokenSymbol === "CAREL"
          ? wallet.onchainBalance.CAREL ?? wallet.balance.CAREL ?? 0
          : tokenSymbol === "USDC"
          ? wallet.onchainBalance.USDC ?? wallet.balance.USDC ?? 0
          : tokenSymbol === "USDT"
          ? wallet.onchainBalance.USDT ?? wallet.balance.USDT ?? 0
          : tokenSymbol === "WBTC"
          ? wallet.onchainBalance.WBTC ?? wallet.balance.WBTC ?? 0
          : 0
      if (
        Number.isFinite(requiredAmountDecimal) &&
        requiredAmountDecimal > 0 &&
        Number.isFinite(availableBalance) &&
        availableBalance + 1e-12 < requiredAmountDecimal
      ) {
        throw new Error(
          `Insufficient ${tokenSymbol} balance for selected hide tier. Required ${requiredAmountDecimal.toLocaleString(undefined, {
            maximumFractionDigits: 8,
          })} ${tokenSymbol}, available ${availableBalance.toLocaleString(undefined, {
            maximumFractionDigits: 8,
          })} ${tokenSymbol}.`
        )
      }
      const [amountLow, amountHigh] = decimalToU256Parts(
        denomAmountText,
        resolveTokenDecimals(tokenSymbol)
      )
      const requiredAmount = BigInt(amountLow) + (BigInt(amountHigh) << BigInt(128))
      const ownerAddress = (wallet.starknetAddress || wallet.address || "").trim()
      let allowance: bigint | null = null
      if (ownerAddress) {
        try {
          allowance = await readAllowanceCached({
            tokenAddress,
            ownerAddress,
            spender: executorAddress,
            providerHint: starknetProviderHint,
          })
        } catch {
          allowance = null
        }
      }
      const hasEnoughAllowance = allowance !== null && allowance >= requiredAmount

      const approvalBufferBps = BigInt(100)
      const approvalAmount =
        (requiredAmount * (BigInt(10_000) + approvalBufferBps) + BigInt(9_999)) / BigInt(10_000)
      const approvalAmountLow = toHexFelt(approvalAmount & ((BigInt(1) << BigInt(128)) - BigInt(1)))
      const approvalAmountHigh = toHexFelt(approvalAmount >> BigInt(128))
      const approvalTargetAmount = approvalAmount
      const approvalCall = {
        contractAddress: tokenAddress,
        entrypoint: "approve",
        calldata: [executorAddress, approvalAmountLow, approvalAmountHigh],
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
        message: hasEnoughAllowance
          ? `Confirm hide note deposit (${denomAmountText} ${tokenSymbol}) in one transaction.`
          : `Confirm approve (+1% buffer) then hide note deposit (${denomAmountText} ${tokenSymbol}).`,
      })
      let depositTxHash = ""
      if (!hasEnoughAllowance) {
        notifications.addNotification({
          type: "warning",
          title: "Approval required",
          message:
            "Allowance belum cukup. Approve + deposit akan dikirim dalam satu transaksi.",
        })
        try {
          depositTxHash = await invokeStarknetCallsFromWallet(
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
              depositTxHash = await invokeStarknetCallFromWallet(depositCall, starknetProviderHint)
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
      } else {
        try {
          depositTxHash = await invokeStarknetCallsFromWallet(
            [depositCall],
            starknetProviderHint
          )
        } catch (error) {
          if (isStarknetEntrypointMissingError(error)) {
            throw new Error(
              `Entrypoint deposit tidak ditemukan di executor ${executorAddress}. Pastikan PRIVATE_ACTION_EXECUTOR_ADDRESS menunjuk ShieldedPool v4.`
            )
          }
          throw error
        }
      }

      const depositedAtUnix = Math.floor(Date.now() / 1000)
      const spendableAtUnix = depositedAtUnix + Math.floor(HIDE_BALANCE_MIN_NOTE_AGE_MS / 1000)
      persistTradePrivacyPayload({
        ...payload,
        note_version: HIDE_BALANCE_NOTE_VERSION || "v4",
        note_commitment: noteCommitment,
        note_deposit_tx_hash: depositTxHash,
        denom_id: denomId,
        spendable_at_unix: spendableAtUnix,
      })
      upsertPendingHideNote({
        note_version: HIDE_BALANCE_NOTE_VERSION || "v4",
        note_commitment: noteCommitment,
        note_deposit_tx_hash: depositTxHash,
        nullifier,
        executor_address: executorAddress,
        verifier: (payload.verifier || "garaga").trim() || "garaga",
        root:
          (payload.root || "").trim() ||
          inferHideRootFromPublicInputs(normalizeHexArray(payload.public_inputs)),
        proof: normalizeHexArray(payload.proof),
        public_inputs: normalizeHexArray(payload.public_inputs),
        noir_inputs:
          payload.noir_inputs && typeof payload.noir_inputs === "object" && !Array.isArray(payload.noir_inputs)
            ? (payload.noir_inputs as Record<string, unknown>)
            : undefined,
        denom_id: denomId,
        token_symbol: tokenSymbol,
        target_token_symbol: toToken.symbol.toUpperCase(),
        amount: denomAmountText,
        deposited_at_unix: depositedAtUnix,
        spendable_at_unix: spendableAtUnix,
      })
      setHasTradePrivacyPayload(true)
      setPendingHideNotes(loadPendingHideNotes())

      notifications.addNotification({
        type: "success",
        title: "Hide note deposited",
        message: `Note deposit submitted (${depositTxHash.slice(0, 10)}...). Private swap unlocks in ${formatRemainingDuration(HIDE_BALANCE_MIN_NOTE_AGE_MS)}.`,
        txHash: depositTxHash,
        txNetwork: "starknet",
      })
      return spendableAtUnix
    },
    [
      fromAmount,
      fromToken.symbol,
      inferredHideDenomId,
      isManuallySelectedHideNote,
      notifications,
      readAllowanceCached,
      resolveHideFixedAmountText,
      starknetProviderHint,
      toToken.symbol,
      waitForAllowance,
      wallet.address,
      wallet.balance.CAREL,
      wallet.balance.STRK,
      wallet.balance.USDC,
      wallet.balance.USDT,
      wallet.balance.WBTC,
      wallet.onchainBalance.CAREL,
      wallet.onchainBalance.STRK_L2,
      wallet.onchainBalance.USDC,
      wallet.onchainBalance.USDT,
      wallet.onchainBalance.WBTC,
      wallet.starknetAddress,
    ]
  )

  const handleCancelHideNoteWithdraw = React.useCallback(async (noteOverride?: PendingHideNoteRecord) => {
    const payload = noteOverride
      ? {
          note_version: HIDE_BALANCE_NOTE_VERSION || "v4",
          executor_address: noteOverride.executor_address,
          note_commitment: noteOverride.note_commitment,
          commitment: noteOverride.note_commitment,
          nullifier: noteOverride.nullifier,
          spendable_at_unix: noteOverride.spendable_at_unix,
        }
      : loadTradePrivacyPayload()
    const payloadIsV4 =
      noteOverride !== undefined ||
      (payload?.note_version || "").trim().toLowerCase() === "v4" ||
      HIDE_BALANCE_NOTE_VERSION === "v4"
    if (!noteOverride && (!hideBalanceOnchain || !payloadIsV4)) {
      notifications.addNotification({
        type: "warning",
        title: "Withdraw unavailable",
        message: "Withdraw hanya aktif untuk note Hide Balance V4 yang sedang aktif.",
      })
      return
    }
    if (!payload) {
      notifications.addNotification({
        type: "warning",
        title: "No active hide note",
        message: "Tidak ada note hide aktif untuk di-withdraw.",
      })
      return
    }
    const noteCommitment = (payload.note_commitment || payload.commitment || "").trim()
    const noteNullifier = (payload.nullifier || "").trim()
    if (!noteCommitment) {
      notifications.addNotification({
        type: "error",
        title: "Withdraw failed",
        message: "Note commitment tidak tersedia di payload hide aktif.",
      })
      return
    }

    setIsCancellingHideNote(true)
    try {
      if (!noteNullifier) {
        throw new Error("Nullifier tidak tersedia untuk note ini.")
      }
      const matchedNote =
        noteOverride ||
        loadPendingHideNotes().find((item) => {
          const sameCommitment =
            (item.note_commitment || "").trim().toLowerCase() === noteCommitment.toLowerCase()
          const sameNullifier =
            noteNullifier.length > 0 &&
            (item.nullifier || "").trim().toLowerCase() === noteNullifier.toLowerCase()
          return sameCommitment || sameNullifier
        })
      if (!matchedNote) {
        throw new Error(
          "Detail note tidak ditemukan di daftar pending. Pilih note dari panel Pending Hide Notes sebelum withdraw."
        )
      }

      const root = (payload.root || matchedNote.root || "").trim()
      if (!root) {
        throw new Error("Root tidak tersedia untuk note ini.")
      }

      const tokenSymbol = (matchedNote.token_symbol || "").trim().toUpperCase()
      if (!tokenSymbol) {
        throw new Error("Token symbol note tidak tersedia.")
      }
      const tokenAddress = resolveTokenAddress(tokenSymbol).trim()
      if (!tokenAddress) {
        throw new Error(`Token address untuk ${tokenSymbol} tidak ditemukan.`)
      }
      const amountText = (matchedNote.amount || "").trim()
      if (!amountText) {
        throw new Error("Jumlah note tidak tersedia untuk private exit.")
      }
      const [amountLow, amountHigh] = decimalToU256Parts(
        amountText,
        resolveTokenDecimals(tokenSymbol)
      )

      const recipientAddress = (wallet.starknetAddress || wallet.address || "").trim()
      if (!recipientAddress) {
        throw new Error("Alamat Starknet wallet belum tersedia.")
      }

      const executorAddress = (
        matchedNote.executor_address ||
        payload.executor_address ||
        PRIVATE_ACTION_EXECUTOR_ADDRESS ||
        ""
      ).trim()
      if (!executorAddress) {
        throw new Error("Executor address tidak tersedia untuk note ini.")
      }

      const preparedExit = await preparePrivateExit({
        verifier: (payload.verifier || matchedNote.verifier || "garaga").trim() || "garaga",
        executor_address: executorAddress,
        root,
        nullifier: noteNullifier,
        note_commitment: noteCommitment,
        denom_id: (matchedNote.denom_id || payload.denom_id || "").trim() || undefined,
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
          denom_id: (matchedNote.denom_id || payload.denom_id || "").trim() || undefined,
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
      const activePayload = loadTradePrivacyPayload()
      const activeCommitment = (activePayload?.note_commitment || activePayload?.commitment || "")
        .trim()
        .toLowerCase()
      const activeNullifier = (activePayload?.nullifier || "").trim().toLowerCase()
      if (
        activeCommitment === noteCommitment.toLowerCase() ||
        (activeNullifier.length > 0 && activeNullifier === noteNullifier.toLowerCase())
      ) {
        clearTradePrivacyPayload()
        setHasTradePrivacyPayload(false)
        setBalanceHidden(false)
      }
      notifications.addNotification({
        type: "success",
        title: "Withdraw submitted",
        message: `Private exit submitted (${txHash.slice(0, 10)}...).`,
        txHash,
        txNetwork: "starknet",
      })
    } catch (error) {
      const rawErrorMessage =
        error instanceof Error ? error.message : "Failed to cancel and withdraw hide note."
      const normalizedErrorMessage = rawErrorMessage.toLowerCase()
      const walletRejected =
        normalizedErrorMessage.includes("user_refused_op") ||
        normalizedErrorMessage.includes("wallet signature was rejected") ||
        normalizedErrorMessage.includes("request rejected in wallet") ||
        normalizedErrorMessage.includes("user rejected") ||
        normalizedErrorMessage.includes("rejected by user") ||
        normalizedErrorMessage.includes("user denied") ||
        normalizedErrorMessage.includes("request rejected") ||
        normalizedErrorMessage.includes("transaction rejected") ||
        normalizedErrorMessage.includes("wallet rejected") ||
        normalizedErrorMessage.includes("user canceled") ||
        normalizedErrorMessage.includes("user cancelled") ||
        normalizedErrorMessage.includes("cancelled") ||
        normalizedErrorMessage.includes("canceled")
      if (walletRejected) {
        notifications.addNotification({
          type: "warning",
          title: "Withdraw cancelled",
          message: "Wallet signature was rejected. No funds were moved.",
        })
        return
      }
      notifications.addNotification({
        type: "error",
        title: "Withdraw failed",
        message: rawErrorMessage,
      })
    } finally {
      setIsCancellingHideNote(false)
    }
  }, [
    clearManuallySelectedHideNote,
    clearTradePrivacyPayload,
    hideBalanceOnchain,
    isManuallySelectedHideNote,
    notifications,
    setBalanceHidden,
    setHasTradePrivacyPayload,
    setIsCancellingHideNote,
    starknetProviderHint,
    wallet,
  ])

  return {
    resolveHideFixedAmountText,
    ensureHideNoteDeposited,
    handleCancelHideNoteWithdraw,
  }
}
