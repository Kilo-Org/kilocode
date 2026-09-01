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
import { GitOps, type ExecBufferResult, type ExecResult } from "../../src/agent-manager/GitOps"
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

function turn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function inspect(args: string[]): boolean {
  return args[0] === "cat-file" && args[1] === "--batch-check"
}

function blobs(args: string[]): boolean {
  return args[0] === "cat-file" && args[1] === "--batch"
}

function diff(args: string[]): boolean {
  return args.includes("diff") && args.includes("--no-ext-diff")
}

function size(args: string[]): boolean {
  return args[0] === "cat-file" && args[1] === "-s"
}

function show(args: string[]): boolean {
  return args[0] === "show"
}

function count(ops: RecordingGitOps, test: (args: string[]) => boolean): number {
  return ops.calls.filter((call) => test(call.args)).length
}

class RecordingGitOps extends GitOps {
  readonly calls: Array<{ kind: "text" | "buffer"; args: string[]; cwd: string }> = []
  fail = false
  private wait: Promise<void> | undefined
  private begin: (() => void) | undefined
  private test: ((args: string[]) => boolean) | undefined
  private held = false

  constructor() {
    super({ log: () => undefined })
  }

  block(test: (args: string[]) => boolean, wait: Promise<void>, begin: () => void): void {
    this.test = test
    this.wait = wait
    this.begin = begin
    this.held = true
  }

  private async pause(args: string[]): Promise<void> {
    const test = this.test
    const wait = this.wait
    if (!this.held || !test || !wait || !test(args)) return
    this.held = false
    this.begin?.()
    await wait
  }

  override async execGit(args: string[], cwd: string, options?: Parameters<GitOps["execGit"]>[2]): Promise<ExecResult> {
    this.calls.push({ kind: "text", args, cwd })
    await this.pause(args)
    if (this.fail && inspect(args)) return { code: 1, stdout: "", stderr: "batch inspection failed" }
    return super.execGit(args, cwd, options)
  }

  override async execGitBuffer(
    args: string[],
    cwd: string,
    options?: Parameters<GitOps["execGitBuffer"]>[2],
  ): Promise<ExecBufferResult> {
    this.calls.push({ kind: "buffer", args, cwd })
    await this.pause(args)
    return super.execGitBuffer(args, cwd, options)
  }
}

