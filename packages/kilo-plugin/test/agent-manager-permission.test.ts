import { describe, expect, test } from "bun:test"
import type { Permission } from "@opencode/schema/permission"
import { harden } from "../src/agent-manager/permission"

const broad: Permission.Ruleset = [{ action: "agent_manager", resource: "*", effect: "allow" }]

describe("Agent Manager side-effect permissions", () => {
  test("requires consent despite a broad Agent Manager allow rule", () => {
    for (const pattern of ["prompt", "stop", "move", "answer"])
      expect(harden("agent_manager", pattern, broad).effect).toBe("ask")
    expect(harden("agent_manager", "local", broad).effect).toBe("allow")
    expect(harden("agent_manager", "worktree", broad).effect).toBe("allow")
  })

  test("requires consent despite a global allow rule", () => {
    const rules: Permission.Ruleset = [{ action: "*", resource: "*", effect: "allow" }]
    for (const pattern of ["prompt", "stop", "move", "answer"])
      expect(harden("agent_manager", pattern, rules).effect).toBe("ask")
  })

  test("allows only explicit side-effect approvals", () => {
    const rules: Permission.Ruleset = [
      { action: "agent_manager", resource: "prompt", effect: "allow" },
      { action: "agent_manager", resource: "stop", effect: "allow" },
      { action: "agent_manager", resource: "move", effect: "allow" },
      { action: "agent_manager", resource: "answer", effect: "allow" },
    ]
    for (const pattern of ["prompt", "stop", "move", "answer"])
      expect(harden("agent_manager", pattern, rules).effect).toBe("allow")
  })

  test("leaves a deny and an unrelated action alone", () => {
    expect(harden("agent_manager", "prompt", [{ action: "agent_manager", resource: "*", effect: "deny" }]).effect).toBe(
      "deny",
    )
    expect(harden("edit", "prompt", broad).effect).toBe("ask")
  })
})