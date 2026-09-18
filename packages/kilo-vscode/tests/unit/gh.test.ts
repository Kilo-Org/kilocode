import { afterEach, describe, expect, it } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { execGhRead } from "../../src/agent-manager/gh"
import { PRStatusPoller } from "../../src/agent-manager/PRStatusPoller"
import { Semaphore } from "../../src/agent-manager/semaphore"
import type { Worktree } from "../../src/agent-manager/WorktreeStateManager"

const host = process.platform
const platform = Object.getOwnPropertyDescriptor(process, "platform")

function setPlatform(value: string): void {
  Object.defineProperty(process, "platform", { value, configurable: true })
}

function link(src: string, dest: string): void {
  try {
    fs.linkSync(src, dest)
  } catch {
    fs.copyFileSync(src, dest)
  }
  if (host !== "win32") fs.chmodSync(dest, 0o755)
}

function fakeBin(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-process-"))
  const name = host === "win32" ? "gh.exe" : "gh"
  try {
    link(process.execPath, path.join(dir, name))
    return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw error
  }
}

function env(dir: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") result[key] = value
  }
  const key = Object.keys(result).find((key) => key.toLowerCase() === "path") ?? "PATH"
  result[key] = dir
  result.PATHEXT = ".COM;.EXE;.BAT;.CMD"
  return result
}

function unset(env: Record<string, string>, name: string): void {
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === name.toLowerCase()) delete env[key]
  }
}

async function fixture(run: (dir: string) => Promise<void>): Promise<void> {
  setPlatform("linux")
  const bin = fakeBin()
  const previous = process.env.PATH
  process.env.PATH = bin.dir
  try {
    await run(bin.dir)
  } finally {
    if (previous === undefined) delete process.env.PATH
    if (previous !== undefined) process.env.PATH = previous
    bin.cleanup()
  }
}

function poller(dir: string, errors: string[], semaphore?: Semaphore): PRStatusPoller {
  const tree: Worktree = {
    id: "wt1",
    branch: "feature",
    path: dir,
    parentBranch: "main",
    createdAt: "2026-01-01T00:00:00.000Z",
  }
  return new PRStatusPoller({
    getWorktrees: () => [tree],
    getWorkspaceRoot: () => path.dirname(dir),
    onStatus: (_id, _pr, error) => {
      if (error) errors.push(error)
    },
    log: () => {},
    semaphore,
  })
}

afterEach(() => {
  if (platform) Object.defineProperty(process, "platform", platform)
})

describe("execGhRead", () => {
  it("uses UTC when TZ is unset on Windows", async () => {
    setPlatform("win32")
    const bin = fakeBin()
    try {
      const child = env(bin.dir)
      unset(child, "TZ")
      const { stdout } = await execGhRead(["-e", "console.log(process.env.TZ)"], { env: child })
      expect(stdout.trim()).toBe("UTC")
    } finally {
      bin.cleanup()
    }
  })

  it("preserves an existing TZ on Windows", async () => {
    setPlatform("win32")
    const bin = fakeBin()
    try {
      const child = env(bin.dir)
      child.TZ = "Europe/London"
      const { stdout } = await execGhRead(["-e", "console.log(process.env.TZ)"], { env: child })
      expect(stdout.trim()).toBe("Europe/London")
    } finally {
      bin.cleanup()
    }
  })

  it("does not add TZ on non-Windows platforms", async () => {
    setPlatform("linux")
    const bin = fakeBin()
    try {
      const child = env(bin.dir)
      unset(child, "TZ")
      const { stdout } = await execGhRead(["-e", "console.log(process.env.TZ)"], { env: child })
      expect(stdout.trim()).toBe("undefined")
    } finally {
      bin.cleanup()
    }
  })
})

describe("PRStatusPoller", () => {
  it("skips a deleted worktree when gh is installed", async () => {
    await fixture(async (dir) => {
      const errors: string[] = []
      const instance = poller(path.join(dir, "deleted"), errors)
      const internal = instance as unknown as { fetchAll(): Promise<void> }
      await internal.fetchAll()
      expect(errors).toEqual([])
    })
  })

  it("reports a genuinely missing GitHub CLI", async () => {
    await fixture(async (dir) => {
      const root = path.join(dir, "worktree")
      fs.mkdirSync(root)
      fs.rmSync(path.join(dir, host === "win32" ? "gh.exe" : "gh"))
      const errors: string[] = []
      const instance = poller(root, errors)
      const internal = instance as unknown as { fetchAll(): Promise<void> }
      await internal.fetchAll()
      expect(errors).toEqual(["gh_missing"])
    })
  })

  it("does not report gh missing when a worktree disappears before launch", async () => {
    await fixture(async (dir) => {
      const root = path.join(dir, "worktree")
      fs.mkdirSync(root)
      const errors: string[] = []
      const gate = Promise.withResolvers<void>()
      const semaphore = new Semaphore(1)
      const held = semaphore.run(() => gate.promise)
      const instance = poller(root, errors, semaphore)
      const internal = instance as unknown as { fetchOne(id: string): Promise<void> }
      const pending = internal.fetchOne("wt1").then(
        () => undefined,
        (error: Error) => error,
      )
      fs.rmSync(root, { recursive: true, force: true })
      gate.resolve()
      const [, error] = await Promise.all([held, pending])
      expect(error?.message).toContain("ENOENT")
      expect(errors).toEqual(["fetch_failed"])
    })
  })

  it("ignores a stale worktree failure after its project poller stops", async () => {
    await fixture(async (dir) => {
      const root = path.join(dir, "worktree")
      fs.mkdirSync(root)
      const errors: string[] = []
      const gate = Promise.withResolvers<void>()
      const semaphore = new Semaphore(1)
      const held = semaphore.run(() => gate.promise)
      const instance = poller(root, errors, semaphore)
      const internal = instance as unknown as { fetchOne(id: string): Promise<void> }
      const pending = internal.fetchOne("wt1")
      instance.stop()
      fs.rmSync(root, { recursive: true, force: true })
      gate.resolve()
      await Promise.all([held, pending])
      expect(errors).toEqual([])
    })
  })
})
