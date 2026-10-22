import { describe, expect, it } from "bun:test"
import { parseComments } from "../../src/agent-manager/pr/am-pr-utils"
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
  it.each([
    ["additions", patch],
    ["deletions", patch],
    ["additions", undefined],
  ] as const)("anchors current %s even without a committed preview", (side, source) => {
    const value = comment({ file: diff.file, line: 2, originalLine: 2, side, previewUnavailable: true })
    const result = mapRemoteComments([value], [{ ...diff, patch: source }])
    expect(result.anchors.get(diff.file)?.at(0)).toMatchObject({ side, line: 2 })
    expect(result.outside).toHaveLength(0)
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

  it.each(["additions", "deletions"] as const)("places moved %s at the current line using originalLine", (side) => {
    const moved = {
      ...diff,
      before: "const before = true\nconst inserted = true\nconst removed = true\nconst after = true",
      after: "const before = true\nconst inserted = true\nconst added = false\nconst after = true",
      patch:
        "@@ -1,4 +1,4 @@\n const before = true\n const inserted = true\n-const removed = true\n+const added = false\n const after = true",
    }
    const hunk = side === "additions" ? "@@ -2 +2 @@\n+const added = false" : "@@ -2 +2,0 @@\n-const removed = true"
    const value = comment({ file: diff.file, line: 3, originalLine: 2, side, diffHunk: hunk })
    const result = mapRemoteComments([value], [moved])

    expect(result.anchors.get(diff.file)?.at(0)).toMatchObject({ side, line: 3 })
    expect(result.outside).toHaveLength(0)
  })

  it("infers a legacy deletion only when the hunk identifies one side", () => {
    const result = mapRemoteComments(
      [comment({ file: diff.file, line: 2, diffHunk: "@@ -2 +2 @@\n-const removed = true" })],
      [diff],
    )

    expect(result.anchors.get(diff.file)?.[0]).toMatchObject({ side: "deletions", line: 2 })
  })

  it.each(["additions", "deletions"] as const)("rejects repeated %s text from a different hunk location", (side) => {
    const original = ["function alpha() {", "  return 1", "}"]
    const lines = ["function beta() {", "  return 2", "}", "", ...original]
    const sign = side === "additions" ? "+" : "-"
    const header = side === "additions" ? "@@ -0,0 +1,3 @@" : "@@ -1,3 +0,0 @@"
    const current = side === "additions" ? "@@ -0,0 +1,7 @@" : "@@ -1,7 +0,0 @@"
    const value = comment({
      file: diff.file,
      line: 3,
      originalLine: 3,
      side,
      diffHunk: [header, ...original.map((line) => sign + line)].join("\n"),
    })
    const source = {
      ...diff,
      before: side === "deletions" ? lines.join("\n") : "",
      after: side === "additions" ? lines.join("\n") : "",
      patch: [current, ...lines.map((line) => sign + line)].join("\n"),
    }
    const wrong = mapRemoteComments([value], [source])
    expect(wrong.anchors.size).toBe(0)
    expect(wrong.outside).toEqual([value])

    const moved = mapRemoteComments([{ ...value, line: 7 }], [source])
    expect(moved.anchors.get(diff.file)?.at(0)?.line).toBe(7)
    expect(moved.outside).toEqual([])
  })

  it.each([`${patch.replaceAll("\n", "\r\n")}\r\n`, "@@ -2 +2 @@\n+const added = false"])(
    "matches CRLF source against either hunk newline format",
    (hunk) => {
      const result = mapRemoteComments(
        [comment({ file: diff.file, line: 2, side: "additions", diffHunk: hunk })],
        [{ ...diff, after: `${diff.after.replaceAll("\n", "\r\n")}\r\n` }],
      )
      expect(result.anchors.get(diff.file)?.at(0)?.line).toBe(2)
      expect(result.outside).toEqual([])
    },
  )

  it("validates only the original hunk containing the comment", () => {
    const hunk =
      "@@ -1 +1 @@\n-old first\n+first\n@@ -5,3 +5,3 @@\n const before = true\n-const removed = true\n+const added = false\n const after = true"
    const value = comment({ file: diff.file, line: 6, side: "additions", diffHunk: hunk })
    const result = mapRemoteComments(
      [value],
      [{ ...diff, patch: undefined, after: `changed first\n\n\n\n${diff.after}` }],
    )
    expect(result.anchors.get(diff.file)?.at(0)?.line).toBe(6)
    expect(result.outside).toEqual([])
  })

  it("shows failed detail loads outside until a successful retry", () => {
    const value = comment({ file: diff.file, line: 2, side: "additions" })
    const result = mapRemoteComments([value], [{ ...diff, summarized: true, failed: true }])
    expect(result.pending.size).toBe(0)
    expect(result.outside).toEqual([value])
    expect(remoteLocation(result, diff.file, value.threadId)).toBe("outside")

    const recovered = mapRemoteComments([value], [diff])
    expect(recovered.outside).toEqual([])
    expect(remoteLocation(recovered, diff.file, value.threadId)).toBe("inline")
  })

  it("keeps summarized-file threads pending until detail is available", () => {
    const comments = [
      comment({ file: diff.file, line: 2, side: "additions", previewUnavailable: true }),
      comment({ threadId: "range", file: diff.file, startLine: 2, side: "additions" }),
    ]
    const pending = mapRemoteComments(comments, [
      { ...diff, before: "", after: "", patch: undefined, summarized: true },
    ])

    expect(pending.anchors.size).toBe(0)
    expect(pending.outside).toEqual([])
    expect(pending.pending.get(diff.file)).toEqual(comments)
    expect(remoteLocation(pending, diff.file, "thread")).toBe("pending")
    expect(remoteLocation(pending, diff.file, "range")).toBe("pending")

    const loaded = mapRemoteComments(comments, [diff])
    expect(loaded.pending.size).toBe(0)
    expect(loaded.outside).toEqual([])
    expect(remoteLocation(loaded, diff.file, "thread")).toBe("inline")

    const stale = mapRemoteComments(comments, [{ ...diff, after: "changed" }])
    expect(stale.pending.size).toBe(0)
    expect(stale.outside).toEqual(comments)
    expect(remoteLocation(stale, diff.file, "thread")).toBe("outside")
  })

  it.each([false, true])("keeps unplaced threads outside with summarized=%s", (summarized) => {
    const comments = [
      ...parseComments([
        {
          id: "original-only",
          path: diff.file,
          diffSide: "RIGHT",
          line: null,
          originalLine: 2,
          isOutdated: false,
          comments: { nodes: [{ id: "original-comment" }] },
        },
      ]),
      comment({ threadId: "outdated", file: diff.file, line: 2, outdated: true }),
      comment({ threadId: "line-less", file: diff.file }),
      comment({ threadId: "invalid", file: diff.file, line: 0 }),
      comment({ threadId: "image", file: "image.png", line: 2 }),
      comment({ threadId: "missing", file: "gone.ts", line: 2 }),
    ]
    const result = mapRemoteComments(comments, [
      { ...diff, summarized },
      { ...diff, file: "image.png", kind: "image", summarized },
    ])

    expect(result.anchors.size).toBe(0)
    expect(result.pending.size).toBe(0)
    expect(result.outside).toEqual(comments)
  })

  it("does not anchor text found elsewhere in the original hunk", () => {
    const hunk = "@@ -0,0 +1,2 @@\n+const added = false\n+different"
    const value = comment({ file: diff.file, line: 2, side: "additions", diffHunk: hunk })
    const result = mapRemoteComments([value], [diff])
    expect(result.anchors.size).toBe(0)
    expect(result.outside).toHaveLength(1)
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
