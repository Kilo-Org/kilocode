// The pure usage helpers of the task header: subtree cost and tokens, context usage, the model catalog lookups,
// the tool child labels, and the per-model usage rows.
import type {
  JsonValue,
  ModelInfo,
  ModelRef,
  ProviderInfo,
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  TokenUsageInfo,
} from "@opencode/client"
import { lastAssistantWithUsage } from "@opencode/client/solid"
import { revertedChildren } from "../components/chat/background-agents"
import { visibleMessages } from "./revert"

type UsageTokens = TokenUsageInfo

export type ModelUsage = {
  providerID: string
  modelID: string
  steps: number
  cost: number
  tokens: UsageTokens
}

type ModelUsageTotals = {
  steps: number
  cost: number
  tokens: UsageTokens
}

const DATE_SUFFIX = /-(?:\d{8}|\d{4}-\d{2}-\d{2})$/
const LABEL_CAP = 24
const VISIBLE_CHILDREN = 8
// The subagent tool is named `subagent`; older sessions can still carry `task`.
const CHILD_TOOLS: ReadonlySet<string> = new Set(["subagent", "task"])

export function sessionSubtree(family: readonly SessionInfo[], sessionID: string): SessionInfo[] {
  const members = new Map(family.map((item) => [item.id, item]))

  // A member belongs to the subtree when its parent chain reaches the viewed session. The seen set stops a parent
  // cycle from turning the walk into an infinite loop.
  const inside = (item: SessionInfo) => {
    const seen = new Set([item.id])
    let parentID = item.parentID
    while (parentID) {
      if (parentID === sessionID) return true
      if (seen.has(parentID)) return false
      seen.add(parentID)
      parentID = members.get(parentID)?.parentID
    }
    return false
  }

  const root = members.get(sessionID)
  const descendants = family.filter((item) => item.id !== sessionID && inside(item))
  return root ? [root, ...descendants] : descendants
}

/**
 * The header members as staged reverts leave them, as v1 derived the family from the visible turns: a child that only
 * reverted turns started drops out with its own subagents, and a reverted session's cost and tokens leave out the
 * steps the revert hides. The hidden steps are the newest, so the loaded transcript holds them.
 */
export function revertedMembers(
  members: readonly SessionInfo[],
  messages: (sessionID: string) => readonly SessionMessageInfo[],
): SessionInfo[] {
  const hidden = new Set(
    members.flatMap((member) => {
      if (!member.revert) return []
      const all = messages(member.id)
      return revertedChildren(all, visibleMessages(all, member.revert))
    }),
  )
  const kept = members.filter((member) => !hidden.has(member.id) && !hiddenAncestor(member, members, hidden))
  return kept.map((member) => {
    if (!member.revert) return member
    const all = messages(member.id)
    const shown = new Set(visibleMessages(all, member.revert))
    const steps = all.filter(
      (message): message is SessionMessageAssistant => message.type === "assistant" && !shown.has(message),
    )
    const cost = steps.reduce((total, step) => total + (step.cost ?? 0), 0)
    const tokens = steps.reduce((total, step) => (step.tokens ? addTokens(total, step.tokens) : total), emptyTokens())
    return {
      ...member,
      cost: Math.max(0, member.cost - cost),
      tokens: subtractTokens(member.tokens, tokens),
    }
  })
}

function hiddenAncestor(member: SessionInfo, members: readonly SessionInfo[], hidden: ReadonlySet<string>) {
  const byID = new Map(members.map((item) => [item.id, item]))
  const seen = new Set([member.id])
  let parentID = member.parentID
  while (parentID && !seen.has(parentID)) {
    if (hidden.has(parentID)) return true
    seen.add(parentID)
    parentID = byID.get(parentID)?.parentID
  }
  return false
}

function subtractTokens(a: UsageTokens, b: UsageTokens): UsageTokens {
  return {
    input: Math.max(0, a.input - b.input),
    output: Math.max(0, a.output - b.output),
    reasoning: Math.max(0, a.reasoning - b.reasoning),
    cache: { read: Math.max(0, a.cache.read - b.cache.read), write: Math.max(0, a.cache.write - b.cache.write) },
  }
}

export function sumTokens(members: readonly SessionInfo[]): UsageTokens {
  return members.reduce((total, member) => addTokens(total, member.tokens), emptyTokens())
}

export function sumCost(members: readonly SessionInfo[]): number {
  return members.reduce((total, member) => total + member.cost, 0)
}

