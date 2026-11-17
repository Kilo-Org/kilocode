import { describe, expect, test } from "bun:test"
import { entries, hash, parseList } from "../../../src/kilocode/browser/contract-shape"

const tool = {
  name: "browser_navigate",
  description: "Navigate to a URL",
  inputSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: { url: { type: "string" } },
    required: ["url"],
    additionalProperties: false,
  },
  annotations: { title: "Navigate", readOnlyHint: true },
}

describe("playwright MCP contract shape", () => {
  test("normalizes a tools/list entry", () => {
    expect(entries({ tools: [tool] })).toMatchObject([
      {
        name: "browser_navigate",
        title: "Navigate",
        description: "Navigate to a URL",
        inputSchema: tool.inputSchema,
        readOnly: true,
      },
    ])
  })

  test("hashes the raw tools/list result deterministically", () => {
    const result = { tools: [tool] }
    expect(hash(result)).toBe(hash(JSON.parse(JSON.stringify(result))))
    expect(hash(result)).toHaveLength(64)
    expect(hash({ tools: [{ ...tool, name: "browser_click" }] })).not.toBe(hash(result))
  })

  test("rejects a tool without an object argument schema", () => {
    expect(() => parseList({ tools: [{ ...tool, inputSchema: { type: "string" } }] })).toThrow()
    expect(() => parseList({ tools: [] })).toThrow()
    expect(() => parseList({})).toThrow()
  })
})
