import { describe, it, expect } from "bun:test"
import {
  fileName,
  dirName,
  buildHighlightSegments,
  buildPromptSegments,
  atEnd,
  insertSpacedText,
  isPromptBlocked,
  isPromptBusy,
  isSuggesting,
  isQuestioning,
  isPathMention,
  applySandboxState,
  applySandboxStates,
  memoryRest,
  undoKey,
  promptLineCount,
  isCollapsiblePaste,
  pastePlaceholder,
  findPastePlaceholders,
  shiftPastes,
  rebasePastes,
  pasteInsertion,
  expandPastes,
  textDiff,
  type PasteRange,
} from "../../webview-ui/src/components/chat/prompt-input-utils"
import { parseMemoryCommand } from "../../webview-ui/src/utils/memory-command"

describe("applySandboxState", () => {
  const state = (enabled: boolean, revision: number, sessionID = "ses_1", directory = "/repo") => ({
    sessionID,
    directory,
    enabled,
    available: true,
    version: enabled ? 1 : 0,
    revision,
  })

  it("ignores an HTTP response with an older backend version", () => {
    const latest = { ...state(true, 1), version: 2 }
    const stale = { ...state(false, 2), version: 1 }
    expect(applySandboxState(latest, stale)).toEqual(latest)
  })

  it("uses provider revision to order equal backend versions", () => {
    const current = { ...state(false, 2), version: 4 }
    const older = { ...state(true, 1), version: 4 }
    const newer = { ...state(true, 3), version: 4 }
    expect(applySandboxState(current, older)).toEqual(current)
    expect(applySandboxState(current, newer)).toEqual(newer)
  })

  it("keeps global provider ordering across sessions and directories", () => {
    expect(applySandboxState(state(true, 5, "ses_1"), state(false, 1, "ses_2"))).toEqual(state(true, 5, "ses_1"))
    expect(applySandboxState(state(true, 5), state(false, 6, "ses_1", "/worktree"))).toEqual(
      state(false, 6, "ses_1", "/worktree"),
    )
  })

  it("caches independently ordered statuses for worktree switching", () => {
    const first = applySandboxStates({}, state(true, 5, "ses_1"))
    const second = applySandboxStates(first, state(false, 1, "ses_2"))

    expect(second).toEqual({
      ses_1: state(true, 5, "ses_1"),
      ses_2: state(false, 1, "ses_2"),
    })
    expect(applySandboxStates(second, state(false, 4, "ses_1"))).toBe(second)
  })
})

describe("fileName", () => {
  it("extracts the last segment of a unix path", () => {
    expect(fileName("src/components/chat/PromptInput.tsx")).toBe("PromptInput.tsx")
  })

  it("extracts the last segment of a Windows path", () => {
    expect(fileName("src\\components\\chat\\PromptInput.tsx")).toBe("PromptInput.tsx")
  })

  it("returns the path itself when no separator present", () => {
    expect(fileName("README.md")).toBe("README.md")
  })

  it("returns the filename for a single directory segment", () => {
    expect(fileName("src/foo.ts")).toBe("foo.ts")
  })

  it("handles mixed separators", () => {
    expect(fileName("src\\components/chat/File.tsx")).toBe("File.tsx")
  })
})

