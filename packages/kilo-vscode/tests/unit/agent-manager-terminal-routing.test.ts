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
      getProjectId: () => "prj-1",
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
      projectId: "prj-1",
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
      getProjectId: () => "prj-1",
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

  it("fills numbering gaps left by closed terminals", async () => {
    const messages: AgentManagerOutMessage[] = []
    const titles: string[] = []
    let seq = 0
    const client = {
      pty: {
        create: async ({ title }: { title: string }) => {
          titles.push(title)
          seq++
          return { data: { id: `pty-${seq}`, title } }
        },
        remove: async () => ({ data: true }),
        update: async () => ({ data: true }),
      },
    } as unknown as KiloClient
    const router = new TerminalRouter({
      getClient: () => client,
      getClientAsync: async () => client,
      getServerConfig: () => ({ baseUrl: "http://127.0.0.1:4096", password: "secret" }),
      getRoot: () => "/workspace",
      getWorktreePath: () => undefined,
      getProjectId: () => "prj-1",
      log: () => undefined,
      post: (message) => messages.push(message),
      getTerminalFont: () => font,
    })
    const create = (createId: string) =>
      router.handle({ type: "agentManager.terminal.create", createId, placement: "side", worktreeId: null })

    create("one")
    await wait()
    create("two")
    await wait()
    expect(titles).toEqual(["Terminal 1", "Terminal 2"])

    // Close "Terminal 1"; the next create reuses the freed number.
    const first = messages.find((m) => m.type === "agentManager.terminal.created" && m.createId === "one")
    if (first?.type !== "agentManager.terminal.created") throw new Error("missing created message")
    router.handle({ type: "agentManager.terminal.close", terminalId: first.terminalId })
    await wait()

    create("three")
    await wait()
    expect(titles).toEqual(["Terminal 1", "Terminal 2", "Terminal 1"])
    await router.dispose()
  })

  it("hands out distinct numbers to concurrent creates", async () => {
    const messages: AgentManagerOutMessage[] = []
    const titles: string[] = []
    const resolvers: Array<(value: { data: { id: string; title: string } }) => void> = []
    const client = {
      pty: {
        create: ({ title }: { title: string }) =>
          new Promise<{ data: { id: string; title: string } }>((resolve) => {
            titles.push(title)
            resolvers.push(resolve)
          }),
        remove: async () => ({ data: true }),
        update: async () => ({ data: true }),
      },
    } as unknown as KiloClient
    const router = new TerminalRouter({
      getClient: () => client,
      getClientAsync: async () => client,
      getServerConfig: () => ({ baseUrl: "http://127.0.0.1:4096", password: "secret" }),
      getRoot: () => "/workspace",
      getWorktreePath: () => undefined,
      getProjectId: () => "prj-1",
      log: () => undefined,
      post: (message) => messages.push(message),
      getTerminalFont: () => font,
    })

    // Two creates before either settles must not share an ordinal. The
    // backend-connection await defers the PTY creates to a microtask.
    router.handle({ type: "agentManager.terminal.create", createId: "a", placement: "side", worktreeId: null })
    router.handle({ type: "agentManager.terminal.create", createId: "b", placement: "side", worktreeId: null })
    await wait()
    expect(titles).toEqual(["Terminal 1", "Terminal 2"])
    resolvers[0]?.({ data: { id: "pty-a", title: titles[0]! } })
    resolvers[1]?.({ data: { id: "pty-b", title: titles[1]! } })
    await wait()

    // A failed create releases its reservation for the next attempt.
    await router.dispose()
  })

  it("does not let a stale create release a new generation's reservation", async () => {
    const titles: string[] = []
    const resolvers: Array<(value: { data: { id: string; title: string } }) => void> = []
    const client = {
      pty: {
        create: ({ title }: { title: string }) =>
          new Promise<{ data: { id: string; title: string } }>((resolve) => {
            titles.push(title)
            resolvers.push(resolve)
          }),
        remove: async () => ({ data: true }),
        update: async () => ({ data: true }),
      },
    } as unknown as KiloClient
    const router = new TerminalRouter({
      getClient: () => client,
      getClientAsync: async () => client,
      getServerConfig: () => ({ baseUrl: "http://127.0.0.1:4096", password: "secret" }),
      getRoot: () => "/workspace",
      getWorktreePath: () => undefined,
      getProjectId: () => "prj-1",
      log: () => undefined,
      post: () => undefined,
      getTerminalFont: () => font,
    })

    // Create A starts before the panel is recreated; its reservation dies
    // with dispose(). Create B of the new generation reserves the same
    // free number. When A's late completion settles, its release must not
    // wipe B's reservation — otherwise create C would duplicate B's title.
    router.handle({ type: "agentManager.terminal.create", createId: "a", placement: "side", worktreeId: null })
    await router.dispose()
    router.handle({ type: "agentManager.terminal.create", createId: "b", placement: "side", worktreeId: null })
    await wait()
    expect(titles).toEqual(["Terminal 1", "Terminal 1"])
    resolvers[0]?.({ data: { id: "pty-a", title: titles[0]! } })
    await wait()
    router.handle({ type: "agentManager.terminal.create", createId: "c", placement: "side", worktreeId: null })
    await wait()
    expect(titles).toEqual(["Terminal 1", "Terminal 1", "Terminal 2"])
    await router.dispose()
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
    const messages: AgentManagerOutMessage[] = []
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
      getProjectId: () => "prj-1",
      log: () => undefined,
      post: (message) => messages.push(message),
      getTerminalFont: () => font,
    })

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

  it("lazily replaces an ended PTY in the same logical terminal", async () => {
    const messages: AgentManagerOutMessage[] = []
    let seq = 0
    const client = {
      pty: {
        create: async ({ title }: { title: string }) => {
          seq++
          return { data: { id: `pty-${seq}`, title } }
        },
        remove: async () => ({ data: true }),
        update: async () => ({ data: true }),
      },
    } as unknown as KiloClient
    const router = new TerminalRouter({
      getClient: () => client,
      getClientAsync: async () => client,
      getServerConfig: () => ({ baseUrl: "http://127.0.0.1:4096", password: "secret" }),
      getRoot: () => "/workspace",
      getWorktreePath: () => undefined,
      getProjectId: () => "prj-1",
      log: () => undefined,
      post: (message) => messages.push(message),
      getTerminalFont: () => font,
    })

    router.handle({ type: "agentManager.terminal.create", createId: "one", placement: "tab", worktreeId: null })
    await wait()
    const created = messages.find((message) => message.type === "agentManager.terminal.created")
    if (!created || created.type !== "agentManager.terminal.created") throw new Error("missing terminal")

    router.handle({
      type: "agentManager.terminal.restart",
      terminalId: created.terminalId,
      cols: 80,
      rows: 24,
    })
    await wait()
    expect(messages.at(-1)).toMatchObject({
      type: "agentManager.terminal.restarted",
      terminalId: created.terminalId,
      wsUrl: expect.stringContaining("pty-2"),
    })
    await router.dispose()
  })
})
