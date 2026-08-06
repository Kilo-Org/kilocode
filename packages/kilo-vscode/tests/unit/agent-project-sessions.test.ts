import { describe, expect, it } from "bun:test"
import type { Session } from "@kilocode/sdk/v2/client"
import { ProjectContext, type ProjectContextDeps } from "../../src/agent-manager/project/context"
import type { Worktree, ManagedSession, WorktreeStateManager } from "../../src/agent-manager/WorktreeStateManager"
import {
  collectProjectSessions,
  projectDirectories,
  pushProjectSessions,
  registerProjectSessions,
  unregisterProjectRoutes,
  type ProjectSessionListing,
} from "../../src/agent-manager/project/init"
import { ProjectRouteService, type SessionRef, type WorktreeRef } from "../../src/agent-manager/project/route"

const ROOT = "/repo/main"
const WT_PATH = "/repo/main/.kilo/worktrees/fix"
const OTHER = "/other/project"

function mkSession(id: string, dir: string): Session {
  return {
    id,
    slug: id,
    projectID: "prj-test",
    directory: dir,
    title: `Session ${id}`,
    version: "1",
    time: { created: 1000, updated: 2000 },
  }
}

/** Build a fake WorktreeStateManager with just the queries project-init uses. */
function fakeState(worktrees: Worktree[], sessions: ManagedSession[] = []): WorktreeStateManager {
  const wtMap = new Map(worktrees.map((w) => [w.id, w]))
  return {
    getWorktrees: () => worktrees,
    getWorktree: (id: string) => wtMap.get(id),
    getSessions: () => sessions,
    flush: async () => {},
  } as unknown as WorktreeStateManager
}

function makeContext(root: string, state: WorktreeStateManager, id = "prj-test"): ProjectContext {
  const deps: ProjectContextDeps = {
    log: () => {},
    state: () => state,
  }
  const ctx = new ProjectContext(id, root, false, deps)
  // Instantiate the lazy state so peekState() returns the fake.
  ctx.stateManager()
  return ctx
}

/** A recording ProjectSessionListing: serves sessions by directory and records registrations. */
function recordingListing(byDir: Record<string, Session[] | (() => Session[] | Promise<Session[]>)>): {
  listing: ProjectSessionListing
  calls: string[]
  registered: Map<string, string>
} {
  const calls: string[] = []
  const registered = new Map<string, string>()
  const listing: ProjectSessionListing = {
    listSessions: async (dir) => {
      calls.push(dir)
      const value = byDir[dir]
      const resolved = typeof value === "function" ? await value() : (value ?? [])
      return resolved
    },
    setSessionDirectory: (id, dir) => {
      registered.set(id, dir)
    },
  }
  return { listing, calls, registered }
}

/**
 * A recording listing that also forwards route registrations to a real
 * ProjectRouteService, so tests can assert exact-route behavior end-to-end
 * through the project-init functions. Includes trackSession so it satisfies
 * registerProjectSessions' full parameter shape.
 */
function routeListing(
  routes: ProjectRouteService,
  byDir: Record<string, Session[] | (() => Session[] | Promise<Session[]>)>,
  projectId: string,
  generation: number,
): {
  listing: ProjectSessionListing & { trackSession(id: string): void }
  calls: string[]
  registered: Map<string, string>
  tracked: string[]
} {
  const calls: string[] = []
  const registered = new Map<string, string>()
  const tracked: string[] = []
  const listing: ProjectSessionListing & { trackSession(id: string): void } = {
    listSessions: async (dir) => {
      calls.push(dir)
      const value = byDir[dir]
      const resolved = typeof value === "function" ? await value() : (value ?? [])
      return resolved
    },
    setSessionDirectory: (id, dir) => {
      registered.set(id, dir)
    },
    trackSession: (id) => tracked.push(id),
    registerProjectRoute: (ref, root, gen) => routes.registerProject(ref.projectId, root, gen),
    unregisterProjectRoute: (id) => routes.unregisterProject(id),
    registerWorktreeRoute: (ref, dir, gen) => routes.registerWorktree(ref, dir, gen),
    registerSessionRoute: (ref, dir, gen) => routes.registerSession(ref, dir, gen),
    unregisterSessionRoute: (ref) => routes.unregisterSession(ref),
  }
  void projectId
  void generation
  return { listing, calls, registered, tracked }
}

