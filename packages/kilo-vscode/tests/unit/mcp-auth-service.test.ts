import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import * as vscode from "vscode"
import { McpAuthService, type McpAuthConnection } from "../../src/services/mcp-auth/service"

interface FakeClient {
  mcp: {
    status(params: { directory?: string }): Promise<{ data: Record<string, { status: string; error?: string }> }>
    connect(params: { name: string; directory?: string }): Promise<{ data: boolean }>
    disconnect(params: { name: string; directory?: string }): Promise<{ data: boolean }>
    auth: {
      authenticate(params: { name: string; directory?: string; external?: boolean }): Promise<{
        data?: { status: string; error?: string }
        error?: unknown
        response?: { ok: boolean; status: number }
      }>
      cancel(params: { name: string; directory?: string }): Promise<{ response?: { ok: boolean; status: number } }>
      remove(params: { name: string; directory?: string }): Promise<{ response?: { ok: boolean; status: number } }>
    }
  }
}

/** Minimal fake satisfying McpAuthConnection, with per-call hooks for assertions and controllable behaviour. */
function fakeConnection(opts: {
  status?:
    | Record<string, { status: string; error?: string }>
    | (() => Promise<Record<string, { status: string; error?: string }>>)
  authenticate?: (name: string) => Promise<{
    data?: { status: string; error?: string }
    error?: unknown
    response?: { ok: boolean; status: number }
  }>
  onAuthCancel?: (name: string) => void
  onAuthRemove?: (name: string) => void
  onConnect?: (name: string) => void
  onDisconnect?: (name: string) => void
  connectResult?: boolean
  disconnectResult?: boolean
  authCancelOk?: boolean
  authRemoveOk?: boolean
}) {
  const calls = {
    status: 0,
    authenticate: [] as Array<{ name: string; external?: boolean }>,
    authCancel: [] as string[],
    authRemove: [] as string[],
    connect: [] as string[],
    disconnect: [] as string[],
  }

  const client: FakeClient = {
    mcp: {
      status: async () => {
        calls.status++
        return { data: typeof opts.status === "function" ? await opts.status() : (opts.status ?? {}) }
      },
      connect: async ({ name }) => {
        calls.connect.push(name)
        opts.onConnect?.(name)
        return { data: opts.connectResult ?? true }
      },
      disconnect: async ({ name }) => {
        calls.disconnect.push(name)
        opts.onDisconnect?.(name)
        return { data: opts.disconnectResult ?? true }
      },
      auth: {
        authenticate: async ({ name, external }) => {
          calls.authenticate.push({ name, external })
          if (opts.authenticate) return opts.authenticate(name)
          return { data: { status: "connected" }, response: { ok: true, status: 200 } }
        },
        cancel: async ({ name }) => {
          calls.authCancel.push(name)
          opts.onAuthCancel?.(name)
          return { response: { ok: opts.authCancelOk ?? true, status: opts.authCancelOk === false ? 404 : 200 } }
        },
        remove: async ({ name }) => {
          calls.authRemove.push(name)
          opts.onAuthRemove?.(name)
          return { response: { ok: opts.authRemoveOk ?? true, status: opts.authRemoveOk === false ? 404 : 200 } }
        },
      },
    },
  }

  const listeners = new Set<(event: unknown, directory?: string) => void>()
  const connection: McpAuthConnection = {
    getClientAsync: async () => client as unknown as never,
    onEvent: (listener) => {
      listeners.add(listener as (event: unknown, directory?: string) => void)
      return () => listeners.delete(listener as (event: unknown, directory?: string) => void)
    },
  }

  return {
    connection,
    calls,
    emit: (event: unknown, directory?: string) => {
      for (const listener of listeners) listener(event, directory)
    },
  }
}

function neverResolves<T>(): Promise<T> {
  return new Promise(() => {})
}

afterEach(() => mock.restore())

