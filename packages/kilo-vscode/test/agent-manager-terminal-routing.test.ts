import { describe, expect, it } from "bun:test"
import type { AgentManagerConnection } from "../src/agent-manager/connection"
import type { OpenCodeClient } from "@opencode/client"
import { TerminalRouter } from "../src/agent-manager/terminal-routing"
import type { AgentManagerOutMessage } from "../src/agent-manager/types"

const font = { fontFamily: "Menlo", fontSize: 12 }

interface FakeClient {
  pty: Record<string, unknown>
}

function connection(client: FakeClient, start?: () => Promise<void>): AgentManagerConnection {
  let ready: Promise<void> | undefined
  return {
    client: async () => {
      ready ??= start?.()
      await ready
      return client as unknown as OpenCodeClient
    },
    current: () => client as unknown as OpenCodeClient,
    state: () => "connected",
    onState: () => () => undefined,
    onEvent: () => () => undefined,
    server: () => ({ url: "http://127.0.0.1:4096", authorization: "Basic test" }),
    view: () => undefined,
  } as unknown as AgentManagerConnection
}

function tokens() {
  return {
    token: async ({ ptyID }: { ptyID: string }) => ({
      data: { ticket: `ticket-${ptyID}`, expires_in: 30 },
    }),
  }
}

function ownership(failing = true) {
  const live = new Set<string>()
  const attempts = new Map<string, number>()
  const ready = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const created = Promise.withResolvers<void>()
  let count = 0
  const client: FakeClient = {
    pty: {
      create: async ({ title }: { title: string }) => {
        const id = `pty-${++count}`
        if (id === "pty-2") {
          ready.resolve()
          await release.promise
        }
        live.add(id)
        return { data: { id, title } }
      },
      remove: async ({ ptyID }: { ptyID: string }) => {
        const attempt = (attempts.get(ptyID) ?? 0) + 1
        attempts.set(ptyID, attempt)
        if (failing && ptyID === "pty-2" && attempt === 1) throw new Error("offline")
        live.delete(ptyID)
      },
      update: async () => ({ data: {} }),
      connect: tokens(),
    },
  }
  const messages: AgentManagerOutMessage[] = []
  const router = new TerminalRouter({
    connection: connection(client),
    getRoot: () => "/workspace",
    getWorktreePath: () => "/workspace/worktree",
    getProjectId: () => "prj-1",
    log: () => undefined,
    post: (message) => {
      messages.push(message)
      if (message.type === "agentManager.terminal.created") created.resolve()
    },
    closed: () => undefined,
    getTerminalFont: () => font,
  })
  return { router, live, attempts, ready, release, created, messages }
}

function wait() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return
    await Bun.sleep(5)
  }
  throw new Error("condition not reached")
}

