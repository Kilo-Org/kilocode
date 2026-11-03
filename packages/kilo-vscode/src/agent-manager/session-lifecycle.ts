import { runningFromEvent } from "../session-status"
import { samePath } from "./project/paths"
import { sessionCatalogHost } from "./project/init"

type Deps = {
  busy: Set<string>
  removed: Set<string>
}

type Event = { type: string; data?: unknown; location?: { directory?: string } }

function sessionID(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined
  const value = data as Record<string, unknown>
  return typeof value.sessionID === "string" ? value.sessionID : undefined
}

/** A subagent session is not a sidebar root and never enters the catalog. */
function child(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false
  const value = data as Record<string, unknown>
  return typeof value.parentID === "string" && value.parentID.length > 0
}

/** Tracks which sessions the Agent Manager knows are gone, so a late event cannot revive them. */
export function handleSessionLifecycle(event: Event, deps: Deps): void {
  if (event.type === "session.deleted") {
    const id = sessionID(event.data)
    if (!id) return
    deps.removed.add(id)
    deps.busy.delete(id)
    forget(id, deps)
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
  if (!id) return
  deps.removed.delete(id)
  if (child(event.data)) return
  remember(id, event.location?.directory, deps)
}

/**
 * Add one created root session to its project's catalog and post it.
 *
 * The event carries no full record in v2, so the session is read back once. Events can arrive while
 * a project is suspended or before its state is ready; those are dropped because the next state push
 * re-lists the catalog anyway.
 */
function remember(id: string, directory: string | undefined, deps: Deps): void {
  const host = sessionCatalogHost(deps.busy)
  if (!host) return
  const ctx = (directory ? host.contextForDirectory(directory) : undefined) ?? host.contextForSession(id)
  if (!ctx || ctx.lifecycle !== "ready") return
  const generation = ctx.generation
  void host
    .get(id)
    .then((session) => {
      if (!session || deps.removed.has(session.id)) return
      if (session.parentID !== undefined && session.parentID !== null) return
      if (ctx.lifecycle !== "ready" || !ctx.isCurrent(generation)) return
      const state = ctx.peekState()
      const worktreeId =
        state?.getSession(session.id)?.worktreeId ??
        state?.getWorktrees().find((item) => item.path && samePath(item.path, session.location.directory))?.id ??
        null
      ctx.upsertSession({ ...session, worktreeId })
      ctx.invalidateSessions()
      host.post({ type: "agentManager.projectSessions", projectId: ctx.id, sessions: [...ctx.sessions()] })
    })
    .catch(() => undefined)
}

/** Drop one deleted session from the catalog that still holds it and post the remainder. */
function forget(id: string, deps: Deps): void {
  const host = sessionCatalogHost(deps.busy)
  if (!host) return
  const ctx = host.contextForSession(id)
  if (!ctx) return
  ctx.removeLiveSession(id)
  host.post({ type: "agentManager.projectSessions", projectId: ctx.id, sessions: [...ctx.sessions()] })
}