async function setup(dir: string, base: string): Promise<void> {
  await fs.mkdir(path.join(dir, "folder"))
  await fs.writeFile(path.join(dir, "folder", "space file.txt"), "space base\n")
  await fs.writeFile(path.join(dir, "third file.txt"), "third base\n")
  runSync(dir, ["add", "."])
  runSync(dir, ["commit", "-m", "add tracked files"])
  runSync(dir, ["branch", "-f", base])
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

  it("preserves tracked and untracked order across parallel metadata batches", async () => {
    await withRepo(async (dir, base) => {
      const tracked = Array.from({ length: 40 }, (_, index) => `tracked-${String(index).padStart(2, "0")}.txt`)
      await Promise.all(tracked.map((file) => fs.writeFile(path.join(dir, file), "before\n")))
      runSync(dir, ["add", "."])
      runSync(dir, ["commit", "-m", "add tracked files"])
      runSync(dir, ["branch", "-f", base])
      await Promise.all(tracked.map((file) => fs.writeFile(path.join(dir, file), "before\nafter\n")))
      const untracked = Array.from({ length: 40 }, (_, index) => `untracked-${String(index).padStart(2, "0")}.txt`)
      await Promise.all(untracked.map((file) => fs.writeFile(path.join(dir, file), "new\n")))

      const result = await diffSummary(git(), dir, base)
      expect(result.map((item) => item.file)).toEqual([...tracked, ...untracked])
      expect(result.slice(0, tracked.length).every((item) => item.tracked && item.additions === 1)).toBe(true)
      expect(result.slice(tracked.length).every((item) => !item.tracked && item.additions === 1)).toBe(true)
      expect(result.every((item) => typeof item.stamp === "string" && item.stamp.length > 0)).toBe(true)
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

  it("keeps empty and named base cache identities separate", async () => {
    await withRepo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\ncommitted\n")
      runSync(dir, ["commit", "-am", "change seed"])
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\ncommitted\nworking\n")
      const local = createLocalDiff(git())
      await local.summary(dir, "")
      await local.summary(dir, base)

      const current = await local.file(dir, "", "seed.txt")
      const ancestor = await local.file(dir, base, "seed.txt")
      expect(current?.before).toBe("seed\ncommitted\n")
      expect(ancestor?.before).toBe("seed\n")
      expect(current?.after).toBe("seed\ncommitted\nworking\n")
      expect(ancestor?.after).toBe(current?.after)
      expect(await local.file(dir, "", "seed.txt")).toBe(current)
      expect(await local.file(dir, base, "seed.txt")).toBe(ancestor)
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

describe("createLocalDiff concurrent details", () => {
  it("coalesces tracked, spaced, and untracked text details", async () => {
    await withRepo(async (dir, base) => {
      await setup(dir, base)
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nupdated\n")
      await fs.writeFile(path.join(dir, "folder", "space file.txt"), "space base\nupdated\n")
      await fs.writeFile(path.join(dir, "third file.txt"), "third base\ndiff --git a/fake.txt b/fake.txt\nupdated\n")
      await fs.writeFile(path.join(dir, "new file.txt"), "new\ntext\n")

      const ops = new RecordingGitOps()
      const local = createLocalDiff(ops)
      await local.summary(dir, base)
      ops.calls.splice(0)

      const files = ["seed.txt", "folder/space file.txt", "third file.txt", "new file.txt"]
      const result = await Promise.all(files.map((file) => local.file(dir, base, file)))
      const [seed, space, third, fresh] = result

      expect(seed?.before).toBe("seed\n")
      expect(seed?.after).toBe("seed\nupdated\n")
      expect(seed?.patch).toContain("+updated")
      expect(space?.before).toBe("space base\n")
      expect(space?.after).toBe("space base\nupdated\n")
      expect(space?.patch).toContain(`diff --git a/folder/space file.txt b/folder/space file.txt`)
      expect(third?.before).toBe("third base\n")
      expect(third?.after).toBe("third base\ndiff --git a/fake.txt b/fake.txt\nupdated\n")
      expect(third?.patch).toContain("+updated")
      expect(third?.patch).toContain("+diff --git a/fake.txt b/fake.txt")
      expect(fresh?.before).toBe("")
      expect(fresh?.after).toBe("new\ntext\n")
      expect(fresh?.patch).toContain("+new")
      expect(await local.file(dir, base, "seed.txt")).toBe(seed)
      expect(await local.file(dir, base, "folder/space file.txt")).toBe(space)
      expect(await local.file(dir, base, "third file.txt")).toBe(third)
      expect(await local.file(dir, base, "new file.txt")).toBe(fresh)
      expect(count(ops, inspect)).toBe(1)
      expect(count(ops, blobs)).toBe(1)
      expect(count(ops, diff)).toBe(1)
      const patch = ops.calls.find((call) => diff(call.args))
      expect(patch?.args).toContain("seed.txt")
      expect(patch?.args).toContain("folder/space file.txt")
      expect(patch?.args).toContain("third file.txt")
      expect(seed?.patch).not.toContain("folder/space file.txt")
      expect(space?.patch).not.toContain("third file.txt")
    })
  })

  it("coalesces requests delivered by separate source-controller timers", async () => {
    await withRepo(async (dir, base) => {
      await setup(dir, base)
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\ntimer\n")
      await fs.writeFile(path.join(dir, "folder", "space file.txt"), "space base\ntimer\n")
      await fs.writeFile(path.join(dir, "third file.txt"), "third base\ntimer\n")

      const ops = new RecordingGitOps()
      const local = createLocalDiff(ops)
      await local.summary(dir, base)
      ops.calls.splice(0)

      const files = ["seed.txt", "folder/space file.txt", "third file.txt"]
      const result = await Promise.all(
        files.map(
          (file) =>
            new Promise<Awaited<ReturnType<typeof local.file>>>((resolve, reject) => {
              setTimeout(() => void local.file(dir, base, file).then(resolve, reject), 0)
            }),
        ),
      )

      expect(result.every((item) => item?.after.includes("timer"))).toBe(true)
      expect(count(ops, inspect)).toBe(1)
      expect(count(ops, blobs)).toBe(1)
      expect(count(ops, diff)).toBe(1)
    })
  })

  it("does not delay untracked previews behind a tracked Git batch", async () => {
    await withRepo(async (dir, base) => {
      await setup(dir, base)
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\ntracked\n")
      await fs.writeFile(path.join(dir, "third file.txt"), "third base\ntracked\n")
      await fs.writeFile(path.join(dir, "fresh.txt"), "available immediately\n")

      const ops = new RecordingGitOps()
      const local = createLocalDiff(ops)
      await local.summary(dir, base)
      const gate = Promise.withResolvers<void>()
      const ready = Promise.withResolvers<void>()
      ops.block(inspect, gate.promise, ready.resolve)

      const first = local.file(dir, base, "seed.txt")
      const second = local.file(dir, base, "third file.txt")
      const fresh = local.file(dir, base, "fresh.txt")
      await ready.promise
      const result = await Promise.race([
        fresh.then((value) => ({ ready: true, value })),
        new Promise<{ ready: false; value: undefined }>((resolve) => {
          setTimeout(() => resolve({ ready: false, value: undefined }), 100)
        }),
      ])
      gate.resolve()
      await Promise.all([first, second])

      expect(result.ready).toBe(true)
      expect(result.value?.after).toBe("available immediately\n")
    })
  })

  it("keeps a singleton on the existing single-file Git commands", async () => {
    await withRepo(async (dir, base) => {
      await setup(dir, base)
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nsingle\n")

      const ops = new RecordingGitOps()
      const local = createLocalDiff(ops)
      await local.summary(dir, base)
      ops.calls.splice(0)

      const result = await local.file(dir, base, "seed.txt")

      expect(result?.after).toBe("seed\nsingle\n")
      expect(count(ops, inspect)).toBe(0)
      expect(count(ops, blobs)).toBe(0)
      expect(count(ops, size)).toBe(1)
      expect(count(ops, show)).toBe(1)
      expect(count(ops, diff)).toBe(1)
    })
  })

  it("does not return stale singleton details after a newer summary arrives", async () => {
    await withRepo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nold\n")
      const ops = new RecordingGitOps()
      const local = createLocalDiff(ops)
      await local.summary(dir, base)
      const gate = Promise.withResolvers<void>()
      const ready = Promise.withResolvers<void>()
      ops.block(show, gate.promise, ready.resolve)
      const pending = local.file(dir, base, "seed.txt")
      await ready.promise
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nnewer contents\n")
      const summary = await local.summary(dir, base)
      gate.resolve()

      const value = await pending
      expect(value?.after).toBe("seed\nnewer contents\n")
      expect(value?.stamp).toBe(summary.find((entry) => entry.file === "seed.txt")?.stamp)
      expect(await local.file(dir, base, "seed.txt")).toBe(value)
    })
  })

  it("shares one result for duplicate concurrent callers in a batch", async () => {
    await withRepo(async (dir, base) => {
      await setup(dir, base)
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nduplicate\n")
      await fs.writeFile(path.join(dir, "third file.txt"), "third base\nduplicate\n")

      const ops = new RecordingGitOps()
      const local = createLocalDiff(ops)
      await local.summary(dir, base)
      ops.calls.splice(0)

      const [first, second, sibling] = await Promise.all([
        local.file(dir, base, "seed.txt"),
        local.file(dir, base, "seed.txt"),
        local.file(dir, base, "third file.txt"),
      ])

      expect(first).toBe(second)
      expect(first?.after).toBe("seed\nduplicate\n")
      expect(sibling?.after).toBe("third base\nduplicate\n")
      expect(count(ops, inspect)).toBe(1)
      expect(count(ops, blobs)).toBe(1)
      expect(count(ops, diff)).toBe(1)
    })
  })

  it("aborts one subscriber without canceling a sibling", async () => {
    await withRepo(async (dir, base) => {
      await setup(dir, base)
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nfirst\n")
      await fs.writeFile(path.join(dir, "third file.txt"), "third base\nsecond\n")

      const ops = new RecordingGitOps()
      const local = createLocalDiff(ops)
      await local.summary(dir, base)
      ops.calls.splice(0)
      const gate = Promise.withResolvers<void>()
      const ready = Promise.withResolvers<void>()
      ops.block(inspect, gate.promise, ready.resolve)
      const ctl = new AbortController()
      const first = local.file(dir, base, "seed.txt", ctl.signal)
      const sibling = local.file(dir, base, "third file.txt")
      await ready.promise
      ctl.abort()

      await expect(first).rejects.toThrow()
      gate.resolve()
      expect((await sibling)?.after).toBe("third base\nsecond\n")
      expect(count(ops, inspect)).toBe(1)
      expect(count(ops, blobs)).toBe(1)
      expect(count(ops, diff)).toBe(1)
    })
  })

  it("aborts one subscriber without canceling another subscriber of the same identity", async () => {
    await withRepo(async (dir, base) => {
      await setup(dir, base)
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nshared\n")
      await fs.writeFile(path.join(dir, "third file.txt"), "third base\nother\n")

      const ops = new RecordingGitOps()
      const local = createLocalDiff(ops)
      await local.summary(dir, base)
      ops.calls.splice(0)
      const gate = Promise.withResolvers<void>()
      const ready = Promise.withResolvers<void>()
      ops.block(inspect, gate.promise, ready.resolve)
      const one = new AbortController()
      const two = new AbortController()
      const first = local.file(dir, base, "seed.txt", one.signal)
      const second = local.file(dir, base, "seed.txt", two.signal)
      const sibling = local.file(dir, base, "third file.txt")
      await ready.promise
      one.abort()

      await expect(first).rejects.toThrow()
      gate.resolve()
      expect((await second)?.after).toBe("seed\nshared\n")
      expect((await sibling)?.after).toBe("third base\nother\n")
      expect(count(ops, inspect)).toBe(1)
      expect(count(ops, blobs)).toBe(1)
      expect(count(ops, diff)).toBe(1)
    })
  })

  it("does not spawn detail Git when every queued caller aborts before flush", async () => {
    await withRepo(async (dir, base) => {
      await setup(dir, base)
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nqueued\n")
      await fs.writeFile(path.join(dir, "third file.txt"), "third base\nqueued\n")

      const ops = new RecordingGitOps()
      const local = createLocalDiff(ops)
      await local.summary(dir, base)
      ops.calls.splice(0)
      const firstCtl = new AbortController()
      const secondCtl = new AbortController()
      const first = local.file(dir, base, "seed.txt", firstCtl.signal)
      const second = local.file(dir, base, "third file.txt", secondCtl.signal)
      firstCtl.abort()
      secondCtl.abort()

      await expect(first).rejects.toThrow()
      await expect(second).rejects.toThrow()
      await turn()
      expect(ops.calls).toHaveLength(0)
    })
  })

  it("keeps a started singleton cache-owned across a worktree switch", async () => {
    await withRepo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nretained\n")
      const ops = new RecordingGitOps()
      const local = createLocalDiff(ops)
      await local.summary(dir, base)
      ops.calls.splice(0)
      const gate = Promise.withResolvers<void>()
      const ready = Promise.withResolvers<void>()
      ops.block(size, gate.promise, ready.resolve)
      const controller = new AbortController()
      const first = local.file(dir, base, "seed.txt", controller.signal)
      await ready.promise
      controller.abort()
      await expect(first).rejects.toThrow()
      const second = local.file(dir, base, "seed.txt")
      gate.resolve()
      const value = await second
      expect(value?.after).toBe("seed\nretained\n")
      expect(count(ops, size)).toBe(1)
      expect(count(ops, show)).toBe(1)
      expect(count(ops, diff)).toBe(1)
      const calls = ops.calls.length
      expect(await local.file(dir, base, "seed.txt")).toBe(value)
      expect(ops.calls).toHaveLength(calls)
    })
  })

  it("keeps a started batch cache-owned across aborts and resubscription", async () => {
    await withRepo(async (dir, base) => {
      await setup(dir, base)
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nowned\n")
      await fs.writeFile(path.join(dir, "third file.txt"), "third base\nowned\n")

      const ops = new RecordingGitOps()
      const local = createLocalDiff(ops)
      await local.summary(dir, base)
      ops.calls.splice(0)
      const gate = Promise.withResolvers<void>()
      const ready = Promise.withResolvers<void>()
      ops.block(inspect, gate.promise, ready.resolve)
      const one = new AbortController()
      const two = new AbortController()
      const first = local.file(dir, base, "seed.txt", one.signal)
      const second = local.file(dir, base, "third file.txt", two.signal)
      await ready.promise
      one.abort()
      two.abort()
      await expect(first).rejects.toThrow()
      await expect(second).rejects.toThrow()

      const resub = local.file(dir, base, "seed.txt", new AbortController().signal)
      gate.resolve()
      const result = await resub
      expect(result?.after).toBe("seed\nowned\n")
      const before = ops.calls.length
      expect(await local.file(dir, base, "seed.txt")).toBe(result)
      expect(ops.calls.length).toBe(before)
      expect(count(ops, inspect)).toBe(1)
      expect(count(ops, blobs)).toBe(1)
      expect(count(ops, diff)).toBe(1)
    })
  })

  it("preserves a started batch through an unchanged summary refresh", async () => {
    await withRepo(async (dir, base) => {
      await setup(dir, base)
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nrefresh\n")
      await fs.writeFile(path.join(dir, "third file.txt"), "third base\nrefresh\n")

      const ops = new RecordingGitOps()
      const local = createLocalDiff(ops)
      await local.summary(dir, base)
      ops.calls.splice(0)
      const gate = Promise.withResolvers<void>()
      const ready = Promise.withResolvers<void>()
      ops.block(inspect, gate.promise, ready.resolve)
      const first = local.file(dir, base, "seed.txt")
      const second = local.file(dir, base, "third file.txt")
      await ready.promise
      await local.summary(dir, base)
      gate.resolve()
      const [one, two] = await Promise.all([first, second])

      expect(one?.after).toBe("seed\nrefresh\n")
      expect(two?.after).toBe("third base\nrefresh\n")
      const before = ops.calls.length
      expect(await local.file(dir, base, "seed.txt")).toBe(one)
      expect(await local.file(dir, base, "third file.txt")).toBe(two)
      expect(ops.calls.length).toBe(before)
      expect(count(ops, inspect)).toBe(1)
      expect(count(ops, blobs)).toBe(1)
      expect(count(ops, diff)).toBe(1)
    })
  })

  it("refreshes a changed sibling without corrupting an unchanged sibling", async () => {
    await withRepo(async (dir, base) => {
      await setup(dir, base)
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nfirst\n")
      await fs.writeFile(path.join(dir, "third file.txt"), "third base\nfirst\n")

      const ops = new RecordingGitOps()
      const local = createLocalDiff(ops)
      await local.summary(dir, base)
      ops.calls.splice(0)
      const gate = Promise.withResolvers<void>()
      const ready = Promise.withResolvers<void>()
      ops.block(inspect, gate.promise, ready.resolve)
      const first = local.file(dir, base, "seed.txt")
      const second = local.file(dir, base, "third file.txt")
      await ready.promise
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nchanged while loading\n")
      await local.summary(dir, base)
      gate.resolve()
      const stable = await second
      await first.catch(() => null)

      expect(stable?.after).toBe("third base\nfirst\n")
      const current = await local.file(dir, base, "seed.txt")
      expect(current?.after).toBe("seed\nchanged while loading\n")
      expect(current).not.toBe(stable)
    })
  })

  it("falls back independently when shared batch inspection fails", async () => {
    await withRepo(async (dir, base) => {
      await setup(dir, base)
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\nfallback\n")
      await fs.writeFile(path.join(dir, "folder", "space file.txt"), "space base\nfallback\n")
      await fs.writeFile(path.join(dir, "third file.txt"), "third base\nfallback\n")

      const ops = new RecordingGitOps()
      ops.fail = true
      const local = createLocalDiff(ops)
      await local.summary(dir, base)
      ops.calls.splice(0)
      const files = ["seed.txt", "folder/space file.txt", "third file.txt"]
      const result = await Promise.all(files.map((file) => local.file(dir, base, file)))

      expect(result.map((item) => item?.summarized)).toEqual([false, false, false])
      expect(result[0]?.after).toBe("seed\nfallback\n")
      expect(result[1]?.after).toBe("space base\nfallback\n")
      expect(result[2]?.after).toBe("third base\nfallback\n")
      expect(count(ops, inspect)).toBe(1)
      expect(count(ops, blobs)).toBe(0)
      expect(count(ops, size)).toBe(3)
      expect(count(ops, show)).toBe(3)
      expect(count(ops, diff)).toBe(3)
      const before = ops.calls.length
      expect(await local.file(dir, base, "seed.txt")).toBe(result[0])
      expect(ops.calls.length).toBe(before)
    })
  })

  it("keeps images and non-image binaries on their existing detail paths", async () => {
    await withRepo(async (dir, base) => {
      const before = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])
      const after = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])
      const bytes = Buffer.from([0x00, 0x01, 0x02, 0x03])
      await fs.writeFile(path.join(dir, "banner.png"), before)
      await fs.writeFile(path.join(dir, "tone.bin"), bytes)
      runSync(dir, ["add", "banner.png", "tone.bin"])
      runSync(dir, ["commit", "-m", "add binary files"])
      runSync(dir, ["branch", "-f", base])
      await fs.writeFile(path.join(dir, "seed.txt"), "seed\ntext\n")
      await fs.writeFile(path.join(dir, "banner.png"), after)
      await fs.writeFile(path.join(dir, "tone.bin"), Buffer.concat([bytes, Buffer.from([0xff])]))

      const ops = new RecordingGitOps()
      const local = createLocalDiff(ops)
      await local.summary(dir, base)
      ops.calls.splice(0)
      const [text, image, binary] = await Promise.all([
        local.file(dir, base, "seed.txt"),
        local.file(dir, base, "banner.png"),
        local.file(dir, base, "tone.bin"),
      ])

      expect(text?.after).toBe("seed\ntext\n")
      expect(image?.image?.before?.data).toBe(before.toString("base64"))
      expect(image?.image?.after?.data).toBe(after.toString("base64"))
      expect(binary?.summarized).toBe(false)
      expect(binary?.before).toBe("")
      expect(binary?.after).toBe("")
      expect(binary?.patch).toBe("")
      expect(count(ops, inspect)).toBe(0)
      expect(count(ops, blobs)).toBe(0)
      expect(count(ops, size)).toBe(2)
      expect(count(ops, show)).toBe(2)
      expect(count(ops, diff)).toBe(1)
    })
  })

  it("preserves summarized results for oversized and unsafe paths", async () => {
    await withRepo(async (dir, base) => {
      await fs.writeFile(path.join(dir, "seed.txt"), "a".repeat(MAX_DETAIL_BYTES + 1))
      const local = createLocalDiff(git())
      await local.summary(dir, base)

      const result = await local.file(dir, base, "seed.txt")
      expect(result?.summarized).toBe(true)
      expect(result?.before).toBe("")
      expect(result?.after).toBe("")
      expect(result?.patch).toBe("")
      expect(await local.file(dir, base, "../outside.txt")).toBeNull()
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
