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
  FILE_PICKER_RESULT,
  TERMINAL_RESULT,
  GIT_CHANGES_RESULT,
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
    expect(result.map((item) => item.type)).toEqual(["terminal", "file-picker", "file"])
  })

  it("includes git changes for matching prefix", () => {
    const result = buildMentionResults("git", ["src/git.ts"])
    expect(result.map((item) => item.type)).toEqual(["git-changes", "file-picker", "file"])
  })

  it("omits special mentions for unrelated query", () => {
    const result = buildMentionResults("src", ["src/index.ts"])
    expect(result.map((item) => item.type)).toEqual(["file-picker", "file"])
  })

  it("omits git changes when git is unavailable", () => {
    const result = buildMentionResults("git", ["src/git.ts"], false)
    expect(result.map((item) => item.type)).toEqual(["file-picker", "file"])
  })

  it("includes folder results", () => {
    const result = buildMentionResults("src", [{ path: "src", type: "folder" }])
    expect(result).toEqual([FILE_PICKER_RESULT, { type: "folder", value: "src" }])
  })

  it("preserves opened file result type", () => {
    const result = buildMentionResults("src", [{ path: "src/index.ts", type: "opened-file" }])
    expect(result).toEqual([FILE_PICKER_RESULT, { type: "opened-file", value: "src/index.ts" }])
  })

  it("always includes file picker result, placed after terminal/git-changes and before file results", () => {
    const result = buildMentionResults("", ["src/index.ts"])
    expect(result).toEqual([
      TERMINAL_RESULT,
      GIT_CHANGES_RESULT,
      FILE_PICKER_RESULT,
      { type: "file", value: "src/index.ts" },
    ])
  })
})

