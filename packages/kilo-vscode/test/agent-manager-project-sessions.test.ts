import { afterEach, describe, expect, it } from "bun:test"
import type { OpenCodeClient, SessionInfo } from "@opencode/client"
import { ProjectContext } from "../src/agent-manager/project/context"
import { registerSessionCatalogHost } from "../src/agent-manager/project/init"
import { pushState, type ProviderStateHost } from "../src/agent-manager/provider-state"
import { handleSessionLifecycle } from "../src/agent-manager/session-lifecycle"
import type { AgentManagerOutMessage } from "../src/agent-manager/types"
import type { Worktree, WorktreeStateManager } from "../src/agent-manager/WorktreeStateManager"

const ROOT = "/repo"
const WORKTREE = "/repo/wt1"

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function worktree(): Worktree {
  return { id: "wt1", branch: "feature", path: WORKTREE, parentBranch: "main", createdAt: "" }
}

function sessionInfo(id: string, directory: string, created: number): SessionInfo {
  return {
    id,
    projectID: "prj",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created, updated: created },
    title: id,
    location: { directory },
  }
}

function fakeState() {
  const worktrees = [worktree()]
  return {
    getWorktrees: () => worktrees,
    getSessions: () => [],
    getSections: () => [],
    getTabOrder: () => [],
    getPinnedTabs: () => [],
    getWorktreeOrder: () => [],
    getSessionsCollapsed: () => false,
    getSidebarCollapsed: () => false,
    getReviewDiffStyle: () => "unified",
    getDefaultBaseBranch: () => "main",
    getActiveTarget: () => undefined,
    getSession: () => undefined,
    getWorktree: (id: string) => worktrees.find((item) => item.id === id),
    findWorktreeByPath: (directory: string) => worktrees.find((item) => item.path === directory),
    flush: async () => {},
  } as unknown as WorktreeStateManager
}

async function setup(options: { fail?: string; hold?: string } = {}) {
  const ctx = new ProjectContext("p1", ROOT, false, {
    log: () => {},
    exists: () => true,
    state: () => fakeState(),
  })
  await ctx.ensureReady(async () => {
    ctx.stateManager()
    return { ok: true, refsFixed: 0 }
  })
  cleanups.push(() => ctx.dispose())

  const listed: string[] = []
  const created = new Map<string, SessionInfo>()
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const client = {
    session: {
      list: async (input: { directory?: string }) => {
        const directory = input.directory ?? ""
        listed.push(directory)
        if (options.hold === directory) await held
        if (options.fail === directory) throw new Error(`cannot list ${directory}`)
        const base =
          directory === WORKTREE ? [sessionInfo("wt-session", WORKTREE, 2)] : [sessionInfo("root-session", ROOT, 1)]
        return {
          data: [...base, ...[...created.values()].filter((item) => item.location.directory === directory)],
          cursor: {},
        }
      },
      get: async (input: { sessionID: string }) => {
        const info = created.get(input.sessionID)
        if (!info) throw new Error(`unknown session ${input.sessionID}`)
        return info
      },
    },
  } as unknown as OpenCodeClient

  const posts: AgentManagerOutMessage[] = []
  const fields = {
    contexts: {
      active: () => ctx,
      byDirectory: (dir: string) => (dir === ROOT || dir === WORKTREE ? ctx : undefined),
      byLiveSession: (id: string) => (ctx.hasLiveSession(id) ? ctx : undefined),
      values: () => [ctx][Symbol.iterator](),
    },
    panel: undefined,
    connection: {},
    activity: { sync: () => {} },
    statsPoller: { syncSkips: () => undefined, setEnabled: () => {} },
    prBridge: { poller: { setEnabled: () => {} }, replay: () => {}, reset: () => {} },
    projectPollers: { sync: () => {}, replay: () => {} },
    run: { state: () => ({ runStatuses: [] }) },
    terminalRouter: { dispose: async () => {} },
    scripts: { manager: { snapshot: async () => {} } },
    healthScheduler: { schedule: () => {} },
    busySessions: new Set<string>(),
    staleIds: new Set<string>(),
    cachedWorktreeStats: undefined,
    cachedLocalStats: undefined,
    visibleSession: null,
    stateReady: undefined,
    context: ctx,
    state: ctx.peekState(),
    browserAutomation: () => false,
    postToWebview: (message: AgentManagerOutMessage) => posts.push(message),
    sendRepoInfo: async () => {},
    initializeState: async () => {},
    initExpanded: () => {},
    syncView: () => {},
    client: async () => client,
  }
  // A prototype method that reads `this`, like AgentManagerProvider.log: passing `p.log` unbound
  // throws here exactly as it throws against the real provider.
  const logger = new (class {
    readonly logs: unknown[][] = []
    log(...args: unknown[]) {
      this.logs.push(args)
    }
  })()
  const host = Object.assign(logger, fields) as unknown as ProviderStateHost

  return { ctx, host, posts, listed, created, logs: logger.logs, release, busy: host.busySessions, client }
}

const catalog = (posts: AgentManagerOutMessage[]) =>
  posts.filter((message) => message.type === "agentManager.projectSessions")

