import { describe, it, expect } from "bun:test"
import {
  AT_PATTERN,
  syncMentionedPaths,
  buildTextAfterMentionSelect,
  buildFileAttachments,
  buildMentionResults,
  filterMentionResults,
  getMentionRemovalRange,
  isCursorAtMentionEnd,
  findMentionRange,
} from "../../webview-ui/src/hooks/file-mention-utils"

describe("AT_PATTERN", () => {
  it("matches @mention at start of string", () => {
    expect(AT_PATTERN.test("@foo")).toBe(true)
  })

  it("matches @mention after whitespace", () => {
    expect(AT_PATTERN.test("hello @foo")).toBe(true)
  })

  it("does not match @mention in middle of word", () => {
    expect(AT_PATTERN.test("hello@foo")).toBe(false)
  })

  it("captures the path after @", () => {
    const match = "hello @path/to/file.ts".match(AT_PATTERN)
    expect(match?.[1]).toBe("path/to/file.ts")
  })

  it("matches empty @", () => {
    expect(AT_PATTERN.test("@")).toBe(true)
  })
})

describe("buildMentionResults", () => {
  it("includes special mentions for empty mention query", () => {
    const result = buildMentionResults("", [])
    expect(result[0]).toEqual({
      type: "terminal",
      value: "terminal",
      label: "Terminal",
      description: "Active terminal output",
    })
    expect(result[1]).toEqual({
      type: "git-changes",
      value: "git-changes",
      label: "Git changes",
      description: "Current session/worktree changes",
    })
  })

  it("includes terminal for matching prefix", () => {
    const result = buildMentionResults("term", ["src/terminal.ts"])
    expect(result.map((item) => item.type)).toEqual(["terminal", "file"])
  })

  it("includes git changes for matching prefix", () => {
    const result = buildMentionResults("git", ["src/git.ts"])
    expect(result.map((item) => item.type)).toEqual(["git-changes", "file"])
  })

  it("omits special mentions for unrelated query", () => {
    const result = buildMentionResults("src", ["src/index.ts"])
    expect(result.map((item) => item.type)).toEqual(["file"])
  })

  it("omits git changes when git is unavailable", () => {
    const result = buildMentionResults("git", ["src/git.ts"], false)
    expect(result.map((item) => item.type)).toEqual(["file"])
  })

  it("includes folder results", () => {
    const result = buildMentionResults("src", [{ path: "src", type: "folder" }])
    expect(result).toEqual([{ type: "folder", value: "src" }])
  })

  it("preserves opened file result type", () => {
    const result = buildMentionResults("src", [{ path: "src/index.ts", type: "opened-file" }])
    expect(result).toEqual([{ type: "opened-file", value: "src/index.ts" }])
  })
})

describe("filterMentionResults", () => {
  it("keeps matching file results for the latest query", () => {
    const result = filterMentionResults("gi", [
      { type: "file", value: "README.md" },
      { type: "file", value: "src/git.ts" },
    ])
    expect(result).toEqual([{ type: "file", value: "src/git.ts" }])
  })
})

describe("syncMentionedPaths", () => {
  it("keeps paths still referenced in text", () => {
    const paths = new Set(["foo.ts", "bar.ts"])
    const result = syncMentionedPaths(paths, "see @foo.ts for details")
    expect(result.has("foo.ts")).toBe(true)
    expect(result.has("bar.ts")).toBe(false)
  })

  it("returns empty set when text has no @references", () => {
    const paths = new Set(["foo.ts"])
    const result = syncMentionedPaths(paths, "no references here")
    expect(result.size).toBe(0)
  })

  it("keeps multiple paths that are all referenced", () => {
    const paths = new Set(["a.ts", "b.ts"])
    const result = syncMentionedPaths(paths, "@a.ts and @b.ts are both here")
    expect(result.size).toBe(2)
  })

  it("does not mutate the original set", () => {
    const paths = new Set(["foo.ts"])
    syncMentionedPaths(paths, "no references")
    expect(paths.has("foo.ts")).toBe(true)
  })

  it("does not false-match when a shorter path is prefix of a longer one", () => {
    const paths = new Set(["src/a.ts", "src/a.tsx"])
    const result = syncMentionedPaths(paths, "@src/a.tsx only")
    expect(result.has("src/a.tsx")).toBe(true)
    expect(result.has("src/a.ts")).toBe(false)
  })

  it("matches @path at end of text (no trailing space)", () => {
    const paths = new Set(["foo.ts"])
    const result = syncMentionedPaths(paths, "check @foo.ts")
    expect(result.has("foo.ts")).toBe(true)
  })

  it("matches @path at start of text", () => {
    const paths = new Set(["foo.ts"])
    const result = syncMentionedPaths(paths, "@foo.ts is important")
    expect(result.has("foo.ts")).toBe(true)
  })
})

