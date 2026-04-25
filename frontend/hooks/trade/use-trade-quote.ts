import * as React from "react"
import { getBridgeQuote, getSwapQuote } from "@/lib/api"
import {
  bigintWeiToUnitNumber,
  estimateEvmNetworkFeeWei,
  estimateStarkgateDepositFeeWei,
} from "@/lib/onchain-trade"
import type { QuoteCacheEntry, QuoteState } from "@/lib/trading-types"
import {
  LIVE_PRICE_NORMALIZATION_THRESHOLD,
  MAX_QUOTE_CACHE_ENTRIES,
  MEV_FEE_RATE,
  QUOTE_CACHE_TTL_MS,
  STARKGATE_ETH_BRIDGE_ADDRESS,
  BRIDGE_TO_STRK_DISABLED_MESSAGE,
  UNSUPPORTED_BRIDGE_PAIR_MESSAGE,
  convertAmountByUsdPrice,
  normalizeEstimatedTimeLabel,
  normalizeTokenAmountDisplay,
  parseLiquidityMaxFromQuoteError,
  stableKeyNumber,
} from "@/lib/trading-utils"

type UseTradeQuoteParams = {
  fromAmount: string
  fromSymbol: string
  toSymbol: string
  fromChain: string
  toChain: string
  fromPrice: number
  toPrice: number
  isCrossChain: boolean
  bridgeToStrkDisabled: boolean
  bridgePairSupported: boolean
  mevProtection: boolean
  slippage: string
  customSlippage: string
  setToAmount: React.Dispatch<React.SetStateAction<string>>
  setQuote: React.Dispatch<React.SetStateAction<QuoteState | null>>
  setQuoteError: React.Dispatch<React.SetStateAction<string | null>>
  setIsQuoteLoading: React.Dispatch<React.SetStateAction<boolean>>
  setLiquidityMaxFromQuote: React.Dispatch<React.SetStateAction<number | null>>
}