describe("dirName", () => {
  it("returns empty string for a file with no directory", () => {
    expect(dirName("README.md")).toBe("")
  })

  it("returns the directory for a simple path", () => {
    expect(dirName("src/foo.ts")).toBe("src")
  })

  it("returns full directory for a short path", () => {
    expect(dirName("src/components/foo.ts")).toBe("src/components")
  })

  it("truncates long directories to last two segments", () => {
    const path = "packages/kilo-vscode/webview-ui/src/components/chat/foo.ts"
    const result = dirName(path)
    expect(result).toMatch(/^…\//)
    expect(result).toContain("components/chat")
  })

  it("does not truncate directories at exactly 30 chars", () => {
    const dir = "a".repeat(15) + "/" + "b".repeat(14)
    const result = dirName(`${dir}/file.ts`)
    expect(result).toBe(dir)
  })

  it("truncates directories longer than 30 chars", () => {
    const dir = "a".repeat(16) + "/" + "b".repeat(15)
    const result = dirName(`${dir}/file.ts`)
    expect(result.startsWith("…/")).toBe(true)
  })

  it("normalizes Windows backslashes before measuring length", () => {
    const result = dirName("src\\foo.ts")
    expect(result).toBe("src")
  })
})

describe("buildHighlightSegments", () => {
  it("returns single non-highlighted segment when paths set is empty", () => {
    const result = buildHighlightSegments("hello world", new Set())
    expect(result).toEqual([{ text: "hello world", highlight: false }])
  })

  it("returns single non-highlighted segment when no mention present", () => {
    const result = buildHighlightSegments("hello world", new Set(["foo.ts"]))
    expect(result).toEqual([{ text: "hello world", highlight: false }])
  })

  it("highlights a single mention token", () => {
    const result = buildHighlightSegments("@foo.ts", new Set(["foo.ts"]))
    expect(result).toEqual([{ text: "@foo.ts", highlight: true }])
  })

  it("splits text before and highlight token", () => {
    const result = buildHighlightSegments("see @foo.ts here", new Set(["foo.ts"]))
    expect(result).toEqual([
      { text: "see ", highlight: false },
      { text: "@foo.ts", highlight: true },
      { text: " here", highlight: false },
    ])
  })

  it("highlights multiple mentions in order", () => {
    const result = buildHighlightSegments("@a.ts and @b.ts done", new Set(["a.ts", "b.ts"]))
    expect(result).toEqual([
      { text: "@a.ts", highlight: true },
      { text: " and ", highlight: false },
      { text: "@b.ts", highlight: true },
      { text: " done", highlight: false },
    ])
  })

  it("picks the earliest mention when multiple paths could match", () => {
    const result = buildHighlightSegments("@b.ts then @a.ts", new Set(["a.ts", "b.ts"]))
    expect(result[0]).toEqual({ text: "@b.ts", highlight: true })
    expect(result[2]).toEqual({ text: "@a.ts", highlight: true })
  })

  it("handles back-to-back mentions with no separator", () => {
    const result = buildHighlightSegments("@a.ts@b.ts", new Set(["a.ts", "b.ts"]))
    const highlighted = result.filter((s) => s.highlight)
    expect(highlighted).toHaveLength(2)
  })

  it("returns empty array for empty string", () => {
    const result = buildHighlightSegments("", new Set(["foo.ts"]))
    expect(result).toEqual([])
  })

  it("does not partially match longer paths", () => {
    const result = buildHighlightSegments("@foo.ts", new Set(["foo.tsx"]))
    expect(result).toEqual([{ text: "@foo.ts", highlight: false }])
  })
})

describe("atEnd", () => {
  it("returns true when caret is at end with no selection", () => {
    expect(atEnd(5, 5, 5)).toBe(true)
  })

  it("returns false when caret is before end", () => {
    expect(atEnd(4, 4, 5)).toBe(false)
  })

  it("returns false when there is a selection", () => {
    expect(atEnd(2, 5, 5)).toBe(false)
  })

  it("returns true for empty input", () => {
    expect(atEnd(0, 0, 0)).toBe(true)
  })

  it("returns false when caret is at start of non-empty input", () => {
    expect(atEnd(0, 0, 10)).toBe(false)
  })
})

describe("isPromptBlocked", () => {
  it("returns false when zero permissions", () => {
    expect(isPromptBlocked(0)).toBe(false)
  })

  it("returns true when permissions exist", () => {
    expect(isPromptBlocked(1)).toBe(true)
    expect(isPromptBlocked(3)).toBe(true)
  })

  it("accepts exactly one argument (locks the API against regression)", () => {
    // Prevents a future change from reintroducing the question/blocking coupling.
    // See prompt-send-contract.test.ts for the source-level complement.
    expect(isPromptBlocked.length).toBe(1)
  })
})

describe("isPromptBusy", () => {
  it("returns true when busy and neither suggesting nor questioning", () => {
    expect(isPromptBusy("busy", false, false, false)).toBe(true)
  })

  it("returns true while submitting before the backend reports busy", () => {
    expect(isPromptBusy("idle", false, false, true)).toBe(true)
  })

  it("returns false when idle regardless of suggesting/questioning", () => {
    expect(isPromptBusy("idle", false, false, false)).toBe(false)
    expect(isPromptBusy("idle", true, false, false)).toBe(false)
    expect(isPromptBusy("idle", false, true, false)).toBe(false)
    expect(isPromptBusy("idle", true, true, false)).toBe(false)
  })

  it("returns false when busy but suggesting is true (suggestion decoupling)", () => {
    expect(isPromptBusy("busy", true, false, false)).toBe(false)
  })

  it("returns false when busy but questioning is true (question decoupling)", () => {
    expect(isPromptBusy("busy", false, true, false)).toBe(false)
  })

  it("returns false when busy and both suggesting and questioning", () => {
    expect(isPromptBusy("busy", true, true, false)).toBe(false)
  })

  it("returns true for non-idle non-busy status when not suggesting/questioning", () => {
    expect(isPromptBusy("retry", false, false, false)).toBe(true)
  })
})

describe("insertSpacedText", () => {
  it("inserts transcript into empty text", () => {
    expect(insertSpacedText("", "hello", 0, 0)).toEqual({ text: "hello", pos: 5 })
  })

  it("adds spaces between surrounding words", () => {
    expect(insertSpacedText("helloworld", "beautiful", 5, 5)).toEqual({ text: "hello beautiful world", pos: 16 })
  })

  it("does not duplicate existing spaces", () => {
    expect(insertSpacedText("hello world", "beautiful", 6, 6)).toEqual({ text: "hello beautiful world", pos: 16 })
  })

  it("replaces selected text and keeps caret after transcript", () => {
    expect(insertSpacedText("hello bad world", "beautiful", 6, 9)).toEqual({ text: "hello beautiful world", pos: 15 })
  })

  it("preserves leading and trailing insertion positions", () => {
    expect(insertSpacedText("world", "hello", 0, 0)).toEqual({ text: "hello world", pos: 6 })
    expect(insertSpacedText("hello", "world", 5, 5)).toEqual({ text: "hello world", pos: 11 })
  })
})

describe("isSuggesting", () => {
  it("returns true when not blocked and suggestions > 0", () => {
    expect(isSuggesting(false, 1)).toBe(true)
    expect(isSuggesting(false, 3)).toBe(true)
  })

  it("returns false when blocked even with suggestions", () => {
    expect(isSuggesting(true, 2)).toBe(false)
  })

  it("returns false when not blocked but no suggestions", () => {
    expect(isSuggesting(false, 0)).toBe(false)
  })
})

describe("isQuestioning", () => {
  it("returns true when not blocked and questions > 0", () => {
    expect(isQuestioning(false, 1)).toBe(true)
    expect(isQuestioning(false, 5)).toBe(true)
  })

  it("returns false when blocked even with questions", () => {
    expect(isQuestioning(true, 2)).toBe(false)
  })

  it("returns false when not blocked but no questions", () => {
    expect(isQuestioning(false, 0)).toBe(false)
  })
})

describe("isPathMention", () => {
  it("returns true for a file path", () => {
    expect(isPathMention("@src/foo.ts")).toBe(true)
  })

  it("returns true for a simple filename", () => {
    expect(isPathMention("@README.md")).toBe(true)
  })

  it("returns true for a folder path with trailing slash", () => {
    expect(isPathMention("@src/components/")).toBe(true)
  })

  it("returns true for a folder path without trailing slash", () => {
    expect(isPathMention("@src/components")).toBe(true)
  })

  it("returns false for terminal mention", () => {
    expect(isPathMention("@terminal")).toBe(false)
  })

  it("returns false for git-changes mention", () => {
    expect(isPathMention("@git-changes")).toBe(false)
  })

  it("handles text without @ prefix", () => {
    expect(isPathMention("src/foo.ts")).toBe(true)
  })
})

describe("memoryRest", () => {
  it("keeps trailing text in the input after a no-argument memory command", () => {
    // /memory rebuild hello -> rebuild executes, "hello" stays in the input.
    // This is the submit-path half of the trailing-text bug: handleSend sets
    // the input to memoryRest(parsed), so a regression would drop "hello".
    const memory = parseMemoryCommand("/memory rebuild hello")
    expect(memory).not.toBeUndefined()
    expect(memoryRest(memory!)).toBe("hello")
  })

  it("keeps trailing text through the project scope", () => {
    expect(memoryRest(parseMemoryCommand("/memory project rebuild hello")!)).toBe("hello")
  })

  it("returns empty string when a no-argument command has no trailing text", () => {
    expect(memoryRest(parseMemoryCommand("/memory rebuild")!)).toBe("")
  })

  it("keeps trailing text in the input after the show command", () => {
    // /memory show draft notes -> show executes, "draft notes" stays in the input.
    expect(memoryRest(parseMemoryCommand("/memory show draft notes")!)).toBe("draft notes")
  })

  it("returns empty string for argument-taking operations", () => {
    // remember/correct/forget/auto/purge consume their text, so nothing remains.
    expect(memoryRest(parseMemoryCommand("/memory remember hello")!)).toBe("")
    expect(memoryRest(parseMemoryCommand("/memory auto on")!)).toBe("")
  })
})

describe("paste collapse thresholds", () => {
  it("counts lines from newlines plus one", () => {
    expect(promptLineCount("one")).toBe(1)
    expect(promptLineCount("one\ntwo")).toBe(2)
    expect(promptLineCount("a\nb\nc\nd\ne")).toBe(5)
  })

  it("collapses at fifteen lines or more than 4000 characters", () => {
    expect(isCollapsiblePaste("a\nb\nc\nd\ne")).toBe(false)
    expect(isCollapsiblePaste(Array.from({ length: 15 }, () => "a").join("\n"))).toBe(true)
    expect(isCollapsiblePaste("a".repeat(4001))).toBe(true)
    expect(isCollapsiblePaste("a".repeat(4000))).toBe(false)
  })

  it("builds the canonical placeholder", () => {
    expect(pastePlaceholder("a\nb\nc\nd\ne")).toBe("[Pasted ~5 lines]")
    expect(pastePlaceholder("a".repeat(801))).toBe("[Pasted ~1 lines]")
  })
})

describe("findPastePlaceholders", () => {
  it("finds every placeholder with its range", () => {
    const text = "[Pasted ~5 lines] then [Pasted ~12 lines]"
    expect(findPastePlaceholders(text)).toEqual([
      { start: 0, end: 17 },
      { start: 23, end: 41 },
    ])
  })

  it("ignores look-alike text that is not a placeholder", () => {
    expect(findPastePlaceholders("[Pasted 5 lines]")).toEqual([])
    expect(findPastePlaceholders("Pasted ~5 lines")).toEqual([])
  })

  it("finds no placeholder in ordinary pasted text", () => {
    expect(findPastePlaceholders("hello\nworld")).toEqual([])
  })
})

describe("textDiff", () => {
  it("locates an insertion", () => {
    expect(textDiff("abcd", "abXcd")).toEqual({ start: 2, oldEnd: 2, newEnd: 3, delta: 1 })
  })

  it("locates a deletion", () => {
    expect(textDiff("abXcd", "abcd")).toEqual({ start: 2, oldEnd: 3, newEnd: 2, delta: -1 })
  })

  it("locates a replacement", () => {
    expect(textDiff("abcd", "abXYd")).toEqual({ start: 2, oldEnd: 3, newEnd: 4, delta: 1 })
  })
})

describe("shiftPastes", () => {
  const paste = (id: number, start: number, text: string): PasteRange => ({
    id,
    start,
    end: start + "[Pasted ~5 lines]".length,
    text,
  })

  it("keeps a block before the edit unchanged", () => {
    const prev = "[Pasted ~5 lines] tail"
    const next = "[Pasted ~5 lines] tail more"
    const [moved] = shiftPastes([paste(1, 0, "body")], prev, next)
    expect(moved).toEqual(paste(1, 0, "body"))
  })

  it("moves a block after an insertion", () => {
    const prev = "lead [Pasted ~5 lines]"
    const next = "lead more [Pasted ~5 lines]"
    const [moved] = shiftPastes([paste(1, 5, "body")], prev, next)
    expect(moved?.start).toBe(10)
  })

  it("moves a block after a deletion", () => {
    const prev = "lead more [Pasted ~5 lines]"
    const next = "lead [Pasted ~5 lines]"
    const [moved] = shiftPastes([paste(1, 10, "body")], prev, next)
    expect(moved?.start).toBe(5)
  })

  it("drops a block whose placeholder was edited away", () => {
    const prev = "[Pasted ~5 lines]"
    const next = "[Pasted ~5 line]"
    expect(shiftPastes([paste(1, 0, "body")], prev, next)).toEqual([])
  })

  it("drops a block when the edit happens inside it", () => {
    const prev = "[Pasted ~5 lines]"
    const next = "[Pasted ~55 lines]"
    expect(shiftPastes([paste(1, 0, "body")], prev, next)).toEqual([])
  })

  it("keeps identical placeholders addressed independently", () => {
    const prev = "[Pasted ~5 lines] and [Pasted ~5 lines]"
    const second = prev.indexOf("[Pasted ~5 lines]", 1)
    const gap = prev.indexOf(" and ") + " and ".length
    const next = prev.slice(0, gap) + "   " + prev.slice(gap)
    const moved = shiftPastes([paste(1, 0, "one"), paste(2, second, "two")], prev, next)
    expect(moved.map((item) => item.text)).toEqual(["one", "two"])
    expect(moved[0]?.start).toBe(0)
    expect(moved[1]?.start).toBe(second + 3)
  })
})

describe("rebasePastes", () => {
  const token = (lines: number) => `[Pasted ~${lines} lines]`
  const chip = (id: number, start: number, text: string, lines = 5): PasteRange => {
    const mark = token(lines)
    return { id, start, end: start + mark.length, text }
  }

  it("keeps the second backing when the first of two identical chips is deleted", () => {
    const mark = token(5)
    const pastes = [chip(1, 0, "first"), chip(2, mark.length + 1, "second")]
    const moved = rebasePastes(pastes, 0, mark.length + 1, 0)
    expect(moved.map((item) => item.text)).toEqual(["second"])
    expect(moved[0]).toEqual(chip(2, 0, "second"))
  })

  it("keeps the survivor backing when a differently sized chip precedes it", () => {
    const mark = token(5)
    const big = token(10)
    const pastes = [chip(1, 0, "first"), chip(2, mark.length + 1, "second", 10)]
    const moved = rebasePastes(pastes, 0, mark.length + 1, 0)
    expect(moved.map((item) => item.text)).toEqual(["second"])
    expect(moved[0]).toEqual(chip(2, 0, "second", 10))
    expect(moved[0]?.end).toBe(big.length)
  })

  it("shifts a chip that sits after the edit", () => {
    const moved = rebasePastes([chip(1, 5, "body")], 0, 0, 4)
    expect(moved).toEqual([chip(1, 9, "body")])
  })

  it("keeps a chip that ends at the edit boundary", () => {
    const mark = token(5)
    const moved = rebasePastes([chip(1, 0, "body")], mark.length, mark.length, 3)
    expect(moved).toEqual([chip(1, 0, "body")])
  })

  it("drops a chip the edit overlaps", () => {
    const mark = token(5)
    expect(rebasePastes([chip(1, 0, "body")], 0, mark.length, 0)).toEqual([])
  })
})

describe("pasteInsertion", () => {
  const mark = "[Pasted ~5 lines]"

  it("lands the caret after the separator spaces, not inside the following text", () => {
    const result = pasteInsertion("helloworld", 5, 5, mark)
    expect(result.text).toBe(`hello ${mark} world`)
    expect(result.caret).toBe(`hello ${mark} `.length)
    expect(result.text.slice(result.caret)).toBe("world")
  })

  it("wraps the chip range around the placeholder only", () => {
    const result = pasteInsertion("helloworld", 5, 5, mark)
    expect(result.text.slice(result.start, result.end)).toBe(mark)
  })

  it("omits the prefix space when the text before already ends in whitespace", () => {
    const result = pasteInsertion("hello world", 6, 6, mark)
    expect(result.text).toBe(`hello ${mark} world`)
    expect(result.start).toBe(6)
    expect(result.text.slice(result.start, result.end)).toBe(mark)
  })

  it("replaces a selection with the chip", () => {
    const result = pasteInsertion("hello world", 5, 6, mark)
    expect(result.text).toBe(`hello ${mark} world`)
    expect(result.text.slice(result.start, result.end)).toBe(mark)
  })
})

describe("expandPastes", () => {
  const paste = (id: number, start: number, text: string): PasteRange => ({
    id,
    start,
    end: start + "[Pasted ~5 lines]".length,
    text,
  })

  it("restores the full content of a single block", () => {
    expect(expandPastes("[Pasted ~5 lines]", [paste(1, 0, "a\nb\nc\nd\ne")])).toBe("a\nb\nc\nd\ne")
  })

  it("restores identical placeholders to their own content, back to front", () => {
    const text = "[Pasted ~5 lines] then [Pasted ~5 lines]"
    const expanded = expandPastes(text, [paste(1, 0, "first"), paste(2, 23, "second")])
    expect(expanded).toBe("first then second")
  })

  it("leaves placeholder-looking text with no backing unchanged", () => {
    expect(expandPastes("typed [Pasted ~5 lines]", [])).toBe("typed [Pasted ~5 lines]")
  })
})

describe("buildPromptSegments", () => {
  const paste = (id: number, start: number, text: string): PasteRange => ({
    id,
    start,
    end: start + "[Pasted ~5 lines]".length,
    text,
  })

  it("marks a collapsed block as a paste chip", () => {
    expect(buildPromptSegments("[Pasted ~5 lines] done", new Set(), [paste(7, 0, "body")])).toEqual([
      { text: "[Pasted ~5 lines]", kind: "paste", paste: 7 },
      { text: " done", kind: "plain" },
    ])
  })

  it("still highlights mentions around a paste", () => {
    const text = "@foo.ts [Pasted ~5 lines]"
    const segments = buildPromptSegments(text, new Set(["foo.ts"]), [paste(1, 8, "body")])
    expect(segments).toEqual([
      { text: "@foo.ts", kind: "mention" },
      { text: " ", kind: "plain" },
      { text: "[Pasted ~5 lines]", kind: "paste", paste: 1 },
    ])
  })

  it("renders a placeholder with no backing as plain text", () => {
    expect(buildPromptSegments("[Pasted ~5 lines]", new Set(), [])).toEqual([
      { text: "[Pasted ~5 lines]", kind: "plain" },
    ])
  })

  it("returns an empty list for empty text", () => {
    expect(buildPromptSegments("", new Set(), [])).toEqual([])
  })
})

describe("undoKey", () => {
  const chord = (
    key: string,
    init: { code?: number; ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {},
  ) =>
    ({
      key,
      keyCode: init.code ?? 0,
      ctrlKey: !!init.ctrl,
      metaKey: !!init.meta,
      shiftKey: !!init.shift,
      altKey: !!init.alt,
    }) as unknown as KeyboardEvent

  it("maps Ctrl and Meta z to undo", () => {
    expect(undoKey(chord("z", { code: 90, ctrl: true }))).toBe("undo")
    expect(undoKey(chord("z", { code: 90, meta: true }))).toBe("undo")
  })

  it("maps Shift+z and y to redo", () => {
    expect(undoKey(chord("Z", { code: 90, meta: true, shift: true }))).toBe("redo")
    expect(undoKey(chord("y", { code: 89, ctrl: true }))).toBe("redo")
  })

  it("matches non-Latin layouts by keyCode", () => {
    expect(undoKey(chord("ז", { code: 90, meta: true }))).toBe("undo")
  })

  it("ignores alt, missing modifiers, and unsupported chords", () => {
    expect(undoKey(chord("z", { code: 90, meta: true, alt: true }))).toBeUndefined()
    expect(undoKey(chord("z", { code: 90 }))).toBeUndefined()
    expect(undoKey(chord("Y", { code: 89, ctrl: true, shift: true }))).toBeUndefined()
    expect(undoKey(chord("c", { code: 67, meta: true }))).toBeUndefined()
  })
})
