import { describe, expect, test } from "bun:test"
import { addRule, removeRule, split, toPermission } from "./agent-permissions"

const catchAll = [
  { permission: "bash", pattern: "*", action: "deny" },
  { permission: "bash", pattern: "git *", action: "allow" },
]

describe("agent permission rule editing", () => {
  test("keeps a catch-all deny and a pattern allow for one tool", () => {
    const next = toPermission(catchAll)
    expect(next).toEqual({ bash: { "*": "deny", "git *": "allow" } })
    expect(JSON.stringify(next)).toBe('{"bash":{"*":"deny","git *":"allow"}}')
  })

  test("keeps a pattern deny and a later catch-all allow for one tool", () => {
    const next = toPermission([
      { permission: "bash", pattern: "git *", action: "deny" },
      { permission: "bash", pattern: "*", action: "allow" },
    ])
    expect(next).toEqual({ bash: { "git *": "deny", "*": "allow" } })
    expect(split(next)).toEqual({ tools: [], permission: { bash: { "git *": "deny", "*": "allow" } } })
  })

  test("survives a split and rebuild round trip without losing rules", () => {
    const parts = split(catchAll)
    expect(toPermission(parts.permission)).toEqual(toPermission(catchAll))
    expect(JSON.stringify(toPermission(parts.permission))).toBe('{"bash":{"*":"deny","git *":"allow"}}')
  })

  test("keeps map input as it is", () => {
    expect(split({ bash: "allow", edit: "deny" })).toEqual({ tools: ["bash"], permission: { edit: "deny" } })
  })

  test("skips unknown actions and entries without a tool", () => {
    expect(
      toPermission([
        { permission: "bash", pattern: "p", action: "maybe" },
        { pattern: "q", action: "allow" },
      ]),
    ).toEqual({})
  })

  test("keeps a scalar default as the catch-all when a pattern is added", () => {
    const next = addRule({ bash: "deny" }, "bash", "git status", "allow")
    expect(next).toEqual({ bash: { "*": "deny", "git status": "allow" } })
    expect(JSON.stringify(next)).toBe('{"bash":{"*":"deny","git status":"allow"}}')
  })

  test("restores the scalar default when the added pattern is removed", () => {
    const added = addRule({ bash: "deny" }, "bash", "git status", "allow")
    expect(removeRule(added, { tool: "bash", pattern: "git status" })).toEqual({ bash: "deny" })
  })

  test("collapses a lone ask catch-all back to the scalar", () => {
    expect(removeRule({ bash: { "*": "ask", "npm *": "allow" } }, { tool: "bash", pattern: "npm *" })).toEqual({
      bash: "ask",
    })
  })

  test("drops the tool when its last pattern is removed", () => {
    expect(removeRule({ bash: { "npm *": "allow" } }, { tool: "bash", pattern: "npm *" })).toEqual({})
  })

  test("keeps an allow catch-all as a map", () => {
    expect(
      removeRule({ bash: { "*": "allow", "git status": "deny" } }, { tool: "bash", pattern: "git status" }),
    ).toEqual({ bash: { "*": "allow" } })
  })

  test("adds a pattern to a map without inventing a catch-all", () => {
    expect(addRule({ bash: { "npm *": "deny" } }, "bash", "git status", "allow")).toEqual({
      bash: { "npm *": "deny", "git status": "allow" },
    })
  })

  test("leaves other tools untouched", () => {
    expect(addRule({ bash: "deny", edit: "ask" }, "bash", "p", "allow")).toEqual({
      bash: { "*": "deny", p: "allow" },
      edit: "ask",
    })
  })

  test("seeds a base action as the catch-all when the tool has no entry", () => {
    const next = addRule({}, "bash", "git status", "deny", "allow")
    expect(next).toEqual({ bash: { "*": "allow", "git status": "deny" } })
    expect(JSON.stringify(next)).toBe('{"bash":{"*":"allow","git status":"deny"}}')
  })

  test("invents no catch-all without a base action", () => {
    expect(addRule({}, "bash", "git status", "deny")).toEqual({ bash: { "git status": "deny" } })
  })

  test("prefers an explicit permission entry over the base action", () => {
    expect(addRule({ bash: "deny" }, "bash", "git status", "allow", "allow")).toEqual({
      bash: { "*": "deny", "git status": "allow" },
    })
  })

  test("keeps a __proto__ tool key own instead of polluting Object.prototype", () => {
    const next = toPermission([{ permission: "__proto__", pattern: "polluted", action: "allow" }])
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.keys(next)).toContain("__proto__")
    expect(JSON.stringify(next)).toBe('{"__proto__":{"polluted":"allow"}}')
  })

  test("keeps a __proto__ pattern as an own rule entry", () => {
    const next = toPermission([
      { permission: "bash", pattern: "__proto__", action: "deny" },
      { permission: "bash", pattern: "git *", action: "allow" },
    ])
    const map = (next as Record<string, Record<string, string>>).bash
    expect(Object.getOwnPropertyDescriptor(map, "__proto__")?.value).toBe("deny")
    expect(Object.entries(map)).toEqual([
      ["__proto__", "deny"],
      ["git *", "allow"],
    ])
    expect(JSON.stringify(next)).toBe('{"bash":{"__proto__":"deny","git *":"allow"}}')
  })

  test("keeps a constructor tool key own without changing Object.prototype", () => {
    const before = Object.entries(Object.prototype).length
    const next = toPermission([{ permission: "constructor", pattern: "*", action: "ask" }])
    expect(Object.keys(next)).toEqual(["constructor"])
    expect(Object.entries((next as Record<string, Record<string, string>>).constructor)).toEqual([["*", "ask"]])
    expect(Object.entries(Object.prototype).length).toBe(before)
  })
})
