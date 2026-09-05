import { describe, expect, it } from "bun:test"
import { diffSizeKey, mergeWorktreeDiffs, resolveDiffFile } from "../../webview-ui/diff-viewer/diff-state"
import {
  EXTREME_DIFF_CHANGED_LINES,
  allOpenFiles,
  expandableOpenFiles,
  initialOpenFiles,
  isDiffExpandable,
  reconcileOpenFiles,
  sanitizeOpenFiles,
  shouldVirtualizeDiff,
  toggleOpenFiles,
} from "../../webview-ui/diff-viewer/diff-open-policy"
import type { WorktreeFileDiff } from "../../webview-ui/src/types/messages"

function diff(overrides: Partial<WorktreeFileDiff>): WorktreeFileDiff {
  return {
    file: "src/app.ts",
    before: "",
    after: "",
    additions: 1,
    deletions: 0,
    status: "modified",
    tracked: true,
    generatedLike: false,
    summarized: true,
    stamp: "1:1",
    ...overrides,
  }
}

describe("diffSizeKey", () => {
  it("changes with rendered content, style, and review context", () => {
    const base = diff({ summarized: false, patch: "@@ -1 +1 @@\n-old\n+new\n" })
    const key = diffSizeKey("review-a", base, "unified")

    expect(diffSizeKey("review-a", base, "unified")).toBe(key)
    expect(diffSizeKey("review-b", base, "unified")).not.toBe(key)
    expect(diffSizeKey("review-a", base, "split")).not.toBe(key)
    expect(diffSizeKey("review-a", { ...base, patch: "@@ -1 +1 @@\n-old\n+newer\n" }, "unified")).not.toBe(key)
  })
})

