import { afterEach, describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { WorktreeStateManager } from "../src/agent-manager/WorktreeStateManager"
import { createSessionRoots, resolveSessionFile } from "../src/agent-manager/session-file-root"

/** A project root with a worktree folder, and `src/math.ts` in both. */
function project() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "am-session-root-")))
  const worktree = path.join(root, ".kilo", "worktrees", "one")
  for (const dir of [root, worktree]) {
    fs.mkdirSync(path.join(dir, "src"), { recursive: true })
    fs.writeFileSync(path.join(dir, "src", "math.ts"), "")
  }
  fs.mkdirSync(path.join(root, ".kilo2"))
  dirs.push(root)
  return { root, worktree }
}

function directories(known: Record<string, string | undefined>) {
  const calls: string[] = []
  const roots = createSessionRoots(async (sessionID) => {
    calls.push(sessionID)
    return known[sessionID]
  })
  return { roots, calls, known }
}

/** A read that stays pending until the test settles it, in call order. */
function deferred() {
  const resolvers: Array<(directory: string | undefined) => void> = []
  const calls: string[] = []
  const roots = createSessionRoots((sessionID) => {
    calls.push(sessionID)
    return new Promise<string | undefined>((resolve) => resolvers.push(resolve))
  })
  return { roots, calls, settle: (index: number, directory: string | undefined) => resolvers[index]?.(directory) }
}

const dirs: string[] = []
const managers: WorktreeStateManager[] = []

function state(root: string) {
  const manager = new WorktreeStateManager(root, () => undefined)
  managers.push(manager)
  return manager
}

afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.flush()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
})

