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
  browserAutomation: true,
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
      browser: () => {},
      current: () => "session-a",
      closeBrowser: () => {},
      openBrowser: () => {},
    })
    const value = state("project-a")

    handler.state(value)

    expect(stored["project-a"]).toBe(value)
    expect(applied).toEqual([value])
    expect(routed).toEqual([value])
    expect(value.browserAutomation).toBe(true)
  })

  it("opens browser previews only for the active project and selected session", () => {
    let opened = 0
    let closed = 0
    let enabled = false
    const handler = createProjectStateHandlers({
      setMulti: () => {},
      setProjects: () => {},
      setStates: () => {},
      prune: () => {},
      ensure: () => ({ sections: () => [], applyState: () => {} }),
      active: () => ({ sections: () => [], applyState: () => {} }),
      routeCatalog: () => {},
      routeState: () => {},
      isActive: (project) => project === "project-a",
      pending: () => false,
      setPending: () => {},
      rename: () => {},
      font: () => {},
      browser: (value) => {
        enabled = value
      },
      current: () => "session-a",
      closeBrowser: () => {
        closed++
      },
      openBrowser: () => {
        opened++
      },
    })
    const browser = {
      type: "agentManager.browserState" as const,
      browserId: "browser-a",
      projectId: "project-a",
      sessionId: "session-a",
      status: "ready" as const,
      errors: 0,
    }
    handler.browser({ ...browser, projectId: "project-b" })
    handler.browser({ ...browser, sessionId: "session-b" })
    handler.browser({ ...browser, status: "closed" })
    expect(opened).toBe(0)
    handler.browser(browser)
    expect(opened).toBe(0)
    handler.browser({ ...browser, status: "loading" })
    expect(opened).toBe(1)
    handler.state({ ...state("project-a"), browserAutomation: false })
    expect(enabled).toBe(false)
    expect(closed).toBe(1)
  })
})
