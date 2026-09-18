import { afterEach, describe, expect, it, spyOn } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import simpleGit from "simple-git"
import { ProjectContext } from "../../src/agent-manager/project/context"
import { initContextState } from "../../src/agent-manager/project/init"

const contexts: ProjectContext[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) {
    await ctx.dispose()
    await fs.rm(ctx.root, { recursive: true, force: true })
  }
})

async function project(pool: boolean) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "kilo-project-init-")))
  const ctx = new ProjectContext("project", root, false, { log: () => {}, worktreePool: () => pool })
  contexts.push(ctx)
  const git = simpleGit(root)
  expect(Bun.spawnSync(["git", "init", "-b", "main", "--template=", root]).exitCode).toBe(0)
  await git.raw(["config", "--local", "user.name", "Test"])
  await git.raw(["config", "--local", "user.email", "test@example.invalid"])
  await git.raw(["-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "Initial commit"])
  return { ctx, git }
}

describe("project initialization pool policy", () => {
  it("keeps attachment and concurrent hydration free of pooled worktrees", async () => {
    const { ctx, git } = await project(true)
    const manager = ctx.worktreeManager()
    const reconcile = spyOn(manager, "reconcilePool")
    const warm = spyOn(manager, "warmPool")
    const pending = initContextState(ctx, () => {}, { warm: false })
    const hydration = initContextState(ctx, () => {})
    const result = await pending
    expect(result).toMatchObject({ ok: true, current: true })
    expect(await hydration).toBe(result)
    expect(await initContextState(ctx, () => {})).toBe(result)
    expect(reconcile).not.toHaveBeenCalled()
    expect(warm).not.toHaveBeenCalled()
    expect((await git.raw(["worktree", "list", "--porcelain"])).match(/^worktree /gm)).toHaveLength(1)
  })

  it.each([undefined, true])("preserves pool initialization when warm is %s", async (value) => {
    // Keep the real pool disabled here so its asynchronous checkout cannot outlive the test.
    const { ctx } = await project(false)
    const manager = ctx.worktreeManager()
    const reconcile = spyOn(manager, "reconcilePool")
    const warm = spyOn(manager, "warmPool")
    expect(await initContextState(ctx, () => {}, value === undefined ? undefined : { warm: value })).toMatchObject({
      ok: true,
      current: true,
    })
    expect(reconcile).toHaveBeenCalledTimes(1)
    await reconcile.mock.results.at(0)?.value
    expect(warm).toHaveBeenCalledTimes(1)
  })
})
