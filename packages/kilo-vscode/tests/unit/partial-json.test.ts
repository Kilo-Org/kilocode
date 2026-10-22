import { describe, expect, test } from "bun:test"
import { partial } from "../../src/kilo-provider/partial-json"

const live = new Set(["content", "command"])

describe("partial", () => {
  test("parses a complete object", () => {
    expect(partial('{"filePath":"a.ts","content":"x"}', live)).toEqual({ filePath: "a.ts", content: "x" })
  })

  test("keeps complete fields and drops an open non-live string", () => {
    expect(partial('{"filePath":"src/a.ts","description":"Run te', live)).toEqual({ filePath: "src/a.ts" })
    expect(partial('{"filePath":"src/gre', live)).toEqual({})
  })

  test("streams an open live string", () => {
    expect(partial('{"filePath":"a.ts","content":"line 1\\nline', live)).toEqual({
      filePath: "a.ts",
      content: "line 1\nline",
    })
  })

  test("drops an escape that is not complete yet", () => {
    expect(partial('{"content":"a\\', live)).toEqual({ content: "a" })
    expect(partial('{"content":"a\\u00', live)).toEqual({ content: "a" })
    expect(partial('{"content":"a\\u00e9b', live)).toEqual({ content: "aéb" })
  })

  test("waits for keys, literals, and nested values to complete", () => {
    expect(partial('{"filePath":"a.ts","con', live)).toEqual({ filePath: "a.ts" })
    expect(partial('{"replaceAll":tr', live)).toEqual({})
    expect(partial('{"replaceAll":true,"x":1', live)).toEqual({ replaceAll: true })
    expect(partial('{"todos":[{"content":"a"},{"content":"b', live)).toEqual({})
    expect(partial('{"todos":[{"content":"a"}],"x"', live)).toEqual({ todos: [{ content: "a" }] })
  })

  test("handles whitespace between tokens", () => {
    expect(partial('{\n  "command" : "bun te', live)).toEqual({ command: "bun te" })
  })

  test("ignores input that is not an object", () => {
    expect(partial("", live)).toBeUndefined()
    expect(partial('["a"', live)).toBeUndefined()
  })
})
