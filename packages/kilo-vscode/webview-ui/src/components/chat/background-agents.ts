/**
 * Derive the running background sub-agents of one session.
 *
 * Everything needed is already in the session store: `task` tool parts carry
 * the child session id and the `background` flag, and the status map covers
 * child sessions because the extension adopts them as soon as a task part
 * reveals their id.
 *
 * The input is the per-session tool index, so the strip of one session never
 * lists agents started by another loaded session.
 *
 * Liveness comes from the status map, never from the part status alone, so a
 * stale `running` part left over from an earlier backend process cannot show a
 * spinner for an agent that is already gone.
 */

import type {
  BackgroundJobInfo,
  PermissionRequest,
  QuestionRequest,
  SessionStatusInfo,
  ToolPart,
} from "../../types/messages"

export type BackgroundAgentStatus = BackgroundJobInfo["status"]

export interface BackgroundAgent {
  /** Child session id, used to open the sub-agent viewer. */
  id: string
  description?: string
  agent?: string
  status: BackgroundAgentStatus
  error?: string
  startedAt: number
  jobID: string
  permission?: PermissionRequest
  question?: QuestionRequest
}

export function fitBackgroundAgents(widths: number[], space: number, overflow: number, gap: number): number {
  const total = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * gap
  if (total <= space) return widths.length
  let used = 0
  let count = 0
  for (const width of widths) {
    const next = used + width + (count > 0 ? gap : 0)
    if (next + gap + overflow > space) break
    used = next
    count += 1
  }
  return count
}

export function showBackgroundAgent(agent: BackgroundAgent, hidden: ReadonlySet<string>): boolean {
  return agent.status === "running" || !hidden.has(agent.jobID)
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

/** Read tool metadata, matching the lookup order of `childID()`. */
function meta(part: ToolPart, key: string): unknown {
  const top = part.metadata?.[key]
  if (top !== undefined) return top
  return (part.state as { metadata?: Record<string, unknown> }).metadata?.[key]
}

/** Child session IDs of Task tool parts. */
export function taskChildren(tools: ToolPart[]): string[] {
  const ids: string[] = []
  for (const part of tools) {
    if (part.tool !== "task") continue
    const id = text(meta(part, "sessionId"))
    if (!id || ids.includes(id)) continue
    ids.push(id)
  }
  return ids
}

function working(status: SessionStatusInfo | undefined): boolean {
  return status?.type === "busy" || status?.type === "retry"
}

export function backgroundAgents(tools: ToolPart[], status: Record<string, SessionStatusInfo>): BackgroundAgent[] {
  const agents: BackgroundAgent[] = []
  const latest = new Map<string, ToolPart>()
  for (const part of tools) {
    if (part.tool !== "task") continue
    const id = text(meta(part, "sessionId"))
    if (!id) continue
    latest.set(id, part)
  }
  for (const part of latest.values()) {
    if (meta(part, "background") !== true) continue
    const id = text(meta(part, "sessionId"))
    if (!id) continue
    if (!working(status[id])) continue
    agents.push({
      id,
      description: text(part.state.input?.description),
      agent: text(part.state.input?.subagent_type),
      status: "running",
      startedAt: 0,
      jobID: id,
    })
  }
  return agents
}

/** A background agent shown in the prompt status stack. */
export interface PromptAgent {
  id: string
  description?: string
  agent?: string
  done: boolean
}

/**
 * Merge the running background agents into the prompt stack. Agents keep their
 * position, so the stack does not reorder while it is visible. An agent that
 * stops running stays in the stack as done until the caller removes it.
 */
export function mergePromptAgents(prev: PromptAgent[], live: BackgroundAgent[]): PromptAgent[] {
  const running = new Map(live.map((agent) => [agent.id, agent]))
  // Unchanged agents keep their object, so keyed lists keep their DOM nodes
  // and do not replay the enter animation on every status update.
  const next = prev.map((item) => {
    const agent = running.get(item.id)
    if (!agent) return item.done ? item : { ...item, done: true }
    if (!item.done && item.description === agent.description && item.agent === agent.agent) return item
    return { id: item.id, description: agent.description, agent: agent.agent, done: false }
  })
  for (const agent of live) {
    if (prev.some((item) => item.id === agent.id)) continue
    next.push({ id: agent.id, description: agent.description, agent: agent.agent, done: false })
  }
  return next
}

/**
 * The width of a stack with `n` avatars for `count` agents. Mirrors the stack
 * CSS: 18px avatars with 3px gaps, 4px side padding, the count text, and the
 * 4px rule margin. Layout code uses this target width instead of measuring,
 * because the measured width changes while the stack animates.
 */
export function stackWidth(n: number, count: number) {
  const rest = count - n
  // One avatar shows the total ("3"), more show the hidden rest ("+7").
  const text = n === 1 ? String(count) : `+${rest}`
  const extra = rest > 0 ? 4 + 7 * text.length : 0
  return 4 + 8 + 18 * n + 3 * (n - 1) + extra
}

/** How many avatars fit in `space` pixels for `count` agents. At least one always shows. */
export function stackFit(space: number, count: number) {
  const top = Math.min(3, Math.max(1, count))
  for (let n = top; n > 1; n--) if (stackWidth(n, count) <= space) return n
  return 1
}

/**
 * Where the stack goes in the wrapping actions row, so it does not push an
 * action onto a new line. `used` is the width taken on each line without the
 * stack. It leads the first line when that line has room, else it ends the
 * first line with room. When no line has room it leads, and the row wraps.
 */
export function stackPlace(used: number[], width: number, need: number) {
  if (used.length === 0 || width - (used.at(0) ?? 0) >= need) return { line: 0, end: false }
  const line = used.findIndex((item) => width - item >= need)
  if (line === -1) return { line: 0, end: false }
  return { line, end: true }
}

export function backgroundJobAgents(
  jobs: BackgroundJobInfo[],
  sessionID: string,
  permissions: PermissionRequest[] = [],
  questions: QuestionRequest[] = [],
): BackgroundAgent[] {
  return jobs
    .filter((job) => {
      if (job.type !== "task") return false
      if (job.metadata?.parentSessionId !== sessionID) return false
      return job.metadata?.background === true
    })
    .map((job) => {
      const id = typeof job.metadata?.sessionId === "string" ? job.metadata.sessionId : job.id
      return {
        id,
        description: job.title,
        status: job.status,
        error: job.error,
        startedAt: job.started_at,
        jobID: job.id,
        permission: permissions.find((item) => item.sessionID === id),
        question: questions.find((item) => item.sessionID === id),
      }
    })
}
