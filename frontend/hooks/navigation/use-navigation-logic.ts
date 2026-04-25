import * as React from "react"
import { useWallet, type WalletProviderType, type BtcWalletProviderType } from "@/hooks/wallet/use-wallet"
import { useNotificationsState } from "@/hooks/notifications/use-notifications"
import {
  claimFaucet,
  getFaucetStatus,
  getProfile,
  getTransactionsHistory,
  setDisplayName,
  type Transaction,
} from "@/lib/api"
import {
  AI_TRANSACTION_SOURCES_UPDATED_EVENT,
  loadAiTransactionSourceIds,
} from "@/lib/ai-execution-source"
import { invokeStarknetCallFromWallet } from "@/lib/onchain-trade"
import {
  BTC_TESTNET_EXPLORER_BASE_URL,
  BTC_TESTNET_FAUCET_URL,
  ETH_SEPOLIA_FAUCET_URL,
  ETHERSCAN_SEPOLIA_BASE_URL,
  STRK_FAUCET_URL,
  STARKSCAN_SEPOLIA_BASE_URL,
  formatNetworkLabel,
} from "@/lib/network-config"
import {
  CAREL_TOKEN_ADDRESS,
  DEV_WALLET_ADDRESS,
  ONE_CAREL_WEI_HEX,
  formatRelativeTime,
  parseNumber,
  type DeFiFeatureTarget,
  type FaucetStatusMap,
  type UiTx,
  type ReceiveNetworkTarget,
  type ReceiveTarget,
} from "@/lib/navigation-utils"

type UseNavigationLogicParams = {
  txHistoryOpen: boolean
  topUpOpen: boolean
  onWalletDialogClose: () => void
}

