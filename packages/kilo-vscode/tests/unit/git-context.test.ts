import { describe, expect, it } from "bun:test"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { getGitChangesContext } from "../../src/services/git/context"

function git(cwd: string, args: string[]) {
  const result = Bun.spawnSync({ cmd: ["git", ...args], cwd, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode === 0) return Buffer.from(result.stdout).toString("utf8")
  throw new Error(Buffer.from(result.stderr).toString("utf8") || Buffer.from(result.stdout).toString("utf8"))
}

async function repo(run: (dir: string) => Promise<void>, commit = true) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-git-context-"))
  try {
    git(dir, ["init"])
    if (commit)
      git(dir, ["-c", "user.name=Kilo", "-c", "user.email=kilo@example.com", "commit", "--allow-empty", "-m", "init"])
    await run(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

describe("getGitChangesContext", () => {
  it("reports non-git directories", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-no-git-"))
    try {
      const result = await getGitChangesContext(dir)
      expect(result.content).toContain("Not a git repository.")
      expect(result.truncated).toBe(false)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it("reports clean repositories", async () => {
    await repo(async (dir) => {
      const result = await getGitChangesContext(dir)
      expect(result.content).toContain("No changes in working directory.")
      expect(result.truncated).toBe(false)
    })
  })

  it("includes tracked diffs", async () => {
    await repo(async (dir) => {
      await fs.writeFile(path.join(dir, "tracked.txt"), "before\n")
      git(dir, ["add", "tracked.txt"])
      git(dir, ["-c", "user.name=Kilo", "-c", "user.email=kilo@example.com", "commit", "-m", "tracked"])
      await fs.writeFile(path.join(dir, "tracked.txt"), "after\n")

      const result = await getGitChangesContext(dir)
      expect(result.content).toContain("M tracked.txt")
      expect(result.content).toContain("diff --git a/tracked.txt b/tracked.txt")
      expect(result.content).toContain("+after")
    })
  })

  it("includes base diffs with patches", async () => {
    await repo(async (dir) => {
      await fs.writeFile(path.join(dir, "base.txt"), "before\n")
      git(dir, ["add", "base.txt"])
      git(dir, ["-c", "user.name=Kilo", "-c", "user.email=kilo@example.com", "commit", "-m", "base"])
      await fs.writeFile(path.join(dir, "base.txt"), "after\n")
      git(dir, ["add", "base.txt"])
      git(dir, ["-c", "user.name=Kilo", "-c", "user.email=kilo@example.com", "commit", "-m", "change"])
      await fs.writeFile(path.join(dir, "new.txt"), "new\n")

      const result = await getGitChangesContext(dir, "HEAD~1")
      expect(result.content).toContain("Base: HEAD~1")
      expect(result.content).toContain("M\tbase.txt")
      expect(result.content).toContain("A\tnew.txt")
      expect(result.content).toContain("diff --git a/base.txt b/base.txt")
      expect(result.content).toContain("+after")
      expect(result.content).toContain("diff --git a/new.txt b/new.txt")
      expect(result.content).toContain("+new")
    })
  })

  it("includes untracked file contents as patches", async () => {
    await repo(async (dir) => {
      await fs.mkdir(path.join(dir, "src"))
      await fs.writeFile(path.join(dir, "src", "new.txt"), "hello\nworld\n")

      const result = await getGitChangesContext(dir)
      expect(result.content).toContain("?? src/")
      expect(result.content).toContain("diff --git a/src/new.txt b/src/new.txt")
      expect(result.content).toContain("--- /dev/null")
      expect(result.content).toContain("+++ b/src/new.txt")
      expect(result.content).toContain("+hello")
      expect(result.content).toContain("+world")
    })
  })

  it("handles repositories without an initial commit", async () => {
    await repo(async (dir) => {
      await fs.writeFile(path.join(dir, "new.txt"), "hello\n")
      git(dir, ["add", "new.txt"])

      const result = await getGitChangesContext(dir)
      expect(result.content).not.toContain("Unable to read git diff")
      expect(result.content).toContain("A  new.txt")
      expect(result.content).toContain("diff --git a/new.txt b/new.txt")
      expect(result.content).toContain("+hello")
    }, false)
  })

  it("omits binary untracked file contents", async () => {
    await repo(async (dir) => {
      const bytes = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0xff, 0xfe])
      await fs.writeFile(path.join(dir, "blob.bin"), bytes)

      const result = await getGitChangesContext(dir)
      expect(result.content).toContain("diff --git a/blob.bin b/blob.bin")
      expect(result.content).toContain("<binary file omitted: blob.bin>")
      expect(result.content).not.toContain("+\u0001")
    })
  })

  it("omits the hunk header for empty untracked files", async () => {
    await repo(async (dir) => {
      await fs.writeFile(path.join(dir, "empty.txt"), "")

      const result = await getGitChangesContext(dir)
      expect(result.content).toContain("diff --git a/empty.txt b/empty.txt")
      expect(result.content).toContain("new file mode 100644")
      expect(result.content).not.toMatch(/empty\.txt[\s\S]*@@ -0,0/)
    })
  })
})
