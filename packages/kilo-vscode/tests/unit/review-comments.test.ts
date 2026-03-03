import { describe, it, expect } from "bun:test"
import {
  sanitizeReviewComments,
  formatReviewCommentsMarkdown,
  extractLines,
  getDirectory,
  getFilename,
  type ReviewComment,
} from "../../webview-ui/agent-manager/review-comments"
import type { WorktreeFileDiff } from "../../webview-ui/src/types/messages"

function diff(file: string, before: string, after: string): WorktreeFileDiff {
  return { file, before, after, additions: 1, deletions: 0 }
}

function comment(overrides: Partial<ReviewComment> & Pick<ReviewComment, "file" | "line">): ReviewComment {
  return {
    id: `c-${overrides.file}-${overrides.line}`,
    side: "additions",
    comment: "test comment",
    selectedText: "",
    ...overrides,
  }
}

// ── sanitizeReviewComments ────────────────────────────────────────────────

describe("sanitizeReviewComments", () => {
  it("returns empty array when no comments", () => {
    expect(sanitizeReviewComments([], [diff("a.ts", "", "line1")])).toEqual([])
  })

  it("returns empty array when no diffs", () => {
    expect(sanitizeReviewComments([comment({ file: "a.ts", line: 1 })], [])).toEqual([])
  })

  it("filters out comments for files not in diffs", () => {
    const result = sanitizeReviewComments([comment({ file: "missing.ts", line: 1 })], [diff("a.ts", "", "content")])
    expect(result).toEqual([])
  })

  it("keeps comments with valid line numbers", () => {
    const c = comment({ file: "a.ts", line: 1 })
    const result = sanitizeReviewComments([c], [diff("a.ts", "", "line1\nline2\nline3")])
    expect(result).toEqual([c])
  })

  it("keeps comment on the last line (boundary)", () => {
    const c = comment({ file: "a.ts", line: 3 })
    const result = sanitizeReviewComments([c], [diff("a.ts", "", "a\nb\nc")])
    expect(result).toEqual([c])
  })

  it("filters comment on line max+1 (off by one)", () => {
    const c = comment({ file: "a.ts", line: 4 })
    const result = sanitizeReviewComments([c], [diff("a.ts", "", "a\nb\nc")])
    expect(result).toEqual([])
  })

  it("filters comment on line 0", () => {
    const c = comment({ file: "a.ts", line: 0 })
    const result = sanitizeReviewComments([c], [diff("a.ts", "", "content")])
    expect(result).toEqual([])
  })

  it("filters comment with negative line", () => {
    const c = comment({ file: "a.ts", line: -1 })
    const result = sanitizeReviewComments([c], [diff("a.ts", "", "content")])
    expect(result).toEqual([])
  })

  it("uses diff.before for deletions side", () => {
    const c = comment({ file: "a.ts", line: 2, side: "deletions" })
    // before has 2 lines, after has 0 — comment should be valid on deletions side
    const result = sanitizeReviewComments([c], [diff("a.ts", "old1\nold2", "")])
    expect(result).toEqual([c])
  })

  it("uses diff.after for additions side", () => {
    const c = comment({ file: "a.ts", line: 2, side: "additions" })
    // after has 3 lines — comment on line 2 should be valid
    const result = sanitizeReviewComments([c], [diff("a.ts", "", "new1\nnew2\nnew3")])
    expect(result).toEqual([c])
  })

  it("rejects deletions comment when before content is empty", () => {
    const c = comment({ file: "a.ts", line: 1, side: "deletions" })
    const result = sanitizeReviewComments([c], [diff("a.ts", "", "after")])
    expect(result).toEqual([])
  })

  it("rejects additions comment when after content is empty", () => {
    const c = comment({ file: "a.ts", line: 1, side: "additions" })
    const result = sanitizeReviewComments([c], [diff("a.ts", "before", "")])
    expect(result).toEqual([])
  })

  it("returns all when all comments are valid", () => {
    const comments = [
      comment({ file: "a.ts", line: 1 }),
      comment({ file: "a.ts", line: 2 }),
      comment({ file: "b.ts", line: 1 }),
    ]
    const diffs = [diff("a.ts", "", "x\ny"), diff("b.ts", "", "z")]
    const result = sanitizeReviewComments(comments, diffs)
    expect(result).toHaveLength(3)
  })

  it("filters a mix of valid and invalid comments", () => {
    const valid = comment({ file: "a.ts", line: 1 })
    const invalid = comment({ file: "a.ts", line: 100 })
    const missing = comment({ file: "gone.ts", line: 1 })
    const result = sanitizeReviewComments([valid, invalid, missing], [diff("a.ts", "", "content")])
    expect(result).toEqual([valid])
  })
})

