// kilocode_change - new file
import { test, expect } from "bun:test"
import { Permission } from "../../src/permission"
import { RUN_RULES } from "../../src/cli/cmd/run"

test("kilo run ruleset disables interactive tools including suggest", () => {
  const disabled = Permission.disabled(["suggest", "question", "plan_enter", "plan_exit", "bash", "read"], RUN_RULES)
  expect(disabled.has("suggest")).toBe(true)
  expect(disabled.has("question")).toBe(true)
  expect(disabled.has("plan_enter")).toBe(true)
  expect(disabled.has("plan_exit")).toBe(true)
})

test("kilo run ruleset does not over-match allowed tools", () => {
  const disabled = Permission.disabled(["bash", "read", "edit", "write"], RUN_RULES)
  expect(disabled.has("bash")).toBe(false)
  expect(disabled.has("read")).toBe(false)
  expect(disabled.has("edit")).toBe(false)
  expect(disabled.has("write")).toBe(false)
})
