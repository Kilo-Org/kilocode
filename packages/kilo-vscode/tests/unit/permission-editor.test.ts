import { describe, expect, it } from "bun:test"
import {
  addExceptionPatch,
  clearGroupedPatch,
  clearWildcardPatch,
  inheritedWildcard,
  mostRestrictive,
  permissionExceptions,
  removeExceptionPatch,
  setExceptionPatch,
  setGroupedPatch,
  setWildcardPatch,
  wildcardAction,
  effectiveRuleLevel,
} from "../../webview-ui/src/components/settings/permission-utils"
import type { PermissionRule, PermissionRuleItem } from "../../webview-ui/src/types/messages"

describe("effectiveRuleLevel", () => {
  it("uses the last matching wildcard rule from resolved agent rules", () => {
    const rules: PermissionRuleItem[] = [
      { permission: "*", pattern: "*", action: "allow" },
      { permission: "bash", pattern: "*", action: "ask" },
      { permission: "*", pattern: "*", action: "deny" },
    ]

    expect(effectiveRuleLevel(rules, "bash")).toBe("deny")
    expect(effectiveRuleLevel(rules, "external_directory")).toBe("deny")
  })

  it("uses specific tool rules after wildcard rules", () => {
    const rules: PermissionRuleItem[] = [
      { permission: "*", pattern: "*", action: "deny" },
      { permission: "read", pattern: "*", action: "allow" },
      { permission: "grep", pattern: "*", action: "allow" },
    ]

    expect(effectiveRuleLevel(rules, "read")).toBe("allow")
    expect(effectiveRuleLevel(rules, "grep")).toBe("allow")
    expect(effectiveRuleLevel(rules, "edit")).toBe("deny")
  })

  it("falls back to ask when no resolved wildcard rule is available", () => {
    expect(effectiveRuleLevel(undefined, "bash")).toBe("ask")
    expect(effectiveRuleLevel([], "bash")).toBe("ask")
  })
})

describe("PermissionEditor inherited wildcard state", () => {
  it("distinguishes inherited defaults from explicit wildcard rules", () => {
    expect(wildcardAction(undefined, "ask")).toBe("ask")
    expect(inheritedWildcard(undefined)).toBe(true)

    expect(wildcardAction("deny", "ask")).toBe("deny")
    expect(inheritedWildcard("deny")).toBe(false)

    expect(wildcardAction({ "*": null, "src/**": "allow" }, "ask")).toBe("ask")
    expect(inheritedWildcard({ "*": null, "src/**": "allow" })).toBe(true)
  })
})

describe("PermissionEditor patch generation", () => {
  it("emits delete sentinels when clearing wildcard overrides", () => {
    expect(clearWildcardPatch("deny", "bash")).toEqual({ bash: null })

    expect(clearWildcardPatch({ "*": "deny", "npm test": "allow" }, "bash")).toEqual({
      bash: { "*": null },
    })
  })

  it("preserves exceptions when changing wildcard overrides", () => {
    expect(setWildcardPatch({ "*": "deny", "src/**": "allow", "dist/**": null }, "edit", "ask")).toEqual({
      edit: { "*": "ask", "src/**": "allow" },
    })
  })

  it("adds, updates, and removes granular exceptions without losing wildcard state", () => {
    const rule: PermissionRule = { "*": "deny", "src/**": "allow" }

    expect(addExceptionPatch("deny", "bash", "npm test")).toEqual({
      bash: { "*": "deny", "npm test": "allow" },
    })
    expect(setExceptionPatch(rule, "edit", "src/**", "deny")).toEqual({
      edit: { "*": "deny", "src/**": "deny" },
    })
    expect(removeExceptionPatch(rule, "edit", "src/**")).toEqual({
      edit: { "src/**": null },
    })
    expect(removeExceptionPatch("deny", "edit", "src/**")).toBeUndefined()
  })

  it("generates grouped tool patches for explicit and inherited actions", () => {
    const ids = ["todoread", "todowrite"]

    expect(mostRestrictive(["allow", "deny", "ask"])).toBe("deny")
    expect(setGroupedPatch(ids, "allow")).toEqual({ todoread: "allow", todowrite: "allow" })
    expect(clearGroupedPatch(ids)).toEqual({ todoread: null, todowrite: null })
  })

  it("filters deleted exceptions from rendered exception rows", () => {
    expect(permissionExceptions({ "*": "deny", "src/**": "allow", "dist/**": null })).toEqual([
      { pattern: "src/**", action: "allow" },
    ])
  })
})
