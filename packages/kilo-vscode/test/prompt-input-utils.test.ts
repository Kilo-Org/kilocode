import { describe, expect, it } from "bun:test"
import {
  buildPromptSegments,
  expandPastes,
  fileName,
  findPastePlaceholders,
  inputSpan,
  isCollapsiblePaste,
  pasteInsertion,
  pastePlaceholder,
  promptLineCount,
  rebasePastes,
  shiftPastes,
  spanEdit,
  textDiff,
  type PasteRange,
} from "../webview-ui/src/components/chat/prompt-input-utils"

describe("fileName", () => {
  it("extracts the last segment of a unix path", () => {
    expect(fileName("/home/user/project/src/index.ts")).toBe("index.ts")
  })

  it("extracts the last segment of a Windows path", () => {
    expect(fileName("C:\\Users\\me\\project\\src\\index.ts")).toBe("index.ts")
  })

  it("returns the path itself when no separator is present", () => {
    expect(fileName("index.ts")).toBe("index.ts")
  })

  it("handles mixed separators and a trailing slash", () => {
    expect(fileName("src/utils\\index.ts/")).toBe("index.ts")
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

  it("moves an insertion before a repeated character", () => {
    expect(textDiff("[Pasted ~5 lines]", "[[Pasted ~5 lines]")).toEqual({
      start: 0,
      oldEnd: 0,
      newEnd: 1,
      delta: 1,
    })
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

  it("keeps the backing when the user types at the chip start", () => {
    const prev = "[Pasted ~5 lines]"
    const next = "[[Pasted ~5 lines]"
    const [moved] = shiftPastes([paste(1, 0, "body")], prev, next)
    expect(moved).toEqual(paste(1, 1, "body"))
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

describe("spanEdit", () => {
  it("accepts the span a deletion replaced", () => {
    const mark = "[Pasted ~5 lines]"
    const prev = `${mark} ${mark}`
    expect(spanEdit(prev, mark, 0, mark.length + 1)).toEqual({ start: 0, end: mark.length + 1, length: 0 })
  })

  it("accepts the span of an insertion", () => {
    expect(spanEdit("ab", "aXYb", 1, 1)).toEqual({ start: 1, end: 1, length: 2 })
  })

  it("accepts the span of a replacement", () => {
    expect(spanEdit("abcd", "aXd", 1, 3)).toEqual({ start: 1, end: 3, length: 1 })
  })

  it("rejects a span the surrounding text contradicts", () => {
    expect(spanEdit("abcd", "abd", 0, 1)).toBeUndefined()
  })

  it("rejects a span that is not a range inside the previous text", () => {
    expect(spanEdit("ab", "a", 0, 5)).toBeUndefined()
    expect(spanEdit("ab", "a", 2, 1)).toBeUndefined()
  })

  it("rejects a span too narrow to account for the text that is gone", () => {
    expect(spanEdit("abcdef", "a", 0, 1)).toBeUndefined()
  })

  it("resolves a deletion that two identical chips leave ambiguous in the text alone", () => {
    const mark = "[Pasted ~5 lines]"
    const prev = `${mark} ${mark}`
    const pastes: PasteRange[] = [
      { id: 1, start: 0, end: mark.length, text: "first" },
      { id: 2, start: mark.length + 1, end: prev.length, text: "second" },
    ]
    const edit = spanEdit(prev, mark, 0, mark.length + 1)!
    expect(expandPastes(mark, rebasePastes(pastes, edit.start, edit.end, edit.length))).toBe("second")

    const other = spanEdit(prev, mark, mark.length, prev.length)!
    expect(expandPastes(mark, rebasePastes(pastes, other.start, other.end, other.length))).toBe("first")
  })
})

describe("inputSpan", () => {
  const mark = "[Pasted ~5 lines]"
  const prev = `${mark} ${mark}`
  const field = (start: number, end: number) =>
    ({ value: prev, selectionStart: start, selectionEnd: end }) as HTMLTextAreaElement
  const event = (inputType: string) => ({ inputType }) as InputEvent

  it("reports the replaced selection that tells two identical chips apart", () => {
    const pastes: PasteRange[] = [
      { id: 1, start: 0, end: mark.length, text: "first" },
      { id: 2, start: mark.length + 1, end: prev.length, text: "second" },
    ]
    const span = inputSpan(event("deleteContentBackward"), field(0, mark.length + 1))!
    const edit = spanEdit(prev, mark, span.start, span.end)!
    expect(expandPastes(mark, rebasePastes(pastes, edit.start, edit.end, edit.length))).toBe("second")

    const other = inputSpan(event("deleteContentBackward"), field(mark.length, prev.length))!
    const back = spanEdit(prev, mark, other.start, other.end)!
    expect(expandPastes(mark, rebasePastes(pastes, back.start, back.end, back.length))).toBe("first")
  })

  it("reports no span when the selection is a caret", () => {
    expect(inputSpan(event("deleteContentBackward"), field(mark.length + 1, mark.length + 1))).toBeUndefined()
  })

  it("reports no span for undo and redo, which replay a span of their own", () => {
    expect(inputSpan(event("historyUndo"), field(0, mark.length + 1))).toBeUndefined()
    expect(inputSpan(event("historyRedo"), field(0, mark.length + 1))).toBeUndefined()
  })

  it("reports no span when there is no field to read the selection from", () => {
    expect(inputSpan(event("insertText"), undefined)).toBeUndefined()
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

  it("expands a backed block and leaves an extra literal placeholder alone", () => {
    const text = "[Pasted ~5 lines] and [Pasted ~5 lines]"
    expect(expandPastes(text, [paste(1, 0, "body")])).toBe("body and [Pasted ~5 lines]")
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
    expect(buildPromptSegments("[Pasted ~5 lines] done", [paste(7, 0, "body")])).toEqual([
      { text: "[Pasted ~5 lines]", kind: "paste", paste: 7 },
      { text: " done", kind: "plain" },
    ])
  })

  it("renders a placeholder with no backing as plain text", () => {
    expect(buildPromptSegments("[Pasted ~5 lines]", [])).toEqual([{ text: "[Pasted ~5 lines]", kind: "plain" }])
  })

  it("returns an empty list for empty text", () => {
    expect(buildPromptSegments("", [])).toEqual([])
  })
})
