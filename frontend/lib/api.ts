export const API_BASE_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8080").replace(/\/$/, "")
export const WS_BASE_URL = (process.env.NEXT_PUBLIC_BACKEND_WS_URL || API_BASE_URL).replace(/^http/, "ws")

export interface ApiResponse<T> {
  success: boolean
  data: T
}

export interface ConnectWalletResponse {
  token: string
  expires_in: number
  user: {
    address: string
    created_at: string
  }
}

export interface PaginatedResponse<T> {
  items: T[]
  page: number
  limit: number
  total: number
}

export interface BackendNotification {
  id: number
  user_address: string
  notif_type: string
  title: string
  message: string
  data?: Record<string, unknown> | null
  read: boolean
  created_at: string
}

export interface BalanceResponse {
  total_value_usd: number
  balances: Array<{
    token: string
    amount: number
    value_usd: number
    price: number
    change_24h: number
  }>
}

export interface AnalyticsResponse {
  portfolio: {
    total_value_usd: string
    pnl_24h: string
    pnl_7d: string
    pnl_30d: string
    pnl_all_time: string
    allocation: Array<{
      asset: string
      percentage: number
      value_usd: string
    }>
  }
  trading: {
    total_trades: number
    total_volume_usd: string
    avg_trade_size: string
    win_rate: number
    best_trade: string
    worst_trade: string
  }
  rewards: {
    total_points: string
    estimated_carel: string
    rank: number
    percentile: number
  }
}

export interface LeaderboardEntry {
  rank: number
  address: string
  display_name?: string | null
  value: number
  change_24h?: number | null
}

export interface LeaderboardResponse {
  leaderboard_type: string
  entries: LeaderboardEntry[]
  total_users: number
}

export interface SwapQuoteResponse {
  from_amount: string
  to_amount: string
  rate: string
  price_impact: string
  fee: string
  fee_usd: string
  route: string[]
  estimated_gas: string
  estimated_time: string
}

export interface ExecuteSwapResponse {
  tx_hash: string
  status: string
  from_amount: string
  to_amount: string
  actual_rate: string
  fee_paid: string
}

export interface BridgeQuoteResponse {
  from_chain: string
  to_chain: string
  amount: string
  estimated_receive: string
  fee: string
  estimated_time: string
  bridge_provider: string
}

export interface ExecuteBridgeResponse {
  bridge_id: string
  status: string
  from_chain: string
  to_chain: string
  amount: string
  estimated_receive: string
  estimated_time: string
}

export interface RewardsPointsResponse {
  current_epoch: number
  total_points: number
  swap_points: number
  bridge_points: number
  stake_points: number
  referral_points: number
  social_points: number
  multiplier: number
  nft_boost: boolean
}

export interface ReferralCodeResponse {
  code: string
  url: string
}

export interface ReferralStatsResponse {
  total_referrals: number
  active_referrals: number
  total_volume: number
  total_rewards: number
}

export interface ReferralHistoryItem {
  tx_hash: string
  user_address: string
  action: string
  volume_usd: number
  points: number
  status: string
  timestamp: string
}

export interface LimitOrderResponse {
  order_id: string
  status: string
  created_at: string
}

export interface LimitOrderItem {
  order_id: string
  owner: string
  from_token: string
  to_token: string
  amount: string
  filled: string
  price: string
  expiry: string
  recipient: string | null
  status: number
  created_at: string
}

export interface StakingPool {
  pool_id: string
  token: string
  total_staked: number
  tvl_usd: number
  apy: number
  rewards_per_day: number
  min_stake: number
  lock_period?: number | null
}

export interface StakingPosition {
  position_id: string
  pool_id: string
  token: string
  amount: number
  rewards_earned: number
  started_at: number
  unlock_at?: number | null
}

export interface AIResponse {
  response: string
  actions: string[]
  confidence: number
}

export interface PortfolioHistoryPoint {
  timestamp: number
  value: number
}

export interface PortfolioHistoryResponse {
  total_value: PortfolioHistoryPoint[]
  pnl: number
  pnl_percentage: number
}