describe("buildTextAfterMentionSelect", () => {
  it("replaces @mention with selected path", () => {
    const before = "hello @par"
    const after = " world"
    const result = buildTextAfterMentionSelect(before, after, "src/component.ts")
    expect(result).toBe("hello @src/component.ts world")
  })

  it("handles @mention at start of string and appends trailing space", () => {
    const result = buildTextAfterMentionSelect("@par", "", "foo.ts")
    expect(result).toBe("@foo.ts ")
  })

  it("preserves space prefix before @mention and appends trailing space", () => {
    const result = buildTextAfterMentionSelect("text @par", "", "foo.ts")
    expect(result).toBe("text @foo.ts ")
  })

  it("appends suffix after replacement", () => {
    const result = buildTextAfterMentionSelect("before @q", " after text", "file.ts")
    expect(result).toContain("after text")
  })

  it("appends a trailing space when there is no text after the cursor", () => {
    const result = buildTextAfterMentionSelect("hello @par", "", "src/foo.ts")
    expect(result).toBe("hello @src/foo.ts ")
  })

  it("appends a trailing space when the next char is not whitespace", () => {
    const result = buildTextAfterMentionSelect("hello @par", "tail", "src/foo.ts")
    expect(result).toBe("hello @src/foo.ts tail")
  })

  it("does not double-space when a space already follows the cursor", () => {
    const result = buildTextAfterMentionSelect("hello @par", " tail", "src/foo.ts")
    expect(result).toBe("hello @src/foo.ts tail")
  })

  it("does not add a space when a newline follows the cursor", () => {
    const result = buildTextAfterMentionSelect("hello @par", "\nnext line", "src/foo.ts")
    expect(result).toBe("hello @src/foo.ts\nnext line")
  })

  it("does not add a space when a tab follows the cursor", () => {
    const result = buildTextAfterMentionSelect("hello @par", "\tnext", "src/foo.ts")
    expect(result).toBe("hello @src/foo.ts\tnext")
  })

  it("works consistently for special mention tokens (terminal)", () => {
    const result = buildTextAfterMentionSelect("hello @term", "", "terminal")
    expect(result).toBe("hello @terminal ")
  })

  it("works consistently for special mention tokens (git-changes)", () => {
    const result = buildTextAfterMentionSelect("hello @git", "", "git-changes")
    expect(result).toBe("hello @git-changes ")
  })

  it("places inserted space before the original suffix so cursor lands naturally", () => {
    // selectMention computes cursor position as text.length - after.length,
    // which places the cursor at the start of the original `after` segment.
    // Verify that an inserted space lives between the path and the cursor.
    const before = "hello @par"
    const after = "tail"
    const result = buildTextAfterMentionSelect(before, after, "foo.ts")
    const cursor = result.length - after.length
    expect(result.slice(cursor - 1, cursor)).toBe(" ")
    expect(result.slice(cursor)).toBe("tail")
  })
})

describe("buildFileAttachments", () => {
  it("returns empty array for empty paths set", () => {
    expect(buildFileAttachments("hello @foo.ts", new Set(), "/workspace")).toEqual([])
  })

  it("returns attachment for mentioned path", () => {
    const paths = new Set(["src/foo.ts"])
    const result = buildFileAttachments("check @src/foo.ts", paths, "/workspace")
    expect(result).toHaveLength(1)
    expect(result[0]!.mime).toBe("text/plain")
    expect(result[0]!.url).toContain("file://")
    expect(result[0]!.url).toContain("src/foo.ts")
  })

  it("skips paths not in text", () => {
    const paths = new Set(["foo.ts", "bar.ts"])
    const result = buildFileAttachments("only @foo.ts here", paths, "/workspace")
    expect(result).toHaveLength(1)
    expect(result[0]!.url).toContain("foo.ts")
  })

  it("handles absolute paths directly", () => {
    const paths = new Set(["/abs/path/file.ts"])
    const result = buildFileAttachments("@/abs/path/file.ts", paths, "/workspace")
    expect(result).toHaveLength(1)
    expect(result[0]!.url).toContain("/abs/path/file.ts")
  })

  it("normalizes Windows backslashes in workspaceDir", () => {
    const paths = new Set(["foo.ts"])
    const result = buildFileAttachments("@foo.ts", paths, "C:\\Users\\workspace")
    expect(result[0]!.url).not.toContain("\\")
  })
})

