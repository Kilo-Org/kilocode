import { test, expect, describe } from "bun:test"
import { Permission } from "../../src/permission"
import { KiloSessionPrompt } from "../../src/kilocode/session/prompt"

const { guardPermissions } = KiloSessionPrompt

const allRule = { permission: "*", pattern: "*", action: "allow" as const }
const allDeny = { permission: "*", pattern: "*", action: "deny" as const }
const readAllow = { permission: "read", pattern: "*", action: "allow" as const }
const bashDeny = { permission: "bash", pattern: "*", action: "deny" as const }
const writeAllow = { permission: "write", pattern: "*", action: "allow" as const }
const editDeny = { permission: "edit", pattern: "*.env", action: "deny" as const }
const grepAllow = { permission: "grep", pattern: "*", action: "allow" as const }
const globDeny = { permission: "glob", pattern: "secrets/**", action: "deny" as const }

describe("guardPermissions", () => {
  describe("ask/plan agents", () => {
    const agents = ["ask", "plan"]

    for (const name of agents) {
      test(`${name} merges session rules with full agent permission`, () => {
        const session = { permission: [readAllow] }
        const agent = { name, permission: [bashDeny, writeAllow] }
        const result = guardPermissions({ agent, session })
        expect(result).toEqual([readAllow, bashDeny, writeAllow])
      })

      test(`${name} includes session deny rules`, () => {
        const session = { permission: [readAllow, editDeny] }
        const agent = { name, permission: [bashDeny] }
        const result = guardPermissions({ agent, session })
        expect(result).toEqual([readAllow, editDeny, bashDeny])
      })

      test(`${name} works with empty session permissions`, () => {
        const session = { permission: null as any }
        const agent = { name, permission: [bashDeny] }
        const result = guardPermissions({ agent, session })
        expect(result).toEqual([bashDeny])
      })

      test(`${name} works with empty agent permissions`, () => {
        const session = { permission: [readAllow] }
        const agent = { name, permission: [] }
        const result = guardPermissions({ agent, session })
        expect(result).toEqual([readAllow])
      })

      test(`${name} does not duplicate agent deny rules`, () => {
        const session = { permission: [readAllow] }
        const agent = { name, permission: [bashDeny, readAllow] }
        const result = guardPermissions({ agent, session })
        expect(result.filter((r) => r.permission === "bash" && r.action === "deny")).toHaveLength(1)
        expect(result.filter((r) => r.permission === "read" && r.action === "allow")).toHaveLength(1)
      })
    }
  })

  describe("non-mode agents", () => {
    const agents = ["build", "general", "explore"]

    for (const name of agents) {
      test(`${name} merges session rules with agent deny rules only`, () => {
        const session = { permission: [readAllow] }
        const agent = { name, permission: [bashDeny, writeAllow, globDeny] }
        const result = guardPermissions({ agent, session })
        expect(result).toEqual([readAllow, bashDeny, globDeny])
        expect(result.find((r) => r.permission === "write")).toBeUndefined()
      })

      test(`${name} includes session deny rules`, () => {
        const session = { permission: [allRule, editDeny] }
        const agent = { name, permission: [bashDeny] }
        const result = guardPermissions({ agent, session })
        expect(result).toEqual([allRule, editDeny, bashDeny])
      })

      test(`${name} ignores agent allow rules`, () => {
        const session = { permission: [] }
        const agent = { name, permission: [grepAllow, readAllow, writeAllow] }
        const result = guardPermissions({ agent, session })
        expect(result).toEqual([])
      })

      test(`${name} works with empty agent permissions`, () => {
        const session = { permission: [readAllow] }
        const agent = { name, permission: [] }
        const result = guardPermissions({ agent, session })
        expect(result).toEqual([readAllow])
      })

      test(`${name} works with empty session permissions`, () => {
        const session = { permission: null as any }
        const agent = { name, permission: [bashDeny] }
        const result = guardPermissions({ agent, session })
        expect(result).toEqual([bashDeny])
      })
    }
  })

  test("deny rules from session are preserved for all agent types", () => {
    for (const name of ["ask", "plan", "build", "general", "explore"]) {
      const session = { permission: [allRule, allDeny] }
      const agent = { name, permission: [] }
      const result = guardPermissions({ agent, session })
      expect(result).toContainEqual(allDeny)
    }
  })

  test("session rules come before agent rules in merge order", () => {
    const session = { permission: [{ ...readAllow, action: "deny" as const }] }
    const agent = { name: "ask", permission: [readAllow] }
    const result = guardPermissions({ agent, session })
    expect(result[0].action).toBe("deny")
    expect(result[1].action).toBe("allow")
  })

  test("subagent-like agents get only deny rules from agent config", () => {
    const session = { permission: [readAllow, bashDeny] }
    const agent = { name: "code", permission: [grepAllow, globDeny, { permission: "edit", pattern: "*", action: "deny" }] }
    const result = guardPermissions({ agent, session })
    expect(result.find((r) => r.permission === "grep")).toBeUndefined()
    expect(result).toContainEqual(globDeny)
    expect(result).toContainEqual({ permission: "edit", pattern: "*", action: "deny" })
    expect(result).toContainEqual(readAllow)
    expect(result).toContainEqual(bashDeny)
  })
})
