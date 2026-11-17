import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { resolveImageDirectory } from "../src/agent-manager/save-image-directory"
import { WorktreeStateManager } from "../src/agent-manager/WorktreeStateManager"

describe("Agent Manager save image directory", () => {
  let root: string
  let worktree: string
  let state: WorktreeStateManager

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "am-save-image-"))
    worktree = path.join(root, ".kilo", "worktrees", "one")
    fs.mkdirSync(worktree, { recursive: true })
    state = new WorktreeStateManager(root, () => undefined)
    state.addWorktree({ branch: "one", path: worktree, parentBranch: "main" })
    state.addSession("parent", state.getWorktrees()[0]!.id)
  })

  afterEach(async () => {
    await state.flush()
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  })

  it("saves a subagent image in the worktree the server runs it in", async () => {
    const directory = await resolveImageDirectory({
      sessionID: "subagent",
      state,
      root,
      location: async (id) => (id === "subagent" ? worktree : undefined),
    })

    expect(directory).toBe(worktree)
  })

  it("saves a session of another project in the directory the server reports", async () => {
    const other = path.join(os.tmpdir(), "am-save-image-other")
    const directory = await resolveImageDirectory({
      sessionID: "other",
      state,
      root,
      location: async () => other,
    })

    expect(directory).toBe(other)
  })

  it("uses the filed worktree of the viewed session when the server cannot report a directory", async () => {
    const directory = await resolveImageDirectory({
      visibleSession: "parent",
      state,
      root,
      location: async () => undefined,
    })

    expect(directory).toBe(worktree)
  })

  it("saves a local session in the project root", async () => {
    state.addSession("local", null)
    const directory = await resolveImageDirectory({
      sessionID: "local",
      state,
      root,
      location: async () => undefined,
    })

    expect(directory).toBe(root)
  })

  it("falls back to the project root for an unknown session", async () => {
    const directory = await resolveImageDirectory({
      sessionID: "unknown",
      state,
      root,
      location: async () => undefined,
    })

    expect(directory).toBe(root)
  })

  it("falls back to the project root without a session", async () => {
    const directory = await resolveImageDirectory({
      state,
      root,
      location: async () => {
        throw new Error("must not ask the server without a session")
      },
    })

    expect(directory).toBe(root)
  })

  it("prefers the requesting session over the viewed session and the review directory", async () => {
    const directory = await resolveImageDirectory({
      sessionID: "parent",
      visibleSession: "other",
      activeDiffDirectory: () => os.tmpdir(),
      state,
      root,
      location: async (id) => (id === "other" ? os.tmpdir() : worktree),
    })

    expect(directory).toBe(worktree)
  })

  it("uses the review directory for a pane outside a transcript", async () => {
    const review = path.join(root, ".kilo", "worktrees", "two")
    const directory = await resolveImageDirectory({
      visibleSession: "parent",
      activeDiffDirectory: () => review,
      state,
      root,
      location: async () => worktree,
    })

    expect(directory).toBe(review)
  })

  it("uses the review directory over a stale viewed subagent", async () => {
    const review = path.join(root, ".kilo", "worktrees", "two")
    const directory = await resolveImageDirectory({
      visibleSession: "subagent",
      activeDiffDirectory: () => review,
      state,
      root,
      location: async () => worktree,
    })

    expect(directory).toBe(review)
  })

  it("falls back to the viewed session when no review directory is active", async () => {
    const directory = await resolveImageDirectory({
      visibleSession: "parent",
      activeDiffDirectory: () => undefined,
      state,
      root,
      location: async () => undefined,
    })

    expect(directory).toBe(worktree)
  })
})
