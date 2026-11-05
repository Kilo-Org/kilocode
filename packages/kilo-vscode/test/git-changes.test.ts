import { expect, test } from "bun:test"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { gitChanges } from "../src/git-changes"
import type { GitChangesStats } from "../src/protocol"

function runSync(cwd: string, args: string[]): void {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  })
  if (result.exitCode !== 0) {
    throw new Error(Buffer.from(result.stderr).toString("utf8") || Buffer.from(result.stdout).toString("utf8"))
  }
}

/** A repository with one commit and one staged file of two lines, so the working tree stats are known. */
async function withRepo(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "git-changes-test-"))
  try {
    runSync(dir, ["init", "-b", "main"])
    runSync(dir, ["config", "user.email", "test@example.com"])
    runSync(dir, ["config", "user.name", "Test"])
    runSync(dir, ["config", "commit.gpgsign", "false"])
    await fs.writeFile(path.join(dir, "seed.txt"), "seed\n")
    runSync(dir, ["add", "seed.txt"])
    runSync(dir, ["commit", "-m", "seed"])
    await fs.writeFile(path.join(dir, "changed.txt"), "one\ntwo\n")
    runSync(dir, ["add", "changed.txt"])
    await run(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  }
}

test(
  "reads the working tree counts on request",
  async () => {
    await withRepo(async (dir) => {
      const stats = gitChanges({ directory: dir, onStats: () => {} })
      try {
        expect(await stats.read()).toEqual({ files: 1, additions: 2, deletions: 0 })
      } finally {
        stats.dispose()
      }
    })
  },
  10000,
)

test(
  "pushes the counts while the view is visible",
  async () => {
    await withRepo(async (dir) => {
      const pushed: Array<GitChangesStats | undefined> = []
      let publish: (value: GitChangesStats | undefined) => void = () => {}
      const first = new Promise<GitChangesStats | undefined>((resolve) => {
        publish = resolve
      })
      const stats = gitChanges({
        directory: dir,
        onStats: (value) => {
          pushed.push(value)
          publish(value)
        },
      })
      try {
        stats.setVisible(true)
        expect(await first).toEqual({ files: 1, additions: 2, deletions: 0 })
        expect(pushed).toHaveLength(1)
      } finally {
        stats.dispose()
      }
    })
  },
  10000,
)
