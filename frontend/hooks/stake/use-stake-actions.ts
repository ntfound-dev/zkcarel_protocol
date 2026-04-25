"use client"

import * as React from "react"
import type { PrivacyVerificationPayload } from "@/lib/api"
import type { useNotifications } from "@/hooks/notifications/use-notifications"
import type { WalletContextType } from "@/hooks/wallet/use-wallet"
import { stakeClaim, stakeDeposit, stakeWithdraw } from "@/lib/api"
import { decimalToU256Parts, invokeStarknetCallsFromWallet } from "@/lib/onchain-trade"

type ConfirmStakeOptions = {
  manualExecuteFromPendingNote?: boolean
  overridePayload?: PrivacyVerificationPayload
  overridePoolSymbol?: string
  overrideAmount?: string
}

type PoolLike = {
  symbol: string
  minStake: string
}

type PositionLike = {
  id: string
  amount: number
  rewards?: number
  status: "active" | "pending" | "unlocking"
  pool: PoolLike
}

type UseStakeActionsParams<TPool extends PoolLike, TPosition extends PositionLike> = {
  notifications: ReturnType<typeof useNotifications>
  wallet: WalletContextType
  pools: TPool[]
  positions: TPosition[]
  selectedPool: TPool | null
  stakeAmount: string
  balanceHidden: boolean
  hideBalanceRelayerPoolEnabled: boolean
  hideBalanceRelayerApproveMax: boolean
  poolDecimals: Record<string, number>
  privateActionExecutorAddress: string
  privacyRouterAddress: string
  starknetProviderHint: "starknet" | "argentx" | "braavos"
  resolvePoolTokenAddress: (symbol: string) => string
  resolveHideBalancePrivacyPayload: (txContext?: {
    flow?: string
    fromToken?: string
    toToken?: string
    amount?: string
  }) => Promise<PrivacyVerificationPayload | undefined>
  ensureHideNoteDeposited: (params: {
    payload: PrivacyVerificationPayload
    symbol: string
    amountText: string
  }) => Promise<number>
  submitOnchainStakeTx: (
    poolSymbol: string,
    entrypoint: "stake" | "unstake",
    amount: string,
    privacyPayload?: PrivacyVerificationPayload
  ) => Promise<{ txHash: string; privacyPayload?: PrivacyVerificationPayload }>
  submitOnchainClaimTx: (
    poolSymbol: string,
    privacyPayload?: PrivacyVerificationPayload
  ) => Promise<{ txHash: string; privacyPayload?: PrivacyVerificationPayload }>
  consumeUsedHidePayload: (payload?: PrivacyVerificationPayload) => void
  loadTradePrivacyPayload: () => PrivacyVerificationPayload | undefined
  isManuallySelectedHideNote: (noteCommitment?: string, nullifier?: string) => boolean
  clearManuallySelectedHideNote: () => void
  clearTradePrivacyPayload: () => void
  setHasTradePrivacyPayload: React.Dispatch<React.SetStateAction<boolean>>
  setPositions: React.Dispatch<React.SetStateAction<TPosition[]>>
  setStakeSuccess: React.Dispatch<React.SetStateAction<boolean>>
  setIsStaking: React.Dispatch<React.SetStateAction<boolean>>
  setClaimingPositionId: React.Dispatch<React.SetStateAction<string | null>>
  refreshPositions: () => Promise<void>
}

const U256_MAX_LOW_HEX = "0xffffffffffffffffffffffffffffffff"
const U256_MAX_HIGH_HEX = "0xffffffffffffffffffffffffffffffff"

