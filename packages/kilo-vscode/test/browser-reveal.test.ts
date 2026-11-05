import { describe, expect, test } from "bun:test"
import { createProjectStateHandlers } from "../webview-ui/agent-manager/project/state-handlers"
import type { ExtensionMessage } from "../webview-ui/src/types/messages/agent-manager"

function handlers(input: { project?: string; session?: string }) {
  const revealed: number[] = []
  const value = createProjectStateHandlers({
    setProjects: () => undefined,
    migrate: () => undefined,
    setStates: () => undefined,
    prune: () => undefined,
    ensure: () => ({ applyState: () => undefined }),
    active: () => ({ applyState: () => undefined }),
    routeCatalog: () => undefined,
    routeState: () => undefined,
    font: () => undefined,
    activeProject: () => input.project,
    currentSession: () => input.session,
    revealBrowser: () => revealed.push(1),
  })
  return { value, revealed }
}

function state(input: { status: string; sessionId?: string; projectId?: string }): ExtensionMessage {
  return {
    type: "agentManager.browserState",
    browserId: "browser",
    sessionId: input.sessionId ?? "session",
    projectId: input.projectId,
    status: input.status as "ready",
    errors: 0,
  } as ExtensionMessage
}

describe("browser state reveal", () => {
  test("reveals the panel for the shown session of the active project", () => {
    const test = handlers({ project: "project", session: "session" })
    test.value.browser(state({ status: "loading", projectId: "project" }))
    expect(test.revealed.length).toBe(1)
  })

  test("ignores a state for another session", () => {
    const test = handlers({ project: "project", session: "session" })
    test.value.browser(state({ status: "ready", sessionId: "other", projectId: "project" }))
    expect(test.revealed.length).toBe(0)
  })

  test("ignores a state for another project", () => {
    const test = handlers({ project: "project", session: "session" })
    test.value.browser(state({ status: "ready", projectId: "other" }))
    expect(test.revealed.length).toBe(0)
  })

  test("ignores closed and failed states", () => {
    const test = handlers({ project: "project", session: "session" })
    test.value.browser(state({ status: "closed", projectId: "project" }))
    test.value.browser(state({ status: "error", projectId: "project" }))
    expect(test.revealed.length).toBe(0)
  })

  test("ignores other messages", () => {
    const test = handlers({ project: "project", session: "session" })
    test.value.browser({ type: "agentManager.browserInspection", sessionId: "session", requestId: "1", logs: [] })
    expect(test.revealed.length).toBe(0)
  })
})