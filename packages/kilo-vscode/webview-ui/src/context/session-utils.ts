import { reconcile } from "solid-js/store"
import type { Message, Part, ToolPart } from "../types/messages"

export const SNAPSHOT_PROGRESS_TEXT = "Initializing snapshot..."

type SnapshotPart = {
  type?: string
  text?: string
  synthetic?: boolean
}

export function snapshotProgress(part: SnapshotPart | undefined): boolean {
  if (part?.type !== "text") return false
  if (!part.synthetic) return false
  return (part.text ?? "").includes("Initializing snapshot")
}

type ParentSession = { parentID?: string | null }

type RecentSession = ParentSession & { updatedAt: string }

export function isRootSession(session: ParentSession): boolean {
  return session.parentID === undefined || session.parentID === null
}

export function recentSessions<T extends RecentSession>(sessions: T[]): T[] {
  return [...sessions]
    .filter(isRootSession)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 3)
}

/** Minimal message shape for cost breakdown helpers. */
export type CostMessage = { id: string; role: string; cost?: number }

/** Minimal tool part shape for label extraction. */
type ToolState = {
  input?: Record<string, unknown>
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

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function withMessage(part: ToolPart, msg: { id: string; sessionID?: string }): ToolPart {
  return {
    ...part,
    messageID: part.messageID ?? msg.id,
    sessionID: part.sessionID ?? msg.sessionID,
  }
}

export type ToolIndexMessage = Pick<Message, "id" | "sessionID" | "role" | "parts">

/**
 * Build the per-session compact tool index in assistant-message order.
 * Text/reasoning deltas should not touch this index, keeping streaming cheap.
 */
export function buildSessionToolParts(
  messages: ToolIndexMessage[],
  lookup?: (message: ToolIndexMessage) => Part[] | undefined,
): ToolPart[] {
  const tools: ToolPart[] = []
  for (const msg of messages) {
    if (msg.role !== "assistant") continue
    const parts = lookup?.(msg) ?? msg.parts
    if (!parts) continue
    for (const part of parts) {
      if (part.type !== "tool") continue
      tools.push(withMessage(part, msg))
    }
  }
  return tools
}

export function reconcileSessionToolParts(tools: ToolPart[]) {
  return reconcile(tools, { key: "id" })
}

export function upsertSessionToolPart(
  current: ToolPart[],
  part: Part,
  msg: { id: string; sessionID?: string },
): ToolPart[] {
  if (part.type !== "tool") return current
  const next = withMessage(part, msg)
  const index = current.findIndex((item) => item.id === part.id)
  if (index < 0) return [...current, next]
  const tools = current.slice()
  tools[index] = next
  return tools
}

export function removeSessionToolPart(current: readonly ToolPart[], partID: string): ToolPart[] {
  return current.filter((part) => part.id !== partID)
}

export function removeSessionToolPartsForMessage(current: readonly ToolPart[], messageID: string): ToolPart[] {
  return current.filter((part) => part.messageID !== messageID)
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
  if (part.type === "text") return snapshotProgress(part) ? SNAPSHOT_PROGRESS_TEXT : t("session.status.writingResponse")
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

export type TokenUsageMessage = {
  role: string
  tokens?: {
    input: number
    output: number
    reasoning?: number
    cache?: { read: number; write: number }
  }
}

export function calcTokenUsage(
  messages: TokenUsageMessage[],
): { input: number; output: number; cached: number } | undefined {
  const total = messages.reduce(
    (sum, m) => {
      if (m.role !== "assistant" || !m.tokens) return sum
      return {
        input: sum.input + m.tokens.input,
        output: sum.output + m.tokens.output,
        cached: sum.cached + (m.tokens.cache?.read ?? 0),
      }
    },
    { input: 0, output: 0, cached: 0 },
  )

  if (total.input > 0 || total.output > 0 || total.cached > 0) return total
  return undefined
}

/**
 * Pick the throughput snapshot from the last step-finish part that carries a
 * `metrics` block. We surface only the most recent assistant turn's rate so
 * the figure reflects what the user is currently waiting on rather than a
 * stale session-wide average — older turns scroll out of view and shouldn't
 * keep pulling the displayed value down.
 *
 * PP (prompt-processing) is intentionally not surfaced here: the AI SDK
 * adapter drops llama.cpp's `prompt_per_second` before providerMetadata
 * reaches computeMetrics, so the wire shape stays `{ prompt?, generation? }`
 * for future use but only `generation` is populated today. PP support lands
 * when the upstream metadataExtractor wiring ships.
 *
 * Returns `undefined` when no step-finish part in the input carries metrics,
 * which is the signal callers use to hide the throughput UI.
 */
export function latestMetrics(parts: readonly Part[]): { generation?: number; source: "computed" } | undefined {
  let generation: number | undefined
  for (const part of parts) {
    if (part.type !== "step-finish") continue
    const metrics = part.metrics
    if (!metrics) continue
    if (metrics.generation !== undefined) generation = metrics.generation
  }
  if (generation === undefined) return undefined
  return { generation, source: "computed" }
}

/**
 * Aggregate tokens-per-second throughput across the step-finish parts of a
 * session. Kept as an alias of `latestMetrics` because the historical name
 * still appears in tests and external callers — both now resolve to the same
 * "last non-empty sample wins" snapshot semantics.
 */
export function aggregateMetrics(parts: readonly Part[]): { generation?: number; source: "computed" } | undefined {
  return latestMetrics(parts)
}

/**
 * Pick the throughput snapshot from a single assistant message's parts.
 * Same selection strategy as `latestMetrics` so the per-message badge and
 * the header row stay consistent.
 */
export function messageMetrics(parts: readonly Part[]): { generation?: number; source: "computed" } | undefined {
  return latestMetrics(parts)
}

/**
 * Weighted generation throughput for a single assistant message. Aggregates
 * output + reasoning tokens across every step-finish part against the sum of
 * their active model-generation durations, so the displayed value represents
 * the turn rather than whichever step happened to finish last.
 *
 * Steps without `time.elapsed`, with non-positive `elapsed`, or with no
 * generated tokens are skipped — tool-only steps, idempotent cache hits,
 * and tool re-execution should not skew the figure.
 */
export function messageThroughput(
  parts: readonly Part[],
): { generation?: number; source: "computed" } | undefined {
  let generated = 0
  let elapsedMs = 0
  for (const part of parts) {
    if (part.type !== "step-finish") continue
    const time = part.time
    if (!time || !Number.isFinite(time.elapsed) || time.elapsed <= 0) continue
    const tokens = part.tokens
    if (!tokens) continue
    const stepGenerated = tokens.output + (tokens.reasoning ?? 0)
    if (stepGenerated <= 0) continue
    generated += stepGenerated
    elapsedMs += time.elapsed
  }
  if (generated <= 0 || elapsedMs <= 0) return undefined
  const generation = (generated * 1000) / elapsedMs
  if (!Number.isFinite(generation) || generation <= 0) return undefined
  return { generation, source: "computed" }
}

/**
 * Weighted generation throughput across the flat array of parts from every
 * message in a session. Same weighted semantics as `messageThroughput` —
 * useful when a caller has already flattened parts across messages.
 */
export function sessionThroughput(
  parts: readonly Part[],
): { generation?: number; source: "computed" } | undefined {
  return messageThroughput(parts)
}

/**
 * Format a text-generation rate for display. Shared by every rendering site
 * so the same value reads the same in the per-message badge and the
 * aggregated header row.
 */
function formatRateValue(value: number | undefined, locale: string): string {
  if (!Number.isFinite(value) || value === undefined || value <= 0) return "–"
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} t/s`
}

export function formatTG(value: number | undefined, locale: string) {
  return formatRateValue(value, locale)
}

/**
 * Build a map of session ID → **own cost** for each session in the family
 * that has non-zero own cost.
 *
 * The CLI backend already propagates each subagent's total up into its
 * parent assistant message when the subagent finishes (see
 * `packages/opencode/src/kilocode/session/cost-propagation.ts`), so a
 * session's `message.info.cost` sum is actually the whole sub-tree rooted
 * at that session, not its own LLM usage. Summing every session in the
 * family would double-count the propagated amounts.
 *
 * To present a breakdown whose entries sum to the root's propagated total
 * (== the family's true cost), we subtract each session's propagated
 * total from its parent's figure. The root's entry then holds its own
 * LLM cost, each subagent's entry holds its own LLM cost, and the sum
 * equals the root's `message.info.cost` — matching the backend's number.
 *
 * Pure function — no store dependency.
 */
export function buildFamilyCosts(
  family: Set<string>,
  messages: Record<string, Array<{ role: string; cost?: number }>>,
  sessions: Record<string, { parentID?: string | null } | undefined>,
  parents: Map<string, string> = new Map(),
): Map<string, number> {
  const totals = new Map<string, number>()
  for (const sid of family) totals.set(sid, calcTotalCost(messages[sid] ?? []))

  const own = new Map<string, number>(totals)
  for (const sid of family) {
    const parent = sessions[sid]?.parentID ?? parents.get(sid)
    if (!parent || !own.has(parent)) continue
    own.set(parent, (own.get(parent) ?? 0) - (totals.get(sid) ?? 0))
  }

  const costs = new Map<string, number>()
  for (const [sid, cost] of own) {
    if (cost > 0) costs.set(sid, cost)
  }
  return costs
}

/**
 * Build child session ID -> parent session ID links from task tool metadata.
 * This fills the gap when child messages are synced before their SessionInfo.
 */
export function buildFamilyParents(
  family: Set<string>,
  messages: Record<string, CostMessage[]>,
  parts: Record<string, TaskPart[]>,
): Map<string, string> {
  return buildFamilyParentsFromTools(family, (sid) => {
    const msgs = messages[sid]
    if (!msgs) return []
    return msgs.flatMap((msg) => parts[msg.id] ?? [])
  })
}

export function buildFamilyParentsFromTools(
  family: Set<string>,
  tools: (sessionID: string) => readonly TaskPart[],
): Map<string, string> {
  const parents = new Map<string, string>()
  for (const sid of family) {
    for (const p of tools(sid)) {
      const child = childID(p)
      if (!child || !family.has(child) || parents.has(child)) continue
      parents.set(child, sid)
    }
  }
  return parents
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
  return buildFamilyLabelsFromTools(family, (sid) => {
    const msgs = messages[sid]
    if (!msgs) return []
    return msgs.flatMap((msg) => parts[msg.id] ?? [])
  })
}

export function buildFamilyLabelsFromTools(
  family: Set<string>,
  tools: (sessionID: string) => readonly TaskPart[],
): Map<string, string> {
  const labels = new Map<string, string>()
  for (const sid of family) {
    for (const p of tools(sid)) {
      if (p.type !== "tool") continue
      const child = childID(p)
      if (!child || !family.has(child)) continue
      const raw =
        stringField(p.state?.input?.subagent_type) ?? stringField(p.state?.input?.description) ?? p.tool ?? "task"
      const desc = raw.length > LABEL_CAP ? raw.slice(0, LABEL_CAP - 2) + "…" : raw
      if (!labels.has(child)) labels.set(child, desc)
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