export const useNavigationLogic = ({
  txHistoryOpen,
  topUpOpen,
  onWalletDialogClose,
}: UseNavigationLogicParams) => {
  const wallet = useWallet()
  const notifications = useNotificationsState()
  const [faucetStatus, setFaucetStatus] = React.useState<FaucetStatusMap>({})
  const [faucetLoading, setFaucetLoading] = React.useState<Record<string, boolean>>({})
  const [faucetTx, setFaucetTx] = React.useState<Record<string, string>>({})
  const [copiedAddress, setCopiedAddress] = React.useState(false)
  const [copiedReceiveNetwork, setCopiedReceiveNetwork] =
    React.useState<ReceiveNetworkTarget | null>(null)
  const [activeReceiveNetwork, setActiveReceiveNetwork] =
    React.useState<ReceiveNetworkTarget>("starknet")
  const [txFilter, setTxFilter] = React.useState("all")
  const [txHistory, setTxHistory] = React.useState<UiTx[]>([])
  const [txHistoryLoading, setTxHistoryLoading] = React.useState(false)
  const [aiTxSourceVersion, setAiTxSourceVersion] = React.useState(0)
  const [walletConnectPending, setWalletConnectPending] = React.useState(false)
  const [btcConnectPending, setBtcConnectPending] = React.useState(false)
  const [displayName, setDisplayNameState] = React.useState<string | null>(null)
  const [manualBtcAddress, setManualBtcAddress] = React.useState("")
  const [btcManualLinkPending, setBtcManualLinkPending] = React.useState(false)
  const seenBtcOptionalNoticeRef = React.useRef<Set<string>>(new Set())

  const effectiveStarknetAddress =
    wallet.starknetAddress || (wallet.network === "starknet" ? wallet.address : null)

  const receiveTargets = React.useMemo<ReceiveTarget[]>(
    () => [
      {
        key: "starknet" as const,
        label: "Starknet Sepolia",
        chainHint: "STRK / CAREL / USDC / USDT / WBTC",
        address: effectiveStarknetAddress || "",
        explorerLabel: "Voyager",
        explorerUrl: effectiveStarknetAddress
          ? `${STARKSCAN_SEPOLIA_BASE_URL}/contract/${effectiveStarknetAddress}`
          : "",
      },
      {
        key: "evm" as const,
        label: "ETH Sepolia",
        chainHint: "ETH",
        address: wallet.evmAddress || "",
        explorerLabel: "Etherscan",
        explorerUrl: wallet.evmAddress
          ? `${ETHERSCAN_SEPOLIA_BASE_URL}/address/${wallet.evmAddress}`
          : "",
      },
      {
        key: "btc" as const,
        label: "BTC Testnet4",
        chainHint: "BTC",
        address: wallet.btcAddress || "",
        explorerLabel: "Mempool",
        explorerUrl: wallet.btcAddress
          ? `${BTC_TESTNET_EXPLORER_BASE_URL}/address/${wallet.btcAddress}`
          : "",
      },
    ],
    [effectiveStarknetAddress, wallet.btcAddress, wallet.evmAddress]
  )

  const selectedReceiveTarget =
    receiveTargets.find((target) => target.key === activeReceiveNetwork) || receiveTargets[0]
  const selectedReceiveFaucetUrl =
    selectedReceiveTarget.key === "starknet"
      ? STRK_FAUCET_URL
      : selectedReceiveTarget.key === "evm"
      ? ETH_SEPOLIA_FAUCET_URL
      : BTC_TESTNET_FAUCET_URL

  const connectedTestnets = React.useMemo(() => {
    const labels: string[] = []
    if (effectiveStarknetAddress) labels.push(formatNetworkLabel("starknet"))
    if (wallet.evmAddress) labels.push(formatNetworkLabel("evm"))
    if (wallet.btcAddress) labels.push(formatNetworkLabel("btc"))
    return labels
  }, [effectiveStarknetAddress, wallet.evmAddress, wallet.btcAddress])

  const connectedTestnetSummary =
    connectedTestnets.length > 0
      ? `Connected to ${connectedTestnets.join(" + ")}`
      : "Connected, but no testnet wallet linked yet."
  const primaryConnectedTestnet = React.useMemo(() => {
    if (effectiveStarknetAddress) return formatNetworkLabel("starknet")
    if (wallet.evmAddress) return formatNetworkLabel("evm")
    if (wallet.btcAddress) return formatNetworkLabel("btc")
    return "Testnet"
  }, [effectiveStarknetAddress, wallet.evmAddress, wallet.btcAddress])
  const networkStatusHeadline = React.useMemo(() => {
    if (primaryConnectedTestnet === "Testnet") {
      return "Connected, no testnet wallet linked yet."
    }
    return `Connected to ${primaryConnectedTestnet}`
  }, [primaryConnectedTestnet])

  React.useEffect(() => {
    if (!topUpOpen) return
    const currentTarget = receiveTargets.find((target) => target.key === activeReceiveNetwork)
    if (currentTarget?.address) return
    const firstReadyTarget = receiveTargets.find((target) => Boolean(target.address))
    if (firstReadyTarget) {
      setActiveReceiveNetwork(firstReadyTarget.key)
    }
  }, [topUpOpen, activeReceiveNetwork, receiveTargets])

  const hasStarknetBalanceSource = Boolean(effectiveStarknetAddress)
  const preferOnchainOrBackend = React.useCallback(
    (onchainValue: number | null | undefined, backendValue: number | undefined) => {
      if (typeof onchainValue === "number" && Number.isFinite(onchainValue) && onchainValue > 0) {
        return onchainValue
      }
      return backendValue ?? 0
    },
    []
  )
  const effectivePortfolioBalance = React.useMemo(
    () => ({
      BTC:
        wallet.btcAddress &&
        wallet.onchainBalance?.BTC !== null &&
        wallet.onchainBalance?.BTC !== undefined
          ? wallet.onchainBalance.BTC
          : wallet.balance?.BTC ?? 0,
      ETH:
        wallet.evmAddress &&
        wallet.onchainBalance?.ETH !== null &&
        wallet.onchainBalance?.ETH !== undefined
          ? wallet.onchainBalance.ETH
          : wallet.balance?.ETH ?? 0,
      STRK:
        hasStarknetBalanceSource
          ? preferOnchainOrBackend(wallet.onchainBalance?.STRK_L2, wallet.balance?.STRK)
          : wallet.evmAddress &&
            wallet.onchainBalance?.STRK_L1 !== null &&
            wallet.onchainBalance?.STRK_L1 !== undefined
          ? wallet.onchainBalance.STRK_L1
          : wallet.balance?.STRK ?? 0,
      CAREL:
        hasStarknetBalanceSource
          ? preferOnchainOrBackend(wallet.onchainBalance?.CAREL, wallet.balance?.CAREL)
          : wallet.balance?.CAREL ?? 0,
      USDC:
        hasStarknetBalanceSource
          ? preferOnchainOrBackend(wallet.onchainBalance?.USDC, wallet.balance?.USDC)
          : wallet.balance?.USDC ?? 0,
      USDT:
        hasStarknetBalanceSource
          ? preferOnchainOrBackend(wallet.onchainBalance?.USDT, wallet.balance?.USDT)
          : wallet.balance?.USDT ?? 0,
      WBTC:
        hasStarknetBalanceSource
          ? preferOnchainOrBackend(wallet.onchainBalance?.WBTC, wallet.balance?.WBTC)
          : wallet.balance?.WBTC ?? 0,
    }),
    [
      wallet.balance?.BTC,
      wallet.balance?.CAREL,
      wallet.balance?.ETH,
      wallet.balance?.STRK,
      wallet.balance?.USDC,
      wallet.balance?.USDT,
      wallet.balance?.WBTC,
      wallet.btcAddress,
      wallet.evmAddress,
      wallet.onchainBalance?.BTC,
      wallet.onchainBalance?.CAREL,
      wallet.onchainBalance?.ETH,
      wallet.onchainBalance?.STRK_L1,
      wallet.onchainBalance?.STRK_L2,
      wallet.onchainBalance?.USDC,
      wallet.onchainBalance?.USDT,
      wallet.onchainBalance?.WBTC,
      hasStarknetBalanceSource,
      preferOnchainOrBackend,
    ]
  )

  const shouldEmitBtcOptionalNotice = React.useCallback((message: string) => {
    if (seenBtcOptionalNoticeRef.current.has(message)) {
      return false
    }
    seenBtcOptionalNoticeRef.current.add(message)
    return true
  }, [])

  React.useEffect(() => {
    const handleAiTxSourceUpdated = () => {
      setAiTxSourceVersion((current) => current + 1)
    }
    window.addEventListener(AI_TRANSACTION_SOURCES_UPDATED_EVENT, handleAiTxSourceUpdated)
    return () => {
      window.removeEventListener(AI_TRANSACTION_SOURCES_UPDATED_EVENT, handleAiTxSourceUpdated)
    }
  }, [])

  React.useEffect(() => {
    if (!wallet.isConnected || !effectiveStarknetAddress) {
      setFaucetStatus({})
      return
    }
    let active = true
    ;(async () => {
      try {
        const response = await getFaucetStatus({
          starknetAddress: effectiveStarknetAddress,
        })
        if (!active) return
        const mapped: FaucetStatusMap = {}
        response.tokens.forEach((token) => {
          mapped[token.token] = {
            can_claim: token.can_claim,
            next_claim_at: token.next_claim_at,
            last_claim_at: token.last_claim_at,
          }
        })
        setFaucetStatus(mapped)
      } catch {
        if (!active) return
        setFaucetStatus({})
      }
    })()

    return () => {
      active = false
    }
  }, [wallet.isConnected, wallet.token, effectiveStarknetAddress])

  React.useEffect(() => {
    if (!txHistoryOpen || !wallet.isConnected) return
    let active = true
    setTxHistoryLoading(true)
    ;(async () => {
      try {
        const response = await getTransactionsHistory({ page: 1, limit: 20 })
        if (!active) return
        const aiTxSourceIds = loadAiTransactionSourceIds()
        const mapped: UiTx[] = response.items.map((tx: Transaction) => {
          const amountValue = parseNumber(tx.amount_in || tx.amount_out || 0)
          const usdValue = parseNumber(tx.usd_value)
          const normalizedTxHash = String(tx.tx_hash || "").trim().toLowerCase()
          return {
            id: tx.tx_hash,
            type: tx.tx_type,
            status: tx.processed ? "completed" : "pending",
            from: tx.token_in || tx.tx_type,
            to: tx.token_out || "",
            amount: amountValue ? amountValue.toString() : "—",
            value: usdValue ? `$${usdValue.toLocaleString()}` : "—",
            time: formatRelativeTime(tx.timestamp),
            txHash: tx.tx_hash,
            txNetwork:
              tx.tx_type === "bridge"
                ? String(tx.token_in || "").toUpperCase() === "ETH"
                  ? "evm"
                  : String(tx.token_in || "").toUpperCase() === "BTC"
                  ? "btc"
                  : "starknet"
                : "starknet",
            requestSource: aiTxSourceIds.has(normalizedTxHash) ? "ai" : "manual",
          }
        })
        setTxHistory(mapped)
      } catch {
        if (!active) return
        setTxHistory([])
      } finally {
        if (active) setTxHistoryLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [
    txHistoryOpen,
    wallet.isConnected,
    wallet.totalValueUSD,
    wallet.balance?.STRK,
    wallet.balance?.CAREL,
    wallet.balance?.USDC,
    wallet.balance?.USDT,
    wallet.balance?.WBTC,
    aiTxSourceVersion,
  ])

  React.useEffect(() => {
    if (!wallet.isConnected) {
      setDisplayNameState(null)
      return
    }
    let active = true
    ;(async () => {
      try {
        const profile = await getProfile()
        if (!active) return
        setDisplayNameState(profile.display_name || null)
      } catch {
        if (!active) return
        setDisplayNameState(null)
      }
    })()
    return () => {
      active = false
    }
  }, [wallet.isConnected, wallet.token, wallet.address])

  const handleWalletConnect = async (provider: WalletProviderType) => {
    if (walletConnectPending) return
    setWalletConnectPending(true)
    try {
      await wallet.connect(provider)
      onWalletDialogClose()
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "Wallet connection failed",
        message: error instanceof Error ? error.message : "Unable to connect wallet",
      })
    } finally {
      setWalletConnectPending(false)
    }
  }

  const handleBtcConnect = async (provider: BtcWalletProviderType) => {
    if (btcConnectPending) return
    setBtcConnectPending(true)
    try {
      await wallet.connectBtcWallet(provider)
      notifications.addNotification({
        type: "success",
        title: "BTC wallet connected",
        message: `Connected ${provider.toUpperCase()} wallet.`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to connect BTC wallet"
      const missingExtension = message.toLowerCase().includes("extension not detected")
      if (missingExtension) {
        const optionalMessage = `${message} For STRK/ETH trading, continue with MetaMask + Braavos/ArgentX without BTC wallet, or manually link a BTC testnet address in the wallet panel.`
        if (shouldEmitBtcOptionalNotice(optionalMessage)) {
          notifications.addNotification({
            type: "warning",
            title: "BTC wallet optional",
            message: optionalMessage,
          })
        }
      } else {
        notifications.addNotification({
          type: "error",
          title: "BTC wallet connection failed",
          message,
        })
      }
    } finally {
      setBtcConnectPending(false)
    }
  }

  const handleSetDisplayName = async () => {
    if (!wallet.isConnected) {
      notifications.addNotification({
        type: "error",
        title: "Wallet not connected",
        message: "Connect wallet first before changing display name.",
      })
      return
    }

    const initial = displayName || ""
    const input = window.prompt(
      "Enter a new display name (3-24 chars, letters/numbers/_/-). The second change onward costs 1 CAREL on-chain.",
      initial
    )
    const nextName = (input || "").trim()
    if (!nextName) return

    try {
      const saved = await setDisplayName({ display_name: nextName })
      setDisplayNameState(saved.display_name || nextName)
      notifications.addNotification({
        type: "success",
        title: "Display name updated",
        message: `Name saved: ${saved.display_name || nextName}`,
      })
      return
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update display name."
      const needsPayment =
        /requires 1 CAREL|rename_onchain_tx_hash|payment to DEV wallet/i.test(message)
      if (!needsPayment) {
        notifications.addNotification({
          type: "error",
          title: "Update failed",
          message,
        })
        return
      }
    }

    if (!DEV_WALLET_ADDRESS || !CAREL_TOKEN_ADDRESS) {
      notifications.addNotification({
        type: "error",
        title: "Config missing",
        message: "NEXT_PUBLIC_DEV_WALLET_ADDRESS / NEXT_PUBLIC_TOKEN_CAREL_ADDRESS is not set.",
      })
      return
    }

    const providerHint =
      wallet.provider === "argentx" || wallet.provider === "braavos"
        ? wallet.provider
        : "starknet"

    try {
      notifications.addNotification({
        type: "info",
        title: "Wallet signature required",
        message: "Confirm 1 CAREL transfer to change display name.",
      })
      const txHash = await invokeStarknetCallFromWallet(
        {
          contractAddress: CAREL_TOKEN_ADDRESS,
          entrypoint: "transfer",
          calldata: [DEV_WALLET_ADDRESS, ONE_CAREL_WEI_HEX, "0x0"],
        },
        providerHint
      )
      notifications.addNotification({
        type: "info",
        title: "Rename fee pending",
        message: `Transfer 1 CAREL submitted (${txHash.slice(0, 10)}...).`,
        txHash,
        txNetwork: "starknet",
      })

      const saved = await setDisplayName({
        display_name: nextName,
        rename_onchain_tx_hash: txHash,
      })
      setDisplayNameState(saved.display_name || nextName)
      notifications.addNotification({
        type: "success",
        title: "Display name updated",
        message: `Name updated: ${saved.display_name || nextName}`,
        txHash,
        txNetwork: "starknet",
      })
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "Rename failed",
        message: error instanceof Error ? error.message : "Failed to change display name.",
      })
    }
  }

  const handleManualBtcLink = async () => {
    if (btcManualLinkPending) return
    setBtcManualLinkPending(true)
    try {
      await wallet.linkBtcAddress(manualBtcAddress)
      notifications.addNotification({
        type: "success",
        title: "BTC address linked",
        message: "Bitcoin testnet address linked successfully.",
      })
      setManualBtcAddress("")
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "Failed to link BTC address",
        message: error instanceof Error ? error.message : "Unable to link BTC address",
      })
    } finally {
      setBtcManualLinkPending(false)
    }
  }

  const openExternalFaucet = React.useCallback((url: string) => {
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer")
    }
  }, [])

  const handleClaimFaucet = async (symbol: string) => {
    if (!wallet.isConnected) {
      notifications.addNotification({
        type: "error",
        title: "Wallet not connected",
        message: "Connect your wallet to claim faucet tokens.",
      })
      return
    }
    if (!effectiveStarknetAddress) {
      notifications.addNotification({
        type: "warning",
        title: "Starknet wallet required",
        message: "Connect or link your Starknet wallet first.",
      })
      return
    }

    const status = faucetStatus[symbol]
    const statusKnown = typeof status?.can_claim === "boolean"
    const canClaimByStatus = statusKnown ? Boolean(status?.can_claim) : true
    if (!canClaimByStatus || faucetLoading[symbol]) return

    setFaucetLoading((prev) => ({ ...prev, [symbol]: true }))
    try {
      const result = await claimFaucet(symbol, {
        starknetAddress: effectiveStarknetAddress,
      })
      const txHash = result.tx_hash
      if (txHash) {
        setFaucetTx((prev) => ({ ...prev, [symbol]: txHash }))
      }
      const shortTx =
        typeof txHash === "string" && txHash.length > 12
          ? `${txHash.slice(0, 8)}...${txHash.slice(-6)}`
          : txHash
      notifications.addNotification({
        type: "success",
        title: "Token faucet masuk",
        message: `Berhasil claim ${result.amount} ${result.token}. Tx: ${shortTx || "N/A"}.`,
        txHash,
        txNetwork: txHash ? "starknet" : undefined,
      })

      const nextClaimAt = result.next_claim_in
        ? new Date(Date.now() + result.next_claim_in * 1000).toISOString()
        : undefined
      setFaucetStatus((prev) => ({
        ...prev,
        [symbol]: {
          ...(prev[symbol] || { can_claim: false }),
          can_claim: false,
          next_claim_at: nextClaimAt,
        },
      }))

      await Promise.allSettled([wallet.refreshPortfolio(), wallet.refreshOnchainBalances()])
    } catch (error) {
      notifications.addNotification({
        type: "error",
        title: "Faucet failed",
        message: error instanceof Error ? error.message : "Failed to claim faucet.",
      })
    } finally {
      setFaucetLoading((prev) => ({ ...prev, [symbol]: false }))
    }
  }

  const copyAddress = () => {
    if (wallet?.address) {
      navigator.clipboard.writeText(wallet.address)
      setCopiedAddress(true)
      setTimeout(() => setCopiedAddress(false), 2000)
    }
  }

  const copyReceiveAddress = (target: ReceiveNetworkTarget) => {
    const selected = receiveTargets.find((item) => item.key === target)
    if (!selected?.address) return
    navigator.clipboard.writeText(selected.address)
    setCopiedReceiveNetwork(target)
    setTimeout(() => setCopiedReceiveNetwork(null), 2000)
  }

  const openDeFiFeature = (feature: DeFiFeatureTarget) => {
    if (typeof window === "undefined") return
    const hashByFeature: Record<DeFiFeatureTarget, string> = {
      "swap-bridge": "#trade",
      "limit-order": "#limit-order",
      "stake-earn": "#stake",
    }
    const targetHash = hashByFeature[feature]
    window.dispatchEvent(new CustomEvent("carel:open-feature", { detail: feature }))
    if (window.location.pathname !== "/") {
      window.location.href = `/${targetHash}`
      return
    }
    if (window.location.hash !== targetHash) {
      window.location.hash = targetHash
    }
    setTimeout(() => {
      const section = document.querySelector(targetHash) as HTMLElement | null
      const panel = document.getElementById("feature-panel")
      ;(section || panel)?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 120)
  }

  return {
    wallet,
    notifications,
    faucetStatus,
    faucetLoading,
    faucetTx,
    copiedAddress,
    copiedReceiveNetwork,
    activeReceiveNetwork,
    setActiveReceiveNetwork,
    txFilter,
    setTxFilter,
    txHistory,
    txHistoryLoading,
    walletConnectPending,
    btcConnectPending,
    displayName,
    manualBtcAddress,
    setManualBtcAddress,
    btcManualLinkPending,
    effectiveStarknetAddress,
    receiveTargets,
    selectedReceiveTarget,
    selectedReceiveFaucetUrl,
    connectedTestnetSummary,
    primaryConnectedTestnet,
    networkStatusHeadline,
    effectivePortfolioBalance,
    handleWalletConnect,
    handleBtcConnect,
    handleSetDisplayName,
    handleManualBtcLink,
    handleClaimFaucet,
    openExternalFaucet,
    copyAddress,
    copyReceiveAddress,
    openDeFiFeature,
  }
}
