import { describe, expect, test } from "bun:test"
import { KiloMcpStructuredContent } from "../../src/kilocode/mcp/structured-content"

const schema = {
  type: "object",
  properties: {
    count: { type: "number" },
  },
  required: ["count"],
  additionalProperties: false,
}

describe("Kilo MCP structured content", () => {
  test("validates structured content against a valid output schema", () => {
    const compiled = KiloMcpStructuredContent.compile(schema)
    const result = KiloMcpStructuredContent.validate("count", compiled, {
      content: [{ type: "text", text: "ok" }],
      structuredContent: { count: 1 },
    })

    expect(compiled.status).toBe("valid")
    expect(result.structuredContent).toEqual({ count: 1 })
  })

  test("rejects missing structured content for schema-backed tools", () => {
    const compiled = KiloMcpStructuredContent.compile(schema)

    expect(() =>
      KiloMcpStructuredContent.validate("count", compiled, {
        content: [{ type: "text", text: '{"count":1}' }],
      }),
    ).toThrow("missing structuredContent")
  })

  test("rejects invalid structured content for schema-backed tools", () => {
    const compiled = KiloMcpStructuredContent.compile(schema)

    expect(() =>
      KiloMcpStructuredContent.validate("count", compiled, {
        content: [{ type: "text", text: "bad" }],
        structuredContent: { count: "one" },
      }),
    ).toThrow("must be number")
  })

  test("omits structured content from error results without validating it", () => {
    const compiled = KiloMcpStructuredContent.compile(schema)
    const result = KiloMcpStructuredContent.validate("count", compiled, {
      content: [{ type: "text", text: "error" }],
      structuredContent: { count: "one" },
      isError: true,
    })

    expect(result.structuredContent).toBeUndefined()
  })

  test("downgrades invalid output schemas to untrusted text behavior", () => {
    const compiled = KiloMcpStructuredContent.compile({
      type: "object",
      properties: { count: { $ref: "#/$defs/Missing" } },
    })
    const result = KiloMcpStructuredContent.validate("count", compiled, {
      content: [{ type: "text", text: "ok" }],
      structuredContent: { count: 1 },
    })

    expect(compiled.status).toBe("invalid")
    expect(result.structuredContent).toBeUndefined()
    expect(result._meta).toMatchObject({ structuredContentSchema: { valid: false, reason: "compile" } })
  })

  test("omits oversized structured content completely", () => {
    const value = { text: "x".repeat(64) }
    const result = KiloMcpStructuredContent.persist(value, { maxBytes: 16 })

    expect(result).toEqual({
      metadata: {
        structuredContentOmitted: {
          reason: "size",
          bytes: Buffer.byteLength(JSON.stringify(value)),
          maxBytes: 16,
        },
      },
    })
  })

  test("keeps in-budget structured content complete", () => {
    const value = { count: 1 }

    expect(KiloMcpStructuredContent.persist(value, { maxBytes: 64 })).toEqual({ structuredContent: value })
  })

  test("keeps only Kilo-owned MCP metadata diagnostics", () => {
    expect(
      KiloMcpStructuredContent.metadata({
        metadata: { truncated: false },
        _meta: {
          server: "mcp",
          structuredContentSchema: { valid: false, reason: "compile" },
        },
      }),
    ).toEqual({
      truncated: false,
      structuredContentSchema: { valid: false, reason: "compile" },
    })
  })
})
