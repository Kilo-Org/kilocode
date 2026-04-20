// kilocode_change - new file
import { test, expect } from "bun:test"
import { Permission } from "../../src/permission"

// Mirror of the ruleset in packages/opencode/src/cli/cmd/run.ts (around line 381).
// Kept in lockstep by intention so this test documents the contract.
const rules: Permission.Ruleset = [
  { permission: "question", action: "deny", pattern: "*" },
  { permission: "plan_enter", action: "deny", pattern: "*" },
  { permission: "plan_exit", action: "deny", pattern: "*" },
  { permission: "suggest", action: "deny", pattern: "*" },
]

test("kilo run ruleset disables interactive tools including suggest", () => {
  const disabled = Permission.disabled(["suggest", "question", "plan_enter", "plan_exit", "bash", "read"], rules)
  expect(disabled.has("suggest")).toBe(true)
  expect(disabled.has("question")).toBe(true)
  expect(disabled.has("plan_enter")).toBe(true)
  expect(disabled.has("plan_exit")).toBe(true)
})

test("kilo run ruleset does not over-match allowed tools", () => {
  const disabled = Permission.disabled(["bash", "read", "edit", "write"], rules)
  expect(disabled.has("bash")).toBe(false)
  expect(disabled.has("read")).toBe(false)
  expect(disabled.has("edit")).toBe(false)
  expect(disabled.has("write")).toBe(false)
})
