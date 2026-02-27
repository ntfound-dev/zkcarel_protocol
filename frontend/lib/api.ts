import { ApiError } from "@/lib/errors"
import { emitEvent } from "@/lib/events"

export const API_BASE_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8080").replace(/\/$/, "")
export const WS_BASE_URL = (process.env.NEXT_PUBLIC_BACKEND_WS_URL || API_BASE_URL).replace(/^http/, "ws")

export interface ApiResponse<T> {
  success: boolean
  data: T
}

export type NumericLike = number | string

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
    total_value_usd: NumericLike
    pnl_24h: NumericLike
    pnl_7d: NumericLike
    pnl_30d: NumericLike
    pnl_all_time: NumericLike
    allocation: Array<{
      asset: string
      percentage: number
      value_usd: NumericLike
    }>
  }
  trading: {
    total_trades: number
    total_volume_usd: NumericLike
    avg_trade_size: NumericLike
    win_rate: number
    best_trade: NumericLike
    worst_trade: NumericLike
  }
  rewards: {
    total_points: NumericLike
    estimated_carel: NumericLike
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
  onchain_calls?: StarknetWalletCall[]
}

export interface StarknetWalletCall {
  contract_address: string
  entrypoint: string
  calldata: string[]
}

export interface ExecuteSwapResponse {
  tx_hash: string
  status: string
  from_amount: string
  to_amount: string
  actual_rate: string
  fee_paid: string
  fee_before_discount: string
  fee_discount_saved: string
  nft_discount_percent: string
  estimated_points_earned: string
  points_pending: boolean
  privacy_tx_hash?: string
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
  fee_before_discount: string
  // Optional for backward compatibility when frontend talks to older backend payloads.
  fee_discount_saved?: string
  nft_discount_percent?: string
  estimated_points_earned?: string
  points_pending?: boolean
  ai_level_points_bonus_percent?: string
  privacy_tx_hash?: string
  deposit_address?: string
  deposit_amount?: string
  evm_approval_transaction?: {
    to: string
    value: string
    data: string
    chain_id?: number
    gas_limit?: number
  }
  evm_initiate_transaction?: {
    to: string
    value: string
    data: string
    chain_id?: number
    gas_limit?: number
  }
  starknet_approval_transaction?: {
    to: string
    selector: string
    calldata: string[]
  }
  starknet_initiate_transaction?: {
    to: string
    selector: string
    calldata: string[]
  }
}

export interface BridgeStatusResponse {
  bridge_id: string
  status: string
  is_completed: boolean
  version?: string
  source_initiate_tx_hash?: string
  source_redeem_tx_hash?: string
  destination_initiate_tx_hash?: string
  destination_redeem_tx_hash?: string
}

export interface GardenStringMetricResponse {
  status: "Ok" | "Error"
  result: string
  error?: string | null
}

export interface GardenListResponse<T = unknown> {
  status: "Ok" | "Error"
  result: T[]
  error?: string | null
}

export interface GardenObjectResponse<T = unknown> {
  status: "Ok" | "Error"
  result: T
  error?: string | null
}

export interface GardenLiquidityResponse {
  status: "Ok" | "Error"
  result: Array<{
    solver_id: string
    liquidity: unknown[]
  }>
  error?: string | null
}

export interface GardenOrdersPage {
  data: unknown[]
  page: number
  total_pages: number
  total_items: number
  per_page: number
}

export interface RewardsPointsResponse {
  current_epoch: number
  total_points: number
  global_epoch_points?: number
  estimated_reward_carel?: number
  swap_points: number
  bridge_points: number
  stake_points: number
  referral_points: number
  social_points: number
  multiplier: number
  nft_boost: boolean
  onchain_points?: number
  onchain_starknet_address?: string
  distribution_mode?: string
  distribution_label?: string
  distribution_pool_carel?: number
  claim_fee_percent?: number
  claim_fee_management_percent?: number
  claim_fee_dev_percent?: number
  claim_net_percent?: number
}

export interface RewardsOnchainSyncResponse {
  current_epoch: number
  starknet_address: string
  offchain_points: number
  required_points: number
  onchain_points_before: number
  onchain_points_after: number
  synced_delta: number
  sync_tx_hash?: string | null
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
  nft_discount_percent?: string
  estimated_points_earned?: string
  points_pending?: boolean
  privacy_tx_hash?: string
}

export interface StakeDepositResponse {
  position_id: string
  tx_hash: string
  amount: number
  nft_discount_percent?: string
  estimated_points_earned?: string
  points_pending?: boolean
  privacy_tx_hash?: string
}

export interface LimitOrderItem {
  order_id: string
  owner: string
  from_token: string
  to_token: string
  amount: NumericLike
  filled: NumericLike
  price: NumericLike
  expiry: string
  recipient: string | null
  status: number
  created_at: string
}

export interface BattleshipCell {
  x: number
  y: number
}

export interface BattleshipShotRecord {
  shooter: string
  x: number
  y: number
  is_hit: boolean
  timestamp: number
  tx_hash?: string | null
}

export interface BattleshipPendingShot {
  shooter: string
  x: number
  y: number
}

export interface BattleshipGameActionResponse {
  game_id: string
  status: string
  message: string
  tx_hash?: string
  onchain_calls?: StarknetWalletCall[]
  requires_wallet_signature?: boolean
}

export interface BattleshipFireShotResponse {
  game_id: string
  status: string
  message: string
  is_hit?: boolean | null
  pending_response: boolean
  next_turn?: string | null
  winner?: string | null
  tx_hash?: string
  onchain_calls?: StarknetWalletCall[]
  requires_wallet_signature?: boolean
}

export interface BattleshipGameStateResponse {
  game_id: string
  status: "WAITING" | "PLAYING" | "FINISHED" | string
  creator: string
  player_a: string
  player_b?: string | null
  current_turn?: string | null
  winner?: string | null
  your_address: string
  your_ready: boolean
  opponent_ready: boolean
  your_hits_taken: number
  opponent_hits_taken: number
  your_board: BattleshipCell[]
  your_shots: BattleshipCell[]
  opponent_shots: BattleshipCell[]
  shot_history: BattleshipShotRecord[]
  timeout_in_seconds?: number | null
  pending_shot?: BattleshipPendingShot | null
  can_respond?: boolean
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
  available?: boolean
  status_message?: string | null
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
  level?: number
  data?: Record<string, unknown> | null
}

export interface PendingActionsResponse {
  pending: number[]
}

export interface AiRuntimeConfigResponse {
  executor_configured: boolean
  executor_address?: string | null
}

export interface AiExecutorReadyResponse {
  ready: boolean
  burner_role_granted: boolean
  updated_onchain: boolean
  tx_hash?: string | null
  message: string
}

export interface PrepareAiActionResponse {
  action_type: number
  params: string
  nonce: number
  message_hash: string
  typed_data: Record<string, unknown>
}

export interface AiLevelResponse {
  current_level: number
  max_level: number
  next_level?: number | null
  next_upgrade_cost_carel?: string | null
  payment_address_configured?: boolean
  payment_address?: string | null
  burn_address_configured: boolean
  burn_address?: string | null
}

export interface AiUpgradeLevelResponse {
  previous_level: number
  current_level: number
  target_level: number
  burned_carel: string
  onchain_tx_hash: string
  block_number: number
}

export interface PrivacySubmitResponse {
  tx_hash: string
}

export interface PrivacyAutoSubmitResponse {
  payload: {
    verifier: string
    nullifier: string
    commitment: string
    recipient?: string
    root?: string
    note_version?: string
    note_commitment?: string
    denom_id?: string
    spendable_at_unix?: number
    proof: string[]
    public_inputs: string[]
  }
  tx_hash?: string
}

export interface PrivacyPreparePrivateExecutionResponse {
  payload: {
    verifier: string
    nullifier: string
    commitment: string
    recipient?: string
    root?: string
    note_version?: string
    note_commitment?: string
    denom_id?: string
    spendable_at_unix?: number
    proof: string[]
    public_inputs: string[]
  }
  intent_hash: string
  onchain_calls: StarknetWalletCall[]
  relayer?: {
    user: string
    token: string
    amount_low: string
    amount_high: string
    signature_selector: string
    submit_selector: string
    execute_selector: string
    nullifier: string
    commitment: string
    action_selector: string
    nonce: string
    deadline: number
    proof: string[]
    public_inputs: string[]
    action_calldata: string[]
    message_hash: string
  }
}

