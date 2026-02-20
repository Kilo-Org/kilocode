import { describe, it, expect } from "bun:test"
import {
  shouldSkipAutocomplete,
  getTerminatorsForLanguage,
} from "../../src/services/autocomplete/classic-auto-complete/contextualSkip"

describe("getTerminatorsForLanguage", () => {
  it("returns c-like terminators for typescript", () => {
    const t = getTerminatorsForLanguage("typescript")
    expect(t).toContain(";")
    expect(t).toContain("}")
    expect(t).toContain(")")
    expect(t).not.toContain(",")
  })

  it("returns python terminators (brackets, no semicolon)", () => {
    const t = getTerminatorsForLanguage("python")
    expect(t).toContain(")")
    expect(t).toContain("]")
    expect(t).toContain("}")
    expect(t).not.toContain(";")
  })

  it("returns empty terminators for html", () => {
    expect(getTerminatorsForLanguage("html")).toHaveLength(0)
  })

  it("returns shell terminators including fi and done", () => {
    const t = getTerminatorsForLanguage("shellscript")
    expect(t).toContain(";")
    expect(t).toContain("fi")
    expect(t).toContain("done")
  })

  it("returns default terminators for unknown language", () => {
    const t = getTerminatorsForLanguage("unknown-lang")
    expect(t).toContain(";")
    expect(t).toContain("}")
    expect(t).toContain(")")
  })

  it("returns default terminators when languageId is undefined", () => {
    const t = getTerminatorsForLanguage(undefined)
    expect(t).toContain(";")
  })
})

describe("shouldSkipAutocomplete - end of statement", () => {
  it("skips after semicolon in typescript", () => {
    expect(shouldSkipAutocomplete("const x = 5;", "\n", "typescript")).toBe(true)
  })

  it("skips after closing brace in typescript", () => {
    expect(shouldSkipAutocomplete("}", "\n", "typescript")).toBe(true)
  })

  it("skips after closing paren in typescript", () => {
    expect(shouldSkipAutocomplete("myFunction()", "\n", "typescript")).toBe(true)
  })

  it("does not skip after colon in typescript", () => {
    expect(shouldSkipAutocomplete("  key:", "\n", "typescript")).toBe(false)
  })

  it("does not skip after opening brace", () => {
    expect(shouldSkipAutocomplete("if (condition) {", "\n", "typescript")).toBe(false)
  })

  it("does not skip when suffix has non-whitespace on same line", () => {
    expect(shouldSkipAutocomplete("const x = ", " + 1;\n", "typescript")).toBe(false)
  })

  it("does not skip on empty line", () => {
    expect(shouldSkipAutocomplete("", "\n", "typescript")).toBe(false)
  })

  it("skips after semicolon with trailing whitespace", () => {
    expect(shouldSkipAutocomplete("const x = 5;  ", "\n", "typescript")).toBe(true)
  })

  it("does not skip in python after colon (block start)", () => {
    expect(shouldSkipAutocomplete("def foo():", "\n", "python")).toBe(false)
  })

  it("skips in python after closing paren", () => {
    expect(shouldSkipAutocomplete("print('hello')", "\n", "python")).toBe(true)
  })

  it("skips in html due to mid-word typing (not terminator)", () => {
    expect(shouldSkipAutocomplete("<div", "\n", "html")).toBe(true)
  })

  it("does not skip in html after closing tag", () => {
    expect(shouldSkipAutocomplete("</div>", "\n", "html")).toBe(false)
  })
})

describe("shouldSkipAutocomplete - mid-word typing", () => {
  it("skips when typing a word longer than 2 chars", () => {
    expect(shouldSkipAutocomplete("myVariable", "\n", "typescript")).toBe(true)
  })

  it("does not skip for 1-2 char word", () => {
    expect(shouldSkipAutocomplete("my", "\n", "typescript")).toBe(false)
    expect(shouldSkipAutocomplete("x", "\n", "typescript")).toBe(false)
  })

  it("skips when suffix starts with word character", () => {
    expect(shouldSkipAutocomplete("if (", "condition) {\n", "typescript")).toBe(true)
  })

  it("does not skip when prefix is empty", () => {
    expect(shouldSkipAutocomplete("", "", "typescript")).toBe(false)
  })
})

describe("shouldSkipAutocomplete - defaults", () => {
  it("uses default terminators when no languageId provided", () => {
    expect(shouldSkipAutocomplete("const x = 5;", "\n")).toBe(true)
    expect(shouldSkipAutocomplete("}", "\n")).toBe(true)
  })

  it("does not skip on empty input with no language", () => {
    expect(shouldSkipAutocomplete("", "")).toBe(false)
  })
})
