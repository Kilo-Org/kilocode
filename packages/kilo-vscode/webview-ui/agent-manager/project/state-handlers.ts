import type { ExtensionMessage, AgentManagerProjectsMessage, AgentManagerStateMessage } from "../../src/types/messages/agent-manager"

export function createProjectStateHandlers(opts: {
  setProjects: (value: AgentManagerProjectsMessage["projects"]) => void
  migrate: (id: string) => void
  setStates: (
    value: (prev: Record<string, AgentManagerStateMessage>) => Record<string, AgentManagerStateMessage>,
  ) => void
  prune: (ids: Set<string>) => void
  ensure: (id: string) => {
    applyState: (state: AgentManagerStateMessage) => void
  }
  active: () => { applyState: (state: AgentManagerStateMessage) => void }
  routeCatalog: (projects: AgentManagerProjectsMessage["projects"]) => void
  routeState: (state: AgentManagerStateMessage) => void
  font: (font: AgentManagerStateMessage["terminalFont"]) => void
}) {
  const projects = (msg: ExtensionMessage) => {
    if (msg.type !== "agentManager.projects") return
    const ids = new Set(msg.projects.map((item) => item.id))
    // Legacy single-project tabs migrate into the pinned project, or the first catalog entry.
    const target = msg.projects.find((item) => item.pinned) ?? msg.projects.at(0)
    if (target) opts.migrate(target.id)
    opts.setProjects(msg.projects)
    opts.setStates((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => ids.has(id))))
    opts.prune(ids)
    opts.routeCatalog(msg.projects)
  }

  const state = (msg: ExtensionMessage) => {
    if (msg.type !== "agentManager.state") return
    if (msg.terminalFont) opts.font(msg.terminalFont)
    if (msg.projectId) opts.setStates((prev) => ({ ...prev, [msg.projectId!]: msg }))
    const store = msg.projectId ? opts.ensure(msg.projectId) : opts.active()
    store.applyState(msg)
    opts.routeState(msg)
  }

  return { projects, state }
}
