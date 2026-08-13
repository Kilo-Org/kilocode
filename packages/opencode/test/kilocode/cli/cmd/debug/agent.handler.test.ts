import { describe, expect, test } from "bun:test"
import { parseToolParams } from "../../../../../src/cli/cmd/debug/agent.handler"

describe("parseToolParams", () => {
  test("returns an empty object for undefined or blank input", () => {
    expect(parseToolParams(undefined)).toEqual({})
    expect(parseToolParams("")).toEqual({})
    expect(parseToolParams("   ")).toEqual({})
  })

  test("parses strict JSON", () => {
    expect(parseToolParams('{"path": "foo.ts", "count": 2}')).toEqual({ path: "foo.ts", count: 2 })
  })

  test("falls back to JSON5 for loose object-literal syntax", () => {
    expect(parseToolParams("{path: 'foo.ts', count: 2}")).toEqual({ path: "foo.ts", count: 2 })
    expect(parseToolParams("{trailingComma: 1,}")).toEqual({ trailingComma: 1 })
  })

  test("rejects non-object results", () => {
    expect(() => parseToolParams("42")).toThrow("Tool params must be an object.")
    expect(() => parseToolParams("[1, 2, 3]")).toThrow("Tool params must be an object.")
    expect(() => parseToolParams('"a string"')).toThrow("Tool params must be an object.")
  })

  test("fails safely instead of executing arbitrary code", () => {
    // Simulates an attacker-controlled --params value. If this were still evaluated with
    // `new Function`, __pwned would be set on globalThis before the throw ran.
    const payload = "(() => { globalThis.__pwned = true; throw new Error('pwned') })()"
    expect(() => parseToolParams(payload)).toThrow(/Failed to parse --params/)
    expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined()
  })

  test("fails safely on other unparsable code-like input", () => {
    expect(() => parseToolParams("require('fs').rmSync('/', { recursive: true })")).toThrow(
      /Failed to parse --params/,
    )
    expect(() => parseToolParams("process.exit(1)")).toThrow(/Failed to parse --params/)
  })
})
