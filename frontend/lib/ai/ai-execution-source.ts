"use client"

export const AI_LIMIT_ORDER_SOURCES_UPDATED_EVENT = "carel-ai-limit-order-sources-updated"
export const AI_STAKE_POSITION_SOURCES_UPDATED_EVENT = "carel-ai-stake-position-sources-updated"
export const AI_TRANSACTION_SOURCES_UPDATED_EVENT = "carel-ai-transaction-sources-updated"

const AI_LIMIT_ORDER_SOURCES_KEY = "carel_ai_limit_order_sources_v1"
const AI_STAKE_POSITION_SOURCES_KEY = "carel_ai_stake_position_sources_v1"
const AI_TRANSACTION_SOURCES_KEY = "carel_ai_transaction_sources_v1"
const MAX_PERSISTED_AI_SOURCE_IDS = 250

function normalizeSourceId(rawId: string): string {
  return rawId.trim().toLowerCase()
}

function loadPersistedIds(storageKey: string): string[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => (typeof item === "string" ? normalizeSourceId(item) : ""))
      .filter((item): item is string => item.length > 0)
  } catch {
    return []
  }
}

function persistIds(storageKey: string, eventName: string, ids: string[]) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(storageKey, JSON.stringify(ids))
  window.dispatchEvent(new Event(eventName))
}

function upsertPersistedId(storageKey: string, eventName: string, rawId: string) {
  const normalizedId = normalizeSourceId(rawId)
  if (!normalizedId) return
  const current = loadPersistedIds(storageKey)
  const next = [normalizedId, ...current.filter((item) => item !== normalizedId)].slice(
    0,
    MAX_PERSISTED_AI_SOURCE_IDS
  )
  persistIds(storageKey, eventName, next)
}

export function loadAiLimitOrderSourceIds(): Set<string> {
  return new Set(loadPersistedIds(AI_LIMIT_ORDER_SOURCES_KEY))
}

export function markAiLimitOrder(orderId: string) {
  upsertPersistedId(AI_LIMIT_ORDER_SOURCES_KEY, AI_LIMIT_ORDER_SOURCES_UPDATED_EVENT, orderId)
}

export function loadAiStakePositionSourceIds(): Set<string> {
  return new Set(loadPersistedIds(AI_STAKE_POSITION_SOURCES_KEY))
}

export function markAiStakePosition(positionId: string) {
  upsertPersistedId(
    AI_STAKE_POSITION_SOURCES_KEY,
    AI_STAKE_POSITION_SOURCES_UPDATED_EVENT,
    positionId
  )
}

export function loadAiTransactionSourceIds(): Set<string> {
  return new Set(loadPersistedIds(AI_TRANSACTION_SOURCES_KEY))
}

export function markAiTransaction(txHash: string) {
  upsertPersistedId(AI_TRANSACTION_SOURCES_KEY, AI_TRANSACTION_SOURCES_UPDATED_EVENT, txHash)
}