export function costBreakdown(
  members: readonly SessionInfo[],
  labels: ReadonlyMap<string, string>,
  rootID: string,
  rootLabel: string,
): Array<{ label: string; cost: number }> {
  const priced = members.filter((member) => member.cost > 0)
  // The family is registered newest-first. Collapse expects chronological children and reverses them, so sort the
  // children by creation time here to keep the newest entries visible.
  const children = priced.filter((member) => member.id !== rootID).toSorted((a, b) => a.time.created - b.time.created)
  const ordered = [...priced.filter((member) => member.id === rootID), ...children]
  return ordered.map((member) => ({
    label: member.id === rootID ? rootLabel : (labels.get(member.id) ?? member.id.slice(0, 8)),
    cost: member.cost,
  }))
}

export function collapseCostBreakdown(
  items: ReadonlyArray<{ label: string; cost: number }>,
  summaryLabel: (count: number) => string,
): Array<{ label: string; cost: number }> {
  const root = items[0]
  if (!root) return []
  const reversed = items.slice(1).reverse()
  if (reversed.length <= VISIBLE_CHILDREN) return [root, ...reversed]

  const visible = reversed.slice(0, VISIBLE_CHILDREN)
  const hidden = reversed.slice(VISIBLE_CHILDREN)
  return [
    root,
    ...visible,
    { label: summaryLabel(hidden.length), cost: hidden.reduce((total, item) => total + item.cost, 0) },
  ]
}

export function contextUsage(
  messages: readonly SessionMessageInfo[],
  limit: number | undefined,
  boundary?: string,
): { tokens: number; percentage: number | null } | undefined {
  const step = lastAssistantWithUsage(messages, boundary)
  if (!step) return undefined
  const tokens = totalTokens(step.tokens)
  if (tokens === 0) return undefined
  const percentage = limit !== undefined && limit > 0 ? Math.round((tokens / limit) * 100) : null
  return { tokens, percentage }
}

export function latestModel(messages: readonly SessionMessageInfo[]): ModelRef | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.type === "assistant" && message.model) return message.model
  }
  return undefined
}

export function findModel(
  models: readonly ModelInfo[] | undefined,
  model: Pick<ModelRef, "providerID" | "id"> | undefined,
): ModelInfo | undefined {
  if (!model || !models) return undefined
  const exact = models.find((item) => item.providerID === model.providerID && item.id === model.id)
  if (exact) return exact
  const id = model.id.replace(DATE_SUFFIX, "")
  return models.find((item) => item.providerID === model.providerID && item.id === id)
}

export function modelLabel(
  model: Pick<ModelRef, "providerID" | "id">,
  models: readonly ModelInfo[] | undefined,
): string {
  const name = (findModel(models, model)?.name ?? model.id.replace(DATE_SUFFIX, "")).trim()
  const trimmed = name.replace(/\s*\(free\)$/i, "").trim()
  const stripped = model.providerID === "kilo" ? trimmed.replace(/^[^:]+:\s+/, "") : trimmed
  return stripped.replace(/\s+/g, " ").trim()
}

/** The catalog model and context usage of the step that owns the current context window. */
export function sessionUsage(
  messages: readonly SessionMessageInfo[],
  models: readonly ModelInfo[] | undefined,
  sessionModel: Pick<ModelRef, "providerID" | "id"> | undefined,
  boundary?: string,
) {
  const model = findModel(models, latestModel(messages) ?? sessionModel)
  return { model, usage: contextUsage(messages, model?.limit.context, boundary) }
}

export function childLabels(messagesBySession: Iterable<readonly SessionMessageInfo[]>): Map<string, string> {
  const labels = new Map<string, string>()
  for (const messages of messagesBySession) {
    for (const message of messages) {
      if (message.type !== "assistant") continue
      for (const part of message.content) {
        if (part.type !== "tool" || !CHILD_TOOLS.has(part.name)) continue
        const child = taskChild(part)
        if (child && !labels.has(child.id)) labels.set(child.id, child.label)
      }
    }
  }
  return labels
}

