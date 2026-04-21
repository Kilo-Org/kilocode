import { describe, it, expect } from "bun:test"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { diffSummary, diffFile, generatedLike, MAX_DETAIL_BYTES } from "../../src/agent-manager/local-diff"
import { GitOps } from "../../src/agent-manager/GitOps"

function git(): GitOps {
  return new GitOps({ log: () => undefined })
}

function runSync(cwd: string, args: string[]): string {
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
  return Buffer.from(result.stdout).toString("utf8").trim()
}

async function withRepo(run: (dir: string, base: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "local-diff-test-"))
  try {
    runSync(dir, ["init", "-b", "main"])
    runSync(dir, ["config", "user.email", "test@example.com"])
    runSync(dir, ["config", "user.name", "Test"])
    runSync(dir, ["config", "commit.gpgsign", "false"])
    // Seed commit so `merge-base HEAD main` resolves.
    await fs.writeFile(path.join(dir, "seed.txt"), "seed\n")
    runSync(dir, ["add", "seed.txt"])
    runSync(dir, ["commit", "-m", "seed"])
    runSync(dir, ["branch", "base-branch"])
    await run(dir, "base-branch")
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

describe("generatedLike", () => {
  it("matches files in ignored folders", () => {
    expect(generatedLike("node_modules/foo.js")).toBe(true)
    expect(generatedLike("packages/app/node_modules/foo/index.js")).toBe(true)
    expect(generatedLike("dist/bundle.js")).toBe(true)
    expect(generatedLike("build/out.js")).toBe(true)
    expect(generatedLike(".git/HEAD")).toBe(true)
    expect(generatedLike("__pycache__/mod.cpython-39.pyc")).toBe(true)
  })

  it("matches files by suffix", () => {
    expect(generatedLike("src/app.log")).toBe(true)
    expect(generatedLike("something.swp")).toBe(true)
    expect(generatedLike("something.swo")).toBe(true)
    expect(generatedLike("src/module.pyc")).toBe(true)
  })

  it("matches known basenames", () => {
    expect(generatedLike("src/.DS_Store")).toBe(true)
    expect(generatedLike("Thumbs.db")).toBe(true)
  })

  it("matches contained directory segments", () => {
    expect(generatedLike("src/logs/app.txt")).toBe(true)
    expect(generatedLike("tmp/foo")).toBe(true)
    expect(generatedLike("a/temp/b")).toBe(true)
    expect(generatedLike("coverage/report.html")).toBe(true)
    expect(generatedLike(".nyc_output/out.json")).toBe(true)
  })

  it("rejects normal source files", () => {
    expect(generatedLike("src/index.ts")).toBe(false)
    expect(generatedLike("README.md")).toBe(false)
    expect(generatedLike("packages/kilo-vscode/src/extension.ts")).toBe(false)
  })

  it("handles Windows-style separators", () => {
    expect(generatedLike("node_modules\\foo\\bar.js")).toBe(true)
    expect(generatedLike("src\\index.ts")).toBe(false)
  })
})

describe("diffSummary", () => {
  it("returns empty array when ancestor cannot be resolved", async () => {
    await withRepo(async (dir) => {
      const result = await diffSummary(git(), dir, "nonexistent-branch")
      expect(result).toEqual([])
    })
  })

  it("reports modified, added, and deleted tracked files", async () => {
    await withRepo(async (dir, base) => {
      // seed.txt is tracked on base. Modify it; add new.txt; delete seed.txt on HEAD.
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nextra line\n")
      await fs.writeFile(path.join(dir, "new.txt"), "hello\nworld\n")
      runSync(dir, ["add", "."])
      runSync(dir, ["commit", "-m", "modify+add"])
      await fs.rm(path.join(dir, "seed.txt"))
      runSync(dir, ["add", "-A"])
      runSync(dir, ["commit", "-m", "delete seed"])

      const result = await diffSummary(git(), dir, base)
      const byFile = new Map(result.map((entry) => [entry.file, entry]))

      expect(byFile.get("new.txt")?.status).toBe("added")
      expect(byFile.get("new.txt")?.additions).toBe(2)
      expect(byFile.get("new.txt")?.tracked).toBe(true)
      expect(byFile.get("seed.txt")?.status).toBe("deleted")
    })
  })

  it("includes untracked files as added with tracked=false", async () => {
    await withRepo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "untracked.txt"), "a\nb\nc\n")
      const result = await diffSummary(git(), dir, base)
      const entry = result.find((e) => e.file === "untracked.txt")
      expect(entry).toBeTruthy()
      expect(entry?.status).toBe("added")
      expect(entry?.tracked).toBe(false)
      expect(entry?.additions).toBe(3)
    })
  })

  it("all entries are summarized with empty before/after/patch", async () => {
    await withRepo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "untracked.txt"), "x\n")
      await fs.writeFile(path.join(dir, "seed.txt"), "changed\n")
      runSync(dir, ["add", "seed.txt"])
      runSync(dir, ["commit", "-m", "change seed"])
      const result = await diffSummary(git(), dir, base)
      expect(result.length).toBeGreaterThan(0)
      for (const entry of result) {
        expect(entry.summarized).toBe(true)
        expect(entry.before).toBe("")
        expect(entry.after).toBe("")
        expect(entry.patch).toBe("")
        expect(typeof entry.stamp).toBe("string")
      }
    })
  })

  it("marks generated-like files via generatedLike flag", async () => {
    await withRepo(async (dir, base) => {
      await fs.mkdir(path.join(dir, "dist"), { recursive: true })
      await fs.writeFile(path.join(dir, "dist/app.js"), "console.log(1)\n")
      await fs.writeFile(path.join(dir, "src.ts"), "export {}\n")
      const result = await diffSummary(git(), dir, base)
      const dist = result.find((e) => e.file === "dist/app.js")
      const src = result.find((e) => e.file === "src.ts")
      expect(dist?.generatedLike).toBe(true)
      expect(src?.generatedLike).toBe(false)
    })
  })
})

