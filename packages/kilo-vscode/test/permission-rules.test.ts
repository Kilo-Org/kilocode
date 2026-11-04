import { describe, expect, test } from "bun:test"
import {
  addExceptionLevel,
  clearGroupedLevel,
  clearSimpleLevel,
  clearWildcardLevel,
  effectiveConfigLevel,
  effectiveRuleLevel,
  inheritedTool,
  mostRestrictive,
  removeExceptionLevel,
  setExceptionLevel,
  setGroupedLevel,
  setSimpleLevel,
  setWildcardLevel,
  toolExceptions,
  wildcardRule,
  type PermissionRuleset,
} from "../webview-ui/src/components/settings/permission-utils"

describe("effectiveRuleLevel", () => {
  test("takes the last matching catch-all rule", () => {
    const rules: PermissionRuleset = [
      { action: "*", resource: "*", effect: "allow" },
      { action: "shell", resource: "*", effect: "ask" },
      { action: "shell", resource: "*", effect: "deny" },
    ]
    expect(effectiveRuleLevel(rules, "shell")).toBe("deny")
    expect(effectiveRuleLevel(rules, "glob")).toBe("allow")
  })

  test("ignores per-resource rules and defaults to ask", () => {
    const rules: PermissionRuleset = [{ action: "edit", resource: "src/**", effect: "allow" }]
    expect(effectiveRuleLevel(rules, "edit")).toBe("ask")
    expect(effectiveRuleLevel([], "edit")).toBe("ask")
  })

  test("matches a wildcard action pattern", () => {
    const rules: PermissionRuleset = [{ action: "web*", resource: "*", effect: "deny" }]
    expect(effectiveRuleLevel(rules, "webfetch")).toBe("deny")
    expect(effectiveRuleLevel(rules, "read")).toBe("ask")
  })
})

describe("effectiveConfigLevel", () => {
  test("lets a configured rule override the defaults", () => {
    const rules: PermissionRuleset = [{ action: "shell", resource: "*", effect: "allow" }]
    expect(effectiveConfigLevel(rules, "shell")).toBe("allow")
    expect(effectiveConfigLevel(rules, "external_directory")).toBe("allow")
    expect(effectiveConfigLevel(rules, "glob")).toBe("allow")
  })
})

describe("mostRestrictive", () => {
  test("picks the strictest level", () => {
    expect(mostRestrictive(["allow", "ask"])).toBe("ask")
    expect(mostRestrictive(["allow", "deny", "ask"])).toBe("deny")
    expect(mostRestrictive([])).toBe("allow")
  })
})

describe("granular tools", () => {
  test("keeps exceptions and puts the wildcard first", () => {
    const current: PermissionRuleset = [{ action: "shell", resource: "git *", effect: "allow" }]
    const next = setWildcardLevel(current, "shell", "deny")
    expect(next).toEqual([
      { action: "shell", resource: "*", effect: "deny" },
      { action: "shell", resource: "git *", effect: "allow" },
    ])
  })

  test("clearing the wildcard keeps the exceptions", () => {
    const current: PermissionRuleset = [
      { action: "shell", resource: "*", effect: "deny" },
      { action: "shell", resource: "git *", effect: "allow" },
    ]
    expect(clearWildcardLevel(current, "shell")).toEqual([{ action: "shell", resource: "git *", effect: "allow" }])
  })

  test("updates an exception level in place and appends a new one", () => {
    const current: PermissionRuleset = [
      { action: "shell", resource: "*", effect: "ask" },
      { action: "shell", resource: "git *", effect: "allow" },
    ]
    expect(setExceptionLevel(current, "shell", "git *", "deny")).toEqual([
      { action: "shell", resource: "*", effect: "ask" },
      { action: "shell", resource: "git *", effect: "deny" },
    ])
    expect(addExceptionLevel(current, "shell", "npm *")).toEqual([
      { action: "shell", resource: "*", effect: "ask" },
      { action: "shell", resource: "git *", effect: "allow" },
      { action: "shell", resource: "npm *", effect: "allow" },
    ])
  })

  test("removes only the named exception", () => {
    const current: PermissionRuleset = [
      { action: "shell", resource: "*", effect: "ask" },
      { action: "shell", resource: "git *", effect: "allow" },
      { action: "shell", resource: "npm *", effect: "deny" },
    ]
    expect(removeExceptionLevel(current, "shell", "git *")).toEqual([
      { action: "shell", resource: "*", effect: "ask" },
      { action: "shell", resource: "npm *", effect: "deny" },
    ])
  })

  test("reports inheritance and exceptions", () => {
    const rules: PermissionRuleset = [{ action: "read", resource: "*.env", effect: "ask" }]
    expect(inheritedTool(rules, "read")).toBe(true)
    expect(toolExceptions(rules, "read")).toEqual([{ action: "read", resource: "*.env", effect: "ask" }])
  })
})