export interface PortfolioOHLCVPoint {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface PortfolioOHLCVResponse {
  interval: string
  data: PortfolioOHLCVPoint[]
}

export interface Transaction {
  tx_hash: string
  block_number: number
  user_address: string
  tx_type: string
  token_in?: string | null
  token_out?: string | null
  amount_in?: string | number | null
  amount_out?: string | number | null
  usd_value?: string | number | null
  fee_paid?: string | number | null
  points_earned?: string | number | null
  timestamp: string
  processed: boolean
}

export interface LeaderboardUserRank {
  rank: number
  total_users: number
  percentile: number
  value: number
}

export interface LeaderboardUserCategory {
  category: string
  rank: number
  total_users: number
  percentile: number
  value: number
}

export interface LeaderboardUserCategoriesResponse {
  categories: LeaderboardUserCategory[]
}

export interface OrderBookLevel {
  price: number
  amount: number
}

export interface MarketDepthResponse {
  token: string
  bids: OrderBookLevel[]
  asks: OrderBookLevel[]
  updated_at: string
}

export interface NFTItem {
  token_id: string
  tier: number
  discount: number
  expiry: number
  used: boolean
}

export interface SocialVerifyResponse {
  verified: boolean
  points_earned: number
  message: string
}

function joinUrl(path: string) {
  if (path.startsWith("http")) return path
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {})
  headers.set("Content-Type", "application/json")
  if (typeof window !== "undefined" && !headers.has("Authorization")) {
    const token = window.localStorage.getItem("auth_token")
    if (token) {
      headers.set("Authorization", `Bearer ${token}`)
    }
  }
  const response = await fetch(joinUrl(path), {
    cache: "no-store",
    headers,
    ...init,
  })

  const text = await response.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }

  if (!response.ok) {
    const message = json?.error?.message || json?.message || "Request failed"
    throw new Error(message)
  }

  if (json && typeof json === "object" && "data" in json) {
    return json.data as T
  }

  return json as T
}

export async function getHealth() {
  return apiFetch<{ status: string; version: string; database: string; redis: string }>("/health")
}

