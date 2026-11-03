import { afterEach, describe, expect, it, spyOn } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { ProjectContext } from "../src/agent-manager/project/context"
import { initContextState } from "../src/agent-manager/project/init"

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
  expect(Bun.spawnSync(["git", "init", "-b", "main", "--template=", root]).exitCode).toBe(0)
  const run = (args: string[]) => Bun.spawnSync(["git", ...args], { cwd: root })
  expect(run(["config", "--local", "user.name", "Test"]).exitCode).toBe(0)
  expect(run(["config", "--local", "user.email", "test@example.invalid"]).exitCode).toBe(0)
  expect(run(["-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "Initial commit"]).exitCode).toBe(0)
  return { ctx, root }
}

describe("project initialization pool policy", () => {
  it("keeps attachment and concurrent hydration free of pooled worktrees", async () => {
    const { ctx, root } = await project(false)
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
    const list = Bun.spawnSync(["git", "worktree", "list", "--porcelain"], { cwd: root }).stdout.toString()
    expect(list.match(/^worktree /gm)).toHaveLength(1)
    expect(await initContextState(ctx, () => {}, { warm: true })).toBe(result)
    await reconcile.mock.results.at(0)?.value
    expect(reconcile).toHaveBeenCalledTimes(1)
    expect(warm).toHaveBeenCalledTimes(1)
    await initContextState(ctx, () => {})
    expect(reconcile).toHaveBeenCalledTimes(1)
  })

  it("does not warm after disposal during pool reconciliation", async () => {
    const { ctx } = await project(false)
    const pending = Promise.withResolvers<void>()
    const manager = ctx.worktreeManager()
    spyOn(manager, "reconcilePool").mockImplementation(() => pending.promise)
    const warm = spyOn(manager, "warmPool")
    await initContextState(ctx, () => {})
    const disposal = ctx.dispose()
    pending.resolve()
    await disposal
    expect(warm).not.toHaveBeenCalled()
  })
})