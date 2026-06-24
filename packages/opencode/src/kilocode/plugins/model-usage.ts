import type { KilocodeSessionModelUsageResponse, Session } from "@kilocode/sdk/v2"
import { KiloRoutedModel } from "@/kilocode/session/routed-model"

export type SessionModelUsage = KilocodeSessionModelUsageResponse
export type UsageResult = { sessionID: string; data?: SessionModelUsage }

export function select(result: UsageResult | undefined, sessionID: string) {
  if (result?.sessionID !== sessionID) return undefined
  return result.data
}

export function failed(result: UsageResult | undefined, sessionID: string) {
  return result?.sessionID === sessionID && !result.data
}

export function member(input: {
  root: string
  sessionID: string
  get: (sessionID: string) => Session | undefined
  info?: Session
}) {
  const seen = new Set<string>()
  const visit = (sessionID: string, info?: Session): boolean => {
    if (sessionID === input.root) return true
    if (seen.has(sessionID)) return false
    seen.add(sessionID)
    const session = info ?? input.get(sessionID)
    if (!session?.parentID) return false
    return visit(session.parentID)
  }
  return visit(input.sessionID, input.info)
}

export function label(model: SessionModelUsage["models"][number]) {
  return KiloRoutedModel.displayName(KiloRoutedModel.display(model.modelID))
}

const count = new Intl.NumberFormat("en-US")
const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
})

export function formatCount(value: number) {
  return count.format(value)
}

export function formatRate(tokens: SessionModelUsage["totals"]["tokens"]) {
  const total = tokens.input + tokens.cache.read + tokens.cache.write
  if (total === 0) return "-"
  return `${((tokens.cache.read / total) * 100).toFixed(1)}%`
}

export function formatCost(input: number) {
  const value = Math.max(0, Number.isFinite(input) ? input : 0)
  if (value > 0 && value < 0.000001) return "<$0.000001"
  return currency.format(value)
}
