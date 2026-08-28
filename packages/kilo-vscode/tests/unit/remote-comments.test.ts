import { describe, expect, it } from "bun:test"
import { mapRemoteComments, remoteLocation } from "../../webview-ui/diff-viewer/remote-comments"
import type { PRComment } from "../../webview-ui/agent-manager/pr/pr-types"
import type { WorktreeFileDiff } from "../../webview-ui/src/types/messages"

const patch = [
  "diff --git a/src/app.ts b/src/app.ts",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,3 +1,3 @@",
  " const before = true",
  "-const removed = true",
  "+const added = false",
  " const after = true",
].join("\n")

const diff: WorktreeFileDiff = {
  file: "src/app.ts",
  before: "const before = true\nconst removed = true\nconst after = true",
  after: "const before = true\nconst added = false\nconst after = true",
  patch,
  additions: 1,
  deletions: 1,
}

function comment(overrides: Partial<PRComment> = {}): PRComment {
  return {
    id: "comment",
    threadId: "thread",
    author: "reviewer",
    body: "Review this",
    resolved: false,
    outdated: false,
    ...overrides,
  }
}

describe("remote diff comments", () => {
  it("anchors explicit additions to current patch text", () => {
    const result = mapRemoteComments([comment({ file: diff.file, line: 2, side: "additions" })], [diff])

    expect(result.anchors.get(diff.file)?.[0]).toMatchObject({ side: "additions", line: 2 })
    expect(result.outside).toHaveLength(0)
  })

  it("anchors explicit locations without patch metadata when the current line exists", () => {
    const result = mapRemoteComments(
      [comment({ file: diff.file, line: 2, side: "additions" })],
      [{ ...diff, patch: undefined }],
    )

    expect(result.anchors.get(diff.file)?.[0]).toMatchObject({ side: "additions", line: 2 })
  })

  it("anchors a multi-line addition at the end of its current range", () => {
    const value: WorktreeFileDiff = {
      ...diff,
      after: "const before = true\nconst first = false\nconst second = false\nconst after = true",
      patch: [
        "@@ -1,3 +1,4 @@",
        " const before = true",
        "+const first = false",
        "+const second = false",
        " const after = true",
      ].join("\n"),
    }
    const result = mapRemoteComments([comment({ file: value.file, line: 3, startLine: 2, side: "additions" })], [value])

    expect(result.anchors.get(value.file)?.[0]).toMatchObject({ side: "additions", line: 3 })
  })

  it("uses originalLine to validate moved text while placing at the current line", () => {
    const moved: WorktreeFileDiff = {
      ...diff,
      after: "const before = true\nconst inserted = true\nconst added = false\nconst after = true",
      patch: [
        "@@ -1,3 +1,4 @@",
        " const before = true",
        "+const inserted = true",
        "+const added = false",
        " const after = true",
      ].join("\n"),
    }
    const result = mapRemoteComments(
      [
        comment({
          file: moved.file,
          line: 3,
          originalLine: 2,
          side: "additions",
          diffHunk: "@@ -2 +2 @@\n+const added = false",
        }),
      ],
      [moved],
    )

    expect(result.anchors.get(moved.file)?.[0]).toMatchObject({ side: "additions", line: 3 })
    expect(result.outside).toHaveLength(0)
  })

  it("uses originalLine for explicit deletions and never treats it as an addition", () => {
    const result = mapRemoteComments(
      [comment({ file: diff.file, line: 2, originalLine: 2, side: "deletions" })],
      [diff],
    )

    expect(result.anchors.get(diff.file)?.[0]).toMatchObject({ side: "deletions", line: 2 })
  })

  it("uses the current deletion line and validates the original hunk location", () => {
    const moved = {
      ...diff,
      before: "const before = true\nconst inserted = true\nconst removed = true\nconst after = true",
      after: "const before = true\nconst inserted = true\nconst after = true",
      patch:
        "@@ -1,4 +1,3 @@\n const before = true\n const inserted = true\n-const removed = true\n const after = true",
    }
    const result = mapRemoteComments(
      [
        comment({
          file: diff.file,
          line: 3,
          originalLine: 2,
          side: "deletions",
          diffHunk: "@@ -2 +2,0 @@\n-const removed = true",
        }),
      ],
      [moved],
    )

    expect(result.anchors.get(diff.file)?.[0]).toMatchObject({ side: "deletions", line: 3 })
  })

  it("infers a legacy deletion only when the hunk identifies one side", () => {
    const result = mapRemoteComments(
      [comment({ file: diff.file, line: 2, diffHunk: "@@ -2 +2 @@\n-const removed = true" })],
      [diff],
    )

    expect(result.anchors.get(diff.file)?.[0]).toMatchObject({ side: "deletions", line: 2 })
  })

  it("puts stale, outdated, line-less, summarized, and missing comments outside", () => {
    const result = mapRemoteComments(
      [
        comment({ threadId: "stale", file: diff.file, line: 2, side: "additions" }),
        comment({ threadId: "outdated", file: diff.file, line: 2, side: "additions", outdated: true }),
        comment({ threadId: "line-less", file: diff.file }),
        comment({ threadId: "missing", file: "gone.ts", line: 1, side: "additions" }),
      ],
      [
        { ...diff, after: "const before = true\nconst changed = true\nconst after = true" },
        { ...diff, file: "hidden.ts", summarized: true },
      ],
    )

    expect(result.anchors.size).toBe(0)
    expect(result.outside.map((item) => item.threadId)).toEqual(["stale", "outdated", "line-less", "missing"])
    expect(remoteLocation(result, diff.file, "outdated")).toBe("outside")
  })

  it("does not anchor text found elsewhere in the original hunk", () => {
    const result = mapRemoteComments(
      [
        comment({
          file: diff.file,
          line: 2,
          side: "additions",
          diffHunk: "@@ -0,0 +1,2 @@\n+const added = false\n+different",
        }),
      ],
      [diff],
    )
    expect(result.anchors.size).toBe(0)
    expect(result.outside).toHaveLength(1)
  })

  it("matches CRLF files against normalized GitHub hunks", () => {
    const result = mapRemoteComments(
      [comment({ file: diff.file, line: 2, side: "additions", diffHunk: "@@ -2 +2 @@\n+const added = false" })],
      [{ ...diff, after: `${diff.after.replaceAll("\n", "\r\n")}\r\n` }],
    )
    expect(result.anchors.get(diff.file)?.[0]?.line).toBe(2)
  })

  it("does not treat a trailing newline as an extra source line", () => {
    const result = mapRemoteComments(
      [comment({ file: diff.file, line: 4, side: "additions" })],
      [{ ...diff, patch: undefined, after: `${diff.after}\n` }],
    )
    expect(result.anchors.size).toBe(0)
    expect(result.outside).toHaveLength(1)
  })

  it("reuses source indexes across unordered threads and refreshes them when content changes", () => {
    const reads = { before: 0, after: 0 }
    let after = diff.after
    const source = {
      ...diff,
      get before() {
        reads.before += 1
        return diff.before
      },
      get after() {
        reads.after += 1
        return after
      },
    }
    const comments = [3, 1, 2, 3].flatMap((line, index) =>
      (["additions", "deletions"] as const).map((side) =>
        comment({ threadId: `${side}-${index}`, file: diff.file, line, side }),
      ),
    )
    const first = mapRemoteComments(comments, [source])
    expect(first.anchors.get(diff.file)).toHaveLength(6)
    expect(first.outside).toHaveLength(0)
    expect(reads).toEqual({ before: 1, after: 1 })

    after = after.replace("const added = false", "const changed = true")
    const next = mapRemoteComments(comments, [source])
    expect(next.outside.map((item) => item.threadId)).toEqual(["additions-2"])
    expect(reads).toEqual({ before: 2, after: 2 })
  })

  it("groups threads that share a safe side and line", () => {
    const result = mapRemoteComments(
      [
        comment({ threadId: "first", file: diff.file, line: 2, side: "additions" }),
        comment({ threadId: "second", file: diff.file, line: 2, side: "additions" }),
      ],
      [diff],
    )

    expect(result.anchors.get(diff.file)).toHaveLength(1)
    expect(result.anchors.get(diff.file)?.[0]?.comments.map((item) => item.threadId)).toEqual(["first", "second"])
  })
})
