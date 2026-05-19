import { test, expect } from "bun:test"
import { KiloSessionPrompt } from "../../src/kilocode/session/prompt"
import { Permission } from "../../src/permission"

test("hardPermissions returns agent permissions for non-ask/plan agents", () => {
  const agent = {
    name: "code",
    permission: [{ permission: "bash", pattern: "*", action: "deny" }],
  }
  const result = KiloSessionPrompt.hardPermissions({ agent })
  expect(result).toEqual(agent.permission)
})

test("hardPermissions returns agent permissions for ask agents", () => {
  const agent = {
    name: "ask",
    permission: [
      { permission: "bash", pattern: "*", action: "deny" },
      { permission: "read", pattern: "*", action: "allow" },
    ],
  }
  const result = KiloSessionPrompt.hardPermissions({ agent })
  expect(result).toEqual(agent.permission)
})

test("guardPermissions appends agent denies last for non-ask/plan agents", () => {
  const agentDeny = { permission: "bash", pattern: "*", action: "deny" }
  const sessionAllow = { permission: "edit", pattern: "src/*", action: "allow" }
  const result = KiloSessionPrompt.guardPermissions({
    agent: {
      name: "code",
      permission: [agentDeny, { permission: "read", pattern: "*", action: "allow" }],
    },
    session: { permission: [sessionAllow] },
  })
  expect(result[result.length - 1]).toEqual(agentDeny)
  expect(result[0]).toEqual(sessionAllow)
})

test("guardPermissions does not duplicate agent denies for ask agents", () => {
  const agentDeny = { permission: "bash", pattern: "*", action: "deny" }
  const result = KiloSessionPrompt.guardPermissions({
    agent: {
      name: "ask",
      permission: [
        { permission: "*", pattern: "*", action: "deny" },
        { permission: "read", pattern: "*", action: "allow" },
        agentDeny,
      ],
    },
    session: { permission: [{ permission: "edit", pattern: "src/*", action: "allow" }] },
  })
  const matches = result.filter(
    (r) => r.permission === "bash" && r.pattern === "*" && r.action === "deny",
  )
  expect(matches.length).toBe(1)
})

test("disabled() with blanket deny disables the tool", () => {
  const ruleset = Permission.fromConfig({ bash: "deny" })
  const result = Permission.disabled(["bash"], ruleset)
  expect(result.has("bash")).toBe(true)
})

test("disabled() with patterned allow does not disable", () => {
  const ruleset = Permission.fromConfig({ bash: { "npm *": "allow" } })
  const result = Permission.disabled(["bash"], ruleset)
  expect(result.has("bash")).toBe(false)
})

test("disabled() with blanket deny + patterned allow disables the tool", () => {
  const ruleset = Permission.merge(
    Permission.fromConfig({ bash: { "*": "deny", "npm *": "allow" } }),
  )
  const result = Permission.disabled(["bash"], ruleset)
  expect(result.has("bash")).toBe(true)
})

test("disabled() does not disable tool with patterned deny only", () => {
  const ruleset = Permission.fromConfig({ bash: { "rm *": "deny" } })
  const result = Permission.disabled(["bash"], ruleset)
  expect(result.has("bash")).toBe(false)
})
