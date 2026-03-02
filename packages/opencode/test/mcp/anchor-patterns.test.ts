import { test, expect, describe } from "bun:test"
import { MCP } from "../../src/mcp/index"
import type { JSONSchema7 } from "ai"

const anchorPatterns = MCP.anchorPatterns

describe("anchorPatterns", () => {
  test("adds anchors to unanchored pattern", () => {
    const schema: JSONSchema7 = { type: "string", pattern: "[a-z]+" }
    const result = anchorPatterns(schema)
    expect(result.pattern).toBe("^[a-z]+$")
  })

  test("leaves already-anchored pattern unchanged", () => {
    const schema: JSONSchema7 = { type: "string", pattern: "^[a-z]+$" }
    const result = anchorPatterns(schema)
    expect(result.pattern).toBe("^[a-z]+$")
  })

  test("adds only missing anchor", () => {
    expect(anchorPatterns({ pattern: "^foo" } as JSONSchema7).pattern).toBe("^foo$")
    expect(anchorPatterns({ pattern: "foo$" } as JSONSchema7).pattern).toBe("^foo$")
  })

  test("handles escaped \\$ (literal dollar) — should add anchor", () => {
    const schema: JSONSchema7 = { pattern: "price\\$" }
    const result = anchorPatterns(schema)
    expect(result.pattern).toBe("^price\\$$")
  })

  test("handles \\\\$ (escaped backslash + real anchor) — should not add anchor", () => {
    const schema: JSONSchema7 = { pattern: "foo\\\\$" }
    const result = anchorPatterns(schema)
    expect(result.pattern).toBe("^foo\\\\$")
  })

  test("returns non-object schema as-is", () => {
    expect(anchorPatterns(null as any)).toBeNull()
    expect(anchorPatterns(undefined as any)).toBeUndefined()
  })

  test("recurses into properties", () => {
    const schema: JSONSchema7 = {
      type: "object",
      properties: {
        name: { type: "string", pattern: "[a-z]+" },
      },
    }
    const result = anchorPatterns(schema)
    expect((result.properties!.name as JSONSchema7).pattern).toBe("^[a-z]+$")
  })

  test("recurses into items (single schema)", () => {
    const schema: JSONSchema7 = {
      type: "array",
      items: { type: "string", pattern: "\\d+" },
    }
    const result = anchorPatterns(schema)
    expect((result.items as JSONSchema7).pattern).toBe("^\\d+$")
  })

  test("recurses into items (tuple array)", () => {
    const schema: JSONSchema7 = {
      type: "array",
      items: [{ type: "string", pattern: "[a-z]+" }],
    }
    const result = anchorPatterns(schema)
    expect((result.items as JSONSchema7[])[0].pattern).toBe("^[a-z]+$")
  })

  test("recurses into additionalProperties", () => {
    const schema: JSONSchema7 = {
      type: "object",
      additionalProperties: { type: "string", pattern: "[0-9]+" },
    }
    const result = anchorPatterns(schema)
    expect((result.additionalProperties as JSONSchema7).pattern).toBe("^[0-9]+$")
  })

  test("recurses into anyOf/oneOf/allOf", () => {
    const schema: JSONSchema7 = {
      anyOf: [{ pattern: "a+" }],
      oneOf: [{ pattern: "b+" }],
      allOf: [{ pattern: "c+" }],
    }
    const result = anchorPatterns(schema)
    expect((result.anyOf![0] as JSONSchema7).pattern).toBe("^a+$")
    expect((result.oneOf![0] as JSONSchema7).pattern).toBe("^b+$")
    expect((result.allOf![0] as JSONSchema7).pattern).toBe("^c+$")
  })

  test("recurses into not", () => {
    const schema: JSONSchema7 = {
      not: { pattern: "bad" },
    }
    const result = anchorPatterns(schema)
    expect((result.not as JSONSchema7).pattern).toBe("^bad$")
  })

  test("recurses into if/then/else", () => {
    const schema: any = {
      if: { pattern: "a" },
      then: { pattern: "b" },
      else: { pattern: "c" },
    }
    const result = anchorPatterns(schema) as any
    expect(result.if.pattern).toBe("^a$")
    expect(result.then.pattern).toBe("^b$")
    expect(result.else.pattern).toBe("^c$")
  })

  test("recurses into definitions/$defs", () => {
    const schema: any = {
      definitions: { foo: { pattern: "x+" } },
      $defs: { bar: { pattern: "y+" } },
    }
    const result = anchorPatterns(schema) as any
    expect(result.definitions.foo.pattern).toBe("^x+$")
    expect(result.$defs.bar.pattern).toBe("^y+$")
  })

  test("recurses into patternProperties", () => {
    const schema: JSONSchema7 = {
      patternProperties: {
        "^S_": { type: "string", pattern: "[a-z]+" },
      },
    }
    const result = anchorPatterns(schema)
    expect((result.patternProperties!["^S_"] as JSONSchema7).pattern).toBe("^[a-z]+$")
  })

  test("recurses into contains", () => {
    const schema: JSONSchema7 = {
      contains: { pattern: "item" },
    }
    const result = anchorPatterns(schema)
    expect((result.contains as JSONSchema7).pattern).toBe("^item$")
  })

  test("handles deeply nested schemas", () => {
    const schema: JSONSchema7 = {
      type: "object",
      properties: {
        nested: {
          type: "object",
          properties: {
            deep: { type: "string", pattern: "[0-9a-f]+" },
          },
        },
      },
    }
    const result = anchorPatterns(schema)
    const deep = (result.properties!.nested as JSONSchema7).properties!.deep as JSONSchema7
    expect(deep.pattern).toBe("^[0-9a-f]+$")
  })

  test("wraps top-level alternation in non-capturing group", () => {
    const schema: JSONSchema7 = { pattern: "foo|bar" }
    const result = anchorPatterns(schema)
    expect(result.pattern).toBe("^(?:foo|bar)$")
  })

  test("wraps complex alternation in non-capturing group", () => {
    const schema: JSONSchema7 = { pattern: "error|warn|info" }
    const result = anchorPatterns(schema)
    expect(result.pattern).toBe("^(?:error|warn|info)$")
  })

  test("does not wrap alternation when already anchored", () => {
    const schema: JSONSchema7 = { pattern: "^foo|bar$" }
    const result = anchorPatterns(schema)
    // Only missing end anchor, so no group wrapping needed
    expect(result.pattern).toBe("^foo|bar$")
  })

  test("skips additionalProperties when boolean", () => {
    const schema: JSONSchema7 = {
      type: "object",
      properties: { name: { type: "string", pattern: "[a-z]+" } },
      additionalProperties: false,
    }
    const result = anchorPatterns(schema)
    expect(result.additionalProperties).toBe(false)
    expect((result.properties!.name as JSONSchema7).pattern).toBe("^[a-z]+$")
  })

  test("does not mutate original schema", () => {
    const original: JSONSchema7 = { type: "string", pattern: "[a-z]+" }
    anchorPatterns(original)
    expect(original.pattern).toBe("[a-z]+")
  })
})
