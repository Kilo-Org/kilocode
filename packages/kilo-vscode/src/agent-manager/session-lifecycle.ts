import { runningFromEvent } from "../session-status"

type Deps = {
  busy: Set<string>
  removed: Set<string>
}

type Event = { type: string; data?: unknown }

function sessionID(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined
  const value = data as Record<string, unknown>
  return typeof value.sessionID === "string" ? value.sessionID : undefined
}

/** Tracks which sessions the Agent Manager knows are gone, so a late event cannot revive them. */
export function handleSessionLifecycle(event: Event, deps: Deps): void {
  if (event.type === "session.deleted") {
    const id = sessionID(event.data)
    if (!id) return
    deps.removed.add(id)
    deps.busy.delete(id)
    return
  }
  const running = runningFromEvent(event as Parameters<typeof runningFromEvent>[0])
  if (running) {
    if (running.running) {
      if (!deps.removed.has(running.sessionID)) deps.busy.add(running.sessionID)
      return
    }
    deps.busy.delete(running.sessionID)
    return
  }
  if (event.type !== "session.created") return
  const id = sessionID(event.data)
  if (id) deps.removed.delete(id)
}