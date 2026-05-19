import { describe, it, expect } from "bun:test"
import {
  MAX_FULL_COMMAND_RULE_LENGTH,
  commandRuleOptions,
  displayCommandRule,
  isFullCommandRule,
  savedRuleStates,
} from "../../webview-ui/src/components/chat/permission-dock-utils"

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

describe("commandRuleOptions", () => {
  it("adds the full command as an exact auto-approve option when it is short enough", () => {
    expect(commandRuleOptions(["npm *", "npm install *"], "npm install lodash", ["npm install lodash"])).toEqual([
      "npm *",
      "npm install *",
      "npm install lodash",
    ])
  })

  it("does not duplicate an existing full command option", () => {
    expect(commandRuleOptions(["npm *", "npm install lodash"], "npm install lodash", ["npm install lodash"])).toEqual([
      "npm *",
      "npm install lodash",
    ])
  })

  it("does not add an unreasonably long full command option", () => {
    const command = "x".repeat(MAX_FULL_COMMAND_RULE_LENGTH + 1)
    expect(commandRuleOptions(["node *"], command, [command])).toEqual(["node *"])
  })

  it("keeps empty or missing commands out of the rule options", () => {
    expect(commandRuleOptions(["git *"], undefined)).toEqual(["git *"])
    expect(commandRuleOptions(["git *"], "", [""])).toEqual(["git *"])
  })

  it("does not add a full command option when the request cannot save it as a pattern", () => {
    expect(commandRuleOptions(["npm *", "git *"], "npm test && git status", ["npm test", "git status"])).toEqual([
      "npm *",
      "git *",
    ])
  })
})

describe("displayCommandRule", () => {
  it("keeps short exact command rules visible in full", () => {
    expect(displayCommandRule("npm install lodash", "npm install lodash")).toBe("npm install lodash")
    expect(isFullCommandRule("npm install lodash", "npm install lodash")).toBe(true)
  })

  it("keeps wildcard command rules compact", () => {
    expect(displayCommandRule("npm install *", "npm install lodash")).toBe("npm install")
    expect(isFullCommandRule("npm install *", "npm install lodash")).toBe(false)
  })
})