describe("getMentionRemovalRange", () => {
  it("returns range for a file path mention ending at position", () => {
    const text = "see @foo.ts for details"
    const paths = new Set(["foo.ts"])
    // position = 11 → text.slice(0, 11) = "see @foo.ts"
    const result = getMentionRemovalRange(text, 11, paths)
    expect(result).toEqual({ start: 4, end: 12 })
  })

  it("includes trailing whitespace in the range", () => {
    const text = "check @src/bar.ts rest"
    const paths = new Set(["src/bar.ts"])
    // position = 17 → slice(0,17) = "check @src/bar.ts", slice(17) = " rest"
    const result = getMentionRemovalRange(text, 17, paths)
    expect(result).toEqual({ start: 6, end: 18 })
  })

  it("does not include trailing non-space character", () => {
    const text = "@foo.tsmore"
    const paths = new Set(["foo.ts"])
    const result = getMentionRemovalRange(text, 7, paths)
    expect(result).toEqual({ start: 0, end: 7 })
  })

  it("returns null when no mention ends at position", () => {
    const text = "no mention here"
    const paths = new Set(["foo.ts"])
    expect(getMentionRemovalRange(text, 5, paths)).toBeNull()
  })

  it("matches terminal builtin mention", () => {
    const text = "see @terminal output"
    const result = getMentionRemovalRange(text, 13, new Set())
    expect(result).toEqual({ start: 4, end: 14 })
  })

  it("matches git-changes builtin mention", () => {
    const text = "see @git-changes here"
    const result = getMentionRemovalRange(text, 16, new Set())
    expect(result).toEqual({ start: 4, end: 17 })
  })

  it("prefers the longest matching path", () => {
    const text = "see @src/a.tsx end"
    const paths = new Set(["src/a.ts", "src/a.tsx"])
    const result = getMentionRemovalRange(text, 14, paths)
    expect(result).toEqual({ start: 4, end: 15 })
  })

  it("handles mention at end of text with no trailing space", () => {
    const text = "check @foo.ts"
    const paths = new Set(["foo.ts"])
    const result = getMentionRemovalRange(text, 13, paths)
    expect(result).toEqual({ start: 6, end: 13 })
  })
})

describe("isCursorAtMentionEnd", () => {
  it("returns true when cursor is at end of a file mention", () => {
    const text = "see @foo.ts rest"
    const paths = new Set(["foo.ts"])
    expect(isCursorAtMentionEnd(text, 11, paths)).toBe(true)
  })

  it("returns false when cursor is not at a mention boundary", () => {
    const text = "see @foo.ts rest"
    const paths = new Set(["foo.ts"])
    expect(isCursorAtMentionEnd(text, 8, paths)).toBe(false)
  })

  it("returns false for empty paths and no builtin match", () => {
    expect(isCursorAtMentionEnd("hello", 3, new Set())).toBe(false)
  })

  it("matches terminal builtin", () => {
    expect(isCursorAtMentionEnd("@terminal", 9, new Set())).toBe(true)
  })

  it("matches git-changes builtin", () => {
    expect(isCursorAtMentionEnd("@git-changes", 12, new Set())).toBe(true)
  })

  it("does not match partial path", () => {
    const text = "see @foo.ts rest"
    const paths = new Set(["foo.tsx"])
    expect(isCursorAtMentionEnd(text, 11, paths)).toBe(false)
  })
})

describe("findMentionRange", () => {
  it("returns range when cursor is inside a mention", () => {
    const text = "see @foo.ts rest"
    const paths = new Set(["foo.ts"])
    // position 7 is inside "@foo.ts" (indices 4..11)
    const result = findMentionRange(text, 7, paths)
    expect(result).toEqual({ start: 4, end: 11 })
  })

  it("returns null when cursor is at the start edge of a mention", () => {
    const text = "see @foo.ts rest"
    const paths = new Set(["foo.ts"])
    expect(findMentionRange(text, 4, paths)).toBeNull()
  })

  it("returns null when cursor is at the end edge of a mention", () => {
    const text = "see @foo.ts rest"
    const paths = new Set(["foo.ts"])
    expect(findMentionRange(text, 11, paths)).toBeNull()
  })

  it("returns null when cursor is outside any mention", () => {
    const text = "see @foo.ts rest"
    const paths = new Set(["foo.ts"])
    expect(findMentionRange(text, 2, paths)).toBeNull()
  })

  it("matches the second occurrence of a duplicated mention", () => {
    const text = "@a.ts and @a.ts"
    const paths = new Set(["a.ts"])
    // First @a.ts is at 0..5, second at 10..15
    const result = findMentionRange(text, 12, paths)
    expect(result).toEqual({ start: 10, end: 15 })
  })

  it("handles builtin mentions", () => {
    const text = "check @terminal output"
    const result = findMentionRange(text, 8, new Set())
    expect(result).toEqual({ start: 6, end: 15 })
  })

  it("prefers the longest matching path to avoid partial matches", () => {
    const text = "see @src/a.tsx end"
    const paths = new Set(["src/a.ts", "src/a.tsx"])
    // position 10 is inside @src/a.tsx (indices 4..14)
    const result = findMentionRange(text, 10, paths)
    expect(result).toEqual({ start: 4, end: 14 })
  })

  it("skips overlapping token matches correctly", () => {
    const text = "@ab@ab"
    const paths = new Set(["ab"])
    // First @ab is at 0..3, second at 3..6
    // Position 1 is inside the first
    expect(findMentionRange(text, 1, paths)).toEqual({ start: 0, end: 3 })
    // Position 4 is inside the second
    expect(findMentionRange(text, 4, paths)).toEqual({ start: 3, end: 6 })
  })
})
