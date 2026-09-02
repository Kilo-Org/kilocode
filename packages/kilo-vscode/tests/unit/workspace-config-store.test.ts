import { afterEach, describe, expect, it } from "bun:test"
import {
  handleWorkspaceConfigMessage,
  requestWorkspaceConfig,
  resetWorkspaceConfigStore,
  workspaceConfigEntry,
} from "../../webview-ui/src/context/workspace-config"
import type { WebviewMessage } from "../../webview-ui/src/types/messages"

const features = { indexing: false, sandboxControls: false, backgroundSubagents: false }
const config = { model: "kilo/z-ai/glm-4.6" }
const project = {
  provider: { kilo: { models: { "z-ai/glm-4.6": { options: { provider: { only: ["baseten/fp8"] } } } } } },
}

function collect() {
  const sent: WebviewMessage[] = []
  return { sent, post: (message: WebviewMessage) => sent.push(message) }
}

function id(sent: WebviewMessage[], index: number): number {
  const message = sent[index]
  if (message?.type !== "requestWorkspaceConfig") throw new Error("Expected a workspace config request")
  return message.requestID
}

afterEach(() => {
  resetWorkspaceConfigStore()
})

describe("workspace config store", () => {
  it("requests once per directory, forwards the session, and caches the reply", () => {
    const { sent, post } = collect()

    requestWorkspaceConfig("/worktree", "ses_tree", post)
    requestWorkspaceConfig("/worktree", "ses_tree", post)
    expect(sent).toEqual([{ type: "requestWorkspaceConfig", requestID: id(sent, 0), sessionID: "ses_tree" }])

    expect(
      handleWorkspaceConfigMessage({
        type: "workspaceConfigLoaded",
        requestID: id(sent, 0),
        directory: "/worktree",
        config,
        projectConfig: project,
      }),
    ).toBe(true)
    expect(workspaceConfigEntry("/worktree")).toEqual({ config, projectConfig: project })

    requestWorkspaceConfig("/worktree", "ses_tree", post)
    expect(sent).toHaveLength(1)
  })

  it("keys entries by the directory the request was made for", () => {
    const { sent, post } = collect()

    requestWorkspaceConfig("/a", "ses_a", post)
    requestWorkspaceConfig("/b", "ses_b", post)
    handleWorkspaceConfigMessage({ type: "workspaceConfigLoaded", requestID: id(sent, 1), directory: "/b", config })

    expect(workspaceConfigEntry("/a")).toBeUndefined()
    expect(workspaceConfigEntry("/b")).toEqual({ config, projectConfig: undefined })
  })

  it("drops cached configs and restarts in-flight requests on any config message", () => {
    const { sent, post } = collect()

    requestWorkspaceConfig("/cached", "ses_cached", post)
    handleWorkspaceConfigMessage({
      type: "workspaceConfigLoaded",
      requestID: id(sent, 0),
      directory: "/cached",
      config,
    })
    requestWorkspaceConfig("/pending", "ses_pending", post)
    expect(sent).toHaveLength(2)

    expect(handleWorkspaceConfigMessage({ type: "configUpdated", config: {}, features })).toBe(false)
    expect(workspaceConfigEntry("/cached")).toBeUndefined()
    expect(sent).toHaveLength(3)
    expect(sent[2]).toEqual({ type: "requestWorkspaceConfig", requestID: id(sent, 2), sessionID: "ses_pending" })

    // The reply to the superseded request is ignored; the new one lands.
    handleWorkspaceConfigMessage({
      type: "workspaceConfigLoaded",
      requestID: id(sent, 1),
      directory: "/pending",
      config,
    })
    expect(workspaceConfigEntry("/pending")).toBeUndefined()
    handleWorkspaceConfigMessage({
      type: "workspaceConfigLoaded",
      requestID: id(sent, 2),
      directory: "/pending",
      config,
    })
    expect(workspaceConfigEntry("/pending")).toEqual({ config, projectConfig: undefined })

    // A cached directory can be requested again after the invalidation.
    requestWorkspaceConfig("/cached", "ses_cached", post)
    expect(sent).toHaveLength(4)
  })

  it("does not cache a failed lookup and allows a retry", () => {
    const { sent, post } = collect()

    requestWorkspaceConfig("/worktree", "ses_tree", post)
    handleWorkspaceConfigMessage({
      type: "workspaceConfigLoaded",
      requestID: id(sent, 0),
      directory: "/worktree",
      config: {},
      error: true,
    })
    expect(workspaceConfigEntry("/worktree")).toBeUndefined()

    requestWorkspaceConfig("/worktree", "ses_tree", post)
    expect(sent).toHaveLength(2)
  })

  it("ignores unrelated and unrequested messages", () => {
    expect(handleWorkspaceConfigMessage({ type: "variantsLoaded", variants: {} })).toBe(false)
    expect(
      handleWorkspaceConfigMessage({ type: "workspaceConfigLoaded", requestID: 99, directory: "/x", config }),
    ).toBe(true)
    expect(workspaceConfigEntry("/x")).toBeUndefined()
  })
})
