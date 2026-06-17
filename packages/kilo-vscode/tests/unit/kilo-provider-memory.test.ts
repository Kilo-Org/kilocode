import { describe, expect, it } from "bun:test"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { KiloProviderMemory } from "../../src/kilo-provider/memory"

function subject(client: KiloClient | undefined) {
  const posts: unknown[] = []
  const memory = new KiloProviderMemory({
    client: () => client,
    session: () => undefined,
    dir: () => "/repo",
    post: (message) => posts.push(message),
  })
  return { memory, posts }
}

describe("KiloProviderMemory", () => {
  it("handles clients without memory endpoints gracefully", async () => {
    const item = subject({} as KiloClient)

    await item.memory.fetch("ses_memoryless")
    await item.memory.inspect("ses_memoryless")
    await item.memory.run({ operation: "enable", sessionID: "ses_memoryless" })

    expect(item.posts).toEqual([
      {
        type: "memoryLoaded",
        sessionID: "ses_memoryless",
        error: "Memory unavailable in CLI backend",
      },
      {
        type: "memoryLoaded",
        sessionID: "ses_memoryless",
        error: "Memory unavailable in CLI backend",
      },
      {
        type: "memoryOperationResult",
        operation: "enable",
        sessionID: "ses_memoryless",
        ok: false,
        error: "Memory unavailable in CLI backend",
      },
    ])
  })

  it("posts a load error when no client or cache exists", async () => {
    const item = subject(undefined)

    await item.memory.fetch("ses_disconnected")

    expect(item.posts).toEqual([
      {
        type: "memoryLoaded",
        sessionID: "ses_disconnected",
        error: "Not connected to CLI backend",
      },
    ])
  })

  it("does not send ignored placement fields to correction endpoint", async () => {
    const calls: unknown[] = []
    const status = {
      root: "/repo/.kilo/memory",
      state: { enabled: true, autoConsolidate: true, stats: { lastInjectedSessionID: "", lastInjectedTokens: 0 } },
      index: { estimatedTokens: 0 },
    }
    const show = {
      root: "/repo/.kilo/memory",
      state: status.state,
      sources: { project: "", environment: "", corrections: "" },
      index: "",
      items: "",
      changes: "",
      decisions: "",
    }
    const item = subject({
      memory: {
        correct: async (input: unknown) => {
          calls.push(input)
          return { data: { operationCount: 1, added: 1, removed: 0, skipped: [], index: { tokens: 0 } } }
        },
        status: async () => ({ data: status }),
        show: async () => ({ data: show }),
      },
    } as unknown as KiloClient)

    await item.memory.run({
      operation: "correct",
      sessionID: "ses_correct",
      text: "Prefer corrections.",
      key: "correction_key",
      file: "project.md",
      section: "Facts",
    })

    expect(calls).toEqual([
      {
        directory: "/repo",
        text: "Prefer corrections.",
        key: "correction_key",
        sessionID: "ses_correct",
      },
    ])
  })

  it("routes auto-save and purge operations with explicit payloads", async () => {
    const calls: unknown[] = []
    const status = {
      root: "/repo/.kilo/memory",
      state: { enabled: true, autoConsolidate: false, stats: { lastInjectedSessionID: "", lastInjectedTokens: 0 } },
      index: { estimatedTokens: 0 },
    }
    const show = {
      root: "/repo/.kilo/memory",
      state: status.state,
      sources: { project: "", environment: "", corrections: "" },
      index: "",
      items: "",
      changes: "",
      decisions: "",
    }
    const item = subject({
      memory: {
        configure: async (input: unknown) => {
          calls.push(["configure", input])
          return { data: { root: "/repo/.kilo/memory", state: status.state } }
        },
        purge: async (input: unknown) => {
          calls.push(["purge", input])
          return { data: { root: "/repo/.kilo/memory", purged: true } }
        },
        status: async () => ({ data: status }),
        show: async () => ({ data: show }),
      },
    } as unknown as KiloClient)

    await item.memory.run({ operation: "auto", mode: "off", sessionID: "ses_memory" })
    await item.memory.run({ operation: "purge", confirm: true, sessionID: "ses_memory" })

    expect(calls).toEqual([
      ["configure", { directory: "/repo", autoConsolidate: false }],
      ["purge", { directory: "/repo", confirm: true }],
    ])
    expect(item.posts.filter((post) => (post as { type?: string }).type === "memoryOperationResult")).toHaveLength(2)
  })
})