describe("McpAuthService.refresh", () => {
  it("collects only needs_auth servers for a directory", async () => {
    const { connection } = fakeConnection({
      status: {
        anaconda: { status: "needs_auth" },
        ok: { status: "connected" },
        broken: { status: "failed", error: "Connection refused" },
      },
    })
    const service = new McpAuthService(connection)
    const names = await service.refresh("/test")
    expect(names).toEqual(["anaconda"])
    expect(service.needsAuth("/test")).toEqual(["anaconda"])
  })

  it("shares one status request across concurrent auth refreshes", async () => {
    const { connection, calls } = fakeConnection({ status: { anaconda: { status: "needs_auth" } } })
    const service = new McpAuthService(connection)

    const [first, second] = await Promise.all([service.refreshStatus("/test"), service.refreshStatus("/test")])

    expect(first).toEqual({ anaconda: { status: "needs_auth" } })
    expect(second).toEqual(first)
    expect(calls.status).toBe(1)
  })

  it("returns empty and does not call the client for a blank directory", async () => {
    const { connection, calls } = fakeConnection({ status: { anaconda: { status: "needs_auth" } } })
    const service = new McpAuthService(connection)
    const names = await service.refresh("")
    expect(names).toEqual([])
    expect(calls.status).toBe(0)
  })

  it("bounds directory state to 64 entries, evicting the oldest", async () => {
    const { connection } = fakeConnection({ status: { anaconda: { status: "needs_auth" } } })
    const service = new McpAuthService(connection)
    for (let i = 0; i < 65; i++) await service.refresh(`/test/${i}`)
    expect(service.needsAuth("/test/0")).toEqual([])
    expect(service.needsAuth("/test/1")).toEqual(["anaconda"])
    expect(service.needsAuth("/test/64")).toEqual(["anaconda"])
  })

  it("preserves prior needs-auth state when status refresh fails", async () => {
    let fail = false
    const { connection } = fakeConnection({
      status: async () => {
        if (fail) throw new Error("temporary failure")
        return { anaconda: { status: "needs_auth" } }
      },
    })
    const service = new McpAuthService(connection)
    await service.refresh("/test")
    fail = true

    expect(await service.refresh("/test")).toEqual(["anaconda"])
    expect(service.needsAuth("/test")).toEqual(["anaconda"])
  })
})

describe("McpAuthService.signIn", () => {
  it("returns connected and clears needs_auth after a trailing refresh", async () => {
    const { connection, calls } = fakeConnection({
      status: { anaconda: { status: "connected" } },
      authenticate: async () => ({ data: { status: "connected" }, response: { ok: true, status: 200 } }),
    })
    const service = new McpAuthService(connection)
    const result = await service.signIn("/test", "anaconda")
    expect(result).toEqual({ status: "connected", error: undefined })
    expect(calls.authenticate).toEqual([{ name: "anaconda", external: true }])
    expect(service.needsAuth("/test")).toEqual([])
  })

  it("is single-flight per directory and name", async () => {
    const { connection, calls } = fakeConnection({
      status: {},
      authenticate: () => neverResolves(),
    })
    const service = new McpAuthService(connection, { timeout: 50_000 })
    const first = service.signIn("/test", "anaconda")
    const second = await service.signIn("/test", "anaconda")
    expect(second).toEqual({ status: "failed" })
    expect(calls.authenticate.length).toBe(1)
    // Don't await `first` to completion (it would need the 50s timeout); just
    // confirm the single-flight guard, not the eventual outcome.
    void first
  })

  it("cancels auth without removing credentials and reports timeout when authenticate never returns", async () => {
    const { connection, calls } = fakeConnection({
      status: {},
      authenticate: () => neverResolves(),
    })
    const service = new McpAuthService(connection, { timeout: 20 })
    const result = await service.signIn("/test", "anaconda")
    expect(result).toEqual({ status: "timeout" })
    expect(calls.authCancel).toEqual(["anaconda"])
    expect(calls.authRemove).toEqual([])
  })

  it("rewrites a quietly cancelled sign-in to cancelled, and a subsequent sign-in still succeeds", async () => {
    const pendingResolvers: Array<
      (value: { data: { status: string }; response: { ok: boolean; status: number } }) => void
    > = []
    const { connection } = fakeConnection({
      status: {},
      authenticate: () =>
        new Promise((resolve) => {
          pendingResolvers.push(resolve)
        }),
    })
    const service = new McpAuthService(connection, { timeout: 50_000 })
    const pending = service.signIn("/test", "anaconda")
    await service.cancel("/test", "anaconda")
    pendingResolvers[0]?.({ data: { status: "connected" }, response: { ok: true, status: 200 } })
    const result = await pending
    expect(result).toEqual({ status: "cancelled" })

    const second = service.signIn("/test", "anaconda")
    await Promise.resolve()
    pendingResolvers[1]?.({ data: { status: "connected" }, response: { ok: true, status: 200 } })
    expect((await second).status).toBe("connected")
  })

  it("maps a 400 response to unsupported and a 404 to not_found", async () => {
    const unsupported = fakeConnection({
      status: {},
      authenticate: async () => ({ error: { error: "no oauth" }, response: { ok: false, status: 400 } }),
    })
    const serviceA = new McpAuthService(unsupported.connection)
    expect(await serviceA.signIn("/test", "a")).toEqual({ status: "unsupported", error: "no oauth" })

    const notFound = fakeConnection({
      status: {},
      authenticate: async () => ({ error: { error: "missing" }, response: { ok: false, status: 404 } }),
    })
    const serviceB = new McpAuthService(notFound.connection)
    expect(await serviceB.signIn("/test", "b")).toEqual({ status: "not_found", error: "missing" })
  })
})

