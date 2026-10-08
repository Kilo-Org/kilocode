import { afterEach, describe, expect, it } from "bun:test"
import {
  handleWorkspaceConfigMessage,
  requestWorkspaceConfig,
  resetWorkspaceConfigStore,
  workspaceConfigEntry,
} from "../../webview-ui/src/context/workspace-config"
import type { WebviewMessage } from "../../webview-ui/src/types/messages"

const features = { indexing: false, sandboxControls: false, backgroundSubagents: false }
const project = {
  provider: { kilo: { models: { "z-ai/glm-4.6": { options: { provider: { only: ["baseten/fp8"] } } } } } },
}
const other = { provider: { kilo: { models: { "z-ai/glm-4.6": { options: { provider: { only: ["fast/fp8"] } } } } } } }

function collect() {
  const sent: WebviewMessage[] = []
  return { sent, post: (message: WebviewMessage) => sent.push(message) }
}

function id(sent: WebviewMessage[], index: number): number {
  const message = sent[index]
  if (message?.type !== "requestWorkspaceConfig") throw new Error("Expected a workspace config request")
  return message.requestID
}

function loaded(sent: WebviewMessage[], index: number, directory: string, projectConfig?: unknown) {
  return handleWorkspaceConfigMessage({
    type: "workspaceConfigLoaded",
    requestID: id(sent, index),
    directory,
    projectConfig,
  })
}

afterEach(() => {
  resetWorkspaceConfigStore()
})

describe("workspace config store", () => {
  it("requests once per directory, names it on the request, and caches the reply", () => {
    const { sent, post } = collect()

    requestWorkspaceConfig("/worktree", post)
    requestWorkspaceConfig("/worktree", post)
    expect(sent).toEqual([{ type: "requestWorkspaceConfig", requestID: id(sent, 0), directory: "/worktree" }])

    expect(loaded(sent, 0, "/worktree", project)).toBe(true)
    expect(workspaceConfigEntry("/worktree")).toEqual({ projectConfig: project })

    requestWorkspaceConfig("/worktree", post)
    expect(sent).toHaveLength(1)
  })

  it("keys entries by the directory the request was made for", () => {
    const { sent, post } = collect()

    requestWorkspaceConfig("/a", post)
    requestWorkspaceConfig("/b", post)
    loaded(sent, 1, "/b", project)

    expect(workspaceConfigEntry("/a")).toBeUndefined()
    expect(workspaceConfigEntry("/b")).toEqual({ projectConfig: project })
  })

  it("keeps cached configs visible as stale and restarts in-flight requests on any config message", () => {
    const { sent, post } = collect()

    requestWorkspaceConfig("/cached", post)
    loaded(sent, 0, "/cached", project)
    requestWorkspaceConfig("/pending", post)
    expect(sent).toHaveLength(2)

    expect(handleWorkspaceConfigMessage({ type: "configUpdated", config: {}, features })).toBe(false)
    expect(workspaceConfigEntry("/cached")).toEqual({ projectConfig: project, stale: true })
    expect(sent).toHaveLength(3)
    expect(sent[2]).toEqual({ type: "requestWorkspaceConfig", requestID: id(sent, 2), directory: "/pending" })

    // The reply to the superseded request is ignored; the new one lands.
    loaded(sent, 1, "/pending", project)
    expect(workspaceConfigEntry("/pending")).toBeUndefined()
    loaded(sent, 2, "/pending", project)
    expect(workspaceConfigEntry("/pending")).toEqual({ projectConfig: project })

    // A stale entry stays visible while it refreshes, then is replaced.
    requestWorkspaceConfig("/cached", post)
    expect(sent).toHaveLength(4)
    requestWorkspaceConfig("/cached", post)
    expect(sent).toHaveLength(4)
    expect(workspaceConfigEntry("/cached")).toEqual({ projectConfig: project, stale: true })
    loaded(sent, 3, "/cached", other)
    expect(workspaceConfigEntry("/cached")).toEqual({ projectConfig: other })
  })

  it("keeps the previous entry when a refresh fails and retries on the next request", () => {
    const { sent, post } = collect()

    requestWorkspaceConfig("/worktree", post)
    loaded(sent, 0, "/worktree", project)
    handleWorkspaceConfigMessage({ type: "globalConfigLoaded", config: {} })
    // The selector re-requests a stale entry; the stale data stays visible meanwhile.
    requestWorkspaceConfig("/worktree", post)
    expect(sent).toHaveLength(2)

    handleWorkspaceConfigMessage({
      type: "workspaceConfigLoaded",
      requestID: id(sent, 1),
      directory: "/worktree",
      error: true,
    })
    expect(workspaceConfigEntry("/worktree")).toEqual({ projectConfig: project, stale: true })

    requestWorkspaceConfig("/worktree", post)
    expect(sent).toHaveLength(3)
    loaded(sent, 2, "/worktree", other)
    expect(workspaceConfigEntry("/worktree")).toEqual({ projectConfig: other })
  })

  it("does not cache a failed first lookup", () => {
    const { sent, post } = collect()

    requestWorkspaceConfig("/worktree", post)
    handleWorkspaceConfigMessage({
      type: "workspaceConfigLoaded",
      requestID: id(sent, 0),
      directory: "/worktree",
      error: true,
    })
    expect(workspaceConfigEntry("/worktree")).toBeUndefined()

    requestWorkspaceConfig("/worktree", post)
    expect(sent).toHaveLength(2)
  })

  it("ignores unrelated and unrequested messages", () => {
    expect(handleWorkspaceConfigMessage({ type: "variantsLoaded", variants: {} })).toBe(false)
    expect(
      handleWorkspaceConfigMessage({
        type: "workspaceConfigLoaded",
        requestID: 99,
        directory: "/x",
        projectConfig: project,
      }),
    ).toBe(true)
    expect(workspaceConfigEntry("/x")).toBeUndefined()
  })
})