describe("agent manager diff state", () => {
  it.each([undefined, null, diff({})])("marks unavailable detail as failed: %j", (detail) => {
    const pending = diff({})
    const other = diff({ file: "other.ts" })
    const result = resolveDiffFile([pending, other], pending.file, detail)

    expect(result.at(0)).toEqual({ ...pending, failed: true })
    expect(result.at(1)).toBe(other)
    expect(pending.failed).toBeUndefined()
  })

  it("retains failures across unchanged summaries and clears them on successful detail", () => {
    const failed = diff({ failed: true, patch: "" })
    const polled = mergeWorktreeDiffs([failed], [diff({})])
    expect(polled.diffs.at(0)).toBe(failed)
    expect(polled.stale.size).toBe(0)

    const detail = diff({ before: "old", after: "new", summarized: false })
    const loaded = resolveDiffFile(polled.diffs, failed.file, detail)
    expect(loaded.at(0)).toBe(detail)
    expect(loaded.at(0)?.failed).toBeUndefined()
    expect(mergeWorktreeDiffs(loaded, [diff({})]).diffs.at(0)).toBe(detail)
  })

  it("allows fresh content after a failed summary changes without dropping loaded detail on failure", () => {
    const next = diff({ stamp: "1:2" })
    expect(mergeWorktreeDiffs([diff({ failed: true })], [next]).diffs.at(0)).toBe(next)

    const loaded = diff({ summarized: false, before: "old", after: "new" })
    expect(resolveDiffFile([loaded], loaded.file, null).at(0)).toBe(loaded)
  })

  it("preserves loaded detail and patch when summary metadata is unchanged", () => {
    const prev = [diff({ summarized: false, before: "old\n", after: "new\n", patch: "@@ -1 +1 @@\n-old\n+new\n" })]
    const next = [diff({ summarized: true })]
    const result = mergeWorktreeDiffs(prev, next)

    expect(result.diffs).toEqual([
      diff({ summarized: false, before: "old\n", after: "new\n", patch: "@@ -1 +1 @@\n-old\n+new\n" }),
    ])
    expect(result.diffs[0]).toBe(prev[0])
    expect(result.stale.size).toBe(0)
  })

  it("preserves loaded image data when summary metadata is unchanged", () => {
    const image = {
      before: { mime: "image/png", bytes: 3, data: "b2xk" },
      after: { mime: "image/png", bytes: 3, data: "bmV3" },
    }
    const prev = [diff({ file: "asset.png", kind: "image", summarized: false, image })]
    const next = [diff({ file: "asset.png", kind: "image", summarized: true })]
    const result = mergeWorktreeDiffs(prev, next)

    expect(result.diffs[0]).toBe(prev[0])
    expect(result.diffs[0]?.image).toBe(image)
    expect(result.stale.size).toBe(0)
  })

  it("replaces detailed content when patch anchors change", () => {
    const prev = [diff({ summarized: false, before: "old\n", after: "new\n", patch: "@@ -1 +1 @@\n-old\n+new\n" })]
    const next = [diff({ summarized: false, before: "old\n", after: "new\n", patch: "@@ -100 +100 @@\n-old\n+new\n" })]
    const result = mergeWorktreeDiffs(prev, next)

    expect(result.diffs[0]).toBe(next[0])
    expect(result.diffs[0]?.patch).toContain("@@ -100 +100 @@")
  })

  it("preserves cached content and marks stale when summary metadata changes", () => {
    const prev = [diff({ summarized: false, before: "old\n", after: "new\n", additions: 1 })]
    const next = [diff({ summarized: true, additions: 2 })]
    const result = mergeWorktreeDiffs(prev, next)

    expect(result.diffs[0]).toBe(prev[0])
    expect(result.stale).toEqual(new Set(["src/app.ts"]))
  })

  it("preserves cached content and marks stale when summary stamp changes", () => {
    const prev = [diff({ summarized: false, before: "old\n", after: "new\n", stamp: "1:1" })]
    const next = [diff({ summarized: true, stamp: "1:2" })]
    const result = mergeWorktreeDiffs(prev, next)

    expect(result.diffs[0]).toBe(prev[0])
    expect(result.stale).toEqual(new Set(["src/app.ts"]))
  })

  it("opens every diff initially", () => {
    expect(
      initialOpenFiles([
        diff({ file: "src/app.ts", generatedLike: false, additions: 3 }),
        diff({ file: "node_modules/pkg/index.js", generatedLike: true, additions: 3 }),
        diff({ file: "audio/notification.wav", summarized: false, additions: 0 }),
        diff({ file: "assets/banner.png", kind: "image", summarized: true, additions: 0 }),
        diff({ file: "src/huge.ts", additions: EXTREME_DIFF_CHANGED_LINES + 1 }),
      ]),
    ).toEqual(["src/app.ts", "node_modules/pkg/index.js", "src/huge.ts"])

    const many = Array.from({ length: 26 }, (_, i) => diff({ file: `src/${i}.ts` }))
    expect(initialOpenFiles(many)).toHaveLength(26)
  })

  it("keeps generated and large files in the expanded review", () => {
    expect(
      expandableOpenFiles([
        diff({ file: "src/app.ts", generatedLike: false, additions: 3 }),
        diff({ file: "src/generated.ts", generatedLike: true, additions: 3 }),
        diff({ file: "assets/archive.zip", summarized: false, additions: 0 }),
        diff({ file: "src/huge.ts", additions: EXTREME_DIFF_CHANGED_LINES + 1 }),
      ]),
    ).toEqual(["src/app.ts", "src/generated.ts", "src/huge.ts"])
  })

  it("toggles all files based on whether every file is open", () => {
    const diffs = [
      diff({ file: "src/app.ts" }),
      diff({ file: "src/panel.ts" }),
      diff({ file: "src/generated.ts", generatedLike: true }),
      diff({ file: "audio/alert.mp3", summarized: false, additions: 0 }),
      diff({ file: "src/huge.ts", additions: EXTREME_DIFF_CHANGED_LINES + 1 }),
    ]

    expect(allOpenFiles(diffs, [])).toBe(false)
    expect(allOpenFiles(diffs, ["stale.ts"])).toBe(false)
    expect(allOpenFiles(diffs, ["src/app.ts"])).toBe(false)
    expect(allOpenFiles(diffs, ["src/app.ts", "src/panel.ts"])).toBe(false)
    expect(allOpenFiles(diffs, ["stale.ts", "src/app.ts", "src/panel.ts", "src/generated.ts"])).toBe(false)
    expect(
      allOpenFiles(
        diffs,
        diffs.map((item) => item.file),
      ),
    ).toBe(true)

    const files = expandableOpenFiles(diffs)
    expect(toggleOpenFiles(diffs, [])).toEqual(files)
    expect(toggleOpenFiles(diffs, ["stale.ts"])).toEqual(files)
    expect(toggleOpenFiles(diffs, ["src/app.ts"])).toEqual(files)
    expect(toggleOpenFiles(diffs, files)).toEqual([])
  })

  it("opens newly arriving files while preserving a manual collapse", () => {
    const current = [diff({ file: "src/app.ts" }), diff({ file: "src/new.ts" })]
    expect(reconcileOpenFiles(current, ["src/app.ts"], ["src/app.ts"])).toEqual({
      open: ["src/app.ts", "src/new.ts"],
      known: ["src/app.ts", "src/new.ts"],
    })
  })

  it("does not initialize a manual empty snapshot until the first state exists", () => {
    const current = [diff({ file: "src/app.ts" })]
    expect(reconcileOpenFiles(current, undefined, [])).toEqual({ open: undefined, known: ["src/app.ts"] })
    expect(reconcileOpenFiles(current, [], ["src/app.ts"])).toEqual({ open: [], known: ["src/app.ts"] })
  })

  it("opens images while preventing other non-text diffs from entering open state", () => {
    const audio = diff({ file: "audio/alert.wav", summarized: false, additions: 0 })
    const image = diff({ file: "assets/banner.png", kind: "image", summarized: true, additions: 0 })
    const text = diff({ file: "src/app.ts" })

    expect(isDiffExpandable(audio)).toBe(false)
    expect(isDiffExpandable(image)).toBe(true)
    expect(isDiffExpandable(text)).toBe(true)
    expect(sanitizeOpenFiles([audio, image, text], [audio.file, image.file, text.file])).toEqual([
      image.file,
      text.file,
    ])
  })
})