describe("Agent Manager terminal routing", () => {
  it("releases a retired manager when its late replacement cleanup succeeds", async () => {
    const test = ownership(false)
    test.router.handle({
      type: "agentManager.terminal.create",
      createId: "one",
      placement: "tab",
      worktreeId: "wt-1",
    })
    await test.created.promise
    const manager = test.router["manager"]
    test.router.handle({ type: "agentManager.terminal.restart", terminalId: "one" })
    await test.ready.promise
    await test.router.dispose()
    expect(test.router["retired"].has(manager)).toBe(true)
    test.release.resolve()
    await wait()
    expect([...test.live]).toEqual([])
    expect(test.router["retired"].has(manager)).toBe(false)
  })

  for (const action of ["dispose", "directory"] as const) {
    it(`retries a retired manager's failed late replacement during ${action} cleanup`, async () => {
      const test = ownership()
      test.router.handle({
        type: "agentManager.terminal.create",
        createId: "one",
        placement: "tab",
        worktreeId: "wt-1",
      })
      await test.created.promise
      const manager = test.router["manager"]
      test.router.handle({ type: "agentManager.terminal.restart", terminalId: "one" })
      await test.ready.promise
      // Disposal must finish even though the replacement has not arrived.
      await test.router.dispose()
      expect([...test.live]).toEqual([])
      test.release.resolve()
      await wait()
      expect([...test.live]).toEqual(["pty-2"])
      expect(test.messages.filter((message) => message.type === "agentManager.terminal.restarted")).toEqual([])

      if (action === "dispose") await test.router.dispose()
      else await test.router.closeDirectory("/workspace/worktree")
      expect([...test.live]).toEqual([])
      expect(test.attempts.get("pty-2")).toBe(2)
      expect(test.router["retired"].has(manager)).toBe(false)
    })
  }

  it("retries detached ownership during directory cleanup without disposing the router", async () => {
    const test = ownership()
    test.router.handle({
      type: "agentManager.terminal.create",
      createId: "one",
      placement: "tab",
      worktreeId: "wt-1",
    })
    await test.created.promise
    test.router.handle({ type: "agentManager.terminal.restart", terminalId: "one" })
    await test.ready.promise
    test.router.handle({ type: "agentManager.terminal.close", terminalId: "one" })
    await wait()
    test.release.resolve()
    await wait()
    expect([...test.live]).toEqual(["pty-2"])
    await test.router.closeDirectory("/workspace/other")
    expect(test.attempts.get("pty-2")).toBe(1)
    await test.router.closeDirectory("/workspace/worktree")
    expect([...test.live]).toEqual([])
    expect(test.attempts.get("pty-2")).toBe(2)
    await test.router.dispose()
  })

  it("retains an initial create awaiting connection until its failed late cleanup can be retried", async () => {
    const ready = Promise.withResolvers<void>()
    const created = Promise.withResolvers<void>()
    const live = new Set<string>()
    let attempts = 0
    const client: FakeClient = {
      pty: {
        create: async () => {
          live.add("pty-1")
          created.resolve()
          return { data: { id: "pty-1", title: "Terminal 1" } }
        },
        remove: async () => {
          if (++attempts === 1) throw new Error("offline")
          live.delete("pty-1")
        },
        connect: tokens(),
      },
    }
    const router = new TerminalRouter({
      connection: connection(client, async () => {
        await ready.promise
      }),
      getRoot: () => "/workspace",
      getWorktreePath: () => undefined,
      getProjectId: () => "prj-1",
      log: () => undefined,
      post: () => undefined,
      closed: () => undefined,
      getTerminalFont: () => font,
    })
    const manager = router["manager"]
    router.handle({ type: "agentManager.terminal.create", createId: "one", placement: "tab", worktreeId: null })
    await router.dispose()
    ready.resolve()
    await created.promise
    await wait()
    expect([...live]).toEqual(["pty-1"])
    await router.dispose()
    expect([...live]).toEqual([])
    expect(attempts).toBe(2)
    expect(router["retired"].has(manager)).toBe(false)
  })

  it("round-trips side placement and rejects missing worktrees", async () => {
    const messages: AgentManagerOutMessage[] = []
    const envs: Array<Record<string, string> | undefined> = []
    const client: FakeClient = {
      pty: {
        create: async ({ env }: { env?: Record<string, string> }) => {
          envs.push(env)
          return { data: { id: "pty-1", title: "Terminal 1" } }
        },
        remove: async () => undefined,
        update: async () => ({ data: {} }),
        connect: tokens(),
      },
    }
    const router = new TerminalRouter({
      connection: connection(client),
      getRoot: () => "/workspace",
      getWorktreePath: (id) => (id === "wt-1" ? "/workspace/wt-1" : undefined),
      getProjectId: () => "prj-1",
      log: () => undefined,
      post: (message) => messages.push(message),
      closed: () => undefined,
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
      terminalId: "side-1",
      placement: "side",
      worktreeId: "wt-1",
      projectId: "prj-1",
    })
    expect(envs[0]).toEqual({ KILO_UNICODE_LOGO: "0", KILO_TERMINAL_ACTIVITY: "1" })
    expect(messages[0]).toMatchObject({ font })
    router.handle({ type: "agentManager.terminal.restart", terminalId: "side-1" })
    await wait()
    expect(envs[1]).toEqual({ KILO_UNICODE_LOGO: "0", KILO_TERMINAL_ACTIVITY: "1" })

    router.handle({
      type: "agentManager.terminal.create",
      createId: "side-missing",
      placement: "side",
      worktreeId: "missing",
    })
    expect(
      messages.find((message) => message.type === "agentManager.terminal.error" && message.createId === "side-missing"),
    ).toMatchObject({
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
    const client: FakeClient = {
      pty: {
        create: () =>
          new Promise<{ data: { id: string; title: string } }>((resolve) => {
            creates++
            if (creates === 1) resolvers.push(resolve)
            else resolve({ data: { id: "pty-new", title: "Terminal 1" } })
          }),
        remove: async ({ ptyID }: { ptyID: string }) => {
          removed.push(ptyID)
        },
        update: async () => ({ data: {} }),
        connect: tokens(),
      },
    }
    const router = new TerminalRouter({
      connection: connection(client),
      getRoot: () => "/workspace",
      getWorktreePath: () => undefined,
      getProjectId: () => "prj-1",
      log: () => undefined,
      post: (message) => messages.push(message),
      closed: () => undefined,
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
    await until(() => resolvers.length === 1)
    resolvers[0]?.({ data: { id: "pty-old", title: "Terminal 1" } })
    await until(() => removed.includes("pty-old"))

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
    const client: FakeClient = {
      pty: {
        create: async ({ title }: { title: string }) => {
          titles.push(title)
          seq++
          return { data: { id: `pty-${seq}`, title } }
        },
        remove: async () => undefined,
        update: async () => ({ data: {} }),
        connect: tokens(),
      },
    }
    const router = new TerminalRouter({
      connection: connection(client),
      getRoot: () => "/workspace",
      getWorktreePath: () => undefined,
      getProjectId: () => "prj-1",
      log: () => undefined,
      post: (message) => messages.push(message),
      closed: () => undefined,
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

  it("keeps a terminal tracked when explicit close fails and releases its relay after success", async () => {
    const messages: AgentManagerOutMessage[] = []
    const released: string[] = []
    let attempts = 0
    const client: FakeClient = {
      pty: {
        create: async () => ({ data: { id: "pty-1", title: "Terminal 1" } }),
        remove: async () => {
          attempts++
          if (attempts === 1) throw new Error("offline")
        },
        update: async () => ({ data: {} }),
        connect: tokens(),
      },
    }
    const router = new TerminalRouter({
      connection: connection(client),
      getRoot: () => "/workspace",
      getWorktreePath: () => undefined,
      getProjectId: () => "prj-1",
      log: () => undefined,
      post: (message) => messages.push(message),
      closed: (terminalId) => released.push(terminalId),
      getTerminalFont: () => font,
    })

    router.handle({ type: "agentManager.terminal.create", createId: "one", placement: "side", worktreeId: null })
    await wait()
    const created = messages.find((message) => message.type === "agentManager.terminal.created")
    if (created?.type !== "agentManager.terminal.created") throw new Error("missing created message")

    router.handle({ type: "agentManager.terminal.close", terminalId: created.terminalId })
    await wait()
    expect(messages.at(-1)).toMatchObject({ type: "agentManager.terminal.error", terminalId: created.terminalId })
    expect(released).toEqual([])

    router.handle({ type: "agentManager.terminal.close", terminalId: created.terminalId })
    await wait()
    expect(messages.at(-1)).toMatchObject({ type: "agentManager.terminal.closed", terminalId: created.terminalId })
    expect(released).toEqual([created.terminalId])
    expect(attempts).toBe(2)
    await router.dispose()
  })

  it("hands out distinct numbers to concurrent creates", async () => {
    const messages: AgentManagerOutMessage[] = []
    const titles: string[] = []
    const resolvers: Array<(value: { data: { id: string; title: string } }) => void> = []
    const client: FakeClient = {
      pty: {
        create: ({ title }: { title: string }) =>
          new Promise<{ data: { id: string; title: string } }>((resolve) => {
            titles.push(title)
            resolvers.push(resolve)
          }),
        remove: async () => undefined,
        update: async () => ({ data: {} }),
        connect: tokens(),
      },
    }
    const router = new TerminalRouter({
      connection: connection(client),
      getRoot: () => "/workspace",
      getWorktreePath: () => undefined,
      getProjectId: () => "prj-1",
      log: () => undefined,
      post: (message) => messages.push(message),
      closed: () => undefined,
      getTerminalFont: () => font,
    })

    // Two creates before either settles must not share an ordinal. The
    // server-connection await defers the PTY creates to a microtask.
    router.handle({ type: "agentManager.terminal.create", createId: "a", placement: "side", worktreeId: null })
    router.handle({ type: "agentManager.terminal.create", createId: "b", placement: "side", worktreeId: null })
    await until(() => resolvers.length === 2)
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
    const client: FakeClient = {
      pty: {
        create: ({ title }: { title: string }) =>
          new Promise<{ data: { id: string; title: string } }>((resolve) => {
            titles.push(title)
            resolvers.push(resolve)
          }),
        remove: async () => undefined,
        update: async () => ({ data: {} }),
        connect: tokens(),
      },
    }
    const router = new TerminalRouter({
      connection: connection(client),
      getRoot: () => "/workspace",
      getWorktreePath: () => undefined,
      getProjectId: () => "prj-1",
      log: () => undefined,
      post: () => undefined,
      closed: () => undefined,
      getTerminalFont: () => font,
    })

    // Create A starts before the panel is recreated; its reservation dies
    // with dispose(). Create B of the new generation reserves the same
    // free number. When A's late completion settles, its release must not
    // wipe B's reservation, otherwise create C would duplicate B's title.
    router.handle({ type: "agentManager.terminal.create", createId: "a", placement: "side", worktreeId: null })
    await router.dispose()
    router.handle({ type: "agentManager.terminal.create", createId: "b", placement: "side", worktreeId: null })
    await until(() => resolvers.length === 2)
    expect(titles).toEqual(["Terminal 1", "Terminal 1"])
    resolvers[0]?.({ data: { id: "pty-a", title: titles[0]! } })
    await wait()
    router.handle({ type: "agentManager.terminal.create", createId: "c", placement: "side", worktreeId: null })
    await until(() => titles.length === 3)
    expect(titles).toEqual(["Terminal 1", "Terminal 1", "Terminal 2"])
    await router.dispose()
  })

  it("awaits the shared server connection before creating a terminal", async () => {
    let connected = false
    const client: FakeClient = {
      pty: {
        create: async () => ({ data: { id: "pty-1", title: "Terminal 1" } }),
        remove: async () => undefined,
        update: async () => ({ data: {} }),
        connect: tokens(),
      },
    }
    const messages: AgentManagerOutMessage[] = []
    const router = new TerminalRouter({
      connection: connection(client, async () => {
        await wait()
        connected = true
      }),
      getRoot: () => "/workspace",
      getWorktreePath: () => undefined,
      getProjectId: () => "prj-1",
      log: () => undefined,
      post: (message) => messages.push(message),
      closed: () => undefined,
      getTerminalFont: () => font,
    })

    router.handle({
      type: "agentManager.terminal.create",
      createId: "real",
      placement: "tab",
      worktreeId: null,
    })
    expect(messages).toHaveLength(0)
    await until(() => messages.length > 0)
    expect(connected).toBe(true)

    expect(messages[0]).toMatchObject({ type: "agentManager.terminal.created", createId: "real" })
    await router.dispose()
  })

  it("lazily replaces an ended PTY in the same logical terminal", async () => {
    const messages: AgentManagerOutMessage[] = []
    let seq = 0
    const client: FakeClient = {
      pty: {
        create: async ({ title }: { title: string }) => {
          seq++
          return { data: { id: `pty-${seq}`, title } }
        },
        remove: async () => undefined,
        update: async () => ({ data: {} }),
        connect: tokens(),
      },
    }
    const router = new TerminalRouter({
      connection: connection(client),
      getRoot: () => "/workspace",
      getWorktreePath: () => undefined,
      getProjectId: () => "prj-1",
      log: () => undefined,
      post: (message) => messages.push(message),
      closed: () => undefined,
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
    expect(messages.at(-1)).toEqual({ type: "agentManager.terminal.restarted", terminalId: created.terminalId })
    await router.dispose()
  })

  it("resolves the server PTY of a live terminal for the host socket relay", async () => {
    const messages: AgentManagerOutMessage[] = []
    const client: FakeClient = {
      pty: {
        create: async () => ({ data: { id: "pty-1", title: "Terminal 1" } }),
        remove: async () => undefined,
        update: async () => ({ data: {} }),
        connect: tokens(),
      },
    }
    const router = new TerminalRouter({
      connection: connection(client),
      getRoot: () => "/workspace",
      getWorktreePath: () => undefined,
      getProjectId: () => "prj-1",
      log: () => undefined,
      post: (message) => messages.push(message),
      closed: () => undefined,
      getTerminalFont: () => font,
    })

    router.handle({ type: "agentManager.terminal.create", createId: "one", placement: "side", worktreeId: null })
    await wait()
    const created = messages.find((message) => message.type === "agentManager.terminal.created")
    if (created?.type !== "agentManager.terminal.created") throw new Error("missing created message")

    expect(router.ptyFor(created.terminalId)).toEqual({ ptyID: "pty-1", directory: "/workspace" })
    expect(router.ptyFor("missing")).toBeUndefined()
    await router.dispose()
  })

  it("applies initial create dimensions and queues resize messages before creation settles", async () => {
    const creates: Array<Record<string, unknown>> = []
    const updates: Array<{
      ptyID: string
      location?: { directory: string }
      size?: { cols: number; rows: number }
    }> = []
    let createResolver: ((value: { data: { id: string; title: string } }) => void) | undefined
    const client: FakeClient = {
      pty: {
        create: (params: Record<string, unknown>) =>
          new Promise<{ data: { id: string; title: string } }>((resolve) => {
            creates.push(params)
            createResolver = resolve
          }),
        remove: async () => undefined,
        update: async (params: { ptyID: string; size?: { cols: number; rows: number } }) => {
          updates.push(params)
          return { data: {} }
        },
        connect: tokens(),
      },
    }
    const router = new TerminalRouter({
      connection: connection(client),
      getRoot: () => "/workspace",
      getWorktreePath: () => undefined,
      getProjectId: () => "prj-1",
      log: () => undefined,
      post: () => undefined,
      closed: () => undefined,
      getTerminalFont: () => font,
    })

    router.handle({
      type: "agentManager.terminal.create",
      createId: "queued",
      placement: "side",
      worktreeId: null,
      cols: 60,
      rows: 20,
    })
    await wait()
    expect(creates).toHaveLength(1)
    expect(creates[0]?.size).toEqual({ cols: 60, rows: 20 })

    // Send a resize before pty.create settles (optimistic side terminal layout)
    router.handle({
      type: "agentManager.terminal.resize",
      terminalId: "queued",
      cols: 55,
      rows: 18,
    })
    await wait()
    expect(updates).toHaveLength(0)

    createResolver?.({ data: { id: "pty-queued", title: "Terminal 1" } })
    await wait()
    expect(updates).toEqual([
      { ptyID: "pty-queued", location: { directory: "/workspace" }, size: { cols: 55, rows: 18 } },
    ])
    await router.dispose()
  })
})