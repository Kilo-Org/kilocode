import { describe, expect, it } from "bun:test"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { GitOps } from "../../src/agent-manager/GitOps"
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
    })
  })
})