export function modelUsage(messages: readonly SessionMessageInfo[]): {
  totals: ModelUsageTotals
  models: ModelUsage[]
} {
  const rows = new Map<string, ModelUsage>()
  for (const message of messages) {
    if (message.type !== "assistant" || !message.tokens) continue
    const model = routedModel(message)
    const key = `${model.providerID}/${model.id}`
    const row = rows.get(key) ?? {
      providerID: model.providerID,
      modelID: model.id,
      steps: 0,
      cost: 0,
      tokens: emptyTokens(),
    }
    rows.set(key, {
      ...row,
      steps: row.steps + 1,
      cost: row.cost + Math.max(0, message.cost ?? 0),
      tokens: addTokens(row.tokens, message.tokens),
    })
  }

  const models = [...rows.values()].toSorted(
    (a, b) => b.cost - a.cost || a.providerID.localeCompare(b.providerID) || a.modelID.localeCompare(b.modelID),
  )
  const totals = models.reduce(
    (total, row) => ({
      steps: total.steps + row.steps,
      cost: total.cost + row.cost,
      tokens: addTokens(total.tokens, row.tokens),
    }),
    { steps: 0, cost: 0, tokens: emptyTokens() },
  )
  return { totals, models }
}

export function groupModelsByProvider(
  models: readonly ModelUsage[],
  providers: readonly Pick<ProviderInfo, "id" | "name">[],
): Array<{ providerID: string; providerName: string; models: ModelUsage[] }> {
  const names = new Map(providers.map((provider) => [provider.id, provider.name]))
  const groups = new Map<string, { providerID: string; providerName: string; models: ModelUsage[] }>()
  for (const model of models) {
    const group = groups.get(model.providerID) ?? {
      providerID: model.providerID,
      providerName: names.get(model.providerID) ?? model.providerID,
      models: [],
    }
    group.models.push(model)
    groups.set(model.providerID, group)
  }
  return [...groups.values()]
}

export function cacheRate(tokens: UsageTokens): string {
  const total = tokens.input + tokens.cache.read + tokens.cache.write
  if (total === 0) return "-"
  return `${((tokens.cache.read / total) * 100).toFixed(1)}%`
}

export async function fetchSessionMessages(
  client: {
    message: {
      list: (
        input: { sessionID: string; limit?: number; cursor?: string },
        options?: { signal?: AbortSignal },
      ) => Promise<{ data: SessionMessageInfo[]; cursor: { next?: string | null } }>
    }
  },
  sessionID: string,
  signal?: AbortSignal,
  maxPages = 20,
): Promise<SessionMessageInfo[]> {
  const messages: SessionMessageInfo[] = []
  let cursor: string | undefined
  let pages = 0
  while (!signal?.aborted && pages < maxPages) {
    const page = await client.message
      .list({ sessionID, limit: 200, cursor }, signal ? { signal } : undefined)
      .catch((error: unknown) => {
        if (signal?.aborted) return undefined
        throw error
      })
    if (!page) break
    pages++
    messages.push(...page.data)
    const next = page.cursor.next
    if (!next) break
    cursor = next
  }
  return messages
}

/** Merge per-member model rows into one list, keyed by the routed model. */
export function mergeModelUsage(rows: Iterable<readonly ModelUsage[]>): ModelUsage[] {
  const merged = new Map<string, ModelUsage>()
  for (const list of rows) {
    for (const row of list) {
      const key = `${row.providerID}/${row.modelID}`
      const current = merged.get(key) ?? { ...row, steps: 0, cost: 0, tokens: emptyTokens() }
      merged.set(key, {
        ...current,
        steps: current.steps + row.steps,
        cost: current.cost + row.cost,
        tokens: addTokens(current.tokens, row.tokens),
      })
    }
  }
  return [...merged.values()].toSorted(
    (a, b) => b.cost - a.cost || a.providerID.localeCompare(b.providerID) || a.modelID.localeCompare(b.modelID),
  )
}

function emptyTokens(): UsageTokens {
  return { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
}

function addTokens(a: UsageTokens, b: UsageTokens): UsageTokens {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
    cache: { read: a.cache.read + b.cache.read, write: a.cache.write + b.cache.write },
  }
}

function totalTokens(tokens: UsageTokens): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

function routedModel(message: SessionMessageAssistant): ModelRef {
  const kilo = message.native?.kilo
  const id = isRecord(kilo) ? kilo.routedModelID : undefined
  if (typeof id === "string" && id.trim() && id.trim() !== message.model.id) {
    return { ...message.model, id: id.trim() }
  }
  return message.model
}

function isRecord(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringField(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function taskChild(part: SessionMessageAssistantTool): { id: string; label: string } | undefined {
  const state = part.state
  if (state.status === "streaming") return undefined
  const id = state.metadata?.sessionID
  if (typeof id !== "string" || !id) return undefined
  const label = stringField(state.input.description) ?? stringField(state.input.agent) ?? part.name
  return { id, label: label.length > LABEL_CAP ? `${label.slice(0, LABEL_CAP - 1)}…` : label }
}
