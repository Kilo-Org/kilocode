import { afterEach, describe, expect, it } from "bun:test"
import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import simpleGit from "simple-git"
import { WorktreeManager } from "../../src/agent-manager/WorktreeManager"
import { locate, sweep } from "../../src/agent-manager/worktree-pool"

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

function createManager(root: string, poolSize = 1, rewarmDelay = 0, logs?: string[], home?: string): WorktreeManager {
  const manager = new WorktreeManager(
    root,
    logs ? (msg) => logs.push(msg) : () => undefined,
    undefined,
    undefined,
    poolSize,
    home,
  )
  manager.rewarmDelay = rewarmDelay
  return manager
}

async function createHome(): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "kilo-pool-home-")))
  tempDirs.push(dir)
  return path.join(dir, "worktree-pool")
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

  it("delays the replacement warm-up so it does not compete with the new session", async () => {
    const root = await createTempRepo()
    const manager = createManager(root, 1, 1500)

    manager.warmPool()
    const slot = await waitForPooledSlot(root)
    const result = await manager.createWorktree({})
    expect(await fs.realpath(result.path)).toBe(await fs.realpath(slot))

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

    // The first claim consumes the pool's first slot. Identifying it pins the
    // creation order, so the slot that stays in the pool is deterministically
    // the one claim() tries first after the replacement warm.
    const first = await manager.createWorktree({})
    const firstReal = await fs.realpath(first.path)
    const remaining: string[] = []
    for (const slot of original) {
      if ((await fs.realpath(slot)) !== firstReal) remaining.push(slot)
    }
    expect(remaining).toHaveLength(1)
    const stale = remaining[0]!

    const refilled = await waitForPooledSlots(root, 2)
    const healthy = refilled.find((slot) => slot !== stale)
    expect(healthy).toBeDefined()

    await fs.rm(stale, { recursive: true, force: true })
    expect(existsSync(stale)).toBe(false)

    const result = await manager.createWorktree({})

    expect(await fs.realpath(result.path)).toBe(await fs.realpath(healthy!))
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

    expect(await fs.realpath(result.path)).toBe(await fs.realpath(slot))
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
  it("warms slots in the pool home without touching the project", async () => {
    const root = await createTempRepo()
    const home = await createHome()
    const manager = createManager(root, 1, 0, undefined, home)

    await manager.reconcilePool()
    manager.warmPool()
    const slot = await waitForPooledSlot(root)

    expect(slot.startsWith(home + path.sep)).toBe(true)
    expect(existsSync(path.join(root, ".kilo"))).toBe(false)
    expect(await clean(root)).toBe("")
    expect(await manager.discoverWorktrees()).toEqual([])
  })

  it("moves a claimed slot into .kilo/worktrees", async () => {
    const root = await createTempRepo()
    const home = await createHome()
    const manager = createManager(root, 1, 60_000, undefined, home)

    manager.warmPool()
    const slot = await waitForPooledSlot(root)
    const result = await manager.createWorktree({})

    expect(result.branch).toBe(path.basename(slot))
    expect(result.path).toBe(path.join(root, ".kilo", "worktrees", result.branch))
    expect(existsSync(slot)).toBe(false)
    expect((await simpleGit(result.path).raw(["symbolic-ref", "--short", "HEAD"])).trim()).toBe(result.branch)
    expect((await simpleGit(result.path).raw(["status", "--porcelain"])).trim()).toBe("")
    expect(await clean(root)).toBe("")
  })

  it("discards a slot that cannot be moved and creates the worktree normally", async () => {
    const root = await createTempRepo()
    const home = await createHome()
    const logs: string[] = []
    const manager = createManager(root, 1, 60_000, logs, home)

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
    const home = await createHome()
    createManager(root).warmPool()
    const legacy = await waitForPooledSlot(root)
    expect(legacy.includes(`${path.sep}.kilo${path.sep}worktrees${path.sep}`)).toBe(true)

    const manager = createManager(root, 1, 0, undefined, home)
    await manager.reconcilePool()

    expect(existsSync(legacy)).toBe(false)
    expect(existsSync(path.join(root, ".kilo"))).toBe(false)
    expect(await pooledSlots(root)).toEqual([])

    manager.warmPool()
    expect((await waitForPooledSlot(root)).startsWith(home + path.sep)).toBe(true)
  })

  it("removes pool home slots when the pool is disabled", async () => {
    const root = await createTempRepo()
    const home = await createHome()
    createManager(root, 1, 0, undefined, home).warmPool()
    const slot = await waitForPooledSlot(root)

    await createManager(root, 0, 0, undefined, home).reconcilePool()

    expect(existsSync(slot)).toBe(false)
    expect(await pooledSlots(root)).toEqual([])
    expect(existsSync(path.join(root, ".kilo"))).toBe(false)
  })

  it("sweeps slots of deleted repositories and unused slots", async () => {
    const home = await createHome()
    const gone = await createTempRepo()
    createManager(gone, 1, 0, undefined, home).warmPool()
    const orphan = await waitForPooledSlot(gone)
    await fs.rm(gone, { recursive: true, force: true })

    const root = await createTempRepo()
    createManager(root, 1, 0, undefined, home).warmPool()
    const unused = await waitForPooledSlot(root)
    const pointer = await fs.readFile(path.join(unused, ".git"), "utf-8")
    const file = path.join(pointer.match(/^gitdir:\s*(.+)$/m)![1]!.trim(), "kilo-agent-manager-metadata.json")
    const meta = JSON.parse(await fs.readFile(file, "utf-8")) as Record<string, unknown>
    await fs.writeFile(file, JSON.stringify({ ...meta, owner: 999999 }))

    await sweep(
      home,
      true,
      (cwd) => simpleGit(cwd),
      () => undefined,
    )
    expect(existsSync(orphan)).toBe(false)
    expect(existsSync(path.dirname(orphan))).toBe(false)
    // A recently used slot survives even when its owner is gone.
    expect(existsSync(unused)).toBe(true)

    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    await fs.utimes(file, old, old)
    await sweep(
      home,
      true,
      (cwd) => simpleGit(cwd),
      () => undefined,
    )
    expect(existsSync(unused)).toBe(false)
    expect(await pooledSlots(root)).toEqual([])
  })

  it.skipIf(process.platform === "win32")("keeps slots in .kilo/worktrees on another filesystem", async () => {
    const home = await createHome()
    const local = path.join("/dev", ".kilo", "worktrees")
    expect(await locate("/dev", path.join(home, "dev"), local, () => undefined)).toBe(local)
    expect(await locate(path.dirname(home), path.join(home, "repo"), "local", () => undefined)).toBe(
      path.join(home, "repo"),
    )
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
