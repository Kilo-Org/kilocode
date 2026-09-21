import type { Session } from "@kilocode/sdk/v2/client"
import { sessionToWebview } from "../kilo-provider-utils"
import { samePath } from "./project/paths"
import type { ProjectContexts } from "./project/contexts"
import type { AgentManagerOutMessage } from "./types"

type Deps = {
  busy: Set<string>
  removed: Set<string>
  contexts: ProjectContexts
  closeBrowser: (sessionId: string) => void
  post: (message: AgentManagerOutMessage) => void
}

type Event = { type?: string; properties?: { info?: Session; sessionID?: string } }

function remove(id: string, deps: Deps): void {
  deps.removed.add(id)
  deps.busy.delete(id)
  deps.closeBrowser(id)
  const ctx = deps.contexts.byLiveSession(id)
  if (!ctx) return
  ctx.removeLiveSession(id)
  deps.post({ type: "agentManager.projectSessions", projectId: ctx.id, sessions: [...ctx.sessions()] })
}

function upsert(info: Session, deps: Deps): void {
  if (deps.removed.has(info.id)) return
  const dir = info.directory
  if (!info.time || !dir || (info.parentID !== undefined && info.parentID !== null)) return
  const ctx = deps.contexts.byDirectory(dir)
  if (!ctx || ctx.lifecycle !== "ready") return
  const state = ctx.peekState()
  const managed = state?.getSession(info.id)
  const worktreeId =
    managed?.worktreeId ?? state?.getWorktrees().find((wt) => wt.path && samePath(wt.path, dir))?.id ?? null
  ctx.upsertSession({ ...sessionToWebview(info), worktreeId })
  ctx.invalidateSessions()
  deps.post({ type: "agentManager.projectSessions", projectId: ctx.id, sessions: [...ctx.sessions()] })
}

export function handleSessionLifecycle(event: unknown, deps: Deps): void {
  const ev = event as Event
  if (ev.type === "session.error") {
    if (ev.properties?.sessionID) deps.busy.delete(ev.properties.sessionID)
    return
  }
  if (ev.type === "session.deleted") {
    const id = ev.properties?.sessionID ?? ev.properties?.info?.id
    if (id) remove(id, deps)
    return
  }
  const info = ev.properties?.info
  if (!info) return
  if (ev.type === "session.created") deps.removed.delete(info.id)
  upsert(info, deps)
}
