/**
 * The background subagents of one session, as pure functions over the `kilocode.background-jobs` jobs and the
 * session transcript.
 *
 * The job list is the source of truth. The transcript covers the moments it cannot: before the first list answer and
 * on a server without the background-jobs plugin. Liveness then comes from the child session status, never from the
 * tool part alone, so a stale part cannot show a spinner for an agent that is already gone.
 */

import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"
import type { KiloBackgroundJobsRpc } from "@opencode/schema/kilocode/background-jobs"

export type BackgroundJob = KiloBackgroundJobsRpc.Job
export type BackgroundAgentStatus = KiloBackgroundJobsRpc.Status

export interface BackgroundAgent {
  /** The child session, which is also the job ID. */
  id: string
  description?: string
  agent?: string
  status: BackgroundAgentStatus
  error?: string
  startedAt: number
  finishedAt?: number
  /** A permission or question of the child session waits for the user. */
  waiting: boolean
}

/** A finished agent the user cleared stays hidden; a running one always shows. */
export function showBackgroundAgent(agent: BackgroundAgent, hidden: ReadonlySet<string>): boolean {
  return agent.status === "running" || !hidden.has(agent.id)
}

/** Replace a job by ID, or append it. */
export function upsertJob(jobs: readonly BackgroundJob[], job: BackgroundJob): BackgroundJob[] {
  if (!jobs.some((item) => item.id === job.id)) return [...jobs, job]
  return jobs.map((item) => (item.id === job.id ? job : item))
}

/**
 * Apply a list answer. A job that changed by event while the list was in flight keeps its event version, because the
 * answer can predate that change.
 */
export function mergeListed(
  listed: readonly BackgroundJob[],
  current: readonly BackgroundJob[],
  touched: ReadonlySet<string>,
): BackgroundJob[] {
  const fresh = new Map(current.filter((job) => touched.has(job.id)).map((job) => [job.id, job]))
  const next = listed.map((job) => fresh.get(job.id) ?? job)
  const known = new Set(next.map((job) => job.id))
  return [...next, ...[...fresh.values()].filter((job) => !known.has(job.id))]
}

/** The background agents of one parent session, oldest first. */
export function jobAgents(
  jobs: readonly BackgroundJob[],
  sessionID: string,
  waiting: (sessionID: string) => boolean,
): BackgroundAgent[] {
  return jobs
    .filter((job) => job.parentSessionID === sessionID && job.background)
    .map((job) => ({
      id: job.sessionID,
      description: job.title,
      agent: job.agent,
      status: job.status,
      error: job.error,
      startedAt: job.time.started,
      finishedAt: job.time.completed,
      waiting: job.status === "running" && waiting(job.sessionID),
    }))
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function tools(messages: readonly SessionMessageInfo[]) {
  return messages.flatMap((message) =>
    message.type === "assistant"
      ? message.content.filter((part): part is SessionMessageAssistantTool => part.type === "tool")
      : [],
  )
}

/** The child session a subagent tool part started, once the tool reported it. */
export function subagentChild(part: SessionMessageAssistantTool): string | undefined {
  if (part.name !== "subagent") return undefined
  if (part.state.status === "streaming") return undefined
  return text(part.state.metadata?.sessionID)
}

/** True when the part runs its child in the background: started that way, or continued in the background. */
export function subagentBackground(part: SessionMessageAssistantTool): boolean {
  if (part.state.status === "streaming") return false
  if (part.state.input.background === true) return true
  return part.state.status === "completed" && part.state.metadata?.status === "running"
}

/** The child sessions the current run started: subagent parts after the latest user message. */
export function runChildren(messages: readonly SessionMessageInfo[]): string[] {
  const start = messages.findLastIndex((message) => message.type === "user")
  return [...new Set(tools(messages.slice(start + 1)).flatMap((part) => subagentChild(part) ?? []))]
}

/** Every child session the transcript started, in spawn order. */
export function transcriptChildren(messages: readonly SessionMessageInfo[]): string[] {
  return [...new Set(tools(messages).flatMap((part) => subagentChild(part) ?? []))]
}

/**
 * The child sessions that only the turns hidden by a staged revert started. A child that a kept turn started, and a
 * reverted turn resumed, stays.
 */
export function revertedChildren(
  messages: readonly SessionMessageInfo[],
  visible: readonly SessionMessageInfo[],
): string[] {
  const shown = new Set(visible)
  const kept = new Set(transcriptChildren(visible))
  return transcriptChildren(messages.filter((message) => !shown.has(message))).filter((id) => !kept.has(id))
}

/**
 * Running background agents read from the transcript. The latest part of a child decides, so a child resumed in the
 * foreground no longer counts as a background agent.
 */
export function transcriptAgents(
  messages: readonly SessionMessageInfo[],
  running: (sessionID: string) => boolean,
  waiting: (sessionID: string) => boolean,
): BackgroundAgent[] {
  const latest = new Map<string, SessionMessageAssistantTool>()
  for (const part of tools(messages)) {
    const id = subagentChild(part)
    if (id) latest.set(id, part)
  }
  return [...latest.entries()]
    .filter(([id, part]) => subagentBackground(part) && running(id))
    .map(([id, part]) => {
      const input = part.state.status === "streaming" ? {} : part.state.input
      return {
        id,
        description: text(input.description),
        agent: text(input.agent),
        status: "running" as const,
        startedAt: part.time.created,
        waiting: waiting(id),
      }
    })
}

/** A background agent shown in the dock stack. */
export interface PromptAgent {
  id: string
  description?: string
  agent?: string
  done: boolean
}

/**
 * Merge the running background agents into the dock stack. Agents keep their position, so the stack does not reorder
 * while it is visible. An agent that stops running stays in the stack as done until the caller removes it.
 */
export function mergePromptAgents(prev: PromptAgent[], live: BackgroundAgent[]): PromptAgent[] {
  const running = new Map(live.map((agent) => [agent.id, agent]))
  // Unchanged agents keep their object, so keyed lists keep their DOM nodes and do not replay the enter animation on
  // every status update.
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
 * The width of a stack with `n` avatars for `count` agents. Mirrors the stack CSS: 18px avatars with 3px gaps, 4px
 * side padding, the count text, and the 4px rule margin. Layout code uses this target width instead of measuring,
 * because the measured width changes while the stack animates.
 */
export function stackWidth(n: number, count: number) {
  const rest = count - n
  // One avatar shows the total ("3"), more show the hidden rest ("+7").
  const label = n === 1 ? String(count) : `+${rest}`
  const extra = rest > 0 ? 4 + 7 * label.length : 0
  return 4 + 8 + 18 * n + 3 * (n - 1) + extra
}

/** How many avatars fit in `space` pixels for `count` agents. At least one always shows. */
export function stackFit(space: number, count: number) {
  const top = Math.min(3, Math.max(1, count))
  for (let n = top; n > 1; n--) if (stackWidth(n, count) <= space) return n
  return 1
}

/**
 * Where the stack goes in the wrapping actions row, so it does not push an action onto a new line. `used` is the
 * width taken on each line without the stack. It leads the first line when that line has room, else it ends the
 * first line with room. When no line has room it leads, and the row wraps.
 */
export function stackPlace(used: number[], width: number, need: number) {
  if (used.length === 0 || width - (used.at(0) ?? 0) >= need) return { line: 0, end: false }
  const line = used.findIndex((item) => width - item >= need)
  if (line === -1) return { line: 0, end: false }
  return { line, end: true }
}
