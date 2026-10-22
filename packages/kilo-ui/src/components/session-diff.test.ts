import { describe, expect, test } from "bun:test"
import { normalize, normalizeHunk, text } from "./session-diff"

describe("session diff", () => {
  test("keeps unified patch content", () => {
    const diff = {
      file: "a.ts",
      patch:
        "Index: a.ts\n===================================================================\n--- a.ts\t\n+++ a.ts\t\n@@ -1,2 +1,2 @@\n one\n-two\n+three\n",
      additions: 1,
      deletions: 1,
      status: "modified" as const,
    }
    const view = normalize(diff)

    expect(view.patch).toBe(diff.patch)
    expect(view.fileDiff.name).toBe("a.ts")
    expect(text(view, "deletions")).toBe("one\ntwo\n")
    expect(text(view, "additions")).toBe("one\nthree\n")
  })

  test("converts legacy content into a patch", () => {
    const diff = {
      file: "a.ts",
      before: "one\n",
      after: "two\n",
      additions: 1,
      deletions: 1,
      status: "modified" as const,
    }
    const view = normalize(diff)

    expect(view.patch).toContain("@@ -1,1 +1,1 @@")
    expect(text(view, "deletions")).toBe("one\n")
    expect(text(view, "additions")).toBe("two\n")
  })

  test("handles legacy snapshots without a file path", () => {
    const view = normalize({ additions: 0, deletions: 0 })

    expect(view.file).toBe("")
    expect(text(view, "deletions")).toBe("")
    expect(text(view, "additions")).toBe("")
  })

  test("preserves real line numbers from hunk headers without padding", () => {
    const diff = {
      file: "a.ts",
      patch:
        "Index: a.ts\n===================================================================\n--- a.ts\t\n+++ a.ts\t\n@@ -340,2 +340,2 @@\n one\n-two\n+three\n",
      additions: 1,
      deletions: 1,
      status: "modified" as const,
    }
    const view = normalize(diff)

    expect(view.fileDiff.hunks[0]?.deletionStart).toBe(340)
    expect(view.fileDiff.hunks[0]?.additionStart).toBe(340)
    expect(view.fileDiff.isPartial).toBe(true)
    // No blank-line padding: only the hunk lines are materialized.
    expect(view.fileDiff.deletionLines.length).toBe(2)
    expect(view.fileDiff.additionLines.length).toBe(2)
  })

  test("normalizes GitHub hunk-only patches for Pierre", () => {
    const view = normalizeHunk("src/foo.ts", "@@ -340,2 +340,2 @@\n one\n-two\n+three\n")

    expect(view?.patch).toBe("--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -340,2 +340,2 @@\n one\n-two\n+three\n")
    expect(view?.fileDiff.hunks[0]?.deletionStart).toBe(340)
    expect(view?.fileDiff.hunks[0]?.additionStart).toBe(340)
  })

  test("rejects an empty or malformed GitHub hunk", () => {
    expect(normalizeHunk("src/foo.ts", "")).toBeUndefined()
    expect(normalizeHunk("src/foo.ts", "not a diff")).toBeUndefined()
  })

  test("renders a real GitHub hunk with blank lines", () => {
    const view = normalizeHunk(
      "packages/kilo-ui/src/components/file.tsx",
      '@@ -1 +1,14 @@\n+import { File as BaseFile, type FileProps } from "@opencode-ai/ui/file"\n+import type { JSX } from "solid-js"\n+import { createDefaultOptions } from "../pierre"\n+\n export * from "@opencode-ai/ui/file"\n+\n+export function File<T>(props: FileProps<T>) {\n+  const View = BaseFile as unknown as (props: FileProps<T>) => JSX.Element\n+  if (props.mode === "text") return <View {...props} />\n+\n+  // Keep inline file diffs on the same Pierre defaults as the dedicated viewer.\n+  const options = { ...createDefaultOptions<T>(props.diffStyle), ...props } as FileProps<T>\n',
    )

    expect(view?.fileDiff.hunks).toHaveLength(1)
    expect(view?.fileDiff.hunks[0]?.additionStart).toBe(1)
  })
})
