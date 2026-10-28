import { describe, expect, test } from "bun:test"
import { formAnswer } from "../webview-ui/src/v2/form"

describe("formAnswer", () => {
  test("builds typed answers and combines custom selections", () => {
    const result = formAnswer(
      [
        { key: "choice", type: "string", custom: true, required: true },
        { key: "tags", type: "multiselect", options: [], custom: true },
        { key: "count", type: "integer", required: true },
        { key: "rate", type: "number" },
        { key: "enabled", type: "boolean", required: true },
        { key: "link", type: "external", url: "https://example.com" },
      ],
      { choice: "old", tags: ["a", "b"], count: "0", rate: "1.5", enabled: false, link: true },
      { choice: " new ", tags: "a" },
    )
    expect(result.errors).toEqual([])
    expect(result.answer).toEqual({ choice: "new", tags: ["a", "b"], count: 0, rate: 1.5, enabled: false, link: true })
  })

  test("requires an acknowledged external field, as the server does", () => {
    const result = formAnswer([{ key: "link", type: "external", url: "https://example.com" }], {})
    expect(result.errors).toHaveLength(1)
    expect(result.answer).toEqual({})
  })

  test("blocks missing required answers and invalid numeric values", () => {
    expect(
      formAnswer(
        [
          { key: "name", type: "string", required: true },
          { key: "tags", type: "multiselect", options: [], required: true },
          { key: "count", type: "integer" },
          { key: "rate", type: "number" },
        ],
        { name: "  ", tags: [], count: "2.5", rate: "NaN" },
      ).errors,
    ).toHaveLength(4)
  })

  test("uses hidden defaults and omits inactive conditional fields", () => {
    const result = formAnswer(
      [
        { key: "token", type: "string", hidden: true, default: "default" },
        { key: "mode", type: "string", default: "quick" },
        { key: "detail", type: "string", required: true, when: [{ key: "mode", op: "eq", value: "full" }] },
        { key: "note", type: "string", when: [{ key: "mode", op: "neq", value: "full" }] },
      ],
      { detail: "stale", note: "note" },
    )
    expect(result.errors).toEqual([])
    expect(result.answer).toEqual({ token: "default", mode: "quick", note: "note" })
    expect(result.visible.map((field) => field.key)).toEqual(["mode", "note"])
  })

  test("validates numeric bounds and selection counts", () => {
    expect(
      formAnswer(
        [
          { key: "count", type: "number", minimum: 1, maximum: 3 },
          { key: "tags", type: "multiselect", options: [], maxItems: 1, custom: true },
        ],
        { count: "4", tags: ["a"] },
        { tags: "b" },
      ).errors,
    ).toHaveLength(2)
  })
})