describe("McpAuthService.cancel", () => {
  it("cancels the flow without removing stored credentials", async () => {
    const { connection, calls } = fakeConnection({ status: {} })
    const service = new McpAuthService(connection)
    const cancelled = await service.cancel("/test", "anaconda")
    expect(cancelled).toBe(true)
    expect(calls.authCancel).toEqual(["anaconda"])
    expect(calls.authRemove).toEqual([])
  })
})

describe("McpAuthService.reset", () => {
  it("removes credentials, disconnects, reconnects, and refreshes needs-auth state", async () => {
    const { connection, calls } = fakeConnection({ status: { anaconda: { status: "needs_auth" } } })
    const service = new McpAuthService(connection)
    const reconnected = await service.reset("/test", "anaconda")
    expect(reconnected).toBe(true)
    expect(calls.authRemove).toEqual(["anaconda"])
    expect(calls.disconnect).toEqual(["anaconda"])
    expect(calls.connect).toEqual(["anaconda"])
    expect(service.needsAuth("/test")).toEqual(["anaconda"])
  })

  it("keeps needs-auth state when the reconnect fails", async () => {
    const { connection } = fakeConnection({ status: {}, connectResult: false })
    const service = new McpAuthService(connection)
    const reconnected = await service.reset("/test", "anaconda")
    expect(reconnected).toBe(false)
    expect(service.needsAuth("/test")).toEqual(["anaconda"])
  })

  it("quietly cancels an active sign-in", async () => {
    let resolveAuth:
      | ((value: { data: { status: string }; response: { ok: boolean; status: number } }) => void)
      | undefined
    const { connection } = fakeConnection({
      status: {},
      authenticate: () =>
        new Promise((resolve) => {
          resolveAuth = resolve
        }),
    })
    const service = new McpAuthService(connection, { timeout: 50_000 })
    const pending = service.signIn("/test", "anaconda")
    await service.reset("/test", "anaconda")
    resolveAuth?.({ data: { status: "connected" }, response: { ok: true, status: 200 } })
    expect(await pending).toEqual({ status: "cancelled" })
  })
})

