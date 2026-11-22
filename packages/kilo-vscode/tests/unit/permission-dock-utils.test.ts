import { describe, it, expect } from "bun:test"
import {
  displayLines,
  displayText,
  removableRuleIndices,
  savedRuleStates,
} from "../../webview-ui/src/components/chat/permission-dock-utils"

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

describe("removableRuleIndices", () => {
  const call = (input: {
    rules: string[]
    global?: Parameters<typeof savedRuleStates>[1]
    target?: Parameters<typeof savedRuleStates>[1]
    workspace?: Parameters<typeof savedRuleStates>[1]
    effective: Record<number, "approved" | "denied">
  }) =>
    removableRuleIndices({
      ...input,
      target: "target" in input ? input.target : input.global,
    })

  it("marks a row the global config tiles", () => {
    expect(call({ rules: ["npm *", "git *"], global: { "npm *": "allow" }, effective: { 0: "approved" } })).toEqual(
      new Set([0]),
    )
  })

  it("marks a denied row the global config tiles", () => {
    expect(call({ rules: ["rm *"], global: { "rm *": "deny" }, workspace: {}, effective: { 0: "denied" } })).toEqual(
      new Set([0]),
    )
  })

  it("leaves a row alone when the global config has no entry for it", () => {
    expect(call({ rules: ["npm *"], global: { "git *": "allow" }, effective: { 0: "approved" } })).toEqual(new Set())
  })

  it("leaves a row alone when the effective state disagrees with the global entry", () => {
    expect(call({ rules: ["npm *"], global: { "npm *": "allow" }, effective: { 0: "denied" } })).toEqual(new Set())
  })

  it("treats a scalar global rule as covering the wildcard row only", () => {
    expect(call({ rules: ["*", "npm *"], global: "allow", effective: { 0: "approved" } })).toEqual(new Set([0]))
  })

  it("returns nothing for an absent global rule", () => {
    expect(call({ rules: ["npm *"], effective: { 0: "approved" } })).toEqual(new Set())
  })

  it("leaves a row alone when the workspace scope supplies the same pattern", () => {
    expect(
      call({
        rules: ["npm *"],
        global: { "npm *": "allow" },
        workspace: { "npm *": "allow" },
        effective: { 0: "approved" },
      }),
    ).toEqual(new Set())
  })

  it("keeps other rows of the same tool in scope", () => {
    expect(
      call({
        rules: ["npm *", "git *"],
        global: { "npm *": "allow", "git *": "allow" },
        workspace: { "git *": "allow" },
        effective: { 0: "approved", 1: "approved" },
      }),
    ).toEqual(new Set([0]))
  })

  it("leaves a row alone when the workspace scope holds a catch-all", () => {
    expect(
      call({
        rules: ["touch *"],
        global: { "touch *": "allow" },
        workspace: { "*": "allow" },
        effective: { 0: "approved" },
      }),
    ).toEqual(new Set())
  })

  it("leaves a row alone when the workspace scope covers its pattern", () => {
    expect(
      call({
        rules: ["touch"],
        global: { touch: "allow" },
        workspace: { "touch *": "allow" },
        effective: { 0: "approved" },
      }),
    ).toEqual(new Set())
  })

  it("leaves every row alone when the workspace scope is a scalar rule", () => {
    expect(
      call({
        rules: ["npm *", "git *"],
        global: { "npm *": "allow", "git *": "allow" },
        workspace: "deny",
        effective: { 0: "approved", 1: "approved" },
      }),
    ).toEqual(new Set())
  })

  it("keeps a row in scope when the workspace catch-all only asks", () => {
    expect(
      call({
        rules: ["touch *"],
        global: { "touch *": "allow" },
        workspace: { "*": "ask" },
        effective: { 0: "approved" },
      }),
    ).toEqual(new Set([0]))
  })

  it("keeps a row in scope when the scalar workspace rule only asks", () => {
    expect(
      call({
        rules: ["touch *"],
        global: { "touch *": "allow" },
        workspace: "ask",
        effective: { 0: "approved" },
      }),
    ).toEqual(new Set([0]))
  })

  it("leaves a row alone when a workspace entry matches across separators", () => {
    expect(
      call({
        rules: ["src\\foo.ts"],
        global: { "src\\foo.ts": "allow" },
        workspace: { "src/*": "allow" },
        effective: { 0: "approved" },
      }),
    ).toEqual(new Set())
  })

  it("leaves a row alone when a workspace entry matches with different letter case", () => {
    expect(
      call({
        rules: ["src/foo.ts"],
        global: { "src/foo.ts": "allow" },
        workspace: { "SRC/*": "allow" },
        effective: { 0: "approved" },
      }),
    ).toEqual(new Set())
  })

  it("keeps an unrelated row in scope when the workspace scope covers another pattern", () => {
    expect(
      call({
        rules: ["npm *"],
        global: { "npm *": "allow" },
        workspace: { "git *": "allow" },
        effective: { 0: "approved" },
      }),
    ).toEqual(new Set([0]))
  })

  it("leaves a row alone when the merged global scope also holds a catch-all with the same action", () => {
    expect(
      call({
        rules: ["touch *"],
        global: { "touch *": "allow", "*": "allow" },
        effective: { 0: "approved" },
      }),
    ).toEqual(new Set())
  })

  it("leaves a row alone when the merged global scope is a scalar with the same action", () => {
    expect(call({ rules: ["touch *"], global: "allow", effective: { 0: "approved" } })).toEqual(new Set())
  })

  it("keeps rows in scope when the merged global catch-all only asks", () => {
    expect(
      call({
        rules: ["touch *", "npm *"],
        global: { "*": "ask", "touch *": "allow", "npm *": "allow" },
        effective: { 0: "approved", 1: "approved" },
      }),
    ).toEqual(new Set([0, 1]))
  })

  it("leaves a denied row alone when the merged global scope also denies a broader pattern", () => {
    expect(
      call({
        rules: ["rm *"],
        global: { "*": "deny", "rm *": "deny" },
        effective: { 0: "denied" },
      }),
    ).toEqual(new Set())
  })

  it("keeps a row in scope when the primary global file holds its pattern", () => {
    expect(
      call({
        rules: ["touch *"],
        global: { "*": "ask", "touch *": "allow" },
        target: { "touch *": "allow" },
        effective: { 0: "approved" },
      }),
    ).toEqual(new Set([0]))
  })

  it("leaves a row alone when only a lower global file holds its pattern", () => {
    expect(
      call({
        rules: ["touch *"],
        global: { "*": "ask", "touch *": "allow" },
        target: { "*": "ask" },
        effective: { 0: "approved" },
      }),
    ).toEqual(new Set())
  })

  it("leaves a row alone when the primary global file has no entry for the tool", () => {
    expect(
      call({
        rules: ["touch *"],
        global: { "*": "ask", "touch *": "allow" },
        target: undefined,
        effective: { 0: "approved" },
      }),
    ).toEqual(new Set())
  })

  it("leaves the wildcard row alone when the merged scalar comes from a lower global file", () => {
    expect(
      call({
        rules: ["*"],
        global: "allow",
        target: {},
        effective: { 0: "approved" },
      }),
    ).toEqual(new Set())
  })

  it("keeps the wildcard row in scope when the primary global file holds the scalar", () => {
    expect(call({ rules: ["*"], global: "allow", target: "allow", effective: { 0: "approved" } })).toEqual(new Set([0]))
  })
})
