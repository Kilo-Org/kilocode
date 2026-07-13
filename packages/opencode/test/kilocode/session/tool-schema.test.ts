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
        "(?=private-)": { type: "string" },
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
})
