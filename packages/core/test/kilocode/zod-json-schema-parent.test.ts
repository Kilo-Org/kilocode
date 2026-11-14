import { expect, test } from "bun:test"
import { Schema } from "effect"
import z from "zod"

import { toJsonSchema, ZodOverride } from "@opencode-ai/core/effect-zod"

// zod 4.6's `flattenRef` reads `ctx.seen.get(schema).ref` without a guard, but `processSchema`
// registers a schema's `parent` only in the branch it skips when the schema carries a custom
// `toJSONSchema` override. A schema with both a refinement (which sets `_zod.parent`) and an
// override is therefore absent from `seen` while flattening still recurses into it, so the whole
// conversion threw and took down every prompt that built tool schemas.
// `patches/zod@4.6.6.patch` treats an unregistered schema as nothing to flatten.
test("a refined zod override with a custom JSON Schema converts instead of throwing", () => {
  const refined = z.string().min(1)
  refined._zod.toJSONSchema = () => ({ type: "string", title: "id" })
  const Params = Schema.Struct({
    id: Schema.String.annotate({ [ZodOverride]: refined }),
    name: Schema.String.annotate({ [ZodOverride]: z.string().describe("name") }),
  })

  expect(toJsonSchema(Params)).toMatchObject({
    type: "object",
    properties: { id: { type: "string", title: "id" }, name: { type: "string", description: "name" } },
    required: ["id", "name"],
  })
})
