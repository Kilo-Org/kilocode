import { afterEach, describe, expect, it } from "bun:test"
import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import simpleGit from "simple-git"
import { WorktreeManager } from "../../src/agent-manager/WorktreeManager"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true })
    }),
  )
})

function gitExec(args: string[]) {
  const res = Bun.spawnSync(args, { stdout: "ignore", stderr: "pipe" })
  if (res.exitCode !== 0) {
    const err = Buffer.from(res.stderr).toString("utf8")
    throw new Error(`git command failed (${args.join(" ")}): ${err}`)
  }
}

async function createTempRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-pool-"))
  tempDirs.push(dir)
  gitExec(["git", "init", "-b", "main", dir])
  gitExec(["git", "-C", dir, "config", "user.email", "test@test.com"])
  gitExec(["git", "-C", dir, "config", "user.name", "Test"])
  await fs.writeFile(path.join(dir, "README.md"), "init")
  gitExec(["git", "-C", dir, "add", "."])
  gitExec(["git", "-C", dir, "commit", "-m", "initial commit"])
  return dir
}

function createManager(root: string, poolSize = 1): WorktreeManager {
  return new WorktreeManager(root, () => undefined, undefined, undefined, poolSize)
}

async function pooledSlots(root: string): Promise<string[]> {
  const raw = await simpleGit(root).raw(["worktree", "list", "--porcelain"])
  const slots: string[] = []
  for (const block of raw.split("\n\n")) {
    const lines = block.split("\n")
    const worktree = lines.find((line) => line.startsWith("worktree "))?.slice(9)
    const detached = lines.some((line) => line === "detached")
    if (worktree && detached) slots.push(worktree)
  }
  return slots
}

async function slotMeta(slot: string): Promise<Record<string, unknown> | undefined> {
  const pointer = await fs.readFile(path.join(slot, ".git"), "utf-8").catch(() => undefined)
  const match = pointer?.match(/^gitdir:\s*(.+)$/m)
  if (!match) return undefined
  const dir = path.resolve(slot, match[1]!.trim())
  const raw = await fs.readFile(path.join(dir, "kilo-agent-manager-metadata.json"), "utf-8").catch(() => undefined)
  if (!raw) return undefined
  return JSON.parse(raw) as Record<string, unknown>
}

async function waitForPooledSlot(root: string, timeout = 10000): Promise<string> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    for (const slot of await pooledSlots(root)) {
      if ((await slotMeta(slot))?.pooled === true) return slot
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error("Timed out waiting for a pooled slot")
}

describe("WorktreeManager pool warm-up", () => {
  it("creates a detached slot that discoverWorktrees skips", async () => {
    const root = await createTempRepo()
    const manager = createManager(root)

    manager.warmPool()
    await waitForPooledSlot(root)

    const slots = await pooledSlots(root)
    expect(slots).toHaveLength(1)
    expect(await manager.discoverWorktrees()).toEqual([])
  })
})