const mapStakeUiErrorMessage = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : String(error ?? "")
  const normalized = message.toLowerCase()
  const operation = fallback.toLowerCase()

  if (normalized.includes("nullifier already spent")) {
    return "HIDE_NOTE_SPENT::Hide note already used. Select another pending note (or deposit a new one), then retry."
  }
  if (normalized.includes("erc20: insufficient balance")) {
    if (operation.includes("claim")) {
      return "Claim failed because staking reward liquidity is insufficient on-chain. Top up reward pool balance, then retry."
    }
    if (operation.includes("unstake")) {
      return "Unstake failed because pool liquidity is insufficient on-chain. Try a smaller amount, then retry."
    }
    if (operation.includes("stake")) {
      return "Staking failed because your wallet token balance is insufficient."
    }
    return "Transaction failed because token balance is insufficient."
  }
  if (normalized.includes("erc20: insufficient allowance")) {
    return "Token allowance is insufficient. Approve token spending first, then retry."
  }
  if (normalized.includes("argent/multicall-failed")) {
    return `Wallet multicall failed: ${message}`
  }
  return message || fallback
}

export const useStakeActions = <TPool extends PoolLike, TPosition extends PositionLike>({
  notifications,
  wallet,
  pools,
  positions,
  selectedPool,
  stakeAmount,
  balanceHidden,
  hideBalanceRelayerPoolEnabled,
  hideBalanceRelayerApproveMax,
  poolDecimals,
  privateActionExecutorAddress,
  privacyRouterAddress,
  starknetProviderHint,
  resolvePoolTokenAddress,
  resolveHideBalancePrivacyPayload,
  ensureHideNoteDeposited,
  submitOnchainStakeTx,
  submitOnchainClaimTx,
  consumeUsedHidePayload,
  loadTradePrivacyPayload,
  isManuallySelectedHideNote,
  clearManuallySelectedHideNote,
  clearTradePrivacyPayload,
  setHasTradePrivacyPayload,
  setPositions,
  setStakeSuccess,
  setIsStaking,
  setClaimingPositionId,
  refreshPositions,
}: UseStakeActionsParams<TPool, TPosition>) => {
  const approveRelayerFundingForStake = React.useCallback(
    async (poolSymbol: string, amountValue: string) => {
      const symbol = poolSymbol.trim().toUpperCase()
      const tokenAddress = resolvePoolTokenAddress(symbol)
      if (!tokenAddress) {
        throw new Error(
          `Token address for ${symbol} is not configured for hide-mode relayer funding.`
        )
      }
      const executorAddress = (privateActionExecutorAddress || privacyRouterAddress || "").trim()
      if (!executorAddress) {
        throw new Error(
          "NEXT_PUBLIC_PRIVATE_ACTION_EXECUTOR_ADDRESS is not configured for shielded relayer mode."
        )
      }
      const [amountLow, amountHigh] = decimalToU256Parts(amountValue || "1", poolDecimals[symbol] || 18)
      const [approvalLow, approvalHigh] = hideBalanceRelayerApproveMax
        ? [U256_MAX_LOW_HEX, U256_MAX_HIGH_HEX]
        : [amountLow, amountHigh]
      notifications.addNotification({
        type: "info",
        title: "Wallet signature required",
        message: hideBalanceRelayerApproveMax
          ? `Approve one-time ${symbol} spending limit for private relayer funding.`
          : `Approve ${amountValue} ${symbol} for private relayer note funding.`,
      })
      const txHash = await invokeStarknetCallsFromWallet(
        [
          {
            contractAddress: tokenAddress,
            entrypoint: "approve",
            calldata: [executorAddress, approvalLow, approvalHigh],
          },
        ],
        starknetProviderHint
      )
      notifications.addNotification({
        type: "success",
        title: "Allowance approved",
        message: hideBalanceRelayerApproveMax
          ? `Relayer allowance for ${symbol} is now active (one-time setup).`
          : `Relayer can now fund private note from your ${symbol} balance.`,
        txHash,
        txNetwork: "starknet",
      })
    },
    [
      hideBalanceRelayerApproveMax,
      notifications,
      poolDecimals,
      privacyRouterAddress,
      privateActionExecutorAddress,
      resolvePoolTokenAddress,
      starknetProviderHint,
    ]
  )

  const confirmStake = React.useCallback(
    async (options?: ConfirmStakeOptions) => {
      const effectivePool =
        options?.overridePoolSymbol && options.overridePoolSymbol.trim()
          ? pools.find(
              (pool) =>
                pool.symbol.toUpperCase() === options.overridePoolSymbol?.trim().toUpperCase()
            ) || null
          : selectedPool
      if (!effectivePool) return
      if (effectivePool.symbol === "BTC") {
        notifications.addNotification({
          type: "info",
          title: "Not Available",
          message: "BTC staking is currently unavailable.",
        })
        return
      }
      const effectiveAmount = (options?.overrideAmount || stakeAmount || "").trim()
      const parsedAmount = Number.parseFloat(effectiveAmount)
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        notifications.addNotification({
          type: "error",
          title: "Amount is required",
          message: "Set a valid stake amount before submitting.",
        })
        return
      }

      setIsStaking(true)
      try {
        const effectiveHideBalance = balanceHidden
        const useRelayerPoolHide = effectiveHideBalance && hideBalanceRelayerPoolEnabled
        const manualPendingExecution = Boolean(options?.manualExecuteFromPendingNote)
        const shouldDepositOnly =
          useRelayerPoolHide && effectiveHideBalance && !manualPendingExecution

        if (shouldDepositOnly) {
          clearManuallySelectedHideNote()
          clearTradePrivacyPayload()
          setHasTradePrivacyPayload(false)
        }

        const resolvedPrivacyPayload =
          options?.overridePayload ||
          (effectiveHideBalance
            ? await resolveHideBalancePrivacyPayload({
                flow: "stake",
                fromToken: effectivePool.symbol,
                toToken: effectivePool.symbol,
                amount: effectiveAmount,
              })
            : undefined)
        if (effectiveHideBalance && !resolvedPrivacyPayload) {
          throw new Error(
            "Garaga payload is not ready for Hide Balance. Check backend auto-proof config."
          )
        }
        let onchainTxHash: string | undefined
        let payloadForBackend = resolvedPrivacyPayload

        if (shouldDepositOnly && payloadForBackend) {
          await ensureHideNoteDeposited({
            payload: payloadForBackend,
            symbol: effectivePool.symbol,
            amountText: effectiveAmount,
          })
          throw new Error("HIDE_NOTE_READY::Hide note berhasil dideposit. Retry private stake now.")
        }

        if (!useRelayerPoolHide) {
          notifications.addNotification({
            type: "info",
            title: "Wallet signature required",
            message: "Confirm staking transaction in your Starknet wallet.",
          })
          const submitted = await submitOnchainStakeTx(
            effectivePool.symbol,
            "stake",
            effectiveAmount,
            resolvedPrivacyPayload
          )
          onchainTxHash = submitted.txHash
          payloadForBackend = submitted.privacyPayload || resolvedPrivacyPayload
          notifications.addNotification({
            type: "info",
            title: "Staking pending",
            message: `Stake ${effectiveAmount} ${effectivePool.symbol} submitted on-chain (${onchainTxHash.slice(0, 10)}...).`,
            txHash: onchainTxHash,
            txNetwork: "starknet",
          })
        } else {
          notifications.addNotification({
            type: "info",
            title: "Submitting private stake",
            message: "Submitting hide-mode stake via backend relayer pool.",
          })
        }
        let response: { tx_hash?: string; privacy_tx_hash?: string }
        try {
          response = await stakeDeposit({
            pool_id: effectivePool.symbol,
            amount: effectiveAmount,
            onchain_tx_hash: onchainTxHash,
            hide_balance: effectiveHideBalance,
            privacy: effectiveHideBalance ? payloadForBackend || resolvedPrivacyPayload : undefined,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error || "")
          if (/nullifier already spent/i.test(message)) {
            consumeUsedHidePayload(payloadForBackend || resolvedPrivacyPayload)
            throw new Error(
              "HIDE_NOTE_SPENT::Selected hide note was already spent. Refreshing note state and retry with a new note."
            )
          }
          if (
            useRelayerPoolHide &&
            /note belum terdaftar|note not registered|note is not registered yet/i.test(message) &&
            (payloadForBackend || resolvedPrivacyPayload)
          ) {
            const payload = payloadForBackend || resolvedPrivacyPayload
            const selectedCommitment = (
              payload?.note_commitment ||
              payload?.commitment ||
              ""
            )
              .trim()
              .toLowerCase()
            const selectedNullifier = (payload?.nullifier || "").trim().toLowerCase()
            if (isManuallySelectedHideNote(selectedCommitment, selectedNullifier)) {
              throw new Error(
                "Selected hide note is not recognized by the active executor/relayer. Auto-deposit is disabled for manually selected notes. Please choose another pending note or withdraw this note."
              )
            }
            let spendableAtUnix: number | undefined
            try {
              spendableAtUnix = await ensureHideNoteDeposited({
                payload: payload as PrivacyVerificationPayload,
                symbol: effectivePool.symbol,
                amountText: effectiveAmount,
              })
            } catch (depositError) {
              const depositMessage =
                depositError instanceof Error ? depositError.message : String(depositError || "")
              throw new Error(
                `Hide note belum terdaftar dan auto-deposit gagal. Detail: ${depositMessage}`
              )
            }
            if (spendableAtUnix && spendableAtUnix > 0) {
              throw new Error(
                "HIDE_NOTE_READY::Hide note berhasil dideposit. Retry private stake now."
              )
            }
            throw new Error("HIDE_NOTE_READY::Hide note berhasil dideposit. Retry private stake now.")
          }
          if (useRelayerPoolHide && /hide note\/pool balance tidak cukup/i.test(message)) {
            throw new Error(message)
          }
          if (useRelayerPoolHide) {
            throw new Error(
              `Hide relayer unavailable. Wallet fallback is disabled so stake details never leak in explorer. Detail: ${message}`
            )
          }
          throw error
        }
        const finalTxHash = response.tx_hash || onchainTxHash
        if (useRelayerPoolHide && finalTxHash) {
          notifications.addNotification({
            type: "info",
            title: "Staking pending",
            message: `Stake ${effectiveAmount} ${effectivePool.symbol} submitted on-chain (${finalTxHash.slice(0, 10)}...).`,
            txHash: finalTxHash,
            txNetwork: "starknet",
          })
        }
        if (response.privacy_tx_hash) {
          notifications.addNotification({
            type: "info",
            title: "Garaga verification submitted",
            message: `Privacy tx ${response.privacy_tx_hash.slice(0, 12)}... was submitted on Starknet.`,
            txHash: response.privacy_tx_hash,
            txNetwork: "starknet",
          })
        }
        if (effectiveHideBalance) {
          consumeUsedHidePayload(payloadForBackend || resolvedPrivacyPayload)
        }
        await Promise.allSettled([wallet.refreshPortfolio(), wallet.refreshOnchainBalances()])
        await refreshPositions()
        setStakeSuccess(true)
        notifications.addNotification({
          type: "success",
          title: "Staking successful",
          message: `Stake ${effectiveAmount} ${effectivePool.symbol} completed successfully`,
          txHash: finalTxHash,
          txNetwork: "starknet",
        })
      } catch (error) {
        const rawMessage = mapStakeUiErrorMessage(error, "Unable to complete staking")
        if (rawMessage.startsWith("HIDE_NOTE_WAIT::")) {
          notifications.addNotification({
            type: "warning",
            title: "Mixing window active",
            message: rawMessage.replace("HIDE_NOTE_WAIT::", "").trim(),
          })
          return
        }
        if (rawMessage.startsWith("HIDE_NOTE_READY::")) {
          notifications.addNotification({
            type: "success",
            title: "Hide note deposited",
            message: rawMessage.replace("HIDE_NOTE_READY::", "").trim(),
          })
          return
        }
        if (rawMessage.startsWith("HIDE_NOTE_SPENT::")) {
          consumeUsedHidePayload(loadTradePrivacyPayload())
          notifications.addNotification({
            type: "warning",
            title: "Hide note refreshed",
            message: rawMessage.replace("HIDE_NOTE_SPENT::", "").trim(),
          })
          return
        }
        notifications.addNotification({
          type: "error",
          title: "Staking failed",
          message: rawMessage,
        })
      } finally {
        setIsStaking(false)
      }
    },
    [
      balanceHidden,
      clearManuallySelectedHideNote,
      clearTradePrivacyPayload,
      consumeUsedHidePayload,
      ensureHideNoteDeposited,
      hideBalanceRelayerPoolEnabled,
      isManuallySelectedHideNote,
      loadTradePrivacyPayload,
      notifications,
      pools,
      refreshPositions,
      resolveHideBalancePrivacyPayload,
      selectedPool,
      setHasTradePrivacyPayload,
      setIsStaking,
      setStakeSuccess,
      stakeAmount,
      submitOnchainStakeTx,
      wallet,
    ]
  )

  const handleUnstake = React.useCallback(
    async (positionId: string) => {
      const target = positions.find((pos) => pos.id === positionId)
      if (!target) return

      setPositions((prev) =>
        prev.map((p) => (p.id === positionId ? { ...p, status: "unlocking" as const } : p))
      )

      try {
        const effectiveHideBalance = balanceHidden
        const useRelayerPoolHide = effectiveHideBalance && hideBalanceRelayerPoolEnabled
        const resolvedPrivacyPayload = effectiveHideBalance
          ? await resolveHideBalancePrivacyPayload({
              flow: "unstake",
              fromToken: target.pool.symbol,
              toToken: target.pool.symbol,
              amount: target.amount.toString(),
            })
          : undefined
        if (effectiveHideBalance && !resolvedPrivacyPayload) {
          throw new Error(
            "Garaga payload is not ready for Hide Balance. Check backend auto-proof config."
          )
        }
        let onchainTxHash: string | undefined
        let payloadForBackend = resolvedPrivacyPayload
        if (!useRelayerPoolHide) {
          notifications.addNotification({
            type: "info",
            title: "Wallet signature required",
            message: "Confirm unstake transaction in your Starknet wallet.",
          })
          const submitted = await submitOnchainStakeTx(
            target.pool.symbol,
            "unstake",
            target.amount.toString(),
            resolvedPrivacyPayload
          )
          onchainTxHash = submitted.txHash
          payloadForBackend = submitted.privacyPayload || resolvedPrivacyPayload
          notifications.addNotification({
            type: "info",
            title: "Unstake pending",
            message: `${target.amount} ${target.pool.symbol} submitted on-chain (${onchainTxHash.slice(0, 10)}...).`,
            txHash: onchainTxHash,
            txNetwork: "starknet",
          })
        } else {
          notifications.addNotification({
            type: "info",
            title: "Submitting private unstake",
            message: "Submitting hide-mode unstake via Starknet relayer pool.",
          })
        }
        let response: { tx_hash?: string; privacy_tx_hash?: string }
        try {
          response = await stakeWithdraw({
            position_id: positionId,
            amount: target.amount.toString(),
            onchain_tx_hash: onchainTxHash,
            hide_balance: effectiveHideBalance,
            privacy: effectiveHideBalance ? payloadForBackend || resolvedPrivacyPayload : undefined,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error || "")
          if (/nullifier already spent/i.test(message)) {
            consumeUsedHidePayload(payloadForBackend || resolvedPrivacyPayload)
            throw new Error(
              "HIDE_NOTE_SPENT::Selected hide note was already spent. Refreshing note state and retry with a new note."
            )
          }
          if (
            useRelayerPoolHide &&
            /(insufficient allowance|shielded note funding failed|deposit_fixed_for|allowance)/i.test(
              message
            )
          ) {
            await approveRelayerFundingForStake(target.pool.symbol, target.amount.toString())
            try {
              response = await stakeWithdraw({
                position_id: positionId,
                amount: target.amount.toString(),
                onchain_tx_hash: onchainTxHash,
                hide_balance: effectiveHideBalance,
                privacy: effectiveHideBalance ? payloadForBackend || resolvedPrivacyPayload : undefined,
              })
            } catch (retryError) {
              const retryMessage =
                retryError instanceof Error ? retryError.message : String(retryError || "")
              if (/nullifier already spent/i.test(retryMessage)) {
                consumeUsedHidePayload(payloadForBackend || resolvedPrivacyPayload)
                throw new Error(
                  "HIDE_NOTE_SPENT::Selected hide note was already spent. Refreshing note state and retry with a new note."
                )
              }
              throw retryError
            }
          } else {
            throw error
          }
        }
        const finalTxHash = response.tx_hash || onchainTxHash
        if (useRelayerPoolHide && finalTxHash) {
          notifications.addNotification({
            type: "info",
            title: "Unstake pending",
            message: `${target.amount} ${target.pool.symbol} submitted on-chain (${finalTxHash.slice(0, 10)}...).`,
            txHash: finalTxHash,
            txNetwork: "starknet",
          })
        }
        if (response.privacy_tx_hash) {
          notifications.addNotification({
            type: "info",
            title: "Garaga verification submitted",
            message: `Privacy tx ${response.privacy_tx_hash.slice(0, 12)}... was submitted on Starknet.`,
            txHash: response.privacy_tx_hash,
            txNetwork: "starknet",
          })
        }
        if (effectiveHideBalance) {
          consumeUsedHidePayload(payloadForBackend || resolvedPrivacyPayload)
        }
        await Promise.allSettled([wallet.refreshPortfolio(), wallet.refreshOnchainBalances()])
        await refreshPositions()
        notifications.addNotification({
          type: "success",
          title: "Unstake processing",
          message: `${target.amount} ${target.pool.symbol} is being processed`,
          txHash: finalTxHash,
          txNetwork: "starknet",
        })
      } catch (error) {
        setPositions((prev) =>
          prev.map((p) => (p.id === positionId ? { ...p, status: "active" as const } : p))
        )
        const rawMessage = mapStakeUiErrorMessage(error, "Unable to complete unstake")
        if (rawMessage.startsWith("HIDE_NOTE_SPENT::")) {
          consumeUsedHidePayload(loadTradePrivacyPayload())
          notifications.addNotification({
            type: "warning",
            title: "Hide note refreshed",
            message: rawMessage.replace("HIDE_NOTE_SPENT::", "").trim(),
          })
          return
        }
        notifications.addNotification({
          type: "error",
          title: "Unstake failed",
          message: rawMessage,
        })
      }
    },
    [
      approveRelayerFundingForStake,
      balanceHidden,
      consumeUsedHidePayload,
      hideBalanceRelayerPoolEnabled,
      loadTradePrivacyPayload,
      notifications,
      positions,
      refreshPositions,
      resolveHideBalancePrivacyPayload,
      setPositions,
      submitOnchainStakeTx,
      wallet,
    ]
  )

  const handleClaim = React.useCallback(
    async (positionId: string) => {
      const target = positions.find((pos) => pos.id === positionId)
      if (!target) return

      setClaimingPositionId(positionId)
      try {
        const effectiveHideBalance = balanceHidden
        const useRelayerPoolHide = effectiveHideBalance && hideBalanceRelayerPoolEnabled
        const resolvedPrivacyPayload = effectiveHideBalance
          ? await resolveHideBalancePrivacyPayload({
              flow: "stake_claim",
              fromToken: target.pool.symbol,
              toToken: target.pool.symbol,
              amount: target.rewards?.toString?.() || "0",
            })
          : undefined
        if (effectiveHideBalance && !resolvedPrivacyPayload) {
          throw new Error(
            "Garaga payload is not ready for Hide Balance. Check backend auto-proof config."
          )
        }
        let onchainTxHash: string | undefined
        let payloadForBackend = resolvedPrivacyPayload
        if (!useRelayerPoolHide) {
          notifications.addNotification({
            type: "info",
            title: "Wallet signature required",
            message: "Confirm claim rewards transaction in your Starknet wallet.",
          })
          const submitted = await submitOnchainClaimTx(target.pool.symbol, resolvedPrivacyPayload)
          onchainTxHash = submitted.txHash
          payloadForBackend = submitted.privacyPayload || resolvedPrivacyPayload
          notifications.addNotification({
            type: "info",
            title: "Claim pending",
            message: `Claim ${target.pool.symbol} rewards submitted on-chain (${onchainTxHash.slice(0, 10)}...).`,
            txHash: onchainTxHash,
            txNetwork: "starknet",
          })
        } else {
          notifications.addNotification({
            type: "info",
            title: "Submitting private claim",
            message: "Submitting hide-mode claim via Starknet relayer pool.",
          })
        }
        let response: { tx_hash?: string; privacy_tx_hash?: string }
        try {
          response = await stakeClaim({
            position_id: positionId,
            onchain_tx_hash: onchainTxHash,
            hide_balance: effectiveHideBalance,
            privacy: effectiveHideBalance ? payloadForBackend || resolvedPrivacyPayload : undefined,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error || "")
          if (/nullifier already spent/i.test(message)) {
            consumeUsedHidePayload(payloadForBackend || resolvedPrivacyPayload)
            throw new Error(
              "HIDE_NOTE_SPENT::Selected hide note was already spent. Refreshing note state and retry with a new note."
            )
          }
          if (
            useRelayerPoolHide &&
            /(insufficient allowance|shielded note funding failed|deposit_fixed_for|allowance)/i.test(
              message
            )
          ) {
            await approveRelayerFundingForStake(target.pool.symbol, "1")
            try {
              response = await stakeClaim({
                position_id: positionId,
                onchain_tx_hash: onchainTxHash,
                hide_balance: effectiveHideBalance,
                privacy: effectiveHideBalance ? payloadForBackend || resolvedPrivacyPayload : undefined,
              })
            } catch (retryError) {
              const retryMessage =
                retryError instanceof Error ? retryError.message : String(retryError || "")
              if (/nullifier already spent/i.test(retryMessage)) {
                consumeUsedHidePayload(payloadForBackend || resolvedPrivacyPayload)
                throw new Error(
                  "HIDE_NOTE_SPENT::Selected hide note was already spent. Refreshing note state and retry with a new note."
                )
              }
              throw retryError
            }
          } else {
            throw error
          }
        }
        const finalTxHash = response.tx_hash || onchainTxHash
        if (useRelayerPoolHide && finalTxHash) {
          notifications.addNotification({
            type: "info",
            title: "Claim pending",
            message: `Claim ${target.pool.symbol} rewards submitted on-chain (${finalTxHash.slice(0, 10)}...).`,
            txHash: finalTxHash,
            txNetwork: "starknet",
          })
        }
        if (response.privacy_tx_hash) {
          notifications.addNotification({
            type: "info",
            title: "Garaga verification submitted",
            message: `Privacy tx ${response.privacy_tx_hash.slice(0, 12)}... was submitted on Starknet.`,
            txHash: response.privacy_tx_hash,
            txNetwork: "starknet",
          })
        }
        if (effectiveHideBalance) {
          consumeUsedHidePayload(payloadForBackend || resolvedPrivacyPayload)
        }
        await Promise.allSettled([wallet.refreshPortfolio(), wallet.refreshOnchainBalances()])
        await refreshPositions()
        notifications.addNotification({
          type: "success",
          title: "Claim completed",
          message: `Staking rewards claim confirmed for ${target.pool.symbol}.`,
          txHash: finalTxHash,
          txNetwork: "starknet",
        })
      } catch (error) {
        const rawMessage = mapStakeUiErrorMessage(error, "Unable to claim staking rewards")
        if (rawMessage.startsWith("HIDE_NOTE_SPENT::")) {
          consumeUsedHidePayload(loadTradePrivacyPayload())
          notifications.addNotification({
            type: "warning",
            title: "Hide note refreshed",
            message: rawMessage.replace("HIDE_NOTE_SPENT::", "").trim(),
          })
          return
        }
        notifications.addNotification({
          type: "error",
          title: "Claim failed",
          message: rawMessage,
        })
      } finally {
        setClaimingPositionId((current) => (current === positionId ? null : current))
      }
    },
    [
      approveRelayerFundingForStake,
      balanceHidden,
      consumeUsedHidePayload,
      hideBalanceRelayerPoolEnabled,
      loadTradePrivacyPayload,
      notifications,
      positions,
      refreshPositions,
      resolveHideBalancePrivacyPayload,
      setClaimingPositionId,
      submitOnchainClaimTx,
      wallet,
    ]
  )

  return { confirmStake, handleUnstake, handleClaim }
}