export interface PrivacyRelayerExecuteResponse {
  tx_hash: string
}

export type PrivacyRelayerExecutePayload = {
  user: string
  token: string
  amount_low: string
  amount_high: string
  signature: string[]
  signature_selector: string
  submit_selector: string
  execute_selector: string
  nullifier: string
  commitment: string
  action_selector: string
  nonce: string
  deadline: number
  proof: string[]
  public_inputs: string[]
  action_calldata: string[]
}

export type PrivacyVerificationPayload = {
  verifier?: string
  note_version?: string
  root?: string
  nullifier?: string
  commitment?: string
  recipient?: string
  note_commitment?: string
  denom_id?: string
  spendable_at_unix?: number
  proof?: string[]
  public_inputs?: string[]
}

export type PrivacyActionPayload = {
  // V2
  action_type?: string
  old_root?: string
  new_root?: string
  nullifiers?: string[]
  commitments?: string[]
  // V1
  nullifier?: string
  commitment?: string
  // Shared
  proof: string[]
  public_inputs: string[]
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
  max_usage?: number
  used_in_period?: number
  remaining_usage?: number
}

export interface SocialVerifyResponse {
  verified: boolean
  points_earned: number
  message: string
}

export interface SocialTaskItem {
  id: string
  title: string
  description: string
  points: number
  provider: "twitter" | "telegram" | "discord" | string
}

export interface ProfileResponse {
  address: string
  display_name?: string | null
  referrer?: string | null
}

export interface FaucetTokenStatus {
  token: string
  can_claim: boolean
  next_claim_at?: string | null
  last_claim_at?: string | null
}

export interface FaucetStatusResponse {
  tokens: FaucetTokenStatus[]
}

export interface FaucetClaimResponse {
  token: string
  amount: number
  tx_hash: string
  next_claim_in: number
}

export interface OnchainBalancesResponse {
  strk_l2?: number | null
  strk_l1?: number | null
  eth?: number | null
  btc?: number | null
  carel?: number | null
  usdc?: number | null
  usdt?: number | null
  wbtc?: number | null
}

export interface LinkedWalletsResponse {
  starknet_address?: string | null
  evm_address?: string | null
  btc_address?: string | null
}

/**
 * Runs `joinUrl` as part of the frontend API client workflow.
 *
 * @param path - Input used to compute or dispatch the `joinUrl` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function joinUrl(path: string) {
  if (path.startsWith("http")) return path
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`
}

type ApiFetchOptions = RequestInit & {
  timeoutMs?: number
  context?: string
  suppressErrorNotification?: boolean
  _authRetry?: boolean
}

type BattleshipRequestOptions = {
  starknetAddress?: string
}

const DEFAULT_TIMEOUT_MS = 15000
const SLOW_READ_TIMEOUT_MS = 60000
const AUTH_TOKEN_STORAGE_KEY = "auth_token"
const WALLET_ADDRESS_STORAGE_KEY = "wallet_address"
const WALLET_NETWORK_STORAGE_KEY = "wallet_network"
const STARKNET_ADDRESS_STORAGE_KEY = "wallet_address_starknet"
const STARKNET_ADDRESS_HEADER = "X-Starknet-Address"
const AUTH_EXPIRED_EMIT_DEDUPE_MS = 5000
const INVALID_TOKEN_MESSAGE_REGEX = /invalid or expired token|invalid token|token expired|jwt/i
const SHARED_READ_CACHE_TTL_MS = 8000
const SHARED_ONCHAIN_CACHE_TTL_MS = 6000

type TimedCacheEntry<T> = {
  expiresAt: number
  data: T
}

let refreshTokenInFlight: Promise<string | null> | null = null
let lastAuthExpiredEmitAt = 0
const notificationsInFlight = new Map<string, Promise<PaginatedResponse<BackendNotification>>>()
const notificationsCache = new Map<string, TimedCacheEntry<PaginatedResponse<BackendNotification>>>()
let portfolioBalanceInFlight: Promise<BalanceResponse> | null = null
let portfolioBalanceCache: TimedCacheEntry<BalanceResponse> | null = null
let portfolioAnalyticsInFlight: Promise<AnalyticsResponse> | null = null
let portfolioAnalyticsCache: TimedCacheEntry<AnalyticsResponse> | null = null
const portfolioOhlcvInFlight = new Map<string, Promise<PortfolioOHLCVResponse>>()
const portfolioOhlcvCache = new Map<string, TimedCacheEntry<PortfolioOHLCVResponse>>()
let rewardsPointsInFlight: Promise<RewardsPointsResponse> | null = null
let rewardsPointsCache: TimedCacheEntry<RewardsPointsResponse> | null = null
const leaderboardInFlight = new Map<string, Promise<LeaderboardResponse>>()
const leaderboardCache = new Map<string, TimedCacheEntry<LeaderboardResponse>>()
let stakePoolsInFlight: Promise<StakingPool[]> | null = null
let stakePoolsCache: TimedCacheEntry<StakingPool[]> | null = null
const limitOrdersInFlight = new Map<string, Promise<PaginatedResponse<LimitOrderItem>>>()
const limitOrdersCache = new Map<string, TimedCacheEntry<PaginatedResponse<LimitOrderItem>>>()
let ownedNftsInFlight: Promise<NFTItem[]> | null = null
let ownedNftsCache: TimedCacheEntry<NFTItem[]> | null = null
const onchainBalancesInFlight = new Map<string, Promise<OnchainBalancesResponse>>()
const onchainBalancesCache = new Map<string, TimedCacheEntry<OnchainBalancesResponse>>()
const leaderboardUserCategoriesInFlight = new Map<
  string,
  Promise<LeaderboardUserCategoriesResponse>
>()
const leaderboardUserCategoriesCache = new Map<
  string,
  TimedCacheEntry<LeaderboardUserCategoriesResponse>
>()

/**
 * Runs `getStoredAuthToken` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function getStoredAuthToken() {
  if (typeof window === "undefined") return null
  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)
}

// Internal helper that supports `getStoredActiveStarknetAddress` operations.
function getStoredActiveStarknetAddress() {
  if (typeof window === "undefined") return null
  const explicit = (window.localStorage.getItem(STARKNET_ADDRESS_STORAGE_KEY) || "").trim()
  if (explicit) return explicit
  const network = (window.localStorage.getItem(WALLET_NETWORK_STORAGE_KEY) || "").trim().toLowerCase()
  if (network !== "starknet") return null
  const fallback = (window.localStorage.getItem(WALLET_ADDRESS_STORAGE_KEY) || "").trim()
  return fallback || null
}

// Internal helper that supports `buildStarknetAddressHeader` operations.
function buildStarknetAddressHeader(starknetAddress?: string) {
  const explicit = (starknetAddress || "").trim()
  if (!explicit) return undefined
  return { [STARKNET_ADDRESS_HEADER]: explicit }
}

/**
 * Runs `setStoredAuthToken` as part of the frontend API client workflow.
 *
 * @param token - Input used to compute or dispatch the `setStoredAuthToken` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function setStoredAuthToken(token: string) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token)
}

/**
 * Runs `clearStoredAuthToken` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function clearStoredAuthToken() {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY)
}

/**
 * Parses or transforms values for `normalizeAddressCacheKey`.
 *
 * @param value - Input used by `normalizeAddressCacheKey` to compute state, payload, or request behavior.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function normalizeAddressCacheKey(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Runs `tokenFromAuthorizationHeader` as part of the frontend API client workflow.
 *
 * @param headerValue - Input used to compute or dispatch the `tokenFromAuthorizationHeader` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function tokenFromAuthorizationHeader(headerValue: string | null) {
  if (!headerValue) return null
  const matched = headerValue.match(/^Bearer\s+(.+)$/i)
  return matched?.[1]?.trim() || null
}

/**
 * Runs `isInvalidOrExpiredAuth` as part of the frontend API client workflow.
 *
 * @param status - Input used to compute or dispatch the `isInvalidOrExpiredAuth` operation.
 * @param message - Input used to compute or dispatch the `isInvalidOrExpiredAuth` operation.
 * @param hasAuthorizationHeader - Input used to compute or dispatch the `isInvalidOrExpiredAuth` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function isInvalidOrExpiredAuth(status: number, message: string, hasAuthorizationHeader: boolean) {
  return status === 401 && hasAuthorizationHeader && INVALID_TOKEN_MESSAGE_REGEX.test(message)
}

/**
 * Runs `emitAuthExpired` as part of the frontend API client workflow.
 *
 * @param message - Input used to compute or dispatch the `emitAuthExpired` operation.
 * @param path - Input used to compute or dispatch the `emitAuthExpired` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
function emitAuthExpired(message: string, path: string) {
  const now = Date.now()
  if (now - lastAuthExpiredEmitAt < AUTH_EXPIRED_EMIT_DEDUPE_MS) return
  lastAuthExpiredEmitAt = now
  emitEvent("auth:expired", {
    reason: "invalid_or_expired_token",
    message,
    path,
  })
}

/**
 * Runs `requestTokenRefresh` as part of the frontend API client workflow.
 *
 * @param refreshToken - Input used to compute or dispatch the `requestTokenRefresh` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
async function requestTokenRefresh(refreshToken: string): Promise<string | null> {
  try {
    const response = await fetch(joinUrl("/api/v1/auth/refresh"), {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    const text = await response.text()
    let json: any = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    if (!response.ok) return null
    const newToken = json?.data?.token
    if (typeof newToken !== "string" || !newToken.trim()) return null
    return newToken
  } catch {
    return null
  }
}

/**
 * Runs `refreshTokenOnce` as part of the frontend API client workflow.
 *
 * @param refreshToken - Input used to compute or dispatch the `refreshTokenOnce` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
async function refreshTokenOnce(refreshToken: string): Promise<string | null> {
  if (refreshTokenInFlight) return refreshTokenInFlight
  refreshTokenInFlight = (async () => {
    const refreshed = await requestTokenRefresh(refreshToken)
    if (refreshed) {
      setStoredAuthToken(refreshed)
    }
    return refreshed
  })()
  try {
    return await refreshTokenInFlight
  } finally {
    refreshTokenInFlight = null
  }
}

/**
 * Runs `apiFetch` as part of the frontend API client workflow.
 *
 * @param path - Relative backend route appended to the configured API base URL.
 * @param init - Request options, timeout configuration, and auth retry behavior.
 * @returns Parsed response payload for successful requests.
 * @remarks Applies auth token headers, timeout handling, retry policy, and normalized API errors.
 */
