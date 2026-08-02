import { describe, expect, test } from "bun:test"
import { asSchema, jsonSchema, type JSONSchema7, tool } from "ai"
import { KiloToolSchema } from "@/kilocode/session/tool-schema"

describe("provider tool schema sanitization", () => {
  test("removes lookarounds without changing safe regex syntax or local validation", async () => {
    const email =
      "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"
    const escaped = String.raw`\(?=literal\)`
    const doubled = String.raw`\\(?=suffix)`
    const seen: unknown[] = []
    const schema: JSONSchema7 = {
      type: "object",
      examples: [{ pattern: "(?=annotation)" }],
      patternProperties: {
        "[(?=]": { type: "string" },
        [escaped]: { type: "string" },
      },
      properties: {
        email: { type: "string", format: "email", pattern: email },
        ahead: { type: "string", pattern: "value(?=suffix)" },
        behind: { type: "string", pattern: "(?<=prefix)value" },
        negative: { type: "string", pattern: "(?<!prefix)value" },
        slug: { type: "string", pattern: "^[a-z0-9-]+$" },
        class: { type: "string", pattern: "[(?=]" },
        escaped: { type: "string", pattern: escaped },
        doubled: { type: "string", pattern: doubled },
        named: { type: "string", pattern: "(?<name>value)" },
      },
    }
    const validate = (value: unknown) => {
      seen.push(value)
      return { success: true as const, value }
    }
    const execute = async () => ({ output: "ok" })
    const input = {
      invite: tool({ description: "Invite by email", inputSchema: jsonSchema(schema, { validate }), execute }),
    }

    const output = await KiloToolSchema.sanitize(input)
    const result = (await asSchema(output.invite.inputSchema).jsonSchema) as JSONSchema7
    const properties = result.properties as Record<string, JSONSchema7>

    expect(output).not.toBe(input)
    expect(output.invite.execute).toBe(execute)
    expect(properties.email).toEqual({ type: "string", format: "email" })
    expect(properties.ahead.pattern).toBeUndefined()
    expect(properties.behind.pattern).toBeUndefined()
    expect(properties.negative.pattern).toBeUndefined()
    expect(properties.slug.pattern).toBe("^[a-z0-9-]+$")
    expect(properties.class.pattern).toBe("[(?=]")
    expect(properties.escaped.pattern).toBe(escaped)
    expect(properties.doubled.pattern).toBeUndefined()
    expect(properties.named.pattern).toBe("(?<name>value)")
    expect(result.examples).toEqual([{ pattern: "(?=annotation)" }])
    expect(result.patternProperties).toEqual({
      "[(?=]": { type: "string" },
      [escaped]: { type: "string" },
    })
    expect((schema.properties?.email as JSONSchema7).pattern).toBe(email)

    await asSchema(output.invite.inputSchema).validate?.({ email: "person@example.com" })
    expect(seen).toEqual([{ email: "person@example.com" }])
  })

  test("returns the original tools when schemas do not change", async () => {
    const input = {
      lookup: tool({ inputSchema: jsonSchema({ type: "object", properties: { slug: { pattern: "^[a-z]+$" } } }) }),
    }

    expect(await KiloToolSchema.sanitize(input)).toBe(input)
  })

  test("removes unanchored patterns for llama.cpp while preserving local validation", async () => {
    const seen: unknown[] = []
    const schema: JSONSchema7 = {
      type: "object",
      properties: {
        prompt: { type: "string", pattern: "\\S" },
        slug: { type: "string", pattern: "^[a-z0-9-]+$" },
      },
    }
    const validate = (value: unknown) => {
      seen.push(value)
      return { success: true as const, value }
    }
    const input = {
      agent: tool({ inputSchema: jsonSchema(schema, { validate }) }),
    }

    const output = await KiloToolSchema.sanitize(input, { providerID: "llama-cpp" })
    const result = await asSchema(output.agent.inputSchema).jsonSchema
    const properties = result.properties
    if (!properties || typeof properties.prompt !== "object" || typeof properties.slug !== "object") {
      throw new Error("Expected object properties")
    }

    expect(properties.prompt.pattern).toBeUndefined()
    expect(properties.slug.pattern).toBe("^[a-z0-9-]+$")
    expect(schema.properties?.prompt).toEqual({ type: "string", pattern: "\\S" })

    await asSchema(output.agent.inputSchema).validate?.({ prompt: "hello", slug: "valid-slug" })
    expect(seen).toEqual([{ prompt: "hello", slug: "valid-slug" }])
  })

  test("keeps unanchored patterns for other OpenAI-compatible providers", async () => {
    const input = {
      agent: tool({ inputSchema: jsonSchema({ type: "object", properties: { prompt: { pattern: "\\S" } } }) }),
    }

    expect(await KiloToolSchema.sanitize(input, { providerID: "custom-openai" })).toBe(input)
  })

  test("keeps a composed schema when only llama.cpp-incompatible patterns are removed", async () => {
    const input = {
      choose: tool({
        inputSchema: jsonSchema({
          type: "object",
          oneOf: [
            {
              type: "object",
              properties: { x: { type: "string", pattern: "\\S" } },
              required: ["x"],
            },
            {
              type: "object",
              properties: { y: { type: "string" } },
              required: ["y"],
            },
          ],
        }),
      }),
    }

    const output = await KiloToolSchema.sanitize(input, { providerID: "llama.cpp" })
    const result = await asSchema(output.choose.inputSchema).jsonSchema

    expect(result).toEqual({
      type: "object",
      oneOf: [
        { type: "object", properties: { x: { type: "string" } }, required: ["x"] },
        { type: "object", properties: { y: { type: "string" } }, required: ["y"] },
      ],
    })
  })

  test("removes unanchored pattern property keys for llama.cpp", async () => {
    const input = {
      dynamic: tool({
        inputSchema: jsonSchema({
          type: "object",
          patternProperties: {
            "^safe-[a-z]+$": { type: "string" },
            "unsafe-[a-z]+": { type: "number" },
          },
          additionalProperties: false,
        }),
      }),
    }

    const output = await KiloToolSchema.sanitize(input, { providerID: "llama_cpp" })
    const result = await asSchema(output.dynamic.inputSchema).jsonSchema

    expect(result).toEqual({ type: "object", additionalProperties: true })
  })

  test("keeps strict dynamic properties available when their key pattern is removed", async () => {
    const schema: JSONSchema7 = {
      type: "object",
      patternProperties: {
        "^(?!reserved$).+$": { type: "string", minLength: 1, pattern: "(?=value)" },
        "^safe-": { type: "number" },
      },
      additionalProperties: false,
    }
    const input = { dynamic: tool({ inputSchema: jsonSchema(schema) }) }

    const output = await KiloToolSchema.sanitize(input)
    const result = (await asSchema(output.dynamic.inputSchema).jsonSchema) as JSONSchema7

    expect(result).toEqual({ type: "object", additionalProperties: true })
    expect(schema.patternProperties).toEqual({
      "^(?!reserved$).+$": { type: "string", minLength: 1, pattern: "(?=value)" },
      "^safe-": { type: "number" },
    })
    expect(schema.additionalProperties).toBe(false)
  })

  test("keeps object inputs available when an exact-match branch is widened", async () => {
    const schema: JSONSchema7 = {
      type: "object",
      oneOf: [
        {
          type: "object",
          properties: { x: { type: "string", pattern: "(?=value)" } },
          required: ["x"],
        },
        {
          type: "object",
          properties: { y: { type: "string" } },
          required: ["y"],
        },
      ],
    }
    const input = { exact: tool({ inputSchema: jsonSchema(schema) }) }

    const output = await KiloToolSchema.sanitize(input)
    const result = await asSchema(output.exact.inputSchema).jsonSchema

    expect(result).toEqual({ type: "object", additionalProperties: true })
  })
})
