import { describe, it, expect } from "bun:test"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { ProjectRouteService } from "../../src/agent-manager/project/route"

// vscode mock is provided by the shared preload (tests/setup/vscode-mock.ts)
const { KiloProvider } = await import("../../src/KiloProvider")

type SessionGetParams = { sessionID: string; directory: string }

/**
 * Minimal connection service mock: exposes a controllable client whose
 * session.get records every call so tests can assert which directory was
 * queried. Mirrors the shape used by kilo-provider-session-refresh.test.ts.
 */
function mockConnection(getImpl?: (p: SessionGetParams) => Promise<unknown>, vcs = "git") {
  const calls: SessionGetParams[] = []
  const projectCalls: string[] = []
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
      status: async () => ({ data: {} }),
    },
    project: {
      current: async (p: { directory: string }) => {
        projectCalls.push(p.directory)
        return { data: { vcs } }
      },
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
    projectCalls,
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

async function withNestedRepo(run: (root: string) => Promise<void>): Promise<void> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-nested-repo-"))
  const root = path.join(base, "frontend")
  await fs.mkdir(root)
  const result = Bun.spawnSync({ cmd: ["git", "init"], cwd: root, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(Buffer.from(result.stderr).toString())
  try {
    await run(root)
  } finally {
    await fs.rm(base, { recursive: true, force: true })
  }
}

type ProviderInternals = {
  client: unknown
  connectionState: "connecting" | "connected" | "disconnected" | "error"
  initConnectionPromise: Promise<void> | null
  isWebviewReady: boolean
  webview: { postMessage: (message: unknown) => Promise<unknown> } | null
  startStatsPolling: () => void
  contextSessionID: string | undefined
  refreshGitStatus: (directory?: string, sessionID?: string) => Promise<void>
  refreshGitStatusFromParts: (parts: unknown[], sessionID?: string) => Promise<boolean>
  refreshSessionDetails: (sessionID: string, dir: string) => void
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
  it("finds a nested Git root when the workspace parent is not a repo", async () => {
    await withNestedRepo(async (root) => {
      const source = path.join(root, "src")
      await fs.mkdir(source)
      const { connection, projectCalls } = mockConnection(undefined, "none")
      const provider = new KiloProvider({} as never, connection, undefined, {
        rootDirectory: () => source,
      })
      const internal = provider as unknown as ProviderInternals
      const sent: unknown[] = []
      internal.connectionState = "connected"
      internal.initConnectionPromise = Promise.resolve()
      internal.isWebviewReady = true
      internal.startStatsPolling = () => {}
      internal.webview = { postMessage: async (message) => sent.push(message) }

      await internal.refreshGitStatus(source)

      expect(projectCalls).toEqual([source])
      expect(sent).toContainEqual({ type: "gitStatus", repo: true })
    })
  })

  it("keeps a session's discovered Git root across focus refreshes", async () => {
    await withNestedRepo(async (root) => {
      const source = path.join(root, "src")
      await fs.mkdir(source)
      const parent = path.dirname(root)
      const { connection } = mockConnection(undefined, "none")
      const provider = new KiloProvider({} as never, connection, undefined, {
        rootDirectory: () => parent,
      })
      const internal = provider as unknown as ProviderInternals
      internal.connectionState = "connected"
      internal.initConnectionPromise = Promise.resolve()
      internal.isWebviewReady = true
      internal.startStatsPolling = () => {}
      internal.webview = { postMessage: async () => true }

      await internal.refreshGitStatus(source, "s1")
      const resolved = await fs.realpath(root)
      expect(provider.getSessionGitDirectory("s1")).toBe(resolved)

      const calls: Array<{ directory?: string; sessionID?: string }> = []
      internal.refreshGitStatus = async (directory, sessionID) => {
        calls.push({ directory, sessionID })
      }
      internal.contextSessionID = "s1"
      internal.refreshSessionDetails("s1", parent)

      expect(calls).toEqual([{ directory: resolved, sessionID: "s1" }])
    })
  })

  it("keeps the session on its owning repo after tools touch a nested repo", async () => {
    await withNestedRepo(async (root) => {
      const nested = path.join(root, "vendor", "lib")
      await fs.mkdir(nested, { recursive: true })
      const result = Bun.spawnSync({ cmd: ["git", "init"], cwd: nested, stdout: "pipe", stderr: "pipe" })
      if (result.exitCode !== 0) throw new Error(Buffer.from(result.stderr).toString())

      const { connection } = mockConnection(undefined, "none")
      const provider = new KiloProvider({} as never, connection, undefined, {
        rootDirectory: () => root,
      })
      const internal = provider as unknown as ProviderInternals
      internal.contextSessionID = "s1"
      internal.startStatsPolling = () => {}

      expect(
        await internal.refreshGitStatusFromParts(
          [
            {
              type: "tool",
              tool: "read",
              state: { status: "completed", input: { filePath: path.join(nested, "readme.md") } },
            },
          ],
          "s1",
        ),
      ).toBe(false)
      expect(provider.getSessionGitDirectory("s1")).toBeUndefined()

      await internal.refreshGitStatusFromParts(
        [
          {
            type: "tool",
            tool: "edit",
            state: {
              status: "completed",
              metadata: { filediff: { file: path.join(nested, "src.ts") } },
            },
          },
        ],
        "s1",
      )

      expect(provider.getSessionGitDirectory("s1")).toBe(await fs.realpath(root))
    })
  })

  it("caches an inactive child repo without changing the visible Git status", async () => {
    await withNestedRepo(async (root) => {
      const { connection } = mockConnection(undefined, "none")
      const provider = new KiloProvider({} as never, connection, undefined, {
        rootDirectory: () => path.dirname(root),
      })
      const internal = provider as unknown as ProviderInternals
      const sent: unknown[] = []
      internal.contextSessionID = "parent"
      internal.isWebviewReady = true
      internal.webview = { postMessage: async (message) => sent.push(message) }

      await internal.refreshGitStatus(root, "child")

      expect(provider.getSessionGitDirectory("child")).toBe(await fs.realpath(root))
      expect(sent).not.toContainEqual({ type: "gitStatus", repo: true })
    })
  })

  it("does no Git work for non-mutating part updates", async () => {
    await withNestedRepo(async (root) => {
      const { connection, projectCalls } = mockConnection(undefined, "none")
      const provider = new KiloProvider({} as never, connection, undefined, {
        rootDirectory: () => root,
      })
      const internal = provider as unknown as ProviderInternals
      const parts = [
        { type: "text", text: "chunk" },
        { type: "reasoning", text: "thought" },
        { type: "step-start" },
        { type: "step-finish" },
        { type: "tool", tool: "read", state: { status: "completed", input: { filePath: "README.md" } } },
        { type: "tool", tool: "bash", state: { status: "running" } },
        { type: "tool", tool: "grep", state: { status: "completed" } },
      ]

      for (const part of parts) {
        expect(await internal.refreshGitStatusFromParts([part], "s1")).toBe(false)
      }

      expect(projectCalls).toEqual([])
      expect(provider.getSessionGitDirectory("s1")).toBeUndefined()
    })
  })

  it("checks Git capability in the active project directory", async () => {
    const { connection, projectCalls } = mockConnection()
    const provider = new KiloProvider({} as never, connection, undefined, {
      rootDirectory: () => "/workspace/parent/project-b",
      projectQualifier: () => ({ projectId: "project-b" }),
    })
    const internal = provider as unknown as ProviderInternals
    const sent: unknown[] = []
    internal.connectionState = "connected"
    internal.initConnectionPromise = Promise.resolve()
    internal.isWebviewReady = true
    internal.startStatsPolling = () => {}
    internal.webview = { postMessage: async (message) => sent.push(message) }

    await internal.refreshGitStatus()

    expect(projectCalls).toEqual(["/workspace/parent/project-b"])
    expect(sent).toContainEqual({ type: "gitStatus", repo: true })
  })

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
