import type { FormField } from "@opencode/client"
import { describe, expect, test } from "bun:test"
import { formAnswer } from "../webview-ui/src/v2/form"

function formResult(result: ReturnType<typeof formAnswer>) {
  return { ...result, visible: result.visible.map((field) => field.key) }
}

describe("formAnswer", () => {
  test("builds typed answers without trimming ordinary text", () => {
    const result = formAnswer(
      [
        { key: "choice", type: "string", custom: true, required: true },
        { key: "note", type: "string" },
        { key: "count", type: "integer", required: true },
        { key: "rate", type: "number" },
        { key: "enabled", type: "boolean", required: true, default: true },
        { key: "optIn", type: "boolean", required: true },
      ],
      { choice: "old", note: " keep  ", count: "0", rate: "1.5", enabled: false },
      { choice: " new " },
    )
    expect(formResult(result)).toStrictEqual({
      answer: { choice: "new", note: " keep  ", count: 0, rate: 1.5, enabled: false, optIn: false },
      visible: ["choice", "note", "count", "rate", "enabled", "optIn"],
      errors: [],
    })
  })

  test("keeps external links visible and accepts only true acknowledgements", () => {
    const result = formAnswer(
      [
        { key: "first", type: "external", title: "Read the guide", url: "https://example.com/guide" },
        { key: "name", type: "string", required: true },
        { key: "second", type: "external", url: "https://example.com/help" },
        { key: "third", type: "external", url: "https://example.com/info" },
        { key: "fourth", type: "external", url: "https://example.com/setup" },
        { key: "acknowledged", type: "string", default: "done", when: [{ key: "fourth", op: "eq", value: true }] },
      ],
      { first: "true", third: false, fourth: true },
    )
    expect(formResult(result)).toStrictEqual({
      answer: { fourth: true, acknowledged: "done" },
      visible: ["first", "name", "second", "third", "fourth", "acknowledged"],
      errors: [
        "Read the guide: open the link first.",
        "name is required.",
        "second: open the link first.",
        "third: open the link first.",
      ],
    })
  })

  test("checks numeric format before bounds and accepts the inclusive endpoints", () => {
    const result = formAnswer(
      [
        { key: "rate", type: "number", minimum: 0, maximum: 2.5 },
        { key: "count", type: "integer", minimum: 0, maximum: 3 },
        { key: "below", type: "number", title: "Lower limit", minimum: 0 },
        { key: "above", type: "integer", maximum: 0 },
        { key: "fraction", type: "integer", maximum: 1 },
        { key: "infinite", type: "number", maximum: 1 },
        { key: "notNumeric", type: "number" },
        { key: "blank", type: "number", required: true, default: 2 },
      ],
      {
        rate: "2.5",
        count: "0",
        below: "-0.1",
        above: "1",
        fraction: "2.5",
        infinite: "Infinity",
        notNumeric: "NaN",
        blank: " ",
      },
    )
    expect(formResult(result)).toStrictEqual({
      answer: { rate: 2.5, count: 0 },
      visible: ["rate", "count", "below", "above", "fraction", "infinite", "notNumeric", "blank"],
      errors: [
        "Lower limit is outside the allowed range.",
        "above is outside the allowed range.",
        "fraction must be an integer.",
        "infinite must be a number.",
        "notNumeric must be a number.",
        "blank is required.",
      ],
    })
  })

  test("uses only earlier accepted answers to activate fields", () => {
    const result = formAnswer(
      [
        { key: "forward", type: "string", required: true, when: [{ key: "count", op: "eq", value: 2 }] },
        { key: "count", type: "integer" },
        { key: "badCount", type: "integer", maximum: 3 },
        { key: "rejected", type: "string", required: true, when: [{ key: "badCount", op: "neq", value: 3 }] },
        { key: "empty", type: "string" },
        { key: "missing", type: "string", required: true, when: [{ key: "empty", op: "neq", value: "full" }] },
        { key: "mode", type: "string", hidden: true, default: "quick" },
        {
          key: "detail",
          type: "string",
          required: true,
          when: [
            { key: "count", op: "eq", value: 2 },
            { key: "mode", op: "eq", value: "full" },
          ],
        },
        {
          key: "note",
          type: "string",
          when: [
            { key: "count", op: "eq", value: 2 },
            { key: "mode", op: "neq", value: "full" },
          ],
        },
      ],
      { forward: "stale", count: "2", badCount: 4, rejected: "stale", empty: " ", detail: "stale", note: "ready" },
    )
    expect(formResult(result)).toStrictEqual({
      answer: { count: 2, mode: "quick", note: "ready" },
      visible: ["count", "badCount", "empty", "note"],
      errors: ["badCount is outside the allowed range."],
    })
  })

  test("validates active hidden fields without displaying them", () => {
    const fields: FormField[] = [
      { key: "advanced", type: "boolean" },
      { key: "token", type: "string", hidden: true, default: "fixture-token" },
      {
        key: "region",
        type: "string",
        hidden: true,
        required: true,
        when: [{ key: "advanced", op: "eq", value: true }],
      },
      { key: "name", type: "string", title: "Name", required: true },
    ]
    expect(formResult(formAnswer(fields, { advanced: true }))).toStrictEqual({
      answer: { advanced: true, token: "fixture-token" },
      visible: ["advanced", "name"],
      errors: ["region is required.", "Name is required."],
    })
    expect(formResult(formAnswer(fields, { advanced: false, region: "stale", name: "name" }))).toStrictEqual({
      answer: { advanced: false, token: "fixture-token", name: "name" },
      visible: ["advanced", "name"],
      errors: [],
    })
  })

  test("validates custom multiselect counts after trimming and deduplicating", () => {
    const result = formAnswer(
      [
        { key: "tags", type: "multiselect", options: [], custom: true, minItems: 3, maxItems: 3 },
        { key: "detail", type: "string", default: "selected", when: [{ key: "tags", op: "eq", value: 1 }] },
        { key: "tooFew", type: "multiselect", options: [], custom: true, minItems: 2 },
        { key: "tooMany", type: "multiselect", options: [], custom: true, maxItems: 1 },
        { key: "required", type: "multiselect", options: [], custom: true, required: true, minItems: 2 },
        { key: "optional", type: "multiselect", options: [], minItems: 2 },
        { key: "fixed", type: "multiselect", options: [], maxItems: 1, default: ["fixed"] },
      ],
      { tags: ["z", "a", "z"], tooFew: ["a"], tooMany: ["a"], required: [], optional: [] },
      { tags: " 1 ", tooFew: " a ", tooMany: " b ", required: " ", fixed: "ignored" },
    )
    expect(formResult(result)).toStrictEqual({
      answer: { tags: ["z", "a", "1"], detail: "selected", fixed: ["fixed"] },
      visible: ["tags", "detail", "tooFew", "tooMany", "required", "optional", "fixed"],
      errors: [
        "tooFew has an invalid number of selections.",
        "tooMany has an invalid number of selections.",
        "required is required.",
      ],
    })
  })
})
