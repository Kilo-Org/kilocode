import { describe, it, expect } from "bun:test"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import {
  createLocalDiff,
  diffSummary,
  diffFile,
  generatedLike,
  resolveBase,
  MAX_DETAIL_BYTES,
} from "../../src/agent-manager/local-diff"
import { GitOps } from "../../src/agent-manager/GitOps"
import { WorktreeDiffReverter } from "../../src/diff/shared/reverter"
import { resolveLocalDiffTarget } from "../../src/diff/shared/target"

function git(): GitOps {
  return new GitOps({ log: () => undefined })
}

function reverter(ops: GitOps): WorktreeDiffReverter {
  return new WorktreeDiffReverter(
    ops,
    async (target, file) => {
      const entry = await diffFile(ops, target.directory, target.baseBranch, file)
      return entry?.status
    },
    () => undefined,
  )
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
    expect(generatedLike("packages/opencode/node_modules/foo/index.js")).toBe(true)
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
  it("uses candidate local branch fallback when base is empty string and on a feature branch", async () => {
    await withRepo(async (dir) => {
      runSync(dir, ["checkout", "-b", "feature"])
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nfeature\n")
      runSync(dir, ["commit", "-am", "feature commit"])
      const result = await diffSummary(git(), dir, "")
      const entry = result.find((e) => e.file === "seed.txt")
      expect(entry?.status).toBe("modified")
      // Pin the export contract: resolveBase("HEAD") must resolve to a real
      // candidate branch when one exists locally. If this regresses, the
      // revert-file fix below also silently regresses.
      expect(await resolveBase(git(), dir, "HEAD")).toBe("main")
    })
  })

  it("uses HEAD as fallback when no candidate branches exist and base is empty", async () => {
    await withRepo(async (dir) => {
      // Rename main to something else so it doesn't match candidates
      runSync(dir, ["branch", "-m", "main", "other"])
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nuncommitted\n")
      const result = await diffSummary(git(), dir, "")
      const entry = result.find((e) => e.file === "seed.txt")
      expect(entry?.status).toBe("modified")
    })
  })

  it("returns empty array when ancestor cannot be resolved", async () => {
    await withRepo(async (dir) => {
      const result = await diffSummary(git(), dir, "nonexistent-branch")
      expect(result).toEqual([])
    })
  })

  it("does not silently fall back to a candidate when an explicit base is stale", async () => {
    await withRepo(async (dir) => {
      // main exists locally, but caller provided a misspelled explicit base.
      // We must NOT diff against main — merge-base should fail loudly.
      runSync(dir, ["checkout", "-b", "feature"])
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nfeature\n")
      runSync(dir, ["commit", "-am", "feature commit"])
      const result = await diffSummary(git(), dir, "typo-main")
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

  it("classifies untracked files from content rather than their extension", async () => {
    await withRepo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "tone.wav"), Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x01, 0x02, 0x03]))
      await fs.writeFile(path.join(dir, "notes.bin"), "plain text\n")

      const result = await diffSummary(git(), dir, base)
      expect(result.find((entry) => entry.file === "tone.wav")?.additions).toBe(0)
      expect(result.find((entry) => entry.file === "notes.bin")?.additions).toBe(1)

      const detail = await diffFile(git(), dir, base, "tone.wav")
      expect(detail?.summarized).toBe(false)
      expect(detail?.patch).toBe("")
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

  it("uses git numstat metadata for tracked binary files", async () => {
    await withRepo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "tone.wav"), Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x01, 0x02, 0x03]))
      runSync(dir, ["add", "tone.wav"])
      runSync(dir, ["commit", "-m", "add audio"])

      const summary = await diffSummary(git(), dir, base)
      expect(summary.find((entry) => entry.file === "tone.wav")?.additions).toBe(0)

      const detail = await diffFile(git(), dir, base, "tone.wav")
      expect(detail?.summarized).toBe(false)
      expect(detail?.patch).toBe("")
    })
  })

  it("loads binary-safe before and after data for image diffs", async () => {
    await withRepo(async (dir, base) => {
      const before = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])
      const after = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])
      await fs.writeFile(path.join(dir, "banner.png"), before)
      runSync(dir, ["add", "banner.png"])
      runSync(dir, ["commit", "-m", "add banner"])
      runSync(dir, ["branch", "-f", base])
      await fs.writeFile(path.join(dir, "banner.png"), after)

      const local = createLocalDiff(git())
      const summary = (await local.summary(dir, base)).find((entry) => entry.file === "banner.png")
      const detail = await local.file(dir, base, "banner.png")

      expect(summary?.kind).toBe("image")
      expect(summary?.summarized).toBe(true)
      expect(detail?.summarized).toBe(false)
      expect(detail?.image?.before?.data).toBe(before.toString("base64"))
      expect(detail?.image?.after?.data).toBe(after.toString("base64"))
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

  it("rejects image detail paths outside the repository", async () => {
    await withRepo(async (dir, base) => {
      const name = `${path.basename(dir)}-secret.png`
      const secret = path.join(path.dirname(dir), name)
      await fs.writeFile(secret, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]))
      try {
        expect(await diffFile(git(), dir, base, `../${name}`)).toBeNull()
        expect(await diffFile(git(), dir, base, secret)).toBeNull()
      } finally {
        await fs.rm(secret, { force: true })
      }
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

  it("loads full detail from the latest summary snapshot", async () => {
    await withRepo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\ncached\n")
      const local = createLocalDiff(git())
      const summary = await local.summary(dir, base)
      const entry = summary.find((item) => item.file === "seed.txt")
      const result = await local.file(dir, base, "seed.txt")

      expect(entry?.summarized).toBe(true)
      expect(result?.summarized).toBe(false)
      expect(result?.additions).toBe(entry?.additions)
      expect(result?.deletions).toBe(entry?.deletions)
      expect(result?.stamp).toBe(entry?.stamp)
      expect(result?.before).toBe("seed\n")
      expect(result?.after).toBe("seed\ncached\n")
      expect(result?.patch).toContain("+cached")
    })
  })

  it("batches tracked and untracked details while preserving complete file contents", async () => {
    await withRepo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "second file.txt"), "old\n")
      runSync(dir, ["add", "second file.txt"])
      runSync(dir, ["commit", "-m", "add second file"])
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nfirst\n")
      await fs.writeFile(path.join(dir, "second file.txt"), "old\nsecond\n")
      await fs.writeFile(path.join(dir, "new.txt"), "new\n")
      const local = createLocalDiff(git())
      await local.summary(dir, base)
      const result = await local.files(dir, base, ["seed.txt", "second file.txt", "new.txt"])

      expect(result.entries.get("seed.txt")?.before).toBe("seed\n")
      expect(result.entries.get("seed.txt")?.after).toBe("seed\nfirst\n")
      expect(result.entries.get("seed.txt")?.patch).toContain("+first")
      expect(result.entries.get("second file.txt")?.before).toBe("")
      expect(result.entries.get("second file.txt")?.after).toBe("old\nsecond\n")
      expect(result.entries.get("second file.txt")?.patch).toContain("+second")
      expect(result.entries.get("new.txt")?.before).toBe("")
      expect(result.entries.get("new.txt")?.patch).toContain("+new")
      for (const item of ["seed.txt", "second file.txt", "new.txt"]) {
        expect(result.entries.get(item)).toEqual(await diffFile(git(), dir, base, item))
      }
      expect(await local.file(dir, base, "seed.txt")).toBe(result.entries.get("seed.txt"))
    })
  })

  it("maps combined patches and base blobs for modified paths with spaces", async () => {
    await withRepo(async (dir, base) => {
      const name = "nested folder/second file.ts"
      await fs.mkdir(path.join(dir, "nested folder"))
      await fs.writeFile(path.join(dir, name), "before\n")
      runSync(dir, ["add", name])
      runSync(dir, ["commit", "-m", "add nested source"])
      runSync(dir, ["branch", "-f", base])
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nupdated\n")
      await fs.writeFile(path.join(dir, name), "before\nafter\n")
      const local = createLocalDiff(git())
      await local.summary(dir, base)
      const result = await local.files(dir, base, ["seed.txt", name])

      expect(result.entries.get(name)?.before).toBe("before\n")
      expect(result.entries.get(name)?.after).toBe("before\nafter\n")
      expect(result.entries.get(name)?.patch).toContain(`diff --git a/${name} b/${name}`)
      expect(result.entries.get("seed.txt")?.patch).not.toContain(name)
    })
  })

  it("preserves separate hunks and content that resembles a Git file header", async () => {
    await withRepo(async (dir, base) => {
      const rows = Array.from({ length: 40 }, (_, index) => `line-${index}`)
      await fs.writeFile(path.join(dir, "seed.txt"), `${rows.join("\n")}\n`)
      runSync(dir, ["add", "seed.txt"])
      runSync(dir, ["commit", "-m", "add long source file"])
      runSync(dir, ["branch", "-f", base])
      rows[2] = "diff --git a/fake.ts b/fake.ts"
      rows[35] = "updated final hunk"
      await fs.writeFile(path.join(dir, "seed.txt"), `${rows.join("\n")}\n`)
      const local = createLocalDiff(git())
      await local.summary(dir, base)
      const result = (await local.files(dir, base, ["seed.txt"])).entries.get("seed.txt")

      expect(result).toEqual(await diffFile(git(), dir, base, "seed.txt"))
      expect(result?.patch.match(/^@@ /gm)).toHaveLength(2)
      expect(result?.patch).toContain("+diff --git a/fake.ts b/fake.ts")
    })
  })

  it("keeps deleted files, images, and non-image binaries on their existing detail paths", async () => {
    await withRepo(async (dir, base) => {
      const before = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])
      const after = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])
      await fs.writeFile(path.join(dir, "remove.txt"), "remove\n")
      await fs.writeFile(path.join(dir, "banner.png"), before)
      runSync(dir, ["add", "remove.txt", "banner.png"])
      runSync(dir, ["commit", "-m", "add mixed files"])
      runSync(dir, ["branch", "-f", base])
      await fs.unlink(path.join(dir, "remove.txt"))
      await fs.writeFile(path.join(dir, "banner.png"), after)
      await fs.writeFile(path.join(dir, "tone.wav"), Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00]))
      const local = createLocalDiff(git())
      await local.summary(dir, base)
      const result = await local.files(dir, base, ["remove.txt", "banner.png", "tone.wav", "missing.txt"])

      expect(result.entries.get("remove.txt")?.before).toBe("remove\n")
      expect(result.entries.get("remove.txt")?.after).toBe("")
      expect(result.entries.get("remove.txt")?.patch).toContain("deleted file mode")
      expect(result.entries.get("banner.png")?.image?.before?.data).toBe(before.toString("base64"))
      expect(result.entries.get("banner.png")?.image?.after?.data).toBe(after.toString("base64"))
      expect(result.entries.get("tone.wav")?.patch).toBe("")
      expect(result.entries.get("missing.txt")).toBeNull()
    })
  })

  it("does not materialize an oversized file in a bulk detail request", async () => {
    await withRepo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "large.txt"), "a".repeat(MAX_DETAIL_BYTES + 1))
      const local = createLocalDiff(git())
      await local.summary(dir, base)
      const result = await local.files(dir, base, ["large.txt"])
      expect(result.entries.get("large.txt")?.summarized).toBe(true)
      expect(result.entries.get("large.txt")?.before).toBe("")
      expect(result.entries.get("large.txt")?.after).toBe("")
      expect(result.entries.get("large.txt")?.patch).toBe("")
    })
  })

  it("defers files that exceed the bounded aggregate batch budget", async () => {
    await withRepo(async (dir, base) => {
      const size = 17_000_000
      await fs.writeFile(path.join(dir, "first.txt"), "a".repeat(size))
      await fs.writeFile(path.join(dir, "second.txt"), "b".repeat(size))
      const local = createLocalDiff(git())
      await local.summary(dir, base)
      const result = await local.files(dir, base, ["first.txt", "second.txt"])

      expect(result.entries.get("first.txt")?.after.length).toBe(size)
      expect(result.entries.has("second.txt")).toBe(false)
      expect(result.deferred.has("second.txt")).toBe(true)
      expect((await local.file(dir, base, "second.txt"))?.after.length).toBe(size)
    })
  })

  it("shares pending bulk detail with a concurrent single-file request", async () => {
    await withRepo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nshared\n")
      const local = createLocalDiff(git())
      await local.summary(dir, base)
      const batch = local.files(dir, base, ["seed.txt"])
      const single = local.file(dir, base, "seed.txt")
      const [many, one] = await Promise.all([batch, single])
      expect(many.entries.get("seed.txt")).toBe(one)
    })
  })

  it("does not share cancellation ownership across unrelated detail requests", async () => {
    await withRepo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nindependent\n")
      const local = createLocalDiff(git())
      await local.summary(dir, base)
      const first = new AbortController()
      const second = new AbortController()
      const batch = local.files(dir, base, ["seed.txt"], first.signal)
      const single = local.file(dir, base, "seed.txt", second.signal)
      first.abort()

      await expect(batch).rejects.toThrow()
      expect((await single)?.after).toBe("seed\nindependent\n")
    })
  })

  it("invalidates cached bulk detail after the working-copy stamp changes", async () => {
    await withRepo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nfirst\n")
      const local = createLocalDiff(git())
      await local.summary(dir, base)
      const first = await local.files(dir, base, ["seed.txt"])
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nsecond value\n")
      await local.summary(dir, base)
      const second = await local.files(dir, base, ["seed.txt"])
      expect(second.entries.get("seed.txt")).not.toBe(first.entries.get("seed.txt"))
      expect(second.entries.get("seed.txt")?.after).toBe("seed\nsecond value\n")
    })
  })

  it("keeps in-flight bulk detail when an unchanged summary refreshes", async () => {
    await withRepo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nunchanged\n")
      const ops = git()
      const local = createLocalDiff(ops)
      await local.summary(dir, base)
      let release!: () => void
      let started!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const ready = new Promise<void>((resolve) => {
        started = resolve
      })
      const original = ops.execGit.bind(ops)
      ops.execGit = async (...args: Parameters<GitOps["execGit"]>) => {
        if (args[0][0] === "cat-file" && args[0][1] === "--batch-check") {
          started()
          await gate
        }
        return original(...args)
      }
      const pending = local.files(dir, base, ["seed.txt"])
      await ready
      await local.summary(dir, base)
      release()
      const result = await pending

      expect(result.entries.get("seed.txt")?.after).toBe("seed\nunchanged\n")
      expect(result.deferred.size).toBe(0)
    })
  })

  it("defers every requested file when bulk Git inspection fails", async () => {
    await withRepo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nfallback\n")
      const ops = git()
      const local = createLocalDiff(ops)
      await local.summary(dir, base)
      const original = ops.execGit.bind(ops)
      ops.execGit = async (...args: Parameters<GitOps["execGit"]>) => {
        if (args[0][0] === "cat-file" && args[0][1] === "--batch-check") {
          return { code: 1, stdout: "", stderr: "batch inspection failed" }
        }
        return original(...args)
      }
      const result = await local.files(dir, base, ["seed.txt"])

      expect(result.entries.has("seed.txt")).toBe(false)
      expect(result.deferred.has("seed.txt")).toBe(true)
      expect((await local.file(dir, base, "seed.txt"))?.after).toBe("seed\nfallback\n")
    })
  })

  it("discards bulk detail when a newer summary replaces its snapshot", async () => {
    await withRepo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nfirst\n")
      const ops = git()
      const local = createLocalDiff(ops)
      await local.summary(dir, base)
      let release!: () => void
      let started!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const ready = new Promise<void>((resolve) => {
        started = resolve
      })
      const original = ops.execGit.bind(ops)
      ops.execGit = async (...args: Parameters<GitOps["execGit"]>) => {
        if (args[0][0] === "cat-file" && args[0][1] === "--batch-check") {
          started()
          await gate
        }
        return original(...args)
      }
      const pending = local.files(dir, base, ["seed.txt"])
      await ready
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nnewer summary\n")
      await local.summary(dir, base)
      release()
      const stale = await pending

      expect(stale.entries.has("seed.txt")).toBe(false)
      expect(stale.deferred.has("seed.txt")).toBe(true)
      expect((await local.file(dir, base, "seed.txt"))?.after).toBe("seed\nnewer summary\n")
    })
  })

  it("cancels fallback detail requests before a summary snapshot exists", async () => {
    await withRepo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nuncached\n")
      const local = createLocalDiff(git())
      const ctl = new AbortController()
      const pending = local.files(dir, base, ["seed.txt"], ctl.signal)
      ctl.abort()
      await expect(pending).rejects.toThrow()
    })
  })

  it("does not cache a batch that is aborted before Git completes", async () => {
    await withRepo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nbatched\n")
      const local = createLocalDiff(git())
      await local.summary(dir, base)
      const ctl = new AbortController()
      const pending = local.files(dir, base, ["seed.txt"], ctl.signal)
      ctl.abort()
      await expect(pending).rejects.toThrow()
      expect((await local.file(dir, base, "seed.txt"))?.after).toBe("seed\nbatched\n")
    })
  })

  it("reuses cached detail while the summary stamp is unchanged", async () => {
    await withRepo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\ncached\n")
      const local = createLocalDiff(git())
      await local.summary(dir, base)

      const first = await local.file(dir, base, "seed.txt")
      const second = await local.file(dir, base, "seed.txt")

      expect(second).toBe(first)
    })
  })

  it("does not cache detail that is aborted before Git completes", async () => {
    await withRepo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\ncached\n")
      const local = createLocalDiff(git())
      await local.summary(dir, base)

      const ctl = new AbortController()
      const pending = local.file(dir, base, "seed.txt", ctl.signal)
      ctl.abort()
      await expect(pending).rejects.toThrow()

      const result = await local.file(dir, base, "seed.txt")
      expect(result?.after).toBe("seed\ncached\n")
    })
  })

  it("invalidates cached detail after the summary stamp changes", async () => {
    await withRepo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nfirst\n")
      const local = createLocalDiff(git())
      await local.summary(dir, base)
      const first = await local.file(dir, base, "seed.txt")

      await new Promise((resolve) => setTimeout(resolve, 5))
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nsecond value\n")
      await local.summary(dir, base)
      const second = await local.file(dir, base, "seed.txt")

      expect(second).not.toBe(first)
      expect(second?.after).toBe("seed\nsecond value\n")
    })
  })

  it("does not materialize binary detail from a cached summary", async () => {
    await withRepo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "tone.wav"), Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x01, 0x02, 0x03]))
      const local = createLocalDiff(git())

      await local.summary(dir, base)
      const result = await local.file(dir, base, "tone.wav")

      expect(result?.summarized).toBe(false)
      expect(result?.patch).toBe("")
      expect(result?.before).toBe("")
      expect(result?.after).toBe("")
    })
  })

  it("keeps summary snapshots isolated by worktree", async () => {
    await withRepo(async (first, firstBase) => {
      await withRepo(async (second, secondBase) => {
        await fs.writeFile(path.join(first, "seed.txt"), "seed\nfirst\n")
        await fs.writeFile(path.join(second, "seed.txt"), "seed\nsecond\n")
        const local = createLocalDiff(git())

        await local.summary(first, firstBase)
        await local.summary(second, secondBase)

        expect((await local.file(first, firstBase, "seed.txt"))?.after).toBe("seed\nfirst\n")
        expect((await local.file(second, secondBase, "seed.txt"))?.after).toBe("seed\nsecond\n")
      })
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

describe("resolveLocalDiffTarget + revertFile", () => {
  it("uses the remote's current trunk when local origin/HEAD is stale", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "local-diff-stale-head-"))
    const remote = path.join(root, "remote.git")
    const dir = path.join(root, "clone")
    try {
      runSync(root, ["init", "--bare", "-b", "master", remote])
      runSync(root, ["clone", remote, dir])
      runSync(dir, ["config", "user.email", "test@example.com"])
      runSync(dir, ["config", "user.name", "Test"])
      await fs.writeFile(path.join(dir, "seed.txt"), "master\n")
      runSync(dir, ["add", "seed.txt"])
      runSync(dir, ["commit", "-m", "master seed"])
      runSync(dir, ["push", "-u", "origin", "master"])
      runSync(dir, ["checkout", "-b", "main"])
      await fs.writeFile(path.join(dir, "seed.txt"), "main\n")
      runSync(dir, ["commit", "-am", "move trunk to main"])
      runSync(dir, ["push", "-u", "origin", "main"])
      runSync(remote, ["symbolic-ref", "HEAD", "refs/heads/main"])
      runSync(dir, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/master"])
      runSync(dir, ["checkout", "-b", "feature"])
      await fs.writeFile(path.join(dir, "feature.txt"), "one line\n")

      const target = await resolveLocalDiffTarget(git(), () => undefined, dir)

      expect(target?.baseBranch).toBe("origin/main")
      expect(runSync(dir, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).toBe("origin/master")
      const entries = await diffSummary(git(), dir, target!.baseBranch)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ file: "feature.txt", additions: 1, deletions: 0 })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("resolves a real candidate branch so revertFile actually restores the file when there is no remote", async () => {
    await withRepo(async (dir) => {
      // No remote; `main` exists locally with the seed commit.
      runSync(dir, ["checkout", "-b", "feature"])
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nfeature\n")
      runSync(dir, ["commit", "-am", "feature commit"])

      const target = await resolveLocalDiffTarget(git(), () => undefined, dir)
      expect(target).toBeDefined()
      // Before the fix this was "HEAD", which made revertFile a no-op.
      expect(target?.baseBranch).toBe("main")

      const revert = await git().revertFile(dir, target!.baseBranch, "seed.txt", "modified")
      expect(revert.ok).toBe(true)

      const restored = await fs.readFile(path.join(dir, "seed.txt"), "utf-8")
      expect(restored).toBe("seed\n")
    })
  })

  it("uses local diff status for reverting modified tracked files", async () => {
    await withRepo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nchanged\n")

      const ops = git()
      const result = await reverter(ops).revertFile({ directory: dir, baseBranch: base }, "seed.txt")

      expect(result.ok).toBe(true)
      expect(await fs.readFile(path.join(dir, "seed.txt"), "utf-8")).toBe("seed\n")
      ops.dispose()
    })
  })

  it("uses local diff status for reverting staged modified files", async () => {
    await withRepo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nstaged\n")
      runSync(dir, ["add", "seed.txt"])

      const ops = git()
      const result = await reverter(ops).revertFile({ directory: dir, baseBranch: base }, "seed.txt")

      expect(result.ok).toBe(true)
      expect(await fs.readFile(path.join(dir, "seed.txt"), "utf-8")).toBe("seed\n")
      expect(runSync(dir, ["status", "--short", "--", "seed.txt"])).toBe("")
      ops.dispose()
    })
  })

  it("uses local diff status for reverting deleted tracked files", async () => {
    await withRepo(async (dir, base) => {
      const file = path.join(dir, "seed.txt")
      await fs.rm(file)

      const ops = git()
      const result = await reverter(ops).revertFile({ directory: dir, baseBranch: base }, "seed.txt")

      expect(result.ok).toBe(true)
      expect(await fs.readFile(file, "utf-8")).toBe("seed\n")
      ops.dispose()
    })
  })

  it("uses local diff status for reverting staged deleted files", async () => {
    await withRepo(async (dir, base) => {
      const file = path.join(dir, "seed.txt")
      await fs.rm(file)
      runSync(dir, ["add", "-A"])

      const ops = git()
      const result = await reverter(ops).revertFile({ directory: dir, baseBranch: base }, "seed.txt")

      expect(result.ok).toBe(true)
      expect(await fs.readFile(file, "utf-8")).toBe("seed\n")
      expect(runSync(dir, ["status", "--short", "--", "seed.txt"])).toBe("")
      ops.dispose()
    })
  })

  it("uses local diff status for reverting tracked files added after base", async () => {
    await withRepo(async (dir, base) => {
      const file = path.join(dir, "tracked.txt")
      await fs.writeFile(file, "tracked\n")
      runSync(dir, ["add", "tracked.txt"])
      runSync(dir, ["commit", "-m", "add tracked"])

      const ops = git()
      const result = await reverter(ops).revertFile({ directory: dir, baseBranch: base }, "tracked.txt")

      expect(result.ok).toBe(true)
      await expect(fs.stat(file)).rejects.toThrow()
      ops.dispose()
    })
  })

  it("uses local diff status for reverting staged added files", async () => {
    await withRepo(async (dir, base) => {
      const file = path.join(dir, "staged.txt")
      await fs.writeFile(file, "staged\n")
      runSync(dir, ["add", "staged.txt"])

      const ops = git()
      const result = await reverter(ops).revertFile({ directory: dir, baseBranch: base }, "staged.txt")

      expect(result.ok).toBe(true)
      await expect(fs.stat(file)).rejects.toThrow()
      expect(runSync(dir, ["status", "--short", "--", "staged.txt"])).toBe("")
      ops.dispose()
    })
  })

  it("uses local diff status for reverting untracked files", async () => {
    await withRepo(async (dir, base) => {
      const file = path.join(dir, "fresh.txt")
      await fs.writeFile(file, "fresh\n")

      const ops = git()
      const result = await reverter(ops).revertFile({ directory: dir, baseBranch: base }, "fresh.txt")

      expect(result.ok).toBe(true)
      await expect(fs.stat(file)).rejects.toThrow()
      ops.dispose()
    })
  })

  it("falls back to modified-file revert when local status lookup fails", async () => {
    await withRepo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nchanged\n")
      const ops = git()
      const diff = new WorktreeDiffReverter(
        ops,
        async () => {
          throw new Error("status failed")
        },
        () => undefined,
      )

      const result = await diff.revertFile({ directory: dir, baseBranch: base }, "seed.txt")

      expect(result.ok).toBe(true)
      expect(await fs.readFile(path.join(dir, "seed.txt"), "utf-8")).toBe("seed\n")
      ops.dispose()
    })
  })
})
