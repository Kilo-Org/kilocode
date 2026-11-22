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
    expect(displayLines("{\n  \"a\": \"x\u200by\ufeff\"\n}")).toBe("{\n  \"a\": \"x\\u200by\\ufeff\"\n}")
  })

  it("escapes zero-width format characters in block text", () => {
    expect(displayLines("{\n  \"a\": \"x\u2060y\u2064\"\n}")).toBe("{\n  \"a\": \"x\\u2060y\\u2064\"\n}")
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
