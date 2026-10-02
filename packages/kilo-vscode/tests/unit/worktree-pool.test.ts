import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import simpleGit from "simple-git"
import { WorktreeManager } from "../../src/agent-manager/WorktreeManager"

const tempDirs: string[] = []
// Pool home for the current test. Slots never live inside the test repository.
let home = ""

beforeEach(async () => {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "kilo-pool-home-")))
  tempDirs.push(dir)
  home = path.join(dir, "worktree-pool")
})

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

function createManager(root: string, poolSize = 1, rewarmDelay = 0, logs?: string[], dir = home): WorktreeManager {
  const manager = new WorktreeManager(
    root,
    logs ? (msg) => logs.push(msg) : () => undefined,
    undefined,
    undefined,
    poolSize,
    dir,
  )
  manager.rewarmDelay = rewarmDelay
  return manager
}

function metaFile(wt: string): string {
  const pointer = readFileSync(path.join(wt, ".git"), "utf-8")
  return path.join(path.resolve(wt, pointer.match(/^gitdir:\s*(.+)$/m)![1]!.trim()), "kilo-agent-manager-metadata.json")
}

/** A slot as older versions created it, inside `.kilo/worktrees/`. */
async function legacySlot(root: string): Promise<string> {
  const slot = path.join(root, ".kilo", "worktrees", "legacy-slot")
  gitExec(["git", "-C", root, "worktree", "add", "--detach", slot, "HEAD"])
  await fs.writeFile(metaFile(slot), JSON.stringify({ pooled: true, owner: 999999, baseRef: "main" }))
  return slot
}

