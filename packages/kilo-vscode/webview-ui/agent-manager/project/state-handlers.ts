import type { ExtensionMessage, AgentManagerProjectsMessage, AgentManagerStateMessage } from "../../src/types/messages"

export function createProjectStateHandlers(opts: {
  setMulti: (value: boolean) => void
  setProjects: (value: AgentManagerProjectsMessage["projects"]) => void
  setStates: (
    value: (prev: Record<string, AgentManagerStateMessage>) => Record<string, AgentManagerStateMessage>,
  ) => void
  prune: (ids: Set<string>) => void
  ensure: (id: string) => {
    sections: () => Array<{ id: string }>
    applyState: (state: AgentManagerStateMessage) => void
  }
  active: () => { sections: () => Array<{ id: string }>; applyState: (state: AgentManagerStateMessage) => void }
  routeCatalog: (projects: AgentManagerProjectsMessage["projects"]) => void
  routeState: (state: AgentManagerStateMessage) => void
  isActive: (id: string | undefined) => boolean
  pending: () => boolean
  setPending: (value: boolean) => void
  rename: (id: string) => void
  font: (font: AgentManagerStateMessage["terminalFont"]) => void
  browser: (enabled: boolean) => void
  current: () => string | undefined
  closeBrowser: () => void
  openBrowser: () => void
}) {
  const projects = (msg: ExtensionMessage) => {
    if (msg.type !== "agentManager.projects") return
    const ids = new Set(msg.projects.map((item) => item.id))
    opts.setMulti(msg.multiProject)
    opts.setProjects(msg.projects)
    opts.setStates((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => ids.has(id))))
    opts.prune(ids)
    opts.routeCatalog(msg.projects)
  }

  const state = (msg: ExtensionMessage) => {
    if (msg.type !== "agentManager.state") return
    if (msg.browserAutomation !== undefined) opts.browser(msg.browserAutomation)
    if (msg.browserAutomation === false) opts.closeBrowser()
    if (msg.terminalFont) opts.font(msg.terminalFont)
    if (msg.projectId) opts.setStates((prev) => ({ ...prev, [msg.projectId!]: msg }))
    const store = msg.projectId ? opts.ensure(msg.projectId) : opts.active()
    if (opts.pending() && opts.isActive(msg.projectId)) {
      const prior = new Set(store.sections().map((item) => item.id))
      const created = (msg.sections ?? []).find((item) => !prior.has(item.id))
      opts.setPending(false)
      if (created) opts.rename(created.id)
    }
    store.applyState(msg)
    opts.routeState(msg)
  }

  const browser = (msg: ExtensionMessage) => {
    if (msg.type !== "agentManager.browserState" || (msg.status !== "starting" && msg.status !== "loading")) return
    if (!opts.isActive(msg.projectId) || msg.sessionId !== opts.current()) return
    opts.openBrowser()
  }

  return { projects, state, browser }
}
