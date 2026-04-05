import type { Part } from "../types/messages"

/** Minimal message shape for cost breakdown helpers. */
export type CostMessage = { id: string; role: string; cost?: number }

/** Minimal tool part shape for label extraction. */
type ToolState = {
  input?: { description?: string; subagent_type?: string }
  metadata?: { sessionId?: string }
}

/**
 * Derive a human-readable status string from the last streaming part.
 * Returns undefined for part types that don't map to a status.
 */
export function computeStatus(
  part: Part | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
): string | undefined {
  if (!part) return undefined
  if (part.type === "tool") {
    switch (part.tool) {
      case "task":
        return t("ui.sessionTurn.status.delegating")
      case "todowrite":
      case "todoread":
        return t("ui.sessionTurn.status.planning")
      case "read":
        return t("ui.sessionTurn.status.gatheringContext")
      case "list":
      case "grep":
      case "glob":
        return t("ui.sessionTurn.status.searchingCodebase")
      case "webfetch":
        return t("ui.sessionTurn.status.searchingWeb")
      case "edit":
      case "write":
        return t("ui.sessionTurn.status.makingEdits")
      case "bash":
        return t("ui.sessionTurn.status.runningCommands")
      default:
        return undefined
    }
  }
  if (part.type === "reasoning") return t("ui.sessionTurn.status.thinking")
  if (part.type === "text") return t("session.status.writingResponse")
  return undefined
}

/**
 * Calculate total cost across all assistant messages.
 */
export function calcTotalCost(messages: Array<{ role: string; cost?: number }>): number {
  return messages.reduce((sum, m) => sum + (m.role === "assistant" ? (m.cost ?? 0) : 0), 0)
}

/**
 * Calculate context usage percentage given token counts and a context limit.
 */
export function calcContextUsage(
  tokens: {
    input: number
    output: number
    reasoning?: number
    cache?: { read: number; write: number }
  },
  contextLimit: number | undefined,
): { tokens: number; percentage: number | null } {
  const total =
    tokens.input + tokens.output + (tokens.reasoning ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0)
  const percentage = contextLimit ? Math.round((total / contextLimit) * 100) : null
  return { tokens: total, percentage }
}

/**
 * Build a map of session ID → total cost for each session in the family
 * that has non-zero cost. Pure function — no store dependency.
 */
export function buildFamilyCosts(
  family: Set<string>,
  messages: Record<string, Array<{ role: string; cost?: number }>>,
): Map<string, number> {
  const costs = new Map<string, number>()
  for (const sid of family) {
    const cost = calcTotalCost(messages[sid] ?? [])
    if (cost > 0) costs.set(sid, cost)
  }
  return costs
}

const LABEL_CAP = 24

/**
 * Build a map of child session ID → label by scanning tool parts in the
 * family for task tool metadata. Pure function — no store dependency.
 */
export function buildFamilyLabels(
  family: Set<string>,
  messages: Record<string, CostMessage[]>,
  parts: Record<string, Array<{ type: string; tool?: string; state?: ToolState }>>,
): Map<string, string> {
  const labels = new Map<string, string>()
  for (const sid of family) {
    const msgs = messages[sid]
    if (!msgs) continue
    for (const msg of msgs) {
      const list = parts[msg.id]
      if (!list) continue
      for (const p of list) {
        if (p.type !== "tool") continue
        const child = p.state?.metadata?.sessionId
        if (!child || !family.has(child)) continue
        const raw = p.state?.input?.subagent_type || p.state?.input?.description || p.tool || "task"
        const desc = raw.length > LABEL_CAP ? raw.slice(0, LABEL_CAP - 2) + "…" : raw
        if (!labels.has(child)) labels.set(child, desc)
      }
    }
  }
  return labels
}

/**
 * Combine costs and labels into the final breakdown array.
 * Pure function — no store dependency.
 */
export function buildCostBreakdown(
  root: string,
  costs: Map<string, number>,
  labels: Map<string, string>,
  rootLabel: string,
): Array<{ label: string; cost: number }> {
  const items: Array<{ label: string; cost: number }> = []
  for (const [sid, cost] of costs) {
    const label = sid === root ? rootLabel : (labels.get(sid) ?? sid.slice(0, 8))
    items.push({ label, cost })
  }
  return items
}
