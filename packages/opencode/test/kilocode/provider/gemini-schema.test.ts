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
