import { describe, expect, it } from "bun:test"
import { createProjectStateHandlers } from "../../webview-ui/agent-manager/project/state-handlers"
import type { AgentManagerStateMessage } from "../../webview-ui/src/types/messages"

const state = (projectId: string): AgentManagerStateMessage => ({
  type: "agentManager.state",
  projectId,
  worktrees: [],
  sessions: [],
  sections: [],
  isGitRepo: true,
})

describe("createProjectStateHandlers", () => {
  it("stores each project state before applying and routing it", () => {
    const stored: Record<string, AgentManagerStateMessage> = {}
    const applied: AgentManagerStateMessage[] = []
    const routed: AgentManagerStateMessage[] = []
    const handler = createProjectStateHandlers({
      setMulti: () => {},
      setProjects: () => {},
      setStates: (update) => Object.assign(stored, update(stored)),
      prune: () => {},
      ensure: () => ({ sections: () => [], applyState: (value) => applied.push(value) }),
      active: () => ({ sections: () => [], applyState: (value) => applied.push(value) }),
      routeCatalog: () => {},
      routeState: (value) => routed.push(value),
      isActive: () => true,
      pending: () => false,
      setPending: () => {},
      rename: () => {},
      font: () => {},
    })
    const value = state("project-a")

    handler.state(value)

    expect(stored["project-a"]).toBe(value)
    expect(applied).toEqual([value])
    expect(routed).toEqual([value])
  })
})
