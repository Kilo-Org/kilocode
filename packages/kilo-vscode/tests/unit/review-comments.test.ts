import { describe, it, expect } from "bun:test"
import {
  sanitizeReviewComments,
  formatReviewCommentsMarkdown,
  extractLines,
  getDirectory,
  getFilename,
  type ReviewComment,
} from "../../webview-ui/diff-viewer/review-comments"
import { markdownCommentBlocks } from "../../webview-ui/diff-viewer/markdown-comment-ranges"
import {
  buildFileAnnotations,
  clearReviewComposer,
  createReviewComposer,
  reviewAnnotationSpeechKey,
  reviewComposerDraft,
  reviewComposerEdit,
  reviewDraftSpeechKey,
  reviewEditSpeechKey,
} from "../../webview-ui/diff-viewer/review-annotations"
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

  it("preserves comments when diff is summarized", () => {
    const c = comment({ file: "a.ts", line: 5, side: "additions" })
    const d = { ...diff("a.ts", "", ""), summarized: true }
    const result = sanitizeReviewComments([c], [d])
    expect(result).toEqual([c])
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
    expect(result).toBe("## Review Comments")
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

// ── markdownCommentBlocks ───────────────────────────────────────────────────

describe("markdownCommentBlocks", () => {
  it("keeps fenced code blocks as one selectable range", () => {
    const result = markdownCommentBlocks("# Demo\n\n```ts\nconst value = 1\nconsole.log(value)\n```\n\nAfter")
    expect(result).toContainEqual({ type: "block", start: 3, end: 6 })
  })

  it("maps table comments to rendered rows, not separator lines", () => {
    const result = markdownCommentBlocks("| Area | Status |\n|---|---|\n| Tables | Pass |\n| Lists | Pass |")
    expect(result).toEqual([
      {
        type: "table",
        start: 1,
        end: 4,
        rows: [
          { start: 1, end: 1 },
          { start: 3, end: 3 },
          { start: 4, end: 4 },
        ],
      },
    ])
  })

  it("maps list comments to whole list items", () => {
    const result = markdownCommentBlocks("- First\n  continued\n- [x] Second\n- Third")
    expect(result).toEqual([
      {
        type: "list",
        start: 1,
        end: 4,
        items: [
          { start: 1, end: 2 },
          { start: 3, end: 3 },
          { start: 4, end: 4 },
        ],
      },
    ])
  })

  it("keeps blockquotes and paragraphs as rendered blocks", () => {
    const result = markdownCommentBlocks("> Quote\n> Continued\n\nParagraph line one\nparagraph line two")
    expect(result).toEqual([
      { type: "block", start: 1, end: 2 },
      { type: "block", start: 4, end: 5 },
    ])
  })
})

// ── review annotation speech keys ───────────────────────────────────────────

describe("review annotation speech keys", () => {
  it("keeps draft keys scoped to the selected review location", () => {
    expect(reviewDraftSpeechKey({ file: "src/a.ts", side: "additions", line: 4 })).toBe("draft:src/a.ts:additions:4:4")
    expect(reviewDraftSpeechKey({ file: "src/a.ts", side: "deletions", line: 4, endLine: 8 })).toBe(
      "draft:src/a.ts:deletions:4:8",
    )
  })

  it("keeps edit keys scoped to the review comment id", () => {
    expect(reviewEditSpeechKey("c-123")).toBe("edit:c-123")
  })

  it("only exposes annotation speech keys for active draft and edit composers", () => {
    const current = comment({ file: "src/a.ts", line: 7 })
    expect(
      reviewAnnotationSpeechKey({
        type: "draft",
        comment: null,
        file: "src/a.ts",
        side: "additions",
        line: 7,
      }),
    ).toBe("draft:src/a.ts:additions:7:7")
    expect(
      reviewAnnotationSpeechKey({
        type: "comment",
        comment: current,
        file: current.file,
        side: current.side,
        line: current.line,
        editing: true,
      }),
    ).toBe(`edit:${current.id}`)
    expect(
      reviewAnnotationSpeechKey({
        type: "comment",
        comment: current,
        file: current.file,
        side: current.side,
        line: current.line,
      }),
    ).toBeUndefined()
  })
})

// ── buildFileAnnotations composer metadata ─────────────────────────────────

describe("buildFileAnnotations composer metadata", () => {
  it("preserves unfinished draft text when an annotation is rebuilt", () => {
    const draft = { file: "a.ts", side: "additions" as const, line: 2 }
    const first = buildFileAnnotations("a.ts", [], null, draft, null, null)
    if (!first.draftMeta) throw new Error("expected draft metadata")
    first.draftMeta.text = "unfinished draft"

    const next = buildFileAnnotations("a.ts", [], null, draft, first.draftMeta, first.editMeta)

    expect(next.draftMeta).toBe(first.draftMeta)
    expect(next.draftMeta?.text).toBe("unfinished draft")
  })

  it("creates fresh draft metadata when the anchor changes", () => {
    const draft = { file: "a.ts", side: "additions" as const, line: 2 }
    const first = buildFileAnnotations("a.ts", [], null, draft, null, null)
    const next = buildFileAnnotations("a.ts", [], null, { ...draft, line: 3 }, first.draftMeta, first.editMeta)

    expect(next.draftMeta).not.toBe(first.draftMeta)
  })

  it("preserves unfinished edits when an annotation is rebuilt", () => {
    const current = comment({ file: "a.ts", line: 2 })
    const first = buildFileAnnotations("a.ts", [current], current.id, null, null, null)
    if (!first.editMeta) throw new Error("expected edit metadata")
    first.editMeta.text = "unfinished edit"

    const next = buildFileAnnotations("a.ts", [current], current.id, null, first.draftMeta, first.editMeta)

    expect(next.editMeta).toBe(first.editMeta)
    expect(next.editMeta?.text).toBe("unfinished edit")
  })

  it("creates fresh edit metadata when the edited comment changes", () => {
    const firstComment = comment({ file: "a.ts", line: 2 })
    const secondComment = comment({ file: "a.ts", line: 3 })
    const first = buildFileAnnotations("a.ts", [firstComment], firstComment.id, null, null, null)
    const next = buildFileAnnotations("a.ts", [secondComment], secondComment.id, null, first.draftMeta, first.editMeta)

    expect(next.editMeta).not.toBe(first.editMeta)
  })

  it("drops unfinished edit metadata after edit mode ends", () => {
    const current = comment({ file: "a.ts", line: 2 })
    const first = buildFileAnnotations("a.ts", [current], current.id, null, null, null)
    const next = buildFileAnnotations("a.ts", [current], null, null, first.draftMeta, first.editMeta)

    expect(next.editMeta).toBeNull()
  })

  it("hands draft and edit composers between review surfaces", () => {
    const current = comment({ file: "a.ts", line: 2 })
    const composer = createReviewComposer()
    const draft = { file: "a.ts", side: "additions" as const, line: 3 }
    const first = buildFileAnnotations("a.ts", [current], current.id, draft, null, null)
    if (!first.draftMeta || !first.editMeta) throw new Error("expected composer metadata")
    first.draftMeta.text = "unfinished draft"
    first.editMeta.text = "unfinished edit"
    composer.draft = first.draftMeta
    composer.edit = first.editMeta

    expect(reviewComposerDraft(composer)).toEqual(draft)
    expect(reviewComposerEdit(composer)).toBe(current.id)
    expect(composer.draft.text).toBe("unfinished draft")
    expect(composer.edit.text).toBe("unfinished edit")
  })

  it("clears handed-off composers when the review context changes", () => {
    const composer = createReviewComposer()
    composer.draft = { type: "draft", comment: null, file: "a.ts", side: "additions", line: 2 }
    composer.edit = {
      type: "comment",
      comment: comment({ file: "a.ts", line: 2 }),
      file: "a.ts",
      side: "additions",
      line: 2,
    }

    clearReviewComposer(composer)

    expect(reviewComposerDraft(composer)).toBeNull()
    expect(reviewComposerEdit(composer)).toBeNull()
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
