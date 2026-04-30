import { describe, it, expect } from "bun:test"
import {
  AT_PATTERN,
  syncMentionedPaths,
  buildTextAfterMentionSelect,
  buildFileAttachments,
  buildMentionResults,
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

  it("handles @mention at start of string", () => {
    const result = buildTextAfterMentionSelect("@par", "", "foo.ts")
    expect(result).toBe("@foo.ts")
  })

  it("preserves space prefix before @mention", () => {
    const result = buildTextAfterMentionSelect("text @par", "", "foo.ts")
    expect(result).toBe("text @foo.ts")
  })

  it("appends suffix after replacement", () => {
    const result = buildTextAfterMentionSelect("before @q", " after text", "file.ts")
    expect(result).toContain("after text")
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
