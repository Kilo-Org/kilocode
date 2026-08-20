import { describe, expect, it, beforeEach } from "bun:test"
import { mkdtemp, mkdir, utimes, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import type { PRComment } from "../../src/agent-manager/types"
import { clearContextCache, withContext } from "../../src/agent-manager/pr/pr-comment-context"

const SOURCE = [
  "export function open(file: string) {",
  "  const event = new CustomEvent('kilo:open-file')",
  "  event.preventDefault()",
  "  return dispatch(event)",
  "}",
  "",
]

// The hunk ends at line 3, the way GitHub truncates every diffHunk.
const HUNK = [
  "@@ -1,2 +1,3 @@",
  " export function open(file: string) {",
  "+  const event = new CustomEvent('kilo:open-file')",
  "+  event.preventDefault()",
].join("\n")

function thread(over: Partial<PRComment> = {}): PRComment {
  return {
    id: "PRRC_1",
    threadId: "PRRT_1",
    author: "kilo-code-bot",
    body: "preventDefault runs before the file opens",
    file: "src/open.ts",
    line: 3,
    resolved: false,
    outdated: false,
    diffHunk: HUNK,
    ...over,
  }
}

async function repo(lines = SOURCE): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "kilo-pr-context-"))
  await mkdir(path.join(dir, "src"))
  await write(dir, lines)
  return dir
}

async function write(dir: string, lines: string[], mtime = new Date(1_700_000_000_000)): Promise<void> {
  const file = path.join(dir, "src/open.ts")
  await writeFile(file, lines.join("\n"))
  await utimes(file, mtime, mtime)
}

describe("withContext", () => {
  beforeEach(() => {
    clearContextCache()
  })

  it("continues the hunk with the lines below the commented line", async () => {
    const dir = await repo()
    const [item] = await withContext(dir, [thread()])

    expect(item!.after).toEqual(["  return dispatch(event)", "}", ""])
  })

  it("stops at the end of the file", async () => {
    const dir = await repo(SOURCE.slice(0, 4))
    const [item] = await withContext(dir, [thread()])

    expect(item!.after).toEqual(["  return dispatch(event)"])
  })

  // The agent rewrites files while the review is open. Context read from a file
  // that no longer matches the hunk would show code from the wrong place.
  it("attaches nothing when the commented line no longer matches the file", async () => {
    const dir = await repo(["export function open(file: string) {", "  return dispatch(file)", "}", ""])
    const [item] = await withContext(dir, [thread()])

    expect(item!.after).toBeUndefined()
  })

  it("re-reads a file once its mtime changes", async () => {
    const dir = await repo()
    await withContext(dir, [thread()])
    await write(dir, [...SOURCE.slice(0, 3), "  return open(file)", "}", ""], new Date(1_700_000_600_000))
    const [item] = await withContext(dir, [thread()])

    expect(item!.after).toEqual(["  return open(file)", "}", ""])
  })

  it("leaves outdated threads, missing files, and hunk-less threads untouched", async () => {
    const dir = await repo()
    const items = await withContext(dir, [
      thread({ threadId: "outdated", outdated: true }),
      thread({ threadId: "gone", file: "src/missing.ts" }),
      thread({ threadId: "bodyOnly", diffHunk: undefined }),
      thread({ threadId: "noLine", line: undefined }),
    ])

    expect(items.map((item) => item.after)).toEqual([undefined, undefined, undefined, undefined])
  })

  it("rejects a comment path outside the worktree", async () => {
    const dir = await repo()
    await writeFile(path.join(path.dirname(dir), "outside.ts"), SOURCE.join("\n"))
    const [item] = await withContext(dir, [thread({ file: "../outside.ts" })])

    expect(item!.after).toBeUndefined()
  })

  it("keeps every thread, in order, whatever the files say", async () => {
    const dir = await repo()
    const items = await withContext(dir, [thread({ threadId: "a" }), thread({ threadId: "b", outdated: true })])

    expect(items.map((item) => item.threadId)).toEqual(["a", "b"])
  })
})
