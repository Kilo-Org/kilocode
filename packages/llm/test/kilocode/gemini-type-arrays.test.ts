import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../../src"
import * as Gemini from "../../src/protocols/gemini"
import { ToolSchemaProjection } from "../../src/protocols/utils/tool-schema"
import { Auth, LLMClient } from "../../src/route"
import { it } from "../lib/effect"

const model = Gemini.route
  .with({
    endpoint: { baseURL: "https://generativelanguage.test/v1beta/" },
    auth: Auth.header("x-goog-api-key", "test"),
  })
  .model({ id: "gemini-3-pro" })

// Shaped after the nteract Pages `edit_page` tool, plus multi-type fields.
const pages = () => ({
  type: "object",
  properties: {
    operations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          attrs: {
            type: "object",
            properties: {
              align: {
                description: "Alignment of the column holding match_text; null clears it.",
                type: ["string", "null"],
                enum: ["left", "center", "right", null],
              },
              level: { type: ["integer", "null"], enum: [1, 2, 3, null] },
            },
          },
          value: {
            type: ["string", "number", "null"],
            enum: ["auto", 0, 1, null],
            pattern: "^[a-z]+$",
            minimum: 0,
            description: "mixed value",
          },
          revision: { type: ["string", "integer"], format: "date-time", minLength: 2, minimum: 1 },
          target: {
            type: ["object", "array", "null"],
            properties: { id: { type: "string" } },
            required: ["id"],
            items: { type: "string" },
          },
          status: { type: ["number", "string"], description: "status filter" },
          mode: { type: ["string", "number"], enum: ["a", "b"] },
          loose: { enum: ["x", null] },
        },
      },
    },
  },
})

// Paths of keys that sit next to an `anyOf`, other than `nullable` and `description`.
const offenders = (node: unknown, path: string[] = []): string[] => {
  if (node === null || typeof node !== "object") return []
  if (Array.isArray(node)) return node.flatMap((item, i) => offenders(item, [...path, String(i)]))
  const own =
    "anyOf" in node ? Object.keys(node).filter((key) => !["anyOf", "nullable", "description"].includes(key)) : []
  return [
    ...own.map((key) => [...path, key].join(".")),
    ...Object.entries(node).flatMap(([key, value]) => offenders(value, [...path, key])),
  ]
}

const fields = (schema: any) => schema.properties.operations.items.properties

describe("gemini type arrays", () => {
  test("keeps the nullable align enum flat with null out of the enum", () => {
    expect(fields(ToolSchemaProjection.gemini(pages())).attrs.properties).toEqual({
      align: {
        description: "Alignment of the column holding match_text; null clears it.",
        type: "string",
        nullable: true,
        enum: ["left", "center", "right"],
      },
      level: { type: "string", nullable: true, enum: ["1", "2", "3"] },
    })
  })

  test("splits multi-type arrays into anyOf branches with their own keywords and enum values", () => {
    const props = fields(ToolSchemaProjection.gemini(pages()))

    expect(props.value).toEqual({
      anyOf: [
        { type: "string", enum: ["auto"] },
        { type: "string", enum: ["0", "1"] },
      ],
      nullable: true,
      description: "mixed value",
    })
    expect(props.revision).toEqual({
      anyOf: [
        { type: "string", format: "date-time", minLength: 2 },
        { type: "integer", format: "date-time" },
      ],
    })
    expect(props.target).toEqual({
      anyOf: [
        { type: "object", required: ["id"], properties: { id: { type: "string" } } },
        { type: "array", items: { type: "string" } },
      ],
      nullable: true,
    })
    expect(props.status).toEqual({ anyOf: [{ type: "number" }, { type: "string" }], description: "status filter" })
  })

  test("drops a type whose enum has no matching values", () => {
    expect(fields(ToolSchemaProjection.gemini(pages())).mode).toEqual({ type: "string", enum: ["a", "b"] })
  })

  test("drops an empty object branch instead of sending a null anyOf entry", () => {
    const project = (x: unknown) => ToolSchemaProjection.gemini({ type: "object", properties: { x } }).properties
    expect(project({ type: ["object", "string"] })).toEqual({ x: { type: "string" } })
    expect(project({ type: ["object", "string", "number", "null"] })).toEqual({
      x: { anyOf: [{ type: "string" }, { type: "number" }], nullable: true },
    })
    expect(JSON.stringify(project({ type: ["object", "string", "number"] }))).not.toContain("null")
  })

  test("leaves enum off a branch when no value matches the declared types", () => {
    const project = (x: unknown) => ToolSchemaProjection.gemini({ type: "object", properties: { x } }).properties
    expect(project({ type: ["string"], enum: [1] })).toEqual({ x: { type: "string" } })
    expect(project({ type: ["string", "boolean"], enum: [1] })).toEqual({
      x: { anyOf: [{ type: "string" }, { type: "boolean" }] },
    })
  })

  test("marks an untyped enum with null as nullable", () => {
    expect(fields(ToolSchemaProjection.gemini(pages())).loose).toEqual({ nullable: true, enum: ["x"] })
  })

  test("leaves no anyOf next to keys other than nullable and description", () => {
    const result = ToolSchemaProjection.gemini(pages())
    expect(offenders(result)).toEqual([])
    expect(JSON.stringify(result)).not.toContain('"null"')
  })

  it.effect("sends the lowered schema in the Gemini request body", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare<Gemini.GeminiBody>(
        LLM.request({
          id: "req_type_arrays",
          model,
          prompt: "Use the tool.",
          tools: [{ name: "pages_edit_page", description: "Edit a page", inputSchema: pages() }],
        }),
      )

      const params = prepared.body.tools?.at(0)?.functionDeclarations.at(0)?.parameters
      expect(fields(params).attrs.properties.align).toEqual({
        description: "Alignment of the column holding match_text; null clears it.",
        type: "string",
        nullable: true,
        enum: ["left", "center", "right"],
      })
      expect(offenders(params)).toEqual([])
    }),
  )
})
