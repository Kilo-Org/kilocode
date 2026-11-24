import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "@/provider/transform"

const models = {
  google: { providerID: "google", api: { id: "gemini-3-pro", npm: "@ai-sdk/google" } },
  gateway: { providerID: "kilo", api: { id: "google/gemini-3-pro", npm: "@kilocode/kilo-gateway" } },
} as any

const run = (model: unknown, arg: unknown) =>
  ProviderTransform.schema(model as any, { type: "object", properties: { arg } } as any) as any

// Every node Gemini would reject: an array without `items`, or a combiner with
// a sibling other than `nullable` and `description`.
const offenders = (node: unknown, path = "$"): string[] => {
  if (Array.isArray(node)) return node.flatMap((item, i) => offenders(item, `${path}[${i}]`))
  if (node === null || typeof node !== "object") return []
  const obj = node as Record<string, unknown>
  const own: string[] = []
  if (obj.type === "array" && obj.items == null) own.push(`${path}: array without items`)
  if (Array.isArray(obj.anyOf) || Array.isArray(obj.oneOf)) {
    const extra = Object.keys(obj).filter((key) => !["anyOf", "oneOf", "nullable", "description"].includes(key))
    if (extra.length > 0) own.push(`${path}: combiner beside ${extra.join(",")}`)
  }
  return [...own, ...Object.entries(obj).flatMap(([key, value]) => offenders(value, `${path}.${key}`))]
}

describe("gemini schema - typed nodes beside combiners", () => {
  for (const [name, model] of Object.entries(models)) {
    test(`${name}: pushes an array type into anyOf branches so each gets items`, () => {
      const out = run(model, { type: "array", anyOf: [{ minItems: 1 }, { maxItems: 3 }] })

      expect(offenders(out)).toEqual([])
      expect(out.properties.arg).toEqual({
        anyOf: [
          { type: "array", minItems: 1, items: { type: "string" } },
          { type: "array", maxItems: 3, items: { type: "string" } },
        ],
      })
    })

    test(`${name}: handles a type array whose node also carries a combiner`, () => {
      const out = run(model, { type: ["array", "string"], anyOf: [{ minLength: 1 }, { minItems: 1 }] })

      expect(offenders(out)).toEqual([])
    })

    test(`${name}: keeps declared items and description when spreading oneOf`, () => {
      const out = run(model, {
        type: ["array", "null"],
        description: "ids",
        oneOf: [{ items: { type: "integer" } }, { maxItems: 2 }],
      })

      expect(offenders(out)).toEqual([])
      expect(out.properties.arg.description).toBe("ids")
      expect(JSON.stringify(out)).toContain('"items":{"type":"integer"}')
    })
  }

  test("leaves combiner nodes without a type untouched", () => {
    const arg = { anyOf: [{ type: "string" }, { type: "array", items: { type: "number" } }], description: "x" }

    expect(run(models.gateway, structuredClone(arg)).properties.arg).toEqual(arg)
  })
})

// Gemini's OpenAPI subset rejects empty strings in enum lists
// ("enum[i]: cannot be empty"), which some MCP tool schemas (e.g. PostHog's
// query tools) legitimately contain. Empty entries are dropped before the
// request reaches the provider; an enum left with no values is removed.
describe("ProviderTransform.schema - gemini empty enum values", () => {
  const geminiModel = {
    providerID: "google",
    api: {
      id: "gemini-3-pro",
    },
  } as any

  test("drops empty strings from a plain enum", () => {
    const schema = {
      type: "object",
      properties: {
        operator: { type: "string", enum: ["", "eq", "ne"] },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.operator.enum).toEqual(["eq", "ne"])
  })

  test("drops empty strings from an enum nested in anyOf", () => {
    const schema = {
      type: "object",
      properties: {
        filterGroup: {
          type: "array",
          items: {
            type: "object",
            properties: {
              operator: {
                anyOf: [{ type: "string" }, { type: "string", enum: ["", "eq", "ne"] }],
              },
            },
          },
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    const branch = result.properties.filterGroup.items.properties.operator.anyOf[1]
    expect(branch.enum).toEqual(["eq", "ne"])
  })

  test("removes an enum that only held empty strings", () => {
    const schema = {
      type: "object",
      properties: {
        blank: { type: "string", enum: [""] },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.blank.type).toBe("string")
    expect("enum" in result.properties.blank).toBe(false)
  })

  test("removes an enum that arrives already empty", () => {
    const schema = {
      type: "object",
      properties: {
        blank: { type: "string", enum: [] },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.blank.type).toBe("string")
    expect("enum" in result.properties.blank).toBe(false)
  })

  test.each([{ values: [""] }, { values: [] }])("omits an invalid enum inside anyOf: $values", ({ values }) => {
    const schema = {
      type: "object",
      properties: {
        value: {
          anyOf: [{ type: "string", enum: values }, { type: "number" }],
        },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.value.anyOf[0]).toEqual({ type: "string" })
    expect("enum" in result.properties.value.anyOf[0]).toBe(false)
  })

  test("does not keep a string type alive for an enum emptied to null only", () => {
    const schema = {
      type: "object",
      properties: {
        maybe: { type: ["string", "null"], enum: ["", null] },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.maybe.type).toBe("null")
  })

  test("drops null from a typed enum without adding nullable", () => {
    const schema = {
      type: "object",
      properties: {
        maybe: { type: "string", enum: [null, "a", "b"] },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    // null never satisfied type "string" anyway, so removing it narrows nothing.
    expect(result.properties.maybe).toEqual({ type: "string", enum: ["a", "b"] })
  })

  test("still lifts null into nullable on a type array", () => {
    const schema = {
      type: "object",
      properties: {
        maybe: { type: ["string", "null"], enum: [null, "a", "b"] },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.maybe).toEqual({ type: "string", enum: ["a", "b"], nullable: true })
  })

  test("leaves enums without empty strings untouched", () => {
    const schema = {
      type: "object",
      properties: {
        operator: { type: "string", enum: ["eq", "ne"] },
      },
    } as any

    const result = ProviderTransform.schema(geminiModel, schema) as any

    expect(result.properties.operator.enum).toEqual(["eq", "ne"])
  })

  test("applies when gemini is served through an openai-compatible transport", () => {
    const gatewayModel = {
      providerID: "custom",
      api: {
        id: "gemini-flash-latest",
        npm: "@ai-sdk/openai-compatible",
      },
    } as any

    const schema = {
      type: "object",
      properties: {
        operator: { type: "string", enum: ["", "eq", "ne"] },
      },
    } as any

    const result = ProviderTransform.schema(gatewayModel, schema) as any

    expect(result.properties.operator.enum).toEqual(["eq", "ne"])
  })
})
