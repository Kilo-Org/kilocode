import { describe, it, expect } from "bun:test"
import { displayLines, displayText, savedRuleStates } from "../../webview-ui/src/components/chat/permission-dock-utils"

describe("displayText", () => {
  it("leaves ordinary commands, including astral characters, untouched", () => {
    expect(displayText("git status && printf 'hi 😀'")).toBe("git status && printf 'hi 😀'")
  })

  it("escapes whitespace controls with readable shorthands", () => {
    expect(displayText("a\nb\rc\td")).toBe("a\\nb\\rc\\td")
  })

  it("escapes format controls in single-line text", () => {
    expect(displayText("rm \u202Etxt.exe")).toBe("rm \\u202etxt.exe")
  })

  it("uses \\x for C0/C1 controls and \\u for higher code points", () => {
    expect(displayText("\u0000\u009f\u2066")).toBe("\\x00\\x9f\\u2066")
  })

  it("escapes invisible format characters in single-line text", () => {
    expect(displayText("\u200b\u200c\u200d\ufeff\u061c\u2060\u2064")).toBe(
      "\\u200b\\u200c\\u200d\\ufeff\\u061c\\u2060\\u2064",
    )
  })

  it("escapes each invisible format character without affecting its neighbours", () => {
    expect(displayText("readme\u200b.exe")).toBe("readme\\u200b.exe")
    expect(displayText("a\u200cb")).toBe("a\\u200cb")
    expect(displayText("a\u200db")).toBe("a\\u200db")
    expect(displayText("\ufeffname")).toBe("\\ufeffname")
    expect(displayText("a\u061cb")).toBe("a\\u061cb")
    expect(displayText("a\u2060b")).toBe("a\\u2060b")
    expect(displayText("a\u2064b")).toBe("a\\u2064b")
  })

  it("escapes width-less format characters from several planes", () => {
    expect(displayText("\u{E0041}")).toBe("\\u{e0041}")
    expect(displayText("\uFE0F")).toBe("\\ufe0f")
    expect(displayText("\u{E0100}")).toBe("\\u{e0100}")
    expect(displayText("\u00AD")).toBe("\\xad")
  })

  it("escapes supplementary-plane format characters without affecting their neighbours", () => {
    expect(displayText("a\u{E0041}b")).toBe("a\\u{e0041}b")
    expect(displayText("hi \u{1F600}")).toBe("hi \u{1F600}")
  })

  it("escapes the default-ignorable set in single-line text", () => {
    expect(displayText("a\u034Fb")).toBe("a\\u034fb")
    expect(displayText("a\u180Eb")).toBe("a\\u180eb")
    expect(displayText("a\u{1BCA0}b")).toBe("a\\u{1bca0}b")
    expect(displayText("a\u{1D173}b")).toBe("a\\u{1d173}b")
  })

  it("leaves ordinary non-ASCII text untouched", () => {
    expect(displayText("проект/文件/😀")).toBe("проект/文件/😀")
  })
})

describe("displayLines", () => {
  it("keeps LF as a real newline while escaping other controls", () => {
    expect(displayLines("a\nb\rc\td")).toBe("a\nb\\rc\\td")
  })

  it("escapes format controls in block text", () => {
    expect(displayLines("rm \u202Etxt.exe")).toBe("rm \\u202etxt.exe")
  })

  it("leaves ordinary multi-line text untouched", () => {
    expect(displayLines('{\n  "a": 1\n}')).toBe('{\n  "a": 1\n}')
  })

  it("escapes invisible format characters in block text", () => {
    expect(displayLines('{\n  "a": "x\u200by\ufeff"\n}')).toBe('{\n  "a": "x\\u200by\\ufeff"\n}')
  })

  it("escapes zero-width format characters in block text", () => {
    expect(displayLines('{\n  "a": "x\u2060y\u2064"\n}')).toBe('{\n  "a": "x\\u2060y\\u2064"\n}')
  })

  it("escapes width-less format characters from several planes in block text", () => {
    expect(displayLines("\u{E0041}")).toBe("\\u{e0041}")
    expect(displayLines("\uFE0F")).toBe("\\ufe0f")
    expect(displayLines("\u{E0100}")).toBe("\\u{e0100}")
    expect(displayLines("\u00AD")).toBe("\\xad")
  })

  it("escapes the default-ignorable set in block text", () => {
    expect(displayLines('{\n  "a": "x\u{1BCA0}y\u034Fz"\n}')).toBe('{\n  "a": "x\\u{1bca0}y\\u034fz"\n}')
  })
})

describe("savedRuleStates", () => {
  it("returns empty map when rule is undefined", () => {
    expect(savedRuleStates(["npm *", "git *"], undefined)).toEqual({})
  })

  it("returns empty map when rules array is empty", () => {
    expect(savedRuleStates([], { "npm *": "allow" })).toEqual({})
  })

  it("populates approved entries from config", () => {
    const result = savedRuleStates(["npm *", "git *", "rm *"], { "npm *": "allow", "rm *": "allow" })
    expect(result).toEqual({ 0: "approved", 2: "approved" })
  })

  it("populates denied entries from config", () => {
    const result = savedRuleStates(["npm *", "rm *"], { "rm *": "deny" })
    expect(result).toEqual({ 1: "denied" })
  })

  it("populates mixed approved and denied", () => {
    const result = savedRuleStates(["npm *", "git *", "rm *"], {
      "npm *": "allow",
      "git *": "deny",
    })
    expect(result).toEqual({ 0: "approved", 1: "denied" })
  })

  it("skips ask entries (they stay pending)", () => {
    const result = savedRuleStates(["npm *", "git *"], { "npm *": "ask", "git *": "allow" })
    expect(result).toEqual({ 1: "approved" })
  })

  it("handles scalar rule with wildcard in rules array", () => {
    const result = savedRuleStates(["*"], "allow")
    expect(result).toEqual({ 0: "approved" })
  })

  it("handles scalar rule with non-wildcard patterns (all pending)", () => {
    const result = savedRuleStates(["npm *", "git *"], "allow")
    expect(result).toEqual({})
  })

  it("returns empty map for scalar ask with wildcard", () => {
    const result = savedRuleStates(["*"], "ask")
    expect(result).toEqual({})
  })

  it("returns denied for scalar deny with wildcard", () => {
    const result = savedRuleStates(["*"], "deny")
    expect(result).toEqual({ 0: "denied" })
  })

  it("returns pending for patterns not in config object", () => {
    const result = savedRuleStates(["npm *", "git *"], { "npm *": "allow" })
    expect(result).toEqual({ 0: "approved" })
  })

  it("returns empty map for empty config object", () => {
    const result = savedRuleStates(["npm *"], {})
    expect(result).toEqual({})
  })
})
