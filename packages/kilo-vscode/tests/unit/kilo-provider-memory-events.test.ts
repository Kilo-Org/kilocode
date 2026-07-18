import { describe, expect, it } from "bun:test"
import type { KiloClient } from "@kilocode/sdk/v2/client"

// vscode mock is provided by the shared preload (tests/setup/vscode-mock.ts)
const { KiloProvider } = await import("../../src/KiloProvider")

type Internals = {
  currentSession: { id: string } | null
  trackedSessionIds: Set<string>
  webview: { postMessage(message: unknown): Promise<unknown> } | null
  handleEvent(event: unknown, directory?: string): void
  memory: { idle(): Promise<void> }
}

function status(root: string) {
  return {
    root: `${root}/.kilo/memory`,
    state: {
      enabled: true,
      autoConsolidate: true,
      stats: {
        lastInjectedSessionID: "",
        lastInjectedTokens: 0,
        lastOperationCount: 0,
      },
    },
    index: { estimatedTokens: 0 },
  }
}

function show(root: string) {
  return {
    root: `${root}/.kilo/memory`,
    state: status(root).state,
    sources: { project: "", environment: "", corrections: "" },
    index: "",
    items: "",
    changes: "",
    decisions: "",
  }
}

describe("KiloProvider memory events", () => {
  it("routes tracked background memory events to their session directory", async () => {
    const calls: string[] = []
    const posts: unknown[] = []
    const client = {
      memory: {
        status: async (input: { directory: string }) => {
          calls.push(input.directory)
          return { data: status(input.directory) }
        },
      },
    } as unknown as KiloClient
    const provider = new KiloProvider(
      {} as never,
      {
        getClient: () => client,
      } as never,
    )
    const item = provider as unknown as Internals
    item.webview = { postMessage: async (message) => posts.push(message) }
    item.currentSession = { id: "ses_active" }
    item.trackedSessionIds.add("ses_active")
    item.trackedSessionIds.add("ses_bg")
    provider.setSessionDirectory("ses_bg", "/worktree")

    item.handleEvent(
      {
        type: "memory.updated",
        properties: {
          sessionID: "ses_bg",
          detail: { type: "saved", message: "Saved project memory" },
        },
      },
      "/worktree",
    )
    await item.memory.idle()

    expect(posts).toContainEqual({
      type: "memoryEvent",
      sessionID: "ses_bg",
      detail: { type: "saved", message: "Saved project memory" },
    })
    expect(posts).toContainEqual(expect.objectContaining({ type: "memoryLoaded", sessionID: "ses_bg" }))
    expect(posts).not.toContainEqual(expect.objectContaining({ type: "memoryEvent", sessionID: "ses_active" }))
    expect(calls).toEqual(["/worktree"])
  })

  it("also refreshes the active session for same-directory memory events", async () => {
    const calls: string[] = []
    const posts: unknown[] = []
    const client = {
      memory: {
        status: async (input: { directory: string }) => {
          calls.push(input.directory)
          return { data: status(input.directory) }
        },
      },
    } as unknown as KiloClient
    const provider = new KiloProvider(
      {} as never,
      {
        getClient: () => client,
      } as never,
    )
    const item = provider as unknown as Internals
    item.webview = { postMessage: async (message) => posts.push(message) }
    item.currentSession = { id: "ses_active" }
    item.trackedSessionIds.add("ses_active")
    item.trackedSessionIds.add("ses_bg")
    provider.setSessionDirectory("ses_active", "/repo")
    provider.setSessionDirectory("ses_bg", "/repo")

    item.handleEvent(
      {
        type: "memory.updated",
        properties: {
          sessionID: "ses_bg",
          detail: { type: "saved", message: "Saved project memory" },
        },
      },
      "/repo",
    )
    await item.memory.idle()

    expect(posts).toContainEqual({
      type: "memoryEvent",
      sessionID: "ses_bg",
      detail: { type: "saved", message: "Saved project memory" },
    })
    expect(posts).toContainEqual({
      type: "memoryEvent",
      sessionID: "ses_active",
      detail: { type: "saved", message: "Saved project memory" },
    })
    expect(posts).toContainEqual(expect.objectContaining({ type: "memoryLoaded", sessionID: "ses_bg" }))
    expect(posts).toContainEqual(expect.objectContaining({ type: "memoryLoaded", sessionID: "ses_active" }))
    expect(calls).toEqual(["/repo", "/repo"])
  })

  it("uses the project directory when toggling memory", async () => {
    const calls: unknown[] = []
    const client = {
      memory: {
        status: async (input: { directory: string }) => {
          calls.push(["status", input.directory])
          return { data: status(input.directory) }
        },
        disable: async (input: { directory: string }) => {
          calls.push(["disable", input.directory])
          return { data: { root: `${input.directory}/.kilo/memory`, state: status(input.directory).state } }
        },
        show: async (input: { directory: string }) => {
          calls.push(["show", input.directory])
          return { data: show(input.directory) }
        },
      },
    } as unknown as KiloClient
    const posts: unknown[] = []
    const provider = new KiloProvider(
      {} as never,
      {
        getClient: () => client,
      } as never,
      undefined,
      { projectDirectory: "/repo/project" },
    )
    const item = provider as unknown as Internals
    item.webview = { postMessage: async (message) => posts.push(message) }
    item.currentSession = { id: "ses_active" }

    await provider.toggleMemory("ses_active")

    expect(calls).toEqual([
      ["status", "/repo/project"],
      ["disable", "/repo/project"],
      ["status", "/repo/project"],
      ["show", "/repo/project"],
    ])
    expect(posts).toContainEqual(expect.objectContaining({ type: "memoryLoaded", sessionID: "ses_active" }))
  })
})