async function clean(root: string): Promise<string> {
  return (await simpleGit(root).raw(["status", "--porcelain", "--untracked-files=all"])).trim()
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

async function waitForPooledSlots(root: string, count: number, timeout = 10000): Promise<string[]> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const slots: string[] = []
    for (const slot of await pooledSlots(root)) {
      if ((await slotMeta(slot))?.pooled === true) slots.push(slot)
    }
    if (slots.length >= count) return slots
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Timed out waiting for ${count} pooled slots`)
}

describe("WorktreeManager pool warm-up", () => {
  it("warms a slot in the pool home without creating anything in the project", async () => {
    const root = await createTempRepo()
    const manager = createManager(root)

    await manager.reconcilePool()
    manager.warmPool()
    const slot = await waitForPooledSlot(root)

    expect(await pooledSlots(root)).toEqual([slot])
    expect(slot.startsWith(home + path.sep)).toBe(true)
    expect(existsSync(path.join(root, ".kilo"))).toBe(false)
    expect(await clean(root)).toBe("")
    expect(await manager.discoverWorktrees()).toEqual([])
  })

  it("creates no slot and no .kilo/worktrees when the pool home is unusable", async () => {
    const root = await createTempRepo()
    await fs.writeFile(home, "not a directory")
    const logs: string[] = []
    const manager = createManager(root, 1, 0, logs)

    await manager.reconcilePool()
    manager.warmPool()
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(await pooledSlots(root)).toEqual([])
    expect(existsSync(path.join(root, ".kilo"))).toBe(false)
    expect(logs.some((line) => line.includes("not pre-warming worktrees"))).toBe(true)

    // Worktrees are still created on demand.
    const result = await manager.createWorktree({ branchName: "cold" })
    expect(result.path).toBe(path.join(root, ".kilo", "worktrees", "cold"))
  })
})

describe("WorktreeManager pool claim", () => {
  it("moves an exact-match slot into .kilo/worktrees for a generated name", async () => {
    const root = await createTempRepo()
    const manager = createManager(root)

    manager.warmPool()
    const slot = await waitForPooledSlot(root)

    const result = await manager.createWorktree({})

    expect(result.branch).toBe(path.basename(slot))
    expect(result.path).toBe(path.join(root, ".kilo", "worktrees", result.branch))
    expect(existsSync(slot)).toBe(false)
    expect((await simpleGit(result.path).raw(["symbolic-ref", "--short", "HEAD"])).trim()).toBe(result.branch)
    expect((await simpleGit(result.path).raw(["status", "--porcelain"])).trim()).toBe("")
    expect(await fs.stat(path.join(result.path, ".git")).then((stat) => stat.isFile())).toBe(true)
    expect((await slotMeta(result.path))?.pooled).toBeFalsy()
    expect(await clean(root)).toBe("")

    // A replacement slot is warmed in the pool home after the claim, off the click path.
    const next = await waitForPooledSlot(root)
    expect(next).not.toBe(slot)
    expect(next.startsWith(home + path.sep)).toBe(true)
  })

  it("delays the replacement warm-up so it does not compete with the new session", async () => {
    const root = await createTempRepo()
    const manager = createManager(root, 1, 1500)

    manager.warmPool()
    const slot = await waitForPooledSlot(root)
    const result = await manager.createWorktree({})
    expect(result.branch).toBe(path.basename(slot))

    await new Promise((resolve) => setTimeout(resolve, 500))
    expect((await pooledSlots(root)).filter((dir) => dir !== slot)).toEqual([])

    const next = await waitForPooledSlot(root, 10000)
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

describe("WorktreeManager pool stale slot", () => {
  it("evicts a slot whose directory was deleted and cold-creates instead", async () => {
    const root = await createTempRepo()
    const logs: string[] = []
    const manager = createManager(root, 1, 0, logs)

    manager.warmPool()
    const slot = await waitForPooledSlot(root)

    await fs.rm(slot, { recursive: true, force: true })
    expect(existsSync(slot)).toBe(false)

    const result = await manager.createWorktree({})
    expect(existsSync(result.path)).toBe(true)
    expect(result.path).not.toBe(slot)
    expect((await simpleGit(result.path).raw(["status", "--porcelain"])).trim()).toBe("")
    expect(logs.some((line) => line.includes("slot missing on disk, evicting"))).toBe(true)

    // The stale slot is evicted and the next create succeeds as well.
    const second = await manager.createWorktree({})
    expect(existsSync(second.path)).toBe(true)
  })

  it("reuses a healthy slot when another pooled slot was deleted", async () => {
    const root = await createTempRepo()
    const logs: string[] = []
    const manager = createManager(root, 2, 0, logs)

    manager.warmPool()
    const original = await waitForPooledSlots(root, 2)

    // The first claim consumes the pool's first slot and moves it away.
    // Identifying it pins the creation order, so the slot that stays in the
    // pool is deterministically the one claim() tries first after the
    // replacement warm.
    await manager.createWorktree({})
    const remaining = original.filter((slot) => existsSync(slot))
    expect(remaining).toHaveLength(1)
    const stale = remaining[0]!

    const refilled = await waitForPooledSlots(root, 2)
    const healthy = refilled.find((slot) => slot !== stale)
    expect(healthy).toBeDefined()

    await fs.rm(stale, { recursive: true, force: true })
    expect(existsSync(stale)).toBe(false)

    const result = await manager.createWorktree({})

    expect(result.branch).toBe(path.basename(healthy!))
    expect(existsSync(healthy!)).toBe(false)
    expect(existsSync(stale)).toBe(false)
    expect(logs.some((line) => line.includes("slot missing on disk, evicting"))).toBe(true)
  })
})

describe("WorktreeManager pool reconcile", () => {
  it("trusts the slot HEAD over stale metadata when adopting", async () => {
    const root = await createTempRepo()
    createManager(root).warmPool()
    const slot = await waitForPooledSlot(root)
    const head = (await simpleGit(slot).revparse(["HEAD"])).trim()

    // Simulate a crash between a retarget checkout and its metadata write.
    const pointer = await fs.readFile(path.join(slot, ".git"), "utf-8")
    const dir = path.resolve(slot, pointer.match(/^gitdir:\s*(.+)$/m)![1]!.trim())
    const file = path.join(dir, "kilo-agent-manager-metadata.json")
    const meta = JSON.parse(await fs.readFile(file, "utf-8")) as Record<string, unknown>
    await fs.writeFile(file, JSON.stringify({ ...meta, owner: 999999, baseOid: "0".repeat(40) }))

    const manager = createManager(root)
    await manager.reconcilePool()
    const result = await manager.createWorktree({})

    expect(result.branch).toBe(path.basename(slot))
    expect((await simpleGit(result.path).revparse(["HEAD"])).trim()).toBe(head)
    expect((await simpleGit(result.path).raw(["status", "--porcelain"])).trim()).toBe("")
  })
})

describe("WorktreeManager pool disabled", () => {
  it("keeps creation behavior unchanged when poolSize is 0", async () => {
    const root = await createTempRepo()
    const manager = createManager(root, 0)

    manager.warmPool()
    expect(await pooledSlots(root)).toEqual([])

    const result = await manager.createWorktree({ branchName: "plain" })

    expect(result.path).toBe(path.join(root, ".kilo", "worktrees", "plain"))
    expect((await simpleGit(result.path).raw(["symbolic-ref", "--short", "HEAD"])).trim()).toBe("plain")
  })

  it("does not create the worktrees directory when reconciling with poolSize 0", async () => {
    const root = await createTempRepo()
    const manager = createManager(root, 0)

    await manager.reconcilePool()

    expect(existsSync(path.join(root, ".kilo", "worktrees"))).toBe(false)
  })

  it("still removes leftover pooled slots when reconciling with poolSize 0", async () => {
    const root = await createTempRepo()
    createManager(root).warmPool()
    const slot = await waitForPooledSlot(root)

    await createManager(root, 0).reconcilePool()

    expect(existsSync(slot)).toBe(false)
    expect(await pooledSlots(root)).toEqual([])
  })
})

describe("WorktreeManager pool home", () => {
  it("discards a slot that cannot be moved and creates the worktree normally", async () => {
    const root = await createTempRepo()
    const logs: string[] = []
    const manager = createManager(root, 1, 60_000, logs)

    manager.warmPool()
    const slot = await waitForPooledSlot(root)
    const name = path.basename(slot)
    const blocked = path.join(root, ".kilo", "worktrees", name)
    await fs.mkdir(blocked, { recursive: true })

    const result = await manager.createWorktree({})

    expect(result.path).toBe(path.join(root, ".kilo", "worktrees", result.branch))
    expect(result.branch).not.toBe(name)
    expect(existsSync(slot)).toBe(false)
    expect(await pooledSlots(root)).toEqual([])
    expect(await simpleGit(root).raw(["branch", "--list", name])).toBe("")
    expect((await simpleGit(result.path).raw(["status", "--porcelain"])).trim()).toBe("")
    expect(logs.some((line) => line.includes("discarding"))).toBe(true)
  })

  it("removes slots an older version left in .kilo/worktrees", async () => {
    const root = await createTempRepo()
    const legacy = await legacySlot(root)

    const manager = createManager(root)
    await manager.reconcilePool()

    expect(existsSync(legacy)).toBe(false)
    expect(existsSync(path.join(root, ".kilo"))).toBe(false)
    expect(await pooledSlots(root)).toEqual([])

    manager.warmPool()
    expect((await waitForPooledSlot(root)).startsWith(home + path.sep)).toBe(true)
    expect(existsSync(path.join(root, ".kilo"))).toBe(false)
  })

  it("keeps a session worktree whose pooled metadata was never cleared", async () => {
    const root = await createTempRepo()
    const manager = createManager(root, 1, 60_000)
    manager.warmPool()
    await waitForPooledSlot(root)
    const result = await manager.createWorktree({})
    await fs.writeFile(path.join(result.path, "work.txt"), "uncommitted")
    // Simulate a claim that stopped before it cleared the slot metadata.
    await fs.writeFile(metaFile(result.path), JSON.stringify({ pooled: true, owner: 999999 }))

    await createManager(root).reconcilePool()
    await createManager(root, 0).reconcilePool()

    expect(await fs.readFile(path.join(result.path, "work.txt"), "utf-8")).toBe("uncommitted")
    expect((await simpleGit(result.path).raw(["symbolic-ref", "--short", "HEAD"])).trim()).toBe(result.branch)
  })

  it("removes pool home slots when the pool is disabled", async () => {
    const root = await createTempRepo()
    createManager(root).warmPool()
    const slot = await waitForPooledSlot(root)

    await createManager(root, 0).reconcilePool()

    expect(existsSync(slot)).toBe(false)
    expect(await pooledSlots(root)).toEqual([])
    expect(existsSync(path.join(root, ".kilo"))).toBe(false)
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