async function apiFetch<T>(path: string, init: ApiFetchOptions = {}): Promise<T> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    context,
    suppressErrorNotification,
    headers: requestHeaders,
    _authRetry = false,
    ...requestInit
  } = init
  const headers = new Headers(requestHeaders || {})
  headers.set("Content-Type", "application/json")
  headers.set("Accept", "application/json")
  if (typeof window !== "undefined" && !headers.has(STARKNET_ADDRESS_HEADER)) {
    const starknetAddress = getStoredActiveStarknetAddress()
    if (starknetAddress) {
      headers.set(STARKNET_ADDRESS_HEADER, starknetAddress)
    }
  }
  if (typeof window !== "undefined" && !headers.has("Authorization")) {
    const token = getStoredAuthToken()
    if (token) {
      headers.set("Authorization", `Bearer ${token}`)
    }
  }
  const hasAuthorizationHeader = headers.has("Authorization")

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(joinUrl(path), {
      cache: "no-store",
      ...requestInit,
      headers,
      signal: controller.signal,
    })

    const text = await response.text()
    let json: any = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }

    if (!response.ok) {
      const plainTextMessage = (() => {
        const trimmed = (text || "").trim()
        if (!trimmed) return null
        const firstLine = trimmed.split(/\r?\n/, 1)[0]?.trim() || ""
        if (!firstLine) return null
        return firstLine.length > 260 ? `${firstLine.slice(0, 257)}...` : firstLine
      })()
      const message =
        json?.error?.message ||
        json?.message ||
        plainTextMessage ||
        `Request failed (HTTP ${response.status})`
      const isMissingAuthHeader =
        response.status === 401 &&
        (!hasAuthorizationHeader || /missing authorization header/i.test(message))
      const isAuthExpired = isInvalidOrExpiredAuth(response.status, message, hasAuthorizationHeader)

      if (isAuthExpired && !_authRetry) {
        const currentToken =
          tokenFromAuthorizationHeader(headers.get("Authorization")) || getStoredAuthToken()
        if (currentToken) {
          const refreshedToken = await refreshTokenOnce(currentToken)
          if (refreshedToken) {
            const retryHeaders = new Headers(headers)
            retryHeaders.set("Authorization", `Bearer ${refreshedToken}`)
            return apiFetch<T>(path, {
              ...init,
              headers: retryHeaders,
              _authRetry: true,
            })
          }
        }
      }

      if (isAuthExpired) {
        clearStoredAuthToken()
        emitAuthExpired(message, path)
      }

      const error = new ApiError(message, {
        status: response.status,
        code: json?.error?.code || json?.code,
        details: json,
        path,
        method: requestInit?.method || "GET",
      })
      if (!suppressErrorNotification && !isMissingAuthHeader && !isAuthExpired) {
        emitEvent("api:error", {
          error,
          context: context || path,
          path,
          method: requestInit?.method || "GET",
        })
      }
      throw error
    }

    if (json && typeof json === "object" && "data" in json) {
      return json.data as T
    }

    return json as T
  } catch (err: any) {
    if (err instanceof ApiError) throw err
    const isTimeout = err?.name === "AbortError"
    const isNetworkError = !isTimeout
    const error = new ApiError(
      isTimeout ? "Request timeout" : err?.message || "Network error",
      {
        code: isTimeout ? "TIMEOUT" : "NETWORK_ERROR",
        path,
        method: requestInit?.method || "GET",
        details: err,
      }
    )
    if (!suppressErrorNotification) {
      const errorContext = isNetworkError
        ? "Backend unavailable (check NEXT_PUBLIC_BACKEND_URL and backend server)"
        : context || path
      emitEvent("api:error", {
        error,
        context: errorContext,
        path,
        method: requestInit?.method || "GET",
      })
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Runs `getHealth` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getHealth() {
  return apiFetch<{ status: string; version: string; database: string; redis: string }>("/health")
}

/**
 * Runs `connectWallet` as part of the frontend API client workflow.
 *
 * @param payload - Input used to compute or dispatch the `connectWallet` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function connectWallet(payload: {
  address: string
  signature: string
  message: string
  chain_id: number
  wallet_type?: string
  sumo_login_token?: string
  referral_code?: string
}) {
  return apiFetch<ConnectWalletResponse>("/api/v1/auth/connect", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

/**
 * Runs `getNotifications` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getNotifications(page = 1, limit = 20, options?: { force?: boolean }) {
  const force = options?.force === true
  const key = `${page}:${limit}`
  const now = Date.now()
  if (!force) {
    const cached = notificationsCache.get(key)
    if (cached && cached.expiresAt > now) {
      return cached.data
    }
    const inFlight = notificationsInFlight.get(key)
    if (inFlight) {
      return inFlight
    }
  }

  const request = apiFetch<PaginatedResponse<BackendNotification>>(
    `/api/v1/notifications/list?page=${page}&limit=${limit}`,
    {
      timeoutMs: SLOW_READ_TIMEOUT_MS,
      suppressErrorNotification: true,
    }
  )
    .then((data) => {
      notificationsCache.set(key, {
        data,
        expiresAt: Date.now() + SHARED_READ_CACHE_TTL_MS,
      })
      return data
    })
    .finally(() => {
      notificationsInFlight.delete(key)
    })
  notificationsInFlight.set(key, request)
  return request
}

/**
 * Runs `markNotificationsRead` as part of the frontend API client workflow.
 *
 * @param ids - Input used to compute or dispatch the `markNotificationsRead` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function markNotificationsRead(ids: number[]) {
  return apiFetch<string>("/api/v1/notifications/mark-read", {
    method: "POST",
    body: JSON.stringify({ notification_ids: ids }),
  })
}

/**
 * Runs `getNotificationsStats` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getNotificationsStats() {
  return apiFetch<{ unread_count: number; total_count: number }>("/api/v1/notifications/stats")
}

/**
 * Runs `getPortfolioBalance` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getPortfolioBalance(options?: { force?: boolean }) {
  const force = options?.force === true
  const now = Date.now()
  if (!force && portfolioBalanceCache && portfolioBalanceCache.expiresAt > now) {
    return portfolioBalanceCache.data
  }
  if (!force && portfolioBalanceInFlight) {
    return portfolioBalanceInFlight
  }
  portfolioBalanceInFlight = apiFetch<BalanceResponse>("/api/v1/portfolio/balance", {
    timeoutMs: 30000,
  })
    .then((data) => {
      portfolioBalanceCache = {
        data,
        expiresAt: Date.now() + SHARED_READ_CACHE_TTL_MS,
      }
      return data
    })
    .finally(() => {
      portfolioBalanceInFlight = null
    })
  return portfolioBalanceInFlight
}

/**
 * Runs `getPortfolioAnalytics` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getPortfolioAnalytics(options?: { force?: boolean }) {
  const force = options?.force === true
  const now = Date.now()
  if (!force && portfolioAnalyticsCache && portfolioAnalyticsCache.expiresAt > now) {
    return portfolioAnalyticsCache.data
  }
  if (!force && portfolioAnalyticsInFlight) {
    return portfolioAnalyticsInFlight
  }
  portfolioAnalyticsInFlight = apiFetch<AnalyticsResponse>("/api/v1/portfolio/analytics", {
    timeoutMs: SLOW_READ_TIMEOUT_MS,
    suppressErrorNotification: true,
  })
    .then((data) => {
      portfolioAnalyticsCache = {
        data,
        expiresAt: Date.now() + SHARED_READ_CACHE_TTL_MS,
      }
      return data
    })
    .finally(() => {
      portfolioAnalyticsInFlight = null
    })
  return portfolioAnalyticsInFlight
}

/**
 * Runs `getPortfolioHistory` as part of the frontend API client workflow.
 *
 * @param period - Input used to compute or dispatch the `getPortfolioHistory` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getPortfolioHistory(period: "1d" | "7d" | "30d" | "all") {
  return apiFetch<PortfolioHistoryResponse>(`/api/v1/portfolio/history?period=${period}`)
}

/**
 * Runs `getPortfolioOHLCV` as part of the frontend API client workflow.
 *
 * @param params - Input used to compute or dispatch the `getPortfolioOHLCV` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getPortfolioOHLCV(
  params: { interval: string; limit?: number },
  options?: { force?: boolean }
) {
  const force = options?.force === true
  const search = new URLSearchParams({ interval: params.interval })
  if (params.limit) search.set("limit", String(params.limit))
  const key = `${params.interval}:${params.limit ?? ""}`
  const now = Date.now()
  if (!force) {
    const cached = portfolioOhlcvCache.get(key)
    if (cached && cached.expiresAt > now) {
      return cached.data
    }
    const inFlight = portfolioOhlcvInFlight.get(key)
    if (inFlight) {
      return inFlight
    }
  }

  const request = apiFetch<PortfolioOHLCVResponse>(`/api/v1/portfolio/ohlcv?${search.toString()}`, {
    timeoutMs: SLOW_READ_TIMEOUT_MS,
    suppressErrorNotification: true,
  })
    .then((data) => {
      portfolioOhlcvCache.set(key, {
        data,
        expiresAt: Date.now() + SHARED_READ_CACHE_TTL_MS,
      })
      return data
    })
    .finally(() => {
      portfolioOhlcvInFlight.delete(key)
    })
  portfolioOhlcvInFlight.set(key, request)
  return request
}

/**
 * Runs `getLeaderboard` as part of the frontend API client workflow.
 *
 * @param type - Input used to compute or dispatch the `getLeaderboard` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getLeaderboard(
  type: "points" | "volume" | "referrals",
  options?: { force?: boolean }
) {
  const force = options?.force === true
  const key = type
  const now = Date.now()
  if (!force) {
    const cached = leaderboardCache.get(key)
    if (cached && cached.expiresAt > now) {
      return cached.data
    }
    const inFlight = leaderboardInFlight.get(key)
    if (inFlight) {
      return inFlight
    }
  }
  const request = apiFetch<LeaderboardResponse>(`/api/v1/leaderboard/${type}`, {
    timeoutMs: SLOW_READ_TIMEOUT_MS,
    suppressErrorNotification: true,
  })
    .then((data) => {
      leaderboardCache.set(key, {
        data,
        expiresAt: Date.now() + SHARED_READ_CACHE_TTL_MS,
      })
      return data
    })
    .finally(() => {
      leaderboardInFlight.delete(key)
    })
  leaderboardInFlight.set(key, request)
  return request
}

/**
 * Runs `getLeaderboardGlobalMetrics` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getLeaderboardGlobalMetrics() {
  return apiFetch<{ points_total: number; volume_total: number; referral_total: number }>(
    "/api/v1/leaderboard/global"
  )
}

/**
 * Runs `getLeaderboardGlobalMetricsEpoch` as part of the frontend API client workflow.
 *
 * @param epoch - Input used to compute or dispatch the `getLeaderboardGlobalMetricsEpoch` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getLeaderboardGlobalMetricsEpoch(epoch: number) {
  return apiFetch<{ points_total: number; volume_total: number; referral_total: number }>(
    `/api/v1/leaderboard/global/${epoch}`
  )
}

/**
 * Runs `getLeaderboardUserRank` as part of the frontend API client workflow.
 *
 * @param address - Input used to compute or dispatch the `getLeaderboardUserRank` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getLeaderboardUserRank(address: string) {
  return apiFetch<LeaderboardUserRank>(`/api/v1/leaderboard/user/${address}`, {
    timeoutMs: SLOW_READ_TIMEOUT_MS,
    suppressErrorNotification: true,
  })
}

/**
 * Runs `getLeaderboardUserCategories` as part of the frontend API client workflow.
 *
 * @param address - Input used to compute or dispatch the `getLeaderboardUserCategories` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getLeaderboardUserCategories(address: string, options?: { force?: boolean }) {
  const key = normalizeAddressCacheKey(address)
  const force = options?.force === true
  const now = Date.now()
  if (!key) {
    return {
      categories: [],
    }
  }
  if (!force) {
    const cached = leaderboardUserCategoriesCache.get(key)
    if (cached && cached.expiresAt > now) {
      return cached.data
    }
    const inFlight = leaderboardUserCategoriesInFlight.get(key)
    if (inFlight) {
      return inFlight
    }
  }

  const request = apiFetch<LeaderboardUserCategoriesResponse>(
    `/api/v1/leaderboard/user/${address}/categories`,
    {
      timeoutMs: SLOW_READ_TIMEOUT_MS,
      suppressErrorNotification: true,
    }
  )
    .then((data) => {
      leaderboardUserCategoriesCache.set(key, {
        data,
        expiresAt: Date.now() + SHARED_READ_CACHE_TTL_MS,
      })
      return data
    })
    .finally(() => {
      leaderboardUserCategoriesInFlight.delete(key)
    })

  leaderboardUserCategoriesInFlight.set(key, request)
  return request
}

/**
 * Runs `getRewardsPoints` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getRewardsPoints(options?: { force?: boolean }) {
  const force = options?.force === true
  const now = Date.now()
  if (!force && rewardsPointsCache && rewardsPointsCache.expiresAt > now) {
    return rewardsPointsCache.data
  }
  if (!force && rewardsPointsInFlight) {
    return rewardsPointsInFlight
  }
  rewardsPointsInFlight = apiFetch<RewardsPointsResponse>("/api/v1/rewards/points", {
    timeoutMs: 25000,
  })
    .then((data) => {
      rewardsPointsCache = {
        data,
        expiresAt: Date.now() + SHARED_READ_CACHE_TTL_MS,
      }
      return data
    })
    .finally(() => {
      rewardsPointsInFlight = null
    })
  return rewardsPointsInFlight
}

/**
 * Runs `syncRewardsPointsOnchain` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function syncRewardsPointsOnchain(payload?: { minimum_points?: number }) {
  return apiFetch<RewardsOnchainSyncResponse>("/api/v1/rewards/sync-onchain", {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
    context: "Sync rewards points",
    timeoutMs: 45000,
    suppressErrorNotification: true,
  })
}

/**
 * Runs `getReferralCode` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getReferralCode() {
  return apiFetch<ReferralCodeResponse>("/api/v1/referral/code")
}

/**
 * Runs `getReferralStats` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getReferralStats() {
  return apiFetch<ReferralStatsResponse>("/api/v1/referral/stats", {
    suppressErrorNotification: true,
  })
}

/**
 * Runs `getReferralHistory` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getReferralHistory(page = 1, limit = 10) {
  return apiFetch<PaginatedResponse<ReferralHistoryItem>>(
    `/api/v1/referral/history?page=${page}&limit=${limit}`
  )
}

/**
 * Runs `getTransactionsHistory` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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

/**
 * Runs `getSwapQuote` as part of the frontend API client workflow.
 *
 * @param payload - Input used to compute or dispatch the `getSwapQuote` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
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
    context: "Swap quote",
    suppressErrorNotification: true,
  })
}

/**
 * Runs `executeSwap` as part of the frontend API client workflow.
 *
 * @param payload - Input used to compute or dispatch the `executeSwap` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function executeSwap(payload: {
  from_token: string
  to_token: string
  amount: string
  min_amount_out: string
  slippage: number
  deadline: number
  recipient?: string
  onchain_tx_hash?: string
  hide_balance?: boolean
  privacy?: PrivacyVerificationPayload
  mode: string
}) {
  const isHideV3Request =
    payload.hide_balance === true &&
    ((payload.privacy?.note_version || "").trim().toLowerCase() === "v3")
  const sanitizedPayload = isHideV3Request ? { ...payload, recipient: undefined } : payload

  return apiFetch<ExecuteSwapResponse>("/api/v1/swap/execute", {
    method: "POST",
    body: JSON.stringify(sanitizedPayload),
    context: "Swap execute",
    suppressErrorNotification: true,
    timeoutMs: 120000,
  })
}

/**
 * Runs `getBridgeQuote` as part of the frontend API client workflow.
 *
 * @param payload - Input used to compute or dispatch the `getBridgeQuote` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getBridgeQuote(payload: {
  from_chain: string
  to_chain: string
  token: string
  to_token?: string
  amount: string
}) {
  return apiFetch<BridgeQuoteResponse>("/api/v1/bridge/quote", {
    method: "POST",
    body: JSON.stringify(payload),
    context: "Bridge quote",
    suppressErrorNotification: true,
    timeoutMs: 45000,
  })
}

/**
 * Runs `executeBridge` as part of the frontend API client workflow.
 *
 * @param payload - Input used to compute or dispatch the `executeBridge` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function executeBridge(payload: {
  from_chain: string
  to_chain: string
  token: string
  to_token?: string
  estimated_out_amount?: string
  amount: string
  recipient: string
  source_owner?: string
  existing_bridge_id?: string
  xverse_user_id?: string
  onchain_tx_hash?: string
  mode?: string
  hide_balance?: boolean
  privacy?: PrivacyVerificationPayload
}) {
  return apiFetch<ExecuteBridgeResponse>("/api/v1/bridge/execute", {
    method: "POST",
    body: JSON.stringify(payload),
    context: "Bridge execute",
    suppressErrorNotification: true,
    timeoutMs: 120000,
  })
}

/**
 * Runs `getBridgeStatus` as part of the frontend API client workflow.
 *
 * @param bridgeId - Input used to compute or dispatch the `getBridgeStatus` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getBridgeStatus(bridgeId: string) {
  return apiFetch<BridgeStatusResponse>(`/api/v1/bridge/status/${encodeURIComponent(bridgeId)}`, {
    suppressErrorNotification: true,
  })
}

/**
 * Runs `getGardenVolume` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getGardenVolume(params?: {
  source_chain?: string
  destination_chain?: string
  address?: string
  from?: number
  to?: number
}) {
  const search = new URLSearchParams()
  if (params?.source_chain) search.set("source_chain", params.source_chain)
  if (params?.destination_chain) search.set("destination_chain", params.destination_chain)
  if (params?.address) search.set("address", params.address)
  if (typeof params?.from === "number") search.set("from", String(params.from))
  if (typeof params?.to === "number") search.set("to", String(params.to))
  const query = search.toString()
  return apiFetch<GardenStringMetricResponse>(`/api/v1/garden/volume${query ? `?${query}` : ""}`)
}

/**
 * Runs `getGardenFees` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getGardenFees(params?: {
  source_chain?: string
  destination_chain?: string
  address?: string
  from?: number
  to?: number
}) {
  const search = new URLSearchParams()
  if (params?.source_chain) search.set("source_chain", params.source_chain)
  if (params?.destination_chain) search.set("destination_chain", params.destination_chain)
  if (params?.address) search.set("address", params.address)
  if (typeof params?.from === "number") search.set("from", String(params.from))
  if (typeof params?.to === "number") search.set("to", String(params.to))
  const query = search.toString()
  return apiFetch<GardenStringMetricResponse>(`/api/v1/garden/fees${query ? `?${query}` : ""}`)
}

/**
 * Runs `getGardenSupportedChains` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getGardenSupportedChains(params?: { from?: string }) {
  const search = new URLSearchParams()
  if (params?.from) search.set("from", params.from)
  const query = search.toString()
  return apiFetch<GardenListResponse>(`/api/v1/garden/chains${query ? `?${query}` : ""}`)
}

/**
 * Runs `getGardenSupportedAssets` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getGardenSupportedAssets(params?: { from?: string }) {
  const search = new URLSearchParams()
  if (params?.from) search.set("from", params.from)
  const query = search.toString()
  return apiFetch<GardenListResponse>(`/api/v1/garden/assets${query ? `?${query}` : ""}`)
}

/**
 * Runs `getGardenAvailableLiquidity` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getGardenAvailableLiquidity() {
  return apiFetch<GardenLiquidityResponse>("/api/v1/garden/liquidity")
}

/**
 * Runs `getGardenOrders` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getGardenOrders(params?: {
  address?: string
  tx_hash?: string
  from_chain?: string
  to_chain?: string
  from_owner?: string
  to_owner?: string
  solver_id?: string
  integrator?: string
  page?: number
  per_page?: number
  status?: string
}) {
  const search = new URLSearchParams()
  if (params?.address) search.set("address", params.address)
  if (params?.tx_hash) search.set("tx_hash", params.tx_hash)
  if (params?.from_chain) search.set("from_chain", params.from_chain)
  if (params?.to_chain) search.set("to_chain", params.to_chain)
  if (params?.from_owner) search.set("from_owner", params.from_owner)
  if (params?.to_owner) search.set("to_owner", params.to_owner)
  if (params?.solver_id) search.set("solver_id", params.solver_id)
  if (params?.integrator) search.set("integrator", params.integrator)
  if (typeof params?.page === "number") search.set("page", String(params.page))
  if (typeof params?.per_page === "number") search.set("per_page", String(params.per_page))
  if (params?.status) search.set("status", params.status)
  const query = search.toString()
  return apiFetch<GardenObjectResponse<GardenOrdersPage>>(`/api/v1/garden/orders${query ? `?${query}` : ""}`)
}

/**
 * Runs `getGardenOrderById` as part of the frontend API client workflow.
 *
 * @param orderId - Input used to compute or dispatch the `getGardenOrderById` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getGardenOrderById(orderId: string) {
  return apiFetch<GardenObjectResponse>(`/api/v1/garden/orders/${encodeURIComponent(orderId)}`)
}

/**
 * Runs `getGardenOrderInstantRefundHash` as part of the frontend API client workflow.
 *
 * @param orderId - Input used to compute or dispatch the `getGardenOrderInstantRefundHash` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getGardenOrderInstantRefundHash(orderId: string) {
  return apiFetch<GardenStringMetricResponse>(
    `/api/v1/garden/orders/${encodeURIComponent(orderId)}/instant-refund-hash`
  )
}

/**
 * Runs `getGardenSchema` as part of the frontend API client workflow.
 *
 * @param name - Input used to compute or dispatch the `getGardenSchema` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getGardenSchema(name: string) {
  return apiFetch<GardenObjectResponse>(`/api/v1/garden/schemas/${encodeURIComponent(name)}`)
}

/**
 * Runs `getGardenAppEarnings` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getGardenAppEarnings() {
  return apiFetch<GardenListResponse>("/api/v1/garden/apps/earnings")
}

/**
 * Runs `listLimitOrders` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function listLimitOrders(page = 1, limit = 10, status?: string, options?: { force?: boolean }) {
  const force = options?.force === true
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (status) params.set("status", status)
  const key = `${page}:${limit}:${status || ""}`
  const now = Date.now()
  if (!force) {
    const cached = limitOrdersCache.get(key)
    if (cached && cached.expiresAt > now) {
      return cached.data
    }
    const inFlight = limitOrdersInFlight.get(key)
    if (inFlight) {
      return inFlight
    }
  }
  const request = apiFetch<PaginatedResponse<LimitOrderItem>>(
    `/api/v1/limit-order/list?${params.toString()}`,
    {
      timeoutMs: SLOW_READ_TIMEOUT_MS,
      suppressErrorNotification: true,
    }
  )
    .then((data) => {
      limitOrdersCache.set(key, {
        data,
        expiresAt: Date.now() + SHARED_READ_CACHE_TTL_MS,
      })
      return data
    })
    .finally(() => {
      limitOrdersInFlight.delete(key)
    })
  limitOrdersInFlight.set(key, request)
  return request
}

/**
 * Runs `createLimitOrder` as part of the frontend API client workflow.
 *
 * @param payload - Input used to compute or dispatch the `createLimitOrder` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function createLimitOrder(payload: {
  from_token: string
  to_token: string
  amount: string
  price: string
  expiry: string
  recipient?: string | null
  client_order_id?: string
  onchain_tx_hash?: string
  hide_balance?: boolean
  privacy?: PrivacyVerificationPayload
}) {
  return apiFetch<LimitOrderResponse>("/api/v1/limit-order/create", {
    method: "POST",
    body: JSON.stringify(payload),
    context: "Create limit order",
    suppressErrorNotification: true,
    timeoutMs: 120000,
  })
}

/**
 * Runs `cancelLimitOrder` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function cancelLimitOrder(
  orderId: string,
  payload?: {
    onchain_tx_hash?: string
    hide_balance?: boolean
    privacy?: PrivacyVerificationPayload
  }
) {
  return apiFetch<string>(`/api/v1/limit-order/${orderId}`, {
    method: "DELETE",
    body: JSON.stringify(payload || {}),
    context: "Cancel limit order",
    suppressErrorNotification: true,
    timeoutMs: 120000,
  })
}

/**
 * Runs `getStakePools` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getStakePools(options?: { force?: boolean }) {
  const force = options?.force === true
  const now = Date.now()
  if (!force && stakePoolsCache && stakePoolsCache.expiresAt > now) {
    return stakePoolsCache.data
  }
  if (!force && stakePoolsInFlight) {
    return stakePoolsInFlight
  }

  stakePoolsInFlight = apiFetch<StakingPool[]>("/api/v1/stake/pools", {
    timeoutMs: SLOW_READ_TIMEOUT_MS,
    suppressErrorNotification: true,
  })
    .then((data) => {
      stakePoolsCache = {
        data,
        expiresAt: Date.now() + SHARED_READ_CACHE_TTL_MS,
      }
      return data
    })
    .finally(() => {
      stakePoolsInFlight = null
    })
  return stakePoolsInFlight
}

/**
 * Runs `getStakePositions` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getStakePositions() {
  return apiFetch<StakingPosition[]>("/api/v1/stake/positions", {
    suppressErrorNotification: true,
  })
}

/**
 * Runs `stakeDeposit` as part of the frontend API client workflow.
 *
 * @param payload - Input used to compute or dispatch the `stakeDeposit` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function stakeDeposit(payload: {
  pool_id: string
  amount: string
  onchain_tx_hash?: string
  hide_balance?: boolean
  privacy?: PrivacyVerificationPayload
}) {
  return apiFetch<StakeDepositResponse>(
    "/api/v1/stake/deposit",
    {
      method: "POST",
      body: JSON.stringify(payload),
      context: "Stake deposit",
      suppressErrorNotification: true,
      timeoutMs: 120000,
    }
  )
}

/**
 * Runs `stakeWithdraw` as part of the frontend API client workflow.
 *
 * @param payload - Input used to compute or dispatch the `stakeWithdraw` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function stakeWithdraw(payload: {
  position_id: string
  amount: string
  onchain_tx_hash?: string
  hide_balance?: boolean
  privacy?: PrivacyVerificationPayload
}) {
  return apiFetch<StakeDepositResponse>(
    "/api/v1/stake/withdraw",
    {
      method: "POST",
      body: JSON.stringify(payload),
      context: "Stake withdraw",
      suppressErrorNotification: true,
      timeoutMs: 120000,
    }
  )
}

/**
 * Runs `stakeClaim` as part of the frontend API client workflow.
 *
 * @param payload - Input used to compute or dispatch the `stakeClaim` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function stakeClaim(payload: {
  position_id: string
  onchain_tx_hash?: string
  hide_balance?: boolean
  privacy?: PrivacyVerificationPayload
}) {
  return apiFetch<{ position_id: string; tx_hash: string; claimed_token: string; privacy_tx_hash?: string }>(
    "/api/v1/stake/claim",
    {
      method: "POST",
      body: JSON.stringify(payload),
      context: "Stake claim",
      suppressErrorNotification: true,
      timeoutMs: 120000,
    }
  )
}

/**
 * Runs `getOwnedNfts` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getOwnedNfts(options?: { force?: boolean }) {
  const force = options?.force === true
  const now = Date.now()
  if (!force && ownedNftsCache && ownedNftsCache.expiresAt > now) {
    return ownedNftsCache.data
  }
  if (!force && ownedNftsInFlight) {
    return ownedNftsInFlight
  }
  ownedNftsInFlight = apiFetch<NFTItem[]>("/api/v1/nft/owned", {
    timeoutMs: 25000,
  })
    .then((data) => {
      ownedNftsCache = {
        data,
        expiresAt: Date.now() + SHARED_READ_CACHE_TTL_MS,
      }
      return data
    })
    .finally(() => {
      ownedNftsInFlight = null
    })
  return ownedNftsInFlight
}

/**
 * Runs `mintNft` as part of the frontend API client workflow.
 *
 * @param payload - Input used to compute or dispatch the `mintNft` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function mintNft(payload: { tier: number; onchain_tx_hash?: string }) {
  return apiFetch<NFTItem>("/api/v1/nft/mint", {
    method: "POST",
    body: JSON.stringify(payload),
    context: "Mint NFT",
    suppressErrorNotification: true,
  })
}

/**
 * Runs `claimRewards` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function claimRewards() {
  return apiFetch<{ tx_hash: string; amount_carel: number; points_converted: number }>(
    "/api/v1/rewards/claim",
    {
      method: "POST",
      context: "Claim rewards",
      suppressErrorNotification: true,
    }
  )
}

/**
 * Runs `convertRewards` as part of the frontend API client workflow.
 *
 * @param payload - Input used to compute or dispatch the `convertRewards` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function convertRewards(payload: { points?: number; epoch?: number; total_distribution_carel?: number }) {
  return apiFetch<{ tx_hash: string; amount_carel: number; points_converted: number }>(
    "/api/v1/rewards/convert",
    {
      method: "POST",
      body: JSON.stringify(payload),
      context: "Convert rewards",
      suppressErrorNotification: true,
    }
  )
}

/**
 * Runs `getTokenOHLCV` as part of the frontend API client workflow.
 *
 * @param params - Input used to compute or dispatch the `getTokenOHLCV` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getTokenOHLCV(params: {
  token: string
  interval: string
  limit?: number
  source?: "auto" | "coingecko"
}) {
  const search = new URLSearchParams({ interval: params.interval })
  if (params.limit) search.set("limit", String(params.limit))
  if (params.source && params.source !== "auto") search.set("source", params.source)
  return apiFetch<{ token: string; interval: string; data: Array<{ timestamp: string; open: NumericLike; high: NumericLike; low: NumericLike; close: NumericLike; volume: NumericLike }> }>(
    `/api/v1/chart/${params.token}/ohlcv?${search.toString()}`
  )
}

/**
 * Runs `getMarketDepth` as part of the frontend API client workflow.
 *
 * @param token - Input used to compute or dispatch the `getMarketDepth` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getMarketDepth(token: string, limit?: number) {
  const search = new URLSearchParams()
  if (limit) search.set("limit", String(limit))
  const query = search.toString()
  return apiFetch<MarketDepthResponse>(`/api/v1/market/depth/${token}${query ? `?${query}` : ""}`)
}

/**
 * Runs `verifySocialTask` as part of the frontend API client workflow.
 *
 * @param payload - Input used to compute or dispatch the `verifySocialTask` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function verifySocialTask(payload: { task_type: string; proof: string }) {
  return apiFetch<SocialVerifyResponse>("/api/v1/social/verify", {
    method: "POST",
    body: JSON.stringify(payload),
    context: "Verify social task",
    suppressErrorNotification: true,
  })
}

/**
 * Runs `getSocialTasks` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getSocialTasks() {
  return apiFetch<SocialTaskItem[]>("/api/v1/social/tasks", {
    context: "Load social tasks",
  })
}

/**
 * Runs `getProfile` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getProfile() {
  return apiFetch<ProfileResponse>("/api/v1/profile/me", {
    context: "Get profile",
  })
}

/**
 * Runs `setDisplayName` as part of the frontend API client workflow.
 *
 * @param payload - Input used to compute or dispatch the `setDisplayName` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function setDisplayName(payload: {
  display_name: string
  rename_onchain_tx_hash?: string
}) {
  return apiFetch<ProfileResponse>("/api/v1/profile/display-name", {
    method: "PUT",
    body: JSON.stringify(payload),
    context: "Set display name",
    suppressErrorNotification: true,
  })
}

/**
 * Runs `executeAiCommand` as part of the frontend API client workflow.
 *
 * @param payload - Input used to compute or dispatch the `executeAiCommand` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function executeAiCommand(payload: { command: string; context?: string; level?: number; action_id?: number }) {
  return apiFetch<AIResponse>("/api/v1/ai/execute", {
    method: "POST",
    body: JSON.stringify(payload),
    context: "AI command",
    suppressErrorNotification: true,
    timeoutMs: 45000,
  })
}

/**
 * Runs `getAiPendingActions` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getAiPendingActions(offset = 0, limit = 10) {
  const params = new URLSearchParams({ offset: String(offset), limit: String(limit) })
  return apiFetch<PendingActionsResponse>(`/api/v1/ai/pending?${params.toString()}`, {
    context: "AI pending actions",
    suppressErrorNotification: true,
    timeoutMs: 45000,
  })
}

/**
 * Runs `getAiRuntimeConfig` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getAiRuntimeConfig() {
  return apiFetch<AiRuntimeConfigResponse>("/api/v1/ai/config", {
    context: "AI runtime config",
    suppressErrorNotification: true,
  })
}

/**
 * Runs `ensureAiExecutorReady` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function ensureAiExecutorReady() {
  return apiFetch<AiExecutorReadyResponse>("/api/v1/ai/ensure-executor", {
    method: "POST",
    context: "AI executor preflight",
    suppressErrorNotification: true,
    timeoutMs: 60000,
  })
}

/**
 * Runs `getAiLevel` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getAiLevel() {
  return apiFetch<AiLevelResponse>("/api/v1/ai/level", {
    context: "AI level",
    suppressErrorNotification: true,
  })
}

/**
 * Runs `upgradeAiLevel` as part of the frontend API client workflow.
 *
 * @param payload - Input used to compute or dispatch the `upgradeAiLevel` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function upgradeAiLevel(payload: { target_level: number; onchain_tx_hash: string }) {
  return apiFetch<AiUpgradeLevelResponse>("/api/v1/ai/upgrade", {
    method: "POST",
    body: JSON.stringify(payload),
    context: "AI level upgrade",
    suppressErrorNotification: true,
    timeoutMs: 60000,
  })
}

/**
 * Runs `prepareAiAction` as part of the frontend API client workflow.
 *
 * @param payload - Input used to compute or dispatch the `prepareAiAction` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function prepareAiAction(payload: {
  level: number
  context?: string
}) {
  return apiFetch<PrepareAiActionResponse>("/api/v1/ai/prepare-action", {
    method: "POST",
    body: JSON.stringify(payload),
    context: "AI prepare action",
    suppressErrorNotification: true,
    // Preparing typed-data challenge can take longer on busy RPCs.
    timeoutMs: 180000,
  })
}

/**
 * Runs `submitPrivacyAction` as part of the frontend API client workflow.
 *
 * @param payload - Input used to compute or dispatch the `submitPrivacyAction` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function submitPrivacyAction(payload: PrivacyActionPayload) {
  return apiFetch<PrivacySubmitResponse>("/api/v1/privacy/submit", {
    method: "POST",
    body: JSON.stringify(payload),
    context: "Privacy submit",
    suppressErrorNotification: true,
  })
}

/**
 * Runs `autoSubmitPrivacyAction` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function autoSubmitPrivacyAction(payload?: {
  verifier?: string
  submit_onchain?: boolean
  tx_context?: {
    flow?: string
    from_token?: string
    to_token?: string
    amount?: string
    recipient?: string
    from_network?: string
    to_network?: string
    note_version?: string
    root?: string
    intent_hash?: string
    action_hash?: string
    action_target?: string
    action_selector?: string
    calldata_hash?: string
    approval_token?: string
    payout_token?: string
    min_payout?: string
    note_commitment?: string
    denom_id?: string
    spendable_at_unix?: number
    nullifier?: string
  }
}) {
  return apiFetch<PrivacyAutoSubmitResponse>("/api/v1/privacy/auto-submit", {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
    context: "Privacy auto submit",
    suppressErrorNotification: true,
    timeoutMs: 120000,
  })
}

/**
 * Runs `preparePrivateExecution` as part of the frontend API client workflow.
 *
 * @param payload - Input used to compute or dispatch the `preparePrivateExecution` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function preparePrivateExecution(payload: {
  verifier?: string
  flow: "swap" | "limit" | "stake"
  action_entrypoint: string
  action_calldata: string[]
  token?: string
  amount_low?: string
  amount_high?: string
  signature_selector?: string
  nonce?: string
  deadline?: number
  tx_context?: {
    flow?: string
    from_token?: string
    to_token?: string
    amount?: string
    recipient?: string
    from_network?: string
    to_network?: string
    note_version?: string
    root?: string
    intent_hash?: string
    action_hash?: string
    action_target?: string
    action_selector?: string
    calldata_hash?: string
    approval_token?: string
    payout_token?: string
    min_payout?: string
    note_commitment?: string
    denom_id?: string
    spendable_at_unix?: number
    nullifier?: string
  }
}) {
  return apiFetch<PrivacyPreparePrivateExecutionResponse>(
    "/api/v1/privacy/prepare-private-execution",
    {
      method: "POST",
      body: JSON.stringify(payload),
      context: "Prepare private execution",
      suppressErrorNotification: true,
      timeoutMs: 120000,
    }
  )
}

export async function relayPrivateExecution(payload: PrivacyRelayerExecutePayload) {
  return apiFetch<PrivacyRelayerExecuteResponse>("/api/v1/privacy/relayer-execute", {
    method: "POST",
    body: JSON.stringify(payload),
    context: "Relayer private execution",
    suppressErrorNotification: true,
    timeoutMs: 120000,
  })
}

/**
 * Runs `createBattleshipGame` as part of the frontend API client workflow.
 *
 * @param payload - Input used to compute or dispatch the `createBattleshipGame` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function createBattleshipGame(payload: {
  opponent: string
  cells: BattleshipCell[]
  privacy?: PrivacyVerificationPayload
  onchain_tx_hash?: string
}, options: BattleshipRequestOptions = {}) {
  return apiFetch<BattleshipGameActionResponse>("/api/v1/battleship/create", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: buildStarknetAddressHeader(options.starknetAddress),
    context: "Create battleship game",
    suppressErrorNotification: true,
    timeoutMs: 120000,
  })
}

/**
 * Runs `joinBattleshipGame` as part of the frontend API client workflow.
 *
 * @param payload - Input used to compute or dispatch the `joinBattleshipGame` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function joinBattleshipGame(payload: {
  game_id: string
  cells: BattleshipCell[]
  privacy?: PrivacyVerificationPayload
  onchain_tx_hash?: string
}, options: BattleshipRequestOptions = {}) {
  return apiFetch<BattleshipGameActionResponse>("/api/v1/battleship/join", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: buildStarknetAddressHeader(options.starknetAddress),
    context: "Join battleship game",
    suppressErrorNotification: true,
    timeoutMs: 120000,
  })
}

/**
 * Runs `placeBattleshipShips` as part of the frontend API client workflow.
 *
 * @param payload - Input used to compute or dispatch the `placeBattleshipShips` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function placeBattleshipShips(payload: {
  game_id: string
  cells: BattleshipCell[]
  privacy?: PrivacyVerificationPayload
  onchain_tx_hash?: string
}, options: BattleshipRequestOptions = {}) {
  return apiFetch<BattleshipGameActionResponse>("/api/v1/battleship/place-ships", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: buildStarknetAddressHeader(options.starknetAddress),
    context: "Place battleship ships",
    suppressErrorNotification: true,
    timeoutMs: 120000,
  })
}

/**
 * Runs `fireBattleshipShot` as part of the frontend API client workflow.
 *
 * @param payload - Input used to compute or dispatch the `fireBattleshipShot` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function fireBattleshipShot(payload: {
  game_id: string
  x: number
  y: number
  privacy?: PrivacyVerificationPayload
  onchain_tx_hash?: string
}, options: BattleshipRequestOptions = {}) {
  return apiFetch<BattleshipFireShotResponse>("/api/v1/battleship/fire", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: buildStarknetAddressHeader(options.starknetAddress),
    context: "Fire battleship shot",
    suppressErrorNotification: true,
    timeoutMs: 120000,
  })
}

/**
 * Runs `respondBattleshipShot` as part of the frontend API client workflow.
 *
 * @param payload - Input used to compute or dispatch the `respondBattleshipShot` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function respondBattleshipShot(payload: {
  game_id: string
  defend_x: number
  defend_y: number
  privacy?: PrivacyVerificationPayload
  onchain_tx_hash?: string
}, options: BattleshipRequestOptions = {}) {
  return apiFetch<BattleshipFireShotResponse>("/api/v1/battleship/respond", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: buildStarknetAddressHeader(options.starknetAddress),
    context: "Respond battleship shot",
    suppressErrorNotification: true,
    timeoutMs: 120000,
  })
}

/**
 * Runs `claimBattleshipTimeout` as part of the frontend API client workflow.
 *
 * @param payload - Input used to compute or dispatch the `claimBattleshipTimeout` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function claimBattleshipTimeout(payload: {
  game_id: string
  onchain_tx_hash?: string
}, options: BattleshipRequestOptions = {}) {
  return apiFetch<BattleshipGameActionResponse>("/api/v1/battleship/claim-timeout", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: buildStarknetAddressHeader(options.starknetAddress),
    context: "Claim battleship timeout",
    suppressErrorNotification: true,
    timeoutMs: 120000,
  })
}

/**
 * Runs `getBattleshipState` as part of the frontend API client workflow.
 *
 * @param gameId - Input used to compute or dispatch the `getBattleshipState` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getBattleshipState(gameId: string, options: BattleshipRequestOptions = {}) {
  return apiFetch<BattleshipGameStateResponse>(
    `/api/v1/battleship/state/${encodeURIComponent(gameId)}`,
    {
      headers: buildStarknetAddressHeader(options.starknetAddress),
      context: "Get battleship state",
      suppressErrorNotification: true,
    }
  )
}

/**
 * Runs `getFaucetStatus` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getFaucetStatus(options?: { starknetAddress?: string }) {
  return apiFetch<FaucetStatusResponse>("/api/v1/faucet/status", {
    headers: buildStarknetAddressHeader(options?.starknetAddress),
    context: "Get faucet status",
    suppressErrorNotification: true,
    timeoutMs: SLOW_READ_TIMEOUT_MS,
  })
}

/**
 * Runs `claimFaucet` as part of the frontend API client workflow.
 *
 * @param token - Input used to compute or dispatch the `claimFaucet` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function claimFaucet(token: string, options?: { starknetAddress?: string }) {
  return apiFetch<FaucetClaimResponse>("/api/v1/faucet/claim", {
    method: "POST",
    body: JSON.stringify({ token }),
    headers: buildStarknetAddressHeader(options?.starknetAddress),
    context: "Claim faucet",
    suppressErrorNotification: true,
  })
}

/**
 * Runs `getOnchainBalances` as part of the frontend API client workflow.
 *
 * @param payload - Input used to compute or dispatch the `getOnchainBalances` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getOnchainBalances(payload: {
  starknet_address?: string | null
  evm_address?: string | null
  btc_address?: string | null
}, options?: { force?: boolean }) {
  const force = options?.force === true
  const normalizedPayload = {
    starknet_address: payload.starknet_address ?? null,
    evm_address: payload.evm_address ?? null,
    btc_address: payload.btc_address ?? null,
    force: force || undefined,
  }
  const cacheKey = JSON.stringify(normalizedPayload)
  const now = Date.now()
  if (!force) {
    const cached = onchainBalancesCache.get(cacheKey)
    if (cached && cached.expiresAt > now) {
      return cached.data
    }
    const inFlight = onchainBalancesInFlight.get(cacheKey)
    if (inFlight) {
      return inFlight
    }
  }

  const request = apiFetch<OnchainBalancesResponse>("/api/v1/wallet/onchain-balances", {
    method: "POST",
    body: JSON.stringify(normalizedPayload),
    context: "Onchain balances",
    suppressErrorNotification: true,
    timeoutMs: 30000,
  })
    .then((data) => {
      onchainBalancesCache.set(cacheKey, {
        data,
        expiresAt: Date.now() + SHARED_ONCHAIN_CACHE_TTL_MS,
      })
      return data
    })
    .finally(() => {
      onchainBalancesInFlight.delete(cacheKey)
    })

  onchainBalancesInFlight.set(cacheKey, request)
  return request
}

/**
 * Runs `linkWalletAddress` as part of the frontend API client workflow.
 *
 * @param payload - Input used to compute or dispatch the `linkWalletAddress` operation.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function linkWalletAddress(payload: {
  chain: "starknet" | "evm" | "bitcoin"
  address: string
  provider?: string
}) {
  return apiFetch<{ user_address: string; chain: string; address: string }>("/api/v1/wallet/link", {
    method: "POST",
    body: JSON.stringify(payload),
    context: "Link wallet address",
    suppressErrorNotification: true,
  })
}

/**
 * Runs `getLinkedWallets` as part of the frontend API client workflow.
 *
 * @returns Result used by UI state, request lifecycle, or callback chaining.
 * @remarks May trigger Hide Mode payload handling, network calls, or local state updates.
 */
export async function getLinkedWallets() {
  return apiFetch<LinkedWalletsResponse>("/api/v1/wallet/linked", {
    context: "Get linked wallets",
    suppressErrorNotification: true,
  })
}
