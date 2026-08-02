import { describe, it, expect } from "bun:test"
import { ProjectRouteService } from "../../src/agent-manager/project/route"

// vscode mock is provided by the shared preload (tests/setup/vscode-mock.ts)
const { KiloProvider } = await import("../../src/KiloProvider")

type SessionGetParams = { sessionID: string; directory: string }

/**
 * Minimal connection service mock: exposes a controllable client whose
 * session.get records every call so tests can assert which directory was
 * queried. Mirrors the shape used by kilo-provider-session-refresh.test.ts.
 */
function mockConnection(getImpl?: (p: SessionGetParams) => Promise<unknown>) {
  const calls: SessionGetParams[] = []
  const client = {
    session: {
      get: async (p: SessionGetParams) => {
        calls.push(p)
        if (getImpl) return getImpl(p)
        return {
          data: {
            id: p.sessionID,
            slug: p.sessionID,
            projectID: "prj-test",
            directory: p.directory,
            title: "s",
            version: "1",
            time: { created: 1, updated: 1 },
          },
        }
      },
      list: async () => ({ data: [] }),
    },
    provider: { list: async () => ({ data: { all: [], connected: {}, default: {} } }) },
    app: {
      agents: async () => ({ data: [] }),
      skills: async () => ({ data: [] }),
    },
    config: { get: async () => ({ data: {} }) },
    indexing: { status: async () => ({ data: { state: "disabled" } }) },
    kilo: {
      notifications: async () => ({ data: [] }),
      profile: async () => ({ data: {} }),
    },
  }
  let current: typeof client | null = client
  return {
    calls,
    connection: {
      connect: async () => {
        current = client
      },
      getClient: () => {
        if (!current) throw new Error("Not connected")
        return current
      },
      getClientAsync: async () => client,
      onEventFiltered: () => () => undefined,
      onStateChange: () => () => undefined,
      onNotificationDismissed: () => () => undefined,
      onLanguageChanged: () => () => undefined,
      onProfileChanged: () => () => undefined,
      onMigrationComplete: () => () => undefined,
      onFavoritesChanged: () => () => undefined,
      onModelSelectorExpandedChanged: () => () => undefined,
      onClearPendingPrompts: () => () => undefined,
      registerDirectoryProvider: () => () => undefined,
      getServerInfo: () => ({ port: 12345 }),
      getServerConfig: () => ({ baseUrl: "http://127.0.0.1:12345", password: "test" }),
      getConnectionState: () => "connected" as const,
      getConnectionError: () => null,
      resolveEventSessionId: () => undefined,
      recordMessageSessionId: () => undefined,
      notifyNotificationDismissed: () => undefined,
    } as unknown as ConstructorParameters<typeof KiloProvider>[1],
  }
}

type ProviderInternals = {
  client: unknown
  connectionState: "connecting" | "connected" | "disconnected" | "error"
  initConnectionPromise: Promise<void> | null
  webview: { postMessage: (message: unknown) => Promise<unknown> } | null
  handleSendCommand: (
    command: string,
    args: string,
    messageID?: string,
    sessionID?: string,
    draftID?: string,
    providerID?: string,
    modelID?: string,
    agent?: string,
    variant?: string,
    files?: unknown[],
    context?: string,
    contextDirectory?: string,
  ) => Promise<void>
}

/**
 * Short-circuit initializeConnection: setting initConnectionPromise to a
 * resolved promise makes the guarded initializeConnection() return
 * immediately, and connectionState="connected" satisfies the guards in
 * getSessionInfo. This avoids the full backend init sequence (commands,
 * indexing, git status) which the minimal mock does not implement.
 */
function connect(internal: ProviderInternals): void {
  internal.connectionState = "connected"
  internal.initConnectionPromise = Promise.resolve()
}