describe("Agent Manager per-project session discovery", () => {
  it("projectDirectories is exactly ctx.root plus this context's worktree paths", () => {
    const wt: Worktree = { id: "wt-1", branch: "fix", path: WT_PATH, parentBranch: "main", createdAt: "" }
    const ctx = makeContext(ROOT, fakeState([wt]))
    expect(projectDirectories(ctx).sort()).toEqual([ROOT, WT_PATH].sort())
  })

  it("projectDirectories omits worktrees with empty paths and dedupes ctx.root", () => {
    const wt: Worktree = { id: "wt-1", branch: "fix", path: ROOT, parentBranch: "main", createdAt: "" }
    const empty: Worktree = { id: "wt-2", branch: "fix2", path: "", parentBranch: "main", createdAt: "" }
    const ctx = makeContext(ROOT, fakeState([wt, empty]))
    expect(projectDirectories(ctx)).toEqual([ROOT])
  })

  it("lists root and worktree sessions and registers each with its exact directory", async () => {
    const wt: Worktree = { id: "wt-1", branch: "fix", path: WT_PATH, parentBranch: "main", createdAt: "" }
    const ctx = makeContext(ROOT, fakeState([wt]))
    const rootSession = mkSession("ses-root", ROOT)
    const wtSession = mkSession("ses-wt", WT_PATH)
    const { listing, calls, registered } = recordingListing({
      [ROOT]: [rootSession],
      [WT_PATH]: [wtSession],
    })

    const out = await collectProjectSessions(ctx, listing)

    expect(out.map((s) => s.id).sort()).toEqual(["ses-root", "ses-wt"].sort())
    expect(calls.sort()).toEqual([ROOT, WT_PATH].sort())
    expect(registered.get("ses-root")).toBe(ROOT)
    expect(registered.get("ses-wt")).toBe(WT_PATH)
    // sessionToWebview round-trip
    expect(out.find((s) => s.id === "ses-root")?.title).toBe("Session ses-root")
  })

  it("does not list or include sessions from unrelated-project directories", async () => {
    const wt: Worktree = { id: "wt-1", branch: "fix", path: WT_PATH, parentBranch: "main", createdAt: "" }
    const ctx = makeContext(ROOT, fakeState([wt]))
    const foreign = mkSession("ses-foreign", OTHER)
    const rootSession = mkSession("ses-root", ROOT)
    // The foreign directory is present in the listing map but must never be queried,
    // because ctx only owns ROOT + its own worktree paths.
    const { listing, calls } = recordingListing({
      [ROOT]: [rootSession],
      [WT_PATH]: [],
      [OTHER]: [foreign],
    })

    const out = await collectProjectSessions(ctx, listing)

    expect(calls).not.toContain(OTHER)
    expect(out.map((s) => s.id)).toEqual(["ses-root"])
  })

  it("retains valid sessions when one directory listing fails", async () => {
    const wt: Worktree = { id: "wt-1", branch: "fix", path: WT_PATH, parentBranch: "main", createdAt: "" }
    const ctx = makeContext(ROOT, fakeState([wt]))
    const wtSession = mkSession("ses-wt", WT_PATH)
    const { listing, registered } = recordingListing({
      [ROOT]: () => {
        throw new Error("backend not connected")
      },
      [WT_PATH]: [wtSession],
    })

    const out = await collectProjectSessions(ctx, listing)

    expect(out.map((s) => s.id)).toEqual(["ses-wt"])
    expect(registered.get("ses-wt")).toBe(WT_PATH)
  })

  it("retains valid sessions when listSessions rejects (promise) for one directory", async () => {
    const wt: Worktree = { id: "wt-1", branch: "fix", path: WT_PATH, parentBranch: "main", createdAt: "" }
    const ctx = makeContext(ROOT, fakeState([wt]))
    const wtSession = mkSession("ses-wt", WT_PATH)
    const calls: string[] = []
    const registered = new Map<string, string>()
    const listing: ProjectSessionListing = {
      listSessions: async (dir) => {
        calls.push(dir)
        if (dir === ROOT) throw new Error("boom")
        return [wtSession]
      },
      setSessionDirectory: (id, dir) => registered.set(id, dir),
    }

    const out = await collectProjectSessions(ctx, listing)

    expect(out.map((s) => s.id)).toEqual(["ses-wt"])
    expect(registered.get("ses-wt")).toBe(WT_PATH)
  })

  it("returns [] when the SessionProvider has no listSessions", async () => {
    const wt: Worktree = { id: "wt-1", branch: "fix", path: WT_PATH, parentBranch: "main", createdAt: "" }
    const ctx = makeContext(ROOT, fakeState([wt]))
    const listing: ProjectSessionListing = { setSessionDirectory: () => {} }

    const out = await collectProjectSessions(ctx, listing)

    expect(out).toEqual([])
  })

  it("dedupes a session reported under two directories, keeping the first directory", async () => {
    const wt: Worktree = { id: "wt-1", branch: "fix", path: WT_PATH, parentBranch: "main", createdAt: "" }
    const ctx = makeContext(ROOT, fakeState([wt]))
    const shared = mkSession("ses-shared", ROOT)
    const { listing, registered } = recordingListing({
      [ROOT]: [shared],
      [WT_PATH]: [shared],
    })

    const out = await collectProjectSessions(ctx, listing)

    expect(out.map((s) => s.id)).toEqual(["ses-shared"])
    // ctx.root is listed first (insertion order of the Set), so it wins.
    expect(registered.get("ses-shared")).toBe(ROOT)
  })

  it("registerProjectSessions preserves managed placement (worktree session -> worktree path, local -> root)", () => {
    const wt: Worktree = { id: "wt-1", branch: "fix", path: WT_PATH, parentBranch: "main", createdAt: "" }
    const managed: ManagedSession[] = [
      { id: "ses-wt", worktreeId: "wt-1", createdAt: "" },
      { id: "ses-local", worktreeId: null, createdAt: "" },
    ]
    const ctx = makeContext(ROOT, fakeState([wt], managed))
    const registered = new Map<string, string>()
    const tracked: string[] = []
    registerProjectSessions(ctx, {
      setSessionDirectory: (id, dir) => registered.set(id, dir),
      trackSession: (id) => tracked.push(id),
    })

    expect(registered.get("ses-wt")).toBe(WT_PATH)
    expect(registered.get("ses-local")).toBe(ROOT)
    expect(tracked.sort()).toEqual(["ses-local", "ses-wt"].sort())
  })

  it("registerProjectSessions falls back to ctx.root when a managed worktree is gone", () => {
    const managed: ManagedSession[] = [{ id: "ses-orphan", worktreeId: "wt-gone", createdAt: "" }]
    const ctx = makeContext(ROOT, fakeState([], managed))
    const registered = new Map<string, string>()
    registerProjectSessions(ctx, {
      setSessionDirectory: (id, dir) => registered.set(id, dir),
      trackSession: () => {},
    })

    expect(registered.get("ses-orphan")).toBe(ROOT)
  })

  it("pushProjectSessions posts one projectSessions message with the collected ids", async () => {
    const wt: Worktree = { id: "wt-1", branch: "fix", path: WT_PATH, parentBranch: "main", createdAt: "" }
    const ctx = makeContext(ROOT, fakeState([wt]))
    const { listing } = recordingListing({
      [ROOT]: [mkSession("ses-root", ROOT)],
      [WT_PATH]: [mkSession("ses-wt", WT_PATH)],
    })
    const posted: Array<{ type: string; projectId: string; sessions: { id: string }[] }> = []

    await pushProjectSessions(ctx, listing, (msg) => posted.push(msg))

    expect(posted).toHaveLength(1)
    expect(posted[0]!.type).toBe("agentManager.projectSessions")
    expect(posted[0]!.projectId).toBe("prj-test")
    expect(posted[0]!.sessions.map((s) => s.id).sort()).toEqual(["ses-root", "ses-wt"].sort())
  })

  it("pushProjectSessions posts nothing when the context is disposed", async () => {
    const wt: Worktree = { id: "wt-1", branch: "fix", path: WT_PATH, parentBranch: "main", createdAt: "" }
    const ctx = makeContext(ROOT, fakeState([wt]))
    const { listing } = recordingListing({ [ROOT]: [mkSession("ses-root", ROOT)] })
    const posted: unknown[] = []
    await ctx.dispose()
    await pushProjectSessions(ctx, listing, (msg) => posted.push(msg))
    expect(posted).toHaveLength(0)
  })

  it("pushProjectSessions re-posts the cached list while the previous listing is fresh", async () => {
    const ctx = makeContext(ROOT, fakeState([]))
    const { listing, calls } = recordingListing({ [ROOT]: [mkSession("ses-root", ROOT)] })
    const posted: Array<{ sessions: Array<{ id: string }> }> = []

    await pushProjectSessions(ctx, listing, (msg) => posted.push(msg))
    expect(posted).toHaveLength(1)
    expect(calls).toHaveLength(1)

    // Fresh skip: no new backend listing, but the cached list is re-posted so
    // a webview that mounted after the first push still learns the sessions.
    await pushProjectSessions(ctx, listing, (msg) => posted.push(msg))
    expect(posted).toHaveLength(2)
    expect(posted[1]!.sessions.map((s) => s.id)).toEqual(["ses-root"])
    expect(calls).toHaveLength(1)
  })

  it("upsertSession makes a new session visible without a backend listing", async () => {
    const ctx = makeContext(ROOT, fakeState([]))
    const { listing } = recordingListing({ [ROOT]: [mkSession("ses-root", ROOT)] })
    const posted: Array<{ sessions: Array<{ id: string }> }> = []

    await pushProjectSessions(ctx, listing, (msg) => posted.push(msg))
    ctx.upsertSession({
      id: "ses-new",
      parentID: null,
      title: "new",
      createdAt: "",
      updatedAt: "",
      revert: null,
      summary: null,
      worktreeId: null,
    })
    expect(ctx.hasLiveSession("ses-new")).toBe(true)

    // The next push (still fresh) includes the upserted session from the cache.
    ctx.invalidateSessions()
    const { listing: listing2, calls } = recordingListing({
      [ROOT]: [mkSession("ses-root", ROOT), mkSession("ses-new", ROOT)],
    })
    await pushProjectSessions(ctx, listing2, (msg) => posted.push(msg))
    expect(
      posted
        .at(-1)!
        .sessions.map((s) => s.id)
        .sort(),
    ).toEqual(["ses-new", "ses-root"])
    expect(calls).toHaveLength(1)
  })
})

