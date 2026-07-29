import { describe, expect, it } from "bun:test"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { TerminalRouter } from "../../src/agent-manager/terminal-routing"
import type { AgentManagerOutMessage } from "../../src/agent-manager/types"

const font = { fontFamily: "Menlo", fontSize: 12 }

function wait() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe("Agent Manager terminal routing", () => {
  it("round-trips side placement and rejects missing worktrees", async () => {
    const messages: AgentManagerOutMessage[] = []
    const client = {
      pty: {
        create: async () => ({ data: { id: "pty-1", title: "Terminal 1" } }),
        remove: async () => ({ data: true }),
        update: async () => ({ data: true }),
      },
    } as unknown as KiloClient
    const router = new TerminalRouter({
      getClient: () => client,
      getClientAsync: async () => client,
      getServerConfig: () => ({ baseUrl: "http://127.0.0.1:4096", password: "secret" }),
      getRoot: () => "/workspace",
      getWorktreePath: (id) => (id === "wt-1" ? "/workspace/wt-1" : undefined),
      log: () => undefined,
      post: (message) => messages.push(message),
      getTerminalFont: () => font,
    })

    router.handle({
      type: "agentManager.terminal.create",
      createId: "side-1",
      placement: "side",
      worktreeId: "wt-1",
    })
    await wait()
    expect(messages[0]).toMatchObject({
      type: "agentManager.terminal.created",
      createId: "side-1",
      placement: "side",
      worktreeId: "wt-1",
    })

    router.handle({
      type: "agentManager.terminal.create",
      createId: "side-missing",
      placement: "side",
      worktreeId: "missing",
    })
    expect(messages[1]).toMatchObject({
      type: "agentManager.terminal.error",
      createId: "side-missing",
    })
    await router.dispose()
  })

  it("isolates a reopened panel from an in-flight disposal", async () => {
    const messages: AgentManagerOutMessage[] = []
    const removed: string[] = []
    const resolvers: Array<(value: { data: { id: string; title: string } }) => void> = []
    let creates = 0
    const client = {
      pty: {
        create: () =>
          new Promise<{ data: { id: string; title: string } }>((resolve) => {
            creates++
            if (creates === 1) resolvers.push(resolve)
            else resolve({ data: { id: "pty-new", title: "Terminal 1" } })
          }),
        remove: async ({ ptyID }: { ptyID: string }) => {
          removed.push(ptyID)
          return { data: true }
        },
        update: async () => ({ data: true }),
      },
    } as unknown as KiloClient
    const router = new TerminalRouter({
      getClient: () => client,
      getClientAsync: async () => client,
      getServerConfig: () => ({ baseUrl: "http://127.0.0.1:4096", password: "secret" }),
      getRoot: () => "/workspace",
      getWorktreePath: () => undefined,
      log: () => undefined,
      post: (message) => messages.push(message),
      getTerminalFont: () => font,
    })

    router.handle({
      type: "agentManager.terminal.create",
      createId: "old",
      placement: "side",
      worktreeId: null,
    })
    await router.dispose()
    router.handle({
      type: "agentManager.terminal.create",
      createId: "new",
      placement: "side",
      worktreeId: null,
    })
    resolvers[0]?.({ data: { id: "pty-old", title: "Terminal 1" } })
    await wait()

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ type: "agentManager.terminal.created", createId: "new" })
    expect(removed).toContain("pty-old")
    await router.dispose()
    expect(removed).toContain("pty-new")
  })

  it("awaits the shared backend connection before creating a terminal", async () => {
    let connected = false
    const client = {
      pty: {
        create: async () => ({ data: { id: "pty-1", title: "Terminal 1" } }),
        remove: async () => ({ data: true }),
        update: async () => ({ data: true }),
      },
    } as unknown as KiloClient
    const router = new TerminalRouter({
      getClient: () => {
        if (!connected) throw new Error("Not connected")
        return client
      },
      getClientAsync: async () => {
        await wait()
        connected = true
        return client
      },
      getServerConfig: () => ({ baseUrl: "http://127.0.0.1:4096", password: "secret" }),
      getRoot: () => "/workspace",
      getWorktreePath: () => undefined,
      log: () => undefined,
      post: (message) => messages.push(message),
      getTerminalFont: () => font,
    })

    const messages: AgentManagerOutMessage[] = []
    router.handle({
      type: "agentManager.terminal.create",
      createId: "real",
      placement: "tab",
      worktreeId: null,
    })
    expect(messages).toHaveLength(0)
    await wait()
    await wait()

    expect(messages[0]).toMatchObject({ type: "agentManager.terminal.created", createId: "real" })
    await router.dispose()
  })
})
