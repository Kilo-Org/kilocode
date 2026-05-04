import { describe, expect, it } from "bun:test"
import { effectiveRuleLevel } from "../../webview-ui/src/components/settings/permission-utils"
import type { PermissionRuleItem } from "../../webview-ui/src/types/messages"

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