describe("WorktreeManager pool claim", () => {
  it("claims an exact-match slot for a generated name and keeps the slot path", async () => {
    const root = await createTempRepo()
    const manager = createManager(root)

    manager.warmPool()
    const slot = await waitForPooledSlot(root)

    const result = await manager.createWorktree({})

    expect(await fs.realpath(result.path)).toBe(await fs.realpath(slot))
    expect(result.branch).toBe(path.basename(slot))
    expect((await simpleGit(slot).raw(["symbolic-ref", "--short", "HEAD"])).trim()).toBe(result.branch)
    expect(await fs.stat(path.join(result.path, ".git")).then((stat) => stat.isFile())).toBe(true)

    const raw = await simpleGit(root).raw(["worktree", "list", "--porcelain"])
    const block = raw.split("\n\n").find((entry) => entry.includes(slot))
    expect(block).toBeDefined()
    expect(block).not.toContain("detached")

    expect((await slotMeta(slot))?.pooled).toBeFalsy()

    // A replacement slot is warmed after the claim, off the click path.
    const next = await waitForPooledSlot(root)
    expect(next).not.toBe(slot)
  })

  it("moves a claimed slot to the branch-named directory for an explicit branch", async () => {
    const root = await createTempRepo()
    const manager = createManager(root)

    manager.warmPool()
    const slot = await waitForPooledSlot(root)

    const result = await manager.createWorktree({ branchName: "feature" })

    expect(result.path).toBe(path.join(root, ".kilo", "worktrees", "feature"))
    expect(existsSync(slot)).toBe(false)
    expect((await simpleGit(result.path).raw(["symbolic-ref", "--short", "HEAD"])).trim()).toBe("feature")
    expect((await simpleGit(result.path).raw(["status", "--porcelain"])).trim()).toBe("")
  })

  it("preserves an existing branch when a delta claim collides with the slot name", async () => {
    const root = await createTempRepo()
    const manager = createManager(root)

    manager.warmPool()
    const slot = await waitForPooledSlot(root)
    const name = path.basename(slot)
    const git = simpleGit(root)

    gitExec(["git", "-C", root, "checkout", "-b", name])
    gitExec(["git", "-C", root, "commit", "--allow-empty", "-m", "preserve this commit"])
    const original = (await git.revparse(["HEAD"])).trim()
    gitExec(["git", "-C", root, "checkout", "main"])
    gitExec(["git", "-C", root, "commit", "--allow-empty", "-m", "advance base"])
    const head = (await git.revparse(["HEAD"])).trim()

    const result = await manager.createWorktree({})

    expect((await git.revparse([`refs/heads/${name}`])).trim()).toBe(original)
    expect(result.branch).not.toBe(name)
    expect((await simpleGit(result.path).revparse(["HEAD"])).trim()).toBe(head)
    expect((await simpleGit(result.path).raw(["symbolic-ref", "--short", "HEAD"])).trim()).toBe(result.branch)
    expect((await simpleGit(result.path).raw(["status", "--porcelain"])).trim()).toBe("")
  })

  it("claims a small-delta slot and yields a clean worktree at the requested commit", async () => {
    const root = await createTempRepo()
    const manager = createManager(root)

    manager.warmPool()
    const slot = await waitForPooledSlot(root)
    await new Promise((resolve) => setTimeout(resolve, 150))

    await fs.writeFile(path.join(root, "next.txt"), "next")
    gitExec(["git", "-C", root, "add", "."])
    gitExec(["git", "-C", root, "commit", "-m", "second"])
    const head = (await simpleGit(root).revparse(["HEAD"])).trim()

    const result = await manager.createWorktree({ branchName: "delta" })

    expect(result.path).toBe(path.join(root, ".kilo", "worktrees", "delta"))
    expect(existsSync(slot)).toBe(false)
    expect((await simpleGit(result.path).revparse(["HEAD"])).trim()).toBe(head)
    expect((await simpleGit(result.path).raw(["symbolic-ref", "--short", "HEAD"])).trim()).toBe("delta")
    expect((await simpleGit(result.path).raw(["status", "--porcelain"])).trim()).toBe("")
  })
})

describe("WorktreeManager pool disabled", () => {
  it("keeps creation behavior unchanged when poolSize is 0", async () => {
    const root = await createTempRepo()
    const manager = createManager(root, 0)

    manager.warmPool()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(await pooledSlots(root)).toEqual([])

    const result = await manager.createWorktree({ branchName: "plain" })

    expect(result.path).toBe(path.join(root, ".kilo", "worktrees", "plain"))
    expect((await simpleGit(result.path).raw(["symbolic-ref", "--short", "HEAD"])).trim()).toBe("plain")
  })
})

describe("WorktreeManager commit detection", () => {
  it("reports an empty repository through the commit check", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-pool-empty-"))
    tempDirs.push(root)
    gitExec(["git", "init", "-b", "main", root])

    await expect(createManager(root).defaultBranch()).rejects.toThrow(
      "This repository has no commits yet. Create an initial commit before using worktrees.",
    )
  })
})
