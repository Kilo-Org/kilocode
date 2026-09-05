import { describe, expect, it, spyOn } from "bun:test"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { GitOps, type ExecBufferResult } from "../../src/agent-manager/GitOps"
import { GitStatsSnapshot, lines, refOID } from "../../src/agent-manager/git-stats-snapshot"
import { diffSummary } from "../../src/agent-manager/local-diff"

function run(dir: string, args: string[]): string {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  })
  if (result.exitCode !== 0) throw new Error(Buffer.from(result.stderr).toString("utf8"))
  return Buffer.from(result.stdout).toString("utf8").trim()
}

async function repo(test: (dir: string, base: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "git-stats-snapshot-"))
  try {
    run(dir, ["init", "-b", "main"])
    run(dir, ["config", "commit.gpgsign", "false"])
    await fs.writeFile(path.join(dir, "tracked.txt"), "one\ntwo\n")
    run(dir, ["add", "."])
    run(dir, ["commit", "-m", "base"])
    run(dir, ["branch", "base"])
    await test(dir, "base")
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

describe("GitStatsSnapshot", () => {
  it("accepts an absent path in an unmerged status record", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "git-stats-conflict-"))
    try {
      const raw = Buffer.from(
        "# branch.oid abc\0# branch.head main\0u UU N... 100644 100644 100644 100644 abc abc abc missing.txt\0",
      )
      const git = new GitOps({ log: () => undefined })
      git.execGitBuffer = async (): Promise<ExecBufferResult> => ({ code: 0, stdout: raw, stderr: "" })
      const status = await new GitStatsSnapshot(git).status(dir)
      expect(status.dirty).toBe(true)
      expect(status.fingerprint).toBeTruthy()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it("matches legacy aggregate stats with tracked and untracked changes", async () => {
    await repo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "tracked.txt"), "one\nchanged\nthree\n")
      await fs.writeFile(path.join(dir, "new.txt"), "a\nb\nc\n")
      const git = new GitOps({ log: () => undefined })
      const snapshots = new GitStatsSnapshot(git)

      const status = await snapshots.status(dir)
      const actual = await snapshots.diff(dir, base, status.untracked)
      const legacy = await diffSummary(git, dir, base)

      expect(actual).toEqual({
        files: legacy.length,
        additions: legacy.reduce((sum, item) => sum + item.additions, 0),
        deletions: legacy.reduce((sum, item) => sum + item.deletions, 0),
      })
      expect(status.untracked).toEqual(["new.txt"])
    })
  })

  it("changes its fingerprint when an already-modified file changes", async () => {
    await repo(async (dir) => {
      const snapshots = new GitStatsSnapshot(new GitOps({ log: () => undefined }))
      await fs.writeFile(path.join(dir, "tracked.txt"), "modified once\n")
      const first = await snapshots.status(dir)
      await fs.writeFile(path.join(dir, "tracked.txt"), "modified twice and larger\n")
      const second = await snapshots.status(dir)
      expect(second.fingerprint).not.toBe(first.fingerprint)
    })
  })

  it("reuses unchanged untracked counts when another file changes", async () => {
    await repo(async (dir, base) => {
      const git = new GitOps({ log: () => undefined })
      const snapshots = new GitStatsSnapshot(git)
      const files = ["stable.txt", "changing.txt"]
      await Promise.all(files.map((file) => fs.writeFile(path.join(dir, file), "one\ntwo\n")))
      const read = spyOn(fs, "readFile")
      try {
        expect(await snapshots.diff(dir, base, files)).toEqual({ files: 2, additions: 4, deletions: 0 })
        expect(read).toHaveBeenCalledTimes(2)
        read.mockClear()

        await fs.writeFile(path.join(dir, "tracked.txt"), "one\nchanged\n")
        expect(await snapshots.diff(dir, base, files)).toEqual({ files: 3, additions: 5, deletions: 1 })
        expect(await git.workingTreeStats(dir)).toEqual({ files: 3, additions: 5, deletions: 1 })
        expect(read).not.toHaveBeenCalled()

        await fs.writeFile(path.join(dir, "changing.txt"), "12345678")
        expect((await snapshots.diff(dir, base, files)).additions).toBe(4)
        expect(read).toHaveBeenCalledTimes(1)
        read.mockClear()
        await fs.writeFile(path.join(dir, "changing.txt"), "one\ntwo\nthree\n")
        expect(await snapshots.diff(dir, base, files)).toEqual({ files: 3, additions: 6, deletions: 1 })
        expect(read).toHaveBeenCalledTimes(1)
        expect(read.mock.calls.at(0)?.at(0)).toBe(path.join(dir, "changing.txt"))

        await fs.unlink(path.join(dir, "changing.txt"))
        expect(await snapshots.diff(dir, base, ["stable.txt"])).toEqual({ files: 2, additions: 3, deletions: 1 })
        await fs.writeFile(path.join(dir, "changing.txt"), "replacement\n")
        expect(await snapshots.diff(dir, base, files)).toEqual({ files: 3, additions: 4, deletions: 1 })
      } finally {
        read.mockRestore()
      }
    })
  })

  it("does not cache failed untracked reads", async () => {
    await repo(async (dir, base) => {
      const snapshots = new GitStatsSnapshot(new GitOps({ log: () => undefined }))
      await fs.writeFile(path.join(dir, "new.txt"), "one\ntwo\n")
      const read = spyOn(fs, "readFile").mockRejectedValueOnce(new Error("temporary read failure"))
      try {
        expect((await snapshots.diff(dir, base, ["new.txt"])).additions).toBe(0)
        expect((await snapshots.diff(dir, base, ["new.txt"])).additions).toBe(2)
        expect(read).toHaveBeenCalledTimes(2)
      } finally {
        read.mockRestore()
      }
    })
  })

  it("does not cache metadata when a file changes during its read", async () => {
    await repo(async (dir, base) => {
      const snapshots = new GitStatsSnapshot(new GitOps({ log: () => undefined }))
      const file = path.join(dir, "changing.txt")
      await fs.writeFile(file, "one\ntwo\n")
      const read = fs.readFile
      const probe = spyOn(fs, "readFile").mockImplementationOnce(async (...args) => {
        const value = await read(...args)
        await fs.writeFile(file, "replacement\n")
        return value
      })
      try {
        expect((await snapshots.diff(dir, base, ["changing.txt"])).additions).toBe(2)
        expect((await snapshots.diff(dir, base, ["changing.txt"])).additions).toBe(1)
        expect(probe).toHaveBeenCalledTimes(2)
        expect((await snapshots.diff(dir, base, ["changing.txt"])).additions).toBe(1)
        expect(probe).toHaveBeenCalledTimes(2)
        await fs.unlink(file)
        expect(await lines(file)).toBe(0)
      } finally {
        probe.mockRestore()
      }
    })
  })

  it("skips extra metadata reads for empty and oversized files", async () => {
    await repo(async (dir, base) => {
      const snapshots = new GitStatsSnapshot(new GitOps({ log: () => undefined }))
      const files = ["empty.txt", "large.txt"]
      await fs.writeFile(path.join(dir, "empty.txt"), "")
      await fs.writeFile(path.join(dir, "large.txt"), Buffer.alloc(1_000_001, 0x61))
      const stat = spyOn(fs, "lstat")
      try {
        expect(await snapshots.diff(dir, base, files)).toEqual({ files: 2, additions: 0, deletions: 0 })
        expect(stat).toHaveBeenCalledTimes(2)
        await fs.writeFile(path.join(dir, "empty.txt"), "one\n")
        await fs.writeFile(path.join(dir, "large.txt"), "two\nthree\n")
        expect(await snapshots.diff(dir, base, files)).toEqual({ files: 2, additions: 3, deletions: 0 })
      } finally {
        stat.mockRestore()
      }
    })
  })

  it("bounds concurrent untracked file probes", async () => {
    await repo(async (dir, base) => {
      const snapshots = new GitStatsSnapshot(new GitOps({ log: () => undefined }))
      const files = Array.from({ length: 64 }, (_, i) => `${i}.txt`)
      await Promise.all(files.map((file) => fs.writeFile(path.join(dir, file), "one\ntwo\n")))
      const open = fs.open
      let active = 0
      let peak = 0
      const probe = spyOn(fs, "open").mockImplementation(async (...args) => {
        const handle = await open(...args)
        peak = Math.max(peak, ++active)
        const close = handle.close.bind(handle)
        handle.close = async () => {
          try {
            return await close()
          } finally {
            active--
          }
        }
        return handle
      })
      try {
        expect(await snapshots.diff(dir, base, files)).toEqual({ files: 64, additions: 128, deletions: 0 })
        expect(peak).toBeGreaterThan(1)
        expect(peak).toBeLessThanOrEqual(16)
        expect(active).toBe(0)
      } finally {
        probe.mockRestore()
      }
    })
  })

  it("resists scans over cache capacity and admits files from a new root", async () => {
    const paths: string[] = []
    const files = Array.from({ length: 11_000 }, (_, index) => `${index}.txt`)
    const read = spyOn(fs, "readFile")
    const scan = async (dir: string, base: string) => {
      const snapshots = new GitStatsSnapshot(new GitOps({ log: () => undefined }))
      paths.push(...files.map((file) => path.join(dir, file)))
      for (let index = 0; index < files.length; index += 64) {
        await Promise.all(
          files.slice(index, index + 64).map((file) => fs.writeFile(path.join(dir, file), "one\ntwo\n")),
        )
      }
      const counts: number[] = []
      for (let pass = 0; pass < 3; pass++) {
        read.mockClear()
        expect(await snapshots.diff(dir, base, files)).toEqual({
          files: files.length,
          additions: files.length * 2,
          deletions: 0,
        })
        counts.push(read.mock.calls.length)
      }
      return counts
    }
    try {
      await repo(async (dir, base) => {
        const counts = await scan(dir, base)
        expect(counts.at(0)).toBe(files.length)
        for (const count of counts.slice(1)) {
          expect(count).toBeGreaterThanOrEqual(files.length - 10_000)
          expect(count).toBeLessThan(files.length / 2)
        }
      })
      await repo(async (dir, base) => {
        const counts = await scan(dir, base)
        expect(counts.at(0)).toBe(files.length)
        expect(counts.at(1)!).toBeLessThan(counts.at(0)!)
        expect(counts.at(2)!).toBeLessThan(counts.at(1)!)
      })
    } finally {
      read.mockRestore()
      for (let index = 0; index < paths.length; index += 64) {
        await Promise.all(paths.slice(index, index + 64).map((file) => lines(file)))
      }
    }
  }, 60_000)

  it("reads ref OIDs and upstreams", async () => {
    await repo(async (dir) => {
      run(dir, ["remote", "add", "origin", "."])
      run(dir, ["update-ref", "refs/remotes/origin/main", "HEAD"])
      run(dir, ["branch", "--set-upstream-to=origin/main", "main"])
      const snapshots = new GitStatsSnapshot(new GitOps({ log: () => undefined }))
      const refs = await snapshots.refs(dir)
      expect(refOID(refs, "origin/main")).toBe(run(dir, ["rev-parse", "HEAD"]))
      expect(refs.upstreams.get("refs/heads/main")).toBe("refs/remotes/origin/main")
      expect(refs.worktreePaths?.get(await fs.realpath(dir))).toBe("main")
    })
  })

  it("keeps linked worktree maps isolated for repositories with the same branch names", async () => {
    const roots = await Promise.all([
      fs.mkdtemp(path.join(os.tmpdir(), "git-stats-snapshot-one-")),
      fs.mkdtemp(path.join(os.tmpdir(), "git-stats-snapshot-two-")),
    ])
    const worktrees = roots.map((root) => path.join(root, "linked"))
    try {
      for (const [index, root] of roots.entries()) {
        run(root, ["init", "-b", "main"])
        run(root, ["config", "commit.gpgsign", "false"])
        await fs.writeFile(path.join(root, "tracked.txt"), `${index}\n`)
        run(root, ["add", "."])
        run(root, ["commit", "-m", "base"])
        run(root, ["worktree", "add", "-b", "feature", worktrees[index]!, "main"])
      }

      const snapshots = roots.map(() => new GitStatsSnapshot(new GitOps({ log: () => undefined })))
      const refs = await Promise.all(roots.map((root, index) => snapshots[index]!.refs(root)))
      const paths = await Promise.all(worktrees.map((worktree) => fs.realpath(worktree)))

      expect(refs[0]!.worktreePaths?.get(paths[0]!)).toBe("feature")
      expect(refs[0]!.worktreePaths?.has(paths[1]!)).toBe(false)
      expect(refs[1]!.worktreePaths?.get(paths[1]!)).toBe("feature")
      expect(refs[1]!.worktreePaths?.has(paths[0]!)).toBe(false)
    } finally {
      await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })))
    }
  })

  it("parses a linked worktree path containing a newline", async () => {
    await repo(async (dir) => {
      const worktree = path.join(dir, "linked\nworktree")
      run(dir, ["worktree", "add", "-b", "feature", worktree, "main"])
      const refs = await new GitStatsSnapshot(new GitOps({ log: () => undefined })).refs(dir)
      expect(refs.worktreePaths?.get(await fs.realpath(worktree))).toBe("feature")
    })
  })

  it("falls back to the plain ref query when worktreepath is unsupported", async () => {
    const calls: string[][] = []
    const git = new GitOps({ log: () => undefined })
    git.execGitBuffer = async (args): Promise<ExecBufferResult> => {
      calls.push(args)
      if (args[1]?.includes("%(worktreepath)")) {
        return { code: 1, stdout: Buffer.alloc(0), stderr: "unknown field name: worktreepath" }
      }
      return { code: 0, stdout: Buffer.from("refs/heads/main\0abc\0\0\0"), stderr: "" }
    }

    const refs = await new GitStatsSnapshot(git).refs("/repo")
    expect(refs.oids.get("refs/heads/main")).toBe("abc")
    expect(refs.worktreePaths).toBeUndefined()
    expect(calls).toHaveLength(2)
    expect(calls[0]![1]).toContain("%(worktreepath)")
    expect(calls[1]![1]).not.toContain("%(worktreepath)")
  })
})
