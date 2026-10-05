import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import simpleGit from "simple-git"
import { sweep } from "../../src/agent-manager/pool/sweep"

const dirs: string[] = []
let home = ""
let repo = ""
const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

function git(args: string[]) {
  const res = Bun.spawnSync(["git", ...args], { stdout: "ignore", stderr: "pipe" })
  if (res.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr.toString()}`)
}

async function temp(prefix: string): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)))
  dirs.push(dir)
  return dir
}

async function createRepo(): Promise<string> {
  const dir = await temp("kilo-sweep-repo-")
  git(["init", "-q", "-b", "main", dir])
  git([
    "-C",
    dir,
    "-c",
    "user.email=t@example.invalid",
    "-c",
    "user.name=t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init",
  ])
  return dir
}

function metaFile(slot: string): string {
  const pointer = readFileSync(path.join(slot, ".git"), "utf-8")
  return path.join(
    path.resolve(slot, pointer.match(/^gitdir:\s*(.+)$/m)![1]!.trim()),
    "kilo-agent-manager-metadata.json",
  )
}

/** Create a slot in the pool home the way the pool does, optionally with pooled metadata. */
async function createSlot(name: string, meta?: Record<string, unknown>, root = repo): Promise<string> {
  const slot = path.join(home, `${path.basename(root)}-0123456789ab`, name)
  git(["-C", root, "worktree", "add", "-q", "--detach", slot, "HEAD"])
  if (meta) await fs.writeFile(metaFile(slot), JSON.stringify(meta))
  return slot
}

async function age(file: string): Promise<void> {
  await fs.utimes(file, old, old)
}

async function registered(root: string): Promise<number> {
  const raw = await simpleGit(root).raw(["worktree", "list", "--porcelain"])
  return raw.split("\n").filter((line) => line.startsWith("worktree ")).length - 1
}

function run(enabled = true): Promise<void> {
  return sweep(
    home,
    enabled,
    (cwd) => simpleGit(cwd),
    () => undefined,
  )
}

beforeEach(async () => {
  home = path.join(await temp("kilo-sweep-home-"), "worktree-pool")
  repo = await createRepo()
})

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("worktree pool sweep", () => {
  it("removes slots of a deleted repository and their empty project directory", async () => {
    const gone = await createRepo()
    const slot = await createSlot("orphan", { pooled: true, owner: process.pid }, gone)
    await fs.rm(gone, { recursive: true, force: true })

    await run()

    expect(existsSync(slot)).toBe(false)
    expect(existsSync(path.dirname(slot))).toBe(false)
  })

  it("keeps old slots while their owner process is alive, also when the pool is disabled", async () => {
    const slot = await createSlot("live", { pooled: true, owner: process.pid })
    await age(metaFile(slot))

    await run(true)
    await run(false)

    expect(existsSync(slot)).toBe(true)
    expect(await registered(repo)).toBe(1)
  })

  it("keeps a recent slot of a dead owner until it is stale or the pool is disabled", async () => {
    const slot = await createSlot("recent", { pooled: true, owner: 999999 })

    await run(true)
    expect(existsSync(slot)).toBe(true)

    await run(false)
    expect(existsSync(slot)).toBe(false)
    expect(await registered(repo)).toBe(0)
  })

  it("removes and unregisters a stale slot of a dead owner", async () => {
    const slot = await createSlot("stale", { pooled: true, owner: 999999 })
    await age(metaFile(slot))

    await run()

    expect(existsSync(slot)).toBe(false)
    expect(await registered(repo)).toBe(0)
  })

  it("gives a slot without metadata an hour to finish its creation", async () => {
    const slot = await createSlot("creating")

    await run(false)
    expect(existsSync(slot)).toBe(true)

    await age(slot)
    await run(false)
    expect(existsSync(slot)).toBe(false)
    expect(await registered(repo)).toBe(0)
  })

  it("removes an old directory without a .git file and keeps a recent one", async () => {
    const project = path.join(home, "partial-0123456789ab")
    const recent = path.join(project, "recent")
    const stale = path.join(project, "stale")
    await fs.mkdir(recent, { recursive: true })
    await fs.mkdir(stale, { recursive: true })
    await age(stale)

    await run()

    expect(existsSync(recent)).toBe(true)
    expect(existsSync(stale)).toBe(false)
  })

  it("does nothing when the pool home is missing or not a directory", async () => {
    await run()
    await fs.mkdir(path.dirname(home), { recursive: true })
    await fs.writeFile(home, "file")
    await run()
    expect(await fs.readFile(home, "utf-8")).toBe("file")
  })
})