async function settle(check: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

describe("Agent Manager project session catalog", () => {
  it("posts root sessions for the project root and every worktree from pushState", async () => {
    const { ctx, host, posts, listed } = await setup()
    pushState(host)
    await settle(() => catalog(posts).length > 0)
    expect(catalog(posts)).toEqual([
      {
        type: "agentManager.projectSessions",
        projectId: "p1",
        sessions: [
          { ...sessionInfo("root-session", ROOT, 1), worktreeId: null },
          { ...sessionInfo("wt-session", WORKTREE, 2), worktreeId: "wt1" },
        ],
      },
    ])
    expect(listed).toEqual([ROOT, WORKTREE])
    expect(ctx.hasLiveSession("root-session")).toBe(true)
    expect(ctx.hasLiveSession("wt-session")).toBe(true)
  })

  it("re-posts the cached catalog without re-listing while it is fresh", async () => {
    const { host, posts, listed } = await setup()
    pushState(host)
    await settle(() => catalog(posts).length === 1)
    pushState(host)
    await settle(() => catalog(posts).length === 2)
    expect(catalog(posts)[1]?.sessions).toHaveLength(2)
    expect(listed).toEqual([ROOT, WORKTREE])
  })

  it("adds a created session to the catalog", async () => {
    const { ctx, host, posts, created } = await setup()
    pushState(host)
    await settle(() => catalog(posts).length === 1)
    created.set("new-session", sessionInfo("new-session", WORKTREE, 3))
    handleSessionLifecycle(
      { type: "session.created", data: { sessionID: "new-session" }, location: { directory: WORKTREE } },
      { busy: host.busySessions, removed: new Set<string>() },
    )
    await settle(() => catalog(posts).length === 2)
    expect(catalog(posts)[1]?.sessions.map((session) => [session.id, session.worktreeId])).toEqual([
      ["new-session", "wt1"],
      ["root-session", null],
      ["wt-session", "wt1"],
    ])
    expect(ctx.hasLiveSession("new-session")).toBe(true)
  })

  it("removes a deleted session from the catalog", async () => {
    const { host, posts } = await setup()
    pushState(host)
    await settle(() => catalog(posts).length === 1)
    handleSessionLifecycle(
      { type: "session.deleted", data: { sessionID: "wt-session" } },
      { busy: host.busySessions, removed: new Set<string>() },
    )
    await settle(() => catalog(posts).length === 2)
    expect(catalog(posts)[1]?.sessions.map((session) => session.id)).toEqual(["root-session"])
  })

  it("re-lists after a create event so a later push is not served from a stale cache", async () => {
    const { host, posts, created, listed } = await setup()
    pushState(host)
    await settle(() => catalog(posts).length === 1)
    created.set("new-session", sessionInfo("new-session", ROOT, 3))
    handleSessionLifecycle(
      { type: "session.created", data: { sessionID: "new-session" }, location: { directory: ROOT } },
      { busy: host.busySessions, removed: new Set<string>() },
    )
    await settle(() => catalog(posts).length === 2)
    pushState(host)
    await settle(() => catalog(posts).length === 3)
    expect(listed).toEqual([ROOT, WORKTREE, ROOT, WORKTREE])
  })

  it("stops cataloguing once the host is released", async () => {
    const { host, posts } = await setup()
    pushState(host)
    await settle(() => catalog(posts).length === 1)
    registerSessionCatalogHost(host.busySessions, undefined)
    handleSessionLifecycle(
      { type: "session.deleted", data: { sessionID: "root-session" } },
      { busy: host.busySessions, removed: new Set<string>() },
    )
    await settle(() => false)
    expect(catalog(posts)).toHaveLength(1)
  })

  it("logs a failed directory listing through the bound host logger and keeps the other directories", async () => {
    const { ctx, host, posts, logs } = await setup({ fail: WORKTREE })
    pushState(host)
    await settle(() => catalog(posts).length === 1)
    expect(catalog(posts)[0]?.sessions.map((session) => session.id)).toEqual(["root-session"])
    const messages = logs.flat().map((entry) => String(entry))
    expect(messages.some((entry) => entry.includes(`listing sessions for ${WORKTREE} failed`))).toBe(true)
    expect(ctx.hasLiveSession("wt-session")).toBe(false)
  })

  it("resolves a created session without an event location from the fetched session", async () => {
    const { host, posts, created } = await setup()
    pushState(host)
    await settle(() => catalog(posts).length === 1)
    created.set("new-session", sessionInfo("new-session", WORKTREE, 3))
    handleSessionLifecycle(
      { type: "session.created", data: { sessionID: "new-session" } },
      { busy: host.busySessions, removed: new Set<string>() },
    )
    await settle(() => catalog(posts).length === 2)
    expect(catalog(posts)[1]?.sessions.map((session) => [session.id, session.worktreeId])).toEqual([
      ["new-session", "wt1"],
      ["root-session", null],
      ["wt-session", "wt1"],
    ])
  })

  it("logs a failed session read from a create event and posts nothing", async () => {
    const { host, posts, logs } = await setup()
    pushState(host)
    await settle(() => catalog(posts).length === 1)
    handleSessionLifecycle(
      { type: "session.created", data: { sessionID: "unknown-session" }, location: { directory: ROOT } },
      { busy: host.busySessions, removed: new Set<string>() },
    )
    await settle(() =>
      logs.some((entry) => String(entry[0]).includes("reading session unknown-session failed")),
    )
    const messages = logs.flat().map((entry) => String(entry))
    expect(messages.some((entry) => entry.includes("reading session unknown-session failed"))).toBe(true)
    expect(catalog(posts)).toHaveLength(1)
  })

  it("drops a collection that finished after the project was disposed", async () => {
    const { ctx, host, posts, release } = await setup({ hold: ROOT })
    pushState(host)
    await ctx.dispose()
    release()
    await settle(() => false)
    expect(catalog(posts)).toHaveLength(0)
  })
})