describe("resolveSessionFile", () => {
  it("resolves a subagent from the directory its parent runs in", async () => {
    const repo = project()
    const manager = state(repo.root)
    const worktree = manager.addWorktree({ branch: "one", path: repo.worktree, parentBranch: "main" })
    manager.addSession("ses_parent", worktree.id)
    const read = directories({ ses_child: repo.worktree })

    expect(
      await resolveSessionFile({
        state: manager,
        roots: read.roots,
        id: "ses_child",
        file: "src/math.ts",
        root: repo.root,
      }),
    ).toBe(path.join(repo.worktree, "src", "math.ts"))
    expect(read.calls).toEqual(["ses_child"])
  })

  it("resolves a session the panel shows under a worktree but the state file does not file", async () => {
    const repo = project()
    const manager = state(repo.root)
    manager.addWorktree({ branch: "one", path: repo.worktree, parentBranch: "main" })
    const read = directories({ ses_unfiled: repo.worktree })

    expect(
      await resolveSessionFile({
        state: manager,
        roots: read.roots,
        id: "ses_unfiled",
        file: "src/math.ts",
        root: repo.root,
      }),
    ).toBe(path.join(repo.worktree, "src", "math.ts"))
    expect(manager.getSession("ses_unfiled")).toBeUndefined()
  })

  it("keeps the project root of a session the user filed under Local", async () => {
    const repo = project()
    const manager = state(repo.root)
    manager.addWorktree({ branch: "one", path: repo.worktree, parentBranch: "main" })
    manager.addSession("ses_local", null)
    const read = directories({ ses_local: repo.worktree })

    expect(
      await resolveSessionFile({
        state: manager,
        roots: read.roots,
        id: "ses_local",
        file: "src/math.ts",
        root: repo.root,
      }),
    ).toBe(path.join(repo.root, "src", "math.ts"))
    expect(read.calls).toEqual([])
  })

  it("uses the filed worktree without reading the server", async () => {
    const repo = project()
    const manager = state(repo.root)
    const worktree = manager.addWorktree({ branch: "one", path: repo.worktree, parentBranch: "main" })
    manager.addSession("ses_filed", worktree.id)
    const read = directories({ ses_filed: repo.worktree })

    expect(
      await resolveSessionFile({
        state: manager,
        roots: read.roots,
        id: "ses_filed",
        file: "src/math.ts",
        root: repo.root,
      }),
    ).toBe(path.join(repo.worktree, "src", "math.ts"))
    expect(read.calls).toEqual([])
  })

  it("rejects a relative path that escapes the session directory", async () => {
    const repo = project()
    const manager = state(repo.root)
    fs.writeFileSync(path.join(repo.root, ".kilo", "worktrees", "escaped.ts"), "")
    const read = directories({ ses_child: repo.worktree })

    expect(
      await resolveSessionFile({
        state: manager,
        roots: read.roots,
        id: "ses_child",
        file: "../escaped.ts",
        root: repo.root,
      }),
    ).toBeUndefined()
  })

  it("returns nothing when the server cannot name the session directory", async () => {
    const repo = project()
    const manager = state(repo.root)
    const read = directories({})

    expect(
      await resolveSessionFile({
        state: manager,
        roots: read.roots,
        id: "ses_gone",
        file: "src/math.ts",
        root: repo.root,
      }),
    ).toBeUndefined()
    expect(read.calls).toEqual(["ses_gone"])
  })

  it("reads the directory once for repeated links", async () => {
    const repo = project()
    const manager = state(repo.root)
    const read = directories({ ses_child: repo.worktree })

    await resolveSessionFile({ state: manager, roots: read.roots, id: "ses_child", file: "src/math.ts", root: repo.root })
    await resolveSessionFile({ state: manager, roots: read.roots, id: "ses_child", file: "src/math.ts", root: repo.root })

    expect(read.calls).toEqual(["ses_child"])
  })

  it("follows a subagent whose directory changes and forgets a deleted one", async () => {
    const repo = project()
    const manager = state(repo.root)
    const other = path.join(repo.root, ".kilo", "worktrees", "two")
    fs.mkdirSync(path.join(other, "src"), { recursive: true })
    fs.writeFileSync(path.join(other, "src", "math.ts"), "")
    const read = directories({ ses_child: repo.worktree })

    await resolveSessionFile({ state: manager, roots: read.roots, id: "ses_child", file: "src/math.ts", root: repo.root })
    read.roots.event({ type: "session.moved", data: { sessionID: "ses_child", location: { directory: other } } })
    expect(
      await resolveSessionFile({
        state: manager,
        roots: read.roots,
        id: "ses_child",
        file: "src/math.ts",
        root: repo.root,
      }),
    ).toBe(path.join(other, "src", "math.ts"))

    read.roots.event({ type: "session.deleted", data: { sessionID: "ses_child" } })
    read.known.ses_child = undefined
    // The deleted session is forgotten, so the next link reads the server again instead of keeping the old root.
    expect(
      await resolveSessionFile({
        state: manager,
        roots: read.roots,
        id: "ses_child",
        file: "src/math.ts",
        root: repo.root,
      }),
    ).toBeUndefined()
    expect(read.calls).toEqual(["ses_child", "ses_child"])
  })

  it("keeps a move that lands while the directory read is pending", async () => {
    const repo = project()
    const manager = state(repo.root)
    const other = path.join(repo.root, ".kilo", "worktrees", "two")
    fs.mkdirSync(path.join(other, "src"), { recursive: true })
    fs.writeFileSync(path.join(other, "src", "math.ts"), "")
    const read = deferred()

    const raced = resolveSessionFile({
      state: manager,
      roots: read.roots,
      id: "ses_child",
      file: "src/math.ts",
      root: repo.root,
    })
    read.roots.event({ type: "session.moved", data: { sessionID: "ses_child", location: { directory: other } } })
    read.settle(0, repo.worktree)
    // The read started before the move, so the click that raced the event takes the destination it reported.
    expect(await raced).toBe(path.join(other, "src", "math.ts"))

    // The read started before the move, so the next link keeps the destination the event reported.
    expect(
      await resolveSessionFile({
        state: manager,
        roots: read.roots,
        id: "ses_child",
        file: "src/math.ts",
        root: repo.root,
      }),
    ).toBe(path.join(other, "src", "math.ts"))
    expect(read.calls).toEqual(["ses_child"])
  })

  it("remembers a created session from its payload location", async () => {
    const repo = project()
    const manager = state(repo.root)
    const read = directories({})

    read.roots.event({
      type: "session.created",
      data: { sessionID: "ses_child", location: { directory: repo.worktree } },
    })

    expect(
      await resolveSessionFile({
        state: manager,
        roots: read.roots,
        id: "ses_child",
        file: "src/math.ts",
        root: repo.root,
      }),
    ).toBe(path.join(repo.worktree, "src", "math.ts"))
    expect(read.calls).toEqual([])
  })

  it("keeps an in-flight read when the created event has no directory", async () => {
    const repo = project()
    const manager = state(repo.root)
    const read = deferred()

    const raced = resolveSessionFile({
      state: manager,
      roots: read.roots,
      id: "ses_child",
      file: "src/math.ts",
      root: repo.root,
    })
    read.roots.event({ type: "session.created", data: { sessionID: "ses_child" } })
    read.settle(0, repo.worktree)

    expect(await raced).toBe(path.join(repo.worktree, "src", "math.ts"))
    await resolveSessionFile({ state: manager, roots: read.roots, id: "ses_child", file: "src/math.ts", root: repo.root })
    expect(read.calls).toEqual(["ses_child"])
  })

  it("does not resurrect a deleted session from a read that was already running", async () => {
    const repo = project()
    const manager = state(repo.root)
    const read = deferred()

    const raced = resolveSessionFile({
      state: manager,
      roots: read.roots,
      id: "ses_child",
      file: "src/math.ts",
      root: repo.root,
    })
    read.roots.event({ type: "session.deleted", data: { sessionID: "ses_child" } })
    read.settle(0, repo.worktree)
    // The click that raced the delete gets no directory, so it opens nothing from the removed session.
    expect(await raced).toBeUndefined()

    // The deleted id was not cached, so the next link asks the server again.
    const next = resolveSessionFile({
      state: manager,
      roots: read.roots,
      id: "ses_child",
      file: "src/math.ts",
      root: repo.root,
    })
    read.settle(1, repo.worktree)
    expect(await next).toBe(path.join(repo.worktree, "src", "math.ts"))
    expect(read.calls).toEqual(["ses_child", "ses_child"])
  })

  it("does not let an older read replace a newer pending read", async () => {
    const repo = project()
    const manager = state(repo.root)
    const read = deferred()
    const lookup = { state: manager, roots: read.roots, id: "ses_child", file: "src/math.ts", root: repo.root }

    const first = resolveSessionFile(lookup)
    read.roots.event({ type: "session.deleted", data: { sessionID: "ses_child" } })
    const second = resolveSessionFile(lookup)
    read.settle(0, repo.worktree)
    // The superseded read returns nothing and leaves the newer read in place.
    expect(await first).toBeUndefined()
    // The third link joins the read started after the delete instead of starting another one.
    const third = resolveSessionFile(lookup)
    read.settle(1, repo.worktree)
    expect(await second).toBe(path.join(repo.worktree, "src", "math.ts"))
    expect(read.calls).toEqual(["ses_child", "ses_child"])
    read.settle(2, repo.worktree)
    expect(await third).toBe(path.join(repo.worktree, "src", "math.ts"))
  })

  it("resolves a session in a directory that is neither the root nor a worktree", async () => {
    const repo = project()
    const manager = state(repo.root)
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "am-outside-")))
    dirs.push(outside)
    fs.mkdirSync(path.join(outside, "src"))
    fs.writeFileSync(path.join(outside, "src", "math.ts"), "")
    const read = directories({ ses_child: outside })

    expect(
      await resolveSessionFile({
        state: manager,
        roots: read.roots,
        id: "ses_child",
        file: "src/math.ts",
        root: repo.root,
      }),
    ).toBe(path.join(outside, "src", "math.ts"))
  })
})
