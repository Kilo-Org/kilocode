// Kilo v2 session activity: a session is running from `session.status` busy/retry or `session.execution.started`
// until `session.idle` or a terminal execution event.
import type { OpenCodeClient, OpenCodeEvent } from "@opencode/client"

export type RunningStatus = "busy" | "retry"

/** A retained `session.status` value that represents active work. */
export function isRunningStatus(type: string | undefined): type is RunningStatus {
  return type === "busy" || type === "retry"
}

const RUNNING: ReadonlySet<string> = new Set(["session.execution.started", "session.retry.scheduled"])
const IDLE: ReadonlySet<string> = new Set([
  "session.idle",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.deleted",
])

/** The running state a session event implies, or undefined when the event says nothing about it. */
export function runningFromEvent(event: OpenCodeEvent): { sessionID: string; running: boolean } | undefined {
  if (!("sessionID" in event.data)) return undefined
  const sessionID = String(event.data.sessionID)
  if (RUNNING.has(event.type)) return { sessionID, running: true }
  if (IDLE.has(event.type)) return { sessionID, running: false }
  if (event.type !== "session.status") return undefined
  const status = "status" in event.data ? event.data.status : undefined
  const type = typeof status === "object" && status !== null && "type" in status ? String(status.type) : undefined
  return { sessionID, running: isRunningStatus(type) }
}

/** The sessions the server reports as running right now. */
export async function fetchRunningSessions(client: OpenCodeClient): Promise<Set<string>> {
  const active = await client.session.active().catch(() => ({}))
  return new Set(Object.keys(active))
}
