import { afterEach, describe, expect, it } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { simpleGit } from "simple-git"
import { captureState } from "../../src/agent-manager/continue-in-worktree"
import type { ContinueContext } from "../../src/agent-manager/continue-in-worktree"
import { ProjectContexts } from "../../src/agent-manager/project/contexts"
import { ProjectScope } from "../../src/agent-manager/project/scope"
import { continueSidebar } from "../../src/agent-manager/project/sidebar"

function setup() {
  const other = { id: "other", root: "/repo/b", order: 1, addedAt: new Date().toISOString() }
  const contexts = new ProjectContexts({
    workspaceRoot: () => "/repo/a",
    registry: { list: () => [other], get: (id) => (id === other.id ? other : undefined) },
    deps: { log: () => {}, exists: () => true },
  })
  contexts.activate(other.id)
  return { contexts, scope: new ProjectScope() }
}

describe("sidebar project routing", () => {
  it("pins continuation to the sidebar source across asynchronous work", async () => {
    const { contexts, scope } = setup()
    const roots: string[] = []
    await continueSidebar(
      contexts,
      scope,
      "/repo/a",
      () => {},
      async () => {
        roots.push(scope.current()!.root)
        await Promise.resolve()
        roots.push(scope.current()!.root)
      },
    )
    expect(roots).toEqual(["/repo/a", "/repo/a"])
    expect(contexts.active()?.root).toBe("/repo/b")
    expect(scope.current()).toBeUndefined()
  })

  it("does not fall back to the selected project for an unknown source", async () => {
    const { contexts, scope } = setup()
    const roots: string[] = []
    const errors: string[] = []
    await continueSidebar(
      contexts,
      scope,
      "/unknown",
      (status, _, error) => errors.push(`${status}: ${error}`),
      async () => {
        roots.push(scope.current()!.root)
      },
    )
    expect(errors).toEqual(["error: Source session project is not available"])
    expect(roots).toEqual([])
    expect(contexts.active()?.root).toBe("/repo/b")
  })

  it("retains the source scope when project selection changes", async () => {
    const { contexts, scope } = setup()
    await continueSidebar(
      contexts,
      scope,
      "/repo/a",
      () => {},
      async () => {
        contexts.activate("other")
        await Promise.resolve()
        expect(scope.current()?.root).toBe("/repo/a")
      },
    )
  })
})

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

it("captures git state from repository A while repository B is selected", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "sidebar-project-"))
  dirs.push(base)
  const a = path.join(base, "a")
  const b = path.join(base, "b")
  for (const dir of [a, b]) {
    await fs.mkdir(dir)
    const git = simpleGit(dir)
    await git.init(["--initial-branch=main"])
    await git.addConfig("user.name", "Test")
    await git.addConfig("user.email", "test@test.com")
    await fs.writeFile(path.join(dir, "state.txt"), "base\n")
    await git.add("state.txt")
    await git.commit("initial")
  }
  await fs.writeFile(path.join(a, "state.txt"), "source A\n")
  await fs.writeFile(path.join(b, "state.txt"), "selected B\n")
  const other = { id: "other", root: b, order: 1, addedAt: new Date().toISOString() }
  const contexts = new ProjectContexts({
    workspaceRoot: () => a,
    registry: { list: () => [other], get: (id) => (id === other.id ? other : undefined) },
    deps: { log: () => {} },
  })
  contexts.activate(other.id)
  const scope = new ProjectScope()
  await continueSidebar(
    contexts,
    scope,
    a,
    () => {},
    async () => {
      const result = await captureState({ root: scope.current()!.root, log: () => {} } as ContinueContext)
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.error)
      expect(JSON.stringify(result.value)).toContain("source A")
      expect(JSON.stringify(result.value)).not.toContain("selected B")
    },
  )
  expect(contexts.active()?.root).toBe(b)
})

it("routes a symlinked workspace path to its canonical pinned project", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "sidebar-symlink-"))
  dirs.push(base)
  const root = path.join(base, "repo")
  const alias = path.join(base, "alias")
  await fs.mkdir(root)
  await fs.symlink(root, alias, "dir")
  const contexts = new ProjectContexts({
    workspaceRoot: () => alias,
    registry: { list: () => [], get: () => undefined },
    deps: { log: () => {} },
  })
  const scope = new ProjectScope()
  const roots: string[] = []
  const errors: string[] = []
  await continueSidebar(
    contexts,
    scope,
    alias,
    (_, __, error) => errors.push(error ?? ""),
    async () => {
      roots.push(scope.current()!.root)
    },
  )
  expect(errors).toEqual([])
  expect(roots).toEqual([await fs.realpath(root)])
})
