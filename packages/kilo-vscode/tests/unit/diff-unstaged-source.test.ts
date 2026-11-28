import { describe, expect, it } from "bun:test"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { GitOps } from "../../src/agent-manager/GitOps"
import { createUnstagedDiffSource } from "../../src/diff/sources/unstaged"

function run(cwd: string, args: string[]) {
  const result = Bun.spawnSync({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}

describe("createUnstagedDiffSource", () => {
  it("lists and loads untracked files whose names git quotes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "unstaged-source-test-"))
    const git = new GitOps({ log: () => undefined })
    try {
      run(dir, ["init", "-b", "main"])
      // Default setting: git C-quotes non-ASCII names in text output.
      run(dir, ["config", "core.quotepath", "true"])
      await fs.writeFile(path.join(dir, "plain.txt"), "plain\n")
      await fs.writeFile(path.join(dir, "résumé.txt"), "one\ntwo\n")
      await fs.writeFile(path.join(dir, "trailing "), "x\n")

      const source = createUnstagedDiffSource({ dir: () => dir, git, log: () => undefined })
      const result = await source.fetch()
      expect(result.diffs.map((diff) => diff.file).sort()).toEqual(["plain.txt", "résumé.txt", "trailing "])

      const file = await source.fetchFile?.("résumé.txt")
      expect(file?.status).toBe("added")
      expect(file?.tracked).toBe(false)
      expect(file?.after).toBe("one\ntwo\n")
    } finally {
      git.dispose()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
