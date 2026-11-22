import { describe, it, expect } from "bun:test"
import {
  displaySkillCommand,
  removableRuleIndices,
  savedRuleStates,
} from "../../webview-ui/src/components/chat/permission-dock-utils"

describe("displaySkillCommand", () => {
  it("leaves ordinary commands, including astral characters, untouched", () => {
    expect(displaySkillCommand("git status && printf 'hi 😀'")).toBe("git status && printf 'hi 😀'")
  })

  it("escapes whitespace controls with readable shorthands", () => {
    expect(displaySkillCommand("a\nb\rc\td")).toBe("a\\nb\\rc\\td")
  })

  it("escapes bidi/format controls so the visible text can't be reordered", () => {
    // U+202E (RLO) would otherwise reverse the trailing text in the prompt.
    expect(displaySkillCommand("rm \u202Etxt.exe")).toBe("rm \\u202etxt.exe")
  })

  it("uses \\x for C0/C1 controls and \\u for higher code points", () => {
    expect(displaySkillCommand("\u0000\u009f\u2066")).toBe("\\x00\\x9f\\u2066")
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
    workspace?: Parameters<typeof savedRuleStates>[1]
    effective: Record<number, "approved" | "denied">
  }) => removableRuleIndices(input)

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
})
