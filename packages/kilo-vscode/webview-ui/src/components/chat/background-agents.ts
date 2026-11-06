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
import type { RevertBoundary } from "../../context/session-queue"

export type BackgroundAgentStatus = BackgroundJobInfo["status"]

export interface BackgroundAgent {
  /** Child session id, used to open the sub-agent viewer. */
  id: string
  description?: string
  agent?: string
  status: BackgroundAgentStatus
  error?: string
  startedAt: number
  finishedAt?: number
  jobID: string
  permission?: PermissionRequest
  question?: QuestionRequest
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

/**
 * True when a tool call started something the agent map shows: a Task
 * subagent, Agent Manager sessions, or a background process. The other
 * `agent_manager` and `background_process` actions only act on what exists.
 * Mirrors `starts()` in `src/kilo-provider/agent-map.ts`.
 */
export function starter(part: ToolPart): boolean {
  if (part.tool === "task") return !!text(meta(part, "sessionId"))
  if (part.tool === "agent_manager") return !!text(meta(part, "requestID"))
  if (part.tool !== "background_process") return false
  return ["start", "monitor"].includes(String(part.state.input?.action)) && !!text(meta(part, "processID"))
}

/**
 * True when the chat still shows a tool part under the session's revert.
 * Message and part IDs sort in the order they were created.
 */
export function shown(part: ToolPart, revert?: RevertBoundary | null): boolean {
  const message = part.messageID ?? ""
  if (!revert || message < revert.messageID) return true
  return message === revert.messageID && !!revert.partID && part.id < revert.partID
}

/** Child sessions that only reverted turns started. */
export function reverted(tools: ToolPart[], revert?: RevertBoundary | null): Set<string> {
  if (!revert) return new Set()
  const kept = new Set(taskChildren(tools.filter((part) => shown(part, revert))))
  return new Set(taskChildren(tools).filter((id) => !kept.has(id)))
}

/** The latest Task tool part that ran the child session `id`. */
export function taskPart(tools: ToolPart[], id: string): ToolPart | undefined {
  return tools.findLast((part) => part.tool === "task" && text(meta(part, "sessionId")) === id)
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
 * Where the dock's agent map button goes in the wrapping actions row, so it
 * does not push an action onto a new line. `used` is the width taken on each
 * line without the button. It leads the first line when that line has room,
 * else it ends the first line with room. When no line has room it leads, and
 * the row wraps.
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
        finishedAt: job.completed_at,
        jobID: job.id,
        permission: permissions.find((item) => item.sessionID === id),
        question: questions.find((item) => item.sessionID === id),
      }
    })
}