describe("simple and grouped tools", () => {
  test("setting a simple level replaces the tool with one wildcard rule", () => {
    const current: PermissionRuleset = [
      { action: "glob", resource: "*", effect: "deny" },
      { action: "glob", resource: "src/**", effect: "allow" },
      { action: "grep", resource: "*", effect: "allow" },
    ]
    expect(setSimpleLevel(current, "glob", "ask")).toEqual([
      { action: "glob", resource: "*", effect: "ask" },
      { action: "grep", resource: "*", effect: "allow" },
    ])
  })

  test("inheriting a simple tool drops its rules and keeps others in place", () => {
    const current: PermissionRuleset = [
      { action: "grep", resource: "*", effect: "allow" },
      { action: "glob", resource: "*", effect: "deny" },
      { action: "skill", resource: "*", effect: "allow" },
    ]
    expect(clearSimpleLevel(current, "glob")).toEqual([
      { action: "grep", resource: "*", effect: "allow" },
      { action: "skill", resource: "*", effect: "allow" },
    ])
  })

  test("grouped tools set and clear every action", () => {
    const current: PermissionRuleset = [{ action: "todowrite", resource: "*", effect: "ask" }]
    expect(setGroupedLevel(current, ["todowrite"], "allow")).toEqual([
      { action: "todowrite", resource: "*", effect: "allow" },
    ])
    expect(clearGroupedLevel(current, ["todowrite"])).toEqual([])
  })

  test("appends a new action at the end", () => {
    const current: PermissionRuleset = [{ action: "grep", resource: "*", effect: "allow" }]
    expect(setSimpleLevel(current, "glob", "deny")).toEqual([
      { action: "grep", resource: "*", effect: "allow" },
      { action: "glob", resource: "*", effect: "deny" },
    ])
  })
})

describe("rule order and wildcard actions", () => {
  test("keeps a tool after a catch-all that followed its first rule", () => {
    const current: PermissionRuleset = [
      { action: "shell", resource: "*", effect: "ask" },
      { action: "*", resource: "*", effect: "deny" },
      { action: "shell", resource: "git *", effect: "allow" },
    ]
    expect(setWildcardLevel(current, "shell", "ask")).toEqual([
      { action: "*", resource: "*", effect: "deny" },
      { action: "shell", resource: "*", effect: "ask" },
      { action: "shell", resource: "git *", effect: "allow" },
    ])
  })

  test("a wildcard action rule belongs to the tool it matches and can be cleared", () => {
    const rules: PermissionRuleset = [{ action: "web*", resource: "*", effect: "deny" }]
    expect(inheritedTool(rules, "webfetch")).toBe(false)
    expect(effectiveRuleLevel(rules, "webfetch")).toBe("deny")
    expect(wildcardRule(rules, "webfetch")).toEqual({ action: "web*", resource: "*", effect: "deny" })
    expect(clearSimpleLevel(rules, "webfetch")).toEqual([])
  })

  test("the catch-all is the global fallback and is never owned by a row", () => {
    const rules: PermissionRuleset = [{ action: "*", resource: "*", effect: "deny" }]
    expect(inheritedTool(rules, "shell")).toBe(true)
    expect(setSimpleLevel(rules, "shell", "allow")).toEqual([
      { action: "*", resource: "*", effect: "deny" },
      { action: "shell", resource: "*", effect: "allow" },
    ])
  })
})