describe("Agent Manager route registration during project-init", () => {
  it("registerProjectSessions registers the project root, worktrees, and managed session routes", () => {
    const routes = new ProjectRouteService()
    const wt: Worktree = { id: "wt-1", branch: "fix", path: WT_PATH, parentBranch: "main", createdAt: "" }
    const managed: ManagedSession[] = [
      { id: "ses-wt", worktreeId: "wt-1", createdAt: "" },
      { id: "ses-local", worktreeId: null, createdAt: "" },
    ]
    const ctx = makeContext(ROOT, fakeState([wt], managed))
    const { listing } = routeListing(routes, {}, ctx.id, ctx.generation)

    registerProjectSessions(ctx, listing)

    // Project root route
    expect(routes.projectRoot({ projectId: ctx.id })).toBe(ROOT)
    // Worktree route
    expect(routes.worktreeDirectory({ projectId: ctx.id, worktreeId: "wt-1" })).toBe(WT_PATH)
    // Session routes resolve exactly
    const wtRef: SessionRef = { projectId: ctx.id, sessionId: "ses-wt" }
    const localRef: SessionRef = { projectId: ctx.id, sessionId: "ses-local" }
    expect(routes.sessionDirectory(wtRef)).toBe(WT_PATH)
    expect(routes.sessionDirectory(localRef)).toBe(ROOT)
  })

  it("collectProjectSessions registers routes for every live session and worktree", async () => {
    const routes = new ProjectRouteService()
    const wt: Worktree = { id: "wt-1", branch: "fix", path: WT_PATH, parentBranch: "main", createdAt: "" }
    const ctx = makeContext(ROOT, fakeState([wt]))
    const rootSession = mkSession("ses-root", ROOT)
    const wtSession = mkSession("ses-wt", WT_PATH)
    const { listing } = routeListing(routes, { [ROOT]: [rootSession], [WT_PATH]: [wtSession] }, ctx.id, ctx.generation)

    await collectProjectSessions(ctx, listing)

    expect(routes.projectRoot({ projectId: ctx.id })).toBe(ROOT)
    const wtDirRef: WorktreeRef = { projectId: ctx.id, worktreeId: "wt-1" }
    expect(routes.worktreeDirectory(wtDirRef)).toBe(WT_PATH)
    expect(routes.sessionDirectory({ projectId: ctx.id, sessionId: "ses-root" })).toBe(ROOT)
    expect(routes.sessionDirectory({ projectId: ctx.id, sessionId: "ses-wt" })).toBe(WT_PATH)
  })

  it("same raw session id in two projects is ambiguous after both register", () => {
    const routes = new ProjectRouteService()
    const ctxA = makeContext("/repo/a", fakeState([]), "prj-a")
    const ctxB = makeContext("/repo/b", fakeState([]), "prj-b")
    const listingA = routeListing(routes, {}, ctxA.id, ctxA.generation).listing
    const listingB = routeListing(routes, {}, ctxB.id, ctxB.generation).listing

    // Register each project root first (as registerProjectRoutes would),
    // then register the same raw session id in both projects.
    listingA.registerProjectRoute!({ projectId: ctxA.id }, "/repo/a", ctxA.generation)
    listingB.registerProjectRoute!({ projectId: ctxB.id }, "/repo/b", ctxB.generation)
    listingA.registerSessionRoute!({ projectId: ctxA.id, sessionId: "same" }, "/repo/a", ctxA.generation)
    listingB.registerSessionRoute!({ projectId: ctxB.id, sessionId: "same" }, "/repo/b", ctxB.generation)

    expect(routes.isSessionAmbiguous("same")).toBe(true)
    expect(routes.trySessionDirectory("same")).toBeUndefined()
    // Project-qualified refs still resolve exactly.
    expect(routes.trySessionDirectoryFor({ projectId: ctxA.id, sessionId: "same" })).toBe("/repo/a")
    expect(routes.trySessionDirectoryFor({ projectId: ctxB.id, sessionId: "same" })).toBe("/repo/b")
  })

  it("unregisterProjectRoutes clears all routes for a project", () => {
    const routes = new ProjectRouteService()
    const wt: Worktree = { id: "wt-1", branch: "fix", path: WT_PATH, parentBranch: "main", createdAt: "" }
    const managed: ManagedSession[] = [{ id: "ses-wt", worktreeId: "wt-1", createdAt: "" }]
    const ctx = makeContext(ROOT, fakeState([wt], managed))
    const { listing } = routeListing(routes, {}, ctx.id, ctx.generation)

    registerProjectSessions(ctx, listing)
    expect(routes.hasSession({ projectId: ctx.id, sessionId: "ses-wt" })).toBe(true)

    unregisterProjectRoutes(ctx, listing)
    expect(routes.hasSession({ projectId: ctx.id, sessionId: "ses-wt" })).toBe(false)
    expect(routes.trySessionDirectory("ses-wt")).toBeUndefined()
  })

  it("registerProjectSessions is a no-op when the listing has no route methods", () => {
    const routes = new ProjectRouteService()
    const wt: Worktree = { id: "wt-1", branch: "fix", path: WT_PATH, parentBranch: "main", createdAt: "" }
    const managed: ManagedSession[] = [{ id: "ses-wt", worktreeId: "wt-1", createdAt: "" }]
    const ctx = makeContext(ROOT, fakeState([wt], managed))
    // Plain listing without route methods — must not throw.
    const registered = new Map<string, string>()
    const listing = {
      setSessionDirectory: (id: string, dir: string) => registered.set(id, dir),
      trackSession: () => {},
    }
    registerProjectSessions(ctx, listing)
    expect(registered.get("ses-wt")).toBe(WT_PATH)
    // No routes were registered.
    expect(routes.trySessionDirectory("ses-wt")).toBeUndefined()
  })
})