describe("diff line virtualization", () => {
  it("renders normal hunk patches directly inside virtual file rows", () => {
    expect(
      shouldVirtualizeDiff(diff({ file: "src/a.ts", patch: "@@ -1 +1 @@\n-a\n+b\n", additions: 10, deletions: 5 })),
    ).toBe(false)
  })

  it("virtualizes full-content and extreme individual files", () => {
    expect(
      shouldVirtualizeDiff(diff({ file: "src/source.ts", before: "a\n".repeat(4000), after: "b\n", additions: 1 })),
    ).toBe(true)
    expect(
      shouldVirtualizeDiff(
        diff({ file: "src/big.ts", patch: "large", additions: EXTREME_DIFF_CHANGED_LINES + 1, deletions: 0 }),
      ),
    ).toBe(true)
  })

  it("virtualizes small patches when either source file exceeds the eager byte limit", () => {
    const patch = "@@ -1 +1 @@\n-old\n+new\n"
    expect(shouldVirtualizeDiff(diff({ patch, before: "x".repeat(256 * 1024 + 1), after: "new\n" }))).toBe(true)
    expect(shouldVirtualizeDiff(diff({ patch, before: "old\n", after: "x".repeat(256 * 1024 + 1) }))).toBe(true)
    expect(shouldVirtualizeDiff(diff({ patch, before: "x".repeat(256 * 1024), after: "new\n" }))).toBe(false)
  })
})