describe("KiloProvider route integration", () => {
  it("resolves a unique Local session route to its exact project root", async () => {
    const routes = new ProjectRouteService()
    routes.registerProject("a", "/repo/a", 1)
    routes.registerSession({ projectId: "a", sessionId: "ses-local" }, "/repo/a", 1)
    const { connection, calls } = mockConnection()
    const provider = new KiloProvider({} as never, connection, undefined, {
      routeService: routes,
      rootDirectory: () => "/active/root",
    })
    const internal = provider as unknown as ProviderInternals
    // Pretend the backend is already connected so getSessionInfo does not
    // run the full initialization sequence.
    connect(internal)

    await provider.getSessionInfo("ses-local")

    expect(calls).toHaveLength(1)
    expect(calls[0]!.directory).toBe("/repo/a")
    expect(calls[0]!.sessionID).toBe("ses-local")
  })

  it("resolves a unique worktree session route to its exact worktree directory", async () => {
    const routes = new ProjectRouteService()
    routes.registerProject("a", "/repo/a", 1)
    routes.registerWorktree({ projectId: "a", worktreeId: "wt" }, "/repo/a/.kilo/wt", 1)
    routes.registerSession({ projectId: "a", sessionId: "ses-wt" }, "/repo/a/.kilo/wt", 1)
    const { connection, calls } = mockConnection()
    const provider = new KiloProvider({} as never, connection, undefined, {
      routeService: routes,
      rootDirectory: () => "/active/root",
    })
    const internal = provider as unknown as ProviderInternals
    connect(internal)

    await provider.getSessionInfo("ses-wt")

    expect(calls).toHaveLength(1)
    expect(calls[0]!.directory).toBe("/repo/a/.kilo/wt")
  })

  it("does NOT query the active root for an ambiguous raw session id", async () => {
    const routes = new ProjectRouteService()
    routes.registerProject("a", "/repo/a", 1)
    routes.registerProject("b", "/repo/b", 1)
    // Same raw session id registered in two projects — ambiguous.
    routes.registerSession({ projectId: "a", sessionId: "same" }, "/repo/a", 1)
    routes.registerSession({ projectId: "b", sessionId: "same" }, "/repo/b", 1)
    const { connection, calls } = mockConnection()
    const provider = new KiloProvider({} as never, connection, undefined, {
      routeService: routes,
      rootDirectory: () => "/active/root",
    })
    const internal = provider as unknown as ProviderInternals
    connect(internal)

    const result = await provider.getSessionInfo("same")

    // Must not hit the backend at all — no active-root fallback.
    expect(calls).toHaveLength(0)
    expect(result).toBeUndefined()
  })

  it("does NOT silently use a stale sessionDirectories entry for an ambiguous id", async () => {
    const routes = new ProjectRouteService()
    routes.registerProject("a", "/repo/a", 1)
    routes.registerProject("b", "/repo/b", 1)
    routes.registerSession({ projectId: "a", sessionId: "same" }, "/repo/a", 1)
    routes.registerSession({ projectId: "b", sessionId: "same" }, "/repo/b", 1)
    const { connection, calls } = mockConnection()
    const provider = new KiloProvider({} as never, connection, undefined, {
      routeService: routes,
      rootDirectory: () => "/active/root",
    })
    // Simulate the legacy single-entry map holding only one project's dir.
    provider.setSessionDirectory("same", "/repo/a")
    const internal = provider as unknown as ProviderInternals
    connect(internal)

    await provider.getSessionInfo("same")

    // The route service blocks the query despite sessionDirectories having
    // an entry, because the id is ambiguous and no qualifier disambiguates.
    expect(calls).toHaveLength(0)
  })

  it("resolves an ambiguous id through a project qualifier to the exact dir", async () => {
    const routes = new ProjectRouteService()
    routes.registerProject("a", "/repo/a", 1)
    routes.registerProject("b", "/repo/b", 1)
    routes.registerSession({ projectId: "a", sessionId: "same" }, "/repo/a", 1)
    routes.registerSession({ projectId: "b", sessionId: "same" }, "/repo/b", 1)
    const { connection, calls } = mockConnection()
    const provider = new KiloProvider({} as never, connection, undefined, {
      routeService: routes,
      rootDirectory: () => "/active/root",
      projectQualifier: () => ({ projectId: "b" }),
    })
    const internal = provider as unknown as ProviderInternals
    connect(internal)

    await provider.getSessionInfo("same")

    expect(calls).toHaveLength(1)
    expect(calls[0]!.directory).toBe("/repo/b")
  })

  it("falls back to sessionDirectories when no route service is configured (non-Agent-Manager)", async () => {
    const { connection, calls } = mockConnection()
    const provider = new KiloProvider({} as never, connection, undefined, {
      rootDirectory: () => "/active/root",
    })
    provider.setSessionDirectory("ses-plain", "/some/dir")
    const internal = provider as unknown as ProviderInternals
    connect(internal)

    await provider.getSessionInfo("ses-plain")

    expect(calls).toHaveLength(1)
    expect(calls[0]!.directory).toBe("/some/dir")
  })

  it("exposes route registration helpers that forward to the route service", () => {
    const routes = new ProjectRouteService()
    const { connection } = mockConnection()
    const provider = new KiloProvider({} as never, connection, undefined, {
      routeService: routes,
      rootDirectory: () => "/active/root",
    })

    provider.registerProjectRoute({ projectId: "a" }, "/repo/a", 1)
    provider.registerWorktreeRoute({ projectId: "a", worktreeId: "wt" }, "/repo/a/.kilo/wt", 1)
    provider.registerSessionRoute({ projectId: "a", sessionId: "s" }, "/repo/a/.kilo/wt", 1)

    expect(routes.sessionDirectory({ projectId: "a", sessionId: "s" })).toBe("/repo/a/.kilo/wt")
    expect(routes.worktreeDirectory({ projectId: "a", worktreeId: "wt" })).toBe("/repo/a/.kilo/wt")
    expect(provider.isSessionRouteAmbiguous("s")).toBe(false)
    expect(provider.routeSessionDirectoryFor({ projectId: "a", sessionId: "s" })).toBe("/repo/a/.kilo/wt")

    provider.unregisterSessionRoute({ projectId: "a", sessionId: "s" })
    expect(provider.routeSessionDirectoryFor({ projectId: "a", sessionId: "s" })).toBeUndefined()
  })

  it("refuses to run a share command on an ambiguous raw session id (no active-root fallback)", async () => {
    const routes = new ProjectRouteService()
    routes.registerProject("a", "/repo/a", 1)
    routes.registerProject("b", "/repo/b", 1)
    routes.registerSession({ projectId: "a", sessionId: "same" }, "/repo/a", 1)
    routes.registerSession({ projectId: "b", sessionId: "same" }, "/repo/b", 1)
    const { connection, calls } = mockConnection()
    const provider = new KiloProvider({} as never, connection, undefined, {
      routeService: routes,
      rootDirectory: () => "/active/root",
    })
    const internal = provider as unknown as ProviderInternals
    connect(internal)
    const posted: unknown[] = []
    internal.webview = { postMessage: async (m) => posted.push(m) }

    // share/unshare are commands routed through handleSendCommand → resolveSession.
    await internal.handleSendCommand("share", "", "mid", "same")

    // No backend session.command call should fire — the ambiguous id is
    // refused before any directory is resolved.
    expect(calls).toHaveLength(0)
    const failed = posted.find(
      (m) => typeof m === "object" && m !== null && (m as { type?: string }).type === "sendMessageFailed",
    )
    expect(failed, "expected a sendMessageFailed message for the ambiguous share command").toBeTruthy()
  })

  it("runs a share command on a unique session route against its exact directory", async () => {
    const routes = new ProjectRouteService()
    routes.registerProject("a", "/repo/a", 1)
    routes.registerWorktree({ projectId: "a", worktreeId: "wt" }, "/repo/a/.kilo/wt", 1)
    routes.registerSession({ projectId: "a", sessionId: "ses-wt" }, "/repo/a/.kilo/wt", 1)
    const { connection, calls } = mockConnection()
    // Extend the mock client with session.command to record the directory.
    const commandCalls: { sessionID: string; directory: string; command: string }[] = []
    ;(connection.getClient() as { session: { command: unknown } }).session.command = async (p: {
      sessionID: string
      directory: string
      command: string
    }) => {
      commandCalls.push(p)
      return {
        data: {
          id: p.sessionID,
          slug: p.sessionID,
          directory: p.directory,
          title: "s",
          version: "1",
          time: { created: 1, updated: 1 },
        },
      }
    }
    const provider = new KiloProvider({} as never, connection, undefined, {
      routeService: routes,
      rootDirectory: () => "/active/root",
    })
    const internal = provider as unknown as ProviderInternals
    connect(internal)
    internal.webview = { postMessage: async () => undefined }

    await internal.handleSendCommand("share", "", "mid", "ses-wt")

    // session.get is called by refreshSessionDetails; the command itself
    // must target the exact worktree directory, never /active/root.
    expect(commandCalls).toHaveLength(1)
    expect(commandCalls[0]!.directory).toBe("/repo/a/.kilo/wt")
    expect(commandCalls[0]!.command).toBe("share")
    // No fallback to the active root anywhere.
    expect(calls.every((c) => c.directory !== "/active/root")).toBe(true)
  })
})