export const useTradeQuote = ({
  fromAmount,
  fromSymbol,
  toSymbol,
  fromChain,
  toChain,
  fromPrice,
  toPrice,
  isCrossChain,
  bridgeToStrkDisabled,
  bridgePairSupported,
  mevProtection,
  slippage,
  customSlippage,
  setToAmount,
  setQuote,
  setQuoteError,
  setIsQuoteLoading,
  setLiquidityMaxFromQuote,
}: UseTradeQuoteParams) => {
  const quoteCacheRef = React.useRef<Map<string, QuoteCacheEntry>>(new Map())
  const quoteRequestSeqRef = React.useRef(0)

  React.useEffect(() => {
    const amountValue = Number.parseFloat(fromAmount || "0")
    if (!amountValue || amountValue <= 0) {
      setToAmount("")
      setQuote(null)
      setQuoteError(null)
      setLiquidityMaxFromQuote(null)
      return
    }
    if (!isCrossChain && fromSymbol.toUpperCase() === toSymbol.toUpperCase()) {
      setToAmount(normalizeTokenAmountDisplay(fromAmount, toSymbol))
      setQuote(null)
      setQuoteError("Select a different destination token.")
      setLiquidityMaxFromQuote(null)
      return
    }
    if (bridgeToStrkDisabled) {
      setToAmount("")
      setQuote(null)
      setQuoteError(BRIDGE_TO_STRK_DISABLED_MESSAGE)
      setLiquidityMaxFromQuote(null)
      return
    }
    if (isCrossChain && !bridgePairSupported) {
      setToAmount("")
      setQuote(null)
      setQuoteError(UNSUPPORTED_BRIDGE_PAIR_MESSAGE)
      setLiquidityMaxFromQuote(null)
      return
    }
    const slippageValue = Number(customSlippage || slippage || "0.5")
    const tradeMode = mevProtection ? "private" : "transparent"
    const quoteCacheKey = [
      isCrossChain ? "bridge" : "swap",
      fromChain,
      toChain,
      fromSymbol,
      toSymbol,
      stableKeyNumber(amountValue, 8),
      stableKeyNumber(slippageValue, 4),
      tradeMode,
    ].join("|")

    let cancelled = false
    const requestSeq = ++quoteRequestSeqRef.current
    const isStale = () => cancelled || requestSeq !== quoteRequestSeqRef.current
    const timer = setTimeout(async () => {
      setIsQuoteLoading(true)
      setQuoteError(null)
      const now = Date.now()
      const cached = quoteCacheRef.current.get(quoteCacheKey)
      if (cached && cached.expiresAt > now) {
        if (!isStale()) {
          setToAmount(cached.toAmount)
          setQuote(cached.quote)
          setQuoteError(cached.quoteError)
          setLiquidityMaxFromQuote(
            parseLiquidityMaxFromQuoteError(cached.quoteError || "", fromSymbol)
          )
          setIsQuoteLoading(false)
        }
        return
      }
      if (cached) {
        quoteCacheRef.current.delete(quoteCacheKey)
      }

      const saveQuoteToCache = (
        nextQuote: QuoteState,
        nextToAmount: string,
        nextQuoteError: string | null
      ) => {
        quoteCacheRef.current.set(quoteCacheKey, {
          expiresAt: Date.now() + QUOTE_CACHE_TTL_MS,
          quote: nextQuote,
          toAmount: nextToAmount,
          quoteError: nextQuoteError,
        })
        while (quoteCacheRef.current.size > MAX_QUOTE_CACHE_ENTRIES) {
          const oldest = quoteCacheRef.current.keys().next().value
          if (!oldest) break
          quoteCacheRef.current.delete(oldest)
        }
      }

      try {
        if (isCrossChain) {
          setLiquidityMaxFromQuote(null)
          const response = await getBridgeQuote({
            from_chain: fromChain,
            to_chain: toChain,
            token: fromSymbol,
            to_token: toSymbol,
            amount: fromAmount,
          })
          if (isStale()) return
          let protocolFee = Number(response.fee || 0)
          let networkFee = 0
          if (fromChain === "ethereum" && toChain === "starknet" && fromSymbol.toUpperCase() === "ETH") {
            const [estimatedFeeWei, estimatedNetworkFeeWei] = await Promise.all([
              estimateStarkgateDepositFeeWei(STARKGATE_ETH_BRIDGE_ADDRESS),
              estimateEvmNetworkFeeWei(BigInt(210000)),
            ])
            if (!isStale() && estimatedFeeWei !== null) {
              protocolFee = bigintWeiToUnitNumber(estimatedFeeWei, 18)
            }
            if (!isStale() && estimatedNetworkFeeWei !== null) {
              networkFee = bigintWeiToUnitNumber(estimatedNetworkFeeWei, 18)
            }
          }
          if (isStale()) return
          const mevFee = mevProtection ? amountValue * MEV_FEE_RATE : 0
          const bridgeFee = protocolFee + networkFee + mevFee
          const estimatedReceiveRaw = Number(response.estimated_receive || 0)
          const bridgeToSwapAmount = estimatedReceiveRaw * (1 - 0.003)
          const slippageFactor = 1 - slippageValue / 100
          const bridgeProviderKey = (response.bridge_provider || "").trim().toLowerCase()
          const shouldProjectCrossTokenAmount =
            fromSymbol !== toSymbol &&
            toChain === "starknet" &&
            bridgeProviderKey !== "garden"
          const bridgeConvertedAmount =
            shouldProjectCrossTokenAmount
              ? convertAmountByUsdPrice(
                  bridgeToSwapAmount * (Number.isFinite(slippageFactor) && slippageFactor > 0 ? slippageFactor : 1),
                  fromPrice,
                  toPrice
                )
              : null
          const displayToAmount =
            shouldProjectCrossTokenAmount
              ? Number.isFinite(bridgeConvertedAmount ?? NaN)
                ? normalizeTokenAmountDisplay(bridgeConvertedAmount as number, toSymbol)
                : ""
              : normalizeTokenAmountDisplay(response.estimated_receive, toSymbol)
          const estimatedTimeLabel = normalizeEstimatedTimeLabel({
            raw: response.estimated_time,
            provider: response.bridge_provider,
            includeSwapLeg: shouldProjectCrossTokenAmount,
          })
          const bridgeQuote: QuoteState = {
            type: "bridge",
            toAmount: displayToAmount,
            fee: bridgeFee,
            feeUnit: "token",
            protocolFee,
            networkFee,
            mevFee,
            estimatedTime: estimatedTimeLabel,
            provider: response.bridge_provider,
            priceImpact:
              amountValue > 0 && fromPrice > 0 && Number.parseFloat(displayToAmount || "0") > 0 && toPrice > 0
                ? `${Math.max(
                    0,
                    ((amountValue * fromPrice - Number.parseFloat(displayToAmount || "0") * toPrice) /
                      (amountValue * fromPrice)) *
                      100
                  ).toFixed(2)}%`
                : undefined,
            bridgeSourceAmount: estimatedReceiveRaw,
            bridgeConvertedAmount: bridgeConvertedAmount ?? undefined,
          }
          const bridgeQuoteError =
            shouldProjectCrossTokenAmount && !displayToAmount
              ? "Cross-token estimate is not available yet (destination live price not loaded)."
              : null
          setToAmount(displayToAmount)
          setQuote(bridgeQuote)
          setQuoteError(bridgeQuoteError)
          setLiquidityMaxFromQuote(
            parseLiquidityMaxFromQuoteError(bridgeQuoteError || "", fromSymbol)
          )
          saveQuoteToCache(bridgeQuote, displayToAmount, bridgeQuoteError)
        } else {
          const response = await getSwapQuote({
            from_token: fromSymbol,
            to_token: toSymbol,
            amount: fromAmount,
            slippage: slippageValue,
            mode: tradeMode,
          })
          if (isStale()) return
          const onchainCalls =
            Array.isArray(response.onchain_calls) && response.onchain_calls.length > 0
              ? response.onchain_calls
                  .filter((call) => {
                    return (
                      call &&
                      typeof call.contract_address === "string" &&
                      typeof call.entrypoint === "string" &&
                      Array.isArray(call.calldata)
                    )
                  })
                  .map((call) => ({
                    contractAddress: call.contract_address.trim(),
                    entrypoint: call.entrypoint.trim(),
                    calldata: call.calldata.map((item) => String(item)),
                  }))
                  .filter(
                    (call) =>
                      !!call.contractAddress &&
                      !!call.entrypoint &&
                      call.calldata.every((item) => typeof item === "string" && item.trim().length > 0)
                  )
              : undefined
          const backendToAmountRaw = Number(response.to_amount || 0)
          const slippageFactor =
            Number.isFinite(slippageValue) && slippageValue >= 0
              ? Math.max(0, 1 - slippageValue / 100)
              : 1
          const liveReferenceToAmount = convertAmountByUsdPrice(
            amountValue * 0.997 * slippageFactor,
            fromPrice,
            toPrice
          )
          const hasLiveReference =
            Number.isFinite(liveReferenceToAmount ?? NaN) && (liveReferenceToAmount ?? 0) > 0
          const backendDeviatesTooMuch =
            hasLiveReference &&
            (!Number.isFinite(backendToAmountRaw) ||
              backendToAmountRaw <= 0 ||
              backendToAmountRaw >
                (liveReferenceToAmount as number) * (1 + LIVE_PRICE_NORMALIZATION_THRESHOLD) ||
              backendToAmountRaw <
                (liveReferenceToAmount as number) * (1 - LIVE_PRICE_NORMALIZATION_THRESHOLD))
          const normalizedByLivePrice = Boolean(backendDeviatesTooMuch)
          const normalizedToAmount = normalizedByLivePrice
            ? normalizeTokenAmountDisplay(liveReferenceToAmount as number, toSymbol)
            : normalizeTokenAmountDisplay(response.to_amount, toSymbol)
          const protocolFee = Number(response.fee || 0)
          const mevFee = mevProtection ? amountValue * MEV_FEE_RATE : 0
          const fallbackPriceImpact = `${Math.max(
            0,
            (1 - 0.997 * slippageFactor) * 100
          ).toFixed(2)}%`
          const priceImpactRaw = normalizedByLivePrice ? fallbackPriceImpact : response.price_impact
          const priceImpact =
            typeof priceImpactRaw === "number" ? priceImpactRaw.toFixed(4) : priceImpactRaw
          const swapQuote: QuoteState = {
            type: "swap",
            toAmount: normalizedToAmount,
            fee: protocolFee + mevFee,
            feeUnit: "usd",
            protocolFee,
            mevFee,
            estimatedTime:
              typeof response.estimated_time === "string" && response.estimated_time.trim().length > 0
                ? response.estimated_time.trim()
                : "~1-2 min",
            priceImpact,
            normalizedByLivePrice,
            onchainCalls,
          }
          setToAmount(swapQuote.toAmount)
          setQuote(swapQuote)
          setQuoteError(null)
          setLiquidityMaxFromQuote(null)
          saveQuoteToCache(swapQuote, swapQuote.toAmount, null)
        }
      } catch (error) {
        if (isStale()) return
        const message = error instanceof Error ? error.message : "Failed to fetch quote"
        setQuoteError(message)
        setLiquidityMaxFromQuote(parseLiquidityMaxFromQuoteError(message, fromSymbol))
        setToAmount("")
        setQuote(null)
      } finally {
        if (!isStale()) {
          setIsQuoteLoading(false)
        }
      }
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [
    fromAmount,
    bridgeToStrkDisabled,
    bridgePairSupported,
    fromChain,
    fromPrice,
    fromSymbol,
    isCrossChain,
    mevProtection,
    slippage,
    toChain,
    toPrice,
    toSymbol,
    customSlippage,
    setIsQuoteLoading,
    setLiquidityMaxFromQuote,
    setQuote,
    setQuoteError,
    setToAmount,
  ])
}