describe("McpAuthService browser-open-failed dedupe", () => {
  it("collapses duplicate events for the same URL within the dedupe window", () => {
    const urls: Array<{ name: string; url: string }> = []
    const { connection, emit } = fakeConnection({ status: {} })
    new McpAuthService(connection, { dedupe: 60_000, onUrl: (name, url) => urls.push({ name, url }) })
    const event = { type: "mcp.browser.open.failed", properties: { mcpName: "anaconda", url: "https://x/auth" } }
    emit(event)
    emit(event)
    expect(urls.length).toBe(1)
  })

  it("opens for each distinct URL when the dedupe window is zero", () => {
    const urls: Array<{ name: string; url: string }> = []
    const { connection, emit } = fakeConnection({ status: {} })
    new McpAuthService(connection, { dedupe: 0, onUrl: (name, url) => urls.push({ name, url }) })
    emit({ type: "mcp.browser.open.failed", properties: { mcpName: "anaconda", url: "https://x/auth?a=1" } })
    emit({ type: "mcp.browser.open.failed", properties: { mcpName: "anaconda", url: "https://x/auth?a=2" } })
    expect(urls.length).toBe(2)
  })
})

describe("McpAuthService auth URL handling", () => {
  it("opens an owned auth URL through VS Code and ignores other directories", async () => {
    const opened = spyOn(vscode.env, "openExternal").mockResolvedValue(true)
    const urls: Array<{ name: string; url: string }> = []
    const auth = Promise.withResolvers<{
      data: { status: string }
      response: { ok: boolean; status: number }
    }>()
    const { connection, emit } = fakeConnection({ status: {}, authenticate: () => auth.promise })
    const service = new McpAuthService(connection, { onUrl: (name, url) => urls.push({ name, url }) })
    const pending = service.signIn("/owned", "anaconda")

    emit({ type: "mcp.auth.url", properties: { mcpName: "anaconda", url: "https://x/ignored" } }, "/other")
    emit({ type: "mcp.auth.url", properties: { mcpName: "other", url: "https://x/ignored" } }, "/owned")
    emit({ type: "mcp.auth.url", properties: { mcpName: "anaconda", url: "https://x/auth" } }, "/owned")
    await Bun.sleep(0)

    expect(opened).toHaveBeenCalledTimes(1)
    expect(opened.mock.calls[0]?.[0]).toMatchObject({ fsPath: "https://x/auth" })
    expect(urls).toEqual([])
    auth.resolve({ data: { status: "connected" }, response: { ok: true, status: 200 } })
    await pending
  })

  it("uses onUrl only when VS Code declines or fails to open the URL", async () => {
    const opened = spyOn(vscode.env, "openExternal")
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("no browser"))
    const urls: Array<{ name: string; url: string }> = []
    const auth = Promise.withResolvers<{
      data: { status: string }
      response: { ok: boolean; status: number }
    }>()
    const { connection, emit } = fakeConnection({ status: {}, authenticate: () => auth.promise })
    const service = new McpAuthService(connection, {
      dedupe: 0,
      onUrl: (name, url) => urls.push({ name, url }),
    })
    const pending = service.signIn("/test", "anaconda")

    emit({ type: "mcp.auth.url", properties: { mcpName: "anaconda", url: "https://x/declined" } }, "/test")
    emit({ type: "mcp.auth.url", properties: { mcpName: "anaconda", url: "https://x/failed" } }, "/test")
    await Bun.sleep(0)

    expect(urls).toEqual([
      { name: "anaconda", url: "https://x/declined" },
      { name: "anaconda", url: "https://x/failed" },
    ])
    auth.resolve({ data: { status: "connected" }, response: { ok: true, status: 200 } })
    await pending
  })

  it("deduplicates repeated owned auth URL events", async () => {
    const opened = spyOn(vscode.env, "openExternal").mockResolvedValue(true)
    const auth = Promise.withResolvers<{
      data: { status: string }
      response: { ok: boolean; status: number }
    }>()
    const { connection, emit } = fakeConnection({ status: {}, authenticate: () => auth.promise })
    const service = new McpAuthService(connection, { dedupe: 60_000 })
    const pending = service.signIn("/test", "anaconda")
    const event = { type: "mcp.auth.url", properties: { mcpName: "anaconda", url: "https://x/auth" } }

    emit(event, "/test")
    emit(event, "/test")
    await Bun.sleep(0)

    expect(opened).toHaveBeenCalledTimes(1)
    auth.resolve({ data: { status: "connected" }, response: { ok: true, status: 200 } })
    await pending
  })
})
