import { createMemo } from "solid-js"
import type { ManagedSessionState } from "../../src/types/messages/agent-manager"
import type { ProjectSessionInfo, SessionInfo } from "../../src/types/messages/sessions"
import { isKnownRootSession } from "../navigate"

/**
 * Sidebar session lists per project. Background projects use the pushed
 * snapshot; the active project is overlaid with the live session store so a
 * freshly created session shows up without waiting for a backend re-list.
 * Extras are restricted to sessions the project itself tracks (managed or
 * open in its local tabs) so stale entries from another project's store
 * can never bleed in after a switch.
 */
export function createProjectSessionsLive(opts: {
  base: () => Record<string, ProjectSessionInfo[]>
  pid: () => string | undefined
  enabled: () => boolean
  store: () => SessionInfo[]
  managed: () => ManagedSessionState[]
  locals: () => Set<string>
}) {
  return createMemo(() => {
    const base = opts.base()
    const pid = opts.pid()
    if (!pid || !opts.enabled()) return base
    const pushed = base[pid] ?? []
    const store = opts.store()
    if (store.length === 0) return base
    const managed = new Map(opts.managed().map((ms) => [ms.id, ms.worktreeId]))
    const live = new Map(store.filter(isKnownRootSession).map((item) => [item.id, item]))
    const merged = pushed.map((item) => {
      const fresh = live.get(item.id)
      const worktreeId = managed.has(item.id) ? managed.get(item.id)! : item.worktreeId
      return fresh ? { ...fresh, worktreeId } : worktreeId === item.worktreeId ? item : { ...item, worktreeId }
    })
    const known = new Set(pushed.map((item) => item.id))
    const owned = (id: string) => managed.has(id) || opts.locals().has(id)
    const extra = store
      .filter((item) => isKnownRootSession(item) && !known.has(item.id) && owned(item.id))
      .map((item) => ({ ...item, worktreeId: managed.get(item.id) ?? null }))
    if (extra.length === 0 && merged.every((item, index) => item === pushed[index])) return base
    return { ...base, [pid]: [...merged, ...extra] }
  })
}