export async function connectWallet(payload: {
  address: string
  signature: string
  message: string
  chain_id: number
  sumo_login_token?: string
}) {
  return apiFetch<ConnectWalletResponse>("/api/v1/auth/connect", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export async function getNotifications(page = 1, limit = 20) {
  return apiFetch<PaginatedResponse<BackendNotification>>(
    `/api/v1/notifications/list?page=${page}&limit=${limit}`
  )
}

export async function markNotificationsRead(ids: number[]) {
  return apiFetch<string>("/api/v1/notifications/mark-read", {
    method: "POST",
    body: JSON.stringify({ notification_ids: ids }),
  })
}

export async function getNotificationsStats() {
  return apiFetch<{ unread_count: number; total_count: number }>("/api/v1/notifications/stats")
}

export async function getPortfolioBalance() {
  return apiFetch<BalanceResponse>("/api/v1/portfolio/balance")
}

export async function getPortfolioAnalytics() {
  return apiFetch<AnalyticsResponse>("/api/v1/portfolio/analytics")
}

export async function getPortfolioHistory(period: "1d" | "7d" | "30d" | "all") {
  return apiFetch<PortfolioHistoryResponse>(`/api/v1/portfolio/history?period=${period}`)
}

export async function getPortfolioOHLCV(params: { interval: string; limit?: number }) {
  const search = new URLSearchParams({ interval: params.interval })
  if (params.limit) search.set("limit", String(params.limit))
  return apiFetch<PortfolioOHLCVResponse>(`/api/v1/portfolio/ohlcv?${search.toString()}`)
}

export async function getLeaderboard(type: "points" | "volume" | "referrals") {
  return apiFetch<LeaderboardResponse>(`/api/v1/leaderboard/${type}`)
}

export async function getLeaderboardGlobalMetrics() {
  return apiFetch<{ points_total: number; volume_total: number; referral_total: number }>(
    "/api/v1/leaderboard/global"
  )
}

export async function getLeaderboardGlobalMetricsEpoch(epoch: number) {
  return apiFetch<{ points_total: number; volume_total: number; referral_total: number }>(
    `/api/v1/leaderboard/global/${epoch}`
  )
}

export async function getLeaderboardUserRank(address: string) {
  return apiFetch<LeaderboardUserRank>(`/api/v1/leaderboard/user/${address}`)
}

export async function getLeaderboardUserCategories(address: string) {
  return apiFetch<LeaderboardUserCategoriesResponse>(`/api/v1/leaderboard/user/${address}/categories`)
}

export async function getRewardsPoints() {
  return apiFetch<RewardsPointsResponse>("/api/v1/rewards/points")
}

export async function getReferralCode() {
  return apiFetch<ReferralCodeResponse>("/api/v1/referral/code")
}

export async function getReferralStats() {
  return apiFetch<ReferralStatsResponse>("/api/v1/referral/stats")
}

export async function getReferralHistory(page = 1, limit = 10) {
  return apiFetch<PaginatedResponse<ReferralHistoryItem>>(
    `/api/v1/referral/history?page=${page}&limit=${limit}`
  )
}

export async function getTransactionsHistory(params?: {
  tx_type?: string
  from_date?: string
  to_date?: string
  page?: number
  limit?: number
}) {
  const search = new URLSearchParams()
  if (params?.tx_type) search.set("tx_type", params.tx_type)
  if (params?.from_date) search.set("from_date", params.from_date)
  if (params?.to_date) search.set("to_date", params.to_date)
  if (params?.page) search.set("page", String(params.page))
  if (params?.limit) search.set("limit", String(params.limit))
  const query = search.toString()
  return apiFetch<PaginatedResponse<Transaction>>(`/api/v1/transactions/history${query ? `?${query}` : ""}`)
}

export async function getSwapQuote(payload: {
  from_token: string
  to_token: string
  amount: string
  slippage: number
  mode: string
}) {
  return apiFetch<SwapQuoteResponse>("/api/v1/swap/quote", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export async function executeSwap(payload: {
  from_token: string
  to_token: string
  amount: string
  min_amount_out: string
  slippage: number
  deadline: number
  recipient?: string
  mode: string
}) {
  return apiFetch<ExecuteSwapResponse>("/api/v1/swap/execute", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export async function getBridgeQuote(payload: {
  from_chain: string
  to_chain: string
  token: string
  amount: string
}) {
  return apiFetch<BridgeQuoteResponse>("/api/v1/bridge/quote", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export async function executeBridge(payload: {
  from_chain: string
  to_chain: string
  token: string
  amount: string
  recipient: string
  xverse_user_id?: string
}) {
  return apiFetch<ExecuteBridgeResponse>("/api/v1/bridge/execute", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export async function listLimitOrders(page = 1, limit = 10, status?: string) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (status) params.set("status", status)
  return apiFetch<PaginatedResponse<LimitOrderItem>>(`/api/v1/limit-order/list?${params.toString()}`)
}

export async function createLimitOrder(payload: {
  from_token: string
  to_token: string
  amount: string
  price: string
  expiry: string
  recipient?: string | null
}) {
  return apiFetch<LimitOrderResponse>("/api/v1/limit-order/create", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export async function cancelLimitOrder(orderId: string) {
  return apiFetch<string>(`/api/v1/limit-order/${orderId}`, { method: "DELETE" })
}

export async function getStakePools() {
  return apiFetch<StakingPool[]>("/api/v1/stake/pools")
}

export async function getStakePositions() {
  return apiFetch<StakingPosition[]>("/api/v1/stake/positions")
}

export async function stakeDeposit(payload: { pool_id: string; amount: string }) {
  return apiFetch<{ position_id: string; tx_hash: string; amount: number }>(
    "/api/v1/stake/deposit",
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  )
}

export async function stakeWithdraw(payload: { position_id: string; amount: string }) {
  return apiFetch<{ position_id: string; tx_hash: string; amount: number }>(
    "/api/v1/stake/withdraw",
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  )
}

export async function getOwnedNfts() {
  return apiFetch<NFTItem[]>("/api/v1/nft/owned")
}

export async function mintNft(payload: { tier: number }) {
  return apiFetch<NFTItem>("/api/v1/nft/mint", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export async function claimRewards() {
  return apiFetch<{ tx_hash: string; amount_carel: number; points_converted: number }>(
    "/api/v1/rewards/claim",
    {
      method: "POST",
    }
  )
}

export async function convertRewards(payload: { points: number }) {
  return apiFetch<{ tx_hash: string; amount_carel: number; points_converted: number }>(
    "/api/v1/rewards/convert",
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  )
}

export async function getTokenOHLCV(params: { token: string; interval: string; limit?: number }) {
  const search = new URLSearchParams({ interval: params.interval })
  if (params.limit) search.set("limit", String(params.limit))
  return apiFetch<{ token: string; interval: string; data: Array<{ timestamp: string; open: string; high: string; low: string; close: string; volume: string }> }>(
    `/api/v1/chart/${params.token}/ohlcv?${search.toString()}`
  )
}

export async function getMarketDepth(token: string, limit?: number) {
  const search = new URLSearchParams()
  if (limit) search.set("limit", String(limit))
  const query = search.toString()
  return apiFetch<MarketDepthResponse>(`/api/v1/market/depth/${token}${query ? `?${query}` : ""}`)
}

export async function verifySocialTask(payload: { task_type: string; proof: string }) {
  return apiFetch<SocialVerifyResponse>("/api/v1/social/verify", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export async function executeAiCommand(payload: { command: string; context?: string }) {
  return apiFetch<AIResponse>("/api/v1/ai/execute", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}
