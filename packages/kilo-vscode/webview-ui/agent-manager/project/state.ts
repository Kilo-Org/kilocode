import type { AgentManagerStateMessage, AgentProjectSnapshot } from "../../src/types/messages"

/**
 * Route project state payloads to the shared signals.
 *
 * On project activation the extension pushes the new project's state before
 * the catalog marks it active, so a naive "is this the active project" gate
 * would drop the payload entirely. The router defers such payloads and flushes
 * them when the catalog confirms the activation, making the webview robust to
 * either ordering (state-before-catalog or catalog-before-state).
 */
export function createProjectStateRouter(deps: {
  /** Catalog entries as last pushed by the extension (empty before the first push). */
  catalog: () => readonly AgentProjectSnapshot[]
  /** Apply a state payload to the shared signals of the active project. */
  apply: (state: AgentManagerStateMessage) => void
  /** Prune live session caches for projects that left the catalog. */
  pruneLive: (ids: Set<string>) => void
}) {
  /** States waiting for their project to become catalog-active before applying. */
  const pending = new Map<string, AgentManagerStateMessage>()

  /** Whether a payload for the project would apply to the shared signals right now. */
  const isActive = (pid: string | undefined): boolean => {
    const catalog = deps.catalog()
    if (catalog.length === 0) return true
    return pid !== undefined && catalog.some((p) => p.active && p.id === pid)
  }

  /** Route a state payload: apply immediately, or defer for the next catalog push. */
  const routeState = (state: AgentManagerStateMessage): "applied" | "deferred" => {
    if (isActive(state.projectId)) {
      deps.apply(state)
      return "applied"
    }
    if (state.projectId) pending.set(state.projectId, state)
    return "deferred"
  }

  /**
   * Route a catalog push. Prunes caches for removed projects, then flushes a
   * deferred state for the newly active project, if one is waiting.
   */
  const routeCatalog = (projects: readonly AgentProjectSnapshot[]): void => {
    const ids = new Set(projects.map((p) => p.id))
    deps.pruneLive(ids)
    for (const id of [...pending.keys()]) if (!ids.has(id)) pending.delete(id)
    const active = projects.find((p) => p.active)?.id
    const state = active ? pending.get(active) : undefined
    if (!state) return
    pending.delete(active!)
    deps.apply(state)
  }

  return { isActive, routeState, routeCatalog }
}