// ── formatReviewCommentsMarkdown ────────────────────────────────────────────

describe("formatReviewCommentsMarkdown", () => {
  it("returns header only for empty array", () => {
    const result = formatReviewCommentsMarkdown([])
    expect(result).toBe("## Review Comments\n")
  })

  it("formats a single comment without selected text", () => {
    const result = formatReviewCommentsMarkdown([
      comment({ file: "src/a.ts", line: 5, comment: "Fix this", selectedText: "" }),
    ])
    expect(result).toContain("**src/a.ts** (line 5):")
    expect(result).toContain("Fix this")
    expect(result).not.toContain("```")
  })

  it("includes code block for comment with selected text", () => {
    const result = formatReviewCommentsMarkdown([
      comment({ file: "a.ts", line: 1, comment: "Wrong return", selectedText: "return null" }),
    ])
    expect(result).toContain("```\nreturn null\n```")
    expect(result).toContain("Wrong return")
  })

  it("formats multiple comments in order", () => {
    const result = formatReviewCommentsMarkdown([
      comment({ file: "a.ts", line: 1, comment: "First" }),
      comment({ file: "b.ts", line: 10, comment: "Second", selectedText: "code" }),
    ])
    const firstIdx = result.indexOf("**a.ts** (line 1):")
    const secondIdx = result.indexOf("**b.ts** (line 10):")
    expect(firstIdx).toBeLessThan(secondIdx)
  })
})

// ── extractLines ────────────────────────────────────────────────────────────

describe("extractLines", () => {
  const content = "alpha\nbeta\ngamma\ndelta"

  it("extracts a single line (1-indexed)", () => {
    expect(extractLines(content, 1, 1)).toBe("alpha")
    expect(extractLines(content, 2, 2)).toBe("beta")
    expect(extractLines(content, 4, 4)).toBe("delta")
  })

  it("extracts a range of lines", () => {
    expect(extractLines(content, 2, 3)).toBe("beta\ngamma")
  })

  it("extracts from first to last", () => {
    expect(extractLines(content, 1, 4)).toBe("alpha\nbeta\ngamma\ndelta")
  })

  it("returns empty string for out-of-range start", () => {
    expect(extractLines(content, 10, 10)).toBe("")
  })

  it("handles empty content", () => {
    expect(extractLines("", 1, 1)).toBe("")
  })
})

// ── getDirectory / getFilename ──────────────────────────────────────────────

describe("getDirectory", () => {
  it("returns empty string for root-level file", () => {
    expect(getDirectory("file.ts")).toBe("")
  })

  it("returns directory path with trailing slash", () => {
    expect(getDirectory("src/file.ts")).toBe("src/")
  })

  it("handles deeply nested paths", () => {
    expect(getDirectory("a/b/c/d.ts")).toBe("a/b/c/")
  })
})

describe("getFilename", () => {
  it("returns the full name for root-level file", () => {
    expect(getFilename("file.ts")).toBe("file.ts")
  })

  it("returns just the filename from a path", () => {
    expect(getFilename("src/components/Button.tsx")).toBe("Button.tsx")
  })
})
