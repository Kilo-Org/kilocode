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

/** Child session IDs of every Task tool part, in spawn order, without duplicates. */
export function children(tools: ToolPart[]): string[] {
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
