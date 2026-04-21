import { afterEach, describe, expect, it } from "bun:test"
import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import simpleGit from "simple-git"
import { ensureKiloGitExclude } from "../../src/agent-manager/git-exclude"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function createRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-exclude-"))
  tempDirs.push(dir)
  const git = simpleGit(dir)
  await git.init()
  await git.addConfig("user.email", "test@test.com")
  await git.addConfig("user.name", "Test")
  return dir
}

async function createNonRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-exclude-plain-"))
  tempDirs.push(dir)
  return dir
}

describe("ensureKiloGitExclude", () => {
  it("adds .kilo/agent-manager.json to .git/info/exclude", async () => {
    const root = await createRepo()
    await ensureKiloGitExclude(root)
    const content = await fs.readFile(path.join(root, ".git", "info", "exclude"), "utf-8")
    expect(content).toContain(".kilo/agent-manager.json")
  })

  it("adds all Kilo artifacts including legacy .kilocode entries", async () => {
    const root = await createRepo()
    await ensureKiloGitExclude(root)
    const content = await fs.readFile(path.join(root, ".git", "info", "exclude"), "utf-8")
    expect(content).toContain(".kilo/worktrees/")
    expect(content).toContain(".kilo/agent-manager.json")
    expect(content).toContain(".kilo/setup-script")
    expect(content).toContain(".kilocode/agent-manager.json")
    expect(content).toContain(".kilocode/worktrees/")
  })

  it("is idempotent — repeated calls do not duplicate entries", async () => {
    const root = await createRepo()
    await ensureKiloGitExclude(root)
    await ensureKiloGitExclude(root)
    await ensureKiloGitExclude(root)
    const content = await fs.readFile(path.join(root, ".git", "info", "exclude"), "utf-8")
    const count = content.split(".kilo/agent-manager.json").length - 1
    expect(count).toBe(1)
  })

  it("silently no-ops when path is not a git repository", async () => {
    const root = await createNonRepo()
    // Should not throw
    await ensureKiloGitExclude(root)
    // No .git directory should have been created
    const gitExists = await fs
      .stat(path.join(root, ".git"))
      .then(() => true)
      .catch(() => false)
    expect(gitExists).toBe(false)
  })

  it("creates .git/info/ directory when missing", async () => {
    const root = await createRepo()
    await fs.rm(path.join(root, ".git", "info"), { recursive: true, force: true })
    await ensureKiloGitExclude(root)
    const stat = await fs.stat(path.join(root, ".git", "info", "exclude"))
    expect(stat.isFile()).toBe(true)
  })

  it("preserves existing exclude content", async () => {
    const root = await createRepo()
    const excludePath = path.join(root, ".git", "info", "exclude")
    await fs.writeFile(excludePath, "existing-entry\n")
    await ensureKiloGitExclude(root)
    const content = await fs.readFile(excludePath, "utf-8")
    expect(content).toContain("existing-entry")
    expect(content).toContain(".kilo/agent-manager.json")
  })

  it("surfaces progress via the log callback", async () => {
    const root = await createRepo()
    const logs: string[] = []
    await ensureKiloGitExclude(root, (msg) => logs.push(msg))
    expect(logs.some((m) => m.includes(".kilo/agent-manager.json"))).toBe(true)
  })

  it("resolves the shared git dir when invoked from inside a linked worktree", async () => {
    const root = await createRepo()
    // Seed commit so we can create a worktree
    const git = simpleGit(root)
    await fs.writeFile(path.join(root, "README.md"), "x")
    await git.add(".")
    await git.commit("init")

    const wtDir = path.join(root, "wt")
    await git.raw(["worktree", "add", "-b", "feature", wtDir])

    // Running inside the worktree should still write to the main repo's exclude
    await ensureKiloGitExclude(wtDir)
    const mainExclude = await fs.readFile(path.join(root, ".git", "info", "exclude"), "utf-8")
    expect(mainExclude).toContain(".kilo/agent-manager.json")
  })
})
