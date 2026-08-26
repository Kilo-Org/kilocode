import type { KiloConnectionService } from "../services/cli-backend/connection-service"
import { AgentManagerOrchestrationBridge } from "./orchestration-bridge"
import type { ProjectContexts } from "./project/contexts"
import type { ProjectContext } from "./project/context"
import type { ProjectScope } from "./project/scope"
import type { WorktreeStateManager } from "./WorktreeStateManager"
import type { WorktreeStats, LocalStats } from "./GitStatsPoller"
import type { PRStatus } from "./types"
import { initContextState } from "./project/init"

export interface OrchestrationBridgeDeps {
  connectionService: KiloConnectionService
  contexts: ProjectContexts
  projectScope: ProjectScope
  getRoot: () => string | undefined
  getState: () => WorktreeStateManager | undefined
  getStateReady: () => Promise<void> | undefined
  initStateReady: () => Promise<void>
  getStats: () => Promise<{ worktrees: WorktreeStats[]; local?: LocalStats }>
  getPrs: () => Map<string, PRStatus>
  pushState: (ctx?: ProjectContext) => void
  hasPanelSession: (id: string) => boolean
  closeSession: (id: string) => Promise<unknown>
  postSessionClosed: (id: string, projectId?: string) => void
  log: (...args: unknown[]) => void
}

export function createOrchestrationBridge(deps: OrchestrationBridgeDeps): AgentManagerOrchestrationBridge {
  return new AgentManagerOrchestrationBridge(deps.connectionService, {
    root: (dir) => (dir ? deps.contexts.byDirectory(dir)?.root : undefined) ?? deps.getRoot(),
    state: (dir) => (dir ? deps.contexts.byDirectory(dir)?.peekState() : undefined) ?? deps.getState(),
    ready: async (dir) => {
      const ctx = dir ? deps.contexts.byDirectory(dir) : undefined
      if (ctx && ctx.id !== deps.contexts.active()?.id) {
        await initContextState(ctx, (...args) => deps.log(...args))
        return ctx.stateManager()
      }
      const ready = deps.getStateReady() ?? deps.initStateReady()
      await ready
      return deps.getState()
    },
    stats: () => deps.getStats(),
    prs: () => deps.getPrs(),
    push: (dir) => {
      const ctx = dir ? deps.contexts.byDirectory(dir) : undefined
      deps.pushState(ctx)
    },
    managed: (id, dir) => {
      const ctx = dir ? deps.contexts.byDirectory(dir) : undefined
      if (ctx) return ctx.hasLiveSession(id) || !!ctx.peekState()?.getSession(id)
      return deps.hasPanelSession(id) || !!deps.getState()?.getSession(id)
    },
    close: async (id, dir) => {
      const ctx = dir ? deps.contexts.byDirectory(dir) : undefined
      if (ctx) {
        await deps.projectScope.run(ctx, () => deps.closeSession(id))
      } else {
        await deps.closeSession(id)
      }
      deps.postSessionClosed(id, ctx?.id)
    },
    directories: () => {
      const all: string[] = []
      for (const ctx of deps.contexts.values()) {
        all.push(ctx.root)
        for (const wt of ctx.peekState()?.getWorktrees() ?? []) {
          if (wt.path) all.push(wt.path)
        }
      }
      if (all.length === 0) {
        const root = deps.getRoot()
        if (root) all.push(root)
      }
      return all
    },
    log: (...args) => deps.log(...args),
  })
}
