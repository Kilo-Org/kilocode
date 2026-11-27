import { describe, expect, test } from "bun:test"
import { handleSessionLifecycle } from "../../src/agent-manager/session-lifecycle"
import { AgentManagerProvider } from "../../src/agent-manager/AgentManagerProvider"
import type { Host } from "../../src/agent-manager/host"
import type { ProjectContexts } from "../../src/agent-manager/project/contexts"
import type { AgentManagerOutMessage } from "../../src/agent-manager/types"
import type { Session } from "@kilocode/sdk/v2/client"

const info: Session = {
  id: "session",
  slug: "test-session",
  projectID: "project",
  directory: "/repo",
  title: "Browser session",
  version: "1",
  time: { created: 1, updated: 2 },
}

describe("session lifecycle merge integration", () => {
  test.each(["sessionID", "info"])("preserves deletion guards and browser cleanup for %s events", (shape) => {
    const sessions: Array<{ id: string }> = []
    const closed: string[] = []
    const posted: AgentManagerOutMessage[] = []
    const context = {
      id: "project",
      lifecycle: "ready",
      peekState: () => undefined,
      sessions: () => sessions,
      upsertSession: (session: { id: string }) => sessions.push(session),
      removeLiveSession: (id: string) =>
        sessions.splice(
          sessions.findIndex((session) => session.id === id),
          1,
        ),
      invalidateSessions: () => {},
    }
    const deps = {
      busy: new Set([info.id]),
      removed: new Set<string>(),
      contexts: {
        byDirectory: () => context,
        byLiveSession: () => context,
      } as unknown as ProjectContexts,
      closeBrowser: (id: string) => closed.push(id),
      post: (message: AgentManagerOutMessage) => posted.push(message),
    }
    handleSessionLifecycle({ type: "session.created", properties: { info } }, deps)
    expect(sessions).toHaveLength(1)
    handleSessionLifecycle(
      { type: "session.deleted", properties: shape === "info" ? { info } : { sessionID: info.id } },
      deps,
    )
    expect(closed).toEqual([info.id])
    expect(deps.removed.has(info.id)).toBe(true)
    expect(deps.busy.has(info.id)).toBe(false)
    expect(sessions).toHaveLength(0)
    const count = posted.length
    handleSessionLifecycle({ type: "session.updated", properties: { info } }, deps)
    expect(sessions).toHaveLength(0)
    expect(posted).toHaveLength(count)
    handleSessionLifecycle({ type: "session.created", properties: { info } }, deps)
    expect(deps.removed.has(info.id)).toBe(false)
    expect(sessions).toHaveLength(1)
  })

  test("clears only busy sessions for the disposed directory on server.instance.disposed", () => {
    const ctx = {
      id: "project",
      root: "/repo",
      lifecycle: "ready",
      peekState: () => ({
        getSession: (id: string) => (id === "fallback-wt" ? { worktreeId: "wt-1" } : undefined),
        getWorktree: (id: string) => (id === "wt-1" ? { path: "/repo/wt-1" } : undefined),
      }),
      sessions: () => [],
      upsertSession: () => {},
      removeLiveSession: () => {},
      invalidateSessions: () => {},
    }
    const deps = {
      busy: new Set(["wt1-child", "fallback-wt", "wt2-session", "root-session"]),
      busyDirs: new Map([
        ["wt1-child", "/repo/wt-1/"],
        ["wt2-session", "/repo/wt-2"],
        ["root-session", "/repo"],
      ]),
      removed: new Set<string>(),
      contexts: {
        byDirectory: () => ctx,
        byLiveSession: (id: string) => (id === "fallback-wt" ? ctx : undefined),
      } as unknown as ProjectContexts,
      closeBrowser: () => {},
      post: () => {},
    }

    handleSessionLifecycle(
      { type: "server.instance.disposed", properties: { directory: "/repo/wt-1" } },
      deps,
      "/repo/wt-1",
    )

    expect([...deps.busy]).toEqual(["wt2-session", "root-session"])
    expect([...deps.busyDirs.keys()]).toEqual(["wt2-session", "root-session"])
  })

  test("clears all busy sessions on global.disposed and directory-less server.instance.disposed", () => {
    const deps = {
      busy: new Set(["s1", "s2"]),
      busyDirs: new Map([
        ["s1", "/repo/wt-1"],
        ["s2", "/repo/wt-2"],
      ]),
      removed: new Set<string>(),
      contexts: {
        byDirectory: () => undefined,
        byLiveSession: () => undefined,
      } as unknown as ProjectContexts,
      closeBrowser: () => {},
      post: () => {},
    }

    handleSessionLifecycle({ type: "global.disposed", properties: {} }, deps, "global")
    expect(deps.busy.size).toBe(0)
    expect(deps.busyDirs.size).toBe(0)

    deps.busy.add("s3")
    deps.busyDirs.set("s3", "/repo")
    handleSessionLifecycle({ type: "server.instance.disposed", properties: {} }, deps)
    expect(deps.busy.size).toBe(0)
    expect(deps.busyDirs.size).toBe(0)
  })

  test("AgentManagerProvider clears busySessions on server.instance.disposed and global.disposed", () => {
    const subs: Array<{
      filter: (event: unknown, directory?: string) => boolean
      listener: (event: unknown, directory?: string) => void
    }> = []
    const noop = () => () => undefined
    const disposable = { dispose: () => undefined }
    const host = {
      workspacePath: () => undefined,
      createOutput: () => ({ appendLine: () => undefined, dispose: () => undefined }),
      onDidChangeWorkspaceFolders: () => disposable,
      onDidChangeWorktreePool: () => disposable,
      dirtyFiles: () => false,
      autoBranchNaming: () => ({ enabled: false, prefix: "" }),
      isTrusted: () => true,
      showError: () => undefined,
      openExternal: () => undefined,
      openDocument: () => undefined,
      copyToClipboard: async () => undefined,
      capture: () => undefined,
      withProgress: async (_title: string, task: () => Promise<unknown>) => task(),
      choose: async () => undefined,
      getGlobalState: () => undefined,
      updateGlobalState: async () => undefined,
      readProjects: () => undefined,
      writeProjects: async () => undefined,
      readExpandedProjects: () => undefined,
      writeExpandedProjects: async () => undefined,
      dispose: () => undefined,
    } as unknown as Host
    const connection = {
      getClient: () => ({
        session: { status: async () => ({ data: {} }) },
        permission: { list: async () => ({ data: [] }) },
        question: { list: async () => ({ data: [] }) },
      }),
      getClientAsync: async () => ({}),
      getServerConfig: () => null,
      getConnectionState: () => "disconnected",
      onStateChange: noop,
      onEvent: noop,
      registerDirectoryProvider: noop,
      unregisterVisible: () => undefined,
      unregisterAttached: () => undefined,
      onEventFiltered: (
        filter: (event: unknown, directory?: string) => boolean,
        listener: (event: unknown, directory?: string) => void,
      ) => {
        const entry = { filter, listener }
        subs.push(entry)
        return () => {
          const idx = subs.indexOf(entry)
          if (idx >= 0) subs.splice(idx, 1)
        }
      },
      registerVisible: () => undefined,
      registerAttached: () => undefined,
    }
    const emit = (event: unknown, directory?: string) => {
      for (const sub of [...subs]) {
        if (sub.filter(event, directory)) sub.listener(event, directory)
      }
    }

    const provider = new AgentManagerProvider(host, connection as never)
    const internal = provider as unknown as { busySessions: Set<string>; busyDirs: Map<string, string> }
    try {
      emit({ type: "session.status", properties: { sessionID: "s-wt1", status: { type: "busy" } } }, "/repo/wt1")
      emit({ type: "session.status", properties: { sessionID: "s-wt2", status: { type: "busy" } } }, "/repo/wt2")
      expect([...internal.busySessions]).toEqual(["s-wt1", "s-wt2"])

      emit({ type: "server.instance.disposed", properties: { directory: "/repo/wt1" } }, "/repo/wt1")
      expect([...internal.busySessions]).toEqual(["s-wt2"])
      expect([...internal.busyDirs.keys()]).toEqual(["s-wt2"])

      emit({ type: "global.disposed", properties: {} }, "global")
      expect(internal.busySessions.size).toBe(0)
      expect(internal.busyDirs.size).toBe(0)
    } finally {
      provider.dispose()
    }
  })
})
