import { describe, it, expect } from "bun:test"
import {
  AT_PATTERN,
  syncMentionedPaths,
  buildTextAfterMentionSelect,
  buildFileAttachments,
  buildMentionResults,
  buildSessionAttachments,
  filterMentionResults,
  filterSessions,
  getMentionRemovalRange,
  isCursorAtMentionEnd,
  findMentionRange,
  mentionSettled,
  sessionMentionFilename,
  sessionMentionText,
  sessionMentionToken,
  syncMentionedSessions,
  FILE_PICKER_RESULT,
  PAST_CHATS_RESULT,
  TERMINAL_RESULT,
  GIT_CHANGES_RESULT,
  WORKTREES_RESULT,
  filePickerNamed,
  defaultMentionIndex,
} from "../../webview-ui/src/hooks/file-mention-utils"
import type { MentionResult } from "../../webview-ui/src/hooks/file-mention-utils"
import { TERMINAL_MENTION } from "../../webview-ui/src/hooks/terminal-context-utils"
import { GIT_CHANGES_MENTION } from "../../webview-ui/src/hooks/git-changes-context-utils"

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

  it("captures spaces in an in-progress mention query", () => {
    const match = "hello @my report".match(AT_PATTERN)
    expect(match?.[1]).toBe("my report")
  })

  it("starts a new query at the latest mention instead of swallowing an earlier one", () => {
    const match = "see @src/a.ts and @my rep".match(AT_PATTERN)
    expect(match?.[1]).toBe("my rep")
  })

  it("keeps an @ that is part of a scoped path inside the query", () => {
    const match = "@node_modules/@types/node".match(AT_PATTERN)
    expect(match?.[1]).toBe("node_modules/@types/node")
  })

  it("does not span a newline", () => {
    const match = "@src/a.ts\nnext line".match(AT_PATTERN)
    expect(match).toBeNull()
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

  it("ranks terminal above a file the query fits less well", () => {
    const result = buildMentionResults("term", ["src/terminal-view-model.ts"])
    expect(result.map((item) => item.type)).toEqual(["terminal", "file", "file-picker"])
  })

  it("ranks git changes above a file the query fits less well", () => {
    const result = buildMentionResults("git changes", ["src/git.ts"])
    expect(result.map((item) => item.type)).toEqual(["git-changes", "file", "file-picker"])
  })

  it("omits special mentions for unrelated query", () => {
    const result = buildMentionResults("src", ["src/index.ts"])
    expect(result.map((item) => item.type)).toEqual(["file", "file-picker"])
  })

  it("omits git changes when git is unavailable", () => {
    const result = buildMentionResults("git", ["src/git.ts"], false)
    expect(result.map((item) => item.type)).toEqual(["file", "file-picker"])
  })

  it("includes folder results", () => {
    const result = buildMentionResults("src", [{ path: "src", type: "folder" }])
    expect(result).toEqual([{ type: "folder", value: "src" }, FILE_PICKER_RESULT])
  })

  it("preserves opened file result type", () => {
    const result = buildMentionResults("src", [{ path: "src/index.ts", type: "opened-file" }])
    expect(result).toEqual([{ type: "opened-file", value: "src/index.ts" }, FILE_PICKER_RESULT])
  })

  it("keeps the menu order for a bare @, entries above the files", () => {
    const result = buildMentionResults("", ["src/index.ts"])
    expect(result).toEqual([
      TERMINAL_RESULT,
      GIT_CHANGES_RESULT,
      PAST_CHATS_RESULT,
      FILE_PICKER_RESULT,
      { type: "file", value: "src/index.ts" },
    ])
  })

  it("keeps browse files on offer whatever the query matches", () => {
    expect(buildMentionResults("src", ["src/index.ts"])).toContainEqual(FILE_PICKER_RESULT)
    expect(buildMentionResults("zzz", [])).toEqual([FILE_PICKER_RESULT])
    expect(buildMentionResults("browse files", [])).toEqual([FILE_PICKER_RESULT])
  })

  it("keeps browse files last among the entries of a bare @", () => {
    const result = buildMentionResults("", ["src/index.ts"], true, true)
    const types = result.map((item) => item.type)
    expect(types.indexOf("file-picker")).toBe(types.indexOf("worktrees") + 1)
    expect(types.indexOf("file-picker")).toBe(types.indexOf("file") - 1)
  })

  it("ranks a literal filename match above chats the query only scatters", () => {
    const weak = { id: "ses_a", title: "500 character novel generation", updated: 1 }
    const result = buildMentionResults("chevron", ["resources/icons/chevron-down.svg"], true, false, [
      { type: "session", value: weak.title, session: weak },
    ])
    expect(result).toEqual([{ type: "file", value: "resources/icons/chevron-down.svg" }, FILE_PICKER_RESULT])
  })

  it("ranks a chat above the files when the title fits the query best", () => {
    const session = { id: "ses_a", title: "Fix auth bug", updated: 1 }
    const result = buildMentionResults("fix auth", ["src/authenticate.ts"], true, false, [
      { type: "session", value: session.title, session },
    ])
    expect(result.at(0)).toMatchObject({ type: "session", value: "Fix auth bug" })
  })

  it.each([
    ["past chats", PAST_CHATS_RESULT],
    ["past ch", PAST_CHATS_RESULT],
    ["git changes", GIT_CHANGES_RESULT],
    ["git ch", GIT_CHANGES_RESULT],
  ])("finds the %s entry from a spaced query", (query, expected) => {
    expect(buildMentionResults(query as string, [])).toContainEqual(expected)
  })

  it("finds worktree references from a spaced query", () => {
    const result = buildMentionResults("search work", [], true, true)
    expect(result).toContainEqual(WORKTREES_RESULT)
  })

  it("ranks a matching past chat above what the query does not fit", () => {
    const session = { id: "ses_a", title: "Fix auth bug", updated: 1 }
    const result = buildMentionResults("fix auth", ["src/auth.ts"], true, false, [
      { type: "session", value: "Fix auth bug", session },
    ])
    expect(result.map((item) => item.type)).toEqual(["session", "file", "file-picker"])
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

  it("always preserves file picker result regardless of query", () => {
    expect(filterMentionResults("browse", [FILE_PICKER_RESULT])).toEqual([FILE_PICKER_RESULT])
    expect(filterMentionResults("zz", [FILE_PICKER_RESULT])).toEqual([FILE_PICKER_RESULT])
  })

  it("keeps the special entries for spaced queries that spell their labels", () => {
    const items = [TERMINAL_RESULT, GIT_CHANGES_RESULT, PAST_CHATS_RESULT, WORKTREES_RESULT]
    expect(filterMentionResults("git changes", items)).toEqual([GIT_CHANGES_RESULT])
    expect(filterMentionResults("past chats", items)).toEqual([PAST_CHATS_RESULT])
  })

  it("matches past chats by title, ignoring separator differences", () => {
    const session = { id: "ses_a", title: "Fix auth bug", updated: 1 }
    const items: MentionResult[] = [{ type: "session", value: "Fix auth bug", session }]
    expect(filterMentionResults("auth bug", items)).toEqual(items)
    expect(filterMentionResults("nothing", items)).toEqual([])
  })
})

describe("filterSessions", () => {
  const sessions = Array.from({ length: 60 }, (_, index) => ({
    id: `ses_${index}`,
    title: `Recent session ${index}`,
    updated: 60 - index,
    worktreeName: "branch",
  }))

  it("shows the first 50 sessions in their existing order without a query", () => {
    expect(filterSessions(sessions, "")).toEqual(sessions.slice(0, 50))
  })

  it("limits broad search results to 50 matches", () => {
    expect(filterSessions(sessions, "recent")).toHaveLength(50)
  })

  it.each(["ORCHID", "old-branch"])("finds older sessions beyond the display limit by %s", (query) => {
    const source = { id: "ses_old", title: "Orchid reference source", updated: 0, worktreeName: "old-branch" }
    expect(filterSessions([...sessions, source], query)).toEqual([source])
  })

  it("ranks an older exact match before newer partial matches", () => {
    const source = { id: "ses_old", title: "Recent", updated: 0 }
    const matches = filterSessions([...sessions, source], "recent")
    expect(matches).toHaveLength(50)
    expect(matches[0]).toBe(source)
  })

  it("returns no results when nothing matches", () => {
    expect(filterSessions(sessions, "zzzz")).toEqual([])
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

describe("session mentions", () => {
  const now = Date.now()
  const sessions = [
    { id: "ses_a", title: "Fix auth bug", updated: now },
    { id: "ses_b", title: "Rotate signing keys", updated: now - 1000 },
    { id: "ses_c", title: "Refactor cache layer", updated: now - 2000 },
  ]

  describe("past chats entry", () => {
    const offered = (query: string) => buildMentionResults(query, []).some((item) => item.type === "past-chats")

    it("is offered for an empty query", () => {
      expect(offered("")).toBe(true)
    })

    it("is offered for its aliases", () => {
      expect(offered("pas")).toBe(true)
      expect(offered("sess")).toBe(true)
      expect(offered("hist")).toBe(true)
    })

    it("is offered for its spaced label", () => {
      expect(offered("past chats")).toBe(true)
      expect(offered("Past Ch")).toBe(true)
    })

    it("is dropped for unrelated queries", () => {
      expect(offered("index")).toBe(false)
      expect(offered("past chats and more")).toBe(false)
    })
  })

  describe("sessionMentionText / filename", () => {
    it("collapses whitespace in titles", () => {
      expect(sessionMentionText("Fix\nauth   bug")).toBe("Fix auth bug")
    })

    it("slugifies titles for the attachment filename", () => {
      expect(sessionMentionFilename("Fix auth bug", "ses_a")).toBe("Fix-auth-bug.md")
    })

    it("falls back to the session id when the slug is empty", () => {
      expect(sessionMentionFilename("???", "ses_a")).toBe("ses_a.md")
    })

    it("disambiguates sessions with the same title", () => {
      const known = new Map([["Fix auth bug", sessions[0]!]])
      expect(sessionMentionToken({ ...sessions[1]!, title: "Fix auth bug" }, known)).toBe("Fix auth bug (2)")
    })

    it("reuses the token already assigned to a session", () => {
      const known = new Map([["Fix auth bug (2)", sessions[1]!]])
      expect(sessionMentionToken(sessions[1]!, known)).toBe("Fix auth bug (2)")
    })
  })

  describe("buildMentionResults", () => {
    it("offers the past-chats picker alongside the other special mentions", () => {
      const result = buildMentionResults("", [])
      expect(result[0]).toEqual(TERMINAL_RESULT)
      expect(result).toContainEqual(PAST_CHATS_RESULT)
      expect(result).toContainEqual(FILE_PICKER_RESULT)
    })
  })

  describe("defaultMentionIndex", () => {
    const file: MentionResult = { type: "file", value: "src/index.ts" }

    it("starts on the first candidate below the entries", () => {
      expect(defaultMentionIndex([TERMINAL_RESULT, FILE_PICKER_RESULT, file])).toBe(2)
    })

    it("starts on a matching chat when it outranks the files", () => {
      const session = { id: "ses_a", title: "Fix auth bug", updated: 1 }
      const items: MentionResult[] = [FILE_PICKER_RESULT, { type: "session", value: "Fix auth bug", session }, file]
      expect(defaultMentionIndex(items)).toBe(1)
    })

    it("falls back to browse files when nothing else was found", () => {
      expect(defaultMentionIndex([FILE_PICKER_RESULT])).toBe(0)
    })

    it("falls back to the first entry rather than stealing it from a match", () => {
      expect(defaultMentionIndex([TERMINAL_RESULT, FILE_PICKER_RESULT])).toBe(0)
    })

    it("handles an empty list", () => {
      expect(defaultMentionIndex([])).toBe(0)
    })
  })

  describe("filePickerNamed", () => {
    it("recognises the entry being spelled out", () => {
      expect(filePickerNamed("browse files")).toBe(true)
      expect(filePickerNamed("browse fi")).toBe(true)
      expect(filePickerNamed("Browse")).toBe(true)
      expect(filePickerNamed("file picker")).toBe(true)
    })

    it("recognises the label typed in full, dots included", () => {
      expect(filePickerNamed("browse files...")).toBe(true)
      expect(filePickerNamed("Browse files...")).toBe(true)
      expect(filePickerNamed("browse files..")).toBe(true)
    })

    it("does not treat the fallback as named", () => {
      expect(filePickerNamed("")).toBe(false)
      expect(filePickerNamed("README.md and then")).toBe(false)
      expect(filePickerNamed("browsers")).toBe(false)
    })
  })

  describe("mentionSettled", () => {
    const tokens = new Set(["my file.txt", "src/a.ts"])

    it("reports the inserted mention followed by prose", () => {
      expect(mentionSettled("my file.txt and then", "my file.txt", tokens)).toBe(true)
    })

    it("reports the inserted mention followed by a single space", () => {
      expect(mentionSettled("src/a.ts ", "src/a.ts", tokens)).toBe(true)
    })

    it("treats a prefix of the inserted mention as an edit in progress", () => {
      expect(mentionSettled("my file", "my file.txt", tokens)).toBe(false)
    })

    it("treats the exact inserted mention as an edit in progress", () => {
      expect(mentionSettled("my file.txt", "my file.txt", tokens)).toBe(false)
    })

    it("does not report a longer path that merely starts like the inserted one", () => {
      expect(mentionSettled("src/a.tsx", "src/a.ts", tokens)).toBe(false)
    })

    it("reports nothing when no mention was inserted at this @", () => {
      expect(mentionSettled("my file.txt and then", undefined, tokens)).toBe(false)
    })

    it("does not settle on a short known path that only prefixes a new query", () => {
      // "my" lingers in the sticky known set from an earlier mention; typing a
      // longer, unrelated path that starts with it must keep searching.
      expect(mentionSettled("my report.txt", undefined, new Set(["my"]))).toBe(false)
    })

    it("keeps searching while the query still grows toward a longer known path", () => {
      const known = new Set(["my", "my report.txt"])
      expect(mentionSettled("my report", "my", known)).toBe(false)
    })

    it("settles once the query passes every known path it could complete", () => {
      const known = new Set(["my", "my report.txt"])
      expect(mentionSettled("my report.txt and then", "my", known)).toBe(true)
    })

    it("reports inserted builtin mentions", () => {
      expect(mentionSettled("terminal what failed", TERMINAL_MENTION, new Set())).toBe(true)
      expect(mentionSettled("git-changes review", GIT_CHANGES_MENTION, new Set())).toBe(true)
    })

    it("reports nothing for an unrelated query", () => {
      expect(mentionSettled("some other thing", "my file.txt", tokens)).toBe(false)
    })
  })

  describe("filterMentionResults", () => {
    it("keeps the past-chats picker for alias queries", () => {
      const filtered = filterMentionResults("sess", buildMentionResults("", []))
      expect(filtered).toContainEqual(PAST_CHATS_RESULT)
    })
  })

  describe("syncMentionedSessions", () => {
    it("drops sessions whose token is no longer present in the text", () => {
      const prev = new Map([
        ["Fix auth bug", sessions[0]!],
        ["Rotate signing keys", sessions[1]!],
      ])
      const kept = syncMentionedSessions(prev, "see @Fix auth bug here")
      expect(kept.has("Fix auth bug")).toBe(true)
      expect(kept.has("Rotate signing keys")).toBe(false)
    })
  })

  describe("buildSessionAttachments", () => {
    it("builds a session: attachment with span offsets and a readable filename", () => {
      const mentioned = new Map([["Fix auth bug", sessions[0]!]])
      const attachments = buildSessionAttachments("check @Fix auth bug out", mentioned)
      expect(attachments).toHaveLength(1)
      const att = attachments[0]!
      expect(att.mime).toBe("text/plain")
      expect(att.url).toBe("session:ses_a")
      expect(att.filename).toBe("Fix-auth-bug.md")
      expect(att.source?.type).toBe("file")
      expect(att.source?.text.value).toBe("@Fix auth bug")
      expect(att.source?.text.start).toBe(6)
      expect(att.source?.text.end).toBe(19)
    })

    it("skips sessions whose token is not present in the text", () => {
      const mentioned = new Map([["Fix auth bug", sessions[0]!]])
      expect(buildSessionAttachments("nothing here", mentioned)).toEqual([])
    })

    it("attaches distinct sessions whose titles collide", () => {
      const mentioned = new Map([
        ["Fix auth bug", sessions[0]!],
        ["Fix auth bug (2)", { ...sessions[1]!, title: "Fix auth bug" }],
      ])
      const attachments = buildSessionAttachments("compare @Fix auth bug with @Fix auth bug (2)", mentioned)
      expect(attachments.map((item) => item.url)).toEqual(["session:ses_a", "session:ses_b"])
      expect(attachments.map((item) => item.source?.text.value)).toEqual(["@Fix auth bug", "@Fix auth bug (2)"])
    })
  })
})
