import { test, expect } from "bun:test"
import { PermissionNext } from "../../src/permission/next"

// toConfig tests (inverse of fromConfig)

test("toConfig - single wildcard rule uses object format", () => {
  const result = PermissionNext.toConfig([{ permission: "read", pattern: "*", action: "allow" }])
  expect(result).toEqual({ read: { "*": "allow" } })
})

test("toConfig - single non-wildcard rule uses object format", () => {
  const result = PermissionNext.toConfig([{ permission: "bash", pattern: "npm *", action: "allow" }])
  expect(result).toEqual({ bash: { "npm *": "allow" } })
})

test("toConfig - multiple rules for same permission use object format", () => {
  const result = PermissionNext.toConfig([
    { permission: "bash", pattern: "*", action: "ask" },
    { permission: "bash", pattern: "npm *", action: "allow" },
  ])
  expect(result).toEqual({ bash: { "*": "ask", "npm *": "allow" } })
})

test("toConfig - mixed permissions", () => {
  const result = PermissionNext.toConfig([
    { permission: "read", pattern: "*", action: "allow" },
    { permission: "bash", pattern: "npm *", action: "allow" },
    { permission: "bash", pattern: "git *", action: "allow" },
  ])
  expect(result).toEqual({
    read: { "*": "allow" },
    bash: { "npm *": "allow", "git *": "allow" },
  })
})

test("toConfig - empty rules returns empty object", () => {
  const result = PermissionNext.toConfig([])
  expect(result).toEqual({})
})

test("toConfig - wildcard then specific promotes to object", () => {
  const result = PermissionNext.toConfig([
    { permission: "bash", pattern: "*", action: "ask" },
    { permission: "bash", pattern: "rm *", action: "deny" },
  ])
  expect(result).toEqual({ bash: { "*": "ask", "rm *": "deny" } })
})

test("toConfig - roundtrip with fromConfig (simple) always uses object format", () => {
  const config = { read: "allow" as const, bash: "ask" as const }
  const rules = PermissionNext.fromConfig(config)
  const result = PermissionNext.toConfig(rules)
  // toConfig always uses object format to avoid erasing existing granular rules on merge
  expect(result).toEqual({ read: { "*": "allow" }, bash: { "*": "ask" } })
})

test("toConfig - roundtrip with fromConfig (object)", () => {
  const config = { bash: { "*": "ask" as const, "npm *": "allow" as const, "git *": "allow" as const } }
  const rules = PermissionNext.fromConfig(config)
  const result = PermissionNext.toConfig(rules)
  expect(result).toEqual(config)
})

test("toConfig - scalar-only permission uses scalar format", () => {
  const result = PermissionNext.toConfig([{ permission: "websearch", pattern: "*", action: "allow" }])
  expect(result).toEqual({ websearch: "allow" })
})

test("toConfig - scalar-only permission with non-wildcard pattern is skipped", () => {
  // doom_loop uses always: [toolName], so pattern can be "bash" etc.
  // Non-wildcard patterns for scalar-only permissions can't be represented
  // in the config schema — they only work in-memory (known limitation).
  const result = PermissionNext.toConfig([{ permission: "doom_loop", pattern: "bash", action: "allow" }])
  expect(result).toEqual({})
})

test("toConfig - mixed scalar-only and rule-capable permissions", () => {
  const result = PermissionNext.toConfig([
    { permission: "websearch", pattern: "*", action: "allow" },
    { permission: "todowrite", pattern: "*", action: "allow" },
    { permission: "bash", pattern: "npm *", action: "allow" },
  ])
  expect(result).toEqual({
    websearch: "allow",
    todowrite: "allow",
    bash: { "npm *": "allow" },
  })
})
