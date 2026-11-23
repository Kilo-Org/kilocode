import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import z from "zod"

import { toJsonSchema, ZodOverride } from "@opencode-ai/core/effect-zod"

describe("stripZodFormat", () => {
  test("tool schemas keep string check patterns without non-standard formats", () => {
    const ID = Schema.String.annotate({ [ZodOverride]: z.string().startsWith("bgp") })
    const Params = Schema.Struct({
      id: ID,
      suffix: Schema.String.annotate({ [ZodOverride]: z.string().endsWith(".ts") }),
      part: Schema.String.annotate({ [ZodOverride]: z.string().includes("src") }),
      email: Schema.String.annotate({ [ZodOverride]: z.email() }),
    })

    const out = toJsonSchema(Params) as { properties: Record<string, Record<string, unknown>> }

    expect(out.properties.id).toEqual({ type: "string", pattern: "^bgp.*" })
    expect(out.properties.suffix.format).toBeUndefined()
    expect(out.properties.part.format).toBeUndefined()
    expect(out.properties.email.format).toBe("email")
  })
})
