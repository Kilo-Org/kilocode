import { describe, it, expect, spyOn } from "bun:test"
import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { ProjectRouteService } from "../../src/agent-manager/project/route"
import { SESSION_ROUTE_UNRESOLVED } from "../../src/shared/session-route-error"
import type { DiffViewerProvider } from "../../src/diff/DiffViewerProvider"
import type { PRReviewCommentData } from "../../src/shared/review-comments"

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
  const revertCalls: Array<{ sessionID: string; messageID: string; directory?: string }> = []
  const unrevertCalls: Array<{ sessionID: string; directory?: string }> = []
  const deleteCalls: Array<{ sessionID: string; messageID: string; directory?: string }> = []
  const sessionDeleteCalls: Array<{ sessionID: string; directory?: string }> = []
  const sessionUpdateCalls: Array<{ sessionID: string; directory?: string; title?: string }> = []
  const abortCalls: Array<{ sessionID: string; directory?: string; scope?: string }> = []
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
      revert: async (p: { sessionID: string; messageID: string; directory?: string }) => {
        revertCalls.push(p)
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
      unrevert: async (p: { sessionID: string; directory?: string }) => {
        unrevertCalls.push(p)
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
      deleteMessage: async (p: { sessionID: string; messageID: string; directory?: string }) => {
        deleteCalls.push(p)
        return { data: true }
      },
      delete: async (p: { sessionID: string; directory?: string }) => {
        sessionDeleteCalls.push(p)
        return { data: true }
      },
      update: async (p: { sessionID: string; directory?: string; title?: string }) => {
        sessionUpdateCalls.push(p)
        return {
          data: {
            id: p.sessionID,
            slug: p.sessionID,
            projectID: "prj-test",
            directory: p.directory,
            title: p.title ?? "s",
            version: "1",
            time: { created: 1, updated: 1 },
          },
        }
      },
      abort: async (p: { sessionID: string; directory?: string; scope?: string }) => {
        abortCalls.push(p)
        return { data: true }
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
    backgroundProcess: { stopSession: async () => ({ data: true }) },
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
    revertCalls,
    unrevertCalls,
    deleteCalls,
    sessionDeleteCalls,
    sessionUpdateCalls,
    abortCalls,
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
      clearPermissionSession: () => undefined,
      pruneSession: () => undefined,
      unregisterVisible: () => undefined,
      unregisterAttached: () => undefined,
      getServerInfo: () => ({ port: 12345 }),
      getServerConfig: () => ({ baseUrl: "http://127.0.0.1:12345", password: "test" }),
      getConnectionState: () => "connected" as const,
      getConnectionError: () => null,
      resolveEventSessionId: () => undefined,
      recordMessageSessionId: () => undefined,
      prepareTools: async () => {},
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
  resolveSession: (sessionID?: string, draftID?: string, context?: string, directory?: string) => Promise<unknown>
  handleCreateSession: () => Promise<void>
  checkpoints: Map<string, Promise<void>>
  sessionStatusMap: Map<string, string>
  retryAbortControllers: Map<string, AbortController>
  openChanges: (sessionID?: string, turnID?: string, comment?: PRReviewCommentData) => Promise<void>
  refreshGitStatus: (directory?: string, sessionID?: string) => Promise<void>
  refreshGitStatusFromParts: (parts: unknown[], sessionID?: string) => Promise<boolean>
  refreshSessionDetails: (sessionID: string, dir: string) => void
  handleRevertSession: (sessionID: string, messageID: string, partID?: string) => Promise<void>
  handleUnrevertSession: (sessionID: string) => Promise<void>
  handleDeleteMessage: (sessionID: string, messageID: string, requestID?: string) => Promise<void>
  handleDeleteSession: (sessionID: string) => Promise<void>
  handleRenameSession: (sessionID: string, title: string) => Promise<void>
  handleAbort: (sessionID?: string, scope?: "session" | "tree") => Promise<void>
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
  const session = {
    id: "ses-background",
    slug: "background",
    projectID: "backend-b",
    directory: "/repo/b",
    title: "Background session",
    version: "1",
    time: { created: 1, updated: 1 },
  }

  it("registers a background source without replacing the foreground session", () => {
    const { connection } = mockConnection()
    const provider = new KiloProvider({} as never, connection, undefined, {
      rootDirectory: () => "/repo/a",
      projectQualifier: () => ({ projectId: "a" }),
    })
    const internal = provider as unknown as ProviderInternals
    const posted: unknown[] = []
    internal.webview = { postMessage: async (message) => posted.push(message) }
    internal.isWebviewReady = true
    internal.contextSessionID = "foreground"
    provider.registerSession(session, false, "b")
    expect(internal.contextSessionID).toBe("foreground")
    expect(posted).toContainEqual(
      expect.objectContaining({
        type: "sessionCreated",
        projectId: "b",
        session: expect.objectContaining({ id: session.id }),
      }),
    )
  })

  it.each(["draft", "explicit"])("retains the source of a delayed %s local creation", async (mode) => {
    const { connection } = mockConnection()
    const started = Promise.withResolvers<void>()
    const created = Promise.withResolvers<{ data: typeof session }>()
    const client = connection.getClient()
    Object.assign(client.session, {
      create: () => {
        started.resolve()
        return created.promise
      },
    })
    let project = "b"
    const provider = new KiloProvider({} as never, connection, undefined, {
      rootDirectory: () => `/repo/${project}`,
      projectQualifier: () => ({ projectId: project }),
    })
    const internal = provider as unknown as ProviderInternals
    const posted: unknown[] = []
    connect(internal)
    internal.webview = { postMessage: async (message) => posted.push(message) }
    internal.isWebviewReady = true
    const pending =
      mode === "draft"
        ? internal.resolveSession(undefined, "pending-b", "local", "/repo/b")
        : internal.handleCreateSession()
    await started.promise
    project = "a"
    internal.contextSessionID = "foreground"
    created.resolve({ data: session })
    await pending
    expect(internal.contextSessionID).toBe("foreground")
    expect(posted).toContainEqual(
      expect.objectContaining({
        type: "sessionCreated",
        projectId: "b",
        session: expect.objectContaining({ id: session.id }),
      }),
    )
  })

  const comment: PRReviewCommentData = {
    id: "thread-one",
    origin: "pr",
    author: "reviewer",
    body: "Keep the selection while loading.",
    file: "src/selection.ts",
    line: 4,
  }

  it("opens PR comments beside a chat tab and sends them back to the originating session", async () => {
    const { connection } = mockConnection()
    const provider = new KiloProvider({} as never, connection, undefined, {
      rootDirectory: () => "/active/root",
      topBarSurface: "tab",
    })
    provider.setSessionDirectory("origin", "/repo/origin")
    const opened: NonNullable<Parameters<DiffViewerProvider["openFromCommand"]>[0]>[] = []
    provider.setDiffViewerProvider({ openFromCommand: (args) => opened.push(args) } as DiffViewerProvider)
    const internal = provider as unknown as ProviderInternals
    const posted: unknown[] = []
    internal.webview = { postMessage: async (message) => posted.push(message) }
    internal.isWebviewReady = true
    provider.setReviewCommentsHandler(() => {
      throw new Error("A live origin must not use the fallback")
    })

    await internal.openChanges("origin", undefined, comment)
    expect(opened).toHaveLength(1)
    expect(opened[0]).toMatchObject({ sessionId: "origin", directory: "/repo/origin", beside: true, comment })
    internal.contextSessionID = "another-session"
    opened[0]!.onComments?.([comment], true)
    expect(posted).toContainEqual({
      type: "appendReviewComments",
      comments: [comment],
      autoSend: true,
      sessionID: "origin",
    })
  })

  it.each([
    ["origin", "origin", true],
    ["sidebar-pending:draft", undefined, false],
    ["pending:draft", undefined, false],
  ] as const)(
    "keeps PR comment delivery alive after the originating provider is disposed (%s)",
    async (id, target, send) => {
      const { connection } = mockConnection()
      const provider = new KiloProvider({} as never, connection, undefined, {
        rootDirectory: () => "/active/root",
      })
      provider.setSessionDirectory(id, "/repo/origin")
      const opened: NonNullable<Parameters<DiffViewerProvider["openFromCommand"]>[0]>[] = []
      const received: unknown[] = []
      provider.setDiffViewerProvider({ openFromCommand: (args) => opened.push(args) } as DiffViewerProvider)
      const stable = (comments: unknown[], autoSend: boolean, sessionID?: string, directory?: string) =>
        received.push({ comments, autoSend, sessionID, directory })
      provider.setReviewCommentsHandler(stable)

      const internal = provider as unknown as ProviderInternals
      await internal.openChanges(id, undefined, comment)
      provider.dispose()
      expect(provider.canReceiveReviewComments()).toBe(false)
      opened[0]!.onComments?.([comment], true)

      expect(received).toEqual([{ comments: [comment], autoSend: send, sessionID: target, directory: "/repo/origin" }])
    },
  )

  it("does not open a PR comment in an unrelated project for an ambiguous session", async () => {
    const routes = new ProjectRouteService()
    routes.registerProject("a", "/repo/a", 1)
    routes.registerProject("b", "/repo/b", 1)
    routes.registerSession({ projectId: "a", sessionId: "same" }, "/repo/a", 1)
    routes.registerSession({ projectId: "b", sessionId: "same" }, "/repo/b", 1)
    const { connection } = mockConnection()
    const provider = new KiloProvider({} as never, connection, undefined, {
      routeService: routes,
      rootDirectory: () => "/active/root",
    })
    const opened: unknown[] = []
    provider.setDiffViewerProvider({ openFromCommand: (args) => opened.push(args) } as DiffViewerProvider)
    const internal = provider as unknown as ProviderInternals
    await internal.openChanges("same", undefined, comment)
    expect(opened).toEqual([])
  })

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

  function goal(error?: string) {
    const { connection } = mockConnection()
    const calls: unknown[] = []
    const sent: unknown[] = []
    const client = connection.getClient()
    client.session.command = async (input) => {
      calls.push(input)
      return (
        error
          ? { error, response: new Response(null, { status: 409 }) }
          : {
              data: {
                parts: [
                  { type: "text", text: "Goal paused" },
                  { type: "reasoning", text: "hidden" },
                ],
              },
            }
      ) as Awaited<ReturnType<typeof client.session.command>>
    }
    const internal = new KiloProvider({} as never, connection, undefined, {
      rootDirectory: () => "/goal/worktree",
    }) as unknown as ProviderInternals
    connect(internal)
    internal.isWebviewReady = true
    internal.webview = { postMessage: async (message) => sent.push(message) }
    return { internal, calls, sent }
  }

  it.each([
    { args: "Fix failing tests", control: false },
    { args: "resume", control: false },
    { args: "", control: true },
    { args: "pause", control: true },
    { args: "clear", control: true },
  ])(
    "waits for checkpoints before starting or resuming goals but sends controls immediately: %j",
    async ({ args, control }) => {
      const { internal, calls, sent } = goal()
      const pending = Promise.withResolvers<void>()
      const retry = new AbortController()
      internal.checkpoints.set("goal-session", pending.promise)
      internal.retryAbortControllers.set("goal-session", retry)
      internal.sessionStatusMap.set("goal-session", "busy")
      const notice = spyOn(vscode.window, "showInformationMessage").mockResolvedValue(undefined)
      try {
        const send = internal.handleSendCommand(
          "goal",
          args,
          "goal-message",
          "goal-session",
          undefined,
          "test",
          "selected",
          "ask",
          "high",
        )
        await Promise.resolve()
        await Promise.resolve()
        expect(calls).toHaveLength(control ? 1 : 0)
        if (!control) {
          expect(sent).not.toContainEqual({ type: "sessionCommandCompleted", messageID: "goal-message" })
          pending.resolve()
        }
        await send
        expect(calls).toHaveLength(1)
        expect(calls.at(0)).toMatchObject({
          sessionID: "goal-session",
          directory: "/goal/worktree",
          command: "goal",
          arguments: args,
          model: control ? undefined : "test/selected",
          agent: control ? undefined : "ask",
          variant: control ? undefined : "high",
        })
        expect(sent).toContainEqual({ type: "sessionCommandCompleted", messageID: "goal-message" })
        expect(sent).not.toContainEqual(expect.objectContaining({ type: "sessionStatus" }))
        expect(internal.sessionStatusMap.get("goal-session")).toBe("busy")
        expect(internal.retryAbortControllers.get("goal-session")).toBe(retry)
        expect(notice.mock.calls).toEqual(args ? [] : [["Goal paused"]])
      } finally {
        pending.resolve()
        notice.mockRestore()
      }
    },
  )

  it("does not resume a goal when the pending checkpoint fails", async () => {
    const { internal, calls, sent } = goal()
    const pending = Promise.withResolvers<void>()
    internal.checkpoints.set("goal-session", pending.promise)
    const send = internal.handleSendCommand("goal", "resume", "goal-message", "goal-session")
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toHaveLength(0)
    pending.reject(new Error("Checkpoint failed"))
    await send
    expect(calls).toHaveLength(0)
    expect(sent).toContainEqual(
      expect.objectContaining({ type: "sendMessageFailed", messageID: "goal-message", error: "Checkpoint failed" }),
    )
    expect(sent).not.toContainEqual({ type: "sessionCommandCompleted", messageID: "goal-message" })
  })

  it("reports goal command errors without marking an active run idle", async () => {
    const { internal, sent } = goal("Goal is unavailable")
    internal.sessionStatusMap.set("goal-session", "busy")
    await internal.handleSendCommand("goal", "resume", undefined, "goal-session")
    expect(sent).toContainEqual(expect.objectContaining({ type: "sendMessageFailed", error: "Goal is unavailable" }))
    expect(sent).not.toContainEqual(expect.objectContaining({ type: "sessionStatus" }))
    expect(internal.sessionStatusMap.get("goal-session")).toBe("busy")
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

  const refusal = (sessionID: string) => ({
    type: "error",
    sessionID,
    message: SESSION_ROUTE_UNRESOLVED,
  })

  function ambiguousRoutes(): ProjectRouteService {
    const routes = new ProjectRouteService()
    routes.registerProject("a", "/repo/a", 1)
    routes.registerProject("b", "/repo/b", 1)
    // Same raw session id registered in two projects — ambiguous.
    routes.registerSession({ projectId: "a", sessionId: "same" }, "/repo/a", 1)
    routes.registerSession({ projectId: "b", sessionId: "same" }, "/repo/b", 1)
    return routes
  }

  it("reports a revert when the session maps to more than one project", async () => {
    const { connection, revertCalls } = mockConnection()
    const provider = new KiloProvider({} as never, connection, undefined, {
      routeService: ambiguousRoutes(),
      rootDirectory: () => "/active/root",
    })
    const internal = provider as unknown as ProviderInternals
    connect(internal)
    const posted: unknown[] = []
    internal.webview = { postMessage: async (message) => posted.push(message) }

    await internal.handleRevertSession("same", "msg-1")

    expect(revertCalls).toEqual([])
    expect(posted).toContainEqual(refusal("same"))
  })

  it("reports a message delete when the session maps to more than one project and settles the webview", async () => {
    const { connection, deleteCalls } = mockConnection()
    const provider = new KiloProvider({} as never, connection, undefined, {
      routeService: ambiguousRoutes(),
      rootDirectory: () => "/active/root",
    })
    const internal = provider as unknown as ProviderInternals
    connect(internal)
    const posted: unknown[] = []
    internal.webview = { postMessage: async (message) => posted.push(message) }

    await internal.handleDeleteMessage("same", "msg-1", "req-1")

    expect(deleteCalls).toEqual([])
    expect(posted).toContainEqual(refusal("same"))
    expect(posted).toContainEqual({
      type: "deleteMessageResult",
      sessionID: "same",
      messageID: "msg-1",
      requestID: "req-1",
      success: false,
    })
  })

  it("reports an abort when the session maps to more than one project", async () => {
    const { connection, abortCalls } = mockConnection()
    const provider = new KiloProvider({} as never, connection, undefined, {
      routeService: ambiguousRoutes(),
      rootDirectory: () => "/active/root",
    })
    const internal = provider as unknown as ProviderInternals
    connect(internal)
    const posted: unknown[] = []
    internal.webview = { postMessage: async (message) => posted.push(message) }

    await internal.handleAbort("same")

    expect(abortCalls).toEqual([])
    expect(posted).toContainEqual(refusal("same"))
  })

  it("aborts nothing on panel close when the session maps to more than one project", async () => {
    const { connection, abortCalls } = mockConnection()
    const provider = new KiloProvider({} as never, connection, undefined, {
      routeService: ambiguousRoutes(),
      rootDirectory: () => "/active/root",
    })
    const internal = provider as unknown as ProviderInternals
    connect(internal)
    const posted: unknown[] = []
    internal.webview = { postMessage: async (message) => posted.push(message) }

    await provider.abortSessions(["same"])

    expect(abortCalls).toEqual([])
    expect(posted).toEqual([])
  })

  it("reports a session delete when the session maps to more than one project", async () => {
    const { connection, sessionDeleteCalls } = mockConnection()
    const provider = new KiloProvider({} as never, connection, undefined, {
      routeService: ambiguousRoutes(),
      rootDirectory: () => "/active/root",
    })
    const internal = provider as unknown as ProviderInternals
    connect(internal)
    const posted: unknown[] = []
    internal.webview = { postMessage: async (message) => posted.push(message) }

    await internal.handleDeleteSession("same")

    expect(sessionDeleteCalls).toEqual([])
    expect(posted).toContainEqual(refusal("same"))
  })

  it("reports a session rename when the session maps to more than one project", async () => {
    const { connection, sessionUpdateCalls } = mockConnection()
    const provider = new KiloProvider({} as never, connection, undefined, {
      routeService: ambiguousRoutes(),
      rootDirectory: () => "/active/root",
    })
    const internal = provider as unknown as ProviderInternals
    connect(internal)
    const posted: unknown[] = []
    internal.webview = { postMessage: async (message) => posted.push(message) }

    await internal.handleRenameSession("same", "New title")

    expect(sessionUpdateCalls).toEqual([])
    expect(posted).toContainEqual(refusal("same"))
  })

  it("deletes a session on its one exact route", async () => {
    const routes = new ProjectRouteService()
    routes.registerProject("a", "/repo/a", 1)
    routes.registerSession({ projectId: "a", sessionId: "ses-a" }, "/repo/a", 1)
    const { connection, sessionDeleteCalls } = mockConnection()
    const provider = new KiloProvider({} as never, connection, undefined, {
      routeService: routes,
      rootDirectory: () => "/active/root",
    })
    const internal = provider as unknown as ProviderInternals
    connect(internal)
    internal.webview = { postMessage: async () => undefined }

    await internal.handleDeleteSession("ses-a")

    expect(sessionDeleteCalls).toHaveLength(1)
    expect(sessionDeleteCalls[0]).toMatchObject({ sessionID: "ses-a", directory: "/repo/a" })
  })

  it("renames a session on its one exact route", async () => {
    const routes = new ProjectRouteService()
    routes.registerProject("a", "/repo/a", 1)
    routes.registerSession({ projectId: "a", sessionId: "ses-a" }, "/repo/a", 1)
    const { connection, sessionUpdateCalls } = mockConnection()
    const provider = new KiloProvider({} as never, connection, undefined, {
      routeService: routes,
      rootDirectory: () => "/active/root",
    })
    const internal = provider as unknown as ProviderInternals
    connect(internal)
    internal.webview = { postMessage: async () => undefined }

    await internal.handleRenameSession("ses-a", "New title")

    expect(sessionUpdateCalls).toHaveLength(1)
    expect(sessionUpdateCalls[0]).toMatchObject({ sessionID: "ses-a", directory: "/repo/a", title: "New title" })
  })

  it("reports an unrevert when the session maps to more than one project", async () => {
    const { connection, unrevertCalls } = mockConnection()
    const provider = new KiloProvider({} as never, connection, undefined, {
      routeService: ambiguousRoutes(),
      rootDirectory: () => "/active/root",
    })
    const internal = provider as unknown as ProviderInternals
    connect(internal)
    const posted: unknown[] = []
    internal.webview = { postMessage: async (message) => posted.push(message) }

    await internal.handleUnrevertSession("same")

    expect(unrevertCalls).toEqual([])
    expect(posted).toContainEqual(refusal("same"))
  })

  it("reverts a message on a session with one exact route", async () => {
    const routes = new ProjectRouteService()
    routes.registerProject("a", "/repo/a", 1)
    routes.registerSession({ projectId: "a", sessionId: "ses-a" }, "/repo/a", 1)
    const { connection, revertCalls } = mockConnection()
    const provider = new KiloProvider({} as never, connection, undefined, {
      routeService: routes,
      rootDirectory: () => "/active/root",
    })
    const internal = provider as unknown as ProviderInternals
    connect(internal)
    internal.webview = { postMessage: async () => undefined }

    await internal.handleRevertSession("ses-a", "msg-1")

    expect(revertCalls).toHaveLength(1)
    expect(revertCalls[0]).toMatchObject({ sessionID: "ses-a", messageID: "msg-1", directory: "/repo/a" })
  })
})
