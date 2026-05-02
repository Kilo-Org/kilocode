import type { Part, StepMetrics } from "../types/messages"

/** Minimal message shape for cost breakdown helpers. */
export type CostMessage = { id: string; role: string; cost?: number }

/** Minimal tool part shape for label extraction. */
type ToolState = {
  input?: { description?: string; subagent_type?: string }
  metadata?: { sessionId?: string }
}

type TaskPart = {
  type: string
  tool?: string
  metadata?: { sessionId?: string }
  state?: ToolState
}

export function childID(part: TaskPart): string | undefined {
  if (part.type !== "tool" || part.tool !== "task") return undefined
  return part.metadata?.sessionId ?? part.state?.metadata?.sessionId
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

export function formatRate(input: number | undefined): string | undefined {
  if (input === undefined) return undefined
  if (!Number.isFinite(input)) return undefined
  if (input <= 0) return undefined
  return `${input.toFixed(1)} t/s`
}

export function latestRates(
  msgs: Array<{ id?: string; role?: string; parts?: Array<{ type?: string; metrics?: StepMetrics }> }>,
  all?: Record<string, Array<{ type?: string; metrics?: StepMetrics }>>,
) {
  const msg = [...msgs].reverse().find((item) => {
    if (item.role !== "assistant") return false
    const parts = item.parts ?? (item.id ? all?.[item.id] : undefined)
    return parts?.some((part) => part.type === "step-finish" && part.metrics)
  })
  const parts = msg?.parts ?? (msg?.id ? all?.[msg.id] : undefined) ?? []
  const part = [...parts].reverse().find((item) => item.type === "step-finish" && item.metrics)
  if (!part?.metrics) return undefined
  const rate = part.metrics.rate
  const generation = rate.generation ?? rate.output
  if (!rate.prompt && !generation && !rate.output) return undefined
  return { prompt: rate.prompt, generation, output: rate.output }
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
  parts: Record<string, TaskPart[]>,
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
        const child = childID(p)
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

const VISIBLE_CHILDREN = 8

/**
 * Collapse a cost breakdown for display in the tooltip.
 * - The root entry (first item) always stays at the top.
 * - Child entries are shown in reverse order (most recent first).
 * - When there are more than VISIBLE_CHILDREN child entries, the
 *   oldest are aggregated into a single summary line.
 *
 * Pure function — no store dependency.
 */
export function collapseCostBreakdown(
  items: Array<{ label: string; cost: number }>,
  summaryLabel: (count: number) => string,
): Array<{ label: string; cost: number }> {
  const root = items[0]
  const children = items.slice(1)
  const reversed = [...children].reverse()

  if (reversed.length <= VISIBLE_CHILDREN) return [root, ...reversed]

  const visible = reversed.slice(0, VISIBLE_CHILDREN)
  const hidden = reversed.slice(VISIBLE_CHILDREN)
  const aggregated = hidden.reduce((sum, e) => sum + e.cost, 0)
  return [root, ...visible, { label: summaryLabel(hidden.length), cost: aggregated }]
}
