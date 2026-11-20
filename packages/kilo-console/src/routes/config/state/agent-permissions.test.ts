import { describe, expect, test } from "bun:test"
import { addRule, removeRule } from "./agent-permissions"

describe("agent permission rule editing", () => {
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
})
