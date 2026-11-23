import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { appendSessionDiffs, mergeSessionDiffs } from "../../src/kilocode/session-portability/cumulative-diff"
import { extractSessionDiffs, restoreSessionDiffs } from "../../src/kilocode/session-portability/session-diff-restore"
import { fetchCloudSessionForImport } from "@kilocode/kilo-gateway"

const dirs: string[] = []

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-session-diff-"))
  dirs.push(dir)
  return dir
}

function git(dir: string, args: string[]) {
  const proc = Bun.spawnSync(["git", ...args], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  })
  if (proc.exitCode !== 0) {
    const text = new TextDecoder().decode(proc.stderr)
    throw new Error(text)
  }
  return new TextDecoder().decode(proc.stdout)
}

function repo() {
  const dir = tmp()
  fs.mkdirSync(path.join(dir, "src"), { recursive: true })
  git(dir, ["init"])
  git(dir, ["config", "user.email", "test@example.com"])
  git(dir, ["config", "user.name", "Test User"])
  fs.writeFileSync(path.join(dir, "src/index.ts"), "before\n")
  git(dir, ["add", "."])
  git(dir, ["commit", "-m", "initial"])
  return dir
}

function patch(dir: string) {
  fs.writeFileSync(path.join(dir, "src/index.ts"), "after\n")
  return git(dir, ["diff", "--src-prefix=a/", "--dst-prefix=b/"])
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe("session diff restore", () => {
  test("merges imported base diffs before local diffs without duplicating unchanged imports", () => {
    const base = [{ file: "a.txt", patch: "base", additions: 1, deletions: 0, status: "added" as const }]
    const local = [{ file: "b.txt", patch: "local", additions: 1, deletions: 0, status: "added" as const }]

    expect(mergeSessionDiffs({ base, local })).toEqual([...base, ...local])
    expect(mergeSessionDiffs({ base, local: base })).toEqual(base)
    expect(mergeSessionDiffs({ base, local: [...base, ...local] })).toEqual([...base, ...local])
  })

  test("appends turn diffs to imported cumulative diffs without repeating existing tails", () => {
    const base = [{ file: "a.txt", patch: "base", additions: 1, deletions: 0, status: "added" as const }]
    const local = [{ file: "b.txt", patch: "local", additions: 1, deletions: 0, status: "added" as const }]

    expect(appendSessionDiffs({ existing: base, next: local })).toEqual([...base, ...local])
    expect(appendSessionDiffs({ existing: [...base, ...local], next: local })).toEqual([...base, ...local])
    expect(appendSessionDiffs({ existing: base, next: [...base, ...local] })).toEqual([...base, ...local])
    expect(appendSessionDiffs({ existing: [...base, ...local], next: base })).toEqual([...base, ...local])
  })

  test("extracts top-level sessionDiff before legacy message summaries", () => {
    const diff = {
      file: "src/index.ts",
      patch: "diff --git a/src/index.ts b/src/index.ts\n",
      additions: 1,
      deletions: 0,
      status: "modified",
    }
    const data = {
      sessionDiff: [diff],
      messages: [{ info: { summary: { diffs: [{ file: "legacy.txt", additions: 1, deletions: 0 }] } } }],
    }

    expect(extractSessionDiffs(data)).toEqual([diff])
  })

  test("falls back to legacy message summary diffs", () => {
    const data = {
      messages: [
        { info: { summary: { diffs: [{ file: "a.txt", after: "first", additions: 1, deletions: 0 }] } } },
        { info: { summary: { diffs: [{ file: "a.txt", after: "second", additions: 1, deletions: 0 }] } } },
      ],
    }

    expect(extractSessionDiffs(data)).toEqual([{ file: "a.txt", after: "second", additions: 1, deletions: 0 }])
  })

  test("applies patch diffs in a git workspace", () => {
    const dir = repo()
    const text = patch(dir)
    git(dir, ["checkout", "--", "."])

    const result = restoreSessionDiffs({
      directory: dir,
      diffs: [{ file: "src/index.ts", patch: text, additions: 1, deletions: 1, status: "modified" }],
    })

    expect(result).toEqual({ applied: 1, skipped: 0, total: 1 })
    expect(fs.readFileSync(path.join(dir, "src/index.ts"), "utf8").replace(/\r\n/g, "\n")).toBe("after\n")
  })

  test("applies patch diffs missing a final patch newline", () => {
    const dir = repo()
    const text = patch(dir).trimEnd()
    git(dir, ["checkout", "--", "."])

    const result = restoreSessionDiffs({
      directory: dir,
      diffs: [{ file: "src/index.ts", patch: text, additions: 1, deletions: 1, status: "modified" }],
    })

    expect(result).toEqual({ applied: 1, skipped: 0, total: 1 })
    expect(fs.readFileSync(path.join(dir, "src/index.ts"), "utf8").replace(/\r\n/g, "\n")).toBe("after\n")
  })

  test("skips snapshot diffs outside the workspace", () => {
    const dir = tmp()
    const out = path.join(path.dirname(dir), `${path.basename(dir)}-outside.txt`)
    fs.rmSync(out, { force: true })

    const result = restoreSessionDiffs({
      directory: dir,
      diffs: [{ file: `../${path.basename(out)}`, after: "outside", additions: 1, deletions: 0, status: "modified" }],
    })

    expect(result).toEqual({ applied: 0, skipped: 1, total: 1 })
    expect(fs.existsSync(out)).toBe(false)
  })

  test("a cut import restores only pre-cut file edits even when the server ignores the cut", async () => {
    const dir = tmp()
    const msg = (id: string, file: string, after: string) => ({
      info: { id, sessionID: "ses_cloud", summary: { diffs: [{ file, after, additions: 1, deletions: 0 }] } },
      parts: [],
    })
    // An old server returns the full export, including the post-cut sessionDiff.
    const full = {
      info: { id: "ses_cloud" },
      messages: [msg("msg_001", "a.txt", "first"), msg("msg_002", "a.txt", "second"), msg("msg_003", "b.txt", "late")],
      sessionDiff: [
        { file: "a.txt", after: "final", additions: 1, deletions: 0 },
        { file: "b.txt", after: "late", additions: 1, deletions: 0 },
      ],
    }
    const fetcher = globalThis.fetch
    globalThis.fetch = Object.assign(async () => Response.json(full), { preconnect: fetcher.preconnect })
    const fetched = await fetchCloudSessionForImport("token", "ses_cloud", { upToMessageId: "msg_002" }).finally(() => {
      globalThis.fetch = fetcher
    })
    if (!fetched.ok) throw new Error(fetched.error)

    const diffs = extractSessionDiffs(fetched.data)
    expect(diffs).toEqual([{ file: "a.txt", after: "second", additions: 1, deletions: 0 }])
    expect(restoreSessionDiffs({ directory: dir, diffs })).toEqual({ applied: 1, skipped: 0, total: 1 })
    expect(fs.readFileSync(path.join(dir, "a.txt"), "utf8")).toBe("second")
    expect(fs.existsSync(path.join(dir, "b.txt"))).toBe(false)
  })
})
