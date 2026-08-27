import { describe, expect, it } from "bun:test"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { GitOps, type ExecBufferResult } from "../../src/agent-manager/GitOps"
import { GitStatsSnapshot, refOID } from "../../src/agent-manager/git-stats-snapshot"
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