describe("filterMentionResults", () => {
  it("keeps matching file results for the latest query", () => {
    const result = filterMentionResults("gi", [
      { type: "file", value: "README.md" },
      { type: "file", value: "src/git.ts" },
      FILE_PICKER_RESULT,
    ])
    expect(result).toEqual([{ type: "file", value: "src/git.ts" }, FILE_PICKER_RESULT])
  })

  it("always preserves file picker result regardless of query", () => {
    const result = filterMentionResults("zz", [FILE_PICKER_RESULT])
    expect(result).toEqual([FILE_PICKER_RESULT])
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

  it("does not false-match a stale shorter path against a longer, space-containing path that starts the same way", () => {
    // "a.txt" is a known path from an earlier, unrelated mention. A space
    // genuinely follows "a.txt" in the current text, but only because it's
    // the start of the longer, distinct "a.txt backup.txt" -- a whitespace-only
    // boundary check would incorrectly treat that as a valid, separate match.
    const paths = new Set(["a.txt", "a.txt backup.txt"])
    const result = syncMentionedPaths(paths, "@a.txt backup.txt")
    expect(result.has("a.txt backup.txt")).toBe(true)
    expect(result.has("a.txt")).toBe(false)
  })

  it("keeps a shorter path when it also has its own genuine, separate occurrence", () => {
    const paths = new Set(["a.txt", "a.txt backup.txt"])
    const result = syncMentionedPaths(paths, "@a.txt backup.txt and also @a.txt")
    expect(result.has("a.txt backup.txt")).toBe(true)
    expect(result.has("a.txt")).toBe(true)
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

  it("attaches an absolute path that lives inside the workspace", () => {
    const paths = new Set(["/workspace/src/file.ts"])
    const result = buildFileAttachments("@/workspace/src/file.ts", paths, "/workspace")
    expect(result).toHaveLength(1)
    expect(result[0]!.url).toContain("/workspace/src/file.ts")
  })

  it("does not attach an absolute Unix path outside the workspace", () => {
    const paths = new Set(["/abs/path/file.ts"])
    const result = buildFileAttachments("@/abs/path/file.ts", paths, "/workspace")
    expect(result).toEqual([])
  })

  it("does not attach an absolute Windows path outside the workspace", () => {
    const paths = new Set(["C:/Users/file.ts"])
    const result = buildFileAttachments("@C:/Users/file.ts", paths, "/workspace")
    expect(result).toEqual([])
  })

  it("does not attach a UNC path outside the workspace", () => {
    const paths = new Set(["\\\\server\\share\\file.ts"])
    const result = buildFileAttachments("@\\\\server\\share\\file.ts", paths, "/workspace")
    expect(result).toEqual([])
  })

  it("does not attach an absolute path that escapes the workspace via ../ segments", () => {
    const paths = new Set(["/workspace/../../etc/passwd"])
    const result = buildFileAttachments("@/workspace/../../etc/passwd", paths, "/workspace")
    expect(result).toEqual([])
  })

  it("does not attach a relative-looking mention that escapes the workspace via ../ segments", () => {
    // Simulates a path seeded from raw text (e.g. seedFromText) rather than the
    // file picker or file search, which never produce a leading "../".
    const paths = new Set(["../../etc/passwd"])
    const result = buildFileAttachments("@../../etc/passwd", paths, "/workspace")
    expect(result).toEqual([])
  })

  it("attaches a relative mention with ../ segments that still resolves inside the workspace", () => {
    const paths = new Set(["sub/../foo.ts"])
    const result = buildFileAttachments("@sub/../foo.ts", paths, "/workspace")
    expect(result).toHaveLength(1)
    expect(result[0]!.url).toContain("/workspace/foo.ts")
  })

  it("normalizes Windows backslashes in workspaceDir", () => {
    const paths = new Set(["foo.ts"])
    const result = buildFileAttachments("@foo.ts", paths, "C:\\Users\\workspace")
    expect(result[0]!.url).not.toContain("\\")
  })

  it("includes source.text with correct position for a plain mention", () => {
    const paths = new Set(["src/foo.ts"])
    const text = "check @src/foo.ts here"
    const result = buildFileAttachments(text, paths, "/workspace")
    expect(result[0]!.source).toEqual({
      type: "file",
      path: "src/foo.ts",
      text: { value: "@src/foo.ts", start: 6, end: 17 },
    })
  })

  it("includes source.text for a filename with spaces", () => {
    const paths = new Set(["org data.xlsx"])
    const text = "see @org data.xlsx now"
    const result = buildFileAttachments(text, paths, "/workspace")
    expect(result).toHaveLength(1)
    expect(result[0]!.source).toEqual({
      type: "file",
      path: "org data.xlsx",
      text: { value: "@org data.xlsx", start: 4, end: 18 },
    })
  })

  it("includes source.text for a Cyrillic filename", () => {
    const paths = new Set(["файл.txt"])
    const text = "open @файл.txt"
    const result = buildFileAttachments(text, paths, "/workspace")
    expect(result).toHaveLength(1)
    expect(result[0]!.source?.text.value).toBe("@файл.txt")
    expect(result[0]!.source?.text.start).toBe(5)
  })

  it("includes source.text for a Chinese filename", () => {
    const paths = new Set(["文件.txt"])
    const text = "@文件.txt"
    const result = buildFileAttachments(text, paths, "/workspace")
    expect(result).toHaveLength(1)
    expect(result[0]!.source?.text.value).toBe("@文件.txt")
    expect(result[0]!.source?.text.start).toBe(0)
  })

  it("includes source.text for a path with spaces in both dir and filename", () => {
    const paths = new Set(["my folder/org data.xlsx"])
    const text = "using @my folder/org data.xlsx here"
    const result = buildFileAttachments(text, paths, "/workspace")
    expect(result).toHaveLength(1)
    expect(result[0]!.source).toEqual({
      type: "file",
      path: "my folder/org data.xlsx",
      text: { value: "@my folder/org data.xlsx", start: 6, end: 30 },
    })
  })

  it("percent-encodes spaces in the file URL so the server can decode it correctly", () => {
    const paths = new Set(["org data.xlsx"])
    const result = buildFileAttachments("@org data.xlsx", paths, "/workspace")
    expect(result).toHaveLength(1)
    expect(result[0]!.url).not.toContain(" ")
    expect(result[0]!.url).toContain("%20")
  })

  it("percent-encodes spaces in nested path segments", () => {
    const paths = new Set(["my folder/my file.txt"])
    const result = buildFileAttachments("@my folder/my file.txt", paths, "/workspace")
    expect(result).toHaveLength(1)
    expect(result[0]!.url).not.toContain(" ")
    expect(result[0]!.url).toContain("my%20folder")
    expect(result[0]!.url).toContain("my%20file.txt")
  })

  it("round-trips a filename containing a literal percent-encoded-looking sequence", () => {
    // Only escaping spaces before assigning to url.pathname is not enough: a
    // real filename like "100%20real.txt" already contains the literal text
    // "%20". If "%" itself isn't escaped first, the URL's "%20" is
    // indistinguishable from an actually-encoded space, and decoding it (as
    // Bun's fileURLToPath does server-side) would produce "100 real.txt" --
    // a different, wrong filename.
    const paths = new Set(["100%20real.txt"])
    const result = buildFileAttachments("@100%20real.txt", paths, "/workspace")
    expect(result).toHaveLength(1)
    const decoded = decodeURIComponent(new URL(result[0]!.url).pathname)
    expect(decoded).toBe("/workspace/100%20real.txt")
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