describe("diffFile", () => {
  it("returns null when ancestor cannot be resolved", async () => {
    await withRepo(async (dir) => {
      const result = await diffFile(git(), dir, "nonexistent-branch", "any.txt")
      expect(result).toBeNull()
    })
  })

  it("returns null for a missing file that isn't tracked either", async () => {
    await withRepo(async (dir, base) => {
      const result = await diffFile(git(), dir, base, "does-not-exist.txt")
      expect(result).toBeNull()
    })
  })

  it("returns before/after/patch for a modified tracked file", async () => {
    await withRepo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nmore\n")
      runSync(dir, ["add", "seed.txt"])
      runSync(dir, ["commit", "-m", "modify seed"])
      const result = await diffFile(git(), dir, base, "seed.txt")
      expect(result).toBeTruthy()
      expect(result?.status).toBe("modified")
      expect(result?.tracked).toBe(true)
      expect(result?.before).toBe("seed\n")
      expect(result?.after).toBe("seed\nmore\n")
      expect(result?.patch.length).toBeGreaterThan(0)
      expect(result?.summarized).toBe(false)
    })
  })

  it("returns synthetic patch for an untracked added file", async () => {
    await withRepo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "fresh.txt"), "one\ntwo\n")
      const result = await diffFile(git(), dir, base, "fresh.txt")
      expect(result).toBeTruthy()
      expect(result?.status).toBe("added")
      expect(result?.tracked).toBe(false)
      expect(result?.before).toBe("")
      expect(result?.after).toBe("one\ntwo\n")
      expect(result?.patch).toContain("new file mode")
      expect(result?.patch).toContain("+one")
      expect(result?.patch).toContain("+two")
    })
  })

  it("falls back to summarized entry when the working-copy file exceeds the detail cap", async () => {
    await withRepo(async (dir, base) => {
      // Write a tracked file that's ~2.5x the cap on the working-copy side.
      const big = "a".repeat(MAX_DETAIL_BYTES + 500_000) + "\n"
      await fs.writeFile(path.join(dir, "seed.txt"), big)
      runSync(dir, ["add", "seed.txt"])
      runSync(dir, ["commit", "-m", "grow seed"])

      const result = await diffFile(git(), dir, base, "seed.txt")
      expect(result).toBeTruthy()
      // Metadata (status, counts, stamp) is preserved so the UI can still
      // show the file and its add/delete totals.
      expect(result?.status).toBe("modified")
      expect(result?.tracked).toBe(true)
      expect(result?.additions).toBeGreaterThan(0)
      // Content is intentionally blank — the cap prevents materialization.
      expect(result?.before).toBe("")
      expect(result?.after).toBe("")
      expect(result?.patch).toBe("")
      expect(result?.summarized).toBe(true)
    })
  })

  it("falls back to summarized entry when the ancestor blob exceeds the detail cap", async () => {
    await withRepo(async (dir, base) => {
      // Put the large content in the base commit, then delete the file on HEAD.
      // `before` is read from the base blob (over cap); `after` is empty.
      const big = "b".repeat(MAX_DETAIL_BYTES + 500_000) + "\n"
      await fs.writeFile(path.join(dir, "big.txt"), big)
      runSync(dir, ["add", "big.txt"])
      runSync(dir, ["commit", "-m", "add big"])
      // Re-create the base-branch pointer so it includes the big blob.
      runSync(dir, ["branch", "-f", base])
      // Shrink on HEAD.
      await fs.writeFile(path.join(dir, "big.txt"), "small\n")
      runSync(dir, ["add", "big.txt"])
      runSync(dir, ["commit", "-m", "shrink"])

      const result = await diffFile(git(), dir, base, "big.txt")
      expect(result).toBeTruthy()
      expect(result?.tracked).toBe(true)
      expect(result?.before).toBe("")
      expect(result?.after).toBe("")
      expect(result?.patch).toBe("")
      expect(result?.summarized).toBe(true)
    })
  })

  it("still returns full detail when both sides are under the cap", async () => {
    await withRepo(async (dir, base) => {
      // Modest file, well under cap — behaves as before.
      const content = "a".repeat(50_000) + "\n"
      await fs.writeFile(path.join(dir, "seed.txt"), content)
      runSync(dir, ["add", "seed.txt"])
      runSync(dir, ["commit", "-m", "modest change"])

      const result = await diffFile(git(), dir, base, "seed.txt")
      expect(result?.summarized).toBe(false)
      expect((result?.after ?? "").length).toBeGreaterThan(0)
      expect((result?.patch ?? "").length).toBeGreaterThan(0)
    })
  })
})
