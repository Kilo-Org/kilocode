import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import type { PRComment } from "../../src/agent-manager/types"
import { clearContextCache, withContext } from "../../src/agent-manager/pr/pr-comment-context"
import { parseComments } from "../../src/agent-manager/pr/am-pr-utils"
import { parse, PATCH_LIMIT, preview } from "../../src/shared/pr-comment-preview"
import { exec } from "../../src/util/process"
import { prPayload } from "../../webview-ui/agent-manager/pr/pr-comment-payload"
import { mapRemoteComments } from "../../webview-ui/diff-viewer/remote-comments"

const roots: string[] = []
const original = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`)
const changed = ["inserted before", ...original.slice(0, 9), "committed replacement", ...original.slice(10)]
const hunk = "@@ -7,4 +8,4 @@\n line 7\n line 8\n line 9\n-line 10\n+original comment anchor"

function thread(over: Partial<PRComment> = {}): PRComment {
  return {
    id: "comment",
    threadId: "thread",
    author: "reviewer",
    body: "Check the committed behavior below this line.",
    file: "src/open.ts",
    line: 11,
    originalLine: 10,
    side: "additions",
    resolved: false,
    outdated: false,
    diffHunk: hunk,
    ...over,
  }
}

async function git(dir: string, ...args: string[]) {
  return (await exec("git", args, { cwd: dir, timeout: 5_000 })).stdout.trim()
}

async function commit(dir: string) {
  await git(dir, "add", ".")
  await git(
    dir,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "fixture",
  )
  return git(dir, "rev-parse", "HEAD")
}

async function repo(before = original, after = changed, moved = false) {
  const dir = await mkdtemp(path.join(tmpdir(), "kilo-pr-context-"))
  roots.push(dir)
  await git(dir, "init", "-q", "--template=")
  await mkdir(path.join(dir, "src"))
  await writeFile(path.join(dir, "src/open.ts"), `${before.join("\n")}\n`)
  const base = await commit(dir)
  const file = moved ? "src/renamed.ts" : "src/open.ts"
  if (moved) await rename(path.join(dir, "src/open.ts"), path.join(dir, file))
  await writeFile(path.join(dir, file), `${after.join("\n")}\n`)
  const head = await commit(dir)
  return { dir, base, head, file }
}

function options(refs: { base: string; head: string }) {
  const calls: string[][] = []
  const opts: Parameters<typeof withContext>[2] = {
    ...refs,
    repo: { owner: "example", name: "repo" },
    shell: (cmd, args, opts) => {
      calls.push(args)
      return exec(cmd, args, opts)
    },
    gh: async () => {
      throw new Error("Remote comparison unavailable")
    },
  }
  return { opts, calls }
}

beforeEach(clearContextCache)
afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("committed PR comment context", () => {
  it("uses the PR merge base and head despite a different HEAD, index, and dirty file", async () => {
    const refs = await repo()
    await git(refs.dir, "checkout", "--quiet", "--detach", refs.base)
    await writeFile(path.join(refs.dir, "base-only.txt"), "base branch change\n")
    const base = await commit(refs.dir)
    await writeFile(path.join(refs.dir, refs.file), "staged contents\n")
    await git(refs.dir, "add", refs.file)
    await writeFile(path.join(refs.dir, refs.file), "dirty contents\n")
    const before = await git(refs.dir, "status", "--porcelain=v1")
    const { opts, calls } = options({ base, head: refs.head })
    const input = thread()
    const [item] = await withContext(refs.dir, [input], opts)

    expect(item?.preview).toEqual({
      patch: "@@ -8,6 +9,6 @@\n line 8\n line 9\n-line 10\n+committed replacement\n line 11\n line 12\n line 13",
      line: 11,
      side: "additions",
      base: refs.base,
      head: refs.head,
      top: true,
      bottom: true,
    })
    expect(item?.after).toBeUndefined()
    expect(item?.diffHunk).toBe(hunk)
    expect(item?.line).toBe(11)
    expect(item?.originalLine).toBe(10)
    expect(prPayload(item!)).toEqual(prPayload(input))
    expect(await git(refs.dir, "rev-parse", "HEAD")).toBe(base)
    expect(await git(refs.dir, "status", "--porcelain=v1")).toBe(before)
    expect(await readFile(path.join(refs.dir, refs.file), "utf8")).toBe("dirty contents\n")
    expect(calls.every((args) => !args.includes("HEAD") && !args.includes("checkout"))).toBe(true)
    expect(
      calls
        .filter((args) => args.includes("diff"))
        .every((args) => args.includes("--no-ext-diff") && args.includes("--no-textconv")),
    ).toBe(true)
  })

  it("keeps LEFT coordinates and deduplicates both paths of a rename", async () => {
    const refs = await repo(original, changed, true)
    const { opts, calls } = options(refs)
    const items = await withContext(
      refs.dir,
      [
        thread({ file: refs.file, side: "deletions", line: 10, originalLine: 2 }),
        thread({ file: "src/open.ts" }),
        thread({ file: refs.file }),
      ],
      opts,
    )
    expect(items.at(0)?.preview).toMatchObject({ line: 10, side: "deletions" })
    expect(items.at(0)?.preview?.patch).toBe(
      "@@ -7,6 +8,6 @@\n line 7\n line 8\n line 9\n-line 10\n+committed replacement\n line 11\n line 12",
    )
    expect(items.at(1)?.preview).toEqual(items.at(2)?.preview)
    const diffs = calls.filter((args) => args.includes("--unified=6"))
    expect(diffs).toHaveLength(1)
    expect(diffs.at(0)).toContain(":(top,literal)src/open.ts")
    expect(diffs.at(0)).toContain(":(top,literal)src/renamed.ts")
    await withContext(refs.dir, [thread({ file: refs.file })], opts)
    expect(calls.filter((args) => args.includes("--unified=6"))).toHaveLength(1)
  })

  it("invalidates a cached file when the PR revision changes", async () => {
    const refs = await repo()
    const { opts, calls } = options(refs)
    const [before] = await withContext(refs.dir, [thread()], opts)
    await writeFile(
      path.join(refs.dir, refs.file),
      `${changed.map((line) => line.replace("committed", "updated")).join("\n")}\n`,
    )
    const head = await commit(refs.dir)
    const [after] = await withContext(refs.dir, [thread()], { ...opts, head })
    expect(before?.preview?.head).toBe(refs.head)
    expect(after?.preview?.head).toBe(head)
    expect(after?.preview?.patch).toContain("+updated replacement")
    expect(calls.filter((args) => args.includes("--unified=6"))).toHaveLength(2)
  })

  it("keeps outdated, line-less, original-only, and unmatched comments as readable fallbacks", async () => {
    const refs = await repo()
    const { opts } = options(refs)
    const parsed = parseComments([
      {
        id: "original-only",
        line: null,
        diffSide: "RIGHT",
        path: refs.file,
        comments: { nodes: [{ id: "original-comment", body: "Still readable", line: null, originalLine: 11 }] },
      },
    ])
    const inputs = [
      thread({ outdated: true }),
      thread({ line: undefined }),
      ...parsed,
      thread({ file: "../outside.ts" }),
      thread({ file: "src/missing.ts" }),
      thread({ line: 999 }),
      thread({ side: undefined }),
    ]
    const items = await withContext(refs.dir, inputs, opts)
    expect(items.map((item) => item.body)).toEqual(inputs.map((item) => item.body))
    expect(items.every((item) => !item.preview && item.previewUnavailable && !item.after)).toBe(true)
    expect(items.at(2)).toMatchObject({ line: 11, unmapped: true })
  })

  it("does not expose a truncated or oversized local patch", async () => {
    const refs = await repo(["before"], ["x".repeat(PATCH_LIMIT + 1)])
    const { opts } = options(refs)
    const [item] = await withContext(refs.dir, [thread({ line: 1 })], opts)
    expect(item?.preview).toBeUndefined()
    expect(item?.previewUnavailable).toBe(true)
    expect(item?.body).toBe(thread().body)
  })

  it("uses only a SHA-pinned complete comparison when local objects are unavailable", async () => {
    const refs = await repo()
    const { opts } = options({ base: refs.base, head: "f".repeat(40) })
    const patch = (
      await exec("git", ["diff", "--no-ext-diff", "--no-textconv", refs.base, refs.head], { cwd: refs.dir })
    ).stdout
    const counts = parse(patch)!
    const calls: string[][] = []
    opts.gh = async (args, options) => {
      calls.push(args)
      expect(options?.maxBuffer).toBe(2 * 1024 * 1024)
      return {
        stdout: JSON.stringify({
          base: refs.base,
          merge: refs.base,
          files: [{ filename: refs.file, patch, additions: counts.additions, deletions: counts.deletions }],
        }),
        stderr: "",
      }
    }
    const items = await withContext(refs.dir, [thread(), thread({ id: "second" })], opts)
    expect(items.every((item) => item.preview?.head === opts.head)).toBe(true)
    expect(items.at(0)?.preview?.patch).toContain("+committed replacement")
    expect(calls).toHaveLength(1)
    expect(calls.at(0)?.at(1)).toBe(`repos/example/repo/compare/${refs.base}...${opts.head}?per_page=1`)
  })

  it.each([
    { name: "missing patch", patch: undefined, additions: 1, deletions: 1 },
    { name: "partial hunk", patch: "@@ -1,2 +1,2 @@\n-before\n+after", additions: 1, deletions: 1 },
    { name: "missing later hunk", patch: "@@ -1,1 +1,1 @@\n-before\n+after", additions: 2, deletions: 1 },
    {
      name: "oversized patch",
      patch: `@@ -1,1 +1,1 @@\n-before\n+${"x".repeat(PATCH_LIMIT)}`,
      additions: 1,
      deletions: 1,
    },
  ])("rejects remote $name", async (file) => {
    const refs = await repo()
    const { opts } = options({ base: refs.base, head: "f".repeat(40) })
    opts.gh = async () => ({
      stdout: JSON.stringify({ base: refs.base, merge: refs.base, files: [{ filename: refs.file, ...file }] }),
      stderr: "",
    })
    const [item] = await withContext(refs.dir, [thread({ line: 1 })], opts)
    expect(item?.preview).toBeUndefined()
    expect(item?.previewUnavailable).toBe(true)
    expect(item?.body).toBe(thread().body)
  })

  it("bounds the number of enriched files and total preview bytes", async () => {
    const refs = await repo()
    const { opts } = options({ base: refs.base, head: "f".repeat(40) })
    const files = Array.from({ length: 33 }, (_, index) => ({
      filename: `file-${index}.ts`,
      patch: "@@ -0,0 +1,1 @@\n+committed",
      additions: 1,
      deletions: 0,
    }))
    opts.gh = async () => ({ stdout: JSON.stringify({ base: refs.base, merge: refs.base, files }), stderr: "" })
    const items = await withContext(
      refs.dir,
      files.map((file) => thread({ file: file.filename, line: 1, originalLine: 1, diffHunk: file.patch })),
      opts,
    )
    expect(items.filter((item) => item.preview)).toHaveLength(32)
    const capped = items.at(-1)!
    expect(capped.previewUnavailable).toBe(true)
    const source = { file: capped.file!, before: "", after: "committed", additions: 1, deletions: 0 }
    expect(mapRemoteComments([capped], [source]).outside).toEqual([])

    clearContextCache()
    const text = "界".repeat(2_000)
    files.at(0)!.patch = `@@ -0,0 +1,1 @@\n+${text}`
    const crowded = await withContext(
      refs.dir,
      Array.from({ length: 200 }, (_, index) =>
        thread({
          id: `comment-${index}`,
          file: files.at(0)!.filename,
          line: 1,
          originalLine: 1,
          diffHunk: files.at(0)!.patch,
        }),
      ),
      opts,
    )
    expect(
      crowded.reduce((total, item) => total + Buffer.byteLength(item.preview?.patch ?? ""), 0),
    ).toBeLessThanOrEqual(1024 * 1024)
    const exhausted = crowded.find((item) => item.previewUnavailable)!
    expect(exhausted).toBeDefined()
    expect(mapRemoteComments([exhausted], [{ ...source, file: exhausted.file!, after: text }]).outside).toEqual([])
    expect(crowded.every((item) => item.body === thread().body)).toBe(true)
  })

  it.each([false, true])("keeps current anchors when previews fail with missing refs=%s", async (missing) => {
    const refs = await repo()
    const { opts } = options({ base: missing ? "" : refs.base, head: missing ? "" : "f".repeat(40) })
    const input = thread({
      line: 1,
      originalLine: 1,
      diffHunk: "@@ -0,0 +1 @@\n+inserted before",
      after: ["old disk context"],
    })
    const items = await withContext(refs.dir, [input], opts)
    expect(items.at(0)).toMatchObject({ body: input.body, diffHunk: input.diffHunk, previewUnavailable: true })
    expect(items.at(0)?.after).toBeUndefined()
    const source = {
      file: refs.file,
      before: original.join("\n"),
      after: changed.join("\n"),
      additions: 2,
      deletions: 1,
    }
    expect(mapRemoteComments(items, [source]).outside).toEqual([])
    const [retried] = await withContext(refs.dir, items, options(refs).opts)
    expect(retried?.preview).toBeDefined()
  })
})

describe("bounded committed hunk windows", () => {
  it.each(["additions", "deletions"] as const)("numbers an all-%s window correctly", (side) => {
    const marker = side === "additions" ? "+" : "-"
    const header = side === "additions" ? "@@ -0,0 +1,1000 @@" : "@@ -1,1000 +0,0 @@"
    const patch = parse(
      `${header}\n${Array.from({ length: 1000 }, (_, index) => `${marker}row ${index + 1}`).join("\n")}`,
    )!
    const view = preview(patch, 500, side)!
    expect(view.patch.split("\n")).toHaveLength(8)
    expect(view.patch.split("\n").at(0)).toBe(side === "additions" ? "@@ -0,0 +497,7 @@" : "@@ -497,7 +0,0 @@")
    expect(view).toMatchObject({ line: 500, side, top: true, bottom: true })
    expect(parse(view.patch)).toBeDefined()
  })

  it("selects exactly one current hunk and retains no-newline markers", () => {
    const patch = parse(
      "@@ -1,1 +1,1 @@\n-first\n+changed\n@@ -20,1 +20,1 @@\n-last\n\\ No newline at end of file\n+updated\n\\ No newline at end of file",
    )!
    const view = preview(patch, 20, "additions")!
    expect(view.patch).toBe(
      "@@ -20,1 +20,1 @@\n-last\n\\ No newline at end of file\n+updated\n\\ No newline at end of file",
    )
    expect(view.top).toBe(true)
    expect(view.bottom).toBe(false)
    expect(parse(view.patch)?.hunks).toHaveLength(1)
    expect(preview(patch, 10, "additions")).toBeUndefined()
  })

  it("bounds UTF-8 bytes without truncating source rows or inventing markers", () => {
    const text = "界".repeat(2_000)
    const patch = parse(`@@ -0,0 +1,3 @@\n+${text}\n+target\n+${text}`)!
    const view = preview(patch, 2, "additions")!
    expect(Buffer.byteLength(view.patch)).toBeLessThanOrEqual(8 * 1024)
    expect(view.patch).toContain("+target")
    expect(parse(view.patch)).toBeDefined()
    expect(preview(parse(`@@ -0,0 +1,1 @@\n+${text}${text}`)!, 1, "additions")).toBeUndefined()
  })

  it("rejects incomplete, overlapping, multi-file, and invalid-coordinate patches", () => {
    for (const patch of [
      "@@ -1,2 +1,2 @@\n-one\n+two",
      "@@ -1,1 +1,1 @@\n-one\n+two\n@@ -1,1 +1,1 @@\n-two\n+three",
      "@@ -1,1 +1,1 @@\n-one\n+two\ndiff --git a/other b/other",
      "@@ -0,1 +0,1 @@\n-one\n+two",
    ])
      expect(parse(patch)).toBeUndefined()
  })
})
